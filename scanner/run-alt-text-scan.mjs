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

const STATUS_PRIORITY = {
  MISSING: 0,
  FILENAME: 1,
  SUSPICIOUS: 2,
  TOO_SHORT: 3,
  TOO_LONG: 4,
  DECORATIVE: 5,
  GOOD: 6
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
 * Render the "Alt Variants" cell for the HTML image inventory table.
 *
 * - 0 variants → "(none)"
 * - 1 variant  → green "✓ Consistent" tick (same alt text found every time; no
 *                need to repeat the value already shown in the "Alt Text" column)
 * - 2+ variants → each distinct value listed with its occurrence count, which
 *                 signals that the same image has different alt text on different
 *                 pages and may need review
 *
 * @param {Array<{value: string|null, count: number}>} variants
 * @returns {string} HTML string safe to embed directly in a <td>
 */
export function renderAltVariantsHtml(variants) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return '<em style="color:#999">none</em>';
  }
  if (variants.length === 1) {
    const n = variants[0].count;
    const times = n === 1 ? "1 occurrence" : `${n} occurrences`;
    return `<span style="color:#2e7d32" title="The same alt text was found on all ${times} of this image"><span aria-hidden="true">✓</span> Consistent</span>`;
  }
  return variants
    .map((variant) => {
      const label = escapeHtml(renderVariantLabel(variant.value));
      const n = variant.count;
      const countLabel = `${n} occurrence${n !== 1 ? "s" : ""}`;
      return `${label} <span style="color:#888"><span aria-hidden="true">×${n}</span><span class="visually-hidden"> (${countLabel})</span></span>`;
    })
    .join("<br>");
}

/**
 * Render the "Alt Variants" value for plain-text / Markdown output.
 *
 * - 0 variants → ""
 * - 1 variant  → "consistent"
 * - 2+ variants → "value1 (×N); value2 (×M); …"
 *
 * @param {Array<{value: string|null, count: number}>} variants
 * @returns {string}
 */
export function renderAltVariantsText(variants) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return "";
  }
  if (variants.length === 1) {
    return "consistent";
  }
  return variants
    .map((variant) => `${renderVariantLabel(variant.value)} (×${variant.count})`)
    .join("; ");
}

function renderPreviewLabel(img) {
  if (img.alt && img.alt !== "") {
    return img.alt;
  }

  if (img.title && img.title !== "") {
    return img.title;
  }

  return img.src;
}

/**
 * Truncate a URL for display, preserving the start and the filename.
 * For long URLs, shows "https://start… /filename.ext" with the tail after a mid-ellipsis.
 * @param {string} src - Full URL
 * @param {number} maxLength - Approximate maximum character length (default 60)
 * @returns {string}
 */
export function truncateUrl(src, maxLength = 60) {
  if (src.length <= maxLength) return src;

  const lastSlash = src.lastIndexOf("/");
  const tail = lastSlash >= 0 ? src.slice(lastSlash) : "";
  const sep = " \u2026 "; // " … " — 3 chars (space + U+2026 + space)
  const startLen = maxLength - sep.length - tail.length;

  // Require at least 10 characters for the start so the truncated form is
  // still recognisably the original URL (e.g. shows "https://host…").
  if (startLen < 10 || tail.length <= 1) {
    return src.slice(0, maxLength) + "\u2026";
  }

  return src.slice(0, startLen) + sep + tail;
}

/**
 * Render a table cell for an image URL, with a mid-truncated display value,
 * a native title attribute, and a CSS tooltip that breaks out of the cell
 * bounds on hover/focus without causing the table to reflow.
 * @param {string} src
 * @returns {string} HTML <td> element string
 */
function renderUrlCell(src) {
  const escapedSrc = src.replace(/"/g, "&quot;");
  const truncated = truncateUrl(src);
  const escaped = escapeHtml(truncated);

  if (truncated === src) {
    return `<td class="url-cell"><a href="${escapedSrc}" target="_blank" rel="noopener">${escaped}</a></td>`;
  }

  const fullEscaped = escapeHtml(src);
  return `<td class="url-cell"><a href="${escapedSrc}" target="_blank" rel="noopener" title="${fullEscaped}">${escaped}</a><span class="url-tooltip" aria-hidden="true">${fullEscaped}</span></td>`;
}

function renderThumbnailButton(img) {
  const width = Number(img.width) > 0 ? Number(img.width) : "";
  const height = Number(img.height) > 0 ? Number(img.height) : "";
  const previewLabel = renderPreviewLabel(img);

  return `<button type="button" class="thumbnail-trigger" data-preview-src="${escapeHtml(img.src)}" data-preview-alt="${escapeHtml(img.alt ?? "")}" data-preview-label="${escapeHtml(previewLabel)}" data-preview-width="${width}" data-preview-height="${height}" aria-haspopup="dialog" aria-controls="image-preview-dialog" aria-label="Preview image: ${escapeHtml(previewLabel)}"><img src="${escapeHtml(img.src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="thumbnail-trigger__image"><span class="thumbnail-trigger__text">Preview</span></button>`;
}

export function sortUniqueImageList(uniqueImageList) {
  return [...(uniqueImageList || [])].sort((left, right) => {
    const leftHasIssues = Array.isArray(left.issues) && left.issues.length > 0 ? 0 : 1;
    const rightHasIssues = Array.isArray(right.issues) && right.issues.length > 0 ? 0 : 1;

    if (leftHasIssues !== rightHasIssues) {
      return leftHasIssues - rightHasIssues;
    }

    const leftPriority = STATUS_PRIORITY[left.status] ?? 99;
    const rightPriority = STATUS_PRIORITY[right.status] ?? 99;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const leftPages = Array.isArray(left.pages) ? left.pages.length : 0;
    const rightPages = Array.isArray(right.pages) ? right.pages.length : 0;
    if (rightPages !== leftPages) {
      return rightPages - leftPages;
    }

    const leftOccurrences = Number(left.occurrences || 0);
    const rightOccurrences = Number(right.occurrences || 0);
    if (rightOccurrences !== leftOccurrences) {
      return rightOccurrences - leftOccurrences;
    }

    return String(left.src || "").localeCompare(String(right.src || ""));
  });
}

/**
 * Convert scan results to a CSV string.
 * @param {object[]} uniqueImageList
 * @returns {string}
 */
export function toCsv(uniqueImageList) {
  const sortedUniqueImages = sortUniqueImageList(uniqueImageList);
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
  for (const img of sortedUniqueImages) {
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
export function toHtml(scanResult, meta) {
  const { statusCounts, urlsScanned, totalImages, uniqueImages, imagesWithIssues } = scanResult;
  const domainDisplay = meta.scanDomain || meta.scanTitle || "Unknown domain";
  const sortedUniqueImages = sortUniqueImageList(scanResult.uniqueImageList);
  const decorativeImages = sortedUniqueImages.filter((img) => img.status === "DECORATIVE");
  const nonDecorativeImages = sortedUniqueImages.filter((img) => img.status !== "DECORATIVE");

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

  const issueRows = sortedUniqueImages
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
          ${renderUrlCell(img.src)}
          <td class="thumbnail-column" hidden>${renderThumbnailButton(img)}</td>
          <td>${altDisplay}</td>
          <td><span style="color:${color};font-weight:bold">${STATUS_LABELS[img.status] || img.status}</span></td>
          <td><ul style="margin:0;padding-left:1.2em">${issues}</ul></td>
          <td style="font-size:0.85em">${pages}</td>
        </tr>`;
    })
    .join("\n");

  const decorativeRows = decorativeImages
    .map((img) => {
      const pages = (img.pages || []).slice(0, 2)
        .map((p) => `<a href="${p}" target="_blank" rel="noopener">${escapeHtml(p)}</a>`)
        .join("<br>");
      return `
        <tr>
          ${renderUrlCell(img.src)}
          <td class="thumbnail-column-decorative">${renderThumbnailButton(img)}</td>
          <td><span style="color:#1565c0;font-weight:bold">Decorative (empty alt)</span></td>
          <td>${img.role ? `<code>${escapeHtml(img.role)}</code>` : '<em style="color:#999">none</em>'}</td>
          <td>${img.ariaLabel ? `<code>${escapeHtml(img.ariaLabel)}</code>` : '<em style="color:#999">none</em>'}</td>
          <td>${(img.pages || []).length}${pages ? `<div style="font-size:0.8em;margin-top:0.35rem">${pages}</div>` : ""}</td>
        </tr>`;
    })
    .join("\n");

  const inventoryRows = nonDecorativeImages
    .map((img) => {
      const color = statusColors[img.status] || "#555";
      const altDisplay = img.alt === null ? '<em style="color:#999">missing</em>'
        : img.alt === "" ? '<em style="color:#999">empty (decorative)</em>'
        : `<code>${escapeHtml(img.alt)}</code>`;
      const altVariantsHtml = renderAltVariantsHtml(img.altVariants);
      const pages = (img.pages || []).slice(0, 2)
        .map((p) => `<a href="${p}" target="_blank" rel="noopener">${escapeHtml(p)}</a>`)
        .join("<br>");
      return `
        <tr>
          ${renderUrlCell(img.src)}
          <td class="thumbnail-column" hidden>${renderThumbnailButton(img)}</td>
          <td><span style="color:${color};font-weight:bold">${STATUS_LABELS[img.status] || img.status}</span></td>
          <td>${altDisplay}</td>
          <td style="font-size:0.85em">${altVariantsHtml}</td>
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
    .report-controls { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin: 1rem 0; }
    .toggle-thumbnails { border: 1px solid #333; background: #fff; color: #222; border-radius: 999px; padding: 0.55rem 0.95rem; font: inherit; cursor: pointer; }
    .toggle-thumbnails[aria-pressed="true"] { background: #222; color: #fff; }
    table { border-collapse: collapse; width: 100%; margin-top: 1.5rem; }
    th { background: #333; color: #fff; text-align: left; padding: 0.5rem 0.75rem; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #ddd; vertical-align: top; }
    tr:hover td { background: #fafafa; }
    code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
    .thumbnail-column { width: 8.5rem; }
    .thumbnail-column-decorative { width: 8.5rem; }
    .review-callout { background: #e8f4fd; border-left: 4px solid #1565c0; padding: 0.75rem 1rem; margin: 1rem 0; font-size: 0.95em; border-radius: 0 6px 6px 0; }
    .thumbnail-trigger { display: inline-flex; flex-direction: column; align-items: center; gap: 0.35rem; width: 7rem; padding: 0.45rem; border: 1px solid #ccc; border-radius: 8px; background: #fff; cursor: pointer; }
    .thumbnail-trigger:hover, .thumbnail-trigger:focus-visible { border-color: #333; box-shadow: 0 0 0 3px rgba(33, 33, 33, 0.15); outline: none; }
    .thumbnail-trigger__image { display: block; width: 100%; height: 4.5rem; object-fit: contain; background: #f5f5f5; border-radius: 4px; }
    .thumbnail-trigger__text { font-size: 0.8rem; color: #444; }
    .url-cell { position: relative; max-width: 20rem; }
    .url-tooltip { display: none; position: absolute; z-index: 10; left: 0; top: 100%; margin-top: 0.2rem; background: #333; color: #fff; padding: 0.4rem 0.6rem; border-radius: 4px; font-size: 0.8rem; max-width: 44rem; word-break: break-all; white-space: normal; pointer-events: none; box-shadow: 0 2px 8px rgba(0,0,0,0.35); }
    .url-cell:hover .url-tooltip, .url-cell:focus-within .url-tooltip { display: block; }
    dialog::backdrop { background: rgba(17, 24, 39, 0.72); }
    .preview-dialog { border: none; border-radius: 12px; padding: 0; width: min(92vw, 960px); max-height: 90vh; overflow: hidden; }
    .preview-dialog__inner { display: grid; gap: 0.75rem; padding: 1rem; background: #fff; }
    .preview-dialog__header { display: flex; justify-content: space-between; gap: 1rem; align-items: start; }
    .preview-dialog__title { margin: 0; font-size: 1.1rem; }
    .preview-dialog__close { border: 1px solid #333; background: #fff; color: #222; border-radius: 999px; padding: 0.45rem 0.8rem; font: inherit; cursor: pointer; }
    .preview-dialog__figure { margin: 0; display: grid; gap: 0.5rem; justify-items: center; }
    .preview-dialog__image { display: block; max-width: min(88vw, 100%); max-height: 70vh; width: auto; height: auto; background: #f5f5f5; }
    .preview-dialog__caption { font-size: 0.9rem; color: #444; word-break: break-word; }
    .preview-dialog__actions { margin: 0; font-size: 0.9rem; }
    .preview-dialog__view-full { color: #1565c0; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    @media (max-width: 720px) {
      .summary { gap: 0.75rem; }
      .stat { flex: 1 1 9rem; }
      .thumbnail-trigger { width: 5.75rem; }
      .thumbnail-trigger__image { height: 3.75rem; }
    }
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
  <div class="report-controls">
    <button type="button" id="toggle-thumbnails" class="toggle-thumbnails" aria-pressed="false">Show thumbnails for images with alt text</button>
    <span id="thumbnail-help">Thumbnails for images with alt text are hidden by default. Decorative images always show thumbnails for visual review.</span>
  </div>
  <p>Showing ${nonDecorativeImages.length} image${nonDecorativeImages.length !== 1 ? "s" : ""} with alt text, with flagged items listed first. Use the CSV for a complete export.</p>
  <table>
    <thead><tr>
      <th>Image</th>
      <th class="thumbnail-column" hidden>Thumbnail</th>
      <th>Status</th>
      <th>Alt Text</th>
      <th title="All distinct alt text values found for this image across all scanned pages, with how many times each value appeared. A Consistent result means the same alt text was used everywhere. Multiple entries mean the same image has different alt text on different pages and may need review.">Alt Variants</th>
      <th>Title</th>
      <th>ARIA Label</th>
      <th>Pages</th>
    </tr></thead>
    <tbody>${inventoryRows}</tbody>
  </table>

  ${decorativeImages.length > 0 ? `
  <h2>Decorative images — please review</h2>
  <div class="review-callout" role="note">
    <strong>Review recommended:</strong> These ${decorativeImages.length} image${decorativeImages.length !== 1 ? "s" : ""} have empty alt text and are marked as decorative.
    Please look at each thumbnail: does it convey meaningful information that sighted users would benefit from knowing?
    If so, it needs descriptive alt text. The <strong>Role</strong> and <strong>ARIA Label</strong> columns show any semantic markup that was applied.
  </div>
  <table>
    <thead><tr><th>Image</th><th class="thumbnail-column-decorative">Thumbnail</th><th>Status</th><th>Role</th><th>ARIA Label</th><th>Pages</th></tr></thead>
    <tbody>${decorativeRows}</tbody>
  </table>` : ''}

  <h2>Images with issues</h2>
  ${issueRows
    ? `<table>
    <thead><tr><th>Image</th><th class="thumbnail-column" hidden>Thumbnail</th><th>Alt Text</th><th>Status</th><th>Issues</th><th>Found on</th></tr></thead>
    <tbody>${issueRows}</tbody>
  </table>`
    : "<p>No issues found! 🎉</p>"}

  <dialog id="image-preview-dialog" class="preview-dialog" aria-labelledby="image-preview-title">
    <div class="preview-dialog__inner">
      <div class="preview-dialog__header">
        <h2 id="image-preview-title" class="preview-dialog__title">Image preview</h2>
        <form method="dialog">
          <button type="submit" class="preview-dialog__close" id="close-image-preview">Close</button>
        </form>
      </div>
      <figure class="preview-dialog__figure">
        <img id="image-preview-image" class="preview-dialog__image" alt="">
        <figcaption id="image-preview-caption" class="preview-dialog__caption"></figcaption>
      </figure>
      <p class="preview-dialog__actions">
        <a id="image-preview-view-full" href="#" target="_blank" rel="noopener" class="preview-dialog__view-full">View full image ↗</a>
      </p>
    </div>
  </dialog>

  <script>
    (() => {
      const toggleButton = document.getElementById("toggle-thumbnails");
      const thumbnailColumns = Array.from(document.querySelectorAll(".thumbnail-column"));
      const dialog = document.getElementById("image-preview-dialog");
      const previewImage = document.getElementById("image-preview-image");
      const previewCaption = document.getElementById("image-preview-caption");
      const previewTitle = document.getElementById("image-preview-title");
      const closeButton = document.getElementById("close-image-preview");
      const viewFullLink = document.getElementById("image-preview-view-full");
      const previewTriggers = Array.from(document.querySelectorAll(".thumbnail-trigger"));
      let lastTrigger = null;
      let lastOpenMode = "click";
      let skipNextFocusTrigger = null;

      if (toggleButton) {
        toggleButton.addEventListener("click", () => {
          const shouldShow = toggleButton.getAttribute("aria-pressed") !== "true";
          toggleButton.setAttribute("aria-pressed", String(shouldShow));
          toggleButton.textContent = shouldShow ? "Hide thumbnails for images with alt text" : "Show thumbnails for images with alt text";
          thumbnailColumns.forEach((column) => {
            column.hidden = !shouldShow;
          });
        });
      }

      if (!(dialog instanceof HTMLDialogElement) || !previewImage || !previewCaption || !previewTitle) {
        return;
      }

      const setPreviewContent = (trigger) => {
        const src = trigger.dataset.previewSrc || "";
        const alt = trigger.dataset.previewAlt || "";
        const label = trigger.dataset.previewLabel || src;
        const width = Number(trigger.dataset.previewWidth || 0);
        const height = Number(trigger.dataset.previewHeight || 0);
        const availableWidth = Math.max(window.innerWidth - 80, 320);

        previewImage.src = src;
        previewImage.alt = alt;
        previewImage.style.width = width > 0 ? String(Math.min(width, availableWidth)) + "px" : "auto";
        previewImage.style.height = "auto";
        previewImage.style.maxWidth = "100%";
        previewTitle.textContent = label;

        if (viewFullLink) {
          viewFullLink.href = src;
        }

        const altInfo = alt ? "Alt text: " + alt : "Alt text: none";
        const sizeInfo = width > 0 && height > 0 ? "Displayed size: " + width + " \u00d7 " + height + "px" : "Displayed size: not captured";
        previewCaption.textContent = [altInfo, sizeInfo, src].join(" | ");

        previewImage.onload = function() {
          const nw = this.naturalWidth;
          const nh = this.naturalHeight;
          const naturalInfo = nw > 0 && nh > 0 ? "Natural size: " + nw + " \u00d7 " + nh + "px" : "";
          previewCaption.textContent = [altInfo, sizeInfo, naturalInfo, src].filter(Boolean).join(" | ");
        };
      };

      const openPreview = (trigger, mode) => {
        lastTrigger = trigger;
        lastOpenMode = mode;
        setPreviewContent(trigger);
        if (!dialog.open) {
          dialog.showModal();
        }
        if (mode === "click") {
          closeButton.focus();
        }
      };

      previewTriggers.forEach((trigger) => {
        trigger.addEventListener("click", (event) => {
          event.preventDefault();
          openPreview(trigger, "click");
        });

        trigger.addEventListener("focus", () => {
          if (skipNextFocusTrigger === trigger) {
            skipNextFocusTrigger = null;
            return;
          }
          openPreview(trigger, "focus");
        });
      });

      dialog.addEventListener("click", (event) => {
        const bounds = dialog.getBoundingClientRect();
        const isOutside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
        if (isOutside) {
          dialog.close();
        }
      });

      dialog.addEventListener("close", () => {
        previewImage.removeAttribute("src");
        if (lastOpenMode === "click" && lastTrigger && document.contains(lastTrigger)) {
          skipNextFocusTrigger = lastTrigger;
          lastTrigger.focus();
        }
      });
    })();
  </script>
</body>
</html>`;
}

export function toMarkdown(scanResult, meta) {
  const domainDisplay = meta.scanDomain || meta.scanTitle || "Unknown domain";
  const sortedUniqueImages = sortUniqueImageList(scanResult.uniqueImageList);
  const statusLines = Object.entries(scanResult.statusCounts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `- ${STATUS_LABELS[status] || status}: ${count}`)
    .join("\n");

  const issueRows = sortedUniqueImages
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

  const inventoryRows = sortedUniqueImages
    .map((img) => {
      const altDisplay = img.alt === null
        ? "(missing)"
        : img.alt === ""
          ? "(empty decorative)"
          : escapeMarkdown(img.alt);
      const altVariants = escapeMarkdown(renderAltVariantsText(img.altVariants));
      return `| ${escapeMarkdown(img.src)} | ${STATUS_LABELS[img.status] || img.status} | ${altDisplay} | ${altVariants} | ${escapeMarkdown(img.title || "")} | ${escapeMarkdown(img.ariaLabel || "")} | ${(img.pages || []).length} |`;
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
    const maxPages = parsed.value?.maxPages ?? MAX_DISCOVER;
    console.error(`[run-alt-text-scan] Domain scan mode: ${parsed.scanDomain} (max pages: ${maxPages})`);
    let discovery;
    try {
      discovery = await discoverUrls(parsed.scanDomain, maxPages);
    } catch (err) {
      console.error(`[run-alt-text-scan] URL discovery failed: ${err.message || err}`);
      const metaDiscoveryError = {
        ok: false,
        errors: [`URL discovery failed: ${err.message || err}`],
        reportType: "alt-text",
        scanTitle: parsed.value?.scanTitle ?? scanDomain ?? "",
        acceptedCount: 0,
        rejectedCount: 0,
        scannedCount: 0,
        urlsScanned: 0,
        scannedAt: new Date().toISOString()
      };
      process.stdout.write(JSON.stringify(metaDiscoveryError));
      process.exitCode = 1;
      return;
    }
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
