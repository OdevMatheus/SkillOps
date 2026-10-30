# Changelog

All notable changes to **SkillOps** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Track 1 High-End Token Economy & AI Harness Skills (`Sprint 5 / Issue #65`):**
  - Added [`catalog/ai-engineering/context-pruner-advisor/SKILL.md`](./catalog/ai-engineering/context-pruner-advisor/SKILL.md) (`scripts/context_pruner.py`), [`catalog/ai-engineering/agent-harness-auditor/SKILL.md`](./catalog/ai-engineering/agent-harness-auditor/SKILL.md) (`scripts/harness_linter.py`), and [`catalog/ai-engineering/prompt-red-teaming/SKILL.md`](./catalog/ai-engineering/prompt-red-teaming/SKILL.md) (`scripts/injection_scanner.py`) alongside [`catalog/ai-engineering/mcp-architect/SKILL.md`](./catalog/ai-engineering/mcp-architect/SKILL.md), each with deterministic `evals/evals.json` and `evals/benchmark.json` suites (`CERTIFIED_IMPROVEMENT`).
- **5 Elite Context-Isolated Subagents in `catalog/subagents/` (`Sprint 5 / Issue #64`):**
  - Added [`catalog/subagents/context-scout/SUBAGENT.md`](./catalog/subagents/context-scout/SUBAGENT.md), [`catalog/subagents/token-budget-governor/SUBAGENT.md`](./catalog/subagents/token-budget-governor/SUBAGENT.md), [`catalog/subagents/blast-radius-auditor/SUBAGENT.md`](./catalog/subagents/blast-radius-auditor/SUBAGENT.md), [`catalog/subagents/red-team-breaker/SUBAGENT.md`](./catalog/subagents/red-team-breaker/SUBAGENT.md), and [`catalog/subagents/tdd-reproducer-agent/SUBAGENT.md`](./catalog/subagents/tdd-reproducer-agent/SUBAGENT.md) enforcing `INV-SKILL-04` (`max_output_tokens <= 400`, explicit least-privilege tools, and isolated exploration contracts).

### Changed
- **NPX DevOps, Governance & Token Economy Alignment (`Sprint 4 / v0.5.0`):**
  - Aligned [`.github/CODEOWNERS`](./.github/CODEOWNERS), [`.github/dependabot.yml`](./.github/dependabot.yml), [`.github/release-drafter.yml`](./.github/release-drafter.yml), [`.github/SECURITY.md`](./.github/SECURITY.md), [`.github/labeler.yml`](./.github/labeler.yml), [`.github/workflows/pr-governance.yml`](./.github/workflows/pr-governance.yml), [`.github/workflows/ai-ci.yml`](./.github/workflows/ai-ci.yml), [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md), [`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE/), [`.github/copilot-instructions.md`](./.github/copilot-instructions.md), [`.github/agents/*.agent.md`](./.github/agents/), [`.gitattributes`](./.gitattributes), [`.gitignore`](./.gitignore), and [`.skillops.yml`](./.skillops.yml) with the Node.js 20+ / TypeScript `npx skillops@latest` architecture.
  - Optimized [`AGENTS.md`](./AGENTS.md) (`<= 600 tokens`) and subagent frontmatters (`max_output_tokens <= 400`) so `npx skillops@latest tokens --strict` passes with **0 hotspots**.
  - Updated [`SKILL_CONTRACT.md`](./SKILL_CONTRACT.md), [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`README.md`](./README.md), [`docs/architecture/README.md`](./docs/architecture/README.md), and [`docs/architecture/adr/`](./docs/architecture/adr/) (`ADR-0001` through `ADR-0004`) to reflect the `npx skillops@latest` engine.

### Removed
- Removed obsolete pre-NPX roadmap (`docs/SKILLOPS_IMPROVEMENT_ROADMAP.md`) and renamed `ADR-0004` to [`docs/architecture/adr/0004-zero-api-tdd-evaluation-and-stdio-mcp.md`](./docs/architecture/adr/0004-zero-api-tdd-evaluation-and-stdio-mcp.md).

### Fixed
- **Cross-Platform Windows/Linux CLI Direct Invocation (`src/cli.ts`):**
  - Fixed `isDirectCliInvocation()` in [`src/cli.ts`](./src/cli.ts) using `pathToFileURL` and `fs.realpathSync` so `node dist/cli.js` and `npx skillops` execute reliably across Windows, macOS, and Linux.

---

## [0.5.0] - 2026-10-30

### Added
- **Complete `npx skillops@latest` CLI, Deterministic TDD Eval Runner & Stdio MCP Server (`Sprint 4 / Issue #62`):**
  - Added [`src/eval/index.ts`](./src/eval/index.ts) implementing `evaluateSkillDirectory`, `evaluateCatalog`, and `formatEvalSummary` (`table`, `json`, `markdown`, `html`) enforcing `INV-SKILL-05` (`with_skill` vs `without_skill` pass-rate lift and token reduction).
  - Added [`src/mcp/index.ts`](./src/mcp/index.ts) and [`src/mcp/server.ts`](./src/mcp/server.ts) implementing a native JSON-RPC 2.0 `stdio` Model Context Protocol server exposing `audit_catalog`, `analyze_repo_tokens`, `route_repo_skills`, `run_skill_script`, `get_skill_benchmark`, and `list_catalog_items` with zero stdout pollution.
  - Completed [`src/cli.ts`](./src/cli.ts) (`init`, `list`, `add`, `tokens`, `audit`, `route`, `sync`, `eval`, `mcp`), added [`tests/cli_eval_mcp.test.ts`](./tests/cli_eval_mcp.test.ts), and unified [`.github/workflows/ai-ci.yml`](./.github/workflows/ai-ci.yml) on the Node.js 20 & 22 NPX QA matrix.
- **NPX Context-Aware Router & Multi-Runtime Skill/Subagent Transpiler (`Sprint 4 / Issue #61`):**
  - Added [`src/router/fingerprinter.ts`](./src/router/fingerprinter.ts), [`src/router/bundle_compiler.ts`](./src/router/bundle_compiler.ts), and [`src/router/index.ts`](./src/router/index.ts) implementing deterministic `RepoFingerprinter`, `compileSkillBundle`, and `routeRepository` (`<= 12` skills, `<= 1,500` L1 tokens, `< 0.78` cosine similarity + matched Subagents).
  - Added [`src/sync/adapters.ts`](./src/sync/adapters.ts) and [`src/sync/index.ts`](./src/sync/index.ts) implementing `syncRepository`, `addSkillOrSubagent`, and `renderCodexAgentsIndex` across **Claude Code**, **Antigravity / Gemini CLI**, **Cursor**, **OpenAI Codex CLI**, and **GitHub Copilot** for both **Skills** and **Subagents**, backed by `.skillops-lock.json` SHA-256 drift protection.
  - Wired `route`, `sync`, and `add` commands in [`src/cli.ts`](./src/cli.ts) and added [`tests/router_sync.test.ts`](./tests/router_sync.test.ts).
- **Repository Token Economy & Startup Context Tax Analyzer (`Sprint 4 / Issue #60`):**
  - Added [`src/auditor/token_economy.ts`](./src/auditor/token_economy.ts) implementing `analyzeRepoTokenEconomy` and `formatTokenEconomyReport` (`table`, `json`, `markdown`) to audit always-on Startup Token Tax (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/*.mdc`, `.mcp.json`) and quantify Progressive Disclosure + Context-Isolated Subagent savings (`>= 75%` token reduction).
  - Wired `npx skillops@latest tokens` in [`src/cli.ts`](./src/cli.ts) and added [`tests/token_economy.test.ts`](./tests/token_economy.test.ts).
- **Node.js 20+ / TypeScript NPX Package Architecture, Zod Contracts (Skills + Subagents) & Zero-API Collision/Budget Auditor (`Sprint 4 / Issue #59`):**
  - Added [`package.json`](./package.json), [`tsconfig.json`](./tsconfig.json), [`tsup.config.ts`](./tsup.config.ts), and [`vitest.config.ts`](./vitest.config.ts) configuring the **`npx skillops@latest`** binary (`dist/cli.js`) and ESM library (`dist/index.js`) with strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`) and zero external API dependencies (`zod` + `yaml`).
  - Added [`src/models.ts`](./src/models.ts), [`src/auditor/parser.ts`](./src/auditor/parser.ts), [`src/auditor/token_budget.ts`](./src/auditor/token_budget.ts), [`src/auditor/collision.ts`](./src/auditor/collision.ts), [`src/auditor/index.ts`](./src/auditor/index.ts), [`src/index.ts`](./src/index.ts), and [`tests/npx_core.test.ts`](./tests/npx_core.test.ts).
- **Initial Reference Hybrid Executable Skills (`catalog/`):**
  - Added [`catalog/ai-engineering/mcp-architect/SKILL.md`](./catalog/ai-engineering/mcp-architect/SKILL.md), [`catalog/python-backend/fastapi-production/SKILL.md`](./catalog/python-backend/fastapi-production/SKILL.md), [`catalog/python-backend/postgres-query-doctor/SKILL.md`](./catalog/python-backend/postgres-query-doctor/SKILL.md), and [`catalog/arch-quality/ast-blast-radius/SKILL.md`](./catalog/arch-quality/ast-blast-radius/SKILL.md).
