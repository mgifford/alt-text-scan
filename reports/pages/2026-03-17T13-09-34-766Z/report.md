# Scan Report: GitHub Pages accessibility check

- Issue: https://github.com/mgifford/alt-text-scan/actions/runs/23195685472
- Submitted by: github-actions[bot]
- Scanned at: 2026-03-17T13:08:10.093Z
- Engines used: AXE
- Scan duration: 0.1 minutes
- Total URLs submitted: 1
- Accepted public URLs: 1
- Rejected URLs: 0
- 🎨 **Accessibility personalization (CSS media queries):**
  - 🌙 Dark mode: None of the scanned URLs support `prefers-color-scheme: dark`
  - ⚡ Reduced motion: None of the scanned URLs support `prefers-reduced-motion: reduce`
  - 🔍 High contrast: None of the scanned URLs support `prefers-contrast: more`
  - 🖥️ Forced colors: None of the scanned URLs support `forced-colors: active`
  - 🪟 Reduced transparency: None of the scanned URLs support `prefers-reduced-transparency: reduce`
- ALFA outcomes: 0 passed, 0 failed, 0 cantTell, 0 inapplicable
- axe outcomes: 25 passed, 18 failed, 1 cantTell, 74 inapplicable
- Equal Access outcomes: 0 passed, 0 failed (0 unique, 0 duplicate), 0 cantTell, 0 inapplicable
- AccessLint outcomes: 0 passed, 0 failed (0 unique, 0 duplicate), 0 cantTell, 0 inapplicable
- QualWeb outcomes: 0 passed, 0 failed, 0 cantTell, 0 inapplicable
- Duplicate findings caught by later scanners: 0

## 🎯 Pages with Most Errors

Focus your efforts on these pages to make the biggest impact (combined scanner unique failures):

| Page | axe Unique | Total Unique | Page Title |
|---|---:|---:|---|
| [View Page](https://mgifford.github.io/alt-text-scan/) | 18 | **18** | Page not found &middot; GitHub Pages |

## 🔧 Most Common Issues (ALFA)

These ALFA accessibility issues appear most frequently across your pages:

✅ No ALFA failed rules detected!

## 🔧 Most Common Issues (axe)

These axe accessibility issues appear most frequently across your pages:

| Rule | Pages Affected | Documentation |
|---|---:|---|
| color-contrast | **1** of 1 | [View Rule](https://dequeuniversity.com/rules/axe/4.11.1/color-contrast) |
| html-has-lang | **1** of 1 | [View Rule](https://dequeuniversity.com/rules/axe/4.11.1/html-has-lang) |
| landmark-one-main | **1** of 1 | [View Rule](https://dequeuniversity.com/rules/axe/4.11.1/landmark-one-main) |
| link-in-text-block | **1** of 1 | [View Rule](https://dequeuniversity.com/rules/axe/4.11.1/link-in-text-block) |
| link-name | **1** of 1 | [View Rule](https://dequeuniversity.com/rules/axe/4.11.1/link-name) |
| region | **1** of 1 | [View Rule](https://dequeuniversity.com/rules/axe/4.11.1/region) |

> 💡 **Tip**: Click on the rule documentation links to learn how to fix each issue. Consider fixing the most common issues first for maximum impact.

> 🤖 **Future Enhancement**: This report will soon include AI-powered fix suggestions for authenticated GitHub users (opt-in only, no auto-run AI).

## 🔍 Cross-Page Patterns: Common HTML Issues

These HTML patterns cause the same accessibility errors across multiple pages. **Fix the pattern once in your codebase to fix it everywhere!**

✅ No recurring HTML patterns found across multiple pages. Each issue appears to be page-specific.

## 📊 Detailed Results

Complete scan results for all tested pages:

| Submitted URL | Final URL | Status | HTTP | Redirected | Time (ms) | axe Unique | ALFA Unique | Equal Access Unique | AccessLint Unique | Duplicates | Notes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| https://mgifford.github.io/alt-text-scan/ | https://mgifford.github.io/alt-text-scan/ | FAIL | 404 | no | 5392 | 18 | 0 | 0 | 0 | 0 | Skipped (not requested) |
|  |  |  |  |  |  |  |  |  |  | axe failed rules: color-contrast, html-has-lang, landmark-one-main, link-in-text-block, link-name, region |

## Detailed Failure Information (ALFA)

## Detailed Failure Information (axe)

### https://mgifford.github.io/alt-text-scan/

#### Rule: [color-contrast](https://dequeuniversity.com/rules/axe/4.11/color-contrast?application=playwright)
**Impact**: serious
**WCAG**: [SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) (Level AA)

**Failure 1:**
- Message: Elements must meet minimum color contrast ratio thresholds
- HTML: `<strong>File not found</strong>`
- XPath: `p:nth-child(2) > strong`

**Failure 2:**
- Message: Elements must meet minimum color contrast ratio thresholds
- HTML: `<p>         The site configured at this address does not         contain the requested file.       </p>`
- XPath: `p:nth-child(3)`

**Failure 3:**
- Message: Elements must meet minimum color contrast ratio thresholds
- HTML: `<p>         If this is your site, make sure that the filename case matches the URL         as well as any file permissions.<br>         For root URLs (like <code>http://example.com/</code>) you must provide an         <code>index.html</code> file.       </p>`
- XPath: `p:nth-child(4)`

**Failure 4:**
- Message: Elements must meet minimum color contrast ratio thresholds
- HTML: `<code>http://example.com/</code>`
- XPath: `code:nth-child(2)`

**Failure 5:**
- Message: Elements must meet minimum color contrast ratio thresholds
- HTML: `<code>index.html</code>`
- XPath: `code:nth-child(3)`

*... and 3 more failures for this rule*

#### Rule: [html-has-lang](https://dequeuniversity.com/rules/axe/4.11/html-has-lang?application=playwright)
**Impact**: serious
**WCAG**: [SC 3.1.1](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page) (Level A)

**Failure 1:**
- Message: <html> element must have a lang attribute
- HTML: `<html>`
- XPath: `html`

#### Rule: [landmark-one-main](https://dequeuniversity.com/rules/axe/4.11/landmark-one-main?application=playwright)
**Impact**: moderate

**Failure 1:**
- Message: Document should have one main landmark
- HTML: `<html>`
- XPath: `html`

#### Rule: [link-in-text-block](https://dequeuniversity.com/rules/axe/4.11/link-in-text-block?application=playwright)
**Impact**: serious
**WCAG**: [SC 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color) (Level A)

**Failure 1:**
- Message: Links must be distinguishable without relying on color
- HTML: `<a href="https://help.github.com/pages/">Read the full documentation</a>`
- XPath: `a[href$="pages/"]`

#### Rule: [link-name](https://dequeuniversity.com/rules/axe/4.11/link-name?application=playwright)
**Impact**: serious
**WCAG**: [SC 2.4.4](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context), [SC 4.1.2](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value) (Level A)

**Failure 1:**
- Message: Links must have discernible text
- HTML: `<a href="/" class="logo logo-img-1x">`
- XPath: `.logo-img-1x`

#### Rule: [region](https://dequeuniversity.com/rules/axe/4.11/region?application=playwright)
**Impact**: moderate

**Failure 1:**
- Message: All page content should be contained by landmarks
- HTML: `<h1>404</h1>`
- XPath: `h1`

**Failure 2:**
- Message: All page content should be contained by landmarks
- HTML: `<p><strong>File not found</strong></p>`
- XPath: `p:nth-child(2)`

**Failure 3:**
- Message: All page content should be contained by landmarks
- HTML: `<p>         The site configured at this address does not         contain the requested file.       </p>`
- XPath: `p:nth-child(3)`

**Failure 4:**
- Message: All page content should be contained by landmarks
- HTML: `<p>         If this is your site, make sure that the filename case matches the URL         as well as any file permissions.<br>         For root URLs (like <code>http://example.com/</code>) you must provide an         <code>index.html</code> file.       </p>`
- XPath: `p:nth-child(4)`

**Failure 5:**
- Message: All page content should be contained by landmarks
- HTML: `<p>         <a href="https://help.github.com/pages/">Read the full documentation</a>         for more information about using <strong>GitHub Pages</strong>.       </p>`
- XPath: `p:nth-child(5)`

*... and 1 more failures for this rule*

