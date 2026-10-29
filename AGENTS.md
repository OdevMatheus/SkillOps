# FolioOps — AI Agent Instructions (Developer Mode)

> **Current Phase:** Initial Development (Building the FolioOps Framework)  
> **Target Audience of this File:** AI Agents (Claude Code, Antigravity, Cursor, Copilot, etc.) pair-programming with the **Developer/Creator** to build the FolioOps initiative.

---

## 0. Mandatory Pre-Flight Protocol: Always Check `.github/` First

**CRITICAL RULE:** Before starting any task, proposing changes, creating branches/commits, drafting issues, or opening Pull Requests, you **MUST** inspect and adhere to the governance rules, templates, labels, milestones, and workflows inside [`.github/`](./.github/):

1. **Governance & Security Boundaries:**
   - [`.github/copilot-instructions.md`](./.github/copilot-instructions.md): Core operational rules and boundaries.
   - [`.github/CODEOWNERS`](./.github/CODEOWNERS): Protected paths requiring maintainer review (`@OdevMatheus`).
   - [`.github/SECURITY.md`](./.github/SECURITY.md): Privacy, local data isolation, and prompt safety policies.
   - [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md), [`CHANGELOG.md`](./CHANGELOG.md), & [`LICENSE`](./LICENSE): Open-source community and release standards.
2. **Automated CI Validation Rules:**
   - [`.github/workflows/pr-governance.yml`](./.github/workflows/pr-governance.yml): Exact regex rules enforced by CI for branch names, semantic PR titles, core file integrity, and blocked local files (`DOCS-DEV/`, `.env*`).
   - [`.github/labeler.yml`](./.github/labeler.yml) & [`.github/release-drafter.yml`](./.github/release-drafter.yml): Scope categories, automatic PR labeling, and automated release note drafting.
3. **Mandatory Templates (PRs & Issues):**
   - [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md) & [`.github/PULL_REQUEST_TEMPLATE/docs-and-agents.md`](./.github/PULL_REQUEST_TEMPLATE/docs-and-agents.md): Always use these exact templates when preparing or opening a Pull Request.
   - [`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE/): Always follow [`bug_report.yml`](./.github/ISSUE_TEMPLATE/bug_report.yml), [`feature_request.yml`](./.github/ISSUE_TEMPLATE/feature_request.yml), or [`agent_improvement.yml`](./.github/ISSUE_TEMPLATE/agent_improvement.yml) when creating or structuring issues.
4. **Specialized Maintenance Agents:**
   - [`.github/agents/`](./.github/agents/): Reference [`pr-brief.agent.md`](./.github/agents/pr-brief.agent.md), [`docs-sync.agent.md`](./.github/agents/docs-sync.agent.md), and [`address-review.agent.md`](./.github/agents/address-review.agent.md) when reviewing PRs, auditing `DOCS-DEV/` synchronization, or addressing review feedback.
5. **System Architecture, ADRs & Data Contract (`docs/architecture/` & `DATA_CONTRACT.md`):**
   - [`docs/architecture/README.md`](./docs/architecture/README.md): Master System Architecture & Design Specification (`career-ops` Mode Router, 6-Block `auto-pipeline`, Two-Stage `inbox/` → `profile/` Data Layer, Next.js Static Export Stack, and Multi-Stage Quality Gates).
   - [`docs/architecture/adr/`](./docs/architecture/adr/): Architecture Decision Records (`ADR-0001` through `ADR-0004`).
   - [`DATA_CONTRACT.md`](./DATA_CONTRACT.md): Canonical separation between `PROJECT_ROOT` (System Layer) and `DATA_ROOT` (User Layer), schemas for `profile/_profile.md`, `profile/_design.md`, `profile/_custom.md`, `config/profile.yml`, and EARS functional invariants.

---

## 1. What is FolioOps? (Product Vision)

**FolioOps** is an open-source initiative aimed at democratizing Web portfolio creation. The end goal is to allow **any professional from any industry** (healthcare, law, architecture, design, engineering, arts, technology, etc.) to clone this repository and build their own custom Web portfolio simply by interacting with an AI Agent.

**Important Distinction:**  
Right now, **we are building the FolioOps engine/framework itself** — we are **not** acting as the end-user creating a personal portfolio. Your role as the AI Agent is to act as a **Software Architect & Agile Pair-Programmer** helping the developer build this initiative from the ground up.

---

## 2. Development Methodology (Agile & Incremental)

1. **No Rushing / Zero Over-Engineering:**
   - Do not scaffold complex folder trees, heavy dependencies, or premature abstractions all at once.
   - Build only what is requested for the current step/iteration.
2. **Iterative Alignment:**
   - Propose ideas concisely, validate architectural decisions with the developer, and evolve the project step by step across our Agile Milestones (Sprints).
3. **Separation of Concerns (Developer vs. End-User):**
   - While in development, `AGENTS.md` guides the construction of the repository.
   - The future end-user agent prompt is kept aside in `DOCS-DEV/AGENTS.end-user.draft.md` until the framework is ready to be tested with end-user flows.

---

## 3. Repository, Formatting & Changelog Standards

1. **Language Standard (`en-US` + `DOCS-DEV/` Mirror):**
   - All tracked files in the repository must be written in **English (`en-US`)**.
   - Every documentation/instruction file must have an up-to-date **Portuguese (`pt-BR`)** translated mirror inside the `DOCS-DEV/` folder (verified against `.github/agents/docs-sync.agent.md`).
   - `DOCS-DEV/` must always remain in `.gitignore`.
   - In chat, always communicate with the developer in the language they use (default: `pt-BR`).
2. **Encoding & Line Endings (`.editorconfig` & `.gitattributes`):**
   - Always write files in **UTF-8 (without BOM)** with **`LF` line endings** and **2-space indentation**, respecting [`.editorconfig`](./.editorconfig) and [`.gitattributes`](./.gitattributes).
3. **Continuous Changelog Maintenance (`CHANGELOG.md`):**
   - Whenever adding features, fixing bugs, or updating governance/CI rules, update the `## [Unreleased]` section in [`CHANGELOG.md`](./CHANGELOG.md) (and its mirror `DOCS-DEV/CHANGELOG.md`) following the *Keep a Changelog* format.

---

## 4. Git, Branching, Commits, PRs & DevOps Governance (Strict Rules)

### 4.1 Mandatory Review Gate (Before Commit, Push & PR)
- **NEVER run `git commit`, `git push`, or `gh pr create` automatically.**
- Before committing or pushing, verify compliance with `.github/workflows/pr-governance.yml` and request a **Review** from the developer by presenting:
  1. **Target Branch:** The standardized branch name where changes will be committed/pushed.
  2. **Modified Files:** Quick summary of added/modified/deleted files (`git status`).
  3. **Proposed Commit Message:** The exact semantic commit message in English.
  4. **Target Milestone & Labels (when opening/updating a PR):** Which Agile Milestone and GitHub Labels apply.
- Only execute `git commit` / `git push` / `gh pr` after the developer explicitly approves the review.

### 4.2 Git Identity & Remote
- **Local Identity:** Strictly `OdevMatheus <matheusvita007@gmail.com>`.
- **Remote (`origin`):** `https://github.com/OdevMatheus/FolioOps.git`.

### 4.3 Branching Strategy & Naming Convention
- **Protected Main Branch:** **NEVER push directly to `master` (or `main`)**. Every change must be developed and pushed on a dedicated branch.
- **Branch Naming Pattern (`<type>/<short-kebab-description>` in `en-US`, enforced by `.github/workflows/pr-governance.yml`):**
  - `feat/<slug>` — New features, workflows, or structural modules (e.g., `feat/onboarding-mode`).
  - `fix/<slug>` — Bug fixes or corrections (e.g., `fix/broken-template-links`).
  - `docs/<slug>` — Documentation and AI instruction updates (e.g., `docs/ai-governance-rules`).
  - `chore/<slug>` — Project setup, configs, tooling, or maintenance (e.g., `chore/initial-setup`).
  - `refactor/<slug>` — Restructuring without changing core behavior (e.g., `refactor/prompt-structure`).
  - `test/<slug>` — Adding or updating tests/evaluations (e.g., `test/agent-flow-validation`).

### 4.4 Semantic Commits (Conventional Commits in `en-US`)
- All commit messages must be in **English (`en-US`)**, atomic, and follow the **Conventional Commits** specification:
  ```text
  <type>(<optional-scope>): <short imperative description>

  [optional body explaining the "why" and key changes]
  ```
- **Rules for Good Commits:**
  - Use the imperative mood in the subject line (`add`, `update`, `remove`, not `added` or `adds`).
  - Keep the subject line concise (under 72 characters) and lowercase after the colon.
  - Allowed `<type>` values: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`, `perf`, `ci`.

### 4.5 Pull Request (PR), Issue, Label & Milestone Governance (via GitHub CLI `gh`)
- Always use the **GitHub CLI (`gh`)** to open and manage Pull Requests and Issues so that templates, labels, and milestones are applied accurately.
- **PR Structure:** Must strictly follow [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md) (or [`docs-and-agents.md`](./.github/PULL_REQUEST_TEMPLATE/docs-and-agents.md)) and pass [`.github/workflows/pr-governance.yml`](./.github/workflows/pr-governance.yml).
- **Mandatory Labels on Every PR / Issue (Drives `labeler.yml` & `release-drafter.yml`):**
  - **Scope Labels (matching `.github/labeler.yml`):** `🔴 core-architecture`, `⚠️ agent-behavior`, `📄 docs`, `🔌 plugin`, `⚙️ ci`
  - **Type / Governance Labels (used by `.github/release-drafter.yml`):** `✨ feat`, `🐛 fix`, `♻️ refactor`, `🔒 security`, `🗺️ roadmap`, `🚧 work-in-progress`, `📌 pinned`
- **Mandatory Milestone & Epic Issue Linking (Agile Sprint Tracking — 1 Issue = 1 PR):**
  - Every PR must be linked (`--milestone`) to its corresponding Sprint Milestone and reference its specific Atomic Issue (`Closes #<issue>`) and Sprint Epic (`Part of #<epic>`):
    - **Sprint 0 (`Milestone #1` / `Epic #7` — Completed):** `v0.1.0 — Infra, DevOps & Architecture Foundation (Sprint 0)`
    - **Sprint 1 (`Milestone #5` / `Epic #16` — Issues `#17`–`#20`):** `v0.2.0 — Data Contract, Workspace & Engine Foundation (Sprint 1)`
    - **Sprint 2 (`Milestone #6` / `Epic #21` — Issues `#22`–`#25`):** `v0.3.0 — Smart Inbox Intake & Interactive Visual Brainstorming (Sprint 2)`
    - **Sprint 3 (`Milestone #7` / `Epic #26` — Issues `#27`–`#30`):** `v0.4.0 — Next.js Portfolio Generation Engine & Archetype Blueprints (Sprint 3)`
    - **Sprint 4 (`Milestone #8` / `Epic #31` — Issues `#32`–`#35`):** `v0.5.0 — Multi-Stage Anti-Slop Polish & Technical Quality Gates (Sprint 4)`
    - **Sprint 5 (`Milestone #9` / `Epic #36` — Issues `#37`–`#40`):** `v1.0.0 — End-to-End Auto-Pipeline, Incremental Updates & Zero-Cost Deploy (Sprint 5)`

---

## 5. Current Repository Structure

```text
FolioOps/
├── .github/            # Mandatory governance rules, templates, agents & CI workflows (CHECK FIRST)
├── docs/
│   └── architecture/   # System Architecture Specification & Architecture Decision Records (ADRs)
├── AGENTS.md           # Developer-mode instructions for AI Agents building FolioOps
├── CLAUDE.md           # Entry point for Claude Code (@AGENTS.md)
├── GEMINI.md           # Entry point for Antigravity / Gemini (@AGENTS.md)
├── DATA_CONTRACT.md    # Canonical boundary (PROJECT_ROOT vs DATA_ROOT) & profile/design schemas
├── README.md           # Project overview and current status
├── CONTRIBUTING.md     # Contribution guidelines for humans and AI Agents
├── CODE_OF_CONDUCT.md  # Contributor Covenant Code of Conduct (v2.1)
├── CHANGELOG.md        # Keep a Changelog & SemVer release history
├── LICENSE             # MIT License
├── .gitattributes      # Enforces UTF-8 LF line endings across all OS environments
├── .editorconfig       # Enforces UTF-8, LF, and 2-space indentation across IDEs
├── .gitignore          # Git ignore rules (includes DOCS-DEV/)
└── DOCS-DEV/           # Ignored folder with PT-BR translations and drafts
```
