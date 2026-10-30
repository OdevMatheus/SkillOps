---
name: "agent-harness-auditor"
description: "Use when evaluating multi-agent orchestration loops, auditing skill registry cardinality, diagnosing implicit routing collapse across overlapping skill descriptions, or verifying subagent tool-permission boundaries and output caps to prevent skill-induced reasoning degradation in Claude Code, Cursor, Codex, and custom agent harnesses."
version: "1.0.0"
track: "ai-engineering"
tags:
  - "agent-harness"
  - "routing-collapse"
  - "subagent-orchestration"
  - "skill-selection"
  - "multi-agent"
routing_signals:
  languages: ["markdown", "yaml", "typescript", "python"]
  files_any: [".skillops.yml", ".github/agents", ".claude/skills"]
  dependencies_any: []
  negative_triggers:
    - "Do not trigger for HTTP API gateway load-balancer routing, React Router frontend navigation, or BGP network peering."
entrypoints:
  scripts:
    - path: "scripts/harness_linter.py"
      description: "Deterministic agent harness auditor checking active skill cardinality, wildcard tool permissions, and missing negative triggers."
---

# Agent Harness Auditor (`agent-harness-auditor`)

## When to Use This Skill
Invoke this skill when designing, auditing, or troubleshooting an **AI Agent Harness** (skill libraries, subagent topologies, tool-calling loops) to eliminate **Implicit Routing Collapse (`arXiv:2610.18522`)** and **Skill-Induced Failures (`arXiv:2608.11888`)**.

## Mandatory Execution Workflow

1. **Execute the Harness Linter Script First:**
   Run the deterministic Python linter against the target agent directory or catalog:
   ```bash
   python catalog/ai-engineering/agent-harness-auditor/scripts/harness_linter.py --path catalog --json
   ```
2. **Prevent Implicit Routing Collapse (`arXiv:2610.18522`):**
   - Cap active workspace skills at `<= 12` per repository profile (`npx skillops route`).
   - Require every skill manifest to declare explicit `routing_signals.negative_triggers` so the router knows when **not** to activate a skill.
   - Maintain pairwise TF-IDF cosine similarity `< 0.58` across all active L1 descriptions.
3. **Harden Subagent Isolation & Tool Scoping (`arXiv:2608.11888`):**
   - Never grant wildcard `tools: ["*"]` to a subagent; enforce least-privilege tool arrays (`Read`, `Grep`, `Glob` for scouts/auditors).
   - Require `context_isolation: true` and `max_output_tokens <= 400` on every subagent manifest.
4. **Verify Harness Compliance:**
   Re-run `harness_linter.py --path catalog --json` and `npx skillops audit --catalog catalog --strict` to confirm zero violations.
