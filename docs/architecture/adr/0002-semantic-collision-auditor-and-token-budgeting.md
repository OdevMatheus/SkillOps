# ADR-0002: Semantic Routing Collision Auditor & Token Budget Governance (`arXiv:2610.18522`)

## Status
Accepted (Updated for `npx skillops@latest` Node.js 20+ / TypeScript Architecture)

## Context
As developers adopt AI coding agents, they frequently accumulate dozens of skills and rules in `.agent/skills/`, `.claude/skills/`, or `.cursor/rules/`. Recent research (*Lost in Implicit Routing*, `arXiv:2610.18522`) proved that when too many skills—or near-duplicate skill descriptions—are listed in the system prompt:
- Implicit skill selection recall drops from **73.6% to 27.4%**.
- In **51.6% of tasks**, the model fails to load any skill at all (up from 9.3% when curated).
- Near-duplicate trigger descriptions cause routing ambiguity and waste always-loaded Level 1 context tokens.

## Decision
We implement a deterministic **Semantic Collision Auditor & Token Economy Engine (`src/auditor/`)** exposed via `npx skillops@latest audit` and `npx skillops@latest tokens`:

1. **Pairwise Semantic Similarity Matrix (`src/auditor/collision.ts`):**
   - Computes zero-API TF-IDF word/character n-gram cosine similarity and MinHash Jaccard similarity across all skill and subagent descriptions.
   - Flags pairs with `cosine >= 0.85` as `BLOCKING_ERROR`, `cosine >= 0.72` as `HIGH_RISK` (error in `--strict` mode), and `0.58 <= cosine < 0.72` as `WARNING`.
2. **Three-Level Token Budget & Startup Tax Analyzer (`src/auditor/token_budget.ts`, `src/auditor/token_economy.ts`):**
   - Audits repository-wide always-on Startup Token Tax (`<= 2,500 tokens`), Level 1 metadata (`<= 160 tokens`), Level 2 body (`<= 250 lines` / `<= 1,800 tokens`), and subagent contracts (`max_output_tokens <= 400`, no wildcard `tools: ["*"]`).

## Consequences
- **Immediate Diagnostic Value:** Developers can run `npx skillops@latest tokens` and `npx skillops@latest audit` in any repository with zero API keys.
- **Deterministic CI Gate:** Blocks pull requests that introduce routing collisions or Startup Token Tax regressions.
