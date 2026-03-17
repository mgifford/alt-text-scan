# Alt Text Scans

Issue-driven alt-text analysis prototype using GitHub Pages and GitHub Actions.

## What it is

- Accepts URL batches from a GitHub Pages form
- Creates scan-request GitHub issues
- Runs batch analysis in GitHub Actions
- Publishes review-ready results to GitHub Pages

## Project Direction

The point of this project is not just to detect whether an image has an `alt` attribute.

The alt-text-specific scanner in this repository is designed to go further by flagging cases such as:

- missing alt text
- decorative images with conflicting non-empty alt text
- filenames used as alt text
- redundant phrases like `image of`
- alt text that is too short to be useful
- alt text that is so long it likely needs a different pattern

Some broader accessibility-engine infrastructure still exists in the repository and workflows. That is supporting or legacy plumbing, not the core product claim.

## Getting Started

### Quick Start: Submit Your Scan in 5 Minutes

1. **Prepare your URLs**: Gather a list of web pages you want to scan for accessibility issues (recommended: 100-150 URLs per scan)
2. **Submit your scan**: Go to [https://mgifford.github.io/alt-text-scan/](https://mgifford.github.io/alt-text-scan/)
   - Enter a descriptive title for your scan
   - Paste your URLs (one per line or comma-separated)
   - Click "Create Scan Request" - this creates a GitHub issue that triggers the scan
3. **Wait for results**: Scans typically complete in 30-60 minutes depending on the number of URLs
4. **View your report**: Check [https://mgifford.github.io/alt-text-scan/reports.html](https://mgifford.github.io/alt-text-scan/reports.html) for your completed scan results

### Integration with Top Task Finder

If you're using the [Top Task Finder](https://mgifford.github.io/top-task-finder/) to identify your most important pages, alt-text-scan is a practical next step:

1. **Identify your top tasks**: Use the Top Task Finder to determine which pages are most critical for your users
2. **Export your URLs**: Get the list of URLs corresponding to your top tasks
3. **Scan for alt text quality**: Paste those URLs into alt-text-scan to review image descriptions at scale
4. **Prioritize fixes**: Focus on the pages where weak or missing alt text creates the biggest usability barriers first

Even if you haven't completed a formal top tasks analysis, alt-text-scan can help you get started by reviewing your key pages first (homepage, main navigation pages, common user journeys, and high-value content types).

### Acknowledgement

This project builds on work from [open-scans](https://github.com/mgifford/open-scans), which remains a useful option for broader HTML accessibility scanning workflows.

## How to Use

### Submit URLs for Scanning

1. Visit the [GitHub Pages site](https://mgifford.github.io/alt-text-scan/)
2. Enter a descriptive scan title (e.g., "GSA.gov Homepage and Key Pages")
3. Enter up to 100 URLs to scan (one per line or comma-separated)
4. Review the validation preview showing accepted/rejected URLs
5. Click "Create Scan Request" to be redirected to GitHub
6. Review and submit the pre-filled issue to start the scan

The form validates URLs in real-time and blocks:

- Localhost URLs
- Private IP addresses (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
- Link-local addresses (169.254.x.x)
- Private IPv6 addresses

**Note**: The form accepts up to 500 URLs, but for best results, split large scans into batches of 100-150 URLs to avoid timeout issues.

### View Scan Results

Visit the [Reports page](https://mgifford.github.io/alt-text-scan/reports.html) to see all completed scans with:

- Issue number and scan title
- Scan timestamp
- Number of URLs scanned
- Report summaries and downloadable artifacts
- Links to detailed reports (Markdown, CSV, JSON)

### Troubleshooting

**Scan not appearing after 30-60 minutes?**

- [View workflow history in GitHub Actions](https://github.com/mgifford/alt-text-scan/actions) to check for errors
- Look for your scan issue number in the workflow runs
- Common issues include invalid URLs or network timeouts

**Need help?**

- Review [workflow run logs in GitHub Actions](https://github.com/mgifford/alt-text-scan/actions) for detailed error messages
- Check that your URLs are publicly accessible
- Ensure URLs don't include localhost or private IP addresses

## Managing Your Scans

### Converting to Recurring Scans

If you find the scan results useful and want to run the same scan regularly:

1. **Find your scan issue**: Go to [https://github.com/mgifford/alt-text-scan/issues](https://github.com/mgifford/alt-text-scan/issues)
   - Your issue may be closed after the scan completes - use the search/filter if needed
   - Look for your issue number (e.g., `#54`)

2. **Edit the issue title**: Change the prefix from `SCAN:` to one of the following:
   - `WEEKLY:` - Runs on the same day of the week the issue was created
   - `SUNDAY:` - Runs every Sunday
   - `MONDAY:`, `TUESDAY:`, `WEDNESDAY:`, `THURSDAY:`, `FRIDAY:`, `SATURDAY:` - Runs on that specific day
   - `MONTHLY:` - Runs on the 1st of each month
   - `QUARTERLY:` - Runs on Jan 1, Apr 1, Jul 1, Oct 1

3. **Reopen the issue**: If the issue was closed, reopen it so the scheduled scans will run

4. **That's it!** Your scan will now run automatically on the schedule you selected

### Updating Your URL List

You can edit the list of URLs in your scan issue at any time:

1. Open your scan issue on GitHub
2. Click the edit (pencil) icon on the issue description
3. Modify the URL list in the issue body
4. Save your changes
5. The next scheduled scan (or manual trigger) will use the updated URL list

### Cleaning Up

To stop recurring scans when you no longer need them:

- **Option 1**: Edit the issue title to remove the schedule prefix (`WEEKLY:`, `SUNDAY:`, etc.) - change it back to `SCAN:` or any other text
- **Option 2**: Close the issue - closed issues are not scanned by the scheduled workflows
- **Option 3**: Delete the issue entirely if you're certain you won't need it again

## Scanning Triggers

Scans can be triggered in multiple ways:

### 1. Automatic On Issue Creation/Reopen

When an issue with a title starting with "SCAN:" is created, it automatically triggers a scan via the "Scan Request" workflow. If you update the request later, close and reopen the issue to run it again.

**Multiple Scans Processing**: If you create multiple SCAN issues at once, they will be processed sequentially (one after another) rather than simultaneously. This ensures stable operation and prevents conflicts when pushing scan results to the repository. Each scan will wait for the previous one to complete before starting.

**Structured requests**: The issue template includes a `## URLs` section. Put one full URL per line there for the most reliable results. If that section is empty, the scanner falls back to searching the body for URLs, and if none are found it may treat a URL in the title as a domain-discovery request.

**Legacy engine selection**: The existing issue workflow still supports choosing from the older accessibility-engine stack. That support remains for compatibility, but it is not the main differentiator of this project.

There are two ways to specify engines:

**1. In the issue title** — include one or more engine keywords:

- `AXE` - axe-core scanner
- `ALFA` - Siteimprove ALFA scanner
- `EQUALACCESS` - IBM Equal Access Checker
- `ACCESSLINT` - AccessLint scanner
- `QUALWEB` - QualWeb scanner
- `ALL` - Run all available scanners

The engine keywords are removed from the scan title automatically. You can combine multiple keywords.

**2. In the first line of the issue body** — use an `Engine:` prefix:

```text
Engine: axe, alfa
```

List engine names separated by spaces or commas. This overrides any engine keywords in the title. Supported values: `axe`, `alfa`, `equalaccess`, `accesslint`, `qualweb`, `all`.

**Examples**:

- `SCAN: AXE Homepage accessibility check` — Runs only axe-core
- `SCAN: ALFA EQUALACCESS Government site scan` — Runs ALFA and Equal Access Checker
- `SCAN: ALL Complete accessibility audit` — Runs all five engines
- `SCAN: Homepage check` — Runs axe + one randomly chosen engine (default)
- Body first line `Engine: axe accesslint` with any title — Runs axe and AccessLint

### 2. Daily Scheduled Scans

**All Open SCAN Issues** - The "Scan All Open SCAN Issues" workflow runs daily at midnight UTC and scans ALL open issues with titles starting with "SCAN:". This ensures that any pending scan requests are processed regularly.

**Timed Issues Only** - The "Scan Timed Issues (WEEKLY, MONTHLY, etc.)" workflow runs daily at 00:15 UTC but ONLY processes issues with timed prefixes that are due on that day:

- `WEEKLY:` - Scans on the same day of the week the issue was created
- `MONTHLY:` - Scans on the 1st of each month
- `QUARTERLY:` - Scans on Jan 1, Apr 1, Jul 1, Oct 1
- `MONDAY:`, `TUESDAY:`, `WEDNESDAY:`, `THURSDAY:`, `FRIDAY:`, `SATURDAY:`, `SUNDAY:` - Scans on the corresponding day of the week

**Note**: Engine selection also works with timed scans (e.g., `WEEKLY: AXE Monday scan`).

### 3. Manual Trigger

You can manually trigger scans by:

1. Going to the [Actions tab](https://github.com/mgifford/alt-text-scan/actions)
2. Selecting the appropriate workflow:
   - **"Scan All Open SCAN Issues"** - To scan all pending "SCAN:" issues (recommended for regular scan requests)
   - **"Scan Timed Issues (WEEKLY, MONTHLY, etc.)"** - To scan recurring timed issues (only if timed issues are due today)
3. Clicking "Run workflow" button

**Important**: If you have a regular scan request (issue title starting with "SCAN:"), use the "Scan All Open SCAN Issues" workflow, not the "Scan Timed Issues" workflow.

## Current status

- Planning artifacts and work packages are generated under `kitty-specs/001-issue-driven-accessibility-scanner/`
- ✅ WP01 (Foundation and Guardrails) - Complete
- ✅ WP02 (Pages Intake and Issue Submission) - Complete
- 🔄 Next: WP03 (Dual-Scanner Execution Engine)

## Architecture

### Frontend (GitHub Pages)

- **index.html**: URL submission form with real-time validation
- **reports.html**: Scan results dashboard
- **submit.js**: Client-side URL parsing, validation, and GitHub integration

### Backend (GitHub Actions)

- **scanner/parse-issue.mjs**: Extracts URLs and engine specifications from scan request issues
- **scanner/validate-targets.mjs**: Server-side URL validation
- **scanner/run-scan.mjs**: Executes accessibility scans with selected engines and generates reports

### Alt Text Analysis

The dedicated alt-text scanner in this repository evaluates image descriptions across pages and classifies them into review categories such as:

1. **Missing** - no alt attribute is present
2. **Decorative** - intentionally empty alt text or presentation roles
3. **Filename-based** - file names used as descriptions
4. **Suspicious** - redundant phrasing or weak wording
5. **Too short / too long** - descriptions that likely need revision
6. **Good** - descriptions that pass the current automated checks

This gives the project a more useful focus than a simple present-versus-absent alt check.

## Configuration

### Legacy Engine Configuration

The repository still includes configuration for IBM's Equal Access Checker (`accessibility-checker`) and related browser-based tooling used by the older workflow:

- **Policies**: IBM_Accessibility ruleset
- **Fail Levels**: violation, potentialviolation
- **Output Format**: JSON reports
- **Puppeteer Args**: Required for GitHub Actions environment
  - `--no-sandbox`: Bypass Chrome sandbox (required in CI/CD)
  - `--disable-setuid-sandbox`: Additional sandbox bypass

The `puppeteerArgs` configuration is critical for running in GitHub Actions where the Chrome sandbox is not available. Without these flags, the scanner will fail with "No usable sandbox" errors.

## Documentation

- **[ACCESSIBILITY.md](./ACCESSIBILITY.md)** - Accessibility standards, WCAG 2.2 AA requirements, and development best practices
- **[AGENTS.md](./AGENTS.md)** - AI agent instructions for Copilot, Cursor, Claude, and other coding assistants
- **[TIMEOUT-CONFIG.md](./TIMEOUT-CONFIG.md)** - Timeout configuration and tuning guide for scan optimization
- **[.kittify/AGENTS.md](.kittify/AGENTS.md)** - Spec Kitty project management rules

## Next workflow steps

1. ✅ ~~Review WP01~~
2. ✅ ~~Implement WP02~~
3. Implement WP03 (Dual-Scanner Execution Engine)
4. Continue through reporting, hardening, and end-to-end validation WPs
