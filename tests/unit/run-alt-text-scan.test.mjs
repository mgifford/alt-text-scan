import test from "node:test";
import assert from "node:assert/strict";

import {
  sortUniqueImageList,
  toHtml,
  toMarkdown,
  toCsv,
  truncateUrl,
  renderAltVariantsHtml,
  renderAltVariantsText
} from "../../scanner/run-alt-text-scan.mjs";

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
  assert.match(html, /Showing 2 images with alt text, with flagged items listed first/);
  assert.match(html, /Show thumbnails for images with alt text/);
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

test("toHtml shows decorative images section with visible thumbnails when decorative images are present", () => {
  const scanResult = {
    statusCounts: { DECORATIVE: 2, GOOD: 1 },
    urlsScanned: 1,
    totalImages: 3,
    uniqueImages: 3,
    imagesWithIssues: 0,
    scannedAt: "2026-03-19T00:00:00.000Z",
    uniqueImageList: [
      createImage({ src: "https://example.com/dec1.png", alt: "", status: "DECORATIVE", issues: [] }),
      createImage({ src: "https://example.com/dec2.png", alt: "", status: "DECORATIVE", ariaLabel: "team photo", issues: [] }),
      createImage({ src: "https://example.com/good.png", status: "GOOD" })
    ]
  };
  const meta = { scanDomain: "https://example.com", discoveryMethod: "explicit URLs" };
  const html = toHtml(scanResult, meta);

  // Decorative section heading and callout should be present
  assert.match(html, /Decorative images.*please review/i, "Decorative section heading should be present");
  assert.match(html, /review-callout/, "Review callout should be present");
  assert.match(html, /does it convey meaningful/, "Challenge message should be present");

  // Decorative thumbnail columns must NOT have hidden attribute
  assert.match(html, /thumbnail-column-decorative/, "Decorative thumbnail column class should be present");
  assert.ok(!html.includes('class="thumbnail-column-decorative" hidden'), "Decorative thumbnails should not be hidden");

  // Non-decorative inventory should still have hidden thumbnails
  assert.match(html, /class="thumbnail-column" hidden/, "Non-decorative thumbnail columns should be hidden");

  // Toggle button reflects new label
  assert.match(html, /Show thumbnails for images with alt text/, "Toggle button should clarify it targets images with alt text");

  // ARIA label shown for decorative images that have one
  assert.match(html, /team photo/, "ARIA label value should appear in the decorative section");
});

test("toHtml omits decorative section when no decorative images are present", () => {
  const scanResult = {
    statusCounts: { GOOD: 1 },
    urlsScanned: 1,
    totalImages: 1,
    uniqueImages: 1,
    imagesWithIssues: 0,
    scannedAt: "2026-03-19T00:00:00.000Z",
    uniqueImageList: [
      createImage({ src: "https://example.com/good.png", status: "GOOD" })
    ]
  };
  const meta = { scanDomain: "https://example.com", discoveryMethod: "explicit URLs" };
  const html = toHtml(scanResult, meta);

  assert.ok(!html.includes("Decorative images \u2014 please review"), "Decorative section heading should not appear when there are no decorative images");
  assert.ok(!html.includes('class="review-callout"'), "Review callout element should not appear when there are no decorative images");
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
// ── sortUniqueImageList edge cases ────────────────────────────────────────────

test("sortUniqueImageList returns empty array for empty input", () => {
  assert.deepEqual(sortUniqueImageList([]), []);
});

test("sortUniqueImageList returns single item unchanged", () => {
  const img = createImage({ src: "https://example.com/single.png", status: "GOOD" });
  const result = sortUniqueImageList([img]);
  assert.equal(result.length, 1);
  assert.equal(result[0].src, "https://example.com/single.png");
});

test("sortUniqueImageList does not mutate the input array", () => {
  const imgs = [
    createImage({ src: "https://example.com/good.png", status: "GOOD" }),
    createImage({ src: "https://example.com/missing.png", status: "MISSING", issues: ["Missing alt"] })
  ];
  const originalOrder = imgs.map((i) => i.src);
  sortUniqueImageList(imgs);
  assert.deepEqual(imgs.map((i) => i.src), originalOrder, "Input array should not be mutated");
});

test("sortUniqueImageList orders by full STATUS_PRIORITY: MISSING < FILENAME < SUSPICIOUS < TOO_SHORT/TOO_LONG < DECORATIVE < GOOD", () => {
  const imgs = [
    createImage({ src: "g.png", status: "GOOD", issues: [] }),
    createImage({ src: "d.png", status: "DECORATIVE", issues: [] }),
    createImage({ src: "ts.png", status: "TOO_SHORT", issues: ["Too short"] }),
    createImage({ src: "s.png", status: "SUSPICIOUS", issues: ["Suspicious"] }),
    createImage({ src: "f.png", status: "FILENAME", issues: ["Filename"] }),
    createImage({ src: "m.png", status: "MISSING", issues: ["Missing alt"] }),
    createImage({ src: "tl.png", status: "TOO_LONG", issues: ["Too long"] })
  ];

  const sorted = sortUniqueImageList(imgs);
  const order = sorted.map((i) => i.status);

  // Images with issues come first, then non-issue images
  const issueStatuses = order.slice(0, sorted.filter((i) => i.issues.length > 0).length);
  for (const s of issueStatuses) {
    assert.ok(["MISSING", "FILENAME", "SUSPICIOUS", "TOO_SHORT", "TOO_LONG"].includes(s));
  }

  // MISSING should be before FILENAME
  assert.ok(order.indexOf("MISSING") < order.indexOf("FILENAME"), "MISSING before FILENAME");
  // FILENAME before SUSPICIOUS
  assert.ok(order.indexOf("FILENAME") < order.indexOf("SUSPICIOUS"), "FILENAME before SUSPICIOUS");
  // DECORATIVE and GOOD are non-issue and come last
  assert.ok(order.indexOf("DECORATIVE") > order.indexOf("SUSPICIOUS"), "DECORATIVE after issue statuses");
  assert.ok(order.indexOf("GOOD") > order.indexOf("DECORATIVE"), "GOOD last");
});

test("sortUniqueImageList sorts images with same status by page count descending", () => {
  const imgs = [
    createImage({ src: "a.png", status: "SUSPICIOUS", issues: ["s"], pages: ["p1"], occurrences: 1 }),
    createImage({ src: "b.png", status: "SUSPICIOUS", issues: ["s"], pages: ["p1", "p2", "p3"], occurrences: 3 }),
    createImage({ src: "c.png", status: "SUSPICIOUS", issues: ["s"], pages: ["p1", "p2"], occurrences: 2 })
  ];
  const sorted = sortUniqueImageList(imgs);
  assert.equal(sorted[0].src, "b.png", "Most pages first");
  assert.equal(sorted[1].src, "c.png");
  assert.equal(sorted[2].src, "a.png");
});

// ── toCsv ────────────────────────────────────────────────────────────────────

test("toCsv produces a CSV with a header row and one data row per image", () => {
  const images = [
    createImage({ src: "https://example.com/img.png", alt: "A dog", status: "GOOD" })
  ];
  const csv = toCsv(images);
  const lines = csv.split("\n");
  assert.ok(lines.length >= 2, "Should have header + at least one data row");
  assert.ok(lines[0].includes("Image URL"), "Header should contain Image URL");
  assert.ok(lines[0].includes("Alt Text"), "Header should contain Alt Text");
  assert.ok(lines[0].includes("Status"), "Header should contain Status");
  assert.ok(lines[1].includes("https://example.com/img.png"), "Data row should contain image URL");
  assert.ok(lines[1].includes("A dog"), "Data row should contain alt text");
  assert.ok(lines[1].includes("GOOD"), "Data row should contain status");
});

test("toCsv returns only a header row for an empty image list", () => {
  const csv = toCsv([]);
  const lines = csv.split("\n");
  assert.equal(lines.length, 1, "Only the header row should be present");
  assert.ok(lines[0].includes("Image URL"), "Header should still be present");
});

test("toCsv escapes commas in alt text with double-quotes", () => {
  const images = [
    createImage({ alt: "A cat, a dog, and a bird" })
  ];
  const csv = toCsv(images);
  assert.ok(csv.includes('"A cat, a dog, and a bird"'), "Comma-containing text should be quoted");
});

test("toCsv escapes double-quotes in alt text by doubling them", () => {
  const images = [
    createImage({ alt: 'He said "hello"' })
  ];
  const csv = toCsv(images);
  assert.ok(csv.includes('He said ""hello""'), "Quotes should be doubled in CSV");
});

test("toCsv handles null alt text gracefully", () => {
  const images = [
    createImage({ alt: null, status: "MISSING", issues: ["Missing alt"] })
  ];
  const csv = toCsv(images);
  const lines = csv.split("\n");
  assert.equal(lines.length, 2, "Should still produce one data row");
  assert.ok(!lines[1].includes("null"), "Should not include literal 'null' in CSV");
});

test("toCsv includes page count and page URLs", () => {
  const pages = ["https://example.com/page1", "https://example.com/page2"];
  const images = [
    createImage({ pages, occurrences: 2 })
  ];
  const csv = toCsv(images);
  assert.ok(csv.includes("https://example.com/page1"), "CSV should list found-on page");
  assert.ok(csv.includes("2"), "CSV should include occurrences count");
});

test("toCsv sorts images by status priority (issues first)", () => {
  const images = [
    createImage({ src: "https://example.com/good.png", status: "GOOD" }),
    createImage({ src: "https://example.com/missing.png", status: "MISSING", alt: null, issues: ["Missing alt"] })
  ];
  const csv = toCsv(images);
  const missingPos = csv.indexOf("missing.png");
  const goodPos = csv.indexOf("good.png");
  assert.ok(missingPos < goodPos, "Images with issues should appear before GOOD images in CSV");
});

// ── toMarkdown ────────────────────────────────────────────────────────────────

test("toMarkdown produces a markdown document with expected headings", () => {
  const scanResult = {
    statusCounts: { GOOD: 1, MISSING: 1 },
    urlsScanned: 2,
    totalImages: 2,
    uniqueImages: 2,
    imagesWithIssues: 1,
    scannedAt: "2026-03-19T00:00:00.000Z",
    uniqueImageList: [
      createImage({ src: "https://example.com/missing.png", alt: null, status: "MISSING", issues: ["Missing alt"] }),
      createImage({ src: "https://example.com/good.png", status: "GOOD" })
    ]
  };
  const meta = { scanDomain: "https://example.com", discoveryMethod: "sitemap" };
  const md = toMarkdown(scanResult, meta);

  assert.ok(md.startsWith("# Alt Text Scan Report"), "Should start with H1 heading");
  assert.ok(md.includes("## Status breakdown"), "Should include status breakdown section");
  assert.ok(md.includes("## Images with issues"), "Should include issues section");
  assert.ok(md.includes("## Unique image inventory"), "Should include inventory section");
  assert.ok(md.includes("Missing Alt: 1"), "Should include MISSING status count");
  assert.ok(md.includes("Good: 1"), "Should include GOOD status count");
  assert.ok(md.includes("https://example.com/missing.png"), "Missing image should appear in issues table");
  assert.ok(md.includes("(missing)"), "Null alt should render as (missing)");
});

test("toMarkdown includes scan metadata", () => {
  const scanResult = {
    statusCounts: { GOOD: 1 },
    urlsScanned: 5,
    totalImages: 10,
    uniqueImages: 8,
    imagesWithIssues: 0,
    scannedAt: "2026-03-19T00:00:00.000Z",
    uniqueImageList: [createImage()]
  };
  const meta = { scanDomain: "https://example.com", discoveryMethod: "sitemap", issueUrl: "https://github.com/mgifford/alt-text-scan/issues/42" };
  const md = toMarkdown(scanResult, meta);

  assert.ok(md.includes("Pages scanned: 5"), "Should include pages scanned");
  assert.ok(md.includes("Images found: 10"), "Should include images found");
  assert.ok(md.includes("Unique images: 8"), "Should include unique images");
  assert.ok(md.includes("Images with issues: 0"), "Should include images with issues");
  assert.ok(md.includes("Discovery method: sitemap"), "Should include discovery method");
  assert.ok(md.includes("https://github.com/mgifford/alt-text-scan/issues/42"), "Should include issue URL");
});

test("toMarkdown shows 'No issues found' when there are no issue images", () => {
  const scanResult = {
    statusCounts: { GOOD: 1 },
    urlsScanned: 1,
    totalImages: 1,
    uniqueImages: 1,
    imagesWithIssues: 0,
    scannedAt: "2026-03-19T00:00:00.000Z",
    uniqueImageList: [createImage({ status: "GOOD", issues: [] })]
  };
  const meta = { scanDomain: "https://example.com", discoveryMethod: "explicit URLs" };
  const md = toMarkdown(scanResult, meta);
  assert.ok(md.includes("No issues found"), "Should show no-issues message");
});

test("toMarkdown shows 'No images found' for inventory when list is empty", () => {
  const scanResult = {
    statusCounts: {},
    urlsScanned: 1,
    totalImages: 0,
    uniqueImages: 0,
    imagesWithIssues: 0,
    scannedAt: "2026-03-19T00:00:00.000Z",
    uniqueImageList: []
  };
  const meta = { scanDomain: "https://example.com", discoveryMethod: "explicit URLs" };
  const md = toMarkdown(scanResult, meta);
  assert.ok(md.includes("No images found"), "Should show no-images message in inventory section");
});

test("toMarkdown escapes pipe characters in alt text for Markdown tables", () => {
  const scanResult = {
    statusCounts: { SUSPICIOUS: 1 },
    urlsScanned: 1,
    totalImages: 1,
    uniqueImages: 1,
    imagesWithIssues: 1,
    scannedAt: "2026-03-19T00:00:00.000Z",
    uniqueImageList: [
      createImage({ alt: "A|B|C", status: "SUSPICIOUS", issues: ["Suspicious"] })
    ]
  };
  const meta = { scanDomain: "https://example.com", discoveryMethod: "explicit URLs" };
  const md = toMarkdown(scanResult, meta);
  assert.ok(md.includes("A\\|B\\|C"), "Pipe characters should be escaped in Markdown");
});

test("toMarkdown produces valid Markdown table header rows", () => {
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
  const md = toMarkdown(scanResult, meta);
  assert.ok(md.includes("| --- |"), "Should include Markdown table separator row");
});

// ── truncateUrl additional edge cases ─────────────────────────────────────────

test("truncateUrl uses custom maxLength when provided", () => {
  const url = "https://example.com/path/to/some-image.jpg";
  const result = truncateUrl(url, 30);
  assert.ok(result.length <= 31, "Should respect custom maxLength (with possible ellipsis)");
});

test("truncateUrl handles a URL with no slashes in path gracefully", () => {
  // Degenerate URL where lastIndexOf('/') returns the start
  const url = "https://example.com";
  const result = truncateUrl(url, 60);
  assert.equal(result, url, "Short URL should be returned unchanged");
});
