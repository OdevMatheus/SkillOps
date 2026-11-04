# Contributing to SkillOps

Thank you for contributing to **SkillOps** (`npx skillops-cli@latest`)! Because SkillOps is an **AI-Agent-first** open-source platform powered by a **Zero-API Node.js 20+ / TypeScript engine** and **deterministic Python 3.12+ catalog scripts**, these guidelines apply equally to **human contributors** and **all 28 supported AI coding agents** (`cursor`, `claude`, `copilot`, `antigravity`, `windsurf`, `codex`, `gemini`, `cline`, `roocode`, `kilocode`, `zed`, `continue`, `aider`, `kiro`, `trae`, `augment`, `factory`, `qwen`, `opencode`, `openhands`, `amp`, `goose`, `warp`, `crush`, `vibe`, `junie`, `amazonq`, `idx`).

---

## 1. Mandatory Pre-Flight Protocol

Before writing code, modifying documentation, or opening an Issue/Pull Request, read:

1. [`AGENTS.md`](./AGENTS.md) — The canonical architecture and development governance contract.
2. [`SKILL_CONTRACT.md`](./SKILL_CONTRACT.md) — The normative specification for Hybrid Executable Skills, Context-Isolated Subagents, 3-level token budgets, semantic collision audits, and TDD evaluations.
3. [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) — Repository-wide coding and sanitization rules.
4. [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md) — Required structure for all Pull Requests.

---

## 2. Quick Contributor Setup

**Prerequisites:**
- **Node.js `>= 20.0.0`** (Node `22` recommended; run `nvm use` to read [`.nvmrc`](./.nvmrc))
- **Python `>= 3.12`** (standard library only — used for Level 3 deterministic `scripts/*.py` tools)

```bash
git clone https://github.com/OdevMatheus/SkillOps.git
cd SkillOps
npm ci
npm run build
npx skillops-cli@latest doctor
```

---

## 3. 5-Minute Cookbook: Authoring a New Hybrid Executable Skill

Every skill in `catalog/<track>/<skill-slug>/` must satisfy [`SKILL_CONTRACT.md`](./SKILL_CONTRACT.md) (`INV-SKILL-01` through `INV-SKILL-05`):

1. **Create the skill directory** under one of the tracks (`ai-engineering`, `python-backend`, or `arch-quality`):
   ```text
   catalog/<track>/<skill-slug>/
   ├── SKILL.md                  # Level 1 YAML frontmatter (40-110 words) + Level 2 body (<= 250 lines)
   ├── scripts/
   │   └── <tool_name>.py        # Level 3 zero-dependency Python 3.12+ CLI accepting --path and --json
   └── evals/
       ├── evals.json            # Deterministic with_skill vs without_skill evaluation cases
       └── benchmark.json        # Comparative pass-rate lift (>= +15%) and token delta metrics
   ```
2. **Validate progressive disclosure budgets & pairwise semantic orthogonality (`cosine < 0.72`):**
   ```bash
   npx skillops-cli@latest audit --catalog catalog --strict --require-layout
   ```
3. **Run deterministic `with_skill` vs. `without_skill` TDD evaluations:**
   ```bash
   npx skillops-cli@latest eval --catalog catalog --strict
   ```
4. **Verify transpilability across all 28 AI coding agents (dry-run):**
   ```bash
   npx skillops-cli@latest add --all --targets all --dry-run
   ```

---

## 4. Branching, Verification & Commit Strategy

### 4.1 Branch Protection & Naming (`1 Issue = 1 Branch = 1 PR`)
- **Never commit or push directly to `master`.**
- Create a descriptive branch from `master`:
  - `feat/<short-slug>` — New NPX CLI commands, engine modules (`src/`), hybrid executable skills, or subagents (`catalog/`)
  - `fix/<short-slug>` — Bug fixes, schema fixes, or false-positive corrections
  - `docs/<short-slug>` — Documentation, ADRs, and governance updates
  - `chore/<short-slug>` / `ci/<short-slug>` — Repository tooling, CI/CD, or `.github/` maintenance
  - `refactor/<short-slug>` — Structural refactoring without behavior changes
  - `test/<short-slug>` — Vitest unit, contract, or TDD benchmark evaluation suites

### 4.2 Local Verification Suite
Run all verification gates before opening a PR:
```bash
npm run lint
npm run typecheck
npm test
npm run build
node dist/cli.js audit --catalog catalog --strict --require-layout
node dist/cli.js tokens --strict
node dist/cli.js eval --catalog catalog --strict
```

### 4.3 Conventional Commits (`en-US`)
All tracked repository files, code comments, commit messages, and Pull Request titles **must** be written in English (`en-US`) and follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat(mcp): add universal 'skillops mcp-setup' across 13 MCP IDEs/agents (#114)`
- `feat(catalog): add new hybrid executable skill and AST scanner script`
- `docs(oss): add SUPPORT.md, CITATION.cff, and skill authoring cookbook (#120)`

---

## 5. Pull Request Workflow via GitHub CLI (`gh`)

All Pull Requests should reference their corresponding Issue (`Closes #<id>`) and apply official repository labels:

```bash
gh pr create \
  --base master \
  --head <type>/<short-slug> \
  --title "<type>(<scope>): <description> (#<issue>)" \
  --body-file <filled-pull-request-template.md>
```

### Official Repository Labels
- **Scope:** `🔴 core-architecture`, `🐍 core-engine`, `🧠 skill-catalog`, `🧪 eval-benchmark`, `🔄 multi-runtime`, `🔌 mcp-server`, `⚠️ agent-behavior`, `📄 docs`, `⚙️ ci`
- **Type:** `✨ feat`, `🐛 fix`, `♻️ refactor`, `🔒 security`
- **Lifecycle:** `🗺️ roadmap`, `🚧 work-in-progress`, `📌 pinned`

---

## 6. Privacy, Security & Sanitization Checklist

Every contribution is automatically audited by [`.github/workflows/pr-governance.yml`](./.github/workflows/pr-governance.yml), [`.github/workflows/ai-ci.yml`](./.github/workflows/ai-ci.yml), and [`.github/workflows/codeql.yml`](./.github/workflows/codeql.yml):
1. **No Absolute Machine Paths:** Never include `C:\Users\...`, `/Users/...`, or `/home/...` in any tracked file. Always use relative paths (`./...`).
2. **No Environment or Corporate Metadata:** Never expose OS usernames, internal domains, or non-public references.
3. **No Secrets or AI API Keys:** Never commit `.env` files, AI provider keys (`sk-proj-...`, `sk-ant-...`, `AIzaSy...`, `hf_...`), or private tokens.
4. **Line Endings & Strict Typing:** Respect [`.gitattributes`](./.gitattributes) and [`.editorconfig`](./.editorconfig) (`UTF-8` encoding and `LF` line endings) and strict TypeScript (`npm run typecheck`).
