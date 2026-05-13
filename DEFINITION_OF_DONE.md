# Definition of Done for Public Reports

This document defines when an alt-text scan report is ready to publish and share.

## A report is done when

### 1. Scope and purpose are clear

- [ ] The report makes it clear which scan, issue, or URL set it covers.
- [ ] The report reflects the project goal of reviewing alt-text quality, not only alt-text presence.
- [ ] The report explains whether results are automated findings, human-review prompts, or both.

### 2. Core report content is complete

- [ ] The report includes a readable title, scan date, and issue reference.
- [ ] The total URLs scanned, skipped, blocked, or failed are shown clearly.
- [ ] The main alt-text finding categories are summarized in plain language.
- [ ] Priority pages or patterns are surfaced so people know what to fix first.
- [ ] Links to supporting artifacts are present where relevant (for example HTML, Markdown, CSV, or JSON outputs).

### 3. Data is trustworthy

- [ ] Counts in the summary match the underlying scan output.
- [ ] Redirected URLs are identified where they affect interpretation.
- [ ] Scanner errors, blocked pages, and incomplete results are shown separately from confirmed findings.
- [ ] The report avoids overstating certainty for checks that still require human judgment.

### 4. Accessibility requirements are met

- [ ] The report uses a logical heading structure and semantic markup.
- [ ] Tables, links, and controls are keyboard accessible and understandable out of context.
- [ ] Information is not conveyed by colour alone.
- [ ] Any charts, icons, or images in the report have accessible text alternatives.
- [ ] The report meets the repository's WCAG 2.2 AA expectations for user-facing pages.

### 5. Public publishing is ready

- [ ] The report path is GitHub Pages compatible and stable.
- [ ] The report is discoverable from the reports index or history view.
- [ ] Historical runs remain traceable back to the originating issue.
- [ ] The report does not expose secrets, private URLs, or unnecessary sensitive metadata.

### 6. Documentation and reviewer guidance are sufficient

- [ ] The report explains what each status or category means.
- [ ] The report distinguishes automated detection from manual review needs.
- [ ] The next recommended action is obvious for a reviewer or content editor.
- [ ] Any important limitations, assumptions, or exclusions are documented.

### 7. Quality gates are satisfied

- [ ] Relevant tests and checks for report generation pass.
- [ ] Output format changes are reflected in any related documentation.
- [ ] The report format remains stable enough for humans and machines to consume consistently.
- [ ] Sustainability impact is neutral or better, and no unnecessary processing or dependencies were introduced.

## Practical acceptance statement

A report is done when it is accurate, accessible, publicly shareable, easy to act on, and clearly linked back to the scan that produced it.
