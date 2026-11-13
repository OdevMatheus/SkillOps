# AGENTS.md — Canonical AI Engineering & Governance Contract

> **Role:** Active Maintainer & Core Architect of **SkillOps** (`npx skillops-cli@latest`, `v1.5.2`).  
> **Scope:** Zero-Bloat Node.js 20+ / TypeScript 28-IDE Transpiler Engine (`src/`) + Hybrid Executable Skills & Context-Isolated Subagents (`catalog/`).

---

## 0. Mandatory `.github/` Pre-Flight Protocol

Before writing code, editing docs, committing, or running `gh` commands, inspect:
1. `.github/workflows/` (`pr-governance.yml`, `ai-ci.yml`, `codeql.yml`, `npm-publish.yml`, `labeler.yml`, `release-drafter.yml`, `stale.yml`) & `.github/actions/skillops-audit/action.yml`
2. `.github/PULL_REQUEST_TEMPLATE.md` & `.github/ISSUE_TEMPLATE/` (`bug_report.yml`, `feature_request.yml`, `agent_improvement.yml`)
3. `.github/CODEOWNERS`, `.github/SECURITY.md`, `.github/labeler.yml`, `.github/copilot-instructions.md` & `.github/agents/*.agent.md`
4. `SKILL_CONTRACT.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `package.json`, `.skillops.yml` & `.gitattributes`

---

## 1. Architecture & Repository Map (`v1.5.2` — 28 AI Coding Agents)

- `src/models.ts` — Normative Zod v3 contracts (`SkillManifestSchema`, `SubagentManifestSchema`, `SyncLockfileSchema`, `SkillOpsConfigSchema`, `ScriptOutputSchema`, `EvalSuiteSchema`, `BenchmarkReportSchema`), `ExitCode` (`0`–`5`), linear path normalizers (`trimTrailingSlashes`), and `RUNTIME_HARNESS_SPECS` for all 28 supported AI IDEs and CLIs.
- `src/auditor/` (`parser.ts`, `security.ts`, `index.ts`) — Skill directory and subagent manifest discovery/validation (`parseSkillDirectory`, `parseSubagentFile`) and static supply-chain security scanning (`auditCatalogSecurity`, `auditSkillSecurity` enforcing `INV-SKILL-06`).
- `src/sync/` (`adapters.ts`, `index.ts`) — Deterministic 28-IDE manifest transpiler (`renderSkillFilesForRuntime`, `renderSubagentFilesForRuntime`), companion file path rewriting, SHA-256 `.skillops-lock.json` drift protection, and canonical workspace containment (`resolveSafeRepoTargetPath`).
- `src/ui/` (`lipgloss.ts`, `prompt.ts`, `terminal.ts`, `help.ts`, `index.ts`) — Zero-dependency Charmbracelet Lip Gloss-styled ANSI terminal renderer, command help tables, and interactive multi-select TUI prompts.
- `src/cli.ts` & `src/index.ts` — `npx skillops-cli@latest` CLI entrypoint (`add`, `status`, `update`, `remove`, `audit`) and public ESM library exports.
- `catalog/` — Verified Hybrid Executable Skills across 4 tracks (`ai-engineering`, `python-backend`, `arch-quality`, `token-economy`) pairing concise `SKILL.md` files with stdlib Python 3.12+ `scripts/*.py --json` tools and `evals/{evals,benchmark}.json`, plus Context-Isolated Subagents (`catalog/subagents/*/SUBAGENT.md`).
- `tests/` — Vitest unit, contract, transpiler sync, and TUI suites (`tests/*.test.ts`).
- `docs/architecture/` — System overview (`README.md`) & Architecture Decision Records (`0001`–`0005`).
- `DOCS-DEV/` — Local-only **Portuguese (`pt-BR`)** developer mirror (**gitignored**; never stage or commit).

---

## 2. Verification & CLI Commands

Run all quality and security gates before requesting commit approval:
```bash
npm run lint && npm run typecheck && npm test && npm run build
node dist/cli.js add mcp-architect --targets cursor,claude,copilot,antigravity --dry-run
node dist/cli.js status
```

---

## 3. Agile Governance (`1 Issue = 1 Branch = 1 PR`)

1. **Sprints = GitHub Milestones:** Core engine Issues and PRs belong to an active Sprint Milestone and carry scope/type Labels (`🐍 core-engine`, `🧠 skill-catalog`, `⚙️ ci`, `📄 docs`, `✨ feat`, `🐛 fix`, etc.). Community catalog submissions (`catalog/`) follow the fast-track PR workflow in `CONTRIBUTING.md`.
2. **Branch Protection:** Never commit or push directly to `main`. Use `<type>/<short-kebab-slug>` (`feat/...`, `fix/...`, `docs/...`, `ci/...`, `refactor/...`, `test/...`).
3. **Conventional Commits (`en-US`):** Lowercase imperative (`feat(sync): ...`, `fix(security): ...`, `docs(contract): ...`). Update `CHANGELOG.md` (`## [Unreleased]`) for notable changes.

---

## 4. Mandatory Pre-Commit & Push Review Gate

**Never** execute `git commit`, `git push`, or `gh issue`/`gh pr` write commands without explicit authorization. Present:
1. **Branch & Issue/Milestone/Labels**
2. **Changed Files (`git status --short` + `DOCS-DEV/` sync check)**
3. **Verification Results (`lint`, `typecheck`, `test`, `build`, `add --dry-run`, `status`)**
4. **Exact Commit Title & PR Body Proposal**

---

## 5. Language, Security & Sanitization Rules

- **Bilingual Policy:** All tracked files must be in **English (`en-US`)**. Keep synchronized **Portuguese (`pt-BR`)** mirrors in `DOCS-DEV/` (gitignored).
- **Sanitization:** Never expose local filesystem paths, OS usernames, internal domains, `.env` files, or AI provider API keys (`sk-proj-...`, `sk-ant-...`, `AIzaSy...`, `hf_...`).
