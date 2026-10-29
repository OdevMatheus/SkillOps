# ADR-0002: Semantic Routing Collision Auditor & Token Budget Governance (`arXiv:2610.18522`)

## Status
Accepted (2026-10-29)

## Context
As developers adopt AI coding agents, they frequently accumulate 50 to 100+ skills in `.agent/skills/` or `.claude/skills/`. Recent research (*Lost in Implicit Routing*, `arXiv:2610.18522`) proved that when too many skills—or near-duplicate skill descriptions—are listed in the system prompt:
- Implicit skill selection recall drops from **73.6% to 27.4%**.
- In **51.6% of tasks**, the model fails to load any skill at all (up from 9.3% when curated).
- Near-duplicate trigger descriptions (e.g., `csharp-developer` vs. `dotnet-core-expert`, or `ai-sdk` vs. `ai-sdk-7`) cause routing ambiguity and waste always-loaded Level 1 context tokens.

## Decision
We implement a deterministic **Semantic Collision Auditor & Token Budget Linter (`src/skillops/auditor/`)** exposed via `skillops audit <path>`:

1. **Pairwise Semantic Similarity Matrix:**
   - Computes pairwise cosine similarity across all skill `name` + `description` embeddings (supporting both zero-dependency character/word n-gram TF-IDF vectors for instant offline CI execution and dense vector embeddings via OpenAI/local providers).
   - Flags pairs with `cosine_similarity >= 0.72` as **High-Risk Routing Collisions** (`ERROR`) and `0.58 <= cosine_similarity < 0.72` as **Overlap Warnings** (`WARN`).
2. **Three-Level Token Budget Linter:**
   - Audits Level 1 always-loaded metadata overhead across the entire workspace and per-skill Level 2 body length (`<= 250 lines` / `<= 1,800 tokens`), checking that descriptions start with `"Use when..."` and do not leak workflow summaries.
3. **Actionable Remediation Output:**
   - Emits terminal tables (`Rich`), structured JSON (`AuditReport`), and Markdown reports recommending whether to merge, prune, scope-partition, or rewrite colliding skills.

## Consequences

### Positive
- **Immediate Diagnostic Value on Any Existing Workspace:** Developers can point `skillops audit` at their existing `.agent/skills/` or `.claude/skills/` directory and immediately discover why their agent is ignoring skills or burning context tokens.
- **Deterministic CI Gate:** Prevents new pull requests in SkillOps from introducing skills whose trigger descriptions collide with existing catalog entries.

### Negative
- Requires maintaining calibrated similarity thresholds for both sparse (TF-IDF n-gram) and dense embedding backends.
