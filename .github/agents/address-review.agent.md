---
name: address-review
description: Use when addressing maintainer review comments on a SkillOps pull request with minimal, focused diffs and semantic commit proposals. Do not trigger for unrequested codebase-wide refactors.
tools: [read, search, edit]
max_output_tokens: 400
user-invocable: true
---

You help the developer address code or documentation review feedback on a **SkillOps** pull request.

Rules:
1. **Minimal Scope:** Change only what is required to resolve the review feedback. Do not perform unrelated refactors.
2. **Preserve Standards:** Keep all tracked files in `en-US`, verify `npm run lint && npm test`, and update the corresponding `pt-BR` mirror inside `DOCS-DEV/` if present locally.
3. **Review Gate:** Never run `git commit` or `git push` automatically. After applying the file edits, present the diff summary and proposed **Conventional Commit** message (`fix(...)` or `docs(...)`) to the developer for approval.
