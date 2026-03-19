import test from "node:test";
import assert from "node:assert/strict";

import { sortUniqueImageList, toHtml } from "../../scanner/run-alt-text-scan.mjs";

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
});