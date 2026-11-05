## Summary

<!-- Describe what this PR changes and why. -->
<!-- Track A (New Skills / Subagents in `catalog/`): No Issue required — write "N/A (Catalog contribution)" below if no Issue exists. -->
<!-- Track B (Core CLI, TUI, Transpiler, CI, or Architecture changes in `src/`): Linking a prior Issue (`Closes #<id>`) is mandatory. -->

Closes #

## Contribution Track & Type of Change

- [ ] **Track A — Catalog (`catalog/`):** New or updated Skill (`SKILL.md`) or Subagent (`SUBAGENT.md`) *(Issue optional)*
- [ ] **Track B — Core Solution (`src/`, `.github/`, `docs/`):** CLI, TUI, transpiler, tests, or infrastructure *(Issue required)*

## Pre-Flight & Governance Checklist (`CONTRIBUTING.md` & `SKILL_CONTRACT.md`)

- [ ] **Issue Policy:** Linked to an approved Issue (`Closes #<id>`) if modifying the Core Solution (**Track B**), or isolated to `catalog/` (**Track A**).
- [ ] **English Only (`en-US`):** All tracked files, code comments, commit messages, and the PR title are written in English (`en-US`).
- [ ] **Catalog Contract (if touching `catalog/`):**
  - [ ] `SKILL.md` description (`40–110` words, `<= 160` tokens) starts with `"Use when..."` and body is `<= 250` lines (`INV-SKILL-01`).
  - [ ] `SUBAGENT.md` forbids wildcard `["*"]` tools and sets `max-output-tokens <= 400` (`INV-SKILL-04`).
  - [ ] Verified dry-run transpilation across all 28 targets (`node dist/cli.js add <name> --targets all --dry-run`).
- [ ] **Verification Gates:** `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` pass locally.
- [ ] **Sanitization:** Zero local machine paths (`C:\Users\...`, `/Users/...`), OS usernames, or leaked AI API keys (`sk-proj-...`, `sk-ant-...`, `AIzaSy...`).
