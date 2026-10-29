# SkillOps — Improvement Roadmap & Action Plan

> **Goal:** Elevate **SkillOps** from an initial core engine (`v0.2.0`) to a top-tier (`10/10`) Open-Source DevTool & AI Agent Infrastructure platform.  
> **Target Standards:** Python 3.12+, Zero-Config Offline Auditing, Fast Multi-Runtime Transpilation, TDD Skill Evaluation, and GitHub Action Automation.

---

## Executive Summary

The transition to **SkillOps** addresses a major bottleneck in 2026 AI Software Engineering: **Context Exhaustion, Semantic Routing Collisions (`arXiv:2610.18522`), and Skill-Induced Performance Regressions (`arXiv:2608.11888`)** across coding agent environments (**Claude Code**, **Antigravity / Gemini CLI**, **Cursor**, **OpenAI Codex CLI**, **GitHub Copilot**).

To maximize adoption and technical impact, SkillOps focuses on four strategic execution pillars:

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                   SKILLOPS STRATEGIC EXECUTION PILLARS                 │
 ├──────────────────┬──────────────────────┬──────────────────────────────┤
 │ 1. Core Engine   │ 2. Dev Experience    │ 3. CI/CD & Automation        │
 │    Concrete Impl │    Zero-API Auditing │    GitHub Action Integration  │
 ├──────────────────┴──────────────────────┴──────────────────────────────┤
 │ 4. Showcase & Adoption (Terminal VHS GIF, PyPI Package, UVX Support)   │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Core Engine Implementation Roadmap (`src/skillops/`)

While CLI entrypoints ([`src/skillops/cli.py`](../src/skillops/cli.py)), strict Pydantic v2 contracts ([`src/skillops/models.py`](../src/skillops/models.py)), and normative specifications ([`SKILL_CONTRACT.md`](../SKILL_CONTRACT.md)) are established in Sprint 1 (`v0.2.0`), the specialized domain engines progress across Sprints 2–4:

### 1.1 `skillops.auditor` (Token Budgeting & Collision Detection)
- [x] **Pydantic v2 Manifest & Token Budget Contract (`src/skillops/models.py`):** Enforces:
  - **Level 1 (YAML `description`):** `40–110 words` (`<= 160 tokens`), starting with `"Use when..."`.
  - **Level 2 (`SKILL.md` Body):** `<= 250 lines` (`<= 1,800 tokens`).
- [x] **Zero-API Lexical Cosine Baseline (`src/skillops/cli.py`):** Instant offline pairwise similarity auditing across `catalog/**/SKILL.md`.
- [ ] **Optional `tiktoken` + ONNX / `fastembed` Engine (`Sprint 2 / Issue #49–#50`):** Integrate `all-MiniLM-L6-v2` local embeddings alongside the zero-dependency lexical/n-gram engine.
- [x] **Threshold Enforcement (`CollisionPair.from_similarity`):**
  - `cosine >= 0.58` $\rightarrow$ `WARNING`
  - `cosine >= 0.72` $\rightarrow$ `HIGH_RISK` (Error in `--strict` mode)
  - `cosine >= 0.85` $\rightarrow$ `BLOCKING_ERROR`

### 1.2 `skillops.sync` (Multi-Runtime Transpilation — `Sprint 2 / Issue #51–#52`)
- [ ] **Target Transpilers:** Implement deterministic codegen for native harness targets:
  - **Claude Code:** Transpile to `.claude/skills/<skill-name>/`
  - **Antigravity / Gemini CLI:** Transpile to `.agent/skills/<skill-name>/`
  - **Cursor:** Transpile to `.cursor/rules/<skill-name>.mdc`
  - **Codex CLI / GitHub Copilot:** Transpile to `.agents/skills/<skill-name>/` & `.github/instructions/<skill-name>.instructions.md`
- [ ] **Atomic Synchronization:** Ensure clean file writes and dry-run diff capabilities (`skillops sync --dry-run`).

### 1.3 `skillops.eval` (TDD Benchmark Runner — `Sprint 3 / Issue #54–#55`)
- [x] **Pydantic v2 `EvalSuite` & `BenchmarkReport` Contracts (`src/skillops/models.py`):** Enforces `INV-SKILL-05` (`REJECTED_REGRESSION` if `with_skill` pass rate $\le$ `without_skill` or token consumption increases by $> 25\%$ without accuracy gains).
- [ ] **Isolated Execution Runner:** Implement `with_skill` vs `without_skill` execution loop using the `openai-agents` SDK (`Runner.run`) and deterministic offline fixtures.

---

## 2. Developer Experience (DX) & Onboarding

- [x] **`skillops init` Command (`src/skillops/cli.py`):** Scaffolds `catalog/` tracks (`ai-engineering`, `python-backend`, `arch-quality`) and `.skillops.yml` configuration in a single command.
- [x] **Rich Terminal Visuals (`src/skillops/cli.py`):** Rich panels and tables with `--format table|json|markdown`.
- [x] **`uvx` & Editable Package Support (`pyproject.toml`):**
  ```bash
  # Instant execution via uvx or pip
  uvx skillops audit --catalog catalog --strict
  # or
  pip install -e ".[dev]"
  ```

---

## 3. CI/CD & Automation (`skillops-action`)

- [x] **Composite GitHub Action ([`.github/actions/skillops-audit/action.yml`](../.github/actions/skillops-audit/action.yml)):** Reusable composite action for running `skillops audit` in Pull Requests.
- [x] **PR Enforcement ([`.github/workflows/ai-ci.yml`](../.github/workflows/ai-ci.yml)):** Automated CI checks enforcing `SKILL.md <= 250 lines` (`INV-SKILL-01`), subagent frontmatter, `ruff`, `mypy --strict`, and `pytest --cov=skillops`.

---

## 4. Showcase, Documentation & Reference Skill Catalog

- [x] **Terminal Demo Tape ([`docs/assets/demo.tape`](./assets/demo.tape)):** Reproducible `vhs` script recording `skillops audit` and `skillops sync` for the `README.md` showcase.
- [x] **Initial Reference Skill Catalog (`catalog/`):** 4 production-ready **Hybrid Executable Skills** across all 3 tracks, each complete with `SKILL.md`, deterministic Python 3.12+ AST/SQL CLI helper (`scripts/*.py`), `evals/evals.json`, and `evals/benchmark.json`:
  1. [`catalog/ai-engineering/mcp-architect/`](../catalog/ai-engineering/mcp-architect/SKILL.md) (`scripts/validate_mcp_server.py`)
  2. [`catalog/python-backend/fastapi-production/`](../catalog/python-backend/fastapi-production/SKILL.md) (`scripts/audit_fastapi_routes.py`)
  3. [`catalog/python-backend/postgres-query-doctor/`](../catalog/python-backend/postgres-query-doctor/SKILL.md) (`scripts/analyze_sql_safety.py`)
  4. [`catalog/arch-quality/ast-blast-radius/`](../catalog/arch-quality/ast-blast-radius/SKILL.md) (`scripts/analyze_call_graph.py`)

---

## Priority Matrix

| Priority | Action Item | Target Module | Effort | Status | Strategic Impact |
| :---: | :--- | :--- | :---: | :---: | :--- |
| 🔥 **High** | Strict Pydantic v2 Schemas & Lexical Auditor | `skillops.models` / `cli` | Medium | ✅ **Done (`#46`)** | **Extreme (Contract Safety)** |
| 🔥 **High** | Reference Hybrid Executable Skills (4 Skills) | `catalog/` | Medium | ✅ **Done (`#46`)** | **Extreme (Real Utility)** |
| 🔥 **High** | `skillops init` + `.skillops.yml` + Composite Action | `skillops.cli` / `.github` | Low | ✅ **Done (`#46`)** | **High (Zero-Config DX)** |
| 🔥 **High** | Offline Embedding Engine (`fastembed` / ONNX) | `skillops.auditor` | Medium | ⏳ **Sprint 2 (`#50`)** | **Extreme (Zero-Config)** |
| 🔥 **High** | Multi-Runtime Transpiler Engine | `skillops.sync` | Medium | ⏳ **Sprint 2 (`#52`)** | **Extreme (Practical Utility)** |
| ⚡ **Medium** | TDD Eval Runner (`openai-agents` SDK) | `skillops.eval` | Medium | ⏳ **Sprint 3 (`#55`)** | **High (Empirical Proof)** |
