<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:6366f1,50:a855f7,100:06b6d4&height=190&section=header&text=SkillOps&fontSize=56&fontColor=ffffff&animation=fadeIn&fontAlignY=36&desc=Install+and+manage+AI+Skills+and+Subagents+across+28+coding+IDEs+and+CLIs&descAlignY=58&descSize=16" width="100%" alt="SkillOps" />

<p>
  <a href="https://github.com/OdevMatheus/SkillOps/actions/workflows/ai-ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/OdevMatheus/SkillOps/ai-ci.yml?branch=master&style=flat-square&logo=githubactions&logoColor=white&label=CI" alt="CI"></a>
  <a href="https://github.com/OdevMatheus/SkillOps/actions/workflows/codeql.yml"><img src="https://img.shields.io/github/actions/workflow/status/OdevMatheus/SkillOps/codeql.yml?branch=master&style=flat-square&logo=github&logoColor=white&label=CodeQL" alt="CodeQL"></a>
  <a href="https://www.npmjs.com/package/skillops-cli"><img src="https://img.shields.io/badge/npm-v1.3.10-dafa9c?style=flat-square&logo=npm&logoColor=0f0f0f&labelColor=0f0f0f" alt="npm version"></a>
  <a href="#supported-ai-ides--clis-28"><img src="https://img.shields.io/badge/AI%20IDEs%20%26%20CLIs-28-a855f7?style=flat-square" alt="28 AI IDEs & CLIs"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-04B575?style=flat-square" alt="License: MIT"></a>
</p>

<p>
  <strong>One library of Skills (<code>SKILL.md</code>) and Subagents (<code>SUBAGENT.md</code>). Native installation for 28 AI tools.</strong><br>
  Cursor, Claude Code, GitHub Copilot, Antigravity, Windsurf, Codex, Gemini CLI, Cline, Roo Code, Kiro, and more — 100% local, zero API keys.
</p>

</div>

---

## Quick Start

Run inside any project repository:

```bash
npx skillops-cli@latest add
```

Or install globally to use the `skillops` command anywhere:

```bash
npm i -g skillops-cli
skillops add
```

### Interactive 2-Step TUI Flow

| 1. Select Your AI IDE / Agent | 2. Select Skills & Subagents |
| :---: | :---: |
| <img src="./docs/assets/step-1-select-ide.png" alt="Step 1: Select AI IDE or Agent" width="100%" /> | <img src="./docs/assets/step-2-select-skills.png" alt="Step 2: Select Skills & Subagents" width="100%" /> |

<div align="center">
  <p><strong>3. Native Transpilation &amp; Installation Report</strong></p>
  <img src="./docs/assets/step-3-install-success.png" alt="Step 3: Skills & Subagents Installed" width="78%" />
</div>

---

## Commands

| Command | Description |
| :--- | :--- |
| `skillops add` | Launch the interactive 2-step TUI (select AI IDEs → select Skills & Agents) |
| `skillops add <name...> -t cursor,claude` | Install specific Skills or Subagents directly into target AI IDEs |
| `skillops add --all -t all` | Install all catalog Skills & Subagents across all 28 supported AI tools |
| `skillops remove` | Launch interactive selector to uninstall Skills or Subagents from your project |
| `skillops remove <name...>` | Remove specific installed Skills or Subagents and update `.skillops-lock.json` |
| `skillops remove --all` | Surgically remove all SkillOps-managed files from the repository |

> **Aliases:** `install` / `i` for `add`, and `uninstall` / `rm` for `remove`. Pass `--dry-run` to preview changes or `--force` to overwrite local edits.

---

## How It Works

```mermaid
flowchart LR
    C["📦 Catalog\nSKILL.md + SUBAGENT.md"] --> CLI["◆ SkillOps CLI\nskillops add / remove"]
    CLI --> T1["Cursor (.cursor/rules/)"]
    CLI --> T2["Claude Code (.claude/)"]
    CLI --> T3["Copilot (.github/)"]
    CLI --> T4["Antigravity & Gemini (.agent / .gemini)"]
    CLI --> T5["+ 24 AI IDEs & CLIs"]
```

- **Native Transpilation:** Compiles each `SKILL.md` (plus Level 3 `scripts/` & `references/`) and `SUBAGENT.md` into the exact folder layout and frontmatter expected by each IDE or CLI.
- **3-Tier Token Economy:** Keeps context windows lean with **L1** YAML discovery (`≤ 60` tokens), **L2** core workflow (`≤ 1,800` tokens), and **L3** on-demand scripts (`0` idle tokens).
- **SHA-256 Drift Protection:** Tracks generated files in `.skillops-lock.json` so manual local edits are never overwritten or deleted without `--force`.

---

## Supported AI IDEs & CLIs (28)

<p>
  <img src="https://img.shields.io/badge/Cursor-000000?style=flat-square" alt="Cursor">
  <img src="https://img.shields.io/badge/Claude_Code-D97757?style=flat-square&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/GitHub_Copilot-000000?style=flat-square&logo=githubcopilot&logoColor=white" alt="GitHub Copilot">
  <img src="https://img.shields.io/badge/Antigravity_IDE-4285F4?style=flat-square&logo=google&logoColor=white" alt="Antigravity">
  <img src="https://img.shields.io/badge/Windsurf-09B6A2?style=flat-square" alt="Windsurf">
  <img src="https://img.shields.io/badge/OpenAI_Codex-412991?style=flat-square&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Gemini_CLI-8E75B2?style=flat-square&logo=googlegemini&logoColor=white" alt="Gemini CLI">
  <img src="https://img.shields.io/badge/Cline-1E293B?style=flat-square" alt="Cline">
  <img src="https://img.shields.io/badge/Roo_Code-4F46E5?style=flat-square" alt="Roo Code">
  <img src="https://img.shields.io/badge/Kilo_Code-0F172A?style=flat-square" alt="Kilo Code">
  <img src="https://img.shields.io/badge/Zed_AI-084CCF?style=flat-square" alt="Zed">
  <img src="https://img.shields.io/badge/Continue.dev-111827?style=flat-square" alt="Continue">
  <img src="https://img.shields.io/badge/Aider-16A34A?style=flat-square" alt="Aider">
  <img src="https://img.shields.io/badge/AWS_Kiro-FF9900?style=flat-square" alt="AWS Kiro">
</p>

<details>
<summary><b>View full list of 28 supported targets &amp; output paths</b></summary>

| # | Target ID | AI IDE / Agent | Skills Output Path | Subagents Output Path |
| :-: | :--- | :--- | :--- | :--- |
| 1 | `cursor` | **Cursor AI IDE** | `.cursor/rules/skillops-<name>.mdc` | `.cursor/rules/skillops-agent-<name>.mdc` |
| 2 | `claude` | **Anthropic Claude Code** | `.claude/skills/<name>/SKILL.md` | `.claude/agents/<name>.md` |
| 3 | `copilot` | **GitHub Copilot** | `.github/instructions/skillops-<name>.instructions.md` | `.github/agents/<name>.agent.md` |
| 4 | `antigravity` | **Google Antigravity IDE** | `.agent/skills/<name>/SKILL.md` | `.agent/agents/<name>.md` |
| 5 | `windsurf` | **Windsurf AI IDE** | `.windsurf/rules/skillops-<name>.md` | `.windsurf/workflows/skillops-agent-<name>.md` |
| 6 | `codex` | **OpenAI Codex CLI** | `.codex/skills/<name>/SKILL.md` + `AGENTS.md` | `.codex/agents/<name>.md` |
| 7 | `gemini` | **Google Gemini CLI** | `.gemini/skills/<name>/SKILL.md` | `.gemini/agents/<name>.md` |
| 8 | `cline` | **Cline** | `.clinerules/skillops-<name>.md` | `.clinerules/workflows/skillops-agent-<name>.md` |
| 9 | `roocode` | **Roo Code** | `.roo/rules/skillops-<name>.md` | `.roo/rules-architect/skillops-agent-<name>.md` |
| 10 | `kilocode` | **Kilo Code** | `.kilocode/rules/skillops-<name>.md` | `.kilocode/workflows/skillops-agent-<name>.md` |
| 11 | `zed` | **Zed AI** | `.zed/rules/skillops-<name>.md` | `.zed/rules/skillops-agent-<name>.md` |
| 12 | `continue` | **Continue.dev** | `.continue/rules/skillops-<name>.md` | `.continue/prompts/skillops-agent-<name>.prompt` |
| 13 | `aider` | **Aider** | `.aider/conventions/skillops-<name>.md` | `.aider/conventions/skillops-agent-<name>.md` |
| 14 | `kiro` | **AWS Kiro IDE** | `.kiro/steering/skillops-<name>.md` | `.kiro/agents/<name>.md` |
| 15 | `trae` | **Trae AI IDE** | `.trae/rules/skillops-<name>.md` | `.trae/agents/<name>.md` |
| 16 | `augment` | **Augment Code** | `.augment/rules/skillops-<name>.md` | `.augment/agents/<name>.md` |
| 17 | `factory` | **Factory AI Droid** | `.factory/skills/<name>/SKILL.md` | `.factory/droids/<name>.md` |
| 18 | `qwen` | **Qwen Code CLI** | `.qwen/skills/<name>/SKILL.md` | `.qwen/agents/<name>.md` |
| 19 | `opencode` | **OpenCode CLI** | `.opencode/skills/<name>/SKILL.md` | `.opencode/agent/<name>.md` |
| 20 | `openhands` | **OpenHands** | `.openhands/microagents/skillops-<name>.md` | `.openhands/microagents/skillops-agent-<name>.md` |
| 21 | `amp` | **Sourcegraph Amp** | `.amp/skills/<name>/SKILL.md` | `.amp/agents/<name>.md` |
| 22 | `goose` | **Block Goose** | `.goose/skills/<name>/SKILL.md` | `.goose/agents/<name>.md` |
| 23 | `warp` | **Warp AI Terminal** | `.warp/skills/<name>/SKILL.md` | `.warp/agents/<name>.md` |
| 24 | `crush` | **Charmbracelet Crush** | `.crush/skills/<name>/SKILL.md` | `.crush/agents/<name>.md` |
| 25 | `vibe` | **Mistral Vibe CLI** | `.vibe/skills/<name>/SKILL.md` | `.vibe/agents/<name>.md` |
| 26 | `junie` | **JetBrains Junie** | `.junie/skills/skillops-<name>.md` | `.junie/agents/<name>.md` |
| 27 | `amazonq` | **Amazon Q Developer** | `.amazonq/rules/skillops-<name>.md` | `.amazonq/cli-agents/<name>.md` |
| 28 | `idx` | **Firebase Studio (IDX)** | `.idx/rules/skillops-<name>.md` | `.idx/agents/<name>.md` |

</details>

---

## Repository Structure

```text
SkillOps/
├── catalog/                         # Skills (SKILL.md) & Subagents (SUBAGENT.md) library
│   ├── ai-engineering/mcp-architect/
│   └── subagents/context-scout/
├── src/
│   ├── cli.ts                       # CLI entrypoint (`add` / `remove`) & interactive flow
│   ├── models.ts                    # Manifest schemas & 28 AI harness specifications
│   ├── ui/                          # Lip Gloss TrueColor TUI (`lipgloss.ts`, `prompt.ts`, `terminal.ts`)
│   ├── sync/                        # Multi-runtime transpiler & `.skillops-lock.json` manager
│   └── auditor/                     # Catalog SKILL.md / SUBAGENT.md parser
└── tests/                           # Vitest unit, TUI & multi-runtime sync tests
```

---

## Contributing & License

- 📖 [**Contribution Guide (`CONTRIBUTING.md`)**](./CONTRIBUTING.md)
- 📜 [**Skill & Subagent Contract (`SKILL_CONTRACT.md`)**](./SKILL_CONTRACT.md)
- ⚖️ Licensed under the [**MIT License**](./LICENSE) — Created by [**@OdevMatheus**](https://github.com/OdevMatheus)
