# ADR-0004: Zero-API Deterministic TDD Skill Evaluation Engine & Stdio MCP (`npx skillops eval`, `npx skillops mcp`)

## Status
Accepted (Updated for `npx skillops@latest` Node.js 20+ / TypeScript Architecture)

## Context
Empirical research (*Agent Skills Can Be Harmful*, `arXiv:2608.11888`) demonstrates that unverified AI agent skills can degrade task pass rates while inflating token consumption. At the same time, open-source developer tools and CI pipelines must never depend on paid external LLM API keys (`OPENAI_API_KEY`) or persistent HTTP servers just to audit, route, sync, or evaluate skills.

## Decision
We implement a **100% Zero-API Deterministic TDD Evaluation Runner (`src/eval/index.ts`)** and a **Native JSON-RPC 2.0 `stdio` MCP Server (`src/mcp/server.ts`)**:

1. **Deterministic TDD Evaluation (`npx skillops@latest eval`):**
   - Validates `evals/evals.json` assertions (`tool_call_contains`, `regex_match`, `json_field_equals`, `exit_code_zero`, `ast_contains`) and `evals/benchmark.json` (`with_skill` vs `without_skill`).
   - Enforces `INV-SKILL-05` (`CERTIFIED_IMPROVEMENT` requires positive pass-rate lift and reduced token consumption) and exports ASCII tables, JSON, Markdown, and standalone HTML benchmark dashboards.
2. **Native JSON-RPC 2.0 `stdio` MCP Server (`npx skillops@latest mcp`):**
   - Exposes `audit_workspace`, `analyze_token_economy`, `route_repo`, `sync_harnesses`, and `run_skill_script` over standard input/output (`stdio`) with zero external network ports.

## Consequences
- **Zero External API Keys:** Runs 100% offline in milliseconds in local terminals and GitHub Actions runners (`Node.js 20+`).
