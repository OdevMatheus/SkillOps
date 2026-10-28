# GitHub Copilot Instructions for FolioOps

First, read and follow [`/AGENTS.md`](../AGENTS.md), which is the central source of truth for AI agent behavior in this repository.

---

## 0. Mandatory Pre-Flight Check (`.github/` First)

Before executing any task, modifying files, creating branches/commits, or drafting issues/PRs, you **must** inspect the rules and templates in `.github/`:
- **Workflows & CI Gates:** [`.github/workflows/pr-governance.yml`](./workflows/pr-governance.yml) and [`.github/labeler.yml`](./labeler.yml)
- **PR Templates:** [`.github/PULL_REQUEST_TEMPLATE.md`](./PULL_REQUEST_TEMPLATE.md) and [`.github/PULL_REQUEST_TEMPLATE/docs-and-agents.md`](./PULL_REQUEST_TEMPLATE/docs-and-agents.md)
- **Issue Templates:** [`.github/ISSUE_TEMPLATE/`](./ISSUE_TEMPLATE/) (`bug_report.yml`, `feature_request.yml`, `agent_improvement.yml`)
- **Ownership & Security:** [`.github/CODEOWNERS`](./CODEOWNERS) and [`.github/SECURITY.md`](./SECURITY.md)
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
3. **Semantic Commits:**
   - All commits must be in **English (`en-US`)** and follow **Conventional Commits** (`<type>(<optional-scope>): <short imperative description>`).
4. **Mandatory Review Gate:**
   - Always request developer review (showing target branch, modified files, and proposed commit message) before executing `git commit` or `git push`.
5. **Minimal & Agile Diffs:**
   - One focused task per session. Avoid premature abstractions, unnecessary dependencies, or drive-by refactors.
