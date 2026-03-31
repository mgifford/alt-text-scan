import test from "node:test";
import assert from "node:assert/strict";
import { assessAltText } from "../../scanner/scan-alt-text.mjs";

test("assessAltText flags missing alt attribute", () => {
  const result = assessAltText({ alt: null, role: null, ariaHidden: null });
  assert.equal(result.status, "MISSING");
  assert.ok(result.issues.some((i) => i.includes("alt attribute is missing")));
});

test("assessAltText flags undefined alt as missing", () => {
  const result = assessAltText({ alt: undefined, role: null, ariaHidden: null });
  assert.equal(result.status, "MISSING");
});

test("assessAltText treats empty string alt as decorative", () => {
  const result = assessAltText({ alt: "", role: null, ariaHidden: null });
  assert.equal(result.status, "DECORATIVE");
  assert.equal(result.issues.length, 0);
});

test("assessAltText treats role=presentation as decorative", () => {
  const result = assessAltText({ alt: "", role: "presentation", ariaHidden: null });
  assert.equal(result.status, "DECORATIVE");
});

test("assessAltText treats role=none as decorative", () => {
  const result = assessAltText({ alt: "", role: "none", ariaHidden: null });
  assert.equal(result.status, "DECORATIVE");
});

test("assessAltText flags non-empty alt on aria-hidden image", () => {
  const result = assessAltText({ alt: "A logo", role: null, ariaHidden: "true" });
  assert.equal(result.status, "SUSPICIOUS");
  assert.ok(result.issues.some((i) => i.includes("aria-hidden")));
});

test("assessAltText accepts decorative aria-hidden with empty alt", () => {
  const result = assessAltText({ alt: "", role: null, ariaHidden: "true" });
  assert.equal(result.status, "DECORATIVE");
});

test("assessAltText flags meaningless single-word alt text", () => {
  for (const val of ["image", "graphic", "photo", "placeholder", "tbd", "todo"]) {
    const result = assessAltText({ alt: val, role: null, ariaHidden: null });
    assert.equal(result.status, "SUSPICIOUS", `Expected SUSPICIOUS for alt="${val}"`);
    assert.ok(result.issues.length > 0);
  }
});

test("assessAltText is case-insensitive for meaningless values", () => {
  const result = assessAltText({ alt: "IMAGE", role: null, ariaHidden: null });
  assert.equal(result.status, "SUSPICIOUS");
});

test("assessAltText flags filename-style alt text", () => {
  const result = assessAltText({ alt: "hero-banner.jpg", role: null, ariaHidden: null });
  assert.equal(result.status, "FILENAME");
  assert.ok(result.issues.some((i) => i.includes("filename")));
});

test("assessAltText does not flag sentence with image extension word", () => {
  const result = assessAltText({
    alt: "The team photo from the 2024 summit",
    role: null,
    ariaHidden: null
  });
  assert.equal(result.status, "GOOD");
});

test("assessAltText flags suspicious phrases", () => {
  for (const phrase of ["image of", "graphic of", "picture of", "photo of"]) {
    const result = assessAltText({
      alt: `An ${phrase} a dog`,
      role: null,
      ariaHidden: null
    });
    assert.equal(result.status, "SUSPICIOUS", `Expected SUSPICIOUS for phrase "${phrase}"`);
    assert.ok(result.issues.some((i) => i.includes(phrase)));
  }
});

test("assessAltText flags very short alt text", () => {
  const result = assessAltText({ alt: "A", role: null, ariaHidden: null });
  assert.equal(result.status, "TOO_SHORT");
  assert.ok(result.issues.some((i) => i.includes("too short")));
});

test("assessAltText accepts multi-word non-meaningless alt text as GOOD", () => {
  const result = assessAltText({ alt: "A golden dog running in a field", role: null, ariaHidden: null });
  assert.equal(result.status, "GOOD");
});

test("assessAltText flags very long alt text (over 500 chars)", () => {
  const longAlt = "This is a very detailed description. ".repeat(14); // 518 chars
  const result = assessAltText({ alt: longAlt, role: null, ariaHidden: null });
  assert.equal(result.status, "TOO_LONG");
  assert.ok(result.issues.some((i) => i.includes("long")));
});

test("assessAltText does not flag alt text under 500 chars as too long", () => {
  const longAlt = "This is a very detailed description. ".repeat(10); // 370 chars
  const result = assessAltText({ alt: longAlt, role: null, ariaHidden: null });
  assert.notEqual(result.status, "TOO_LONG");
});

test("assessAltText returns GOOD for a normal descriptive alt text", () => {
  const result = assessAltText({
    alt: "Two accessibility practitioners discussing a website on a laptop",
    role: null,
    ariaHidden: null
  });
  assert.equal(result.status, "GOOD");
  assert.equal(result.issues.length, 0);
});

test("assessAltText handles whitespace-only alt as decorative", () => {
  const result = assessAltText({ alt: "   ", role: null, ariaHidden: null });
  assert.equal(result.status, "DECORATIVE");
});

// ── Single-word detection (§6.3, §6.8) ──────────────────────────────────────

test("assessAltText flags single-word alt text as suspicious", () => {
  const result = assessAltText({ alt: "Dog", role: null, ariaHidden: null });
  assert.equal(result.status, "SUSPICIOUS");
  assert.ok(result.issues.some((i) => i.includes("single word")));
});

test("assessAltText flags single-word alt text regardless of case", () => {
  const result = assessAltText({ alt: "Mountain", role: null, ariaHidden: null });
  assert.equal(result.status, "SUSPICIOUS");
  assert.ok(result.issues.some((i) => i.includes("single word")));
});

test("assessAltText does not flag multi-word alt text as single-word", () => {
  const result = assessAltText({ alt: "A mountain at sunset", role: null, ariaHidden: null });
  assert.equal(result.status, "GOOD");
  assert.ok(!result.issues.some((i) => i.includes("single word")));
});

test("assessAltText uses MEANINGLESS_VALUES path (not single-word) for known generic labels", () => {
  // "photo" is in MEANINGLESS_VALUES so it returns early with "not descriptive",
  // and the single-word check further down is never reached.
  const result = assessAltText({ alt: "photo", role: null, ariaHidden: null });
  assert.equal(result.status, "SUSPICIOUS");
  assert.ok(result.issues.some((i) => i.includes("not descriptive")));
  assert.ok(!result.issues.some((i) => i.includes("single word")));
  assert.equal(result.issues.length, 1);
});

// ── Additional MEANINGLESS_VALUES (§6.3 medium labels, §6.4 placeholders) ───

test("assessAltText flags newly added meaningless values", () => {
  for (const val of ["untitled", "alt text", "screenshot", "thumbnail", "banner", "divider", "separator", "border", "test"]) {
    const result = assessAltText({ alt: val, role: null, ariaHidden: null });
    assert.equal(result.status, "SUSPICIOUS", `Expected SUSPICIOUS for alt="${val}"`);
    assert.ok(result.issues.some((i) => i.includes("not descriptive")));
  }
});

// ── CMS-generated code detection (§6.6) ──────────────────────────────────────

test("assessAltText flags CMS-generated double-hyphen codes as FILENAME", () => {
  const result = assessAltText({
    alt: "node--article--field-image--hero--full",
    role: null,
    ariaHidden: null
  });
  assert.equal(result.status, "FILENAME");
  assert.ok(result.issues.some((i) => i.includes("CMS-generated")));
});

test("assessAltText does not flag hyphenated text with spaces as CMS code", () => {
  const result = assessAltText({
    alt: "A well-written, up-to-date summary of the report",
    role: null,
    ariaHidden: null
  });
  assert.notEqual(result.status, "FILENAME");
});
