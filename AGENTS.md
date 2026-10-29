# SkillOps — AI Agent Instructions (Developer Mode)

> **Current Phase:** Core Development (Building the SkillOps Engine & Hybrid Skill Catalog)  
> **Target Audience of this File:** AI Agents (Claude Code, Antigravity, Cursor, Codex, Copilot, etc.) pair-programming with the **Developer/Creator** (`@OdevMatheus`) to build the **SkillOps** platform.

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
5. **System Architecture, ADRs & Skill Contract (`docs/architecture/` & `SKILL_CONTRACT.md`):**
   - [`docs/architecture/README.md`](./docs/architecture/README.md): Master System Architecture (`SkillOps` Python 3.12+ Core Engine + 13 Hybrid Executable Skills Catalog).
   - [`docs/architecture/adr/`](./docs/architecture/adr/): Architecture Decision Records (`ADR-0001` through `ADR-0004`).
   - [`SKILL_CONTRACT.md`](./SKILL_CONTRACT.md): Normative specification for hybrid executable skills (`SKILL.md` + `scripts/*.py` + `evals/`), 3-level progressive disclosure token budgets, semantic collision thresholds, and CLI contracts (`skillops audit`, `route`, `sync`, `eval`, `serve`, `mcp`).

---

## 1. What is SkillOps? (Product & Engineering Vision)

**SkillOps** is the **Python 3.12+ Engine & Benchmark-Verified Library for AI Coding Agent Skills & Subagents**. It operationalizes 2026 empirical AI agent systems research (*Lost in Implicit Routing*, `arXiv:2610.18522`; *Agent Skills Can Be Harmful*, `arXiv:2608.11888`) across two integrated pillars:

1. **The `SkillOps` Core Engine (`src/skillops/`):**
   - Built with **Python 3.12+**, **Pydantic v2 (`strict=True`)**, **Typer/Rich**, **OpenAI Agents SDK**, **FastAPI**, **FastMCP**, and **Pytest**.
   - Provides `skillops audit` (semantic collision & 3-level token budget auditor), `skillops route` (repository stack fingerprinter), `skillops sync` (multi-runtime transpiler for Claude Code, Antigravity/Gemini CLI, Cursor, Codex CLI, and GitHub Copilot), `skillops eval` (`with_skill` vs. `without_skill` TDD runner), `skillops serve` (FastAPI benchmark viewer), and `skillops mcp` (native MCP server).
2. **The Elite Executable Skill Catalog (`catalog/`):**
   - 13 benchmark-verified **Hybrid Executable Skills** across 3 specialized tracks (`ai-engineering`, `python-backend`, `arch-quality`), where every skill pairs a concise `< 250`-line `SKILL.md` with a deterministic Python 3.12+ CLI tool (`scripts/*.py`) and a TDD evaluation suite (`evals/evals.json` + `evals/benchmark.json`).

---

## 2. Development Methodology (Agile, TDD & Incremental)

1. **Strict Type & Contract Discipline:**
   - All Python code under `src/skillops/` and `catalog/**/scripts/` must target **Python 3.12+**, pass `ruff check`, `ruff format --check`, `mypy --strict`, and `pytest` with high test coverage.
2. **No Rushing / Zero Over-Engineering:**
   - Build only what is scoped for the active Atomic Issue (`1 Issue = 1 PR`).
3. **TDD for Code and Skills:**
   - Write failing tests (`Red`) before implementation (`Green`), and refactor while keeping contracts strict.

---

## 3. Repository, Formatting & Changelog Standards

1. **Language Standard (`en-US` + `DOCS-DEV/` Mirror):**
   - All tracked files in the repository must be written in **English (`en-US`)**.
   - Every documentation/instruction file must have an up-to-date **Portuguese (`pt-BR`)** translated mirror inside the `DOCS-DEV/` folder (verified against `.github/agents/docs-sync.agent.md`).
   - `DOCS-DEV/` must always remain in `.gitignore`.
   - In chat, always communicate with the developer in the language they use (default: `pt-BR`).
2. **Encoding & Line Endings (`.editorconfig` & `.gitattributes`):**
   - Always write files in **UTF-8 (without BOM)** with **`LF` line endings**, respecting [`.editorconfig`](./.editorconfig) and [`.gitattributes`](./.gitattributes).
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
  4. **Target Milestone & Labels (when opening/updating a PR):** Which Agile Milestone, Epic Issue, Atomic Issue, and GitHub Labels apply.
- Only execute `git commit` / `git push` / `gh pr` after the developer explicitly approves the review.

### 4.2 Git Identity & Remote
- **Local Identity:** Strictly `OdevMatheus <matheusvita007@gmail.com>`.
- **Remote (`origin`):** `https://github.com/OdevMatheus/SkillOps.git`.

### 4.3 Branching Strategy & Naming Convention
- **Protected Main Branch:** **NEVER push directly to `master` (or `main`)**. Every change must be developed and pushed on a dedicated branch.
- **Branch Naming Pattern (`<type>/<short-kebab-description>` in `en-US`, enforced by `.github/workflows/pr-governance.yml`):**
  - `feat/<slug>` — New features, CLI commands, models, or catalog skills (e.g., `feat/pydantic-core-models`).
  - `fix/<slug>` — Bug fixes or corrections (e.g., `fix/collision-cosine-threshold`).
  - `docs/<slug>` — Documentation and AI instruction updates (e.g., `docs/skillops-architecture-contract`).
  - `chore/<slug>` — Project setup, configs, tooling, or maintenance (e.g., `chore/python-ci-workflow`).
  - `refactor/<slug>` — Restructuring without changing core behavior (e.g., `refactor/transpiler-adapters`).
  - `test/<slug>` — Adding or updating tests/evaluations (e.g., `test/auditor-unit-suite`).

### 4.4 Semantic Commits (Conventional Commits in `en-US`)
- All commit messages must be in **English (`en-US`)**, atomic, and follow the **Conventional Commits** specification:
  ```text
  <type>(<optional-scope>): <short imperative description>

  [optional body explaining the "why" and key changes]
  ```
- Allowed `<type>` values: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`, `perf`, `ci`.

### 4.5 Pull Request (PR), Issue, Label & Milestone Governance (via GitHub CLI `gh`)
- Always use the **GitHub CLI (`gh`)** to open and manage Pull Requests and Issues so that templates, labels, and milestones are applied accurately.
- **PR Structure:** Must strictly follow [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md) (or [`docs-and-agents.md`](./.github/PULL_REQUEST_TEMPLATE/docs-and-agents.md)) and pass [`.github/workflows/pr-governance.yml`](./.github/workflows/pr-governance.yml).
- **Mandatory Labels on Every PR / Issue (Drives `labeler.yml` & `release-drafter.yml`):**
  - **Scope Labels (matching `.github/labeler.yml`):** `🔴 core-architecture`, `⚠️ agent-behavior`, `📄 docs`, `🔌 plugin`, `⚙️ ci`
  - **Type / Governance Labels (used by `.github/release-drafter.yml`):** `✨ feat`, `🐛 fix`, `♻️ refactor`, `🔒 security`, `🗺️ roadmap`, `🚧 work-in-progress`, `📌 pinned`
- **Mandatory Milestone & Epic Issue Linking (Agile Sprint Tracking — 1 Issue = 1 PR):**
  - Every PR must be linked (`--milestone`) to its corresponding Sprint Milestone and reference its specific Atomic Issue (`Closes #<issue>`) and Sprint Epic (`Part of #<epic>`):
        - **Sprint 1 (`Milestone #10` / `Epic #43` — Issues `#44`–`#47`):** `v0.2.0 — Rebranding, Architecture ADRs & Python 3.12+ Core Foundation (Sprint 1)`
    - **Sprint 2 (`Milestone #11` / `Epic #48` — Issues `#49`–`#52`):** `v0.3.0 — Semantic Collision Auditor & Harness Linter (Sprint 2)`
    - **Sprint 3 (`Milestone #12` / `Epic #53` — Issues `#54`–`#57`):** `v0.4.0 — Context-Aware Repo Router & Multi-Runtime Sync (Sprint 3)`
    - **Sprint 4 (`Milestone #13` / `Epic #58` — Issues `#59`–`#62`):** `v0.5.0 — TDD Eval Engine (OpenAI Agents SDK), FastAPI Viewer & MCP Server (Sprint 4)`
    - **Sprint 5 (`Milestone #14` / `Epic #63` — Issues `#64`–`#67`):** `v1.0.0 — Elite Executable Skill Catalog (3 Tracks / 13 Hybrid Skills) & Release (Sprint 5)`

---

## 5. Current Repository Structure

```text
SkillOps/
├── .github/            # Mandatory governance rules, templates, agents & CI workflows (CHECK FIRST)
├── docs/
│   └── architecture/   # System Architecture Specification & Architecture Decision Records (ADRs 0001-0004)
├── src/
│   └── skillops/       # Python 3.12+ Core Engine (CLI, Pydantic v2 models, Auditor, Router, Sync, Eval, FastAPI, FastMCP)
├── catalog/            # 13 Benchmark-Verified Hybrid Executable Skills (ai-engineering, python-backend, arch-quality)
├── tests/              # Pytest unit, contract, and integration test suite
├── AGENTS.md           # Developer-mode instructions for AI Agents building SkillOps
├── CLAUDE.md           # Entry point for Claude Code (@AGENTS.md)
├── GEMINI.md           # Entry point for Antigravity / Gemini (@AGENTS.md)
├── SKILL_CONTRACT.md   # Normative specification for hybrid skills, token budgets, collision audits, and evals
├── README.md           # Project overview, architecture, CLI reference, and 13-skill catalog
├── CONTRIBUTING.md     # Contribution guidelines for humans and AI Agents
├── CODE_OF_CONDUCT.md  # Contributor Covenant Code of Conduct (v2.1)
├── CHANGELOG.md        # Keep a Changelog & SemVer release history
├── LICENSE             # MIT License
├── .gitattributes      # Enforces UTF-8 LF line endings across all OS environments
├── .editorconfig       # Enforces UTF-8, LF, and indentation across IDEs
├── .gitignore          # Git ignore rules (includes DOCS-DEV/, .venv/, __pycache__/, etc.)
└── DOCS-DEV/           # Ignored folder with PT-BR translations and local reference notes
```
