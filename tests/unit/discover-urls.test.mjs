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
