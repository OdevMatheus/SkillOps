# Contributing to SkillOps

Thank you for contributing to **SkillOps**! Because SkillOps is an **AI-Agent-first** Python 3.12+ open-source platform, these guidelines apply equally to **human contributors** and **AI coding agents** (Claude Code, Antigravity, Cursor, OpenAI Codex CLI, GitHub Copilot, Gemini CLI, etc.).

---

## 1. Mandatory Pre-Flight Protocol

Before writing code, modifying documentation, or opening an Issue/Pull Request, read:

1. [`AGENTS.md`](./AGENTS.md) — The canonical architecture and development governance contract.
2. [`SKILL_CONTRACT.md`](./SKILL_CONTRACT.md) — The normative specification for Hybrid Executable Skills, 3-level token budgets, semantic collision audits, and TDD evaluations.
3. [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) — Repository-wide coding and sanitization rules.
4. [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md) — Required structure for all Pull Requests.

---

## 2. Language & Bilingual Mirror Policy

- **Tracked Repository Files (`en-US`):** All files tracked by Git (`README.md`, `AGENTS.md`, `SKILL_CONTRACT.md`, `CONTRIBUTING.md`, `.github/**`, workflows, Python docstrings/comments, commit messages, and Pull Request descriptions) **must be written in English (`en-US`)**.
- **Local Developer Mirror (`DOCS-DEV/` in `pt-BR`):** Every documentation or governance file created/updated in the repository must have a synchronized **Portuguese (`pt-BR`)** counterpart inside `DOCS-DEV/` (which is ignored by Git via `.gitignore`).

---

## 3. Branching & Commit Strategy

### 3.1 Branch Protection & Naming
- **Never commit or push directly to `master`.**
- Create a descriptive branch from `master`:
  - `feat/<short-slug>` — New CLI commands, engine modules, or hybrid executable skills
  - `fix/<short-slug>` — Bug fixes, schema fixes, or false-positive corrections
  - `docs/<short-slug>` — Documentation, ADRs, and governance updates
  - `chore/<short-slug>` — Repository tooling, CI/CD, or `.github/` maintenance
  - `refactor/<short-slug>` — Structural refactoring without behavior changes
  - `test/<short-slug>` — Unit, contract, or TDD benchmark evaluation suites

### 3.2 Conventional Commits
All commit messages and Pull Request titles **must** follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat(auditor): implement pairwise cosine similarity collision detector`
- `feat(catalog-ai): add mcp-architect hybrid skill and inspector script`
- `docs(architecture): define SKILL_CONTRACT.md and ADRs 0001-0004`
- `ci(python): add GitHub Actions workflow for ruff, mypy --strict, and pytest`

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

Every contribution is automatically audited by [`.github/workflows/pr-governance.yml`](./.github/workflows/pr-governance.yml):
1. **No Absolute Machine Paths:** Never include `C:\Users\...`, `/Users/...`, or `/home/...` in any tracked file. Always use relative paths (`./...`).
2. **No Environment or Corporate Metadata:** Never expose OS usernames, internal domains, or non-public references.
3. **No Secrets or Credentials:** Never commit `.env` files, API tokens, or private keys.
4. **Line Endings & Formatting:** Respect [`.editorconfig`](./.editorconfig) and [`.gitattributes`](./.gitattributes) (`UTF-8` encoding and `LF` line endings).
