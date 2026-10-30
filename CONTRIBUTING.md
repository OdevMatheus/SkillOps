# Contributing to SkillOps

Thank you for contributing to **SkillOps** (`npx skillops@latest`)! Because SkillOps is an **AI-Agent-first** open-source platform powered by a **Zero-API Node.js 20+ / TypeScript engine** and **deterministic Python 3.12+ catalog scripts**, these guidelines apply equally to **human contributors** and **AI coding agents** (Claude Code, Antigravity, Cursor, OpenAI Codex CLI, GitHub Copilot, Gemini CLI).

---

## 1. Mandatory Pre-Flight Protocol

Before writing code, modifying documentation, or opening an Issue/Pull Request, read:

1. [`AGENTS.md`](./AGENTS.md) — The canonical architecture and development governance contract.
2. [`SKILL_CONTRACT.md`](./SKILL_CONTRACT.md) — The normative specification for Hybrid Executable Skills, Context-Isolated Subagents, 3-level token budgets, semantic collision audits, and TDD evaluations.
3. [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) — Repository-wide coding and sanitization rules.
4. [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md) — Required structure for all Pull Requests.

---

## 2. Language & Bilingual Mirror Policy

- **Tracked Repository Files (`en-US`):** All files tracked by Git (`README.md`, `AGENTS.md`, `SKILL_CONTRACT.md`, `CONTRIBUTING.md`, `.github/**`, workflows, TypeScript/Python docstrings and comments, commit messages, and Pull Request descriptions) **must be written in English (`en-US`)**.
- **Local Developer Mirror (`DOCS-DEV/` in `pt-BR`):** Every documentation or governance file created/updated in the repository must have a synchronized **Portuguese (`pt-BR`)** counterpart inside `DOCS-DEV/` (which is ignored by Git via `.gitignore`).

---

## 3. Branching, Verification & Commit Strategy

### 3.1 Branch Protection & Naming
- **Never commit or push directly to `master`.**
- Create a descriptive branch from `master`:
  - `feat/<short-slug>` — New NPX CLI commands, engine modules (`src/`), hybrid executable skills, or subagents (`catalog/`)
  - `fix/<short-slug>` — Bug fixes, schema fixes, or false-positive corrections
  - `docs/<short-slug>` — Documentation, ADRs, and governance updates
  - `chore/<short-slug>` / `ci/<short-slug>` — Repository tooling, CI/CD, or `.github/` maintenance
  - `refactor/<short-slug>` — Structural refactoring without behavior changes
  - `test/<short-slug>` — Vitest unit, contract, or TDD benchmark evaluation suites

### 3.2 Local Verification Suite
Run all verification gates before opening a PR:
```bash
npm run lint
npm run typecheck
npm test
npm run build
node dist/cli.js audit --catalog catalog --strict --require-layout
node dist/cli.js tokens --strict
node dist/cli.js eval --catalog catalog --strict
```

### 3.3 Conventional Commits
All commit messages and Pull Request titles **must** follow [Conventional Commits](https://www.conventionalcommits.org/) in lowercase imperative `en-US`:
- `feat(npx-tokens): implement Repository Token Economy & Startup Context Tax Analyzer`
- `feat(catalog-ai): add mcp-architect hybrid skill and inspector script`
- `docs(architecture): update SKILL_CONTRACT.md for NPX engine`
- `ci(devops): align AI governance and CI workflows with NPX architecture`

---

## 4. Pull Request Workflow via GitHub CLI (`gh`)

All Pull Requests should be created or updated using the **GitHub CLI (`gh`)** so that the template, **Labels**, and **Sprint Milestone** are applied automatically:

```bash
gh pr create \
  --base master \
  --head <type>/<short-slug> \
  --title "<type>(<scope>): <description>" \
  --body-file <filled-pull-request-template.md> \
  --label "<scope-and-type-labels>" \
  --milestone "<sprint-milestone-title>"
```

### Official Repository Labels
- **Scope:** `🔴 core-architecture`, `🐍 core-engine`, `🧠 skill-catalog`, `🧪 eval-benchmark`, `🔄 multi-runtime`, `🔌 mcp-server`, `⚠️ agent-behavior`, `📄 docs`, `⚙️ ci`
- **Type:** `✨ feat`, `🐛 fix`, `♻️ refactor`, `🔒 security`
- **Lifecycle:** `🗺️ roadmap`, `🚧 work-in-progress`, `📌 pinned`

---

## 5. Privacy, Security & Sanitization Checklist

Every contribution is automatically audited by [`.github/workflows/pr-governance.yml`](./.github/workflows/pr-governance.yml) and [`.github/workflows/ai-ci.yml`](./.github/workflows/ai-ci.yml):
1. **No Absolute Machine Paths:** Never include `C:\Users\...`, `/Users/...`, or `/home/...` in any tracked file. Always use relative paths (`./...`).
2. **No Environment or Corporate Metadata:** Never expose OS usernames, internal domains, or non-public references.
3. **No Secrets or AI API Keys:** Never commit `.env` files, AI provider keys (`sk-proj-...`, `sk-ant-...`, `AIzaSy...`, `hf_...`), or private tokens.
4. **Line Endings & Strict Typing:** Respect [`.gitattributes`](./.gitattributes) (`UTF-8` encoding and `LF` line endings) and strict TypeScript (`npm run typecheck`).
