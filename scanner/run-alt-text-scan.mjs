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
 *   report.json / alt-text-report.json  — full structured results
 *   report.csv / alt-text-report.csv    — flat table, one row per image
 *   report.html / alt-text-report.html  — human-readable summary
 *   report.md / alt-text-report.md      — markdown summary
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

const STATUS_LABELS = {
  MISSING: "Missing Alt",
  SUSPICIOUS: "Suspicious",
  FILENAME: "Filename as Alt",
  DECORATIVE: "Decorative (empty alt)",
  GOOD: "Good",
  TOO_SHORT: "Too Short",
  TOO_LONG: "Too Long"
};

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeMarkdown(text) {
  return String(text ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .trim();
}

function renderVariantLabel(value) {
  if (value === null || value === undefined) {
    return "(missing)";
  }
  if (value === "") {
    return "(empty)";
  }
  return String(value);
}

function formatVariantSummary(variants) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return "";
  }

  return variants
    .map((variant) => `${renderVariantLabel(variant.value)} [${variant.count}]`)
    .join(" | ");
}

/**
 * Convert scan results to a CSV string.
 * @param {object[]} uniqueImageList
 * @returns {string}
 */
function toCsv(uniqueImageList) {
  const headers = [
    "Image URL",
    "Alt Text",
    "Alt Text Variants",
    "Status",
    "Issues",
    "Title",
    "Title Variants",
    "ARIA Label",
    "ARIA Label Variants",
    "ARIA Describedby",
    "ARIA Describedby Variants",
    "Longdesc",
    "Role",
    "Visible",
    "Width",
    "Height",
    "Occurrences",
    "Page Count",
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
        escape(formatVariantSummary(img.altVariants)),
        escape(img.status),
        escape((img.issues ?? []).join("; ")),
        escape(img.title),
        escape(formatVariantSummary(img.titleVariants)),
        escape(img.ariaLabel),
        escape(formatVariantSummary(img.ariaLabelVariants)),
        escape(img.ariaDescribedby),
        escape(formatVariantSummary(img.ariaDescribedbyVariants)),
        escape(img.longdesc),
        escape(img.role),
        escape(img.isVisible),
        escape(img.width),
        escape(img.height),
        escape(img.occurrences ?? ""),
        escape((img.pages ?? []).length),
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

  const countRows = Object.entries(statusCounts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => {
      const color = statusColors[status] || "#555";
      const label = STATUS_LABELS[status] || status;
      return `<tr><td><span style="color:${color};font-weight:bold">${label}</span></td><td>${count}</td></tr>`;
    })
    .join("\n");

  const issueRows = scanResult.uniqueImageList
    .filter((img) => img.issues && img.issues.length > 0)
    .map((img) => {
      const color = statusColors[img.status] || "#555";
      const altDisplay = img.alt === null ? '<em style="color:#999">missing</em>'
        : img.alt === "" ? '<em style="color:#999">empty (decorative)</em>'
        : `<code>${escapeHtml(img.alt)}</code>`;
      const issues = img.issues.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
      const pages = (img.pages || []).slice(0, 3)
        .map((p) => `<a href="${p}" target="_blank" rel="noopener">${escapeHtml(p)}</a>`)
        .join("<br>");
      return `
        <tr>
          <td><a href="${img.src.replace(/"/g, "&quot;")}" target="_blank" rel="noopener">${
            img.src.length > 60 ? img.src.slice(0, 60) + "…" : img.src
          }</a></td>
          <td>${altDisplay}</td>
          <td><span style="color:${color};font-weight:bold">${STATUS_LABELS[img.status] || img.status}</span></td>
          <td><ul style="margin:0;padding-left:1.2em">${issues}</ul></td>
          <td style="font-size:0.85em">${pages}</td>
        </tr>`;
    })
    .join("\n");

  const inventoryRows = scanResult.uniqueImageList
    .map((img) => {
      const color = statusColors[img.status] || "#555";
      const altDisplay = img.alt === null ? '<em style="color:#999">missing</em>'
        : img.alt === "" ? '<em style="color:#999">empty (decorative)</em>'
        : `<code>${escapeHtml(img.alt)}</code>`;
      const altVariants = (img.altVariants || [])
        .map((variant) => `${escapeHtml(renderVariantLabel(variant.value))} (${variant.count})`)
        .join("<br>");
      const pages = (img.pages || []).slice(0, 2)
        .map((p) => `<a href="${p}" target="_blank" rel="noopener">${escapeHtml(p)}</a>`)
        .join("<br>");
      return `
        <tr>
          <td><a href="${img.src.replace(/"/g, "&quot;")}" target="_blank" rel="noopener">${
            img.src.length > 60 ? img.src.slice(0, 60) + "…" : img.src
          }</a></td>
          <td><span style="color:${color};font-weight:bold">${STATUS_LABELS[img.status] || img.status}</span></td>
          <td>${altDisplay}</td>
          <td style="font-size:0.85em">${altVariants || '<em style="color:#999">none</em>'}</td>
          <td>${img.title ? `<code>${escapeHtml(img.title)}</code>` : '<em style="color:#999">none</em>'}</td>
          <td>${img.ariaLabel ? `<code>${escapeHtml(img.ariaLabel)}</code>` : '<em style="color:#999">none</em>'}</td>
          <td>${(img.pages || []).length}${pages ? `<div style="font-size:0.8em;margin-top:0.35rem">${pages}</div>` : ""}</td>
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
  <p><a href="report.csv">Download image inventory CSV</a> &nbsp;|&nbsp; <a href="report.json">View full JSON</a></p>

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

  <h2>Unique image inventory</h2>
  <p>One row per unique image URL. Use the CSV for a complete export.</p>
  <table>
    <thead><tr><th>Image</th><th>Status</th><th>Alt Text</th><th>Alt Variants</th><th>Title</th><th>ARIA Label</th><th>Pages</th></tr></thead>
    <tbody>${inventoryRows}</tbody>
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

function toMarkdown(scanResult, meta) {
  const domainDisplay = meta.scanDomain || meta.scanTitle || "Unknown domain";
  const statusLines = Object.entries(scanResult.statusCounts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `- ${STATUS_LABELS[status] || status}: ${count}`)
    .join("\n");

  const issueRows = scanResult.uniqueImageList
    .filter((img) => img.issues && img.issues.length > 0)
    .map((img) => {
      const altDisplay = img.alt === null
        ? "(missing)"
        : img.alt === ""
          ? "(empty decorative)"
          : escapeMarkdown(img.alt);
      const pages = (img.pages || []).slice(0, 3).map((page) => escapeMarkdown(page)).join("; ");
      const issues = (img.issues || []).map((issue) => escapeMarkdown(issue)).join("; ");
      return `| ${escapeMarkdown(img.src)} | ${altDisplay} | ${STATUS_LABELS[img.status] || img.status} | ${issues} | ${pages} |`;
    })
    .join("\n");

  const inventoryRows = scanResult.uniqueImageList
    .map((img) => {
      const altDisplay = img.alt === null
        ? "(missing)"
        : img.alt === ""
          ? "(empty decorative)"
          : escapeMarkdown(img.alt);
      const altVariants = (img.altVariants || [])
        .map((variant) => `${escapeMarkdown(renderVariantLabel(variant.value))} (${variant.count})`)
        .join("; ");
      return `| ${escapeMarkdown(img.src)} | ${STATUS_LABELS[img.status] || img.status} | ${altDisplay} | ${escapeMarkdown(altVariants)} | ${escapeMarkdown(img.title || "")} | ${escapeMarkdown(img.ariaLabel || "")} | ${(img.pages || []).length} |`;
    })
    .join("\n");

  return `# Alt Text Scan Report: ${escapeMarkdown(domainDisplay)}

${meta.issueUrl ? `- Issue: ${meta.issueUrl}\n` : ""}- Scanned at: ${scanResult.scannedAt}
- Discovery method: ${meta.discoveryMethod || "explicit URLs"}
- Pages scanned: ${scanResult.urlsScanned}
- Images found: ${scanResult.totalImages}
- Unique images: ${scanResult.uniqueImages}
- Images with issues: ${scanResult.imagesWithIssues}
- JSON: report.json
- CSV image inventory: report.csv

## Status breakdown

${statusLines || "- No statuses recorded"}

## Images with issues

${issueRows ? `| Image URL | Alt Text | Status | Issues | Found on |\n| --- | --- | --- | --- | --- |\n${issueRows}` : "No issues found."}

## Unique image inventory

${inventoryRows ? `| Image URL | Status | Alt Text | Alt Variants | Title | ARIA Label | Pages |\n| --- | --- | --- | --- | --- | --- | --- |\n${inventoryRows}` : "No images found."}
`;
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
  let requestedCount = 0;
  let rejectedCount = 0;
  let scanDomain = parsed.scanDomain || null;

  if (parsed.scanDomain) {
    // Domain scan mode — discover URLs from sitemap or crawl
    console.error(`[run-alt-text-scan] Domain scan mode: ${parsed.scanDomain}`);
    const discovery = await discoverUrls(parsed.scanDomain, MAX_DISCOVER);
    urlsToScan = discovery.urls;
    discoveryMethod = discovery.method;
    discoveredTotal = discovery.total;
    requestedCount = urlsToScan.length;
    console.error(
      `[run-alt-text-scan] Discovered ${urlsToScan.length} URLs via ${discoveryMethod}`
    );
  } else if (parsed.value && parsed.value.requestedUrls.length > 0) {
    // Explicit URL list from issue body
    const { accepted, rejected } = validateTargets(parsed.value.requestedUrls);
    requestedCount = parsed.value.requestedUrls.length;
    rejectedCount = rejected.length;
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
      reportType: "alt-text",
      scanTitle: parsed.value?.scanTitle ?? "",
      acceptedCount: 0,
      rejectedCount: 0,
      scannedCount: 0,
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
      reportType: "alt-text",
      scanTitle: parsed.value?.scanTitle ?? scanDomain ?? "",
      acceptedCount: 0,
      rejectedCount,
      scannedCount: 0,
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

  const skippedDueToTimeout = Math.max(urlsToScan.length - scanResult.urlsScanned, 0);

  const meta = {
    ok: true,
    reportType: "alt-text",
    issueNumber: issueEvent.issue?.number,
    issueUrl: issueEvent.issue?.html_url,
    scanTitle: parsed.value?.scanTitle ?? scanDomain ?? "",
    scanDomain,
    discoveryMethod,
    discoveredTotal,
    requestedCount,
    acceptedCount: urlsToScan.length,
    rejectedCount,
    scannedCount: scanResult.urlsScanned,
    skippedDueToTimeout,
    urlsRequested: urlsToScan.length,
    urlsScanned: scanResult.urlsScanned,
    totalImages: scanResult.totalImages,
    uniqueImages: scanResult.uniqueImages,
    imagesWithIssues: scanResult.imagesWithIssues,
    statusCounts: scanResult.statusCounts,
    scannedAt: scanResult.scannedAt
  };

  // Write report files
  const reportData = {
    reportType: "alt-text",
    issueNumber: meta.issueNumber,
    issueUrl: meta.issueUrl,
    scanTitle: meta.scanTitle,
    scanDomain: meta.scanDomain,
    discoveryMethod: meta.discoveryMethod,
    discoveredTotal: meta.discoveredTotal,
    requestedCount: meta.requestedCount,
    acceptedCount: meta.acceptedCount,
    rejectedCount: meta.rejectedCount,
    scannedCount: meta.scannedCount,
    skippedDueToTimeout: meta.skippedDueToTimeout,
    urlsRequested: meta.urlsRequested,
    urlsScanned: meta.urlsScanned,
    scannedAt: meta.scannedAt,
    totalImages: meta.totalImages,
    uniqueImages: meta.uniqueImages,
    imagesWithIssues: meta.imagesWithIssues,
    statusCounts: meta.statusCounts,
    urlResults: scanResult.urlResults,
    uniqueImageList: scanResult.uniqueImageList,
    meta
  };
  const reportJson = JSON.stringify(reportData, null, 2);
  const reportCsv = toCsv(scanResult.uniqueImageList);
  const reportHtml = toHtml(scanResult, meta);
  const reportMarkdown = toMarkdown(scanResult, meta);

  for (const [name, content] of [
    ["report.json", reportJson],
    ["report.csv", reportCsv],
    ["report.html", reportHtml],
    ["report.md", reportMarkdown],
    ["alt-text-report.json", reportJson],
    ["alt-text-report.csv", reportCsv],
    ["alt-text-report.html", reportHtml],
    ["alt-text-report.md", reportMarkdown]
  ]) {
    writeFileSync(join(outputDir, name), content, "utf8");
  }

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
