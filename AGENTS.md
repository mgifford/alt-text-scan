# AI Agent Instructions for alfa-scan

This repository welcomes multiple AI coding agents and tools. This document provides universal guidance for all AI assistants working in this codebase.

## Quick Start for AI Agents

- **Project Type**: Node.js accessibility scanning tool using GitHub Pages and Actions
- **Primary Language**: JavaScript (ES Modules)
- **Key Commands**: `npm test`, `npm run lint`, `npm run run:scan`
- **Architecture**: Frontend (GitHub Pages) + Backend (GitHub Actions) + Scanner (Alfa CLI)

## Project-Specific Guidelines

### Code Conventions

1. **Module Structure**: Use ES modules with `type: "module"` in package.json
2. **Testing**: Export functions from modules; use import guard to prevent main() execution:
   ```javascript
   if (import.meta.url === `file://${process.argv[1]}`) {
     main();
   }
   ```
3. **Security**: Use `spawnSync` with argument arrays, never `execSync` with template strings
4. **Node Version**: >= 20 (see package.json engines)
5. **Stdout/Stderr**: Scanner modules MUST output structured data (JSON) to stdout and progress/diagnostic messages to stderr. Workflows parse stdout as JSON - any non-JSON output breaks parsing. See `.github/copilot-instructions.md` for detailed examples.

### Testing & Quality

```bash
# Run all unit tests
npm test

# Lint code
npm run lint

# Run individual scanner modules
npm run run:parse
npm run run:validate
npm run run:scan
```

### File Organization

- **Scanner modules**: `/scanner/*.mjs`
- **Tests**: `/tests/unit/*.test.mjs`
- **Workflows**: `.github/workflows/`
- **Reports**: Published to `/reports/` for GitHub Pages
- **Spec Kitty specs**: `kitty-specs/` (for project management)

### AI Model Preference and Tracking

Use this model-selection order for AI-assisted development:

1. **Local first**: Use Ollama (or other local models) whenever the task quality is acceptable.
2. **Commercial fallback**: Use Copilot, Gemini, or other hosted services only when local models are insufficient.
3. **Smallest capable model**: Choose the lowest-cost model that can reliably complete the task.

When AI is used, record usage in PR metadata using two buckets:

- **Local**: on-device or self-hosted models (for example, Ollama)
- **Commercial**: third-party hosted APIs/services (for example, Copilot, Gemini)

Include at minimum: model/tool, bucket (`local` or `commercial`), rough prompt count, and brief purpose.

### AI Disclosure in README.md

**REQUIRED**: When you contribute to this project using an AI model or tool, add or update your entry in the `## AI Disclosure` section of `README.md`. Record:

- The model/tool name and version (if known)
- Whether it is `local` or `commercial`
- What you used it for (building, code review, documentation, etc.)

Do **not** list models you did not actually use. Each AI agent or developer is responsible for disclosing only their own usage.

### Never Commit

- `node_modules/` (in .gitignore)
- Secrets or credentials
- Agent-specific directories (`.claude/`, `.cursor/`, `.gemini/`, etc.)

## Accessibility Standards

**IMPORTANT**: All AI agents must read and follow accessibility requirements.

📋 **[ACCESSIBILITY.md](./ACCESSIBILITY.md)** - Accessibility commitment, WCAG 2.2 AA requirements, and best practices

This document defines:
- WCAG 2.2 Level AA compliance requirements
- Development best practices for accessible code
- Security patterns (avoid command injection)
- Testing requirements and quality gates
- Trusted accessibility resources

## Tool-Specific Instructions

### GitHub Copilot

Comprehensive GitHub Copilot instructions: [`.github/copilot-instructions.md`](.github/copilot-instructions.md)

### Spec Kitty

Spec Kitty agent rules (project management): **[`.kittify/AGENTS.md`](https://github.com/mgifford/alfa-scan/blob/main/.kittify/AGENTS.md)**

These rules are CRITICAL for agents working with Spec Kitty commands and include:
- Path reference requirements
- UTF-8 encoding rules
- Context management
- Work quality standards
- Git discipline and best practices

### Cursor, Claude, Gemini, Codex, etc.

Follow the general guidelines above. Refer to these comprehensive resources:
- [`.github/copilot-instructions.md`](.github/copilot-instructions.md) - Detailed architecture and patterns
- [`ACCESSIBILITY.md`](./ACCESSIBILITY.md) - Accessibility requirements and best practices
- [`.kittify/AGENTS.md`](https://github.com/mgifford/alfa-scan/blob/main/.kittify/AGENTS.md) - Spec Kitty project management rules

## Key Dependencies

- `@siteimprove/alfa-cli`: Core accessibility testing
- `@siteimprove/alfa-formatter-earl`: EARL report formatting
- `@siteimprove/alfa-formatter-json`: JSON report formatting

## Getting Help

- **Project Structure**: See `.github/copilot-instructions.md`
- **Accessibility Standards**: See `ACCESSIBILITY.md`
- **Testing Patterns**: See `tests/unit/*.test.mjs` examples
- **Scanner Implementation**: See `scanner/*.mjs` modules
- **Spec Kitty Workflows**: See [`.kittify/AGENTS.md`](https://github.com/mgifford/alfa-scan/blob/main/.kittify/AGENTS.md)
