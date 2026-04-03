/**
 * URL Discovery module.
 *
 * Given a root domain, discovers page URLs by:
 *   1. Attempting to fetch and parse /sitemap.xml (including sitemap indexes)
 *   2. Falling back to a breadth-first crawl of same-domain HTML links
 *
 * Only uses Node.js built-in `fetch` (available in Node ≥ 18) — no extra deps.
 *
 * stdout: JSON output only
 * stderr: progress/diagnostic messages
 */

// Maximum number of child sitemaps to fetch from a sitemap index.
// Prevents runaway processing when a sitemap index has thousands of entries.
const MAX_SITEMAP_CHILDREN = parseInt(process.env.MAX_SITEMAP_CHILDREN || "50", 10);

// Common alternative sitemap paths to try when /sitemap.xml fails.
const ALTERNATIVE_SITEMAP_PATHS = [
  "/sitemap_index.xml",
  "/sitemap-index.xml",
  "/sitemaps/sitemap.xml",
  "/wp-sitemap.xml",
];

/**
 * Randomly sample up to `count` items from an array using a partial Fisher-Yates shuffle.
 * Returns a new array; the source array is not modified.
 * @param {string[]} arr - The source array
 * @param {number} count - Maximum number of items to return
 * @returns {string[]}
 */
export function randomSample(arr, count) {
  if (count >= arr.length) return arr.slice();
  const copy = arr.slice();
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

// Maximum wall-clock time (ms) to spend on sitemap-based URL discovery.
// If exceeded, the partially-collected URL list is returned (or the crawl
// fallback is skipped) so the scan can proceed with what was found.
const SITEMAP_DISCOVERY_TIMEOUT_MS = parseInt(
  process.env.SITEMAP_DISCOVERY_TIMEOUT_MS || "300000",   // 5 minutes
  10
);

const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "bmp", "svg", "ico", "webp", "tiff", "tif", "avif",
  "mp3", "wav", "ogg", "mp4", "avi", "mov", "wmv", "mkv", "webm",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "zip", "tar", "gz", "bz2", "rar",
  "exe", "dmg", "pkg", "msi",
  "css", "js", "json", "xml", "rss", "atom",
  "ttf", "otf", "woff", "woff2"
]);

/**
 * Return true when a URL pathname ends with a non-HTML extension.
 * @param {string} urlStr
 * @returns {boolean}
 */
function isNonHtmlUrl(urlStr) {
  try {
    const pathname = new URL(urlStr).pathname.toLowerCase();
    const dot = pathname.lastIndexOf(".");
    if (dot === -1) return false;
    const ext = pathname.slice(dot + 1);
    return IMAGE_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

/**
 * Normalise a URL: strip fragment, trailing slash (except root), lowercase scheme+host.
 * @param {string} urlStr
 * @returns {string|null}
 */
function normalizeUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    u.hash = "";
    // Collapse duplicate trailing slashes on path
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Return true if `url` belongs to `origin` (same scheme+host+port).
 * @param {string} urlStr
 * @param {string} origin  e.g. "https://example.com"
 * @returns {boolean}
 */
function isSameOrigin(urlStr, origin) {
  try {
    return new URL(urlStr).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Fetch a URL with a timeout, returning the response or null on error.
 * @param {string} urlStr
 * @param {number} timeoutMs
 * @returns {Promise<Response|null>}
 */
async function fetchWithTimeout(urlStr, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(urlStr, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "alt-text-scanner/1.0 (https://github.com/mgifford/alt-text-scan; accessibility bot)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      redirect: "follow"
    });
    return resp;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract URLs from a sitemap XML string.
 * Handles both <loc> entries and nested <sitemap><loc> indexes.
 * @param {string} xmlText
 * @returns {{pageUrls: string[], sitemapUrls: string[]}}
 */
export function parseSitemapXml(xmlText) {
  const pageUrls = [];
  const sitemapUrls = [];

  // Sitemap index: <sitemap><loc>…</loc></sitemap>
  const sitemapRe = /<sitemap[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi;
  let m;
  while ((m = sitemapRe.exec(xmlText)) !== null) {
    const url = m[1].trim();
    if (url) sitemapUrls.push(url);
  }

  if (sitemapUrls.length > 0) {
    return { pageUrls: [], sitemapUrls };
  }

  // Standard sitemap: <url><loc>…</loc></url>
  const urlRe = /<url[\s\S]*?<loc>([\s\S]*?)<\/loc>/gi;
  while ((m = urlRe.exec(xmlText)) !== null) {
    const url = m[1].trim();
    if (url) pageUrls.push(url);
  }

  return { pageUrls, sitemapUrls: [] };
}

/**
 * Extract `Sitemap:` directives from a robots.txt string.
 * @param {string} robotsText
 * @returns {string[]}  Array of sitemap URLs found in robots.txt
 */
export function parseRobotsTxt(robotsText) {
  const sitemapUrls = [];
  for (const line of robotsText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith("sitemap:")) {
      const url = trimmed.slice("sitemap:".length).trim();
      if (url) sitemapUrls.push(url);
    }
  }
  return sitemapUrls;
}

/**
 * Fetch and parse robots.txt, returning any sitemap URLs listed there.
 * @param {string} origin  e.g. "https://example.com"
 * @returns {Promise<string[]>}
 */
async function fetchRobotsTxt(origin) {
  const robotsUrl = `${origin}/robots.txt`;
  console.error(`[discover-urls] Checking robots.txt at ${robotsUrl}`);
  const resp = await fetchWithTimeout(robotsUrl, 10000);
  if (!resp || !resp.ok) {
    console.error(`[discover-urls] robots.txt fetch failed: ${robotsUrl} (${resp?.status ?? "no response"})`);
    return [];
  }
  let text;
  try {
    text = await resp.text();
  } catch (err) {
    console.error(`[discover-urls] robots.txt body read failed: ${robotsUrl} (${err.message || err})`);
    return [];
  }
  const found = parseRobotsTxt(text);
  if (found.length > 0) {
    console.error(`[discover-urls] Found ${found.length} sitemap(s) in robots.txt`);
  }
  return found;
}

/**
 * Recursively fetch a sitemap (and any nested sitemaps) and collect page URLs.
 * @param {string} sitemapUrl
 * @param {string} origin  Root origin (used to filter off-domain URLs)
 * @param {number} maxUrls
 * @param {number} depth  Max recursion depth for sitemap indexes
 * @param {number} deadline  Absolute timestamp (ms) after which to stop fetching
 * @returns {Promise<string[]>}
 */
async function fetchSitemap(sitemapUrl, origin, maxUrls, depth = 3, deadline = Infinity) {
  if (depth <= 0) return [];
  if (Date.now() >= deadline) {
    console.error(`[discover-urls] Sitemap discovery deadline exceeded, skipping ${sitemapUrl}`);
    return [];
  }

  const resp = await fetchWithTimeout(sitemapUrl);
  if (!resp || !resp.ok) {
    console.error(`[discover-urls] Sitemap fetch failed: ${sitemapUrl} (${resp?.status ?? "no response"})`);
    return [];
  }

  let text;
  try {
    text = await resp.text();
  } catch (err) {
    console.error(`[discover-urls] Sitemap body read failed: ${sitemapUrl} (${err.message || err})`);
    return [];
  }
  const { pageUrls, sitemapUrls } = parseSitemapXml(text);

  if (sitemapUrls.length > 0) {
    // Sitemap index — recurse into each child sitemap.
    // Cap the number of children tried to avoid runaway processing on huge indexes.
    const childLimit = Math.min(sitemapUrls.length, MAX_SITEMAP_CHILDREN);
    if (sitemapUrls.length > childLimit) {
      console.error(
        `[discover-urls] Sitemap index has ${sitemapUrls.length} child sitemaps; ` +
        `processing first ${childLimit} (set MAX_SITEMAP_CHILDREN to override)`
      );
    }
    const all = [];
    for (let i = 0; i < childLimit; i++) {
      if (all.length >= maxUrls) break;
      // Check deadline before each child fetch — if already exceeded, stop here
      // rather than entering fetchSitemap only to return immediately at the top.
      if (Date.now() >= deadline) {
        console.error(
          `[discover-urls] Sitemap discovery deadline exceeded after processing ` +
          `${i} of ${childLimit} child sitemaps`
        );
        break;
      }
      const childPages = await fetchSitemap(sitemapUrls[i], origin, maxUrls - all.length, depth - 1, deadline);
      all.push(...childPages);
    }
    return all;
  }

  // Filter to same-origin HTML pages only
  return pageUrls
    .filter((u) => isSameOrigin(u, origin) && !isNonHtmlUrl(u))
    .slice(0, maxUrls);
}

/**
 * Extract same-origin HTML links from a page's HTML content.
 * @param {string} html
 * @param {string} pageUrl  The URL of the page (for resolving relative links)
 * @param {string} origin
 * @returns {string[]}
 */
export function extractLinksFromHtml(html, pageUrl, origin) {
  const links = [];
  const hrefRe = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    const raw = m[1].trim();
    // Skip fragment-only, javascript, mailto, and data links
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:") ||
        raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("data:")) {
      continue;
    }
    try {
      const abs = new URL(raw, pageUrl).toString();
      const norm = normalizeUrl(abs);
      if (norm && isSameOrigin(norm, origin) && !isNonHtmlUrl(norm)) {
        links.push(norm);
      }
    } catch {
      // skip malformed
    }
  }
  return links;
}

/**
 * Breadth-first crawl of a domain, collecting HTML page URLs.
 * @param {string} startUrl  The root URL to start from (e.g. "https://example.com")
 * @param {number} maxPages
 * @returns {Promise<string[]>}
 */
async function crawlDomain(startUrl, maxPages = 100) {
  const origin = new URL(startUrl).origin;
  const visited = new Set();
  const queue = [normalizeUrl(startUrl)];
  const found = [];

  while (queue.length > 0 && found.length < maxPages) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);

    console.error(`[discover-urls] Crawling ${url}`);
    const resp = await fetchWithTimeout(url, 20000);
    if (!resp || !resp.ok) {
      console.error(`[discover-urls] Crawl fetch failed: ${url} (${resp?.status ?? "no response"})`);
      continue;
    }

    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) continue;

    found.push(url);

    let html;
    try {
      html = await resp.text();
    } catch (err) {
      console.error(`[discover-urls] Page body read failed: ${url} (${err.message || err})`);
      continue;
    }
    const links = extractLinksFromHtml(html, url, origin);
    for (const link of links) {
      if (!visited.has(link)) {
        queue.push(link);
      }
    }
  }

  return found;
}

/**
 * Discover page URLs for a given domain.
 *
 * Strategy:
 *   1. Try /sitemap.xml (including sitemap indexes)
 *   2. If that fails, check robots.txt for Sitemap: directives and try each
 *   3. If still no URLs, try common alternative sitemap paths
 *   4. If all sitemap approaches fail, fall back to BFS crawl
 *
 * Sitemap discovery is bounded by SITEMAP_DISCOVERY_TIMEOUT_MS (default 5 min)
 * and MAX_SITEMAP_CHILDREN (default 50) to prevent runaway processing on sites
 * with huge or malformed sitemap indexes.
 *
 * @param {string} domain   Root domain, e.g. "https://example.com"
 * @param {number} maxUrls  Maximum number of page URLs to return (default 100)
 * @returns {Promise<{urls: string[], method: "sitemap"|"crawl", total: number}>}
 */
export async function discoverUrls(domain, maxUrls = 100) {
  const origin = new URL(domain).origin;
  const sitemapUrl = `${origin}/sitemap.xml`;
  const deadline = Date.now() + SITEMAP_DISCOVERY_TIMEOUT_MS;
  const triedSitemaps = new Set([sitemapUrl]);

  console.error(`[discover-urls] Trying sitemap at ${sitemapUrl}`);
  let sitemapPages = await fetchSitemap(sitemapUrl, origin, maxUrls, 3, deadline);

  // If /sitemap.xml failed, check robots.txt for Sitemap: directives
  if (sitemapPages.length === 0) {
    const robotsSitemaps = await fetchRobotsTxt(origin);
    for (const rsUrl of robotsSitemaps) {
      if (sitemapPages.length > 0) break;
      if (triedSitemaps.has(rsUrl)) continue;
      triedSitemaps.add(rsUrl);
      console.error(`[discover-urls] Trying sitemap from robots.txt: ${rsUrl}`);
      sitemapPages = await fetchSitemap(rsUrl, origin, maxUrls, 3, deadline);
    }
  }

  // If still no URLs, try common alternative sitemap paths
  if (sitemapPages.length === 0) {
    for (const path of ALTERNATIVE_SITEMAP_PATHS) {
      if (sitemapPages.length > 0) break;
      const altUrl = `${origin}${path}`;
      if (triedSitemaps.has(altUrl)) continue;
      triedSitemaps.add(altUrl);
      console.error(`[discover-urls] Trying alternative sitemap: ${altUrl}`);
      sitemapPages = await fetchSitemap(altUrl, origin, maxUrls, 3, deadline);
    }
  }

  if (sitemapPages.length > 0) {
    const total = sitemapPages.length;
    const sampled = sitemapPages.length > maxUrls
      ? randomSample(sitemapPages, maxUrls)
      : sitemapPages;
    console.error(`[discover-urls] Found ${total} URLs via sitemap, selected ${sampled.length}`);
    return {
      urls: sampled,
      method: "sitemap",
      total
    };
  }

  console.error(`[discover-urls] No sitemap pages found, falling back to crawl`);
  const crawlPages = await crawlDomain(origin, maxUrls);
  console.error(`[discover-urls] Found ${crawlPages.length} URLs via crawl`);

  return {
    urls: crawlPages,
    method: "crawl",
    total: crawlPages.length
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const domain = process.argv[2];
  const maxUrls = parseInt(process.argv[3] || "100", 10);
  if (!domain) {
    console.error("Usage: node scanner/discover-urls.mjs <domain> [maxUrls]");
    process.exitCode = 1;
  } else {
    const result = await discoverUrls(domain, maxUrls);
    process.stdout.write(JSON.stringify(result, null, 2));
  }
}
