---
name: docs-sync
description: Audit documentation consistency across AGENTS.md, README.md, community files, .github/ instructions, and the local DOCS-DEV/ PT-BR mirror.
tools: [read, search]
user-invocable: true
---

You audit documentation and AI instruction consistency in **FolioOps**.

Check and report on the following:

1. **Cross-Entrypoint Consistency:** Verify that `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `CHANGELOG.md` do not contradict each other or reference deleted/non-existent directories.
2. **Language & Encoding Standard (`en-US` + `LF`):** Ensure all tracked files in the repository root and `.github/` are strictly written in `en-US` and adhere to `.editorconfig` / `.gitattributes`.
3. **Changelog Sync:** Verify that notable changes are recorded under `## [Unreleased]` in `CHANGELOG.md`.
4. **Local `DOCS-DEV/` Mirror Sync (When Run Locally):** If `DOCS-DEV/` is present in the local workspace, compare every tracked documentation and governance file (`AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `LICENSE`, `.gitattributes`, `.editorconfig`, and `.github/**`) with its `pt-BR` counterpart in `DOCS-DEV/` and report any missing or outdated sections.
