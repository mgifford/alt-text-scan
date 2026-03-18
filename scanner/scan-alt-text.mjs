/**
 * Alt Text Scanner module.
 *
 * Uses Playwright (Chromium) to load pages, extract all <img> elements, and
 * assess alt text quality against WCAG 1.1.1 criteria.
 *
 * stdout: JSON results only
 * stderr: progress/diagnostic messages
 */

// Lazy-load Playwright to allow importing in test environments without it
let playwright = null;

async function loadPlaywright() {
  if (!playwright) {
    playwright = await import("playwright");
  }
  return playwright;
}

/**
 * Words/phrases that suggest bad alt text practice.
 */
const SUSPICIOUS_PHRASES = [
  "image of",
  "graphic of",
  "picture of",
  "photo of",
  "thumbnail of",
  "screenshot of"
];

/**
 * Alt text values that are meaningless (single-word non-descriptors).
 */
const MEANINGLESS_VALUES = new Set([
  "alt",
  "chart",
  "decorative",
  "image",
  "graphic",
  "photo",
  "photograph",
  "picture",
  "placeholder",
  "placeholder image",
  "spacer",
  "tbd",
  "todo",
  "undefined",
  "none",
  "null",
  "img",
  "icon",
  "logo"
]);

/**
 * Values that indicate alt text is intentionally empty (decorative images).
 * An empty string alt="" is correct for decorative images per WCAG.
 */
const DECORATIVE_ROLES = new Set(["presentation", "none"]);

const STATUS_SEVERITY = {
  GOOD: 0,
  DECORATIVE: 1,
  SUSPICIOUS: 2,
  TOO_SHORT: 3,
  TOO_LONG: 3,
  FILENAME: 4,
  MISSING: 5
};

function normalizeVariantValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? "" : trimmed;
  }

  return String(value);
}

function variantKey(value) {
  if (value === null) {
    return "__NULL__";
  }
  if (value === "") {
    return "__EMPTY__";
  }
  return value;
}

function addVariant(variantMap, value, pageUrl) {
  const normalized = normalizeVariantValue(value);
  const key = variantKey(normalized);
  const existing = variantMap.get(key) || {
    value: normalized,
    count: 0,
    pages: new Set()
  };

  existing.count += 1;
  existing.pages.add(pageUrl);
  variantMap.set(key, existing);
}

function finalizeVariants(variantMap) {
  return Array.from(variantMap.values())
    .map((entry) => ({
      value: entry.value,
      count: entry.count,
      pages: Array.from(entry.pages)
    }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      const aLabel = a.value === null ? "" : String(a.value);
      const bLabel = b.value === null ? "" : String(b.value);
      return aLabel.localeCompare(bLabel);
    });
}

function pickRepresentativeValue(variants, preferNonEmpty = false) {
  if (!variants || variants.length === 0) {
    return null;
  }

  if (!preferNonEmpty) {
    return variants[0].value;
  }

  const nonEmpty = variants.find((variant) => variant.value !== null && variant.value !== "");
  return nonEmpty ? nonEmpty.value : variants[0].value;
}

function pickAggregateStatus(statusCountsMap) {
  let bestStatus = "GOOD";
  let bestScore = -1;

  for (const [status, count] of statusCountsMap.entries()) {
    if (!count) {
      continue;
    }
    const score = STATUS_SEVERITY[status] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestStatus = status;
    }
  }

  return bestStatus;
}

/**
 * Classify alt text quality for a single image.
 *
 * @param {object} img  Image data extracted from the page
 * @returns {object}  { status, issues[] }
 *   status: "MISSING" | "DECORATIVE" | "SUSPICIOUS" | "FILENAME" | "TOO_SHORT" | "TOO_LONG" | "GOOD"
 *   issues: string[]  Human-readable issue descriptions
 */
export function assessAltText(img) {
  const issues = [];
  const alt = img.alt;
  const role = (img.role ?? "").toLowerCase();
  const ariaHidden = img.ariaHidden;

  // aria-hidden="true" or role="presentation/none" → decorative, alt should be empty
  if (ariaHidden === "true" || DECORATIVE_ROLES.has(role)) {
    if (alt && alt.trim() !== "") {
      issues.push(
        'Image is marked decorative (aria-hidden or role="presentation/none") but has non-empty alt text'
      );
      return { status: "SUSPICIOUS", issues };
    }
    return { status: "DECORATIVE", issues };
  }

  // alt attribute is completely absent (not the same as empty string)
  if (alt === null || alt === undefined) {
    issues.push("WCAG 1.1.1 Failure: alt attribute is missing entirely");
    return { status: "MISSING", issues };
  }

  const trimmed = alt.trim();

  // Intentionally empty alt="" — valid for decorative images
  if (trimmed === "") {
    return { status: "DECORATIVE", issues };
  }

  const lower = trimmed.toLowerCase();

  // Meaningless single-word alt text
  if (MEANINGLESS_VALUES.has(lower)) {
    issues.push(`Alt text "${trimmed}" is not descriptive`);
    return { status: "SUSPICIOUS", issues };
  }

  // Alt text that looks like a filename (contains extension and no spaces)
  if (/\.(jpe?g|png|gif|svg|webp|avif|tiff?)$/i.test(trimmed) && !/\s/.test(trimmed)) {
    issues.push(`Alt text "${trimmed}" appears to be a filename`);
    return { status: "FILENAME", issues };
  }

  // Suspicious phrases
  for (const phrase of SUSPICIOUS_PHRASES) {
    if (lower.includes(phrase)) {
      issues.push(`Alt text contains redundant phrase "${phrase}"`);
    }
  }

  // Length checks
  if (trimmed.length < 3) {
    issues.push(`Alt text "${trimmed}" is too short (${trimmed.length} chars)`);
    return { status: "TOO_SHORT", issues };
  } else if (trimmed.length > 250) {
    issues.push(
      `Alt text is very long (${trimmed.length} chars); consider a shorter description or use aria-describedby for extended descriptions`
    );
    return { status: "TOO_LONG", issues };
  }

  if (issues.length > 0) {
    return { status: "SUSPICIOUS", issues };
  }

  return { status: "GOOD", issues: [] };
}

/**
 * Extract all image data from a loaded Playwright page.
 *
 * @param {import('playwright').Page} page
 * @param {string} pageUrl
 * @returns {Promise<object[]>}  Array of image records
 */
export async function extractImagesFromPage(page, pageUrl) {
  return page.evaluate((url) => {
    const images = [];
    const imgEls = document.querySelectorAll("img");

    for (const img of imgEls) {
      const src = img.getAttribute("src") || img.src || null;
      if (!src) continue;

      // Resolve relative URLs to absolute
      let absoluteSrc = src;
      try {
        absoluteSrc = new URL(src, url).href;
      } catch {
        // keep original
      }

      const rect = img.getBoundingClientRect();
      const isVisible =
        img.offsetParent !== null ||
        (rect.width > 0 && rect.height > 0) ||
        getComputedStyle(img).display !== "none";

      images.push({
        src: absoluteSrc,
        alt: img.hasAttribute("alt") ? img.getAttribute("alt") : null,
        title: img.getAttribute("title") || null,
        role: img.getAttribute("role") || null,
        ariaHidden: img.getAttribute("aria-hidden") || null,
        ariaLabel: img.getAttribute("aria-label") || null,
        ariaDescribedby: img.getAttribute("aria-describedby") || null,
        longdesc: img.getAttribute("longdesc") || null,
        width: img.naturalWidth || img.width || null,
        height: img.naturalHeight || img.height || null,
        isVisible,
        pageUrl: url
      });
    }

    return images;
  }, pageUrl);
}

/**
 * Scan a single URL for images and alt text.
 *
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @param {object} options
 * @param {number} options.pageLoadDelay  Extra ms to wait after load
 * @param {number} options.navTimeout     Navigation timeout in ms
 * @returns {Promise<{url: string, images: object[], error: string|null}>}
 */
async function scanOneUrl(browser, url, { pageLoadDelay = 500, navTimeout = 30000 } = {}) {
  let page = null;
  try {
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(navTimeout);

    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    const status = response?.status() ?? 0;

    if (status >= 400) {
      return {
        url,
        finalUrl: page.url(),
        httpStatus: status,
        images: [],
        error: `HTTP ${status}`
      };
    }

    if (pageLoadDelay > 0) {
      await page.waitForTimeout(pageLoadDelay);
    }

    const images = await extractImagesFromPage(page, page.url());

    return {
      url,
      finalUrl: page.url(),
      httpStatus: status,
      images,
      error: null
    };
  } catch (err) {
    return {
      url,
      finalUrl: url,
      httpStatus: null,
      images: [],
      error: err.message || String(err)
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

/**
 * Scan multiple URLs for images and alt text quality.
 *
 * @param {string[]} urls
 * @param {object} options
 * @param {number} options.pageLoadDelay  Extra ms to wait after navigation (default 500)
 * @param {number} options.navTimeout     Per-page navigation timeout ms (default 30000)
 * @param {number} options.totalTimeout   Total scan timeout ms (default 50 minutes)
 * @returns {Promise<object>}  Scan results
 */
export async function scanAltText(urls, options = {}) {
  const {
    pageLoadDelay = 500,
    navTimeout = 30000,
    totalTimeout = 3000000
  } = options;

  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch({ headless: true });

  const scannedAt = new Date().toISOString();
  const urlResults = [];
  const startTime = Date.now();

  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];

      if (Date.now() - startTime > totalTimeout) {
        console.error(`[scan-alt-text] Total timeout reached after ${i} URLs`);
        break;
      }

      console.error(`[scan-alt-text] [${i + 1}/${urls.length}] ${url}`);

      const result = await scanOneUrl(browser, url, { pageLoadDelay, navTimeout });

      // Assess alt text quality for each image
      const assessedImages = result.images.map((img) => {
        const assessment = assessAltText(img);
        return { ...img, ...assessment };
      });

      urlResults.push({ ...result, images: assessedImages });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // Aggregate statistics
  const totalImages = urlResults.reduce((sum, r) => sum + r.images.length, 0);
  const statusCounts = { MISSING: 0, DECORATIVE: 0, SUSPICIOUS: 0, FILENAME: 0, TOO_SHORT: 0, TOO_LONG: 0, GOOD: 0 };
  const imageMap = new Map(); // src → aggregate

  for (const r of urlResults) {
    for (const img of r.images) {
      statusCounts[img.status] = (statusCounts[img.status] ?? 0) + 1;

      // Aggregate by image src for cross-page deduplication
      const key = img.src;
      if (!imageMap.has(key)) {
        imageMap.set(key, {
          src: img.src,
          isVisible: Boolean(img.isVisible),
          width: img.width ?? null,
          height: img.height ?? null,
          occurrences: 0,
          pages: new Set(),
          issues: new Set(),
          statusCounts: new Map(),
          altVariants: new Map(),
          titleVariants: new Map(),
          ariaLabelVariants: new Map(),
          ariaDescribedbyVariants: new Map(),
          longdescVariants: new Map(),
          roleVariants: new Map()
        });
      }

      const aggregate = imageMap.get(key);
      aggregate.occurrences += 1;
      aggregate.pages.add(r.url);
      aggregate.isVisible = aggregate.isVisible || Boolean(img.isVisible);
      if (aggregate.width === null && img.width !== null && img.width !== undefined) {
        aggregate.width = img.width;
      }
      if (aggregate.height === null && img.height !== null && img.height !== undefined) {
        aggregate.height = img.height;
      }

      addVariant(aggregate.altVariants, img.alt, r.url);
      addVariant(aggregate.titleVariants, img.title, r.url);
      addVariant(aggregate.ariaLabelVariants, img.ariaLabel, r.url);
      addVariant(aggregate.ariaDescribedbyVariants, img.ariaDescribedby, r.url);
      addVariant(aggregate.longdescVariants, img.longdesc, r.url);
      addVariant(aggregate.roleVariants, img.role, r.url);

      for (const issue of img.issues || []) {
        aggregate.issues.add(issue);
      }

      aggregate.statusCounts.set(img.status, (aggregate.statusCounts.get(img.status) ?? 0) + 1);
    }
  }

  const uniqueImages = Array.from(imageMap.values()).map((entry) => {
    const altVariants = finalizeVariants(entry.altVariants);
    const titleVariants = finalizeVariants(entry.titleVariants);
    const ariaLabelVariants = finalizeVariants(entry.ariaLabelVariants);
    const ariaDescribedbyVariants = finalizeVariants(entry.ariaDescribedbyVariants);
    const longdescVariants = finalizeVariants(entry.longdescVariants);
    const roleVariants = finalizeVariants(entry.roleVariants);

    return {
      src: entry.src,
      alt: pickRepresentativeValue(altVariants, false),
      title: pickRepresentativeValue(titleVariants, true),
      ariaLabel: pickRepresentativeValue(ariaLabelVariants, true),
      ariaDescribedby: pickRepresentativeValue(ariaDescribedbyVariants, true),
      longdesc: pickRepresentativeValue(longdescVariants, true),
      role: pickRepresentativeValue(roleVariants, true),
      isVisible: entry.isVisible,
      width: entry.width,
      height: entry.height,
      status: pickAggregateStatus(entry.statusCounts),
      issues: Array.from(entry.issues),
      pages: Array.from(entry.pages),
      occurrences: entry.occurrences,
      altVariants,
      titleVariants,
      ariaLabelVariants,
      ariaDescribedbyVariants,
      longdescVariants,
      roleVariants
    };
  });

  const imagesWithIssues = uniqueImages.filter((img) => img.issues && img.issues.length > 0).length;

  return {
    scannedAt,
    urlsScanned: urlResults.length,
    totalImages,
    uniqueImages: uniqueImages.length,
    imagesWithIssues,
    statusCounts,
    urlResults,
    uniqueImageList: uniqueImages
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error("Usage: node scanner/scan-alt-text.mjs <url> [url2 ...]");
    process.exitCode = 1;
  } else {
    const result = await scanAltText(urls);
    process.stdout.write(JSON.stringify(result, null, 2));
  }
}
