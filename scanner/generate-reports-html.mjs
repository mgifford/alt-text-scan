#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

function getCanonicalRepo() {
  return process.env.GITHUB_REPOSITORY || 'mgifford/alt-text-scan';
}

function normalizeIssueUrl(issueUrl, issueNumber) {
  const canonicalRepo = getCanonicalRepo();
  const [canonicalOwner, canonicalName] = canonicalRepo.split('/');

  if (!issueUrl || typeof issueUrl !== 'string') {
    return `https://github.com/${canonicalRepo}/issues/${issueNumber}`;
  }

  try {
    const parsed = new URL(issueUrl);
    if (parsed.hostname !== 'github.com') {
      return issueUrl;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 3) {
      return issueUrl;
    }

    const [owner, repo, ...rest] = segments;
    if (owner === canonicalOwner && repo === canonicalName) {
      return issueUrl;
    }

    if (!['issues', 'actions'].includes(rest[0])) {
      return issueUrl;
    }

    const normalizedPath = `/${canonicalOwner}/${canonicalName}/${rest.join('/')}`;
    return `${parsed.origin}${normalizedPath}${parsed.search}${parsed.hash}`;
  } catch {
    return `https://github.com/${canonicalRepo}/issues/${issueNumber}`;
  }
}

/**
 * Recursively find all report.json files in the reports directory
 * Reads from both reports/issues/ (issue-triggered scans) and
 * reports/pages/ (GitHub Pages automated scans).
 * @param {string} reportsDir - Path to the reports directory
 * @returns {Array<{path: string, data: object}>} Array of report data with paths
 */
export function findAllReports(reportsDir) {
  const reports = [];
  
  try {
    const issuesDir = join(reportsDir, 'issues');
    const issueDirs = readdirSync(issuesDir);
    
    for (const issueDir of issueDirs) {
      const issuePath = join(issuesDir, issueDir);
      const timestamps = readdirSync(issuePath);
      
      for (const timestamp of timestamps) {
        const reportPath = join(issuePath, timestamp, 'report.json');
        try {
          const data = JSON.parse(readFileSync(reportPath, 'utf8'));
          reports.push({
            path: `reports/issues/${issueDir}/${timestamp}`,
            data
          });
        } catch (err) {
          console.error(`Failed to read ${reportPath}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error(`Failed to read reports/issues directory:`, err.message);
  }

  try {
    const pagesDir = join(reportsDir, 'pages');
    const timestamps = readdirSync(pagesDir);

    for (const timestamp of timestamps) {
      const reportPath = join(pagesDir, timestamp, 'report.json');
      try {
        const data = JSON.parse(readFileSync(reportPath, 'utf8'));
        reports.push({
          path: `reports/pages/${timestamp}`,
          data
        });
      } catch (err) {
        console.error(`Failed to read ${reportPath}:`, err.message);
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Failed to read reports/pages directory:`, err.message);
    }
  }
  
  return reports;
}

/**
 * Sort reports by timestamp, most recent first
 * @param {Array<{path: string, data: object}>} reports
 * @returns {Array<{path: string, data: object}>}
 */
export function sortReportsByTime(reports) {
  return reports.sort((a, b) => {
    const timeA = new Date(a.data.scannedAt).getTime();
    const timeB = new Date(b.data.scannedAt).getTime();
    return timeB - timeA; // Most recent first
  });
}

function isAltTextReport(data) {
  return data?.reportType === 'alt-text' || (data?.statusCounts && typeof data?.totalImages === 'number');
}

function splitReportsByType(reports) {
  const altTextReports = [];
  const legacyReports = [];

  for (const report of reports) {
    if (isAltTextReport(report.data)) {
      altTextReports.push(report);
    } else {
      legacyReports.push(report);
    }
  }

  return { altTextReports, legacyReports };
}

function buildResultsBadges(data) {
  if (data.archivePath) {
    const pages = Number(data.archivePages || 0);
    const images = data.archiveImages == null ? 'n/a' : data.archiveImages;
    const archiveSize = data.archiveSizeLabel || 'pending';

    return [
      `<span class="badge badge-success">${pages} pages</span>`,
      `<span class="badge badge-warning">${images} images</span>`,
      `<span class="badge badge-danger">${archiveSize}</span>`
    ].join(' ');
  }

  if (isAltTextReport(data)) {
    const reviewed = data.uniqueImages ?? data.totalImages ?? 0;
    const flagged = data.imagesWithIssues ?? 0;
    const missing = data.statusCounts?.MISSING ?? 0;

    return [
      `<span class="badge badge-success">${reviewed} reviewed</span>`,
      `<span class="badge badge-danger">${flagged} flagged</span>`,
      `<span class="badge badge-warning">${missing} missing</span>`
    ].join(' ');
  }

  const alfaTotals = data.alfaTotals || { passed: 0, failed: 0, cantTell: 0 };
  const axeTotals = data.axeTotals || { passed: 0, failed: 0, cantTell: 0 };
  const totalPassed = alfaTotals.passed + axeTotals.passed;
  const totalFailed = alfaTotals.failed + axeTotals.failed;
  const totalCantTell = alfaTotals.cantTell + axeTotals.cantTell;

  return [
    `<span class="badge badge-success">${totalPassed} passed</span>`,
    `<span class="badge badge-danger">${totalFailed} failed</span>`,
    `<span class="badge badge-warning">${totalCantTell} can't tell</span>`
  ].join(' ');
}

function buildLinks(path, data) {
  if (data.archivePath) {
    return `<a href="${data.archivePath}">Download ZIP</a>`;
  }

  const links = [
    `<a href="${path}/report.html">HTML</a>`,
    `<a href="${path}/report.md">Markdown</a>`,
    `<a href="${path}/report.csv">CSV</a>`
  ];

  if (!isAltTextReport(data)) {
    links.push(`<a href="${path}/report-overlap.md">Overlap</a>`);
  }

  links.push(`<a href="${path}/report.json">JSON</a>`);

  return links.join('\n            ');
}

/**
 * Generate HTML table rows for reports
 * @param {Array<{path: string, data: object}>} reports
 * @returns {string} HTML table rows
 */
export function generateTableRows(reports) {
  return reports.map(({ path, data }) => {
    const scannedDate = new Date(data.scannedAt);
    const formattedDate = scannedDate.toLocaleString('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    });
    
    const issueUrl = normalizeIssueUrl(data.issueUrl, data.issueNumber);
    const urlLabel = data.acceptedCount != null
      ? `${data.acceptedCount} accepted`
      : `${data.scannedCount ?? data.urlsScanned ?? 0} scanned`;

    return `
        <tr data-issue="${data.issueNumber}" data-title="${escapeHtml(data.scanTitle)}" data-date="${escapeHtml(data.scannedAt)}" data-urls="${data.acceptedCount}">
          <td data-label="Issue"><a href="${issueUrl}">#${data.issueNumber}</a></td>
          <td data-label="Scan Title">${escapeHtml(data.scanTitle)}</td>
          <td class="date" data-label="Scanned At">${formattedDate}</td>
          <td data-label="URLs">${urlLabel}</td>
          <td data-label="Results">
            ${buildResultsBadges(data)}
          </td>
          <td class="links" data-label="Reports">
            ${buildLinks(path, data)}
          </td>
        </tr>`;
  }).join('\n        ');
}

function deriveLegacyOutputFile(outputFile) {
  return join(dirname(outputFile), 'legacy-reports.html');
}

function deriveLegacyArchivePath(reportPath) {
  const relativePath = String(reportPath || '').replace(/^reports\//, '');
  return `reports/archives/legacy/${relativePath}.zip`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 10 || unitIndex === 0 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[unitIndex]}`;
}

export function createLegacyArchives(reports) {
  const { legacyReports } = splitReportsByType(reports);
  const metadata = new Map();

  if (legacyReports.length === 0) {
    return metadata;
  }

  const zipAvailable = spawnSync('zip', ['-v'], { encoding: 'utf8' });
  if (zipAvailable.status !== 0) {
    console.error('zip command not available; legacy archives will not be generated.');
    return metadata;
  }

  for (const report of legacyReports) {
    const reportPath = report.path;
    const archivePath = deriveLegacyArchivePath(reportPath);
    const archiveAbsolutePath = join(process.cwd(), archivePath);
    const archiveDir = dirname(archiveAbsolutePath);
    mkdirSync(archiveDir, { recursive: true });

    if (!existsSync(archiveAbsolutePath)) {
      const zipResult = spawnSync('zip', ['-rq', archiveAbsolutePath, '.'], {
        cwd: reportPath,
        encoding: 'utf8'
      });

      if (zipResult.status !== 0) {
        console.error(`Failed to archive ${reportPath}: ${(zipResult.stderr || zipResult.stdout || '').trim()}`);
        continue;
      }
    }

    const archiveSizeBytes = existsSync(archiveAbsolutePath) ? statSync(archiveAbsolutePath).size : null;
    metadata.set(reportPath, {
      archivePath,
      archiveSizeBytes,
      archiveSizeLabel: archiveSizeBytes == null ? 'pending' : formatBytes(archiveSizeBytes)
    });
  }

  return metadata;
}

/**
 * Escape HTML special characters
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, char => map[char]);
}

/**
 * Generate the complete reports.html page
 * @param {Array<{path: string, data: object}>} reports
 * @returns {string} Complete HTML document
 */
function generateReportsPage({
  reports,
  title,
  subtitle,
  navLinkHref,
  navLinkLabel,
  latestLinkHref,
  latestLinkLabel = 'Latest Report',
  sectionNote = '',
  emptyMessage
}) {
  const tableRows = generateTableRows(reports);
  const latestReportHref = latestLinkHref || (reports.length > 0 ? `${reports[0].path}/report.html` : null);
  const latestReportLink = latestReportHref
    ? `<a href="${latestReportHref}">${latestLinkLabel}</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Alt Text Scan Reports</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    .skip-link {
      position: absolute;
      top: -100%;
      left: 1rem;
      padding: 0.5rem 1rem;
      background: #000;
      color: #fff;
      font-weight: bold;
      text-decoration: none;
      z-index: 9999;
      border-radius: 0 0 4px 4px;
    }

    .skip-link:focus {
      top: 0;
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    :target {
      scroll-margin-top: 1rem;
    }

    h1:focus,
    h2:focus,
    h3:focus {
      outline: 3px solid #005fcc;
      outline-offset: 2px;
      scroll-margin-top: 1rem;
    }

    @media (prefers-reduced-motion: no-preference) {
      .skip-link {
        transition: top 0.1s ease;
      }
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #24292f;
      background-color: #f6f8fa;
      padding: 2rem;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 2rem;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    }
    
    h1 {
      color: #0969da;
      margin-bottom: 0.5rem;
      font-size: 2rem;
    }
    
    .subtitle {
      color: #57606a;
      margin-bottom: 2rem;
    }

    .section-note {
      margin-bottom: 1rem;
      color: #57606a;
      font-size: 0.9375rem;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 1rem;
    }
    
    th, td {
      padding: 0.75rem;
      text-align: left;
      border-bottom: 1px solid #d0d7de;
    }
    
    th {
      background-color: #f6f8fa;
      font-weight: 600;
      color: #24292f;
    }
    
    tr:hover {
      background-color: #f6f8fa;
    }
    
    a {
      color: #0969da;
      text-decoration: none;
    }
    
    a:hover {
      text-decoration: underline;
    }
    
    .badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.875rem;
      font-weight: 500;
    }
    
    .badge-success {
      background-color: #dafbe1;
      color: #1a7f37;
    }
    
    .badge-danger {
      background-color: #ffebe9;
      color: #cf222e;
    }
    
    .badge-warning {
      background-color: #fff8c5;
      color: #9a6700;
    }
    
    .no-reports {
      text-align: center;
      padding: 3rem;
      color: #57606a;
    }
    
    .date {
      color: #57606a;
      font-size: 0.875rem;
    }
    
    .links {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }
    
    .table-wrapper {
      overflow-x: auto;
    }
    
    @media (max-width: 599px) {
      body {
        padding: 0.75rem;
      }
      
      .container {
        padding: 1rem;
      }
      
      .table-wrapper {
        overflow-x: initial;
      }
      
      table {
        display: block;
      }
      
      thead {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      
      tbody {
        display: block;
        width: 100%;
      }
      
      tr {
        display: block;
        border: 1px solid #d0d7de;
        border-radius: 8px;
        margin-bottom: 1rem;
        padding: 0.25rem 0.5rem;
      }
      
      tr:hover {
        background-color: initial;
      }
      
      td {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        padding: 0.5rem 0.25rem;
        border-bottom: 1px solid #eaecef;
        font-size: 0.875rem;
      }
      
      td:last-child {
        border-bottom: none;
      }
      
      td::before {
        content: attr(data-label);
        font-weight: 600;
        min-width: 6rem;
        color: #57606a;
        flex-shrink: 0;
        font-size: 0.8125rem;
      }
      
      .links {
        gap: 0.5rem;
      }
      
      .badge {
        font-size: 0.8125rem;
      }
    }
    
    .nav {
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #d0d7de;
    }
    
    .nav a {
      color: #0969da;
      text-decoration: none;
      margin-right: 1.5rem;
    }
    
    .nav a:hover {
      text-decoration: underline;
    }
    
    footer {
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid #d0d7de;
      text-align: center;
      color: #57606a;
    }
    
    footer a {
      color: #0969da;
      text-decoration: none;
      font-weight: 600;
    }
    
    footer a:hover {
      text-decoration: underline;
    }
    
    .sort-btn {
      background: none;
      border: none;
      font: inherit;
      font-weight: 600;
      color: #24292f;
      cursor: pointer;
      padding: 0;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      white-space: nowrap;
    }
    
    .sort-btn:hover {
      color: #0969da;
    }
    
    .sort-btn:focus-visible {
      outline: 2px solid #0969da;
      outline-offset: 2px;
      border-radius: 2px;
    }
    
    .sort-icon {
      font-size: 0.75rem;
      opacity: 0.5;
    }
    
    .sort-btn:hover .sort-icon {
      opacity: 1;
    }
    
    .table-info {
      color: #57606a;
      font-size: 0.875rem;
      margin-top: 0.75rem;
    }
    
    .pagination-nav {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      flex-wrap: wrap;
      margin-top: 1.25rem;
    }
    
    .page-info {
      color: #57606a;
      font-size: 0.875rem;
      margin-right: 0.5rem;
    }
    
    .page-btn {
      padding: 0.375rem 0.75rem;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      background: white;
      color: #0969da;
      cursor: pointer;
      font-size: 0.875rem;
      line-height: 1.4;
    }
    
    .page-btn:hover {
      background: #f3f4f6;
    }
    
    .page-btn:focus-visible {
      outline: 2px solid #0969da;
      outline-offset: 2px;
    }
    
    .page-btn-active {
      background: #0969da;
      color: white;
      border-color: #0969da;
    }
    
    .page-btn-active:hover {
      background: #0860ca;
    }
    
    .page-ellipsis {
      padding: 0 0.25rem;
      color: #57606a;
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <main class="container" id="main-content" tabindex="-1">
    <nav class="nav">
      <a href="index.html">Submit URLs</a>
      <a href="reports.html">View Reports</a>
      ${latestReportLink}
      <a href="${navLinkHref}">${navLinkLabel}</a>
    </nav>
    
    <h1>${title}</h1>
    <p class="subtitle">${subtitle}</p>
    ${sectionNote}
    
    ${reports.length === 0 ? `<div class="no-reports">${escapeHtml(emptyMessage)}</div>` : `
    <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col"><button class="sort-btn" data-col="issue">Issue <span class="sort-icon" aria-hidden="true">↕</span></button></th>
          <th scope="col"><button class="sort-btn" data-col="title">Scan Title <span class="sort-icon" aria-hidden="true">↕</span></button></th>
          <th scope="col"><button class="sort-btn" data-col="date">Scanned At <span class="sort-icon" aria-hidden="true">↓</span></button></th>
          <th scope="col"><button class="sort-btn" data-col="urls">URLs <span class="sort-icon" aria-hidden="true">↕</span></button></th>
          <th scope="col">Results</th>
          <th scope="col">Reports</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
    </div>
    <p class="table-info" id="table-info" aria-live="polite"></p>
    <div id="pagination"></div>`}
    
    <footer>
      <a href="https://github.com/${getCanonicalRepo()}">Join our GitHub Community</a>
    </footer>
  </main>
  <script>
  (function () {
    var PAGE_SIZE = 50;
    var currentPage = 1;
    var sortCol = 'date';
    var sortDir = 'desc';

    var tbody = document.querySelector('tbody');
    var tableEl = document.querySelector('table');
    var paginationEl = document.getElementById('pagination');
    var tableInfoEl = document.getElementById('table-info');

    if (!tbody) return;

    function getRows() {
      return Array.from(tbody.querySelectorAll('tr'));
    }

    function compareValues(a, b) {
      var valA, valB;
      if (sortCol === 'issue' || sortCol === 'urls') {
        valA = parseInt(a.dataset[sortCol], 10) || 0;
        valB = parseInt(b.dataset[sortCol], 10) || 0;
      } else if (sortCol === 'date') {
        valA = a.dataset.date || '';
        valB = b.dataset.date || '';
      } else {
        valA = (a.dataset.title || '').toLowerCase();
        valB = (b.dataset.title || '').toLowerCase();
      }
      var cmp = valA < valB ? -1 : valA > valB ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    }

    function sortRows() {
      var rows = getRows();
      rows.sort(compareValues);
      rows.forEach(function (row) { tbody.appendChild(row); });
    }

    function renderPage() {
      var rows = getRows();
      var total = rows.length;
      var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (currentPage > totalPages) currentPage = totalPages;
      var start = (currentPage - 1) * PAGE_SIZE;
      var end = start + PAGE_SIZE;

      rows.forEach(function (row, i) {
        row.style.display = (i >= start && i < end) ? '' : 'none';
      });

      if (tableInfoEl) {
        var showing = Math.min(end, total);
        tableInfoEl.textContent = total > 0
          ? 'Showing ' + (start + 1) + ' to ' + showing + ' of ' + total + ' reports'
          : '';
      }

      renderPagination(totalPages);
    }

    function renderPagination(totalPages) {
      if (!paginationEl) return;
      if (totalPages <= 1) {
        paginationEl.innerHTML = '';
        return;
      }

      var html = '<nav class="pagination-nav" aria-label="Report pages">';
      html += '<span class="page-info">Page ' + currentPage + ' of ' + totalPages + '</span>';

      if (currentPage > 1) {
        html += '<button class="page-btn" data-page="' + (currentPage - 1) + '">Previous</button>';
      }

      var pages = [];
      for (var i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
          pages.push(i);
        }
      }

      var prev = 0;
      pages.forEach(function (page) {
        if (prev && page - prev > 1) {
          html += '<span class="page-ellipsis" aria-hidden="true">\u2026</span>';
        }
        var isActive = page === currentPage;
        html += '<button class="page-btn' + (isActive ? ' page-btn-active' : '') + '" data-page="' + page + '"' +
          (isActive ? ' aria-current="page"' : '') + '>' + page + '</button>';
        prev = page;
      });

      if (currentPage < totalPages) {
        html += '<button class="page-btn" data-page="' + (currentPage + 1) + '">Next</button>';
      }

      html += '</nav>';
      paginationEl.innerHTML = html;

      paginationEl.querySelectorAll('.page-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          currentPage = parseInt(this.dataset.page, 10);
          renderPage();
          if (tableEl) {
            var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            tableEl.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
          }
        });
      });
    }

    function updateSortIcons() {
      document.querySelectorAll('.sort-btn').forEach(function (btn) {
        var icon = btn.querySelector('.sort-icon');
        var th = btn.closest('th');
        if (btn.dataset.col === sortCol) {
          icon.textContent = sortDir === 'asc' ? '\u2191' : '\u2193';
          if (th) th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
        } else {
          icon.textContent = '\u2195';
          if (th) th.removeAttribute('aria-sort');
        }
      });
    }

    document.querySelectorAll('.sort-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var col = this.dataset.col;
        if (col === sortCol) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortCol = col;
          sortDir = col === 'date' ? 'desc' : 'asc';
        }
        currentPage = 1;
        sortRows();
        updateSortIcons();
        renderPage();
      });
    });

    updateSortIcons();
    renderPage();
  }());
  </script>
</body>
</html>`;
}

export function generateReportsHtml(reports) {
  const { altTextReports, legacyReports } = splitReportsByType(reports);
  const legacyCount = legacyReports.length;
  const legacyNote = legacyCount > 0
    ? `<p class="section-note">Showing ${altTextReports.length} alt-text reports. ${legacyCount} legacy accessibility reports are excluded from this page. <a href="legacy-reports.html">Browse the legacy archive</a>.</p>`
    : '';
  const emptyMessage = legacyCount > 0
    ? `No alt-text reports available yet. ${legacyCount} legacy accessibility reports are excluded from this page.`
    : 'No reports available yet. Submit URLs to generate your first report.';

  return generateReportsPage({
    reports: altTextReports,
    title: 'Alt Text Scan Reports',
    subtitle: 'Review alt-text scan artifacts generated by GitHub Actions',
    navLinkHref: 'legacy-reports.html',
    navLinkLabel: 'Legacy Archive',
    sectionNote: legacyNote,
    emptyMessage
  });
}

export function generateLegacyReportsHtml(reports, archiveMetadata = new Map()) {
  const { legacyReports } = splitReportsByType(reports);
  const archiveReports = legacyReports.map(({ path, data }) => {
    const existingArchive = archiveMetadata.get(path) || {};
    const archivePath = existingArchive.archivePath || deriveLegacyArchivePath(path);
    const archiveSizeLabel = existingArchive.archiveSizeLabel || (existsSync(archivePath) ? formatBytes(statSync(archivePath).size) : 'pending');

    return {
      path,
      data: {
        ...data,
        acceptedCount: data.acceptedCount ?? data.scannedCount ?? data.urlsScanned ?? 0,
        archivePath,
        archiveSizeLabel,
        archivePages: data.acceptedCount ?? data.scannedCount ?? data.urlsScanned ?? 0,
        archiveImages: data.totalImages ?? data.uniqueImages ?? null
      }
    };
  });

  const sectionNote = archiveReports.length > 0
    ? `<p class="section-note">Showing ${archiveReports.length} archived legacy scans as downloadable ZIP files keyed by trigger issue and scan date. <a href="reports.html">Return to the alt-text reports</a>.</p>`
    : '';
  const latestArchivePath = archiveReports.length > 0 ? archiveReports[0].data.archivePath : null;

  return generateReportsPage({
    reports: archiveReports,
    title: 'Legacy Scan Archives',
    subtitle: 'Download archived legacy scan bundles by trigger issue and scan date',
    navLinkHref: 'reports.html',
    navLinkLabel: 'Alt-Text Reports',
    latestLinkHref: latestArchivePath,
    latestLinkLabel: 'Latest Archive ZIP',
    sectionNote,
    emptyMessage: 'No legacy scan archives are available.'
  });
}

/**
 * Main function to generate reports.html
 */
export function main() {
  const reportsDir = process.argv[2] || 'reports';
  const outputFile = process.argv[3] || 'reports.html';
  const legacyOutputFile = process.argv[4] || deriveLegacyOutputFile(outputFile);
  
  console.log(`Scanning for reports in: ${reportsDir}`);
  
  const reports = findAllReports(reportsDir);
  console.log(`Found ${reports.length} reports`);
  const { altTextReports, legacyReports } = splitReportsByType(reports);
  console.log(`Included ${altTextReports.length} alt-text reports and excluded ${legacyReports.length} legacy reports`);
  
  const sortedReports = sortReportsByTime(reports);
  console.log(`Sorted reports by time (most recent first)`);

  const legacyArchiveMetadata = createLegacyArchives(sortedReports);
  console.log(`Prepared ${legacyArchiveMetadata.size} legacy ZIP archives`);
  
  const html = generateReportsHtml(sortedReports);
  const legacyHtml = generateLegacyReportsHtml(sortedReports, legacyArchiveMetadata);

  writeFileSync(outputFile, html, 'utf8');
  writeFileSync(legacyOutputFile, legacyHtml, 'utf8');
  console.log(`Generated ${outputFile} with ${altTextReports.length} indexed alt-text reports`);
  console.log(`Generated ${legacyOutputFile} with ${legacyReports.length} archived legacy reports`);
}

// Run main if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
