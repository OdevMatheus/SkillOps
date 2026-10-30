# SkillOps Canonical Contract (`SKILL_CONTRACT.md`)

> **Status:** Canonical Specification (`v0.5.0` — NPX Architecture)  
> **Related ADRs:** [`ADR-0001`](./docs/architecture/adr/0001-hybrid-executable-skills-architecture.md), [`ADR-0002`](./docs/architecture/adr/0002-semantic-collision-auditor-and-token-budgeting.md), [`ADR-0003`](./docs/architecture/adr/0003-context-aware-dynamic-router-and-multi-runtime-sync.md), [`ADR-0004`](./docs/architecture/adr/0004-zero-api-tdd-evaluation-and-stdio-mcp.md)  
> **Scope:** Defines the structural, semantic, token-economy, deterministic execution, and TDD evaluation schemas for **Hybrid Executable Skills & Context-Isolated Subagents** managed by the **SkillOps** Node.js 20+ / TypeScript engine (`npx skillops@latest`).

---

## 1. Scientific Motivation & Core Principles

Modern AI coding harnesses (Claude Code, Antigravity/Gemini CLI, Cursor, OpenAI Codex CLI, GitHub Copilot) rely on `SKILL.md` modules and specialized subagents to guide agent behavior. Empirical research revealed two critical failure modes in community skill libraries:

1. **Implicit Routing Collapse (*Lost in Implicit Routing*, `arXiv:2610.18522`):**
   - Loading dozens of overlapping or poorly differentiated skill descriptions into a workspace drops implicit skill selection recall from **73.6% down to 27.4%**, and in **51.6% of tasks** the agent loads **zero skills**.
   - **SkillOps Contract Rule:** Every skill description must obey strict trigger boundaries and pass pairwise semantic cosine-similarity auditing (`cosine_similarity < 0.72` across any active bundle).
2. **Skill-Induced Regressions & Startup Token Tax Bloat (*Agent Skills Can Be Harmful*, `arXiv:2608.11888`):**
   - Verbose prose instructions without deterministic scripts induce functional regressions or inflate token consumption by **4× to 15×** when they force the LLM to perform deterministic checks manually.
   - **SkillOps Contract Rule:** Every catalog skill in `catalog/` must be a **Hybrid Executable Skill**—pairing a concise `SKILL.md` (`<= 250 lines`) with deterministic Python 3.12+ CLI tools (`scripts/*.py --json`) and a verifiable TDD evaluation suite (`evals/evals.json`). Heavy multi-file exploration is delegated to **Context-Isolated Subagents** (`catalog/subagents/` or `.github/agents/`) capped at `<= 400` output tokens.

---

## 2. Three-Level Progressive Disclosure & Subagent Token Budget Contract

To protect context windows across single-agent and multi-agent runs, every skill and subagent governed by **SkillOps** enforces strict progressive disclosure budgets:

| Disclosure Tier | Artifact | When Loaded into LLM Context | Maximum Token / Size Budget | Enforcement Tool |
| :--- | :--- | :--- | :--- | :--- |
| **Always-On Root Instructions** | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/*.mdc` | **Always loaded** at session start | `<= 600 tokens` per file; `<= 2,500 tokens` total repo Startup Token Tax | `npx skillops tokens --strict` |
| **Level 1: Routing Metadata** | YAML frontmatter (`name`, `description`, `routing_signals`) | **Always loaded** at session start (for active bundle skills) | `40–110 words` (`<= 160 tokens` per skill; `<= 1,500 tokens` per bundle) | `npx skillops audit --strict` |
| **Level 2: Core Workflow (`SKILL.md` Body)** | Markdown instructions in `SKILL.md` | **Loaded on demand** only when the skill triggers | `<= 250 lines` (`<= 1,800 tokens`) | `npx skillops audit --strict` |
| **Level 3: Bundled Execution & References** | `scripts/*.py` (executed via CLI/MCP) & `references/*.md` | **Never preloaded**; scripts run out-of-context and return compact JSON | `0` startup tokens (scripts emit `<= 4 KB` JSON summary) | `npx skillops audit` & `npx skillops mcp` |
| **Context-Isolated Subagent** | `AGENT.md` / `.agent.md` | Runs in an **isolated child context window** | System prompt `<= 1,000 tokens`; compressed output `<= 400 tokens`; no `["*"]` wildcard tools | `npx skillops audit --strict` (`INV-SKILL-04`) |

---

## 3. Canonical Anatomy of Hybrid Executable Skills & Subagents

```text
catalog/
├── <track>/<skill-name>/         # Tracks: ai-engineering | python-backend | arch-quality
│   ├── SKILL.md                  # Required: YAML frontmatter + concise operational workflow (<= 250 lines)
│   ├── scripts/                  # Required: Deterministic Python 3.12+ CLI micro-tools
│   │   └── <tool_name>.py        # Standard CLI contract: accepts --path / --json, exits 0, 1, or 2
│   ├── references/               # Optional: Deep domain tables or checklists loaded on demand
│   │   └── <topic>.md
│   └── evals/                    # Required: TDD evaluation & benchmark artifacts
│       ├── evals.json            # Pressure scenarios + deterministic AST/regex/JSON assertions
│       └── benchmark.json        # Aggregated pass_rate, token_delta, and latency_ms (with_skill vs without_skill)
└── subagents/<subagent-name>/    # Context-Isolated Subagents (optional catalog track)
    └── AGENT.md                  # Least-privilege tools + max_output_tokens <= 400 contract
```

---

## 4. Schema 1: `SKILL.md` & `AGENT.md` Manifests (`src/models.ts`)

Validated by `SkillManifestSchema` and `SubagentManifestSchema` (Zod v3 in [`src/models.ts`](./src/models.ts)).

### 4.1 Skill YAML Frontmatter (`SkillManifest`)

```yaml
---
name: "ast-blast-radius"
description: "Use when modifying shared Python functions, classes, or API schemas to compute the exact call-graph blast radius, downstream dependents, and broken contract risks before editing code. Do not trigger for static Markdown or CSS changes."
version: "1.0.0"
track: "arch-quality" # "ai-engineering" | "python-backend" | "arch-quality"
tags: ["python", "ast", "refactoring", "architecture"]
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

### 4.2 Subagent YAML Frontmatter (`SubagentManifest`)

```yaml
---
name: "skill-auditor"
description: "Use when auditing Hybrid Executable Skills and Context-Isolated Subagents against SKILL_CONTRACT.md, token budgets, and multi-runtime compatibility. Do not trigger for unrelated UI work."
tools: ["read", "search"]
max_output_tokens: 400
user-invocable: true
---
```

---

## 5. Schema 2: Deterministic Python Script Contract (`scripts/*.py`)

Every Python tool bundled inside `catalog/<track>/<skill-name>/scripts/*.py` must adhere to a uniform Agent-Computer Interface (`ScriptOutputSchema` in [`src/models.ts`](./src/models.ts)):

1. **Zero Heavy Third-Party Dependencies:** Use Python 3.12+ standard library (`ast`, `pathlib`, `json`, `argparse`, `re`, `sqlite3`, `tokenize`) so scripts run instantaneously in any environment.
2. **Mandatory `--json` Flag:** Every script must support `--json` and emit a deterministic JSON payload to `stdout`:

```json
{
  "skill": "ast-blast-radius",
  "script": "analyze_call_graph.py",
  "status": "ok",
  "target": "src/auditor/collision.ts:auditCatalog",
  "summary": {
    "direct_callers": 3,
    "transitive_dependents": 7,
    "risk_level": "medium"
  },
  "findings": []
}
```

3. **Deterministic Exit Codes:**
   - `0`: Execution succeeded and all checks/invariants passed.
   - `1`: Execution succeeded and detected actionable findings/violations.
   - `2`: Invalid CLI arguments or target path not found.

---

## 6. Schema 3: TDD Evaluation & Benchmark Contract (`evals/evals.json` & `benchmark.json`)

Validated by `EvalSuiteSchema` and `BenchmarkReportSchema` (Zod v3 in [`src/models.ts`](./src/models.ts)) and executed offline via `npx skillops@latest eval`.

---

## 7. Functional Invariants (EARS Specification) & CLI Exit Codes

The **SkillOps** TypeScript NPX engine enforces the following **EARS (Easy Approach to Requirements Syntax)** invariants across CLI, CI, and MCP interfaces:

- **`INV-SKILL-01` (Ubiquitous — Progressive Disclosure Budget):** The SkillOps auditor **shall** enforce that every catalog skill keeps its YAML `description` between `40` and `110` words (`<= 160 tokens`) and its `SKILL.md` body at or below `250` lines (`<= 1,800 tokens`).
- **`INV-SKILL-02` (Event-Driven — Semantic Collision Guardrail):** **When** `npx skillops audit` evaluates a skill directory, the system **shall** flag any pair of skills whose descriptions exceed the semantic cosine-similarity threshold (`>= 0.58` warning, `>= 0.72` high-risk, `>= 0.85` blocking error).
- **`INV-SKILL-03` (Event-Driven — Context-Aware Bundle Cap):** **When** `npx skillops route` or `npx skillops sync` compiles a skill bundle for a target repository, the system **shall** select at most `12` collision-free skills (`<= 1,500` total Level 1 tokens) matching the repository's `RepoProfile`.
- **`INV-SKILL-04` (Ubiquitous — Context-Isolated Subagent Contract):** Every subagent governed by SkillOps **shall** declare an explicit least-privilege `tools` allowlist (never `["*"]`), keep its system prompt `<= 1,000 tokens`, and cap `max_output_tokens <= 400`.
- **`INV-SKILL-05` (Unwanted Behavior — Harmful or Redundant Skill Detection):** **If** a skill's `with_skill` pass rate in `npx skillops eval` fails to improve over `without_skill` by at least `+15%` (or inflates token usage by `> 25%` without improving pass rate), **then** the evaluation engine **shall** mark the skill verdict as `REJECTED_REGRESSION`.

### Standard CLI Exit Codes (`ExitCode` in `src/models.ts`)
- `0` (`SUCCESS`): All checks, routing, sync, or evaluations passed.
- `1` (`ERROR`): General execution or drift error.
- `2` (`COLLISION_ERROR`): Pairwise semantic collision detected (`--strict`).
- `3` (`BUDGET_OR_CONTRACT_ERROR`): Progressive disclosure token budget or Startup Token Tax violation (`--strict`).
- `4` (`EVAL_REGRESSION_ERROR`): Skill evaluation failed `INV-SKILL-05` (`--strict`).
- `5` (`SECURITY_BOUNDARY_ERROR`): Invalid or unsafe target path.
