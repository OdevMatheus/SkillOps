# Changelog

All notable changes to **SkillOps** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Python 3.12+ Core Package & Typer/Rich CLI Entrypoint (`Sprint 1 / Issue #45`):**
  - Added [`pyproject.toml`](./pyproject.toml) configuring `skillops` (`0.2.0`, `requires-python = ">=3.12"`), `hatchling` build system, CLI script `skillops = "skillops.cli:app"`, optional extras (`audit`, `agents`, `serve`, `dev`), and strict `ruff`, `mypy --strict`, and `pytest` tool configurations.
  - Added [`src/skillops/__init__.py`](./src/skillops/__init__.py), [`src/skillops/__main__.py`](./src/skillops/__main__.py), [`src/skillops/py.typed`](./src/skillops/py.typed), and [`src/skillops/cli.py`](./src/skillops/cli.py) implementing deterministic CLI exit codes (`ExitCode`: `0`–`5`), `--version` flag, and subcommands (`audit`, `route`, `sync`, `eval`, `serve`, `mcp`) per [`SKILL_CONTRACT.md`](./SKILL_CONTRACT.md) §7.
  - Added [`tests/test_cli.py`](./tests/test_cli.py) verifying all 6 CLI subcommands, exit codes, `--json` output, and localhost-only guard (`127.0.0.1` / `localhost`).
  - Enabled `pip` ecosystem updates in [`.github/dependabot.yml`](./.github/dependabot.yml).
- **AI-First DevOps, CI/CD & Multi-Framework Infrastructure (`Sprint 1 / Issue #47`):**
  - Added [`.github/workflows/ai-ci.yml`](./.github/workflows/ai-ci.yml) implementing subagent frontmatter validation, `SKILL.md` progressive disclosure line-budget enforcement (`<= 250 lines` per `INV-SKILL-01`), and a Python 3.12 & 3.13 QA matrix (`uv`, `ruff`, `mypy --strict`, `pytest`).
  - Added [`.github/agents/skill-auditor.agent.md`](./.github/agents/skill-auditor.agent.md) specialized in auditing Hybrid Executable Skills (`SKILL.md`, `scripts/*.py`, `evals/evals.json`) and multi-framework compatibility (**OpenAI Agents SDK**, **FastMCP**, **Claude Code**, **Antigravity/Gemini CLI**, **Cursor**, **OpenAI Codex CLI**, **GitHub Copilot**).
  - Added [`.env.example`](./.env.example) standardizing environment variables for OpenAI Agents SDK live evaluations, semantic collision thresholds, token budgets, and localhost-bound FastMCP/FastAPI servers.
  - Enhanced [`.github/workflows/pr-governance.yml`](./.github/workflows/pr-governance.yml) with automated detection of leaked AI provider API keys (`sk-proj-...`, `sk-ant-...`, `AIzaSy...`, `hf_...`).
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
- **Environment Standardization:** Added `.gitattributes` (enforcing UTF-8 `LF` line endings).
- **DevOps Automation:**
  - Configured GitHub CLI (`gh`) workflow, 16 standardized UTF-8 repository Labels, and Sprint Milestones.
  - Added semantic PR title validation (Conventional Commits) to `.github/workflows/pr-governance.yml`.
  - Added automated release notes drafting via `.github/workflows/release-drafter.yml` and `.github/release-drafter.yml`.

### Removed
- **Architectural Bloat Cleanup (`Sprint 1 / Issue #47`):**
  - Removed unnecessary `.editorconfig`, `.github/FUNDING.yml`, `.github/PULL_REQUEST_TEMPLATE/docs-and-agents.md`, and `.github/plugin/plugin.json`, as well as legacy web/Node.js rules from `.gitattributes` and `.gitignore`.

---

## [0.1.0] - 2026-10-28 (Sprint 0 — Foundation & AI Governance)

### Added
- Initial repository root structure (`.gitignore`, `README.md`).
- Canonical Developer-Mode AI instructions (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) with Mandatory `.github/` Pre-Flight Protocol and Pre-Commit/Push Review Gate.
- Complete `.github/` governance ecosystem:
  - `CODEOWNERS`, `SECURITY.md`, `dependabot.yml`, `labeler.yml`, and `copilot-instructions.md`.
  - Structured YAML Issue Templates (`bug_report.yml`, `feature_request.yml`, `agent_improvement.yml`, `config.yml`).
  - Pull Request template (`PULL_REQUEST_TEMPLATE.md`).
  - Specialized AI subagent profiles (`agents/pr-brief.agent.md`, `agents/docs-sync.agent.md`, `agents/address-review.agent.md`).
  - GitHub Actions CI workflows (`workflows/pr-governance.yml`, `workflows/labeler.yml`, `workflows/stale.yml`).
