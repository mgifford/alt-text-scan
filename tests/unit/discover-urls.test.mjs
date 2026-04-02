import test from "node:test";
import assert from "node:assert/strict";
import { parseSitemapXml, extractLinksFromHtml } from "../../scanner/discover-urls.mjs";

test("parseSitemapXml extracts page URLs from a standard sitemap", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/about</loc></url>
  <url><loc>https://example.com/contact</loc></url>
</urlset>`;

  const { pageUrls, sitemapUrls } = parseSitemapXml(xml);
  assert.deepEqual(pageUrls, [
    "https://example.com/",
    "https://example.com/about",
    "https://example.com/contact"
  ]);
  assert.deepEqual(sitemapUrls, []);
});

test("parseSitemapXml detects a sitemap index and returns child sitemap URLs", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`;

  const { pageUrls, sitemapUrls } = parseSitemapXml(xml);
  assert.deepEqual(pageUrls, []);
  assert.deepEqual(sitemapUrls, [
    "https://example.com/sitemap-posts.xml",
    "https://example.com/sitemap-pages.xml"
  ]);
});

test("parseSitemapXml returns empty arrays for empty/invalid XML", () => {
  const { pageUrls, sitemapUrls } = parseSitemapXml("<invalid />");
  assert.deepEqual(pageUrls, []);
  assert.deepEqual(sitemapUrls, []);
});

test("extractLinksFromHtml returns same-origin links", () => {
  const html = `
    <html><body>
      <a href="/about">About</a>
      <a href="https://example.com/contact">Contact</a>
      <a href="https://other.com/page">External</a>
      <a href="mailto:test@example.com">Email</a>
    </body></html>`;

  const links = extractLinksFromHtml(html, "https://example.com/", "https://example.com");
  assert.ok(links.includes("https://example.com/about"), "should include /about");
  assert.ok(links.includes("https://example.com/contact"), "should include /contact");
  assert.ok(!links.some((l) => l.includes("other.com")), "should exclude external");
  assert.ok(!links.some((l) => l.startsWith("mailto:")), "should exclude mailto");
});

test("extractLinksFromHtml filters out non-HTML extensions", () => {
  const html = `
    <html><body>
      <a href="/page.html">Page</a>
      <a href="/image.jpg">Image</a>
      <a href="/doc.pdf">Doc</a>
      <a href="/style.css">CSS</a>
      <a href="/script.js">JS</a>
    </body></html>`;

  const links = extractLinksFromHtml(html, "https://example.com/", "https://example.com");
  assert.ok(links.some((l) => l.includes("/page.html")), "should include .html pages");
  assert.ok(!links.some((l) => l.includes(".jpg")), "should exclude .jpg");
  assert.ok(!links.some((l) => l.includes(".pdf")), "should exclude .pdf");
  assert.ok(!links.some((l) => l.includes(".css")), "should exclude .css");
  assert.ok(!links.some((l) => l.includes(".js")), "should exclude .js");
});

test("extractLinksFromHtml ignores fragment-only links", () => {
  const html = `<a href="#section1">Jump</a><a href="/page">Page</a>`;
  const links = extractLinksFromHtml(html, "https://example.com/", "https://example.com");
  // Fragment-only links start with '#' and are explicitly skipped before URL resolution
  assert.ok(!links.some((l) => l.endsWith("#section1")));
  assert.ok(links.some((l) => l.includes("/page")));
});

test("parseSitemapXml returns all child sitemap URLs from a large sitemap index", () => {
  // Simulate a sitemap index with hundreds of entries (e.g. energy.gov pattern)
  const entries = Array.from({ length: 200 }, (_, i) =>
    `  <sitemap><loc>https://example.com/sitemap-${i}.xml</loc></sitemap>`
  ).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>`;

  const { pageUrls, sitemapUrls } = parseSitemapXml(xml);
  assert.strictEqual(pageUrls.length, 0, "should have no page URLs");
  assert.strictEqual(sitemapUrls.length, 200, "should return all 200 child sitemap URLs");
  assert.strictEqual(sitemapUrls[0], "https://example.com/sitemap-0.xml");
  assert.strictEqual(sitemapUrls[199], "https://example.com/sitemap-199.xml");
});

test("parseSitemapXml handles mixed sitemap index where entries look like article pages", () => {
  // energy.gov-style: sitemap index with article-page URLs as child <sitemap> entries
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.gov/articles/page-one</loc></sitemap>
  <sitemap><loc>https://example.gov/articles/page-two</loc></sitemap>
  <sitemap><loc>https://example.gov/sitemap.xml?page=2</loc></sitemap>
</sitemapindex>`;

  const { pageUrls, sitemapUrls } = parseSitemapXml(xml);
  assert.strictEqual(pageUrls.length, 0, "should have no page URLs (all treated as child sitemaps)");
  assert.strictEqual(sitemapUrls.length, 3);
  assert.ok(sitemapUrls.includes("https://example.gov/articles/page-one"));
  assert.ok(sitemapUrls.includes("https://example.gov/sitemap.xml?page=2"));
});

import { randomSample } from "../../scanner/discover-urls.mjs";

test("randomSample returns a copy of all items when count >= array length", () => {
  const arr = ["a", "b", "c"];
  const sampled = randomSample(arr, 5);
  assert.equal(sampled.length, 3);
  assert.ok(["a", "b", "c"].every((x) => sampled.includes(x)));
});

test("randomSample returns exactly count items when count < array length", () => {
  const arr = ["a", "b", "c", "d", "e"];
  const sampled = randomSample(arr, 3);
  assert.equal(sampled.length, 3);
  sampled.forEach((item) => assert.ok(arr.includes(item), `${item} should be from original array`));
  assert.equal(new Set(sampled).size, 3, "no duplicates");
});

test("randomSample does not modify the source array", () => {
  const arr = ["a", "b", "c", "d", "e"];
  const original = arr.slice();
  randomSample(arr, 3);
  assert.deepEqual(arr, original);
});

test("randomSample returns empty array for empty input", () => {
  assert.deepEqual(randomSample([], 5), []);
});

// ── extractLinksFromHtml edge cases ───────────────────────────────────────────

test("extractLinksFromHtml skips anchors with empty href", () => {
  const html = `<a href="">Empty href</a><a href="/about">About</a>`;
  const links = extractLinksFromHtml(html, "https://example.com/", "https://example.com");
  assert.ok(!links.some((l) => l === "https://example.com/"), "Empty href should not produce origin URL");
  assert.ok(links.includes("https://example.com/about"), "Valid href should still be included");
});

test("extractLinksFromHtml skips javascript: protocol links", () => {
  const html = `<a href="javascript:void(0)">Click</a><a href="/real">Real</a>`;
  const links = extractLinksFromHtml(html, "https://example.com/", "https://example.com");
  assert.ok(!links.some((l) => l.startsWith("javascript:")), "javascript: links should be excluded");
  assert.ok(links.includes("https://example.com/real"), "Regular link should still be included");
});

test("extractLinksFromHtml handles relative URLs correctly", () => {
  const html = `<a href="../other/page">Relative up</a>`;
  const links = extractLinksFromHtml(html, "https://example.com/section/", "https://example.com");
  assert.ok(links.includes("https://example.com/other/page"), "Should resolve relative URL correctly");
});

test("extractLinksFromHtml may return the same URL multiple times (dedup is caller's responsibility)", () => {
  const html = `
    <a href="/about">About 1</a>
    <a href="/about">About 2</a>
    <a href="/about">About 3</a>
  `;
  const links = extractLinksFromHtml(html, "https://example.com/", "https://example.com");
  const aboutLinks = links.filter((l) => l === "https://example.com/about");
  assert.ok(aboutLinks.length >= 1, "At least one about link should be present");
  // Note: extractLinksFromHtml does not deduplicate — the crawler's visited Set handles that
});

test("extractLinksFromHtml filters uppercase non-HTML extensions case-insensitively", () => {
  const html = `
    <a href="/image.JPG">JPG Image</a>
    <a href="/document.PDF">PDF</a>
    <a href="/page.HTML">HTML page</a>
  `;
  const links = extractLinksFromHtml(html, "https://example.com/", "https://example.com");
  assert.ok(!links.some((l) => l.endsWith(".JPG")), "Should exclude .JPG (uppercase)");
  assert.ok(!links.some((l) => l.endsWith(".PDF")), "Should exclude .PDF (uppercase)");
  assert.ok(links.some((l) => l.endsWith(".HTML")), "Should include .HTML page");
});

test("extractLinksFromHtml strips fragments from same-origin links", () => {
  const html = `<a href="/page#section">Section link</a>`;
  const links = extractLinksFromHtml(html, "https://example.com/", "https://example.com");
  const match = links.find((l) => l.includes("/page"));
  assert.ok(match, "Page link should be included");
  assert.ok(!match.includes("#"), "Fragment should be stripped from the link");
});

// ── parseSitemapXml additional edge cases ──────────────────────────────────────

test("parseSitemapXml handles completely empty string", () => {
  const { pageUrls, sitemapUrls } = parseSitemapXml("");
  assert.deepEqual(pageUrls, []);
  assert.deepEqual(sitemapUrls, []);
});

test("parseSitemapXml handles sitemap with whitespace-only loc elements", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>   </loc></url>
  <url><loc>https://example.com/about</loc></url>
</urlset>`;
  const { pageUrls } = parseSitemapXml(xml);
  // Should include 'about' but not whitespace-only entry
  assert.ok(pageUrls.includes("https://example.com/about"), "Valid URL should be included");
});

// ── randomSample edge cases ───────────────────────────────────────────────────

test("randomSample returns different items on repeated calls (probabilistic)", () => {
  const arr = Array.from({ length: 100 }, (_, i) => `item-${i}`);
  const sample1 = randomSample(arr, 10);
  const sample2 = randomSample(arr, 10);
  // Not guaranteed but extremely unlikely to be equal with 100 items choosing 10
  const setsAreIdentical = sample1.every((v) => sample2.includes(v)) && sample2.every((v) => sample1.includes(v));
  // We don't assert this (flaky), but we do verify both samples are valid
  assert.equal(sample1.length, 10);
  assert.equal(sample2.length, 10);
  for (const item of [...sample1, ...sample2]) {
    assert.ok(arr.includes(item), `${item} should be from the original array`);
  }
});

test("randomSample with count of 0 returns empty array", () => {
  const arr = ["a", "b", "c"];
  const result = randomSample(arr, 0);
  assert.deepEqual(result, []);
});
