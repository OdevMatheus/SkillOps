# Security Policy

## Supported Versions

Only the latest release line of **SkillOps (`skillops-cli`)** receives active security updates and CodeQL SAST patches:

| Version | Supported | Notes |
| :--- | :---: | :--- |
| **`1.3.x`** | ✅ | 28 AI IDEs & CLIs Transpiler, Lip Gloss TrueColor TUI, SHA-256 Lockfile & Active LTS |
| **`1.2.x`** | ⚠️ | Critical security fixes only |
| **`< 1.2.0`** | ❌ | End of life — upgrade via `npx skillops-cli@latest` |

---

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

If you discover a security vulnerability in **SkillOps**, please report it privately via [GitHub Private Vulnerability Reporting](https://github.com/OdevMatheus/SkillOps/security/advisories/new) with:

1. A clear description of the vulnerability.
2. Steps to reproduce the issue.
3. Potential impact (e.g., indirect prompt injection, arbitrary code execution via skill scripts, path traversal, or credential exposure).
4. Suggested mitigation or fix (if available).

**Response SLA:** Security reports are acknowledged within **48 hours** and triaged with a remediation plan or advisory within **7 days**.

---

## Scope & Security Principles

- **Privacy & Local Data Isolation:** Personal user data and local environment variables (`.env*`) must never be committed to the repository.
- **Deterministic & Safe Skill Execution:** All executable skill scripts (`catalog/**/scripts/*`) must operate strictly in read-only analysis mode unless explicitly documented, and must never execute untrusted shell strings (`shell=True`).
- **Prompt & Agent Safety:** AI agent instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `catalog/**/SKILL.md`, `catalog/subagents/**/SUBAGENT.md`) must never instruct agents to bypass security boundaries or expose credentials.
- **Supply Chain & Static Analysis Hygiene:** GitHub Actions, TypeScript (`src/`), and Python (`catalog/**/scripts/*.py`) are continuously audited via **GitHub CodeQL SAST** ([`.github/workflows/codeql.yml`](./workflows/codeql.yml)), Dependabot, and `CODEOWNERS`.
