import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { 
  findAllReports, 
  sortReportsByTime, 
  deduplicateReports,
  generateTableRows,
  generateReportsHtml,
  generateLegacyReportsHtml
} from '../../scanner/generate-reports-html.mjs';

describe('generate-reports-html', () => {
  describe('findAllReports', () => {
    it('should find all reports in the reports directory', () => {
      const reports = findAllReports('reports');
      assert.ok(reports.length > 0, 'Should find at least one report');
      
      // Check that each report has the expected structure
      for (const report of reports) {
        assert.ok(report.path, 'Report should have a path');
        assert.ok(report.data, 'Report should have data');
        assert.ok(report.data.issueNumber, 'Report data should have issueNumber');
        assert.ok(report.data.scannedAt, 'Report data should have scannedAt');
      }
    });

    it('should not throw when reports/pages directory does not exist', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'reports-test-'));
      try {
        mkdirSync(join(tmp, 'issues'));
        assert.doesNotThrow(() => {
          const reports = findAllReports(tmp);
          assert.equal(reports.length, 0);
        });
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });

    it('should include reports from reports/pages directory', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'reports-test-'));
      try {
        const stamp = '2026-03-16T14-37-54-000Z';
        const pagesDir = join(tmp, 'pages', stamp);
        mkdirSync(join(tmp, 'issues'));
        mkdirSync(pagesDir, { recursive: true });
        const reportData = {
          issueNumber: 6,
          issueUrl: 'https://github.com/mgifford/alt-text-scan/actions/runs/23149256539',
          scanTitle: 'SCAN: AXE GitHub Pages accessibility check',
          scannedAt: '2026-03-16T14:37:54.000Z',
          acceptedCount: 1,
          alfaTotals: { passed: 0, failed: 0, cantTell: 0 },
          axeTotals: { passed: 10, failed: 2, cantTell: 1 }
        };
        writeFileSync(join(pagesDir, 'report.json'), JSON.stringify(reportData));

        const reports = findAllReports(tmp);
        assert.equal(reports.length, 1, 'Should find the pages report');
        assert.equal(reports[0].path, `reports/pages/${stamp}`);
        assert.equal(reports[0].data.issueNumber, 6);
        assert.equal(reports[0].data.scanTitle, 'SCAN: AXE GitHub Pages accessibility check');
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });

    it('should include both issue reports and pages reports', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'reports-test-'));
      try {
        const issueStamp = '2026-03-01T10-00-00-000Z';
        const issueDir = join(tmp, 'issues', 'issue-5', issueStamp);
        mkdirSync(issueDir, { recursive: true });
        writeFileSync(join(issueDir, 'report.json'), JSON.stringify({
          issueNumber: 5, issueUrl: 'https://github.com/mgifford/alt-text-scan/issues/5',
          scanTitle: 'Issue scan', scannedAt: '2026-03-01T10:00:00.000Z',
          acceptedCount: 2, alfaTotals: { passed: 5, failed: 0, cantTell: 0 },
          axeTotals: { passed: 3, failed: 0, cantTell: 0 }
        }));

        const pagesStamp = '2026-03-16T14-37-54-000Z';
        const pagesDir = join(tmp, 'pages', pagesStamp);
        mkdirSync(pagesDir, { recursive: true });
        writeFileSync(join(pagesDir, 'report.json'), JSON.stringify({
          issueNumber: 6, issueUrl: 'https://github.com/mgifford/alt-text-scan/actions/runs/100',
          scanTitle: 'Pages scan', scannedAt: '2026-03-16T14:37:54.000Z',
          acceptedCount: 1, alfaTotals: { passed: 0, failed: 0, cantTell: 0 },
          axeTotals: { passed: 10, failed: 2, cantTell: 1 }
        }));

        const reports = findAllReports(tmp);
        assert.equal(reports.length, 2, 'Should find both issue and pages reports');
        const titles = reports.map(r => r.data.scanTitle).sort();
        assert.deepEqual(titles, ['Issue scan', 'Pages scan']);
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });
  });

  describe('sortReportsByTime', () => {
    it('should sort reports by timestamp, most recent first', () => {
      const reports = [
        {
          path: 'reports/issues/issue-1/2026-02-21T12-48-19-132Z',
          data: { scannedAt: '2026-02-21T12:48:19.091Z' }
        },
        {
          path: 'reports/issues/issue-1/2026-02-21T16-37-55-764Z',
          data: { scannedAt: '2026-02-21T16:37:55.764Z' }
        },
        {
          path: 'reports/issues/issue-18/2026-02-21T20-55-47-400Z',
          data: { scannedAt: '2026-02-21T20:55:47.400Z' }
        }
      ];
      
      const sorted = sortReportsByTime(reports);
      
      // Most recent should be first
      assert.equal(sorted[0].data.scannedAt, '2026-02-21T20:55:47.400Z');
      assert.equal(sorted[1].data.scannedAt, '2026-02-21T16:37:55.764Z');
      assert.equal(sorted[2].data.scannedAt, '2026-02-21T12:48:19.091Z');
    });
  });

  describe('deduplicateReports', () => {
    it('should keep only the most recent report per issue number', () => {
      const reports = [
        {
          path: 'reports/issues/issue-2/2026-03-18T17-51-39-464Z',
          data: { issueNumber: 2, scannedAt: '2026-03-18T17:51:39.464Z', scanTitle: 'Issue 2 latest' }
        },
        {
          path: 'reports/issues/issue-2/2026-03-18T16-05-32-873Z',
          data: { issueNumber: 2, scannedAt: '2026-03-18T16:05:32.873Z', scanTitle: 'Issue 2 older' }
        },
        {
          path: 'reports/issues/issue-2/2026-03-17T18-10-08-906Z',
          data: { issueNumber: 2, scannedAt: '2026-03-17T18:10:08.906Z', scanTitle: 'Issue 2 oldest' }
        },
        {
          path: 'reports/issues/issue-3/2026-03-19T05-22-53-747Z',
          data: { issueNumber: 3, scannedAt: '2026-03-19T05:22:53.747Z', scanTitle: 'Issue 3 latest' }
        },
        {
          path: 'reports/issues/issue-3/2026-03-18T16-02-57-925Z',
          data: { issueNumber: 3, scannedAt: '2026-03-18T16:02:57.925Z', scanTitle: 'Issue 3 older' }
        }
      ];

      // Reports must be sorted most-recent-first before deduplication
      const sorted = sortReportsByTime(reports);
      const deduped = deduplicateReports(sorted);

      assert.equal(deduped.length, 2, 'Should have one entry per unique issue number');
      assert.ok(deduped.some(r => r.data.scanTitle === 'Issue 2 latest'), 'Should keep the latest Issue 2 scan');
      assert.ok(deduped.some(r => r.data.scanTitle === 'Issue 3 latest'), 'Should keep the latest Issue 3 scan');
      assert.ok(!deduped.some(r => r.data.scanTitle === 'Issue 2 older'), 'Should omit older Issue 2 scans');
      assert.ok(!deduped.some(r => r.data.scanTitle === 'Issue 2 oldest'), 'Should omit oldest Issue 2 scans');
      assert.ok(!deduped.some(r => r.data.scanTitle === 'Issue 3 older'), 'Should omit older Issue 3 scans');
    });

    it('should return all reports when each issue number is unique', () => {
      const reports = [
        {
          path: 'reports/issues/issue-1/2026-02-21T16-37-55-764Z',
          data: { issueNumber: 1, scannedAt: '2026-02-21T16:37:55.764Z' }
        },
        {
          path: 'reports/issues/issue-18/2026-02-21T20-55-47-400Z',
          data: { issueNumber: 18, scannedAt: '2026-02-21T20:55:47.400Z' }
        }
      ];

      const deduped = deduplicateReports(reports);

      assert.equal(deduped.length, 2, 'Should keep all reports when no duplicates');
    });

    it('should return an empty array when given an empty array', () => {
      assert.deepEqual(deduplicateReports([]), []);
    });
  });


  describe('generateTableRows', () => {
    it('should generate HTML table rows for reports', () => {
      const reports = [
        {
          path: 'reports/issues/issue-1/2026-02-21T16-37-55-764Z',
          data: {
            issueNumber: 1,
            issueUrl: 'https://github.com/mgifford/alt-text-scan/issues/1',
            scanTitle: 'GSA.gov',
            scannedAt: '2026-02-21T16:37:55.764Z',
            acceptedCount: 13,
            alfaTotals: { passed: 23694, failed: 1698, cantTell: 125 },
            axeTotals: { passed: 0, failed: 0, cantTell: 0 }
          }
        }
      ];
      
      const html = generateTableRows(reports);
      
      assert.ok(html.includes('#1'), 'Should include issue number');
      assert.ok(html.includes('GSA.gov'), 'Should include scan title');
      assert.ok(html.includes('13 accepted'), 'Should include accepted count');
      assert.ok(html.includes('23694 passed'), 'Should include passed count');
      assert.ok(html.includes('1698 failed'), 'Should include failed count');
      assert.ok(html.includes('125 can\'t tell'), 'Should include can\'t tell count');
      assert.ok(html.includes('/report.md'), 'Should include markdown link');
      assert.ok(html.includes('/report.csv'), 'Should include CSV link');
      assert.ok(html.includes('/report-overlap.md'), 'Should include overlap report link');
      assert.ok(html.includes('/report.json'), 'Should include JSON link');
    });

    it('should generate alt-text summary rows without overlap links', () => {
      const reports = [
        {
          path: 'reports/issues/issue-200/2026-03-17T18-00-00-000Z',
          data: {
            reportType: 'alt-text',
            issueNumber: 200,
            issueUrl: 'https://github.com/mgifford/alt-text-scan/issues/200',
            scanTitle: 'Commerce site alt text review',
            scannedAt: '2026-03-17T18:00:00.000Z',
            acceptedCount: 25,
            totalImages: 420,
            uniqueImages: 180,
            imagesWithIssues: 42,
            statusCounts: { MISSING: 10, DECORATIVE: 15, SUSPICIOUS: 12, FILENAME: 8, TOO_SHORT: 7, TOO_LONG: 5, GOOD: 123 }
          }
        }
      ];

      const html = generateTableRows(reports);

      assert.ok(html.includes('180 reviewed'), 'Should include reviewed image count');
      assert.ok(html.includes('42 flagged'), 'Should include flagged image count');
      assert.ok(html.includes('10 missing'), 'Should include missing count');
      assert.ok(!html.includes('/report-overlap.md'), 'Should not include overlap link for alt-text reports');
      assert.ok(html.includes('/report.md'), 'Should include markdown link');
    });

    it('should handle reports without axeTotals (old format)', () => {
      const reports = [
        {
          path: 'reports/issues/issue-1/2026-02-21T12-48-19-132Z',
          data: {
            issueNumber: 1,
            issueUrl: 'https://github.com/mgifford/alt-text-scan/issues/1',
            scanTitle: 'GSA.gov',
            scannedAt: '2026-02-21T12:48:19.132Z',
            acceptedCount: 13,
            alfaTotals: { passed: 23776, failed: 1698, cantTell: 125 }
            // No axeTotals
          }
        }
      ];
      
      const html = generateTableRows(reports);
      
      assert.ok(html.includes('23776 passed'), 'Should include ALFA passed count');
      assert.ok(html.includes('1698 failed'), 'Should include ALFA failed count');
      assert.ok(html.includes('125 can\'t tell'), 'Should include ALFA can\'t tell count');
    });

    it('should combine ALFA and axe totals for new format', () => {
      const reports = [
        {
          path: 'reports/issues/issue-18/2026-02-21T20-55-47-400Z',
          data: {
            issueNumber: 18,
            issueUrl: 'https://github.com/mgifford/alt-text-scan/issues/18',
            scanTitle: 'Government of Canada',
            scannedAt: '2026-02-21T20:55:47.400Z',
            acceptedCount: 46,
            alfaTotals: { passed: 41833, failed: 2201, cantTell: 2088 },
            axeTotals: { passed: 33281, failed: 76, cantTell: 1034 }
          }
        }
      ];
      
      const html = generateTableRows(reports);
      
      // Should combine: 41833 + 33281 = 75114
      assert.ok(html.includes('75114 passed'), 'Should combine ALFA and axe passed counts');
      // Should combine: 2201 + 76 = 2277
      assert.ok(html.includes('2277 failed'), 'Should combine ALFA and axe failed counts');
      // Should combine: 2088 + 1034 = 3122
      assert.ok(html.includes('3122 can\'t tell'), 'Should combine ALFA and axe can\'t tell counts');
    });
  });

  describe('generateReportsHtml', () => {
    it('should generate a complete HTML document', () => {
      const reports = [
        {
          path: 'reports/issues/issue-1/2026-02-21T16-37-55-764Z',
          data: {
            reportType: 'alt-text',
            issueNumber: 1,
            issueUrl: 'https://github.com/mgifford/alt-text-scan/issues/1',
            scanTitle: 'GSA.gov',
            scannedAt: '2026-02-21T16:37:55.764Z',
            acceptedCount: 13,
            totalImages: 200,
            uniqueImages: 120,
            imagesWithIssues: 14,
            statusCounts: { MISSING: 5, DECORATIVE: 15, SUSPICIOUS: 6, FILENAME: 2, TOO_SHORT: 1, TOO_LONG: 0, GOOD: 91 }
          }
        }
      ];
      
      const html = generateReportsHtml(reports);
      
      assert.ok(html.includes('<!DOCTYPE html>'), 'Should include DOCTYPE');
      assert.ok(html.includes('<html lang="en">'), 'Should include html tag');
      assert.ok(html.includes('Alt Text Scan Reports'), 'Should include title');
      assert.ok(html.includes('GSA.gov'), 'Should include report data');
      assert.ok(html.includes('reports/issues/issue-1/2026-02-21T16-37-55-764Z/report.html'), 'Should include Latest Report navigation link');
      assert.ok(html.includes('Latest Report'), 'Should include Latest Report label');
      assert.ok(html.includes('Join our GitHub Community'), 'Should include footer');
    });

    it('should show message when no reports available', () => {
      const html = generateReportsHtml([]);
      
      assert.ok(html.includes('No reports available yet'), 'Should show no reports message');
      assert.ok(!html.includes('<table>'), 'Should not include table when no reports');
      assert.ok(!html.includes('Latest Report'), 'Should not include Latest Report link without reports');
    });

    it('should exclude legacy accessibility reports from the main index', () => {
      const html = generateReportsHtml([
        {
          path: 'reports/issues/issue-1/2026-03-17T18-00-00-000Z',
          data: {
            issueNumber: 1,
            issueUrl: 'https://github.com/mgifford/alt-text-scan/issues/1',
            scanTitle: 'Legacy scan',
            scannedAt: '2026-03-17T18:00:00.000Z',
            acceptedCount: 10,
            alfaTotals: { passed: 20, failed: 2, cantTell: 1 },
            axeTotals: { passed: 10, failed: 1, cantTell: 0 }
          }
        }
      ]);

      assert.ok(html.includes('No alt-text reports available yet'), 'Should explain that only legacy reports exist');
      assert.ok(html.includes('1 legacy accessibility reports are excluded from this page'), 'Should disclose excluded legacy reports');
      assert.ok(html.includes('legacy-reports.html'), 'Should link to the legacy archive');
      assert.ok(!html.includes('Legacy scan'), 'Should not render legacy report rows in the main table');
    });

    it('should show only alt-text reports when both report types exist', () => {
      const html = generateReportsHtml([
        {
          path: 'reports/issues/issue-1/2026-03-17T18-00-00-000Z',
          data: {
            issueNumber: 1,
            issueUrl: 'https://github.com/mgifford/alt-text-scan/issues/1',
            scanTitle: 'Legacy scan',
            scannedAt: '2026-03-17T18:00:00.000Z',
            acceptedCount: 10,
            alfaTotals: { passed: 20, failed: 2, cantTell: 1 },
            axeTotals: { passed: 10, failed: 1, cantTell: 0 }
          }
        },
        {
          path: 'reports/issues/issue-200/2026-03-17T19-00-00-000Z',
          data: {
            reportType: 'alt-text',
            issueNumber: 200,
            issueUrl: 'https://github.com/mgifford/alt-text-scan/issues/200',
            scanTitle: 'Commerce site alt text review',
            scannedAt: '2026-03-17T19:00:00.000Z',
            acceptedCount: 25,
            totalImages: 420,
            uniqueImages: 180,
            imagesWithIssues: 42,
            statusCounts: { MISSING: 10, DECORATIVE: 15, SUSPICIOUS: 12, FILENAME: 8, TOO_SHORT: 7, TOO_LONG: 5, GOOD: 123 }
          }
        }
      ]);

      assert.ok(html.includes('Commerce site alt text review'), 'Should include alt-text report rows');
      assert.ok(!html.includes('Legacy scan'), 'Should omit legacy report rows');
      assert.ok(html.includes('1 legacy accessibility reports are excluded from this page'), 'Should disclose omitted legacy reports');
    });

    it('should show only the latest scan when the same issue has been scanned multiple times', () => {
      // Reports must be sorted most-recent-first (as done in main()) before passing to generateReportsHtml
      const html = generateReportsHtml(sortReportsByTime([
        // Older scan for issue 2 (should be omitted)
        {
          path: 'reports/issues/issue-2/2026-03-17T18-10-08-906Z',
          data: {
            reportType: 'alt-text',
            issueNumber: 2,
            issueUrl: 'https://github.com/mgifford/alt-text-scan/issues/2',
            scanTitle: 'Older scan',
            scannedAt: '2026-03-17T18:10:08.906Z',
            acceptedCount: 5,
            totalImages: 100,
            uniqueImages: 80,
            imagesWithIssues: 10,
            statusCounts: { MISSING: 3, DECORATIVE: 5, SUSPICIOUS: 2, FILENAME: 0, TOO_SHORT: 0, TOO_LONG: 0, GOOD: 70 }
          }
        },
        // Latest scan for issue 2 (should be kept)
        {
          path: 'reports/issues/issue-2/2026-03-18T17-51-39-464Z',
          data: {
            reportType: 'alt-text',
            issueNumber: 2,
            issueUrl: 'https://github.com/mgifford/alt-text-scan/issues/2',
            scanTitle: 'Latest scan',
            scannedAt: '2026-03-18T17:51:39.464Z',
            acceptedCount: 5,
            totalImages: 110,
            uniqueImages: 90,
            imagesWithIssues: 8,
            statusCounts: { MISSING: 2, DECORATIVE: 5, SUSPICIOUS: 1, FILENAME: 0, TOO_SHORT: 0, TOO_LONG: 0, GOOD: 82 }
          }
        }
      ]));

      assert.ok(html.includes('Latest scan'), 'Should include the most recent scan');
      assert.ok(!html.includes('Older scan'), 'Should omit the older scan for the same issue');
    });


    it('should generate a separate legacy archive page', () => {
      const html = generateLegacyReportsHtml([
        {
          path: 'reports/issues/issue-1/2026-03-17T18-00-00-000Z',
          data: {
            issueNumber: 1,
            issueUrl: 'https://github.com/mgifford/alt-text-scan/issues/1',
            scanTitle: 'Legacy scan',
            scannedAt: '2026-03-17T18:00:00.000Z',
            acceptedCount: 10,
            alfaTotals: { passed: 20, failed: 2, cantTell: 1 },
            axeTotals: { passed: 10, failed: 1, cantTell: 0 }
          }
        },
        {
          path: 'reports/issues/issue-200/2026-03-17T19-00-00-000Z',
          data: {
            reportType: 'alt-text',
            issueNumber: 200,
            issueUrl: 'https://github.com/mgifford/alt-text-scan/issues/200',
            scanTitle: 'Commerce site alt text review',
            scannedAt: '2026-03-17T19:00:00.000Z',
            acceptedCount: 25,
            totalImages: 420,
            uniqueImages: 180,
            imagesWithIssues: 42,
            statusCounts: { MISSING: 10, DECORATIVE: 15, SUSPICIOUS: 12, FILENAME: 8, TOO_SHORT: 7, TOO_LONG: 5, GOOD: 123 }
          }
        }
      ]);

      assert.ok(html.includes('Legacy Scan Archives'), 'Should render legacy archive title');
      assert.ok(html.includes('Legacy scan'), 'Should include legacy report rows');
      assert.ok(!html.includes('Commerce site alt text review'), 'Should omit alt-text rows from the legacy archive');
      assert.ok(html.includes('Download ZIP'), 'Should include ZIP download link for legacy archives');
      assert.ok(html.includes('reports/archives/legacy/issues/issue-1/2026-03-17T18-00-00-000Z.zip'), 'Should include issue/date archive path');
      assert.ok(html.includes('reports.html'), 'Should link back to the main alt-text index');
    });
  });
});

// ── Additional findAllReports edge cases ──────────────────────────────────────

import { describe as describe2, it as it2 } from 'node:test';
import { mkdtempSync as mkdtempSync2, rmSync as rmSync2, mkdirSync as mkdirSync2, writeFileSync as writeFileSync2 } from 'node:fs';
import { tmpdir as tmpdir2 } from 'node:os';
import { join as join2 } from 'node:path';

describe2('findAllReports extra edge cases', () => {
  it2('should skip malformed JSON files gracefully', () => {
    const tmp = mkdtempSync2(join2(tmpdir2(), 'reports-test-'));
    try {
      const issueDir = join2(tmp, 'issues', 'issue-99', '2026-01-01T00-00-00-000Z');
      mkdirSync2(issueDir, { recursive: true });
      writeFileSync2(join2(issueDir, 'report.json'), '{ this is not valid json }');
      mkdirSync2(join2(tmp, 'issues'), { recursive: true });

      const reports = findAllReports(tmp);
      assert.equal(reports.length, 0, 'Malformed JSON should be skipped without throwing');
    } finally {
      rmSync2(tmp, { recursive: true });
    }
  });

  it2('should return empty array when issues directory is empty', () => {
    const tmp = mkdtempSync2(join2(tmpdir2(), 'reports-test-'));
    try {
      mkdirSync2(join2(tmp, 'issues'), { recursive: true });
      const reports = findAllReports(tmp);
      assert.equal(reports.length, 0);
    } finally {
      rmSync2(tmp, { recursive: true });
    }
  });

  it2('should handle multiple issues each with multiple timestamps', () => {
    const tmp = mkdtempSync2(join2(tmpdir2(), 'reports-test-'));
    try {
      const reportData = (n, ts) => JSON.stringify({
        issueNumber: n, scanTitle: `Issue ${n}`, scannedAt: ts,
        reportType: 'alt-text', totalImages: 10, statusCounts: {}
      });

      for (const [issue, stamp] of [
        ['issue-1', '2026-01-01T10-00-00-000Z'],
        ['issue-1', '2026-01-02T10-00-00-000Z'],
        ['issue-2', '2026-01-03T10-00-00-000Z']
      ]) {
        const dir = join2(tmp, 'issues', issue, stamp);
        mkdirSync2(dir, { recursive: true });
        const num = issue === 'issue-1' ? 1 : 2;
        writeFileSync2(join2(dir, 'report.json'), reportData(num, stamp.replace(/-/g, ':').slice(0, -3)));
      }
      mkdirSync2(join2(tmp, 'issues'), { recursive: true });

      const reports = findAllReports(tmp);
      assert.equal(reports.length, 3, 'Should find all 3 report files');
    } finally {
      rmSync2(tmp, { recursive: true });
    }
  });
});

// ── generateTableRows normalizeIssueUrl behaviour ─────────────────────────────

describe2('generateTableRows normalizeIssueUrl', () => {
  it2('should normalize issue URLs from forked repos to the canonical repo', () => {
    const reports = [
      {
        path: 'reports/issues/issue-5/2026-01-01T10-00-00-000Z',
        data: {
          issueNumber: 5,
          issueUrl: 'https://github.com/fork-owner/alt-text-scan/issues/5',
          scanTitle: 'Fork test',
          scannedAt: '2026-01-01T10:00:00.000Z',
          reportType: 'alt-text',
          totalImages: 0,
          uniqueImages: 0,
          imagesWithIssues: 0,
          statusCounts: {}
        }
      }
    ];

    // Set canonical repo env var temporarily
    const originalRepo = process.env.GITHUB_REPOSITORY;
    process.env.GITHUB_REPOSITORY = 'mgifford/alt-text-scan';
    try {
      const html = generateTableRows(reports);
      assert.ok(
        html.includes('https://github.com/mgifford/alt-text-scan/issues/5'),
        'Issue URL should be normalized to canonical repo'
      );
      assert.ok(
        !html.includes('fork-owner'),
        'Fork owner should not appear in the normalized URL'
      );
    } finally {
      if (originalRepo === undefined) {
        delete process.env.GITHUB_REPOSITORY;
      } else {
        process.env.GITHUB_REPOSITORY = originalRepo;
      }
    }
  });

  it2('should preserve issue URLs that already point to the canonical repo', () => {
    const reports = [
      {
        path: 'reports/issues/issue-10/2026-01-01T10-00-00-000Z',
        data: {
          issueNumber: 10,
          issueUrl: 'https://github.com/mgifford/alt-text-scan/issues/10',
          scanTitle: 'Canonical test',
          scannedAt: '2026-01-01T10:00:00.000Z',
          reportType: 'alt-text',
          totalImages: 0,
          uniqueImages: 0,
          imagesWithIssues: 0,
          statusCounts: {}
        }
      }
    ];

    const originalRepo = process.env.GITHUB_REPOSITORY;
    process.env.GITHUB_REPOSITORY = 'mgifford/alt-text-scan';
    try {
      const html = generateTableRows(reports);
      assert.ok(
        html.includes('https://github.com/mgifford/alt-text-scan/issues/10'),
        'Canonical URL should be preserved unchanged'
      );
    } finally {
      if (originalRepo === undefined) {
        delete process.env.GITHUB_REPOSITORY;
      } else {
        process.env.GITHUB_REPOSITORY = originalRepo;
      }
    }
  });

  it2('should fall back to constructed URL when issueUrl is null', () => {
    const reports = [
      {
        path: 'reports/issues/issue-7/2026-01-01T10-00-00-000Z',
        data: {
          issueNumber: 7,
          issueUrl: null,
          scanTitle: 'No URL test',
          scannedAt: '2026-01-01T10:00:00.000Z',
          reportType: 'alt-text',
          totalImages: 0,
          uniqueImages: 0,
          imagesWithIssues: 0,
          statusCounts: {}
        }
      }
    ];

    const originalRepo = process.env.GITHUB_REPOSITORY;
    process.env.GITHUB_REPOSITORY = 'mgifford/alt-text-scan';
    try {
      const html = generateTableRows(reports);
      assert.ok(html.includes('#7'), 'Issue number should appear');
      assert.ok(html.includes('github.com'), 'Fallback URL should include github.com');
    } finally {
      if (originalRepo === undefined) {
        delete process.env.GITHUB_REPOSITORY;
      } else {
        process.env.GITHUB_REPOSITORY = originalRepo;
      }
    }
  });
});

// ── deduplicateReports additional edge cases ──────────────────────────────────

describe2('deduplicateReports extra edge cases', () => {
  it2('should handle reports where issueNumber is undefined (pages reports)', () => {
    const reports = [
      { path: 'reports/pages/stamp1', data: { issueNumber: undefined, scannedAt: '2026-01-01T10:00:00.000Z' } },
      { path: 'reports/pages/stamp2', data: { issueNumber: undefined, scannedAt: '2026-01-02T10:00:00.000Z' } }
    ];
    // Both have issueNumber === undefined, so the Set will treat them as the same key
    const deduped = deduplicateReports(reports);
    // Only one should remain (undefined === undefined in the Set)
    assert.equal(deduped.length, 1, 'Pages reports with undefined issueNumber should be deduplicated');
  });

  it2('should keep reports with different issueNumbers separately', () => {
    const reports = [
      { path: 'r1', data: { issueNumber: 1, scannedAt: '2026-01-01T10:00:00.000Z' } },
      { path: 'r2', data: { issueNumber: 2, scannedAt: '2026-01-01T10:00:00.000Z' } },
      { path: 'r3', data: { issueNumber: 3, scannedAt: '2026-01-01T10:00:00.000Z' } }
    ];
    const deduped = deduplicateReports(reports);
    assert.equal(deduped.length, 3);
  });
});
