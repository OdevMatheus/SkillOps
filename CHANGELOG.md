# Changelog

All notable changes to **SkillOps** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.3.0] - 2026-10-29

### Added
- **Stress-Test Benchmark Suite for 80+ Skills & Implicit Routing Collapse (`Sprint 2 / Issue #52`):**
  - Added [`tests/test_auditor_stress.py`](./tests/test_auditor_stress.py) simulating an 84-skill catalog (`3,486` pairwise comparisons) to benchmark sub-second zero-API collision detection, planted `BLOCKING_ERROR` / `HIGH_RISK` identification, and aggregate Level 1 context-window bloat protection (`arXiv:2610.18522`).
  - Wired `uv run skillops audit --catalog catalog --strict --require-layout --format table` directly into [`.github/workflows/ai-ci.yml`](./.github/workflows/ai-ci.yml) and bumped package version to `0.3.0`.
- **CLI `skillops audit` Rich Terminal Tables, JSON, and Markdown Reports (`Sprint 2 / Issue #51`):**
  - Updated `audit_command` in [`src/skillops/cli.py`](./src/skillops/cli.py) to delegate directly to `audit_catalog` from `skillops.auditor`, adding `--max-similarity`, `--max-l1-tokens`, and `--require-layout` flags and removing legacy inline cosine helpers.
  - Added dedicated `_emit_audit_report` formatter in [`src/skillops/cli.py`](./src/skillops/cli.py) rendering Rich 3-Level Progressive Disclosure Budget tables, Pairwise Semantic Collision tables, structured JSON payloads (`skills`, `collisions`, `total_l3_scripts_tokens_saved`), and GitHub-flavored Markdown audit tables.
  - Expanded [`tests/test_cli.py`](./tests/test_cli.py) to verify `table`, `json`, and `markdown` audit outputs, layout validation, bundle token budget enforcement, and exit codes (`0`, `2`, `3`).
- **Zero-API Pairwise Semantic Similarity & Routing Collision Engine (`Sprint 2 / Issue #50`):**
  - Added [`src/skillops/auditor/collision.py`](./src/skillops/auditor/collision.py) implementing deterministic, 100% Zero-API pairwise semantic collision detection (`tokenize_routing_text`, `extract_text_features`, `extract_skill_features`, `compute_idf_weights`, `compute_feature_cosine`, `compute_text_similarity`, `compute_manifest_similarity`, `compute_collision_matrix`, and `audit_catalog`) solving *Implicit Routing Collapse* (`arXiv:2610.18522`).
  - Extended `CollisionPair` in [`src/skillops/models.py`](./src/skillops/models.py) with `shared_terms` and actionable `remediation` advice across `WARNING` (`>= 0.58`), `HIGH_RISK` (`>= 0.72`), and `BLOCKING_ERROR` (`>= 0.85`).
  - Added [`tests/test_collision.py`](./tests/test_collision.py) verifying orthogonality across the reference catalog, clone detection, IDF weighting, and remediation recommendations.
- **SKILL.md Frontmatter Parser & 3-Level Progressive Disclosure Token Budget Analyzer (`Sprint 2 / Issue #49`):**
  - Added [`src/skillops/auditor/parser.py`](./src/skillops/auditor/parser.py) implementing `ParsedSkillDirectory`, `split_skill_md`, `parse_skill_file`, `discover_skill_directories`, and `parse_skill_directory` to inspect `SKILL.md`, `scripts/*.py`, `references/*.md`, `evals/evals.json`, and `evals/benchmark.json` with 100% zero-API execution.
  - Added [`src/skillops/auditor/token_budget.py`](./src/skillops/auditor/token_budget.py) and [`src/skillops/auditor/__init__.py`](./src/skillops/auditor/__init__.py) implementing `CatalogBudgetSummary`, `analyze_skill_budget`, `analyze_catalog_budgets`, `count_fenced_code_lines`, and `detect_description_workflow_leak` across all 3 progressive disclosure tiers (including `total_l3_scripts_tokens_saved`).
  - Extended `SkillBudgetMetrics` in [`src/skillops/models.py`](./src/skillops/models.py) with Level 3 script/reference metrics (`l3_scripts_count`, `l3_scripts_tokens`, `l3_references_count`, `l3_reference_tokens`), `warnings`, and `violations`, and wired `skillops audit` in [`src/skillops/cli.py`](./src/skillops/cli.py) to use `skillops.auditor`.
  - Added [`tests/test_parser_and_budget.py`](./tests/test_parser_and_budget.py) achieving 100% statement and branch coverage across `src/skillops/auditor/`.
- **Strict Pydantic v2 Contracts, `skillops init`, Composite GitHub Action & Reference Skill Catalog (`Sprint 1 / Issue #46`):**
  - Added [`src/skillops/models.py`](./src/skillops/models.py) implementing strict Pydantic v2 models (`SkillManifest`, `ScriptOutput`, `EvalSuite`, `CollisionReport`, `BenchmarkReport`, and `SkillOpsConfig`) enforcing EARS invariants `INV-SKILL-01` through `INV-SKILL-05`.
  - Added `skillops init` command and live catalog validation in `skillops audit` ([`src/skillops/cli.py`](./src/skillops/cli.py)), plus workspace configuration [`.skillops.yml`](./.skillops.yml).
  - Added 4 production-ready **Reference Hybrid Executable Skills** in `catalog/` across all 3 tracks (`SKILL.md`, deterministic Python 3.12+ AST/SQL CLI scripts, `evals/evals.json`, and `evals/benchmark.json`):
    - [`catalog/ai-engineering/mcp-architect/`](./catalog/ai-engineering/mcp-architect/SKILL.md) (`scripts/validate_mcp_server.py`)
    - [`catalog/python-backend/fastapi-production/`](./catalog/python-backend/fastapi-production/SKILL.md) (`scripts/audit_fastapi_routes.py`)
    - [`catalog/python-backend/postgres-query-doctor/`](./catalog/python-backend/postgres-query-doctor/SKILL.md) (`scripts/analyze_sql_safety.py`)
    - [`catalog/arch-quality/ast-blast-radius/`](./catalog/arch-quality/ast-blast-radius/SKILL.md) (`scripts/analyze_call_graph.py`)
  - Added reusable composite GitHub Action [`.github/actions/skillops-audit/action.yml`](./.github/actions/skillops-audit/action.yml), VHS terminal demo script [`docs/assets/demo.tape`](./docs/assets/demo.tape), and [`docs/SKILLOPS_IMPROVEMENT_ROADMAP.md`](./docs/SKILLOPS_IMPROVEMENT_ROADMAP.md).
  - Added [`tests/test_models.py`](./tests/test_models.py) verifying Pydantic v2 schemas, regression guards, and end-to-end execution of all reference skill scripts (`--json`).
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
- **Zero-API Architecture Simplification (`Sprint 1 / Issue #46`):**
  - Removed all external LLM API and HTTP web server dependencies (`openai-agents`, `fastapi`, `uvicorn`, `httpx`, `mcp` HTTP stack, `.env.example`, and `skillops serve`) so **SkillOps** runs 100% locally and offline with only 4 core Python packages (`pydantic`, `typer`, `rich`, `pyyaml`).
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
