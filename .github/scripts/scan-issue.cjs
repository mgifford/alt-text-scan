// External script for the "Scan issue" step in scan-issue-queue.yml.
// Extracted to stay within GitHub Actions' 21,000-character inline-script limit.
//
// Named .cjs so Node.js treats it as CommonJS even when the repo's package.json
// has "type": "module" (which would otherwise make .js files ES modules and break
// require() calls made by actions/github-script).
//
// Called by actions/github-script with:
//   env:
//     ISSUE_NUMBER: ${{ matrix.issue_number }}
//   script: |
//     const { scanIssue } = require('./.github/scripts/scan-issue.cjs');
//     return await scanIssue({ github, context, core });

// Use spawn (not execSync) to avoid command-injection risks with user-supplied input.
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');

const MAX_STDERR_TAIL = 5000; // characters of stderr to include in error messages

function summarizeCommandOutput(output) {
  return (output || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-5)
    .join(' | ');
}

async function scanIssue({ github, context, core }) {
  const issueNumber = Number(process.env.ISSUE_NUMBER);

  // Validate issue number is a positive integer
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    core.setFailed(`Invalid issue number: ${issueNumber}`);
    return;
  }

  console.log(`\n=== Processing issue #${issueNumber} ===`);
  const failureState = {
    phase: 'starting scan',
    lastScannedUrl: null,
    reportDir: null,
    meta: null,
    lastGitError: null
  };

  const defaultBranch = context.payload.repository?.default_branch || 'main';
  const eventPath = `.tmp/issue-${issueNumber}-event.json`;
  const scanOutputDir = `.scan-output-${issueNumber}`;

  try {
    failureState.phase = 'fetching issue details';
    const { data: issue } = await github.rest.issues.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber
    });

    for (const name of ['scan-failed', 'scan-complete']) {
      try {
        await github.rest.issues.removeLabel({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issueNumber,
          name
        });
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }
      }
    }

    await github.rest.issues.addLabels({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber,
      labels: ['scan-in-progress']
    });

    // Create event payload for the scanner
    const eventPayload = {
      action: 'scheduled-scan',
      issue: issue
    };

    // Create temp directory and event file
    fs.mkdirSync('.tmp', { recursive: true });
    fs.writeFileSync(eventPath, JSON.stringify(eventPayload, null, 2));

    // Create scan output directory
    fs.mkdirSync(scanOutputDir, { recursive: true });

    // Run the scan using spawn for better security.
    // SCAN_KILL_MS (75 min) is intentionally 15 minutes shorter than the job-level
    // timeout-minutes: 90.  This buffer lets the catch block post an error comment
    // and update issue labels before GitHub forcibly cancels the runner at 90 min.
    console.log(`Running scan for issue #${issueNumber}...`);
    failureState.phase = 'running alt-text scan';
    const SCAN_KILL_MS = 75 * 60 * 1000;    // 75 minutes
    const KILL_GRACE_PERIOD_MS = 5000;         // time between SIGTERM and SIGKILL
    const scanProcess = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['scanner/run-alt-text-scan.mjs', eventPath, scanOutputDir],
        { env: process.env }
      );

      // Kill the child if it runs longer than SCAN_KILL_MS
      let sigkillTimer = null;
      const killTimer = setTimeout(() => {
        console.error(`[issue #${issueNumber}] Scan exceeded ${SCAN_KILL_MS / 60000} minutes — killing process`);
        child.kill('SIGTERM');
        sigkillTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_PERIOD_MS);
      }, SCAN_KILL_MS);

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) {
            console.log(`[issue #${issueNumber}] ${trimmed}`);
          }
        }
      });

      child.on('error', (error) => {
        clearTimeout(killTimer);
        if (sigkillTimer) clearTimeout(sigkillTimer);
        reject(new Error(`Failed to run scan: ${error.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(killTimer);
        if (sigkillTimer) clearTimeout(sigkillTimer);
        if (code !== 0) {
          reject(new Error(`Scan process exited with code ${code}\n${stderr.slice(-MAX_STDERR_TAIL)}`));
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    const scanResult = scanProcess.stdout;
    let meta;
    try {
      meta = JSON.parse(scanResult);
      failureState.meta = meta;
    } catch (parseError) {
      throw new Error(`Failed to parse scan output as JSON: ${parseError.message}`);
    }
    console.log(`Scan completed:`, meta);

    const lastScannedMatch = [...scanProcess.stderr.matchAll(/\[(\d+)\/(\d+)\]\s+Scanned\s+(.+?)\s+in\s+(\d+)ms/g)].pop();
    if (lastScannedMatch) {
      const [, current, total, url, elapsedMs] = lastScannedMatch;
      console.log(`Last scanned URL for issue #${issueNumber}: ${url} (${elapsedMs}ms, ${current}/${total})`);
      failureState.lastScannedUrl = url;
    }

    if (meta.skipped) {
      console.log(`Issue #${issueNumber} was skipped: ${meta.reason}`);
      // Clean up temporary files
      fs.rmSync(eventPath, { force: true });
      fs.rmSync(scanOutputDir, { recursive: true, force: true });

      // Build a context-aware comment:
      //   - no_urls_discovered → site blocked all automated access; guide user toward explicit URLs
      //   - anything else      → generic skip message
      const owner = context.repo.owner;
      const repo = context.repo.repo;
      let skipCommentBody;
      if (meta.skipReason === 'no_urls_discovered') {
        const domain = meta.scanTitle || '<domain>';
        skipCommentBody = [
          '🚫 **Scan blocked – URL discovery failed**',
          '',
          'This site returned HTTP 403 (Forbidden) for every automated access attempt. ' +
          'The scanner tried all of the following strategies and found 0 pages:',
          '',
          '- Standard and alternative sitemap paths (`/sitemap.xml`, `/sitemap_index.xml`, …)',
          '- `robots.txt` sitemap directives',
          '- Direct page crawl',
          '- [Wayback Machine](https://web.archive.org/) CDX archive index',
          '- [Bing Web Search API](https://www.microsoft.com/en-us/bing/apis/bing-web-search-api) *(if `BING_API_KEY` is configured)*',
          '',
          'Many government and enterprise sites actively block automated scanners at the CDN or WAF level ' +
          '(e.g. Akamai, Cloudflare). This is not a bug — the scanner cannot bypass these protections.',
          '',
          '**What you can do:**',
          '',
          '**Option 1 – Provide specific page URLs** *(recommended)*',
          'Edit this issue, add the exact page URLs you want scanned (one per line) ' +
          'in the `## URLs` section below, then reopen it to trigger a new scan:',
          '',
          '```',
          `SCAN: ${domain}`,
          '## URLs',
          `${domain.replace(/\/$/, '')}/page-one`,
          `${domain.replace(/\/$/, '')}/page-two`,
          `${domain.replace(/\/$/, '')}/page-three`,
          '```',
          '',
          '**Option 2 – Retry after the block lifts**',
          'If the site was temporarily unavailable, reopen this issue to try again. ' +
          'The scanner will attempt all discovery strategies once more.',
          '',
          '> ⚠️ **Recurring scan warning:** If you have set up `WEEKLY:`, `MONTHLY:`, or other ' +
          'scheduled recurring scans for this domain, they will fail the same way on every run — ' +
          'generating workflow failures without results. Please update those issues to include ' +
          'explicit page URLs, or remove the recurring issue to avoid unnecessary workflow runs.',
          '',
          'This issue has been closed to prevent indefinite automated retries.',
        ].join('\n');
      } else {
        skipCommentBody = [
          `⚠️ **Scan skipped**: ${meta.reason}`,
          '',
          'This issue has been closed to avoid repeated retries. If the site becomes accessible, please reopen this issue to trigger a new scan.'
        ].join('\n');
      }

      try {
        await github.rest.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body: skipCommentBody
        });
      } catch (commentError) {
        console.warn(`Failed to post skip comment for issue #${issueNumber}:`, commentError.message);
      }

      // Remove in-progress label; apply scan-blocked for WAF blocks, otherwise no failure label
      for (const name of ['scan-in-progress', 'scan-failed', 'scan-pending']) {
        try {
          await github.rest.issues.removeLabel({ owner, repo, issue_number: issueNumber, name });
        } catch (labelError) {
          if (labelError.status !== 404) throw labelError;
        }
      }
      if (meta.skipReason === 'no_urls_discovered') {
        try {
          await github.rest.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: ['scan-blocked'] });
        } catch (labelError) {
          console.warn(`Failed to apply scan-blocked label:`, labelError.message);
        }
      }
      try {
        await github.rest.issues.update({ owner, repo, issue_number: issueNumber, state: 'closed' });
        console.log(`Issue #${issueNumber} closed (scan skipped: ${meta.reason})`);
      } catch (closeError) {
        console.warn(`Failed to close issue #${issueNumber}:`, closeError.message);
      }
      return;
    }

    // Prepare report paths
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportDir = `reports/issues/issue-${issueNumber}/${stamp}`;
    const summaryPath = `${reportDir}/report.json`;
    const markdownPath = `${reportDir}/report.md`;
    const htmlPath = `${reportDir}/report.html`;
    const csvPath = `${reportDir}/report.csv`;
    failureState.reportDir = reportDir;

    // Create report directory and copy files
    failureState.phase = 'writing report artifacts';
    fs.mkdirSync(reportDir, { recursive: true });
    fs.copyFileSync(`${scanOutputDir}/report.json`, summaryPath);
    fs.copyFileSync(`${scanOutputDir}/report.md`, markdownPath);
    fs.copyFileSync(`${scanOutputDir}/report.html`, htmlPath);
    fs.copyFileSync(`${scanOutputDir}/report.csv`, csvPath);

    // Clean up temporary files
    fs.rmSync(eventPath, { force: true });
    fs.rmSync(scanOutputDir, { recursive: true, force: true });

    // Regenerate reports.html
    console.log('Regenerating reports.html...');
    failureState.phase = 'regenerating report index';
    const generateResult = spawnSync(process.execPath, ['scanner/generate-reports-html.mjs']);
    if (generateResult.status !== 0) {
      console.warn('Failed to regenerate reports.html:', generateResult.stderr);
    }

    // Commit and push the report using spawnSync for security
    failureState.phase = 'committing report artifacts';
    spawnSync('git', ['config', 'user.name', 'github-actions[bot]']);
    spawnSync('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
    spawnSync('git', ['add', reportDir]);
    spawnSync('git', ['add', 'reports.html']);
    spawnSync('git', ['add', 'legacy-reports.html']);

    // Check if there are changes to commit
    const statusResult = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
    if (statusResult.stdout.trim()) {
      const commitMessage = `chore(scan): scheduled scan for issue #${issueNumber}`;
      const commitResult = spawnSync('git', ['commit', '-m', commitMessage]);
      if (commitResult.status !== 0) {
        throw new Error(`Failed to commit: ${commitResult.stderr}`);
      }

      // Retry push with rebase up to 3 times
      failureState.phase = 'pushing report artifacts';
      let pushSucceeded = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`Push attempt ${attempt}...`);
        const pullResult = spawnSync('git', ['pull', '--rebase', 'origin', defaultBranch], { encoding: 'utf8' });
        if (pullResult.status === 0) {
          const pushResult = spawnSync('git', ['push', 'origin', `HEAD:${defaultBranch}`], { encoding: 'utf8' });
          if (pushResult.status === 0) {
            console.log(`Report committed and pushed for issue #${issueNumber} on attempt ${attempt}`);
            pushSucceeded = true;
            break;
          } else {
            failureState.lastGitError = `Push attempt ${attempt} failed: ${summarizeCommandOutput(pushResult.stderr || pushResult.stdout) || 'No push output captured.'}`;
            console.warn(`Push failed on attempt ${attempt}: ${pushResult.stderr}`);
          }
        } else {
          failureState.lastGitError = `Rebase attempt ${attempt} failed: ${summarizeCommandOutput(pullResult.stderr || pullResult.stdout) || 'No rebase output captured.'}`;
          console.warn(`Rebase failed on attempt ${attempt}: ${pullResult.stderr}`);
          // reports.html and legacy-reports.html are generated files — resolve conflicts by regenerating them
          const statusCheck = spawnSync('git', ['status'], { encoding: 'utf8' });
          if (statusCheck.stdout.includes('rebase in progress')) {
            const conflictCheck = spawnSync('git', ['diff', '--name-only', '--diff-filter=U'], { encoding: 'utf8' });
            const conflictFiles = conflictCheck.stdout.trim().split('\n');
            if (conflictFiles.some(f => f === 'reports.html' || f === 'legacy-reports.html')) {
              console.log('Conflict in generated reports HTML — resolving by regenerating...');
              spawnSync(process.execPath, ['scanner/generate-reports-html.mjs']);
              spawnSync('git', ['add', 'reports.html']);
              spawnSync('git', ['add', 'legacy-reports.html']);
              const continueResult = spawnSync('git', ['rebase', '--continue'], { encoding: 'utf8', env: { ...process.env, GIT_EDITOR: 'true' } });
              if (continueResult.status === 0) {
                const pushResult = spawnSync('git', ['push', 'origin', `HEAD:${defaultBranch}`], { encoding: 'utf8' });
                if (pushResult.status === 0) {
                  console.log(`Report committed and pushed for issue #${issueNumber} on attempt ${attempt} (after resolving reports HTML conflict)`);
                  pushSucceeded = true;
                  break;
                }
              }
            }
            spawnSync('git', ['rebase', '--abort']);
          }
        }

        if (attempt < 3) {
          const delay = attempt * 2000; // Wait 2s before 2nd attempt, 4s before 3rd attempt
          console.log(`Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      if (!pushSucceeded) {
        throw new Error(`Failed to push after 3 attempts. ${failureState.lastGitError || 'No git error details captured.'}`);
      }
    } else {
      console.log(`No changes to commit for issue #${issueNumber}`);
    }

    // Post comment with results
    failureState.phase = 'posting success comment';
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const encodedJsonPath = summaryPath.split('/').map(encodeURIComponent).join('/');
    const encodedMarkdownPath = markdownPath.split('/').map(encodeURIComponent).join('/');
    const encodedHtmlPath = htmlPath.split('/').map(encodeURIComponent).join('/');
    const encodedCsvPath = csvPath.split('/').map(encodeURIComponent).join('/');
    const jsonPagesUrl = `https://${owner}.github.io/${repo}/${encodedJsonPath}`;
    const pagesUrl = `https://${owner}.github.io/${repo}/${encodedHtmlPath}`;
    const csvPagesUrl = `https://${owner}.github.io/${repo}/${encodedCsvPath}`;
    const jsonBlobUrl = `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(defaultBranch)}/${encodedJsonPath}`;
    const blobUrl = `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(defaultBranch)}/${encodedMarkdownPath}`;
    const csvBlobUrl = `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(defaultBranch)}/${encodedCsvPath}`;

    const body = [
      `Scheduled alt text review complete for **${meta.scanTitle}**.`,
      "",
      `- Accepted URLs: ${meta.acceptedCount}`,
      `- Scanned URLs: ${meta.scannedCount ?? meta.acceptedCount}`
    ];

    // Add warning if some URLs were skipped
    if (meta.skippedDueToTimeout && meta.skippedDueToTimeout > 0) {
      body.push(`- ⚠️ **${meta.skippedDueToTimeout} URLs skipped due to timeout** (scan exceeded time limit)`);
    }

    // Add recommendation if only 1 URL was scanned
    if (meta.acceptedCount === 1) {
      body.push(``);
      body.push(`💡 **Only 1 URL was scanned.** Alt Text Scan works best with multiple URLs. To generate a list of related URLs for a more thorough alt text review, try the [Top Task Finder](https://mgifford.github.io/top-task-finder/). You can edit this issue to add more URLs and reopen it to trigger a new scan.`);
      body.push(``);
    }

    body.push(
      `- Rejected URLs: ${meta.rejectedCount}`,
      "",
      '- Image inventory CSV contains one row per unique image with alt text and semantic metadata (title, aria-label, aria-describedby, longdesc, role, dimensions, source pages).',
      `Report (Pages, HTML): ${pagesUrl}`,
      `Report (Pages, JSON): ${jsonPagesUrl}`,
      `Fallback (GitHub): ${blobUrl}`,
      `Image inventory CSV (Pages): ${csvPagesUrl}`,
      `JSON fallback (GitHub): ${jsonBlobUrl}`,
      `Image inventory CSV fallback (GitHub): ${csvBlobUrl}`
    );

    const commentBody = body.join("\n");

    // Retry posting comment with exponential backoff
    let commentPosted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await github.rest.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body: commentBody
        });
        console.log(`Comment posted to issue #${issueNumber}`);
        commentPosted = true;
        break;
      } catch (commentError) {
        console.warn(`Attempt ${attempt + 1} failed to post comment:`, commentError.message);
        if (attempt < 2) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    if (!commentPosted) {
      console.error(`Failed to post success comment after 3 attempts`);
    }

    for (const name of ['scan-in-progress', 'scan-failed']) {
      try {
        await github.rest.issues.removeLabel({
          owner,
          repo,
          issue_number: issueNumber,
          name
        });
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }
      }
    }

    await github.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: ['scan-complete']
    });

    // Close the issue if URLs were successfully scanned
    // Note: Issues with zero accepted URLs remain open for review
    if (meta.acceptedCount > 0) {
      failureState.phase = 'closing issue';
      let issueClosed = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await github.rest.issues.update({
            owner,
            repo,
            issue_number: issueNumber,
            state: 'closed'
          });
          console.log(`Issue #${issueNumber} closed`);
          issueClosed = true;
          break;
        } catch (closeError) {
          console.warn(`Attempt ${attempt + 1} failed to close issue:`, closeError.message);
          if (attempt < 2) {
            const delay = Math.pow(2, attempt) * 1000; // 1s, 2s
            console.log(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (!issueClosed) {
        console.error(`Failed to close issue after 3 attempts. Scan completed successfully but issue remains open.`);
      }
    }

  } catch (error) {
    console.error(`Error processing issue #${issueNumber}:`, error);

    // Clean up temporary files on error
    try {
      fs.rmSync(eventPath, { force: true });
      fs.rmSync(scanOutputDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(`Failed to clean up temporary files:`, cleanupError);
    }

    // Post error comment (no retry - best effort)
    try {
      const detailLines = [];
      if (failureState.meta) {
        detailLines.push(
          `- Accepted URLs: ${failureState.meta.acceptedCount ?? 0}`,
          `- Scanned URLs: ${failureState.meta.scannedCount ?? 0}`,
          `- Rejected URLs: ${failureState.meta.rejectedCount ?? 0}`
        );
      }
      if (failureState.lastScannedUrl) {
        detailLines.push(`- Last scanned URL: ${failureState.lastScannedUrl}`);
      }
      if (failureState.reportDir) {
        detailLines.push(`- Report directory prepared locally: ${failureState.reportDir}`);
      }
      if (failureState.lastGitError) {
        detailLines.push(`- Last git error: ${failureState.lastGitError}`);
      }

      // Count previous scan error comments to decide whether to auto-close.
      // 3 retries balances giving transient errors a chance to resolve on their own
      // (network blips, temporary site outages) against letting persistently-blocked
      // or misconfigured scans run indefinitely and consume Actions minutes every day.
      // Override by setting MAX_SCAN_RETRIES as a repo variable if a different
      // threshold suits your workflow.
      const MAX_SCAN_RETRIES = Number(process.env.MAX_SCAN_RETRIES || '3');
      let priorErrorCount = 0;
      try {
        const { data: allComments } = await github.rest.issues.listComments({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issueNumber,
          per_page: 100
        });
        priorErrorCount = allComments.filter(c =>
          c.user.login === 'github-actions[bot]' &&
          c.body.startsWith('❌ Scheduled scan encountered an error')
        ).length;
      } catch (countError) {
        console.warn(`Failed to count prior scan errors:`, countError.message);
      }

      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        body: [
          `❌ Scheduled scan encountered an error during ${failureState.phase}: ${error.message}`,
          '',
          ...detailLines,
          '',
          `Please check the [workflow logs](https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}) for details.`
        ].join('\n')
      });

      for (const name of ['scan-in-progress', 'scan-complete', 'scan-pending']) {
        try {
          await github.rest.issues.removeLabel({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: issueNumber,
            name
          });
        } catch (labelError) {
          if (labelError.status !== 404) {
            throw labelError;
          }
        }
      }

      await github.rest.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        labels: ['scan-failed']
      });

      // Auto-close after MAX_SCAN_RETRIES consecutive failures to prevent indefinite retries.
      // priorErrorCount is the number of errors BEFORE this one, so the total including this
      // error is priorErrorCount + 1.
      if (priorErrorCount + 1 >= MAX_SCAN_RETRIES) {
        try {
          await github.rest.issues.createComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: issueNumber,
            body: [
              `🔒 **Scan automatically closed** after ${MAX_SCAN_RETRIES} consecutive failures.`,
              '',
              'Possible causes:',
              '- The site is blocking automated access — try providing specific page URLs in the `## URLs` section of the issue body',
              '- The scan is timing out — try reducing the number of URLs or splitting into smaller batches',
              '- A transient infrastructure error occurred',
              '',
              'Reopen this issue to try again, or edit it to add specific page URLs before reopening.',
            ].join('\n')
          });
          await github.rest.issues.update({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: issueNumber,
            state: 'closed'
          });
          console.log(`Issue #${issueNumber} auto-closed after ${MAX_SCAN_RETRIES} consecutive failures`);
        } catch (autoCloseError) {
          console.warn(`Failed to auto-close issue #${issueNumber} after retry cap:`, autoCloseError.message);
        }
      }
    } catch (commentError) {
      console.error(`Failed to post error comment:`, commentError.message);
    }

    core.setFailed(`Failed to process issue #${issueNumber} during ${failureState.phase}: ${error.message}`);
  }
}

module.exports = { scanIssue };
