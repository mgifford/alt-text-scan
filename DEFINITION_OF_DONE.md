# Definition of Done for Public Reports

This document defines when an alt-text scan report in this repository is actually ready to publish on GitHub Pages and point people to with confidence.

## Definition of done

A public report is done when all of the following are true.

### 1. The report is clearly about the right thing

The report identifies the scan it represents, including the issue or request it came from, the scan date, and the URL set or discovery scope used for the run.

It stays aligned with the actual purpose of this project: reviewing alt-text quality at scale, not just detecting whether an `alt` attribute exists. A finished report should therefore highlight likely quality problems. These include missing alt text, filename-based alt text, suspicious wording, decorative conflicts, and other review categories already used by the scanner.

It also makes clear which findings are automated classifications and which still need human judgment.

### 2. The core content needed by users is present

A finished report includes:

- a readable title
- the originating issue reference where applicable
- the scan timestamp
- the number of pages or URLs scanned
- a summary of the main result categories
- a clear path to any supporting artifacts

For this repository, "supporting artifacts" normally means the public report views and any generated machine-readable outputs such as JSON, Markdown, or CSV when those artifacts exist for that report type.

The report should also help a user decide where to start. That means surfacing priority pages, repeated patterns, or the most common problem categories instead of leaving readers to interpret raw output on their own.

### 3. The data can be trusted

The summary counts in the report must match the generated scan data.

If a page redirected, failed, timed out, or was blocked, that fact must be represented clearly. A reader must not mistake an incomplete scan for a clean result.

The report must not imply that automated output alone proves alt text is good. In this repository, human review remains part of done because meaningfulness, context, and author intent cannot be fully determined automatically.

### 4. The report itself is accessible

Because reports are user-facing Pages output, they must meet the repository's WCAG 2.2 AA commitment.

In practice, that means:

- semantic structure and sensible headings
- keyboard-accessible navigation and controls
- labels and link text that make sense out of context
- no reliance on colour alone
- accessible handling of tables, icons, and any visual summaries

If a report introduces a new visual component, that component is not done until it has an accessible equivalent.

### 5. The report is safe and publishable

A finished report is suitable for public hosting on GitHub Pages.

That means:

- paths and links are stable and Pages-compatible
- the report can be reached from the reports index or another expected discovery path
- historical runs remain traceable to the originating issue when relevant
- no secrets, internal-only data, private URLs, or unnecessary sensitive metadata are exposed

Public usefulness matters here too: a report that technically exists but cannot be found from `reports.html` or the report history is not fully done.

### 6. The report tells people what to do next

A done report goes beyond classification. It explains the meaning of its categories well enough that a reviewer, editor, or developer can act on them.

For this project, that means the report should:

- distinguish automated flags from manual review needs
- avoid overstating confidence
- make likely next actions obvious
- note important limitations or exclusions when they affect interpretation

If a reader can see that something is "suspicious" but cannot tell why that matters or what to review, the report is not done.

### 7. The output is maintainable

The format should remain stable enough for both people and automation to consume consistently over time.

If a reporting change alters structure, labels, or output expectations, any directly related documentation should be updated alongside it. For this repository, that includes report-facing docs and guidance describing what users should expect from published outputs.

### 8. Quality gates are satisfied

For report work in this repository, done includes the normal project quality bar:

- relevant checks are run
- lint remains clean
- tests relevant to the changed reporting behavior pass, or any unrelated pre-existing failure is explicitly called out
- no unnecessary dependencies or compute-heavy steps were introduced

Per the repository sustainability policy, the expected sustainability impact for report work is neutral or better unless there is a clearly justified reason otherwise.

## Short version

A report is done when it is accurate, accessible, publicly discoverable, safe to publish, clear about what was scanned, honest about what still needs human review, and useful enough that someone can take action from it.
