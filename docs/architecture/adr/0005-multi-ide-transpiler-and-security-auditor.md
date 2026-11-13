# ADR-0005: 28-IDE Manifest Transpiler, SHA-256 Lockfile & Supply-Chain Security Auditor (`v1.5.2`)

## Status
Accepted (`v1.5.2` — Supersedes [`ADR-0002`](./0002-semantic-collision-auditor-and-token-budgeting.md), [`ADR-0003`](./0003-context-aware-dynamic-router-and-multi-runtime-sync.md), and [`ADR-0004`](./0004-zero-api-tdd-evaluation-and-stdio-mcp.md); extends [`ADR-0001`](./0001-hybrid-executable-skills-architecture.md))

## Context
Between `v0.5.0` and `v1.2.x`, SkillOps bundled experimental repository stack-routing, TF-IDF collision matrices, subprocess evaluation runners, and a local `stdio` MCP server while targeting only 5 to 20 harnesses. Real-world usage and security modeling revealed three clear priorities:
1. **Universal Multi-Assistant Coverage without Runtime Bloat:** Engineering teams work simultaneously across 28 AI IDEs, CLI coding agents, IDE extensions, and autonomous SWE harnesses, and want an instant `npx skillops-cli@latest` experience (`yaml` + `zod` only) where installed IDE folders are detected deterministically and toggled interactively.
2. **Supply-Chain & Workspace Boundary Safety (`INV-SKILL-06`):** Installing third-party `SKILL.md` playbooks, `SUBAGENT.md` personas, and companion scripts into developer workspaces requires strict static scanning against Trojan-Source Unicode, outbound network exfiltration, dynamic code execution, symlink traversal, ReDoS backtracking, and prototype-polluting lockfile payloads.
3. **Non-Destructive Local Customization:** Developers frequently tailor transpiled rule files locally; updates and removals must never silently clobber hand-edited rules.

## Decision
We consolidate the `skillops-cli` (`v1.5.2`) engine around four cohesive subsystems governed by [`SKILL_CONTRACT.md`](../../../SKILL_CONTRACT.md):

1. **Normative Zod v3 Domain & Evaluation Schemas (`src/models.ts`):**
   - Enforces progressive-disclosure word/line/token caps (`SkillManifestSchema`, `SubagentManifestSchema`), 28 `RUNTIME_HARNESS_SPECS`, linear-time path normalization (`trimTrailingSlashes`), prototype-safe lockfile records (`SyncLockfileSchema` + `SafeLockRelativePathSchema`), and canonical JSON schemas for companion scripts and TDD benchmarks (`ScriptOutputSchema`, `EvalSuiteSchema`, `BenchmarkReportSchema`) plus `ExitCode.SECURITY_BOUNDARY_ERROR = 5`.
2. **Deterministic 28-IDE Transpiler & SHA-256 Drift Lockfile (`src/sync/adapters.ts`):**
   - Compiles canonical `SKILL.md` (with bundled Level 3 `scripts/`, `references/`, `evals/`, and rewritten relative paths) and `SUBAGENT.md` manifests into native formats across all 28 `ALL_RUNTIME_TARGETS` (including `.mdc` rules for Cursor, `.instructions.md` / `.prompt.md` / `.agent.md` for GitHub Copilot, `.codex/skills` + `.codex/agents` + bounded `AGENTS.md` markers for OpenAI Codex, steering docs for Kiro, and microagents for OpenHands).
   - Tracks SHA-256 digests in `.skillops-lock.json` so `add`, `update`, and `remove` preserve locally modified files unless `--force` is explicitly supplied, while confining all writes/deletes via `resolveSafeRepoTargetPath`.
3. **Supply-Chain Security Auditor (`src/auditor/security.ts` & `src/auditor/parser.ts`):**
   - Statically blocks outbound network imports, unsafe shell/dynamic execution, symlinks, opaque binaries, and CVE-2021-42574 Trojan/invisible Unicode across all catalog skills and subagents.
4. **Focused CLI & Charmbracelet Lip Gloss TUI (`src/cli.ts` & `src/ui/`):**
   - Provides a streamlined subcommand surface (`add`, `status`, `update`, `remove`, `audit`) backed by zero-dependency TrueColor terminal rendering and keyboard multi-select prompts.

## Consequences
- **Instant Zero-API Execution:** `npx skillops-cli@latest` installs in milliseconds with only two runtime dependencies (`yaml`, `zod`) and zero cloud/API keys.
- **End-to-End Ecosystem Consistency:** Canonical catalog tracks, CLI flags (`--targets`), transpiled preview paths, and Zod schemas stay aligned across `SkillOps` and the companion `SkillOps-Web` registry.
