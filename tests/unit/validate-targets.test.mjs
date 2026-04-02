import test from "node:test";
import assert from "node:assert/strict";
import { validateTarget, validateTargets, isNonWebDocument } from "../../scanner/validate-targets.mjs";

test("validateTarget accepts public https URL", () => {
  const result = validateTarget("https://example.com/path#fragment");
  assert.equal(result.accepted, true);
  assert.equal(result.reason, null);
  assert.equal(result.normalizedUrl, "https://example.com/path");
});

test("validateTarget rejects localhost", () => {
  const result = validateTarget("http://localhost:3000");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /localhost/);
});

test("validateTarget rejects private IPv4", () => {
  const result = validateTarget("https://10.1.2.3/path");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /private\/internal IPv4/);
});

test("validateTarget rejects link-local IPv4", () => {
  const result = validateTarget("http://169.254.1.10");
  assert.equal(result.accepted, false);
});

test("validateTarget rejects private IPv6", () => {
  const result = validateTarget("https://[fd00::1]/");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /private\/internal IPv6/);
});

test("validateTargets separates accepted and rejected URLs", () => {
  const result = validateTargets([
    "https://example.com",
    "http://localhost",
    "not-a-url"
  ]);

  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 2);
  assert.equal(result.accepted[0].normalizedUrl, "https://example.com/");
});

test("validateTarget rejects PDF URLs", () => {
  const result = validateTarget("https://www.example.com/docs/report.pdf");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /non-web document/);
});

test("validateTarget rejects Word document URLs", () => {
  const result = validateTarget("https://example.com/files/document.docx");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /non-web document/);
});

test("validateTarget rejects image URLs", () => {
  const result = validateTarget("https://example.com/images/photo.jpg");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /non-web document/);
});

test("validateTarget rejects video URLs", () => {
  const result = validateTarget("https://example.com/video/clip.mp4");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /non-web document/);
});

test("validateTarget accepts HTML web page URLs", () => {
  const result = validateTarget("https://example.com/page.html");
  assert.equal(result.accepted, true);
});

test("validateTarget accepts URLs with no file extension", () => {
  const result = validateTarget("https://example.com/about");
  assert.equal(result.accepted, true);
});

test("validateTarget accepts URLs with query strings that look like documents", () => {
  // Query parameters should not trigger extension filtering
  const result = validateTarget("https://example.com/search?type=pdf");
  assert.equal(result.accepted, true);
});

test("validateTargets filters out non-web documents with correct reason", () => {
  const result = validateTargets([
    "https://example.com/page",
    "https://example.com/report.pdf",
    "https://example.com/spreadsheet.xlsx"
  ]);

  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 2);
  for (const rejected of result.rejected) {
    assert.match(rejected.reason, /non-web document/);
  }
});

test("isNonWebDocument returns true for PDF URL", () => {
  assert.equal(isNonWebDocument(new URL("https://example.com/report.pdf")), true);
});

test("isNonWebDocument returns false for HTML URL", () => {
  assert.equal(isNonWebDocument(new URL("https://example.com/page.html")), false);
});

test("isNonWebDocument returns false for URL with no extension", () => {
  assert.equal(isNonWebDocument(new URL("https://example.com/about")), false);
});

test("isNonWebDocument returns false when extension is in query string only", () => {
  assert.equal(isNonWebDocument(new URL("https://example.com/search?file=report.pdf")), false);
});

test("isNonWebDocument returns true for epub URL", () => {
  assert.equal(isNonWebDocument(new URL("https://www.medicare.gov/publications/guide.epub")), true);
});

test("isNonWebDocument returns true for mobi URL", () => {
  assert.equal(isNonWebDocument(new URL("https://example.com/book.mobi")), true);
});

test("validateTargets filters out epub and mobi URLs", () => {
  const result = validateTargets([
    "https://example.com/page",
    "https://www.medicare.gov/publications/guide.epub",
    "https://example.com/book.mobi"
  ]);

  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 2);
  for (const rejected of result.rejected) {
    assert.match(rejected.reason, /non-web document/);
  }
});
// ── .local domain blocking ────────────────────────────────────────────────────

test("validateTarget rejects .local domains", () => {
  const result = validateTarget("http://printer.local/");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /local network/);
});

test("validateTarget rejects nested .local subdomains", () => {
  const result = validateTarget("https://device.home.local/admin");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /local network/);
});

// ── localhost variations ──────────────────────────────────────────────────────

test("validateTarget rejects localhost with port", () => {
  const result = validateTarget("http://localhost:8080/app");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /localhost/);
});

test("validateTarget rejects .localhost subdomains", () => {
  const result = validateTarget("http://myapp.localhost/");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /localhost/);
});

// ── Extension case sensitivity ────────────────────────────────────────────────

test("isNonWebDocument returns true for uppercase .PDF extension", () => {
  assert.equal(isNonWebDocument(new URL("https://example.com/report.PDF")), true);
});

test("isNonWebDocument returns true for mixed-case .Docx extension", () => {
  assert.equal(isNonWebDocument(new URL("https://example.com/document.Docx")), true);
});

test("validateTarget rejects uppercase .PDF file URLs", () => {
  const result = validateTarget("https://example.com/REPORT.PDF");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /non-web document/);
});

// ── Partial extension matches should pass ─────────────────────────────────────

test("isNonWebDocument returns false for .pdfs extension (not a known extension)", () => {
  assert.equal(isNonWebDocument(new URL("https://example.com/page.pdfs")), false);
});

test("validateTarget accepts URL with .htmls extension (not a blocked extension)", () => {
  const result = validateTarget("https://example.com/page.htmls");
  assert.equal(result.accepted, true);
});

// ── Non-http/https schemes ────────────────────────────────────────────────────

test("validateTarget rejects ftp:// URLs", () => {
  const result = validateTarget("ftp://files.example.com/data.zip");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /http\/https/);
});

test("validateTarget rejects file:// URLs", () => {
  const result = validateTarget("file:///home/user/index.html");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /http\/https/);
});

// ── IPv4 edge cases ────────────────────────────────────────────────────────────

test("validateTarget rejects 172.16.x.x (private range start)", () => {
  const result = validateTarget("http://172.16.0.1/");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /private\/internal IPv4/);
});

test("validateTarget rejects 172.31.x.x (private range end)", () => {
  const result = validateTarget("http://172.31.255.255/");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /private\/internal IPv4/);
});

test("validateTarget accepts 172.32.x.x (just outside private range)", () => {
  const result = validateTarget("http://172.32.0.1/");
  assert.equal(result.accepted, true);
});

test("validateTarget rejects 192.168.x.x private addresses", () => {
  const result = validateTarget("https://192.168.1.100/admin");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /private\/internal IPv4/);
});

test("validateTarget rejects 127.x.x.x loopback addresses", () => {
  const result = validateTarget("http://127.0.0.1/");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /private\/internal IPv4/);
});

// ── IPv6 edge cases ────────────────────────────────────────────────────────────

test("validateTarget rejects fc00::/7 private IPv6", () => {
  const result = validateTarget("https://[fc00::1]/");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /private\/internal IPv6/);
});

test("validateTarget rejects ::1 loopback IPv6", () => {
  const result = validateTarget("http://[::1]/");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /private\/internal IPv6/);
});

test("validateTarget rejects link-local fe80::/10 IPv6", () => {
  const result = validateTarget("https://[fe80::1]/");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /private\/internal IPv6/);
});

// ── URL normalization ─────────────────────────────────────────────────────────

test("validateTarget strips fragment from normalizedUrl", () => {
  const result = validateTarget("https://example.com/page#section");
  assert.equal(result.accepted, true);
  assert.ok(!result.normalizedUrl.includes("#"), "Fragment should be stripped from normalized URL");
});

test("validateTarget handles invalid URL format", () => {
  const result = validateTarget("not-a-url-at-all");
  assert.equal(result.accepted, false);
  assert.match(result.reason, /invalid URL/);
});

test("validateTarget handles empty string", () => {
  const result = validateTarget("");
  assert.equal(result.accepted, false);
});
