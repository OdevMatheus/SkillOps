# Changelog

All notable changes to **SkillOps** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Strategic Pivot & Rebranding to `SkillOps` (`Sprint 1 / Issue #44`):**
  - Rebranded repository and architecture to **SkillOps — The Python 3.12+ Engine & Benchmark-Verified Library for AI Coding Agent Skills & Subagents** (`https://github.com/OdevMatheus/SkillOps`).
  - Added normative [`SKILL_CONTRACT.md`](./SKILL_CONTRACT.md) defining Hybrid Executable Skills (`SKILL.md` + `scripts/*.py` + `evals/`), 3-level progressive disclosure token budgets (`Level 1 <= 90 tokens/skill`, `Level 2 <= 250 lines`), semantic collision thresholds (`cosine >= 0.78` warning, `>= 0.85` error), `evals.json` and `benchmark.json` schemas, and CLI exit codes (`skillops audit`, `route`, `sync`, `eval`, `serve`, `mcp`).
  - Added Architecture Decision Records (`docs/architecture/adr/`):
    - `ADR-0001`: Hybrid Executable Skills Architecture (`SKILL.md` + Deterministic Python 3.12+ CLI Tools + TDD Evals).
    - `ADR-0002`: Semantic Collision Auditor and 3-Level Progressive Disclosure Token Budgeting (`skillops audit`).
    - `ADR-0003`: Context-Aware Dynamic Router and Multi-Runtime Sync (`skillops route` & `skillops sync`).
    - `ADR-0004`: TDD Skill Evaluation Engine via OpenAI Agents SDK (`skillops eval`, `skillops serve`, `skillops mcp`).
  - Updated Milestones `#10` through `#14` (`v0.2.0` to `v1.0.0`), 5 Sprint Epic Issues (`#43`, `#48`, `#53`, `#58`, `#63`), and 20 atomic implementation Issues (`#44`–`#47`, `#49`–`#52`, `#54`–`#57`, `#59`–`#62`, `#64`–`#67`) for the `SkillOps` Python 3.12+ roadmap.
- **Community & Open-Source Governance:** Added `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `CHANGELOG.md`.
- **Environment Standardization:** Added `.gitattributes` (enforcing UTF-8 `LF` line endings) and `.editorconfig`.
- **DevOps Automation:**
  - Configured GitHub CLI (`gh`) workflow, 12 standardized UTF-8 repository Labels, and Sprint Milestones.
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
