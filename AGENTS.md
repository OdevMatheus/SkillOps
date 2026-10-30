# AGENTS.md — Canonical AI Engineering & Governance Contract

> **Role:** Active Maintainer & Core Architect of **SkillOps** (`npx skillops@latest`).  
> **Scope:** Node.js 20+ / TypeScript Zero-API Engine (`src/`) + Hybrid Executable Skills & Context-Isolated Subagents (`catalog/`).

---

## 0. Mandatory `.github/` Pre-Flight Protocol

Before writing code, editing docs, committing, or running `gh` commands, inspect:
1. `.github/workflows/` (`pr-governance.yml`, `ai-ci.yml`, `labeler.yml`, `release-drafter.yml`, `stale.yml`) & `.github/actions/skillops-audit/action.yml`
2. `.github/PULL_REQUEST_TEMPLATE.md` & `.github/ISSUE_TEMPLATE/` (`bug_report.yml`, `feature_request.yml`, `agent_improvement.yml`)
3. `.github/CODEOWNERS`, `.github/labeler.yml`, `.github/copilot-instructions.md` & `.github/agents/*.agent.md`
4. `SKILL_CONTRACT.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `package.json`, `.skillops.yml` & `.gitattributes`

---

## 1. Architecture & Repository Map

- `src/` — Zero-API TypeScript NPX Engine (`models.ts`, `cli.ts`, `auditor/`, `router/`, `sync/`, `eval/`, `mcp/`).
- `catalog/` — Benchmark-Verified Hybrid Skills (`SKILL.md` + Python 3.12+ `scripts/*.py --json` + `evals/`) & Context-Isolated Subagents (`catalog/subagents/`).
- `tests/` — Vitest unit, contract, token-economy, and stress suites (`tests/*.test.ts`).
- `docs/architecture/` — System overview & ADRs (`0001`–`0004`).
- `DOCS-DEV/` — Local-only **Portuguese (`pt-BR`)** developer mirror (**gitignored**; never stage or commit).

---

## 2. Verification & CLI Commands

Run all gates before requesting commit approval:
```bash
npm run lint && npm run typecheck && npm test && npm run build
node dist/cli.js audit --catalog catalog --strict --require-layout
node dist/cli.js tokens --strict
node dist/cli.js eval --catalog catalog --strict
```

---

## 3. Agile Governance (`1 Issue = 1 Branch = 1 PR`)

1. **Sprints = GitHub Milestones:** Every Issue and PR must belong to an active Sprint Milestone and carry scope/type Labels (`🐍 core-engine`, `🧠 skill-catalog`, `⚙️ ci`, `📄 docs`, `✨ feat`, `🐛 fix`, etc.).
2. **Branch Protection:** Never commit or push directly to `master`. Use `<type>/<short-kebab-slug>` (`feat/...`, `fix/...`, `docs/...`, `ci/...`, `refactor/...`, `test/...`).
3. **Conventional Commits (`en-US`):** Lowercase imperative (`feat(auditor): ...`, `ci(devops): ...`, `docs(contract): ...`). Update `CHANGELOG.md` (`## [Unreleased]`) for notable changes.

---

## 4. Mandatory Pre-Commit & Push Review Gate

**Never** execute `git commit`, `git push`, or `gh issue`/`gh pr` write commands automatically. First stop and present:
1. **Branch & Issue/Milestone/Labels**
2. **Changed Files (`git status --short` + `DOCS-DEV/` sync check)**
3. **Verification Results (`lint`, `typecheck`, `test`, `build`, `audit`, `tokens`, `eval`)**
4. **Exact Commit Title & PR Body Proposal**

Wait for explicit user approval (`"Aprovo"` / `"Approved"`) before committing or pushing.

---

## 5. Language, Security & Sanitization Rules

- **Bilingual Policy:** All tracked files must be in **English (`en-US`)**. Keep synchronized **Portuguese (`pt-BR`)** mirrors in `DOCS-DEV/` (gitignored).
- **Sanitization:** Never expose local filesystem paths, OS usernames, internal domains, `.env` files, or AI provider API keys (`sk-proj-...`, `sk-ant-...`, `AIzaSy...`, `hf_...`).
