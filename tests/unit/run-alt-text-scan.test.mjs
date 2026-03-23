import test from "node:test";
import assert from "node:assert/strict";

import { sortUniqueImageList, toHtml, truncateUrl, renderAltVariantsHtml, renderAltVariantsText } from "../../scanner/run-alt-text-scan.mjs";

function createImage(overrides = {}) {
  return {
    src: "https://example.com/default.png",
    alt: "Example image",
    title: null,
    ariaLabel: null,
    ariaDescribedby: null,
    longdesc: null,
    role: null,
    isVisible: true,
    width: 240,
    height: 120,
    status: "GOOD",
    issues: [],
    pages: ["https://example.com/page"],
    occurrences: 1,
    altVariants: [{ value: "Example image", count: 1 }],
    titleVariants: [],
    ariaLabelVariants: [],
    ariaDescribedbyVariants: [],
    longdescVariants: [],
    roleVariants: [],
    ...overrides
  };
}

test("sortUniqueImageList prioritizes flagged images before non-issues", () => {
  const sorted = sortUniqueImageList([
    createImage({ src: "https://example.com/good.png", status: "GOOD" }),
    createImage({
      src: "https://example.com/suspicious.png",
      status: "SUSPICIOUS",
      issues: ["Suspicious alt text"]
    }),
    createImage({ src: "https://example.com/decorative.png", status: "DECORATIVE", alt: "" })
  ]);

  assert.equal(sorted[0].src, "https://example.com/suspicious.png");
  assert.equal(sorted[1].src, "https://example.com/decorative.png");
  assert.equal(sorted[2].src, "https://example.com/good.png");
});

test("toHtml includes hidden thumbnail columns and preview dialog controls", () => {
  const scanResult = {
    statusCounts: {
      MISSING: 0,
      DECORATIVE: 0,
      SUSPICIOUS: 1,
      FILENAME: 0,
      TOO_SHORT: 0,
      TOO_LONG: 0,
      GOOD: 1
    },
    urlsScanned: 1,
    totalImages: 2,
    uniqueImages: 2,
    imagesWithIssues: 1,
    scannedAt: "2026-03-19T00:00:00.000Z",
    uniqueImageList: [
      createImage({
        src: "https://example.com/suspicious.png",
        status: "SUSPICIOUS",
        issues: ["Suspicious alt text"]
      }),
      createImage({ src: "https://example.com/good.png", status: "GOOD" })
    ]
  };

  const meta = {
    scanDomain: "https://example.com",
    discoveryMethod: "explicit URLs"
  };

  const html = toHtml(scanResult, meta);

  assert.match(html, /id="toggle-thumbnails"/);
  assert.match(html, /class="thumbnail-column" hidden/);
  assert.match(html, /class="thumbnail-trigger"/);
  assert.match(html, /id="image-preview-dialog"/);
  assert.ok(!html.includes('addEventListener("mouseenter"'), 'Hover should not open the preview dialog');
  assert.match(html, /Showing all 2 unique image URLs, with flagged items listed first/);
  assert.ok(
    html.indexOf("https://example.com/suspicious.png") < html.indexOf("https://example.com/good.png"),
    "Flagged images should appear before non-flagged images in the inventory"
  );
  assert.match(html, /id="image-preview-view-full"/, "Modal should include view full image link");

  // Toggle button must appear immediately after the "Unique image inventory" heading
  const headingPos = html.indexOf("Unique image inventory");
  const buttonPos = html.indexOf('id="toggle-thumbnails"');
  assert.ok(headingPos > -1, "Unique image inventory heading should be present");
  assert.ok(buttonPos > headingPos, "Toggle button should appear after the Unique image inventory heading");

  // Summary section must appear before the toggle button (toggle is under the inventory heading, not at top of page)
  const summaryPos = html.indexOf('class="summary"');
  assert.ok(summaryPos > -1, "Summary section should be present");
  assert.ok(summaryPos < headingPos, "Summary section should precede the Unique image inventory heading");

  // skipNextFocusTrigger guard must be present to prevent dialog re-opening loop
  assert.match(html, /skipNextFocusTrigger/, "Focus guard variable should be present to prevent dialog re-open on return focus");
});

test("truncateUrl returns short URLs unchanged", () => {
  assert.equal(truncateUrl("https://example.com/img.jpg"), "https://example.com/img.jpg");
});

test("truncateUrl truncates long URLs keeping protocol start and filename", () => {
  const long = "https://storage.googleapis.com/ca-it-prod-home-5918-strapi/production/chianti_lomax_4765e8b1ed/chianti_lomax_4765e8b1ed.jpg";
  const result = truncateUrl(long);
  assert.ok(result.length < long.length, "Result should be shorter than the original URL");
  assert.ok(result.startsWith("https://"), "Result should start with the protocol");
  assert.ok(result.includes("chianti_lomax_4765e8b1ed.jpg"), "Result should include the filename");
  assert.ok(result.includes("\u2026"), "Result should contain an ellipsis character");
});

test("truncateUrl uses simple truncation when filename alone exceeds maxLength", () => {
  const longFilename = "https://example.com/" + "x".repeat(70) + ".jpg";
  const result = truncateUrl(longFilename);
  assert.ok(result.endsWith("\u2026"), "Should end with ellipsis for simple truncation");
  assert.ok(result.length <= 61, "Simple truncation result should be at most maxLength + 1 (for ellipsis)");
});

test("toHtml uses mid-truncated URLs with tooltip for long image srcs", () => {
  const longSrc = "https://storage.googleapis.com/long-bucket/path/to/deeply/nested/unique_image_file.jpg";
  const scanResult = {
    statusCounts: { GOOD: 1 },
    urlsScanned: 1,
    totalImages: 1,
    uniqueImages: 1,
    imagesWithIssues: 0,
    scannedAt: "2026-03-19T00:00:00.000Z",
    uniqueImageList: [
      createImage({ src: longSrc, status: "GOOD" })
    ]
  };
  const meta = { scanDomain: "https://example.com", discoveryMethod: "explicit URLs" };
  const html = toHtml(scanResult, meta);
  assert.match(html, /url-cell/, "URL cell class should be present");
  assert.match(html, /url-tooltip/, "URL tooltip class should be present");
  assert.match(html, /unique_image_file\.jpg/, "Filename portion of URL should be visible");
});

// ── renderAltVariantsHtml ────────────────────────────────────────────────────

test("renderAltVariantsHtml returns none when variants array is empty", () => {
  const result = renderAltVariantsHtml([]);
  assert.match(result, /none/, "Should indicate no variants");
});

test("renderAltVariantsHtml shows Consistent for a single variant", () => {
  const result = renderAltVariantsHtml([{ value: "A dog in a park", count: 3 }]);
  assert.match(result, /Consistent/, "Should show Consistent indicator");
  assert.ok(!result.includes("A dog in a park"), "Should not repeat the alt text value");
  assert.match(result, /3/, "Should mention the occurrence count");
});

test("renderAltVariantsHtml shows Consistent for a single variant appearing once", () => {
  const result = renderAltVariantsHtml([{ value: "Logo", count: 1 }]);
  assert.match(result, /Consistent/, "Should show Consistent for a single-occurrence variant");
  assert.match(result, /1/, "Should mention count");
  assert.match(result, /aria-hidden="true"/, "Checkmark should be hidden from screen readers");
});

test("renderAltVariantsHtml lists all values with counts when multiple variants exist", () => {
  const result = renderAltVariantsHtml([
    { value: "Photo of a dog", count: 2 },
    { value: "Dog photo", count: 1 }
  ]);
  assert.match(result, /Photo of a dog/, "Should include first variant value");
  assert.match(result, /Dog photo/, "Should include second variant value");
  assert.match(result, /×2/, "Should show count for first variant");
  assert.match(result, /×1/, "Should show count for second variant");
  assert.ok(!result.includes("Consistent"), "Should not show Consistent when values differ");
  assert.match(result, /visually-hidden/, "Should use visually-hidden span for screen-reader count text");
  assert.match(result, /aria-hidden="true"/, "Should hide visual × symbol from screen readers");
});

test("renderAltVariantsHtml handles null and empty variant values", () => {
  const result = renderAltVariantsHtml([
    { value: null, count: 1 },
    { value: "", count: 2 }
  ]);
  assert.match(result, /missing/, "Should label null value as missing");
  assert.match(result, /empty/, "Should label empty string as empty");
});

// ── renderAltVariantsText ────────────────────────────────────────────────────

test("renderAltVariantsText returns empty string for empty array", () => {
  assert.equal(renderAltVariantsText([]), "");
});

test("renderAltVariantsText returns 'consistent' for a single variant", () => {
  assert.equal(renderAltVariantsText([{ value: "Logo", count: 5 }]), "consistent");
});

test("renderAltVariantsText lists values with counts for multiple variants", () => {
  const result = renderAltVariantsText([
    { value: "Photo of a dog", count: 2 },
    { value: "Dog photo", count: 1 }
  ]);
  assert.match(result, /Photo of a dog \(×2\)/, "Should include first variant with count");
  assert.match(result, /Dog photo \(×1\)/, "Should include second variant with count");
});

// ── toHtml Alt Variants column ───────────────────────────────────────────────

test("toHtml inventory table header includes tooltip on Alt Variants column", () => {
  const scanResult = {
    statusCounts: { GOOD: 1 },
    urlsScanned: 1,
    totalImages: 1,
    uniqueImages: 1,
    imagesWithIssues: 0,
    scannedAt: "2026-03-19T00:00:00.000Z",
    uniqueImageList: [createImage()]
  };
  const meta = { scanDomain: "https://example.com", discoveryMethod: "explicit URLs" };
  const html = toHtml(scanResult, meta);
  assert.match(html, /title="All distinct alt text values/, "Alt Variants header should have an explanatory title tooltip");
});

test("toHtml shows Consistent in Alt Variants cell when only one variant", () => {
  const scanResult = {
    statusCounts: { GOOD: 1 },
    urlsScanned: 1,
    totalImages: 1,
    uniqueImages: 1,
    imagesWithIssues: 0,
    scannedAt: "2026-03-19T00:00:00.000Z",
    uniqueImageList: [
      createImage({ altVariants: [{ value: "Example image", count: 1 }] })
    ]
  };
  const meta = { scanDomain: "https://example.com", discoveryMethod: "explicit URLs" };
  const html = toHtml(scanResult, meta);
  assert.match(html, /Consistent/, "Should show Consistent when only one alt variant exists");
});