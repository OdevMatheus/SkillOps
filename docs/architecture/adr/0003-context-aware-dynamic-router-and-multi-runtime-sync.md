# ADR-0003: Context-Aware Dynamic Router and Multi-Runtime Sync (`npx skillops route` & `npx skillops sync`)

## Status
Accepted (Updated for `npx skillops@latest` Node.js 20+ / TypeScript Architecture)

## Context
Loading an entire skill catalog into every repository causes **Implicit Routing Collapse** (`arXiv:2610.18522`) and wastes Level 1 system-prompt tokens. Furthermore, engineering teams operate across 5 heterogeneous AI coding harnesses (**Claude Code**, **Antigravity / Gemini CLI**, **Cursor**, **OpenAI Codex CLI**, and **GitHub Copilot**), each requiring distinct directory structures and frontmatter schemas for both Skills and Subagents.

## Decision
We implement a **Deterministic Stack Fingerprinter, Greedy Collision-Free Bundle Compiler, and Multi-Runtime Transpiler** in `src/router/` and `src/sync/`:

1. **Repository Stack Fingerprinting (`src/router/fingerprinter.ts`):**
   - Inspects manifest files (`package.json`, `tsconfig.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Dockerfile`, `.github/workflows/*.yml`) and tracked source files without executing untrusted code.
2. **Greedy Collision-Free Bundle Compilation (`src/router/bundle_compiler.ts`):**
   - Scores candidate Skills and Subagents against detected repository signals and selects an optimal bundle of `<= 12` active skills (`<= 1,500` L1 tokens) with zero pairwise collisions (`cosine < 0.72`).
3. **Multi-Runtime Transpiler & Drift Lockfile (`src/sync/adapters.ts`, `src/sync/index.ts`):**
   - Transpiles selected Skills and Subagents into native artifacts for Claude Code (`.claude/`), Antigravity (`.agent/`), Cursor (`.cursor/`), Codex (`.codex/`), and Copilot (`.github/`) and records SHA-256 checksums in `.skillops-lock.json`.

## Consequences
- Teams can run `npx skillops@latest sync` or `npx skillops@latest add <name>` to install verified Skills and Subagents across all 5 harnesses with zero manual copying or drift.
