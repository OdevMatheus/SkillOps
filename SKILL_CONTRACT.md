# SkillOps Canonical Contract (`SKILL_CONTRACT.md`)

> **Status:** Canonical Specification (v0.2.0 — Sprint 1)  
> **Related ADRs:** [`ADR-0001`](./docs/architecture/adr/0001-hybrid-executable-skills-architecture.md), [`ADR-0002`](./docs/architecture/adr/0002-semantic-collision-auditor-and-token-budgeting.md), [`ADR-0003`](./docs/architecture/adr/0003-context-aware-dynamic-router-and-multi-runtime-sync.md), [`ADR-0004`](./docs/architecture/adr/0004-tdd-skill-evaluation-engine-openai-agents-sdk.md)  
> **Scope:** Defines the structural, semantic, token-budget, deterministic execution, and evaluation schemas for **Hybrid Executable Skills & Subagents** managed by the **SkillOps** Python 3.12+ engine.

---

## 1. Scientific Motivation & Core Principles

Modern AI coding harnesses (Claude Code, Antigravity/Gemini CLI, Cursor, OpenAI Codex CLI, GitHub Copilot) rely on `SKILL.md` modules to specialize agent behavior. However, recent empirical research revealed two critical failure modes in community skill libraries:

1. **Implicit Routing Collapse (*Lost in Implicit Routing*, `arXiv:2610.18522`):**
   - When an agent workspace loads decenas of overlapping or poorly differentiated skill descriptions, implicit skill selection recall drops from **73.6% down to 27.4%**, and in **51.6% of tasks** the agent loads **zero skills**.
   - **SkillOps Contract Rule:** Every skill description must obey strict trigger boundaries and pass pairwise semantic cosine-similarity auditing (`cosine_similarity < 0.72` across any active bundle).
2. **Skill-Induced Regressions & Token Bloat (*Agent Skills Can Be Harmful*, `arXiv:2608.11888`):**
   - Skills consisting solely of verbose prose instructions frequently induce functional regressions or inflate token consumption by **4× to 15×** when they force the LLM to perform deterministic checks manually.
   - **SkillOps Contract Rule:** Every catalog skill in `catalog/` must be a **Hybrid Executable Skill**—pairing a concise `SKILL.md` (<250 lines) with deterministic Python 3.12+ CLI tools (`scripts/*.py`) and a verifiable TDD evaluation suite (`evals/evals.json`).

---

## 2. Three-Level Progressive Disclosure & Token Budget Contract

To protect context windows across single-agent and multi-agent runs, every skill governed by **SkillOps** enforces a strict three-level progressive disclosure hierarchy:

| Disclosure Level | Artifact | When Loaded into LLM Context | Maximum Token / Size Budget | Enforcement Tool |
| :--- | :--- | :--- | :--- | :--- |
| **Level 1: Routing Metadata** | YAML frontmatter (`name`, `description`, `metadata`) | **Always loaded** at session start (for active bundle skills) | `40–110 words` (`<= 160 tokens`) | `skillops audit` (`TokenBudgetReport`) |
| **Level 2: Core Workflow (`SKILL.md` Body)** | Markdown instructions in `SKILL.md` | **Loaded on demand** only when the skill triggers | `<= 250 lines` (`<= 1,800 tokens`) | `skillops audit` (`TokenBudgetReport`) |
| **Level 3: Bundled Execution & Deep References** | `scripts/*.py` (executed via CLI/MCP) & `references/*.md` (read selectively) | **Never preloaded**; scripts run out-of-context and return compact JSON | Unlimited (scripts must output `<= 4 KB` JSON summary by default) | `skillops audit` & `skillops mcp` |

---

## 3. Canonical Anatomy of a Hybrid Executable Skill

Every skill inside `catalog/<track>/<skill-name>/` must follow this directory contract:

```text
catalog/<track>/<skill-name>/
├── SKILL.md                  # Required: YAML frontmatter + concise operational workflow (<250 lines)
├── scripts/                  # Required for catalog skills: Deterministic Python 3.12+ CLI tools
│   └── <tool_name>.py        # Standard CLI contract: accepts --path / --json, exits 0 or non-zero
├── references/               # Optional: Deep domain tables, patterns, or checklists loaded on demand
│   └── <topic>.md
└── evals/                    # Required for catalog skills: TDD evaluation & benchmark artifacts
    ├── evals.json            # Pressure scenarios + deterministic AST/regex/JSON assertions
    └── benchmark.json        # Aggregated pass_rate, token_delta, and latency_ms (with_skill vs baseline)
```

---

## 4. Schema 1: `SKILL.md` Frontmatter & Body (`SkillManifest`)

Validated by `skillops.models.SkillManifest` (Pydantic v2).

### 4.1 YAML Frontmatter Specification

```yaml
---
name: "ast-blast-radius"
description: "Use when modifying shared Python functions, classes, or API schemas to compute the exact call-graph blast radius, downstream dependents, and broken contract risks before editing code."
version: "1.0.0"
track: "arch-quality" # "ai-engineering" | "python-backend" | "arch-quality"
tags:
  - "python"
  - "ast"
  - "refactoring"
  - "architecture"
routing_signals:
  languages: ["python"]
  files_any: ["pyproject.toml", "setup.py", "requirements.txt"]
  dependencies_any: []
  negative_triggers:
    - "Do not trigger for pure CSS/HTML styling changes or static Markdown edits."
entrypoints:
  scripts:
    - path: "scripts/analyze_call_graph.py"
      description: "Computes callers, callees, and transitive dependents for a target Python symbol."
---
```

### 4.2 Authoring Rules for `description` (Trigger Optimization)
1. **Start with `"Use when..."`:** State the concrete triggering conditions, symptoms, and task contexts.
2. **Never summarize the workflow inside `description`:** As documented in `writing-skills`, if `description` summarizes *how* the skill works, the LLM will follow the 1-sentence summary instead of loading `SKILL.md`.
3. **Include explicit scope boundaries:** Prevent false-positive triggering and semantic collision with neighboring skills.

---

## 5. Schema 2: Deterministic Python Script Contract (`scripts/*.py`)

Every Python tool bundled inside `catalog/<track>/<skill-name>/scripts/*.py` must adhere to a uniform Agent-Computer Interface (ACI):

1. **Zero Heavy Third-Party Dependencies When Possible:** Prefer Python 3.12+ standard library (`ast`, `pathlib`, `json`, `argparse`, `re`, `sqlite3`, `tokenize`) so scripts run instantaneously in any environment.
2. **Mandatory `--json` Flag:** Every script must support `--json` and emit a deterministic JSON payload to `stdout`:

```json
{
  "skill": "ast-blast-radius",
  "script": "analyze_call_graph.py",
  "status": "ok",
  "target": "src/skillops/auditor/collision.py:compute_collision_matrix",
  "summary": {
    "direct_callers": 3,
    "transitive_dependents": 7,
    "risk_level": "medium"
  },
  "findings": [
    {
      "file": "src/skillops/cli.py",
      "line": 48,
      "symbol": "audit_command",
      "impact": "Calls compute_collision_matrix directly; signature change requires CLI update."
    }
  ]
}
```

3. **Deterministic Exit Codes:**
   - `0`: Execution succeeded and all checks/invariants passed.
   - `1`: Execution succeeded and detected actionable findings/violations.
   - `2`: Invalid CLI arguments or target path not found.

---

## 6. Schema 3: TDD Evaluation & Benchmark Contract (`evals/evals.json` & `benchmark.json`)

Validated by `skillops.models.EvalSuite` and `skillops.models.BenchmarkReport` (Pydantic v2).

### 6.1 `evals/evals.json` Schema

```json
{
  "skill_name": "ast-blast-radius",
  "schema_version": "1.0",
  "evals": [
    {
      "id": "eval-01-shared-signature-change",
      "name": "Detect broken callers before changing a shared function signature",
      "prompt": "Refactor `parse_skill_file` in `parser.py` to require a mandatory `strict_mode: bool` parameter and update the codebase safely.",
      "fixtures": ["tests/fixtures/sample_repo"],
      "assertions": [
        {
          "id": "assert-ran-blast-radius-script",
          "type": "tool_call_contains",
          "target": "analyze_call_graph.py",
          "description": "Agent executed the deterministic AST call-graph script instead of guessing callers."
        },
        {
          "id": "assert-all-callers-updated",
          "type": "regex_match",
          "target": "parse_skill_file\\(.*strict_mode=",
          "description": "All downstream callers were updated with the new parameter."
        }
      ]
    }
  ]
}
```

### 6.2 `evals/benchmark.json` Schema

```json
{
  "skill_name": "ast-blast-radius",
  "runner": "deterministic-ast",
  "timestamp": "2026-10-29T12:00:00Z",
  "with_skill": {
    "pass_rate_mean": 0.95,
    "pass_rate_stddev": 0.05,
    "tokens_mean": 3420,
    "latency_ms_mean": 4100
  },
  "without_skill": {
    "pass_rate_mean": 0.55,
    "pass_rate_stddev": 0.12,
    "tokens_mean": 6890,
    "latency_ms_mean": 8300
  },
  "delta": {
    "pass_rate_gain": 0.40,
    "token_reduction_pct": -50.36,
    "verdict": "CERTIFIED_IMPROVEMENT"
  }
}
```

---

## 7. Functional Invariants (EARS Specification)

The **SkillOps** engine enforces the following **EARS (Easy Approach to Requirements Syntax)** invariants across CLI, CI, and MCP interfaces:

- **`INV-SKILL-01` (Ubiquitous — Progressive Disclosure Budget):** The SkillOps auditor **shall** enforce that every catalog skill keeps its YAML `description` between `40` and `110` words (`<= 160 tokens`) and its `SKILL.md` body at or below `250` lines (`<= 1,800 tokens`).
- **`INV-SKILL-02` (Event-Driven — Semantic Collision Guardrail):** **When** `skillops audit` evaluates a skill directory, the system **shall** flag any pair of skills whose descriptions exceed the semantic cosine-similarity threshold (`>= 0.72` for high-risk collision, `>= 0.58` for warning).
- **`INV-SKILL-03` (Event-Driven — Context-Aware Bundle Cap):** **When** `skillops route` or `skillops sync` compiles a skill bundle for a target repository, the system **shall** select at most `12` collision-free skills matching the repository's `RepoFingerprint`.
- **`INV-SKILL-04` (State-Driven — Deterministic Script ACI):** **While** executing any bundled Python tool in `catalog/**/scripts/*.py` with `--json`, the script **shall** return valid UTF-8 JSON conforming to the `ScriptOutput` schema without mutating user files unless `--fix` is explicitly passed.
- **`INV-SKILL-05` (Unwanted Behavior — Harmful or Redundant Skill Detection):** **If** a skill's `with_skill` pass rate in `skillops eval` is less than or equal to the `without_skill` baseline (or increases token usage by `> 25%` without improving pass rate), **then** the evaluation engine **shall** mark the skill verdict as `REJECTED_REGRESSION`.
