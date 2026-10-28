# GitHub Copilot Instructions for FolioOps

First, read and follow [`/AGENTS.md`](../AGENTS.md), which is the central source of truth for AI agent behavior in this repository.

---

## 0. Mandatory Pre-Flight Check (`.github/` & Root Governance First)

Before executing any task, modifying files, creating branches/commits, or drafting issues/PRs, you **must** inspect the rules and templates in `.github/` and the repository root:
- **Workflows & CI Gates:** [`.github/workflows/pr-governance.yml`](./workflows/pr-governance.yml), [`.github/labeler.yml`](./labeler.yml), and [`.github/release-drafter.yml`](./release-drafter.yml)
- **PR Templates:** [`.github/PULL_REQUEST_TEMPLATE.md`](./PULL_REQUEST_TEMPLATE.md) and [`.github/PULL_REQUEST_TEMPLATE/docs-and-agents.md`](./PULL_REQUEST_TEMPLATE/docs-and-agents.md)
- **Issue Templates:** [`.github/ISSUE_TEMPLATE/`](./ISSUE_TEMPLATE/) (`bug_report.yml`, `feature_request.yml`, `agent_improvement.yml`)
- **Ownership, Security & Community:** [`.github/CODEOWNERS`](./CODEOWNERS), [`.github/SECURITY.md`](./SECURITY.md), [`/CONTRIBUTING.md`](../CONTRIBUTING.md), [`/CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md), and [`/CHANGELOG.md`](../CHANGELOG.md)
- **Formatting & Encoding:** [`/.editorconfig`](../.editorconfig) and [`/.gitattributes`](../.gitattributes) (`UTF-8` encoding, `LF` line endings, 2-space indentation)
- **Specialized Agents:** [`.github/agents/`](./agents/) (`pr-brief.agent.md`, `docs-sync.agent.md`, `address-review.agent.md`)

---

## 1. Repository Context & Mode

**FolioOps** is currently in its **Initial Development Phase (Developer Mode)**.
- When working on this repository, you are assisting the **Developer/Maintainer** in building the FolioOps framework itself.
- Do **not** treat the developer as an end-user trying to generate a personal portfolio unless explicitly running an end-user simulation test.

---

## 2. Non-Negotiable Governance Rules

1. **Language Standard:**
   - All tracked repository files must be written in **English (`en-US`)**.
   - Every documentation/instruction file must have an up-to-date **Portuguese (`pt-BR`)** translated mirror inside `DOCS-DEV/` (which is gitignored).
2. **Branching & Protected `master`:**
   - **NEVER push directly to `master` (or `main`)**.
   - Always use a dedicated branch following `<type>/<short-kebab-description>` (`feat/...`, `fix/...`, `docs/...`, `chore/...`, `refactor/...`, `test/...`).
3. **Semantic Commits & Changelog:**
   - All commits and PR titles must be in **English (`en-US`)** and follow **Conventional Commits** (`<type>(<optional-scope>): <short imperative description>`).
   - Keep `## [Unreleased]` in [`/CHANGELOG.md`](../CHANGELOG.md) (and `DOCS-DEV/CHANGELOG.md`) updated with notable changes.
4. **Pull Requests, Labels, Milestones & Epics via `gh` CLI:**
   - Always use the **GitHub CLI (`gh`)** to open/update PRs and Issues so the body strictly matches `.github/PULL_REQUEST_TEMPLATE.md`.
   - Every PR and Issue must be assigned the appropriate **Labels** (`🔴 core-architecture`, `⚠️ agent-behavior`, `📄 docs`, `🔌 plugin`, `⚙️ ci`, `✨ feat`, `🐛 fix`, `♻️ refactor`, `🔒 security`) and linked to the active **Agile Milestone (Sprint)** and **Sprint Epic Issue (`#7`–`#10`)**.
5. **Mandatory Review Gate:**
   - Always request developer review (showing target branch, modified files, proposed commit message, and target labels/milestone) before executing `git commit`, `git push`, or `gh pr create`.
6. **Minimal & Agile Diffs:**
   - One focused task per session. Avoid premature abstractions, unnecessary dependencies, or drive-by refactors.
