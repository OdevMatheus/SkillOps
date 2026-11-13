---
name: "context-budget-profiler"
description: "Use when auditing or optimizing AI coding agent context-window token usage across CLAUDE.md, AGENTS.md, GEMINI.md, .cursor/rules, .github/instructions, and SKILL.md manifests to reduce always-on startup token tax, split bloated instruction files exceeding 500 lines or 2500 words into on-demand references/, and enforce progressive disclosure budgets. Do not trigger for application database query profiling, runtime CPU benchmarking, or LLM model fine-tuning."
version: "1.0.0"
track: "token-economy"
tags:
  - "token-economy"
  - "context-window"
  - "progressive-disclosure"
  - "agents-md"
  - "claude-md"
routing_signals:
  languages: ["markdown", "yaml", "json"]
  files_any: ["CLAUDE.md", "AGENTS.md", "GEMINI.md", ".cursor/rules", ".github/instructions"]
  dependencies_any: []
  negative_triggers:
    - "Do not trigger for application CPU/memory profiling, SQL query tuning, or LLM fine-tuning."
entrypoints:
  scripts:
    - path: "scripts/profile_context_budget.py"
      description: "Deterministic context-window profiler measuring startup vs on-demand token load across agent instruction files and recommending progressive-disclosure splits."
---

# Context Budget Profiler (`context-budget-profiler`)

## When to Use This Skill
Invoke this skill whenever `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/*`, `.github/instructions/*`, or skill directories grow large and degrade AI agent instruction adherence or inflate per-turn startup token consumption.

## Mandatory Execution Workflow

1. **Measure Current Startup & On-Demand Token Load First:**
   Run the deterministic stdlib profiler from the repository root before reorganizing instruction files:
   ```bash
   python catalog/token-economy/context-budget-profiler/scripts/profile_context_budget.py --repo . --json
   ```
   Inspect `metrics.total_startup_tokens`, `findings`, and `split_suggestions` in the JSON output.

2. **Apply the Three-Level Progressive Disclosure Architecture:**
   - **Level 0 — Always-On Root Instructions (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `alwaysApply: true` rules):**
     Keep strictly concise (`<= 300` lines, target `< 1,500` tokens combined). Retain only repository-wide build/test commands, non-negotiable security boundaries, and architectural invariants needed on every turn.
   - **Level 1 — Routing Frontmatter (`SKILL.md` / `SUBAGENT.md` `description`):**
     Keep each `description` between `40` and `110` words (`<= 160` tokens) starting with `"Use when..."` so routing metadata remains lightweight even with a dozen installed skills.
   - **Level 2 & 3 — On-Demand Skill Bodies (`<= 250` lines) & Deep References (`references/*.md`):**
     Move domain-specific playbooks into scoped skills (`.claude/skills/<slug>/SKILL.md`, `.agent/skills/<slug>/SKILL.md`, or glob-scoped `.cursor/rules/*.mdc` with `alwaysApply: false`), and extract bulky API tables, examples, or checklists into `references/<topic>.md` linked from `SKILL.md`.

3. **Remediate Bloated Context Files (`bloated-context-file`):**
   - For any file exceeding `500` lines or `2,500` words, inspect `split_suggestions[].candidate_sections` from the profiler output.
   - Extract heavy reference sections into dedicated `references/<section-slug>.md` files and replace inline blocks with concise 1-line links explaining *when* the agent should read each reference file.
   - Never duplicate identical governance paragraphs across `CLAUDE.md`, `AGENTS.md`, and `.github/copilot-instructions.md`; maintain a single canonical source or modular skills.

4. **Re-Verify Token Reduction:**
   Re-run `profile_context_budget.py --repo . --json` and confirm `"status": "ok"` (zero `bloated-context-file` errors and `total_startup_tokens <= startup_budget`).

## Findings Reference

| Rule ID | Severity | Meaning & Fix |
| :--- | :---: | :--- |
| `bloated-context-file` | `error` / `warning` | File exceeds `500` lines or `2,500` words; split heavy sections into `references/`. |
| `skill-body-over-250-lines` | `warning` | `SKILL.md` exceeds `250` lines; move lookup tables or code templates into `references/`. |
| `skill-l1-description-over-budget` | `warning` | `SKILL.md` `description` exceeds `160` tokens; trim workflow summaries from frontmatter. |
| `startup-token-budget-exceeded` | `warning` | Combined always-on + L1 routing tokens exceed `--startup-budget` (default `2500`). |
