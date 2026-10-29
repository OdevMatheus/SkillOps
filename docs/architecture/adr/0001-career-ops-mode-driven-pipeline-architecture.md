# ADR-0001: Adopt `career-ops`-Style Mode Router, Embedded Mandatory Rules, and AI-Executed Scripts

## Status
Proposed (2026-10-29)

## Context
**FolioOps** aims to enable any professional — including non-technical users who have never used a terminal or written code — to build an award-level personal portfolio website simply by talking to an AI Agent.

Early exploration of AI-assisted portfolio builders revealed two critical failure modes:
1. **Loose "Skill-Only" Repositories Fail on Consistency:** When a project consists only of optional skills or a single monolithic system prompt, the LLM suffers from context window dilution. By the time it finishes generating React components, it forgets strict visual polish guidelines, skips accessibility checks, or invents user facts.
2. **Manual CLI Pipelines Alienate Non-Technical Users:** Conversely, if the project requires the human user to manually run Python or Node.js scripts in a terminal and pipe outputs into the AI, non-technical professionals cannot use it.

We examined the operational architecture of **`career-ops`**, an open-source AI system that solves a parallel problem (autonomous CV generation and job evaluation). `career-ops` succeeds because:
- The user interacts **100% conversationally** with the AI Agent.
- `AGENTS.md` acts as a deterministic **Mode Router**, loading only the shared contract (`modes/_shared.md`) and the active operational mode (`modes/{mode}.md`) on demand.
- Specialized domain knowledge is compiled directly into mandatory execution blocks (`modes/` + `rules/`).
- Deterministic operations (file parsing, image optimization, headless browser verification) are encapsulated in **Node.js helper scripts (`scripts/*.mjs`) that the AI Agent executes automatically in the background**, plus subagent delegation for isolated visual and technical audits.

## Decision
We will structure **FolioOps** around the **`career-ops` Mode-Driven Pipeline Architecture**:

1. **`AGENTS.md` (with `CLAUDE.md` and `GEMINI.md` pointers) acts as the Mode Router:**
   - Detects user intent from natural language and loads `modes/_shared.md` + the specific `modes/{mode}.md` file (`auto-pipeline`, `intake`, `brainstorm`, `build`, `polish`, `audit`, `add`, `deploy`, `update`).
2. **Mandatory Rulebooks (`rules/*.md`) over Optional External Skills:**
   - Rather than hoping the user's IDE has external skills installed or that the AI chooses to invoke them, the core rules of `impeccable`, `design-taste-frontend`, `seo`, `accessibility`, `performance`, and `core-web-vitals` are compiled directly into versioned rulebooks under `rules/` and enforced as mandatory blocking steps inside `modes/polish.md` and `modes/audit.md`.
3. **AI-Executed Node.js Scripts (`scripts/*.mjs`):**
   - The AI Agent runs deterministic Node.js scripts behind the scenes (`doctor.mjs`, `intake.mjs`, `style-picker.mjs`, `inspect-visual.mjs`, `audit-quality.mjs`, `sync-check.mjs`) and parses their structured output to self-heal issues without bothering the user.
4. **Strict Separation of System Layer (`PROJECT_ROOT`) and User Layer (`DATA_ROOT`) via `DATA_CONTRACT.md`:**
   - System files (`modes/`, `rules/`, `scripts/`, `templates/`) are read-only during portfolio generation, while user files (`inbox/`, `profile/`, `site/`, `reports/`) are owned by the user and preserved across engine updates.

## Consequences

### Positive
- **Zero-Friction User Experience:** The end-user only drops files into `inbox/` and chats naturally with the AI; they never need to memorize CLI flags or debug build errors.
- **High Determinism & Context Sharpness:** Loading only the active `modes/{mode}.md` and delegating `polish`/`audit` passes to subagents prevents context dilution and ensures every rule is strictly enforced.
- **Cross-Agent Portability:** Works identically across Claude Code, Google Antigravity, Cursor, GitHub Copilot, and OpenAI Codex because the workflow lives in the repository's Markdown modes and Node.js scripts rather than proprietary IDE plugins.
- **Single Runtime (Node.js LTS):** Using `.mjs` scripts for both pipeline automation and the Next.js portfolio eliminates Python/pip/virtualenv setup friction on Windows, macOS, and Linux.

### Negative
- **Higher Initial Engineering Effort:** Requires building and maintaining deterministic Node.js helper scripts (`scripts/*.mjs`) and clearly structured mode files (`modes/*.md`) rather than relying on ad-hoc prompts.
- **Subagent Support Variations:** Not all AI coding assistants support native background subagents equally; for single-agent environments, `modes/auto-pipeline.md` must support sequential in-thread execution of Blocks A through F with explicit state checkpoints on disk (`profile/` and `reports/`).

### Neutral
- All system instructions (`AGENTS.md`, `modes/`, `rules/`) are maintained in English (`en-US`) for optimal LLM adherence, while the AI communicates with the user in their configured output language (`config/profile.yml -> language.output`).

## Alternatives Considered

### Alternative 1: Monolithic Prompt + Loose Optional Skills
- **Why not chosen:** Lacks hard verification gates. In long generation tasks, LLMs routinely skip post-generation quality checks when all instructions sit in one large prompt without script-backed checkpoints.

### Alternative 2: User-Executed Python/Node CLI Wizard
- **Why not chosen:** Requires non-technical users (doctors, lawyers, designers) to operate a terminal CLI manually and manage both Python and Node runtimes, violating our primary accessibility goal for non-developers.
