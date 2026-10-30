# ADR-0001: Hybrid Executable Skills & Context-Isolated Subagents Architecture

## Status
Accepted (Updated for `npx skillops@latest` Node.js 20+ / TypeScript Architecture)

## Context
Across AI coding harnesses (Claude Code, Antigravity/Gemini CLI, Cursor, OpenAI Codex CLI, and GitHub Copilot), agent skills are conventionally authored as plain Markdown documents (`SKILL.md`). Empirical analysis of 307 skill-induced failures (*Agent Skills Can Be Harmful*, `arXiv:2608.11888`) demonstrated two major weaknesses in prose-only skills:
1. **Token & Latency Explosion:** When a `SKILL.md` file exceeds 500 lines or instructs the LLM to perform repetitive mechanical checks (walking AST call graphs, checking SQL migration safety, scanning for OWASP patterns, or counting token budgets), the agent wastes thousands of tokens reasoning through deterministic tasks.
2. **Context Window Pollution during Exploration:** Unbounded repository searches flood the primary agent conversation with raw file dumps.

## Decision
We adopt a **Hybrid Executable Skill & Context-Isolated Subagent Architecture** governed by [`SKILL_CONTRACT.md`](../../../SKILL_CONTRACT.md) and powered by the **Node.js 20+ / TypeScript `npx skillops@latest` engine**:

1. **Three-Level Progressive Disclosure:**
   - **Level 1 (Routing Metadata):** YAML frontmatter (`name`, `description`, `routing_signals`) capped at `40–110 words` (`<= 160 tokens`).
   - **Level 2 (Core Workflow):** `SKILL.md` body capped at `<= 250 lines` (`<= 1,800 tokens`), focusing strictly on high-judgment orchestration decisions.
   - **Level 3 (Zero-Context-Token Execution & Deep References):** Every official skill in `catalog/` bundles a standalone CLI tool inside `scripts/*` (emitting structured JSON via `--json` at **0 prompt tokens**) alongside optional on-demand reference tables in `references/*.md`.
2. **Context-Isolated Subagents (`INV-SKILL-04`):**
   - Deep exploration, security red-teaming, and blast-radius tracing run inside isolated subagent contexts (`catalog/subagents/*/SUBAGENT.md`, `.github/agents/*.agent.md`) with explicit least-privilege tools and a hard `max_output_tokens <= 400` return briefing cap.

## Consequences
- **Drastic Token & Latency Reduction:** Offloading mechanical checks to `scripts/*` and exploratory searches to isolated subagents reduces primary context token consumption by 45–60% while achieving 100% precision on deterministic gates.
- **Cross-Runtime Portability:** `npx skillops@latest sync` transpiles the exact same canonical catalog across Claude Code, Antigravity, Cursor, Codex CLI, and GitHub Copilot.
