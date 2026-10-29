# GitHub Copilot Instructions for SkillOps

First, read and follow [`/AGENTS.md`](../AGENTS.md) and [`/SKILL_CONTRACT.md`](../SKILL_CONTRACT.md), which are the central sources of truth for AI agent behavior and technical contracts in this repository.

---

## 0. Mandatory Pre-Flight Check (`.github/` & Root Governance First)

Before executing any task, modifying files, creating branches/commits, or drafting issues/PRs, you **must** inspect the rules and templates in `.github/` and the repository root:
- **Workflows & CI Gates:** [`.github/workflows/pr-governance.yml`](./workflows/pr-governance.yml), [`.github/labeler.yml`](./labeler.yml), and [`.github/release-drafter.yml`](./release-drafter.yml)
- **PR Templates:** [`.github/PULL_REQUEST_TEMPLATE.md`](./PULL_REQUEST_TEMPLATE.md) and [`.github/PULL_REQUEST_TEMPLATE/docs-and-agents.md`](./PULL_REQUEST_TEMPLATE/docs-and-agents.md)
- **Issue Templates:** [`.github/ISSUE_TEMPLATE/`](./ISSUE_TEMPLATE/) (`bug_report.yml`, `feature_request.yml`, `agent_improvement.yml`)
- **Ownership, Security & Community:** [`.github/CODEOWNERS`](./CODEOWNERS), [`.github/SECURITY.md`](./SECURITY.md), [`/CONTRIBUTING.md`](../CONTRIBUTING.md), [`/CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md), and [`/CHANGELOG.md`](../CHANGELOG.md)
- **Formatting & Encoding:** [`/.editorconfig`](../.editorconfig) and [`/.gitattributes`](../.gitattributes) (`UTF-8` encoding, `LF` line endings)
- **Specialized Agents:** [`.github/agents/`](./agents/) (`pr-brief.agent.md`, `docs-sync.agent.md`, `address-review.agent.md`)

---

## 1. Repository Context & Mode

**SkillOps** is the **Python 3.12+ Engine & Benchmark-Verified Library for AI Coding Agent Skills & Subagents**.
- When working on this repository, you are assisting the **Developer/Maintainer** (`@OdevMatheus`) in building the `SkillOps` Core Engine (`src/skillops/`) and the Hybrid Executable Skill Catalog (`catalog/`).

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
   - Every PR and Issue must be assigned the appropriate **Labels** (`🔴 core-architecture`, `🐍 core-engine`, `🧠 skill-catalog`, `🧪 eval-benchmark`, `🔄 multi-runtime`, `🔌 mcp-server`, `⚠️ agent-behavior`, `📄 docs`, `⚙️ ci`, `✨ feat`, `🐛 fix`, `♻️ refactor`, `🔒 security`) and linked to the active Sprint Milestone.
5. **Mandatory Review Gate:**
   - Always request developer review (showing target branch, modified files, proposed commit message, and target labels/milestone) before executing `git commit`, `git push`, or `gh pr create`.
6. **Minimal & Agile Diffs (`1 Issue = 1 PR`):**
   - One focused task per PR. Avoid premature abstractions, unnecessary dependencies, or drive-by refactors.
