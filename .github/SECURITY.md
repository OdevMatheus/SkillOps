# Security Policy

## Supported Versions

Only the latest minor release line of **SkillOps (`skillops-cli`)** receives active security updates and SAST patches:

| Version | Supported | Notes |
| :--- | :---: | :--- |
| **`1.2.x`** | ✅ | Universal Top-20 AI Harnesses, `mcp-setup`, CodeQL SAST & Active LTS |
| **`1.1.x`** | ⚠️ | Critical security fixes only |
| **`< 1.1.0`** | ❌ | End of life — upgrade via `npx skillops-cli@latest` |

---

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

If you discover a security vulnerability in **SkillOps**, please report it privately via [GitHub Private Vulnerability Reporting](https://github.com/OdevMatheus/SkillOps/security/advisories/new) or by contacting the maintainer (`@OdevMatheus`) directly with:

1. A clear description of the vulnerability.
2. Steps to reproduce the issue.
3. Potential impact (e.g., indirect prompt injection, arbitrary code execution via skill scripts, path traversal, unintended file access, or credential exposure).
4. Suggested mitigation or fix (if available).

**Response SLA:** Security reports are acknowledged within **48 hours** and triaged with a remediation plan or CVE advisory within **7 days**.

---

## Scope & Security Principles

- **Privacy & Local Data Isolation:** Personal user data and local developer documentation (`DOCS-DEV/`, `.env*`) must never be committed to the public repository.
- **Deterministic & Safe Skill Execution:** All executable skill scripts (`catalog/**/scripts/*`) must operate strictly on target files in read-only analysis mode unless explicitly invoked with write flags, and must never execute untrusted shell strings (`shell=True`).
- **Prompt & Agent Safety:** AI agent instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.github/agents/`, `catalog/**/SKILL.md`, `catalog/subagents/**/SUBAGENT.md`) must never instruct agents to bypass security boundaries, expose credentials, or bind local development servers to public network interfaces (`0.0.0.0`).
- **Supply Chain & Static Analysis Hygiene:** GitHub Actions, TypeScript (`src/`), and Python (`catalog/**/scripts/*.py`) are continuously audited via **GitHub CodeQL SAST** ([`.github/workflows/codeql.yml`](./workflows/codeql.yml)), Dependabot, and `CODEOWNERS`.
