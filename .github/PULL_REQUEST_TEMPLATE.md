## Summary

<!-- Briefly describe the purpose and context of this Pull Request in 1-3 sentences. -->

## Related Issue, Epic & Milestone

- **Atomic Issue:** <!-- e.g., Closes #45 -->
- **Sprint Epic:** <!-- e.g., Part of #43 -->
- **Milestone (Sprint):** <!-- e.g., v0.2.0 — Architecture Contracts & Python 3.12+ Core Foundation (Sprint 1) -->

## Changes

<!-- List the key additions, modifications, or removals introduced by this PR. -->
- 

## Scope & Type of Change

- [ ] `🐍 core-engine`: SkillOps Python 3.12+ Core Engine (`src/skillops/`, `pyproject.toml`)
- [ ] `🧠 skill-catalog`: Hybrid Executable Skill (`catalog/<track>/<skill>/`)
- [ ] `🧪 eval-benchmark`: TDD Evaluation Suite (`evals.json`, `benchmark.json`, OpenAI Agents SDK runner)
- [ ] `🔄 multi-runtime`: Context-Aware Repo Router & Multi-Runtime Sync (`Claude Code`, `Antigravity`, `Cursor`, `Codex`, `Copilot`)
- [ ] `🔌 mcp-server`: FastMCP Server or FastAPI Benchmark Viewer
- [ ] `🔴 core-architecture` / `⚠️ agent-behavior`: Architecture Contracts (`SKILL_CONTRACT.md`, ADRs, `AGENTS.md`, `.github/agents/`)
- [ ] `⚙️ ci` / `📄 docs`: CI/CD Pipelines, DevOps Governance, or Documentation

## AI Engineering & Governance Checklist

- [ ] **Branch & Semantic Title:** Branch follows `<type>/<short-kebab-description>` and PR title follows **Conventional Commits** in `en-US`.
- [ ] **Skill Contract (`SKILL_CONTRACT.md`):** Any modified/added skills respect Level 1 (`<= 90 tokens`) and Level 2 (`<= 250 lines`) budgets and semantic collision thresholds (`cosine < 0.78`).
- [ ] **Labels & Milestone Assigned:** Appropriate scope/type labels and Sprint Milestone are attached via `gh`.
- [ ] **Language & Mirror Sync:** Tracked files are strictly in `en-US` with `LF` line endings, and local `DOCS-DEV/` (`pt-BR`) mirror is synchronized and gitignored.
- [ ] **Security & Hygiene:** Zero hardcoded local OS paths, corporate references, or AI provider API keys (`OPENAI_API_KEY`, etc.).
