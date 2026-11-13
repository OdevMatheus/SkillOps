# SkillOps Canonical Contract (`SKILL_CONTRACT.md`)

> **Version:** `1.5.2` — 28 Supported Coding Agents & Zero-Bloat TypeScript Transpiler  
> **Status:** Canonical Specification (`Version: 1.5.2` — **28 Supported Coding Agents**)  
> **Related ADRs:** [`ADR-0001`](./docs/architecture/adr/0001-hybrid-executable-skills-architecture.md), [`ADR-0002`](./docs/architecture/adr/0002-semantic-collision-auditor-and-token-budgeting.md) *(Superseded by ADR-0005)*, [`ADR-0003`](./docs/architecture/adr/0003-context-aware-dynamic-router-and-multi-runtime-sync.md) *(Superseded by ADR-0005)*, [`ADR-0004`](./docs/architecture/adr/0004-zero-api-tdd-evaluation-and-stdio-mcp.md) *(Superseded by ADR-0005)*, [`ADR-0005`](./docs/architecture/adr/0005-multi-ide-transpiler-and-security-auditor.md)  
> **Scope:** Defines the structural, token-economy, deterministic script execution, supply-chain security, SHA-256 lockfile, and TDD evaluation schemas for **Hybrid Executable Skills & Context-Isolated Subagents** managed by **SkillOps** (`npx skillops-cli@latest`) across all **28 Supported Coding Agents** (`claude`, `antigravity`, `cursor`, `codex`, `copilot`, `windsurf`, `cline`, `roocode`, `kilocode`, `zed`, `continue`, `aider`, `openhands`, `amp`, `goose`, `opencode`, `kiro`, `trae`, `amazonq`, `junie`, `gemini`, `factory`, `qwen`, `augment`, `vibe`, `warp`, `crush`, `idx`).

---

## 1. Scientific Motivation & Core Principles

Modern AI coding harnesses (Claude Code, Google Antigravity IDE, Cursor, OpenAI Codex CLI, GitHub Copilot, Windsurf, Cline, Roo Code, Kilo Code, Zed AI, Continue.dev, Aider, OpenHands, Sourcegraph Amp, Block Goose, OpenCode, AWS Kiro, Trae AI IDE, Amazon Q Developer, JetBrains Junie, Google Gemini CLI, Factory AI Droid, Qwen Code CLI, Augment Code, Mistral Vibe CLI, Warp AI Terminal, Charmbracelet Crush, and Firebase Studio / Project IDX) rely on `SKILL.md` modules, scoped rule files, and specialized subagents to guide agent behavior. Empirical research revealed two critical failure modes in community skill libraries:

1. **Implicit Routing Collapse (*Lost in Implicit Routing*, `arXiv:2610.18522`):**
   - Loading dozens of overlapping or poorly differentiated skill descriptions into a workspace drops implicit skill selection recall from **73.6% down to 27.4%**, and in **51.6% of tasks** the agent loads **zero skills**.
   - **SkillOps Contract Rule:** Every skill `description` must start with `"Use when"` and clearly state domain triggers and negative triggers within a compact `40–110` word (`<= 160` token) routing budget (`INV-SKILL-01`, `INV-SKILL-02`).
2. **Skill-Induced Regressions & Startup Token Tax Bloat (*Agent Skills Can Be Harmful*, `arXiv:2608.11888`):**
   - Verbose prose instructions without deterministic scripts induce functional regressions or inflate token consumption by **4× to 15×** when they force the LLM to perform mechanical checks manually.
   - **SkillOps Contract Rule:** Every catalog skill in `catalog/` must be a **Hybrid Executable Skill**—pairing a concise `SKILL.md` (`<= 250 lines`) with deterministic Python 3.12+ standard-library CLI tools (`scripts/*.py --json`) and a verifiable TDD evaluation suite (`evals/evals.json` + `evals/benchmark.json`). Heavy multi-file exploration is delegated to **Context-Isolated Subagents** (`catalog/subagents/*/SUBAGENT.md`) capped at `<= 400` output tokens.

---

## 2. Three-Level Progressive Disclosure & Subagent Token Budget Contract

To protect context windows across single-agent and multi-agent runs, every skill and subagent governed by **SkillOps** enforces strict progressive disclosure budgets:

| Disclosure Tier | Artifact | When Loaded into LLM Context | Maximum Token / Size Budget | Enforcement Gate |
| :--- | :--- | :--- | :--- | :--- |
| **Always-On Root Instructions** | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md` | **Always loaded** at session start | Concise governance rules; Codex skill index managed via bounded markers | `SkillManifestSchema` & PR governance |
| **Level 1: Routing Metadata** | YAML frontmatter (`name`, `description`, `routing_signals`) | **Always loaded** at session start (for installed skills) | `40–110 words` (`<= 160 tokens` per skill) | `SkillManifestSchema` (`npx skillops-cli audit --strict`) |
| **Level 2: Core Workflow (`SKILL.md` Body)** | Markdown instructions in `SKILL.md` | **Loaded on demand** only when the skill triggers | `<= 250 lines` (`<= 1,800 tokens`) | `parseSkillDirectory` (`npx skillops-cli audit --strict`) |
| **Level 3: Bundled Execution & References** | `scripts/*.py` (executed via CLI) & `references/*.md` | **Never preloaded**; scripts run out-of-context and return compact JSON | `0` startup tokens (`ScriptOutputSchema` JSON payload) | `parseSkillDirectory(..., { requireLayout: true })` |
| **Context-Isolated Subagent** | `SUBAGENT.md` / `.agent.md` / `.toml` | Runs in an **isolated child context window** | System prompt `<= 180 lines` (`<= 1,000 tokens`); `max_output_tokens <= 400`; no wildcard `["*"]` tools | `SubagentManifestSchema` (`INV-SKILL-04`) |

---

## 3. Canonical Anatomy of Hybrid Executable Skills & Subagents

```text
catalog/
├── <track>/<skill-name>/         # Tracks: ai-engineering | python-backend | arch-quality | token-economy
│   ├── SKILL.md                  # Required: YAML frontmatter + concise operational workflow (<= 250 lines)
│   ├── scripts/                  # Required: Deterministic Python 3.12+ stdlib CLI micro-tools
│   │   └── <tool_name>.py        # Standard CLI contract: accepts --path / --json, exits 0, 1, or 2
│   ├── references/               # Optional: Deep domain tables or checklists loaded on demand
│   │   └── <topic>.md
│   └── evals/                    # Required: TDD evaluation & benchmark artifacts
│       ├── evals.json            # Validated by EvalSuiteSchema in src/models.ts
│       └── benchmark.json        # Validated by BenchmarkReportSchema in src/models.ts
└── subagents/<subagent-name>/    # Context-Isolated Subagents
    └── SUBAGENT.md               # Validated by SubagentManifestSchema in src/models.ts
```

---

## 4. Schema 1: `SKILL.md`, `SUBAGENT.md` & Lockfile Manifests (`src/models.ts`)

Validated by `SkillManifestSchema`, `SubagentManifestSchema`, `SyncLockfileSchema`, and `SkillOpsConfigSchema` (Zod v3 in [`src/models.ts`](./src/models.ts)).

### 4.1 Skill YAML Frontmatter (`SkillManifestSchema`)

```yaml
---
name: "mcp-architect"
description: "Use when designing, implementing, or auditing Model Context Protocol (MCP) servers, JSON-RPC 2.0 stdio transports, tool input schemas, and context-window token footprints across enterprise coding agents and local developer harnesses. Do not trigger for generic REST APIs, GraphQL resolvers, or frontend UI component styling."
version: "1.0.0"
track: "ai-engineering" # "ai-engineering" | "python-backend" | "arch-quality" | "token-economy"
tags: ["mcp", "fastmcp", "json-rpc", "token-economy"]
routing_signals:
  languages: ["python", "typescript"]
  files_any: ["pyproject.toml", "package.json"]
  dependencies_any: ["mcp", "@modelcontextprotocol/sdk"]
  negative_triggers:
    - "Do not trigger for generic REST APIs, GraphQL resolvers, or frontend UI styling."
entrypoints:
  scripts:
    - path: "scripts/validate_mcp_server.py"
      description: "Deterministic AST auditor for MCP stdio hygiene, typed tool schemas, and localhost bindings."
---
```

### 4.2 Subagent YAML Frontmatter (`SubagentManifestSchema`)

```yaml
---
name: "context-scout"
description: "Use when exploring unfamiliar directories, tracing symbol call graphs, or locating architectural boundaries in an isolated read-only context window before making edits."
tools: ["read", "search"]
max_output_tokens: 400
model_tier: "fast" # "inherit" | "fast" | "reasoning"
user_invocable: true
context_isolation: true
tags: ["exploration", "context-isolation", "read-only"]
---
```

### 4.3 SHA-256 Sync Lockfile (`SyncLockfileSchema` — `.skillops-lock.json`)

Every artifact written by `skillops add` or `skillops update` is recorded in `.skillops-lock.json` under `SyncLockfileSchema`. Artifact record keys and `relative_path` values are validated by `SafeLockRelativePathSchema` to reject leading `/`, NUL bytes, `..` traversal segments, and prototype-polluting identifiers (`__proto__`, `constructor`, `prototype`).

---

## 5. Schema 2: Deterministic Companion Script Contract (`ScriptOutputSchema`)

Every Python tool bundled inside `catalog/<track>/<skill-name>/scripts/*.py` must adhere to a uniform Agent-Computer Interface validated by `ScriptOutputSchema` in [`src/models.ts`](./src/models.ts):

1. **Zero Third-Party Dependencies & Zero Outbound Network Exfiltration (`INV-SKILL-03`, `INV-SKILL-06`):** Use Python 3.12+ standard library (`ast`, `pathlib`, `json`, `argparse`, `re`, `sys`, `tokenize`, `urllib.parse`) so scripts run deterministically offline in any environment. Outbound network/exfiltration clients (`urllib.request`, `http.client`, `socket`, `requests`, `httpx`, `aiohttp`, `paramiko`, `websocket`), dynamic code execution/deserialization (`eval`, `exec`, `__import__`, `importlib`, `compile`, `pickle`, `marshal`, `ctypes`), and unsafe shell execution (`os.system`, `os.popen`, `pty`, `subprocess` with `shell=True`) are blocked by [`src/auditor/security.ts`](./src/auditor/security.ts).
2. **Mandatory `--json` Flag (`ScriptOutputSchema`):** Every script must support `--json` and emit a deterministic JSON payload to `stdout`:

```json
{
  "skill": "mcp-architect",
  "script": "validate_mcp_server.py",
  "status": "ok",
  "target": "server.py",
  "summary": {
    "files_scanned": 1,
    "findings_count": 0
  },
  "findings": []
}
```

3. **Deterministic Script Exit Codes:**
   - `0`: Execution succeeded and all checks/invariants passed (`status: "ok"`).
   - `1`: Execution succeeded and detected actionable findings/violations (`status: "findings_detected"` or `"warn"`).
   - `2`: Invalid CLI arguments or target path not found (`status: "error"`).

---

## 6. Schema 3: TDD Evaluation & Benchmark Contract (`EvalSuiteSchema` & `BenchmarkReportSchema`)

Validated structurally by `EvalAssertionSchema`, `EvalCaseSchema`, `EvalSuiteSchema`, and `BenchmarkReportSchema` in [`src/models.ts`](./src/models.ts):

### 6.1 `evals/evals.json` (`EvalSuiteSchema`)

```json
{
  "skill_name": "mcp-architect",
  "schema_version": "1.0",
  "evals": [
    {
      "id": "eval-01-stdio-print-corruption",
      "name": "Detect and fix stdout print() corruption in a FastMCP stdio tool",
      "prompt": "Audit our FastMCP server in `server.py` where `search_docs` prints debug logs to stdout, and fix it so stdio JSON-RPC framing is not corrupted.",
      "fixtures": [],
      "assertions": [
        {
          "id": "assert-ran-validate-mcp-script",
          "type": "tool_call_contains",
          "target": "validate_mcp_server.py",
          "description": "Agent executed the deterministic AST MCP auditor script."
        }
      ]
    }
  ]
}
```

### 6.2 `evals/benchmark.json` (`BenchmarkReportSchema`)

```json
{
  "skill_name": "mcp-architect",
  "runner": "deterministic-ast",
  "timestamp": "2026-10-29T14:00:00Z",
  "with_skill": {
    "pass_rate_mean": 0.96,
    "pass_rate_stddev": 0.04,
    "tokens_mean": 2840,
    "latency_ms_mean": 3200
  },
  "without_skill": {
    "pass_rate_mean": 0.62,
    "pass_rate_stddev": 0.11,
    "tokens_mean": 5120,
    "latency_ms_mean": 6100
  },
  "delta": {
    "pass_rate_gain": 0.34,
    "token_reduction_pct": -44.53,
    "verdict": "CERTIFIED_IMPROVEMENT"
  }
}
```

---

## 7. Functional Invariants (EARS Specification), CLI Commands & Exit Codes

### 7.1 Supported CLI Subcommands (`npx skillops-cli@latest`)
- `skillops add [names...] [--targets <list|auto|core|all>] [--dry-run] [--force] [--global] [--format table|json|markdown]`: Install Skills and Subagents across any of the 28 supported AI coding agents (interactive Lip Gloss TUI when invoked in a TTY without arguments).
- `skillops status [--targets <list>] [--format table|json|markdown]`: Inspect installed artifacts, SHA-256 lockfile health, available catalog updates, and local drift.
- `skillops update [names...] [--targets <list>] [--dry-run] [--force]`: Re-transpile installed Skills and Subagents from the catalog while preserving locally modified files unless `--force` is passed.
- `skillops remove [names...] [--targets <list>] [--all] [--dry-run] [--force]`: Cleanly uninstall managed artifacts without deleting locally edited user rules.
- `skillops audit [--catalog <dir>] [--strict] [--format table|json]`: Validate catalog manifests, required Level 3 layouts (`scripts/`, `evals/`), supply-chain security (`INV-SKILL-06`), and 28-target transpilation parity.

### 7.2 Normative EARS Invariants
- **`INV-SKILL-01` (Ubiquitous — Progressive Disclosure Budget):** The SkillOps parser **shall** enforce that every catalog skill keeps its YAML `description` between `40` and `110` words (`<= 160 tokens`) starting with `"Use when"` and its `SKILL.md` total length at or below `250` lines (`body_tokens <= 1,800`).
- **`INV-SKILL-02` (Ubiquitous — Trigger-Pure Routing Metadata):** Every skill `name` **shall** match lowercase kebab-case (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) and declare unambiguous positive domain triggers and `negative_triggers` to prevent implicit routing collisions across active bundles.
- **`INV-SKILL-03` (Ubiquitous — Deterministic Offline Companion Tooling):** Every catalog skill **shall** declare at least one Level 3 script under `scripts/` (`ScriptEntrypointSchema`) that runs offline with zero third-party packages and emits `ScriptOutputSchema`-compliant JSON via `--json`.
- **`INV-SKILL-04` (Ubiquitous — Context-Isolated Subagent Contract):** Every subagent governed by SkillOps **shall** declare an explicit least-privilege `tools` allowlist (never `["*"]`, `"all"`, `"any"`, or `"**"`), keep its system prompt `<= 180` lines (`<= 1,000 tokens`), and cap `max_output_tokens <= 400`.
- **`INV-SKILL-05` (Unwanted Behavior — TDD Evaluation & Benchmark Certification):** **If** a catalog skill is audited in strict layout mode, **then** it **shall** include a valid `EvalSuiteSchema` (`evals/evals.json`) and `BenchmarkReportSchema` (`evals/benchmark.json`) recording comparative `with_skill` vs. `without_skill` metrics (`CERTIFIED_IMPROVEMENT` requires positive `pass_rate_gain`).
- **`INV-SKILL-06` (Ubiquitous — Zero-Network, Trojan-Free & Boundary-Safe Security Contract):** Every Skill and Subagent in `catalog/` **shall** pass `auditCatalogSecurity` ([`src/auditor/security.ts`](./src/auditor/security.ts)) and mandatory `CODEOWNERS` human review:
  1. **No Outbound Network / Exfiltration Primitives:** Companion scripts must not import outbound network modules or pipe remote downloads into shells.
  2. **No Dynamic Execution or Unsafe Deserialization:** Companion scripts must not invoke `eval()`, `exec()`, `__import__()`, `importlib`, `Function()`, `pickle`, `marshal`, `shelve`, `ctypes`, or `cffi`.
  3. **No Unsafe Shell Invocation:** Companion scripts must not invoke `os.system()`, `os.popen()`, `pty`, `child_process`, reverse-shell primitives, or `subprocess` with `shell=True`.
  4. **No Trojan-Source Unicode, Symlinks, Prototype Pollution, or Boundary Escape:** Catalog directories must not contain Trojan-Source bidirectional/invisible Unicode controls, symbolic links, or opaque binaries. All filesystem writes/removals must stay strictly inside the canonical repository root (`resolveSafeRepoTargetPath`), and `.skillops-lock.json` keys must pass `SafeLockRelativePathSchema`.

### 7.3 Standard CLI Exit Codes (`ExitCode` in `src/models.ts`)
- `0` (`SUCCESS`): Operation, sync, status check, or audit passed cleanly.
- `1` (`ERROR`): General execution, validation, or local drift conflict error.
- `2` (`COLLISION_ERROR`): CLI usage or semantic routing conflict error.
- `3` (`BUDGET_OR_CONTRACT_ERROR`): Progressive disclosure budget, invalid `--targets`, or `.skillops.yml` contract violation.
- `4` (`EVAL_REGRESSION_ERROR`): Skill evaluation benchmark failed `INV-SKILL-05`.
- `5` (`SECURITY_BOUNDARY_ERROR`): Supply-chain security violation (`INV-SKILL-06`) or unsafe repository path/boundary attempt.
