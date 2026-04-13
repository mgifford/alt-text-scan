# ACCESSIBILITY.md

> **Accessibility commitment and transparency for alt-text-scan**

Just as `SECURITY.md` defines how to handle vulnerabilities, **`ACCESSIBILITY.md`** defines the inclusive state of a project. It is a human and machine-readable manifest that tracks a project's commitment to accessibility through metrics, guardrails, and automated enforcement.

**Related:** See [AGENTS.md](./AGENTS.md) for AI agent instructions that enforce these standards.

---

## 1. Our Commitment

We believe accessibility is a subset of quality. alt-text-scan commits to **WCAG 2.2 Level AA** standards for all user-facing interfaces. We track our progress publicly to remain accountable to our users.

alt-text-scan is an issue-driven accessibility scanning tool that uses GitHub Pages and GitHub Actions to perform automated accessibility scans. The tool helps developers identify and fix accessibility issues by:

- Scanning multiple URLs for WCAG compliance
- Generating actionable reports using Siteimprove's Alfa and axe-core
- Publishing results to GitHub Pages for easy comparison

---

## 2. Real-Time Health Metrics

| Metric | Status / Value |
| :--- | :--- |
| **Conformance Target** | WCAG 2.2 Level AA |
| **Frontend (index.html, reports.html)** | Tested with automated tools, keyboard navigation verified |
| **Open A11y Issues** | [View open accessibility issues](https://github.com/mgifford/alt-text-scan/labels/accessibility) |
| **Automated Test Pass Rate** | 66/66 unit tests passing |
| **Browser Support** | Last 2 major versions of Chrome, Firefox, Safari |
| **Dark / Light Mode** | System preference respected; manual toggle with localStorage persistence |

---

## 3. Contributor Requirements (Guardrails)

All pull requests must:

1. ✅ Pass automated accessibility scans (Alfa + axe-core)
2. ✅ Include unit tests for new functionality
3. ✅ Pass linting checks (`npm run lint`)
4. ✅ Follow existing code patterns and conventions
5. ✅ Update documentation as needed

### Code Examples Must Follow

- [SVG Accessibility Best Practices](https://github.com/mgifford/ACCESSIBILITY.md/blob/main/examples/SVG_ACCESSIBILITY_BEST_PRACTICES.md)
- [Forms Accessibility Best Practices](https://github.com/mgifford/ACCESSIBILITY.md/blob/main/examples/FORMS_ACCESSIBILITY_BEST_PRACTICES.md)
- [Keyboard Accessibility Best Practices](https://github.com/mgifford/ACCESSIBILITY.md/blob/main/examples/KEYBOARD_ACCESSIBILITY_BEST_PRACTICES.md)
- [Light/Dark Mode Accessibility Best Practices](https://github.com/mgifford/ACCESSIBILITY.md/blob/main/examples/LIGHT_DARK_MODE_ACCESSIBILITY_BEST_PRACTICES.md)

---

## 4. Reporting and Severity Taxonomy

Please use our [issue templates](https://github.com/mgifford/alt-text-scan/issues/new) when reporting issues. We prioritize based on:

- **Critical:** Accessibility barrier that prevents users from completing core tasks
- **High:** Significant barrier or missing feature that creates a meaningful disadvantage
- **Medium:** Clarity issue, incomplete pattern, or partial non-conformance
- **Low:** Minor improvement, typo, or enhancement

---

## 5. Automated Testing

### Dual-Scanner Approach

This project uses two accessibility scanning engines:

1. **Siteimprove Alfa** (`@siteimprove/alfa-cli`)
   - Standards-first approach based on ACT rules
   - Comprehensive WCAG 2.2 coverage
   - EARL report format support

2. **axe-core** (`@axe-core/playwright`)
   - Industry-standard accessibility testing
   - Playwright integration for dynamic content
   - Detailed violation reporting

### CI/CD Integration

All scans run in GitHub Actions workflows:
- **scan-request.yml**: Triggered on issue creation/reopen
- **scan-issue-queue.yml**: Daily scheduled scans + manual trigger

### Automated Guardrails

✅ **What is automated:**
- WCAG 2.2 rule violations (both ALFA and axe-core)
- Color contrast checking (light mode and dark mode)
- Semantic HTML structure validation
- ARIA usage validation
- Keyboard accessibility patterns

❌ **What requires manual testing:**
- Screen reader compatibility
- Focus management in complex interactions
- Meaningful content descriptions
- Logical reading order

### Quality Gates

```bash
# Run all unit tests
npm test

# Lint all scanner modules
npm run lint

# Test individual modules
npm run run:parse
npm run run:validate
npm run run:scan
```

---

## 6. Light/Dark Mode

This project implements accessible light/dark mode theming following the [Light/Dark Mode Accessibility Best Practices](https://github.com/mgifford/ACCESSIBILITY.md/blob/main/examples/LIGHT_DARK_MODE_ACCESSIBILITY_BEST_PRACTICES.md).

### Implementation

- **CSS custom properties** (`--color-*`) define all theme colors
- **`prefers-color-scheme`** media query provides automatic system preference support
- **`[data-theme]`** attribute on `<html>` enables manual override
- **`localStorage`** persists user choice across sessions
- **Toggle button** positioned in the top-right of the nav with sun/moon icons
  - Sun icon shown in dark mode (click to switch to light)
  - Moon icon shown in light mode (click to switch to dark)
  - `aria-label` reflects the *action* ("Switch to dark mode" / "Switch to light mode")
  - Tab order places toggle after navigation links
- **Forced-colors mode** (`forced-colors: active`) support for Windows High Contrast

### Contrast Requirements

All color pairs meet WCAG 2.2 AA minimums in both light and dark modes:

- Normal text: ≥ 4.5:1
- Large text: ≥ 3:1
- UI components and focus indicators: ≥ 3:1

---

## 7. Development Best Practices

### Module Structure & Security

**Use ES Modules**
```javascript
// package.json
{
  "type": "module"
}
```

**Export Functions for Testing**
```javascript
// Use import guard to prevent main() execution during testing
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

**Security: Never use command injection patterns**
```javascript
// ✅ CORRECT: Use spawn with argument arrays
import { spawn } from "node:child_process";
const child = spawn(command, [arg1, arg2, arg3]);

// ❌ WRONG: Never use execSync with template strings
// execSync(`command ${userInput}`); // Command injection risk!
```

### Frontend Accessibility

**Semantic HTML**
- Use proper heading hierarchy (h1 → h2 → h3)
- Use semantic elements (`<nav>`, `<main>`, `<footer>`, `<article>`)
- Provide labels for all form inputs

**Form Validation**
- Real-time URL validation with clear error messages
- Prevent submission of private/localhost URLs

**Keyboard Navigation**
- All interactive elements are keyboard accessible
- Visible focus indicators (3px solid, 2px offset)
- Logical tab order

### Report Generation

**Accessible Reports**
- Priority sections show pages with most errors first
- Common issues prominently displayed
- Cross-page pattern analysis for recurring problems

**Multiple Formats**
- HTML with semantic structure and ARIA landmarks
- Markdown for GitHub rendering
- CSV for data analysis
- JSON for machine processing

### Input Validation

**URL Validation Rules**
- Reject localhost URLs (`localhost`, `127.0.0.1`, `[::1]`)
- Reject private IPv4 ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x)
- Reject private IPv6 ranges (fe80:, fc00:, fd00:, ::1)
- Accept only HTTP/HTTPS protocols
- Enforce 500 URL maximum per scan request

---

## 8. Browser and Assistive Technology Testing

### Browser Support

This project supports the **last 2 major versions** of all major browser engines:
- **Chrome/Chromium** (including Edge, Brave, Opera)
- **Firefox**
- **Safari/WebKit** (macOS and iOS)

### Assistive Technology Testing

Contributors are encouraged to test with:

- **Screen readers:** JAWS, NVDA, VoiceOver, TalkBack
- **Keyboard navigation:** Tab, arrow keys, standard shortcuts
- **Magnification tools:** Browser zoom, screen magnifiers
- **Voice control:** Dragon, Voice Control

---

## 9. Alt Text Best Practices

A full reference guide — including the WCAG decision tree, all image categories, common bad-pattern examples, and an automated vs. human-review table — is mirrored locally:

📄 **[docs/IMAGE_ALT_TEXT_ACCESSIBILITY_BEST_PRACTICES.md](./docs/IMAGE_ALT_TEXT_ACCESSIBILITY_BEST_PRACTICES.md)**

Upstream source: [mgifford/ACCESSIBILITY.md — IMAGE_ALT_TEXT_ACCESSIBILITY_BEST_PRACTICES.md](https://github.com/mgifford/ACCESSIBILITY.md/blob/main/examples/IMAGE_ALT_TEXT_ACCESSIBILITY_BEST_PRACTICES.md)

#### Patterns detected automatically by `scan-alt-text.mjs`

| Check | Section | Scanner status |
|-------|---------|----------------|
| `alt` attribute entirely absent | §6.1 | `MISSING` |
| Alt text equals the filename (has image extension, no spaces) | §6.2 | `FILENAME` |
| CMS-injected code (no spaces + double-hyphens) | §6.6 | `FILENAME` |
| Known generic single-word labels (`image`, `photo`, `graphic`, etc.) | §6.3, §6.4 | `SUSPICIOUS` |
| "Type" prefix phrases (`image of`, `photo of`, etc.) | §6.5 | `SUSPICIOUS` |
| Single-word alt text (not in the generic-label list) | §6.3, §6.8 | `SUSPICIOUS` |
| Alt text shorter than 3 characters | §5 | `TOO_SHORT` |
| Alt text longer than 500 characters | §6.9 | `TOO_LONG` |
| Non-empty alt on an `aria-hidden` or `role="presentation/none"` image | §4.2 | `SUSPICIOUS` |

Human review is always required to evaluate whether alt text is meaningful and appropriate in context.

---

## 10. Machine-Readable Standards

This project follows guidance from [wai-yaml-ld](https://github.com/mgifford/wai-yaml-ld) and the vetted sources documented in [TRUSTED_SOURCES.yaml](https://github.com/mgifford/ACCESSIBILITY.md/blob/main/examples/TRUSTED_SOURCES.yaml).

### Trusted Accessibility Resources

#### Standards & Specifications
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) - Web Content Accessibility Guidelines
- [W3C ARIA](https://www.w3.org/TR/wai-aria/) - Accessible Rich Internet Applications
- [ACT Rules](https://www.w3.org/WAI/standards-guidelines/act/) - Accessibility Conformance Testing

#### Tools & Libraries
- [Siteimprove Alfa](https://alfa.siteimprove.com/) - Standards-first accessibility testing
- [axe-core](https://github.com/dequelabs/axe-core) - Industry-standard accessibility engine
- [Playwright](https://playwright.dev/) - Cross-browser testing framework

---

## 11. Known Limitations

- Manual screen reader testing not yet performed
- Limited assistive technology coverage in CI testing
- Focus on automated testing over manual evaluation

---

## 12. Getting Help

- **Questions**: Open a [discussion](https://github.com/mgifford/alt-text-scan/discussions)
- **Bugs or barriers**: Open an [issue](https://github.com/mgifford/alt-text-scan/issues) with the `accessibility` label
- **Contributions**: See [CONTRIBUTING](https://github.com/mgifford/alt-text-scan/blob/main/README.md)

---

## 13. AI Agent Compliance

AI coding assistants (GitHub Copilot, Cursor, Claude, etc.) working in this repository must:
- Read and follow [AGENTS.md](./AGENTS.md) instructions
- Generate WCAG 2.2 AA compliant code
- Use secure coding patterns (no command injection)
- Follow existing module structure and conventions
- Include unit tests for new functionality

---

## 🔗 Related Documentation

- **[AGENTS.md](./AGENTS.md)** - AI agent instructions and coding standards
- **[README.md](./README.md)** - Project overview and usage guide
- **[.github/copilot-instructions.md](.github/copilot-instructions.md)** - GitHub Copilot specific instructions

---

**Last Updated**: 2026-04-13

This is a living document. As our accessibility practices evolve, this document will be updated to reflect our current state and commitments.

