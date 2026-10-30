# GitHub Copilot Instructions — SkillOps

Always follow [`AGENTS.md`](../AGENTS.md) and [`SKILL_CONTRACT.md`](../SKILL_CONTRACT.md) as the canonical architecture and governance contracts for this repository.

## Mandatory Pre-Flight Protocol
- Before generating code, commits, or PR descriptions, inspect `.github/` (`workflows/`, `PULL_REQUEST_TEMPLATE.md`, `ISSUE_TEMPLATE/`, `CODEOWNERS`, `labeler.yml`, `release-drafter.yml`, and `agents/`) as well as [`SKILL_CONTRACT.md`](../SKILL_CONTRACT.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`CHANGELOG.md`](../CHANGELOG.md), and [`.gitattributes`](../.gitattributes).
- Respect the **`1 Issue = 1 Branch = 1 PR`** agile discipline, **Sprint Milestones**, and **Mandatory Pre-Commit & Push Review Gate**.

## Core Engineering & AI Standards
- **Language Policy:** Write all tracked repository files, code comments, commit messages, and PR bodies in **English (`en-US`)**. Keep the local developer documentation mirror inside `DOCS-DEV/` in **Portuguese (`pt-BR`)** (gitignored).
- **TypeScript / Node.js 20+ NPX Engine (`src/`):** Use strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`), Zod v3 schemas (`src/models.ts`), and Vitest (`tests/*.test.ts`). Zero external LLM APIs or HTTP servers.
- **Hybrid Executable Skills & Subagents (`catalog/`):** Every catalog skill requires `SKILL.md` (`L1: 40–110 words <= 160 tokens`, `L2: <= 250 lines`), a deterministic Python 3.12+ CLI tool (`scripts/*.py --json`), and `evals/evals.json` + `evals/benchmark.json`. Subagents forbid wildcard `["*"]` tools and cap `max_output_tokens <= 400`.
- **Sanitization & Security:** Never expose local filesystem paths, OS usernames, or AI provider API keys (`sk-proj-...`, `sk-ant-...`, `AIzaSy...`).
