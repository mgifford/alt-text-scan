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

// ── Boundary value tests ──────────────────────────────────────────────────────

test("assessAltText accepts alt text of exactly 3 characters as not too short", () => {
  const result = assessAltText({ alt: "Dog", role: null, ariaHidden: null });
  assert.notEqual(result.status, "TOO_SHORT", "Exactly 3 chars should not be TOO_SHORT");
});

test("assessAltText flags alt text of exactly 2 characters as too short", () => {
  const result = assessAltText({ alt: "Go", role: null, ariaHidden: null });
  assert.equal(result.status, "TOO_SHORT");
});

test("assessAltText accepts alt text of exactly 500 characters as not too long", () => {
  const exactly500 = "x".repeat(500);
  assert.equal(exactly500.length, 500, "Test setup: string should be exactly 500 chars");
  const result = assessAltText({ alt: exactly500, role: null, ariaHidden: null });
  assert.notEqual(result.status, "TOO_LONG", "Exactly 500 chars should not be TOO_LONG");
});

test("assessAltText flags alt text of exactly 501 characters as too long", () => {
  const alt501 = "A descriptive sentence that is quite long ".repeat(12).slice(0, 501);
  assert.equal(alt501.length, 501);
  const result = assessAltText({ alt: alt501, role: null, ariaHidden: null });
  assert.equal(result.status, "TOO_LONG");
});

// ── Leading/trailing whitespace ───────────────────────────────────────────────

test("assessAltText trims leading/trailing spaces before evaluating length", () => {
  const result = assessAltText({ alt: "  A  ", role: null, ariaHidden: null });
  assert.equal(result.status, "TOO_SHORT", "After trimming, 'A' is only 1 char and should be TOO_SHORT");
});

test("assessAltText trims leading/trailing spaces for descriptive text", () => {
  const result = assessAltText({ alt: "  A golden dog running in a field  ", role: null, ariaHidden: null });
  assert.equal(result.status, "GOOD", "Descriptive alt with surrounding spaces should be GOOD after trimming");
});

// ── Multiple suspicious phrases ───────────────────────────────────────────────

test("assessAltText accumulates multiple suspicious phrase issues", () => {
  const result = assessAltText({
    alt: "A picture of a photo of a puppy",
    role: null,
    ariaHidden: null
  });
  assert.equal(result.status, "SUSPICIOUS");
  const phraseIssues = result.issues.filter((i) => i.includes("redundant phrase"));
  assert.ok(phraseIssues.length >= 2, "Should report both redundant phrases");
});

// ── Special characters and emoji ─────────────────────────────────────────────

test("assessAltText accepts alt text containing emoji as GOOD when descriptive", () => {
  const result = assessAltText({ alt: "A smiling face 😊 at the conference", role: null, ariaHidden: null });
  assert.equal(result.status, "GOOD");
});

test("assessAltText accepts alt text with special punctuation", () => {
  const result = assessAltText({ alt: "Dr. Smith's award — 2025 excellence", role: null, ariaHidden: null });
  assert.equal(result.status, "GOOD");
});

// ── Additional meaningless values ─────────────────────────────────────────────

test("assessAltText flags 'undefined' and 'none' and 'null' as suspicious", () => {
  for (const val of ["undefined", "none", "null"]) {
    const result = assessAltText({ alt: val, role: null, ariaHidden: null });
    assert.equal(result.status, "SUSPICIOUS", `Expected SUSPICIOUS for alt="${val}"`);
  }
});

// ── Role case-insensitivity ───────────────────────────────────────────────────

test("assessAltText treats PRESENTATION role case-insensitively as decorative", () => {
  const result = assessAltText({ alt: "", role: "PRESENTATION", ariaHidden: null });
  assert.equal(result.status, "DECORATIVE");
});

test("assessAltText treats NONE role case-insensitively as decorative", () => {
  const result = assessAltText({ alt: "", role: "NONE", ariaHidden: null });
  assert.equal(result.status, "DECORATIVE");
});

// ── Filename extension variations ────────────────────────────────────────────

test("assessAltText flags .PNG (uppercase extension) filenames as FILENAME", () => {
  const result = assessAltText({ alt: "hero-banner.PNG", role: null, ariaHidden: null });
  assert.equal(result.status, "FILENAME");
});

test("assessAltText flags .WEBP extension filenames as FILENAME", () => {
  const result = assessAltText({ alt: "logo.WEBP", role: null, ariaHidden: null });
  assert.equal(result.status, "FILENAME");
});

test("assessAltText flags .avif extension filenames as FILENAME", () => {
  const result = assessAltText({ alt: "photo.avif", role: null, ariaHidden: null });
  assert.equal(result.status, "FILENAME");
});

// ── thumbnail of and screenshot of suspicious phrases ────────────────────────

test("assessAltText flags 'thumbnail of' and 'screenshot of' as suspicious", () => {
  for (const phrase of ["thumbnail of", "screenshot of"]) {
    const result = assessAltText({
      alt: `A ${phrase} the home page`,
      role: null,
      ariaHidden: null
    });
    assert.equal(result.status, "SUSPICIOUS", `Expected SUSPICIOUS for phrase "${phrase}"`);
    assert.ok(result.issues.some((i) => i.includes(phrase)));
  }
});
