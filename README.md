# SkillOps

> **The Zero-API Python 3.12+ Engine & Benchmark-Verified Library for AI Coding Agent Skills & Subagents**  
> *Stop installing unverified Markdown prompt essays. Audit semantic collisions offline, dynamically route context-aware skill bundles across 5 agent runtimes, and prove positive task lift (`with_skill` vs. `without_skill`) with 100% deterministic, zero-API AST & subprocess TDD evaluations.*

[![CI Governance](https://img.shields.io/badge/governance-1%20Issue%20%3D%201%20PR-blue.svg)](./AGENTS.md)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-3776AB.svg?logo=python&logoColor=white)](https://www.python.org/)
[![Pydantic v2](https://img.shields.io/badge/Pydantic-v2%20strict-E92063.svg)](https://docs.pydantic.dev/)
[![Zero API](https://img.shields.io/badge/Zero%20External%20APIs-100%25%20Offline-2ea44f.svg)](./SKILL_CONTRACT.md)
[![MCP Stdio](https://img.shields.io/badge/MCP-Stdio%20JSON--RPC-009688.svg)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

---

## Why SkillOps Exists (The 2026 Agent Harness Crisis)

As AI-native engineering teams scale their agent customizations across **Claude Code**, **Antigravity / Gemini CLI**, **Cursor**, **OpenAI Codex CLI**, and **GitHub Copilot**, two critical failure modes documented in 2026 empirical AI systems research break production workflows:

1. **Implicit Routing Collapse (*Lost in Implicit Routing*, `arXiv:2610.18522`):**  
   Dumping 50–100+ skills with overlapping natural-language descriptions into an agent's workspace causes **semantic routing recall to collapse from `73.6%` to `27.4%`**, while burning **8,000–15,000+ context tokens** before the developer writes a single prompt.
2. **Skill-Induced Regressions (*Agent Skills Can Be Harmful*, `arXiv:2608.11888`):**  
   Static, prose-heavy `SKILL.md` files without deterministic verification scripts or comparative `with_skill` vs. `without_skill` benchmarks frequently **degrade pass rates** on complex engineering tasks while inflating token overhead by **30%–200%**.

**SkillOps** is a **100% Zero-API, Offline-First Skill Engineering & Harness Operations Platform** built in strict **Python 3.12+** (`pydantic`, `typer`, `rich`, `pyyaml` — zero API keys or HTTP servers required) that solves both problems:
- **Pillar 1 — The `SkillOps` Core Engine (`src/skillops/`):** A pure local CLI and JSON-RPC 2.0 `stdio` MCP Server that lints 3-level progressive disclosure budgets, detects pairwise semantic collisions (`skillops audit`), fingerprints repositories to compile optimal 5–12 skill bundles (`skillops route`), transpiles skills across 5 runtimes (`skillops sync`), and runs deterministic AST & subprocess `with_skill` vs. `without_skill` benchmarks (`skillops eval`).
- **Pillar 2 — The Elite Executable Skill Catalog (`catalog/`):** 13 benchmark-verified **Hybrid Executable Skills** across 3 specialized tracks (`ai-engineering`, `python-backend`, `arch-quality`), where every skill pairs a concise `< 250`-line `SKILL.md` with a zero-hallucination **Python 3.12+ CLI tool (`scripts/*.py`)** and a **TDD evaluation suite (`evals/evals.json` + `evals/benchmark.json`)**.

---

## System Architecture

```mermaid
flowchart LR
    subgraph Catalog["Catalog (13 Hybrid Executable Skills)"]
        S1["SKILL.md (<250 lines)\n+ Progressive Disclosure"]
        S2["scripts/*.py\n(Deterministic Python 3.12+ CLI)"]
        S3["evals/evals.json +\nbenchmark.json"]
    end

    subgraph Engine["Zero-API SkillOps Core Engine (Python 3.12+ / Pydantic v2)"]
        Init["skillops init\n(Workspace Scaffolder)"]
        Audit["skillops audit\n(Zero-API Collision & Token Budget)"]
        Route["skillops route\n(Repo Stack Fingerprinter)"]
        Sync["skillops sync\n(Multi-Runtime Transpiler)"]
        Eval["skillops eval\n(Deterministic AST TDD Runner)"]
        Mcp["skillops mcp\n(Local JSON-RPC 2.0 Stdio MCP)"]
    end

    subgraph Targets["5 Supported Agent Runtimes"]
        T1["Claude Code (.claude/skills/)"]
        T2["Antigravity / Gemini (.agent/skills/)"]
        T3["Cursor (.cursor/rules/*.mdc)"]
        T4["OpenAI Codex (.codex/skills/)"]
        T5["GitHub Copilot (.github/instructions/)"]
    end

    Catalog --> Audit & Route & Eval
    Route --> Sync
    Sync --> T1 & T2 & T3 & T4 & T5
    Audit & Eval --> Mcp
```

---

## Core CLI Capabilities (`skillops`)

| Command | Purpose | Key Invariants Enforced |
| :--- | :--- | :--- |
| **`skillops init`** | Scaffolds `.skillops.yml` and `catalog/` tracks (`ai-engineering`, `python-backend`, `arch-quality`). | Validates workspace config via `SkillOpsConfig`. |
| **`skillops audit`** | Audits any skill catalog for pairwise semantic description overlap and 3-level token budget compliance with zero external APIs. | Level 1 `40–110 words` (`<= 160 tokens`), Level 2 `<= 250 lines`, cosine similarity `< 0.72` (high-risk) / `< 0.85` (error). |
| **`skillops route`** | Fingerprints a target repository (`pyproject.toml`, `package.json`, `Dockerfile`, AST/files) and selects an optimal collision-free bundle. | Emits `<= 12` highest-scoring skills guaranteed free of semantic collisions. |
| **`skillops sync`** | Transpiles and installs a routed skill bundle across **Claude Code, Antigravity, Cursor, Codex CLI, and GitHub Copilot**. | Writes deterministic runtime artifacts and supports `--dry-run`. |
| **`skillops eval`** | Runs 100% offline deterministic `with_skill` vs. `without_skill` AST & subprocess TDD evaluation scenarios. | Requires $\Delta\text{PassRate} \ge +15\%$ and zero critical regressions (`INV-SKILL-05`). |
| **`skillops mcp`** | Starts a local **Model Context Protocol (MCP)** server over `stdio` exposing `SkillOps` audit, routing, and script execution tools to AI agents. | Compatible with Claude Code, Antigravity, Cursor, and Codex MCP clients. |

---

## The Elite Catalog: Hybrid Executable Skills (`catalog/`)

Every skill in `catalog/` adheres to **[`SKILL_CONTRACT.md`](./SKILL_CONTRACT.md)** and ships with an executable Python 3.12+ diagnostic CLI (`scripts/*.py`) and a TDD benchmark suite (`evals/`):

### Track 1 — AI & Agentic Systems Engineering (`catalog/ai-engineering/`)
| Skill ID | Executable Micro-Tool (`scripts/`) | Core Engineering Capability |
| :--- | :--- | :--- |
| `mcp-architect` | `validate_mcp_server.py` | Designs and validates Model Context Protocol (MCP) servers, JSON-RPC `stdio` hygiene, and typed tool schemas via AST. |
| `agent-harness-auditor` | `harness_linter.py` | Audits multi-agent harnesses, subagent boundaries, tool definitions, and context budgets against 2026 routing research. |
| `graphrag-hybrid-search` | `retrieval_evaluator.py` | Implements hybrid retrieval (`pgvector` HNSW + BM25 + Reciprocal Rank Fusion) and computes MRR/Recall@K offline. |
| `llm-eval-tdd` | `eval_matrix_runner.py` | Builds deterministic evaluation harnesses with Pydantic v2 contracts and statistical variance analysis. |
| `prompt-red-teaming` | `injection_scanner.py` | Audits system prompts and agent tool pipelines against indirect prompt injection and OWASP LLM Top 10 vectors. |

### Track 2 — High-Performance Python 3.12+ Backend (`catalog/python-backend/`)
| Skill ID | Executable Micro-Tool (`scripts/`) | Core Engineering Capability |
| :--- | :--- | :--- |
| `python-312-strict` | `typing_audit.py` | Enforces PEP 695 type parameter syntax, `mypy --strict`, `Pydantic v2` `ConfigDict(strict=True)`, and zero-any boundary contracts. |
| `fastapi-production` | `audit_fastapi_routes.py` | Audits FastAPI lifespan state, async dependency injection, and missing `response_model` contracts via Python AST. |
| `postgres-query-doctor` | `analyze_sql_safety.py` | Detects SQL f-string injection hazards and N+1 ORM query loops inside `for`/`async for` blocks via Python AST. |
| `async-concurrency-guard` | `event_loop_blocking_scanner.py` | Scans Python `async def` call graphs via AST to catch blocking synchronous I/O and missing `asyncio.TaskGroup` bounds. |

### Track 3 — Architecture, Security & Code Quality (`catalog/arch-quality/`)
| Skill ID | Executable Micro-Tool (`scripts/`) | Core Engineering Capability |
| :--- | :--- | :--- |
| `ast-blast-radius` | `analyze_call_graph.py` | Builds a repository import/call dependency graph via AST to quantify the blast radius of modified symbols before refactoring. |
| `bug-reproducer-tdd` | `repro_harness_check.py` | Enforces hypothesis-driven root-cause isolation and verifies a failing minimal reproduction test (`Red`) before allowing fixes (`Green`). |
| `security-sast-gate` | `owasp_ast_scanner.py` | Scans code diffs for SQL injection, SSRF, command injection, hardcoded secrets, and missing auth guards with CWE mappings. |
| `adr-enforcer` | `architecture_boundary_check.py` | Validates MADR 4.0 Architecture Decision Records and checks codebase import boundaries against declared architectural rules. |

---

## Documentation & Architecture Index

- **[`SKILL_CONTRACT.md`](./SKILL_CONTRACT.md):** Normative specification for hybrid skills, 3-level token budgets, `evals.json` & `benchmark.json` schemas, and CLI exit codes.
- **[`docs/architecture/README.md`](./docs/architecture/README.md):** High-level system architecture and component overview.
  - **[`ADR-0001`](./docs/architecture/adr/0001-hybrid-executable-skills-architecture.md):** Hybrid Executable Skills Architecture (`SKILL.md` + `scripts/*.py` + `evals/`).
  - **[`ADR-0002`](./docs/architecture/adr/0002-semantic-collision-auditor-and-token-budgeting.md):** Semantic Collision Auditor & 3-Level Progressive Disclosure Token Budgeting.
  - **[`ADR-0003`](./docs/architecture/adr/0003-context-aware-dynamic-router-and-multi-runtime-sync.md):** Context-Aware Dynamic Router & Multi-Runtime Sync (`skillops route` & `skillops sync`).
  - **[`ADR-0004`](./docs/architecture/adr/0004-tdd-skill-evaluation-engine-openai-agents-sdk.md):** Zero-API Deterministic TDD Skill Evaluation Engine & Stdio MCP (`skillops eval`, `skillops mcp`).
- **[`AGENTS.md`](./AGENTS.md):** Agentic Engineering Governance Contract (`1 Issue = 1 PR`, Sprints & Milestones).
- **[`CONTRIBUTING.md`](./CONTRIBUTING.md):** Contribution workflow, Conventional Commits, and quality gates.

---

## License

Released under the [MIT License](./LICENSE). Maintained by [@OdevMatheus](https://github.com/OdevMatheus).
