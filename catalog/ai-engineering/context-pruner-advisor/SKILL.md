---
name: "context-pruner-advisor"
description: "Use when diagnosing repository context window bloat, trimming oversized CLAUDE.md or AGENTS.md root files, generating surgical .claudeignore and .cursorignore exclusion manifests, or decomposing monolithic markdown documentation into three-tier progressive disclosure hierarchies to eliminate redundant token ingestion before coding sessions begin."
version: "1.0.0"
track: "ai-engineering"
tags:
  - "context-pruning"
  - "token-economy"
  - "claudeignore"
  - "cursorignore"
  - "progressive-disclosure"
routing_signals:
  languages: ["markdown", "yaml", "json"]
  files_any: ["AGENTS.md", "CLAUDE.md", ".claudeignore", ".cursorignore"]
  dependencies_any: []
  negative_triggers:
    - "Do not trigger for runtime application memory leaks, database vacuuming, or frontend JavaScript bundle tree-shaking."
entrypoints:
  scripts:
    - path: "scripts/context_pruner.py"
      description: "Deterministic repository context footprint scanner that ranks high-token files and generates surgical .claudeignore/.cursorignore rules."
---

# Context Pruner Advisor (`context-pruner-advisor`)

## When to Use This Skill
Invoke this skill when an AI coding workspace suffers from high **Startup Token Tax**, bloated root instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`), or unignored build/lockfile directories that pollute context windows during file searches.

## Mandatory Execution Workflow

1. **Run the Zero-Context Footprint Scanner First:**
   Execute the bundled Python analyzer to measure exact file token costs without reading large files into the LLM context window:
   ```bash
   python catalog/ai-engineering/context-pruner-advisor/scripts/context_pruner.py --path . --json
   ```
2. **Enforce Progressive Disclosure (`L1 / L2 / L3` Split):**
   - **L1 (`<= 160 tokens`)**: Keep YAML frontmatter descriptions compact and action-oriented (`Use when...`).
   - **L2 (`<= 250 lines`)**: Keep core operational checklists inside `SKILL.md` or root `AGENTS.md` (`<= 800 tokens`).
   - **L3 (`0 tokens` until on-demand)**: Move deep domain appendices, API schemas, and historical changelogs into `references/` or `docs/` loaded strictly on demand.
3. **Generate Surgical `.claudeignore` & `.cursorignore` Rules:**
   - Exclude deterministic token drains: lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `poetry.lock`), compiled outputs (`dist/`, `build/`, `.next/`, `coverage/`), vendor snapshots, and fixture dumps.
   - Never ignore canonical architectural contracts (`AGENTS.md`, `SKILL_CONTRACT.md`) or active `src/` modules.
4. **Verify Startup Token Budget Compliance:**
   Re-run `npx skillops tokens --strict` and `context_pruner.py --path . --json` to confirm `"status": "ok"` and zero critical token hotspots.
