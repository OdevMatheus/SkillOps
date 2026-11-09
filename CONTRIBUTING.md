# Contributing to SkillOps

Thank you for contributing to **SkillOps** (`npx skillops-cli@latest`)! These guidelines apply to both **human contributors** and **AI coding agents**.

---

## 1. Two-Track Contribution Policy (When Do You Need an Issue?)

To keep the **Skills & Subagents library** easy to grow while protecting the **Core CLI** from feature creep, SkillOps uses a two-track contribution workflow:

| Contribution Track | Scope | Issue Required Before PR? | PR Title Example |
| :--- | :--- | :---: | :--- |
| **Track A — Library (`catalog/`)** | Adding or improving **Skills (`SKILL.md`)** and **Subagents (`SUBAGENT.md`)** | **No (Direct PR allowed)** | `feat(catalog): add fastapi-async-profiler skill` |
| **Track B — Core Solution (`src/`, `.github/`, `docs/`)** | CLI commands, Lip Gloss TUI, 28-IDE transpiler, schemas, dependencies, or CI/CD | **Yes (Mandatory Issue first)** | `fix(sync): preserve cursor frontmatter globs (#162)` |

> **Why this policy?**
> - **Catalog additions (`catalog/`)** are self-contained and automatically validated by CI against [`SKILL_CONTRACT.md`](./SKILL_CONTRACT.md), so you can open a PR right away without waiting on Issue triage.
> - **Core solution changes (`src/`)** affect the CLI architecture and all 28 runtime adapters. Opening an Issue first ensures your proposal aligns with the lean MVP scope (`add` / `remove`) before you invest time writing code.

---

## 2. Quick Local Setup

**Prerequisites:**
- **Node.js `>= 20.0.0`** (Node `22` recommended; see [`.nvmrc`](./.nvmrc))
- **Python `>= 3.12`** (standard library only — used for Level 3 deterministic `scripts/*.py` bundled inside Skills)

```bash
git clone https://github.com/OdevMatheus/SkillOps.git
cd SkillOps
npm ci
npm run build
npm test
```

---

## 3. Track A: Contributing a New Skill or Subagent (No Issue Needed)

Every item in [`catalog/`](./catalog) must comply with [`SKILL_CONTRACT.md`](./SKILL_CONTRACT.md) (`INV-SKILL-01` through `INV-SKILL-04`):

### 3.1 Adding a Hybrid Skill (`SKILL.md`)
1. Create a folder under `catalog/<track>/<skill-slug>/` (e.g., `ai-engineering`, `python-backend`, `arch-quality`):
   ```text
   catalog/<track>/<skill-slug>/
   ├── SKILL.md                  # Level 1 YAML frontmatter + Level 2 instructions (<= 250 lines)
   ├── scripts/                  # Level 3 zero-dependency deterministic script(s)
   │   └── <tool_name>.py
   └── references/               # Optional deep reference docs loaded on demand
   ```
2. **Contract checklist for `SKILL.md`:**
   - `description` must start with `"Use when..."` and contain **`40–110` words** (`<= 160` tokens), including explicit `Do not trigger for...` negative triggers.
   - Markdown body must stay **`<= 250` lines** (`<= 1,800` tokens).

### 3.2 Adding a Context-Isolated Subagent (`SUBAGENT.md`)
1. Create a folder under `catalog/subagents/<subagent-slug>/`:
   ```text
   catalog/subagents/<subagent-slug>/
   └── SUBAGENT.md               # Scoped specialist persona + explicit tool permissions
   ```
2. **Contract checklist for `SUBAGENT.md`:**
   - `description` must start with `"Use when..."`.
   - `tools` must list explicit least-privilege tools (e.g., `["read", "search"]`) — **wildcard `["*"]` is strictly forbidden (`INV-SKILL-04`)**.
   - `max-output-tokens` must be **`<= 400` tokens**.

### 3.3 Test Your Skill or Subagent Locally
Verify that your new catalog entry parses cleanly and transpiles across all 28 supported AI IDEs and CLIs:

```bash
npm run build
node dist/cli.js add <your-skill-or-subagent-name> --targets all --dry-run
npm test
```

---

## 4. Track B: Contributing to the Core Solution (Issue Required First)

If you want to fix a bug, improve the TUI design, update a runtime adapter in `src/sync/`, or propose an architectural change:

1. **Open a GitHub Issue first** describing the problem, motivation, and proposed change.
2. **Create a branch from `main`** following the required naming pattern (`1 Issue = 1 Branch = 1 PR` for core changes).
3. **Run the full verification suite locally:**
   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```
4. **Link the Issue in your Pull Request description** using `Closes #<issue-number>`.

---

## 5. Branch Naming, Commits & PR Governance

All Pull Requests are automatically checked by [`.github/workflows/pr-governance.yml`](./.github/workflows/pr-governance.yml) and [`.github/workflows/ai-ci.yml`](./.github/workflows/ai-ci.yml):

1. **Branch Naming (`<type>/<short-kebab-description>`):**
   - `feat/<short-slug>` — New catalog Skills/Subagents or approved core features
   - `fix/<short-slug>` — Bug fixes or adapter corrections
   - `docs/<short-slug>` — Documentation updates
   - `refactor/<short-slug>` / `test/<short-slug>` / `ci/<short-slug>` / `chore/<short-slug>`
2. **PR Title & Commits (Lowercase Conventional Commits in `en-US`):**
   - All tracked files, code comments, commit messages, and PR titles must be in **English (`en-US`)** and start with a lowercase imperative description after the prefix:
   - ✅ `feat(catalog): add postgres-query-plan-auditor skill` *(Track A — no issue required)*
   - ✅ `fix(ui): align multi-select footer pill width (#165)` *(Track B — linked to issue)*
3. **Privacy, Security & Sanitization:**
   - **No Absolute Machine Paths:** Never commit `C:\Users\...`, `/Users/...`, or `/home/...` in any tracked file. Use relative paths (`./...`).
   - **No Environment or Corporate Metadata:** Never expose OS usernames, local hostnames, or private domains.
   - **No Secrets or API Keys:** Never commit `.env` files or AI provider keys (`sk-proj-...`, `sk-ant-...`, `AIzaSy...`, `hf_...`).
