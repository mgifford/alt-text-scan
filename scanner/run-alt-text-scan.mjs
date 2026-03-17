/**
 * Alt Text Scan Orchestrator
 *
 * Reads a GitHub issue event JSON file, discovers URLs (sitemap or crawl when
 * the title contains a domain URL and the body is blank), scans those pages for
 * images and alt text quality, and writes structured report files.
 *
 * Usage:
 *   node scanner/run-alt-text-scan.mjs <issue-event.json> <output-dir>
 *
 * stdout: meta.json (JSON) — consumed by the GitHub Actions workflow
 * stderr: all progress / diagnostic messages
 * Output files written to <output-dir>:
 *   alt-text-report.json   — full structured results
 *   alt-text-report.csv    — flat table, one row per image
 *   alt-text-report.html   — human-readable summary
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseScanIssue } from "./parse-issue.mjs";
import { validateTargets } from "./validate-targets.mjs";
import { discoverUrls } from "./discover-urls.mjs";
import { scanAltText } from "./scan-alt-text.mjs";

// Maximum pages to discover / scan
const MAX_DISCOVER = parseInt(process.env.MAX_DISCOVER_URLS || "100", 10);
const PAGE_LOAD_DELAY = parseInt(process.env.PAGE_LOAD_DELAY_MS || "500", 10);
const NAV_TIMEOUT = parseInt(process.env.NAV_TIMEOUT_MS || "30000", 10);
const TOTAL_TIMEOUT = parseInt(process.env.TOTAL_SCAN_TIMEOUT_MS || "3000000", 10);

/**
 * Convert scan results to a CSV string.
 * @param {object[]} uniqueImageList
 * @returns {string}
 */
function toCsv(uniqueImageList) {
  const headers = [
    "Image URL",
    "Alt Text",
    "Status",
    "Issues",
    "Title",
    "ARIA Label",
    "ARIA Describedby",
    "Longdesc",
    "Role",
    "Visible",
    "Width",
    "Height",
    "Found On Pages"
  ];

  const escape = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
  };

  const rows = [headers.join(",")];
  for (const img of uniqueImageList) {
    rows.push(
      [
        escape(img.src),
        escape(img.alt),
        escape(img.status),
        escape((img.issues ?? []).join("; ")),
        escape(img.title),
        escape(img.ariaLabel),
        escape(img.ariaDescribedby),
        escape(img.longdesc),
        escape(img.role),
        escape(img.isVisible),
        escape(img.width),
        escape(img.height),
        escape((img.pages ?? []).join("; "))
      ].join(",")
    );
  }

  return rows.join("\n");
}

/**
 * Generate an HTML summary report.
 * @param {object} scanResult
 * @param {object} meta
 * @returns {string}
 */
function toHtml(scanResult, meta) {
  const { statusCounts, urlsScanned, totalImages, uniqueImages, imagesWithIssues } = scanResult;
  const domainDisplay = meta.scanDomain || meta.scanTitle || "Unknown domain";

  const statusColors = {
    MISSING: "#d32f2f",
    SUSPICIOUS: "#f57c00",
    FILENAME: "#f9a825",
    DECORATIVE: "#1565c0",
    GOOD: "#2e7d32",
    TOO_SHORT: "#f57c00",
    TOO_LONG: "#f57c00"
  };

  const statusLabels = {
    MISSING: "Missing Alt",
    SUSPICIOUS: "Suspicious",
    FILENAME: "Filename as Alt",
    DECORATIVE: "Decorative (empty alt)",
    GOOD: "Good",
    TOO_SHORT: "Too Short",
    TOO_LONG: "Too Long"
  };

  const countRows = Object.entries(statusCounts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => {
      const color = statusColors[status] || "#555";
      const label = statusLabels[status] || status;
      return `<tr><td><span style="color:${color};font-weight:bold">${label}</span></td><td>${count}</td></tr>`;
    })
    .join("\n");

  const issueRows = scanResult.uniqueImageList
    .filter((img) => img.issues && img.issues.length > 0)
    .map((img) => {
      const color = statusColors[img.status] || "#555";
      const altDisplay = img.alt === null ? '<em style="color:#999">missing</em>'
        : img.alt === "" ? '<em style="color:#999">empty (decorative)</em>'
        : `<code>${img.alt.replace(/</g, "&lt;")}</code>`;
      const issues = img.issues.map((i) => `<li>${i.replace(/</g, "&lt;")}</li>`).join("");
      const pages = (img.pages || []).slice(0, 3)
        .map((p) => `<a href="${p}" target="_blank" rel="noopener">${p.replace(/</g, "&lt;")}</a>`)
        .join("<br>");
      return `
        <tr>
          <td><a href="${img.src.replace(/"/g, "&quot;")}" target="_blank" rel="noopener">${
            img.src.length > 60 ? img.src.slice(0, 60) + "…" : img.src
          }</a></td>
          <td>${altDisplay}</td>
          <td><span style="color:${color};font-weight:bold">${statusLabels[img.status] || img.status}</span></td>
          <td><ul style="margin:0;padding-left:1.2em">${issues}</ul></td>
          <td style="font-size:0.85em">${pages}</td>
        </tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Alt Text Scan – ${domainDisplay.replace(/</g, "&lt;")}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    h1 { font-size: 1.5rem; }
    .summary { display: flex; gap: 1.5rem; flex-wrap: wrap; margin: 1rem 0; }
    .stat { background: #f5f5f5; border-radius: 6px; padding: 0.75rem 1.25rem; }
    .stat strong { display: block; font-size: 1.8rem; }
    table { border-collapse: collapse; width: 100%; margin-top: 1.5rem; }
    th { background: #333; color: #fff; text-align: left; padding: 0.5rem 0.75rem; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #ddd; vertical-align: top; }
    tr:hover td { background: #fafafa; }
    code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Alt Text Scan Report</h1>
  <p><strong>Domain:</strong> ${domainDisplay.replace(/</g, "&lt;")} &nbsp;|&nbsp;
     <strong>Scanned:</strong> ${new Date(scanResult.scannedAt).toLocaleString()} &nbsp;|&nbsp;
     <strong>Discovery method:</strong> ${meta.discoveryMethod || "explicit URLs"}</p>

  <div class="summary">
    <div class="stat"><strong>${urlsScanned}</strong> Pages scanned</div>
    <div class="stat"><strong>${totalImages}</strong> Images found</div>
    <div class="stat"><strong>${uniqueImages}</strong> Unique images</div>
    <div class="stat"><strong style="color:${imagesWithIssues > 0 ? "#d32f2f" : "#2e7d32"}">${imagesWithIssues}</strong> Images with issues</div>
  </div>

  <h2>Status breakdown</h2>
  <table>
    <thead><tr><th>Status</th><th>Count</th></tr></thead>
    <tbody>${countRows}</tbody>
  </table>

  <h2>Images with issues</h2>
  ${issueRows
    ? `<table>
    <thead><tr><th>Image</th><th>Alt Text</th><th>Status</th><th>Issues</th><th>Found on</th></tr></thead>
    <tbody>${issueRows}</tbody>
  </table>`
    : "<p>No issues found! 🎉</p>"}
</body>
</html>`;
}

async function main() {
  const issueEventPath = process.argv[2];
  const outputDir = process.argv[3] || ".scan-output";

  if (!issueEventPath) {
    console.error("Usage: node scanner/run-alt-text-scan.mjs <issue-event.json> [output-dir]");
    process.exitCode = 1;
    return;
  }

  mkdirSync(outputDir, { recursive: true });

  const issueEvent = JSON.parse(readFileSync(issueEventPath, "utf8"));
  const parsed = parseScanIssue(issueEvent);

  let urlsToScan = [];
  let discoveryMethod = "explicit";
  let discoveredTotal = 0;
  let scanDomain = parsed.scanDomain || null;

  if (parsed.scanDomain) {
    // Domain scan mode — discover URLs from sitemap or crawl
    console.error(`[run-alt-text-scan] Domain scan mode: ${parsed.scanDomain}`);
    const discovery = await discoverUrls(parsed.scanDomain, MAX_DISCOVER);
    urlsToScan = discovery.urls;
    discoveryMethod = discovery.method;
    discoveredTotal = discovery.total;
    console.error(
      `[run-alt-text-scan] Discovered ${urlsToScan.length} URLs via ${discoveryMethod}`
    );
  } else if (parsed.value && parsed.value.requestedUrls.length > 0) {
    // Explicit URL list from issue body
    const { accepted, rejected } = validateTargets(parsed.value.requestedUrls);
    urlsToScan = accepted.map((r) => r.normalizedUrl);
    discoveredTotal = urlsToScan.length;

    if (rejected.length > 0) {
      console.error(
        `[run-alt-text-scan] Rejected ${rejected.length} URLs: ${rejected
          .map((r) => `${r.submittedUrl} (${r.reason})`)
          .join(", ")}`
      );
    }
  } else {
    console.error("[run-alt-text-scan] No URLs to scan — issue has no body URLs and no domain URL in title");
    const metaError = {
      ok: false,
      errors: parsed.errors,
      scanTitle: parsed.value?.scanTitle ?? "",
      urlsScanned: 0,
      scannedAt: new Date().toISOString()
    };
    process.stdout.write(JSON.stringify(metaError));
    process.exitCode = 1;
    return;
  }

  if (urlsToScan.length === 0) {
    console.error("[run-alt-text-scan] URL discovery returned 0 URLs");
    const metaEmpty = {
      ok: false,
      errors: ["No URLs discovered"],
      scanTitle: parsed.value?.scanTitle ?? scanDomain ?? "",
      urlsScanned: 0,
      scannedAt: new Date().toISOString()
    };
    process.stdout.write(JSON.stringify(metaEmpty));
    process.exitCode = 1;
    return;
  }

  console.error(`[run-alt-text-scan] Scanning ${urlsToScan.length} URLs for alt text...`);

  const scanResult = await scanAltText(urlsToScan, {
    pageLoadDelay: PAGE_LOAD_DELAY,
    navTimeout: NAV_TIMEOUT,
    totalTimeout: TOTAL_TIMEOUT
  });

  const meta = {
    ok: true,
    issueNumber: issueEvent.issue?.number,
    issueUrl: issueEvent.issue?.html_url,
    scanTitle: parsed.value?.scanTitle ?? scanDomain ?? "",
    scanDomain,
    discoveryMethod,
    discoveredTotal,
    urlsRequested: urlsToScan.length,
    urlsScanned: scanResult.urlsScanned,
    totalImages: scanResult.totalImages,
    uniqueImages: scanResult.uniqueImages,
    imagesWithIssues: scanResult.imagesWithIssues,
    statusCounts: scanResult.statusCounts,
    scannedAt: scanResult.scannedAt
  };

  // Write report files
  const reportData = { meta, ...scanResult };
  writeFileSync(join(outputDir, "alt-text-report.json"), JSON.stringify(reportData, null, 2), "utf8");
  writeFileSync(join(outputDir, "alt-text-report.csv"), toCsv(scanResult.uniqueImageList), "utf8");
  writeFileSync(join(outputDir, "alt-text-report.html"), toHtml(scanResult, meta), "utf8");

  console.error(
    `[run-alt-text-scan] Done. ${scanResult.urlsScanned} pages, ` +
    `${scanResult.totalImages} images, ${scanResult.imagesWithIssues} with issues.`
  );

  // Output meta JSON to stdout for workflow consumption
  process.stdout.write(JSON.stringify(meta));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[run-alt-text-scan] Fatal error:", err);
    process.exitCode = 1;
  });
}
