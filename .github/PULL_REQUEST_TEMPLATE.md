## Summary

<!-- Describe what this PR changes, why it is needed, and link the corresponding GitHub Issue + Sprint Milestone. -->

Closes #

## Type of Change

- [ ] `feat` — New `SkillOps` NPX engine capability (`src/`), Hybrid Executable Skill, or Context-Isolated Subagent (`catalog/`)
- [ ] `fix` — Bug fix, schema fix, or false-positive correction
- [ ] `docs` — Architecture Decision Record (`ADR`), `SKILL_CONTRACT.md`, or documentation update
- [ ] `ci` / `chore` — GitHub Actions, DevOps automation, or tooling maintenance
- [ ] `refactor` / `test` — Structural refactoring or Vitest / TDD benchmark suite addition

## Pre-Flight & Governance Checklist (`AGENTS.md` & `SKILL_CONTRACT.md`)

- [ ] **1 Issue = 1 Branch = 1 PR:** Linked to an Issue and assigned to the active **Sprint Milestone** and **Labels**.
- [ ] **English Only (`en-US`):** All tracked files, code comments, and commit messages are written in English (`en-US`).
- [ ] **Local Mirror (`DOCS-DEV/`):** Updated the corresponding Portuguese (`pt-BR`) documentation mirror locally (and verified `DOCS-DEV/` remains gitignored).
- [ ] **Hybrid Skill & Subagent Contract (if touching `catalog/`):**
  - [ ] `SKILL.md` description (`40–110 words`, `<= 160 tokens`) starts with `"Use when..."` and body is `<= 250 lines` (`INV-SKILL-01`).
  - [ ] Subagent `AGENT.md` / `.agent.md` forbids wildcard `["*"]` tools and sets `max_output_tokens <= 400` (`INV-SKILL-04`).
  - [ ] Deterministic CLI tool (`scripts/*.py`) supports `--json` and returns structured JSON.
  - [ ] `evals/evals.json` and `evals/benchmark.json` validate `with_skill` vs `without_skill` lift (`INV-SKILL-05`).
- [ ] **NPX Verification Gates:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx skillops audit --strict`, and `npx skillops tokens --strict` pass.
- [ ] **Changelog:** Updated `CHANGELOG.md` under `## [Unreleased]` (if applicable).
- [ ] **Sanitization:** Zero local machine paths, OS usernames, or leaked AI API keys (`sk-proj-...`, `sk-ant-...`, `AIzaSy...`).
