# Changelog

All notable changes to **FolioOps** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Data Contract & Canonical Schemas (`DATA_CONTRACT.md` — Sprint 1 / Issue #17):**
  - Defined strict isolation boundaries between `PROJECT_ROOT` (System Layer) and `DATA_ROOT` (User Data Layer) with safe framework upgrade policies (`modes/update.md`).
  - Specified canonical YAML frontmatter + Markdown schemas for `profile/_profile.md` (with `source_ref` provenance tracking, `Schema.org` JSON-LD metadata, and image `width`/`height`/`alt` invariants), `profile/_design.md` (with `impeccable` surface modes, 4 visual archetypes, 6-token hex palette, and anti-slop guardrails), `profile/_custom.md`, and `config/profile.yml`.
  - Documented 6 EARS-format functional invariants (`INV-DATA-01` through `INV-DATA-06`) for automated enforcement across modes and scripts.
- **Agile Sprint Roadmap & Atomic Backlog (`Sprints 1–5`):**
  - Created Milestones `#5` through `#9` (`v0.2.0` to `v1.0.0`), 5 Sprint Epic Issues (`#16`, `#21`, `#26`, `#31`, `#36`), and 20 atomic implementation Issues (`#17`–`#20`, `#22`–`#25`, `#27`–`#30`, `#32`–`#35`, `#37`–`#40`) mapped directly to the approved System Architecture and ADRs.
- **System Architecture & ADRs (`docs/architecture/`):**
  - Added master System Architecture & Design Specification (`docs/architecture/README.md`) with Mermaid component and sequence diagrams.
  - Added `ADR-0001` (`career-ops`-Style Mode Router, Embedded Mandatory Rules, and AI-Executed Scripts).
  - Added `ADR-0002` (Two-Stage User Data Layer: `inbox/` Raw Dropzone to `profile/` Canonical Source of Truth).
  - Added `ADR-0003` (Top-Tier Portfolio Frontend Stack: Next.js Static Export, React 19, Tailwind CSS, ShadCN UI, and Motion).
  - Added `ADR-0004` (Multi-Stage Quality Gates: Visual Anti-Slop Polish via Playwright + Automated SEO, WCAG 2.2, and Core Web Vitals Audits).
- **Community & Open-Source Governance:** Added `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `CHANGELOG.md`.
- **Environment Standardization:** Added `.gitattributes` (enforcing UTF-8 `LF` line endings) and `.editorconfig`.
- **DevOps Automation:**
  - Configured GitHub CLI (`gh`) workflow, 12 standardized UTF-8 repository Labels, and the `v0.1.0 — Infra, DevOps & Architecture Foundation (Sprint 0)` Milestone.
  - Added semantic PR title validation (Conventional Commits) to `.github/workflows/pr-governance.yml`.
  - Added automated release notes drafting via `.github/workflows/release-drafter.yml` and `.github/release-drafter.yml`.

---

## [0.1.0] - 2026-10-28 (Sprint 0 — Foundation & AI Governance)

### Added
- Initial repository root structure (`.gitignore`, `README.md`).
- Canonical Developer-Mode AI instructions (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) with Mandatory `.github/` Pre-Flight Protocol and Pre-Commit/Push Review Gate.
- Complete `.github/` governance ecosystem:
  - `CODEOWNERS`, `FUNDING.yml`, `SECURITY.md`, `dependabot.yml`, `labeler.yml`, and `copilot-instructions.md`.
  - Structured YAML Issue Templates (`bug_report.yml`, `feature_request.yml`, `agent_improvement.yml`, `config.yml`).
  - Pull Request templates (`PULL_REQUEST_TEMPLATE.md` and `PULL_REQUEST_TEMPLATE/docs-and-agents.md`).
  - Specialized AI subagent profiles (`agents/pr-brief.agent.md`, `agents/docs-sync.agent.md`, `agents/address-review.agent.md`) and plugin manifest (`plugin/plugin.json`).
  - GitHub Actions CI workflows (`workflows/pr-governance.yml`, `workflows/labeler.yml`, `workflows/stale.yml`).
