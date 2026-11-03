# Changelog

All notable changes to **SkillOps** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.3.0] - 2026-11-03

### Added
- **Zero-Dependency ANSI TUI Aesthetic Engine (`Sprint 9 / Issue #125`):**
  - Added [`src/ui/terminal.ts`](./src/ui/terminal.ts) providing zero-dependency ANSI color/style helpers (respecting `NO_COLOR`, `FORCE_COLOR`, and TTY detection), Unicode rounded box panels (`renderBox`), official SkillOps Framework & Library header banners (`renderHeaderBanner`), ANSI-aware aligned tables (`renderTable`), visual token budget progress bars (`renderTokenBar` / `renderProgressBar`), semantic status/type badges (`formatBadge`), guided next-step footers (`renderNextSteps`), and how-to-use-in-your-AI cards (`renderHowToUseInAi`).
- **Library Explorer, 1-Step Quickstart & Framework Scaffolder (`Sprint 9 / Issue #126`):**
  - Added [`src/framework/index.ts`](./src/framework/index.ts) implementing:
    - `npx skillops-cli quickstart` (alias `setup`): 1-command onboarding wizard that detects repository stack + active AI harnesses, routes and installs the optimal collision-free Skill + Subagent bundle, registers the local MCP server across detected IDEs, and prints an interactive guide on how to invoke each installed artifact.
    - `npx skillops-cli info <name>` (aliases `show`, `inspect`): Detailed TUI inspection card for any Skill or Context-Isolated Subagent with L1/L2 token metrics, Level 3 scripts, TDD benchmark lift, and exact invocation instructions for Claude Code, Cursor, Antigravity, Codex, Windsurf, Copilot, etc.
    - `npx skillops-cli search <query>` (alias `find`): Keyword, tag, track, and trigger phrase search across all Hybrid Skills and Context-Isolated Subagents (`--type skill|subagent`).
    - `npx skillops-cli create <skill|subagent> <name>` (alias `new`): 1-command Framework Scaffolder that generates a complete contract-compliant custom Skill (`SKILL.md` meeting `INV-SKILL-01..04`, executable `scripts/<name>_check.py --json`, and `evals/evals.json`) or Context-Isolated Subagent (`SUBAGENT.md` with `max_output_tokens: 400`).
  - Added intuitive command and flag aliases across [`src/cli.ts`](./src/cli.ts): `install` / `i` (`add`), `uninstall` / `rm` (`remove`), `recommend` (`route`), `budget` (`tokens`), `--project` / `-p` (`--repo`), and `--harness` / `-t` (`--targets`).
- **3-Pillar Framework/Library Help System, Per-Command `--help`, Fuzzy Typo Suggestions & Interactive Reports (`Sprint 9 / Issue #127`):**
  - Added [`src/ui/help.ts`](./src/ui/help.ts) organizing `npx skillops-cli --help` around SkillOps's 3 core pillars (**1. Library of High-End Skills & Subagents**, **2. Framework for Building Custom Skills & Subagents**, **3. Universal Runtime Sync, Token Economy & Diagnostics**) and adding per-command help (`npx skillops-cli <cmd> --help` / `npx skillops-cli help <cmd>`).
  - Added Levenshtein fuzzy command suggestion (`Did you mean 'install'?`) on unknown CLI commands, visual token budget progress bars on `list`, `route`/`recommend`, and `tokens`/`budget`, and an interactive **"Using Your Skills & Subagents"** guide on `sync`/`add`/`install`.

---

## [1.2.1] - 2026-11-03

### Added
- **Open-Source Community Health, Academic Citation & Contributor DX Standards (`Sprint 8 / Issue #120`):**
  - Added [`.github/SUPPORT.md`](./.github/SUPPORT.md), [`CITATION.cff`](./CITATION.cff) (enabling GitHub's native *Cite this repository* BibTeX/APA button), [`.editorconfig`](./.editorconfig), and [`.nvmrc`](./.nvmrc) (`22`).
  - Upgraded [`CONTRIBUTING.md`](./CONTRIBUTING.md) for external open-source contributors with a **5-Minute Hybrid Executable Skill Authoring Cookbook**.
- **GitHub CodeQL SAST Security Workflow & OpenSSF Security Policy (`Sprint 8 / Issue #121`):**
  - Added [`.github/workflows/codeql.yml`](./.github/workflows/codeql.yml) performing automated static security analysis (`javascript-typescript` and `python`) on pushes to `master`, Pull Requests, and weekly schedules.
  - Updated [`.github/SECURITY.md`](./.github/SECURITY.md) with the OpenSSF `Supported Versions` matrix and 48-hour disclosure SLA.

---

## [1.2.0] - 2026-11-03

### Added
- **Universal MCP Server Registration (`npx skillops-cli@latest mcp-setup`) & `v1.2.0` Release (`Sprint 7 / Issue #114`):**
  - Added `setupMcpForHarnesses` and `formatMcpSetupReport` (`table`, `json`, `markdown`) in [`src/mcp/index.ts`](./src/mcp/index.ts) and wired `npx skillops-cli@latest mcp-setup` (`--targets all|auto|core|<list>`, `--dry-run`) in [`src/cli.ts`](./src/cli.ts) to idempotently register the `skillops` stdio MCP server across all 13 MCP-capable IDEs and CLI agents (`.mcp.json`, `.gemini/settings.json`, `.cursor/mcp.json`, `.codex/config.toml`, `.vscode/mcp.json`, `.roo/mcp.json`, `.kilocode/mcp.json`, `.zed/settings.json`, `.continue/mcpServers/skillops.yaml`, `.amp/settings.json`, `opencode.json`, `.kiro/settings/mcp.json`, `.amazonq/mcp.json`).
  - Added the `list_supported_harnesses` tool to the JSON-RPC 2.0 `stdio` MCP server in [`src/mcp/index.ts`](./src/mcp/index.ts) and bumped `SKILLOPS_VERSION` / `package.json` to `1.2.0`.
- **Top-20 Startup Token Tax Analyzer, Doctor Harness Detection & `npx skillops-cli@latest harnesses` (`Sprint 7 / Issue #113`):**
  - Expanded [`src/auditor/token_economy.ts`](./src/auditor/token_economy.ts) to inspect 22 always-on instruction files across all 20 AI coding agents (`.windsurfrules`, `.clinerules`, `.roorules`, `.kilocoderules`, `.rules`, `CONVENTIONS.md`, `.goosehints`, `.junie/guidelines.md`, `.windsurf/rules/*.md` with `trigger: always_on`, etc.) and 13 MCP configuration formats (JSON, `.codex/config.toml`, `.continue/mcpServers/*.yaml`, `.zed/settings.json`, `opencode.json`).
  - Added `detected_harnesses` to `DoctorReport`, implemented `inspectHarnesses` and `formatHarnessInspectionReport` in [`src/auditor/doctor.ts`](./src/auditor/doctor.ts), and wired `npx skillops-cli@latest harnesses` (`--format table|json|markdown`).
- **Native Multi-Harness Transpilers Across `sync`, `add`, `remove`, and `clean` for All 20 AI Agents (`Sprint 7 / Issue #112`):**
  - Expanded [`src/sync/adapters.ts`](./src/sync/adapters.ts) to transpile Hybrid Executable Skills (`SKILL.md` + `scripts/*.py`) and Context-Isolated Subagents into the native progressive-disclosure or scoped rule formats of all 20 AI coding agents (Windsurf `trigger: model_decision`, Cline/Roo/Kilo/Continue/Trae/AmazonQ `globs`, Kiro `inclusion: fileMatch`, OpenHands `triggers`, and managed index blocks in `AGENTS.md`, `CONVENTIONS.md`, `.rules`, `.goosehints`, and `.junie/guidelines.md`).
  - Added `--targets all|auto|core|<comma-separated>` resolution in [`src/cli.ts`](./src/cli.ts) and generalized `stripSkillOpsManagedBlock` for clean uninstalls across all 5 index-file harnesses.
- **Universal Top-20 `RuntimeTarget` Registry & Auto-Detection Matrix (`Sprint 7 / Issue #111`):**
  - Expanded `RuntimeTargetSchema` in [`src/models.ts`](./src/models.ts) from 5 to 20 AI coding agents (`claude`, `antigravity`, `cursor`, `codex`, `copilot`, `windsurf`, `cline`, `roocode`, `kilocode`, `zed`, `continue`, `aider`, `openhands`, `amp`, `opencode`, `goose`, `kiro`, `trae`, `junie`, `amazonq`) and added `RUNTIME_HARNESS_SPECS`, `detectInstalledHarnesses(repoPath)`, and `resolveTargetRuntimes(spec, repoPath)`.

---

## [1.1.0] - 2026-11-03

### Added
- **GitHub Actions Native Annotations (`--format github`) & Composite Action Summary (`Sprint 6 / Issue #105`):**
  - Added `--format github` output mode to `audit`, `tokens`, `eval`, `doctor`, and `status` in [`src/cli.ts`](./src/cli.ts), [`src/auditor/token_economy.ts`](./src/auditor/token_economy.ts), [`src/eval/index.ts`](./src/eval/index.ts), and [`src/auditor/doctor.ts`](./src/auditor/doctor.ts), emitting native `::error`, `::warning`, and `::notice` workflow commands.
  - Upgraded [`.github/actions/skillops-audit/action.yml`](./.github/actions/skillops-audit/action.yml) and [`.github/workflows/ai-ci.yml`](./.github/workflows/ai-ci.yml) with `tokens-check`, `step-summary`, and automatic Markdown reporting into `$GITHUB_STEP_SUMMARY`.
- **Environment Diagnostics & Lockfile Drift Auditor (`npx skillops-cli@latest doctor` & `status` — `Sprint 6 / Issue #104`):**
  - Added [`src/auditor/doctor.ts`](./src/auditor/doctor.ts) implementing `diagnoseRepository` and `formatDoctorReport` (`table`, `json`, `markdown`, `github`) to audit Node.js (`>= 20.0.0`), Python (`>= 3.12`), `.skillops.yml` schema validity, `.skillops-lock.json` SHA-256 artifact integrity (`healthy`, `drifted`, `missing`), and Startup Token Tax.
  - Exposed the `diagnose_repo` tool on the native JSON-RPC 2.0 `stdio` MCP server in [`src/mcp/index.ts`](./src/mcp/index.ts).
- **Multi-Runtime Lifecycle Uninstall & Clean Commands (`npx skillops-cli@latest remove` & `clean` — `Sprint 6 / Issue #103`):**
  - Added `removeSkillOrSubagent`, `cleanSyncedArtifacts`, and `stripCodexAgentsBlock` in [`src/sync/adapters.ts`](./src/sync/adapters.ts) with SHA-256 local drift protection, `--dry-run`, and `--force` flags.
- **Declarative `.skillops.yml` Auto-Loader & Validator (`Sprint 6 / Issue #102`):**
  - Added `SkillOpsConfigSchema` and `loadSkillOpsConfig(repoPath)` in [`src/models.ts`](./src/models.ts) and wired automatic configuration loading across `list`, `audit`, `tokens`, `route`, `sync`, `add`, `remove`, `clean`, and `doctor` in [`src/cli.ts`](./src/cli.ts) with strict precedence (`CLI Flags > .skillops.yml > Default Invariants`).

---

## [1.0.0] - 2026-10-30

### Added
- **Official NPM Package Configuration (`skillops-cli`) & Automated NPM Publish Workflow (`Sprint 5 / Issue #67`):**
  - Configured [`package.json`](./package.json) as `skillops-cli` (`v1.0.0`) exposing both `skillops-cli` and `skillops` binaries (`npx skillops-cli@latest <command>`), and added [`.github/workflows/npm-publish.yml`](./.github/workflows/npm-publish.yml) with NPM Provenance (`--provenance`).
  - Published [`docs/BENCHMARKS.md`](./docs/BENCHMARKS.md) documenting the `v1.0.0` Token Economy & Deterministic TDD Benchmark Showcase (`95.53%` Startup Token Tax reduction, `10/10 CERTIFIED_IMPROVEMENT` skills, `+39.1%` mean pass-rate lift, `-51.05%` mean task token reduction, `max pairwise cosine = 0.0661 < 0.58`).
- **Track 2 & Track 3 Surgical Engineering & Security Skills (`Sprint 5 / Issue #66`):**
  - Added [`catalog/python-backend/concurrency-race-detector/SKILL.md`](./catalog/python-backend/concurrency-race-detector/SKILL.md) (`scripts/event_loop_blocking_scanner.py`), [`catalog/arch-quality/bug-reproducer-tdd/SKILL.md`](./catalog/arch-quality/bug-reproducer-tdd/SKILL.md) (`scripts/repro_harness_check.py`), and [`catalog/arch-quality/security-sast-gate/SKILL.md`](./catalog/arch-quality/security-sast-gate/SKILL.md) (`scripts/owasp_ast_scanner.py`) with `evals/evals.json` and `evals/benchmark.json`.
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
