# Security Policy

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

If you discover a security vulnerability in **SkillOps**, please report it privately via [GitHub Private Vulnerability Reporting](https://github.com/OdevMatheus/SkillOps/security/advisories/new) or by contacting the maintainer (`@OdevMatheus`) directly with:

1. A clear description of the vulnerability.
2. Steps to reproduce the issue.
3. Potential impact (e.g., indirect prompt injection, arbitrary code execution via skill scripts, unintended file access, or credential exposure).
4. Suggested mitigation or fix (if available).

---

## Scope & Security Principles

- **Privacy & Local Data Isolation:** Personal user data and local developer documentation (`DOCS-DEV/`, `.env*`) must never be committed to the public repository.
- **Deterministic & Safe Skill Execution:** All executable skill scripts (`catalog/**/scripts/*`) must operate strictly on target files in read-only analysis mode unless explicitly invoked with write flags, and must never execute untrusted shell strings (`shell=True`).
- **Prompt & Agent Safety:** AI agent instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.github/agents/`, `catalog/**/SKILL.md`, `catalog/subagents/**/SUBAGENT.md`) must never instruct agents to bypass security boundaries, expose credentials, or bind local development servers to public network interfaces (`0.0.0.0`).
- **Supply Chain Hygiene:** GitHub Actions and Node.js/TypeScript (`npm`) dependencies are monitored via Dependabot and reviewed via `CODEOWNERS`.
