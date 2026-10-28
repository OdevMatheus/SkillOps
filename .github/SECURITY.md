# Security Policy

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

If you discover a security vulnerability in **FolioOps**, please report it privately via [GitHub Private Vulnerability Reporting](https://github.com/OdevMatheus/FolioOps/security/advisories/new) or by contacting the maintainer (`@OdevMatheus`) directly with:

1. A clear description of the vulnerability.
2. Steps to reproduce the issue.
3. Potential impact (e.g., prompt injection, unintended file access, local server exposure, or personal data leakage).
4. Suggested mitigation or fix (if available).

---

## Scope & Security Principles

- **Privacy & Local Data Isolation:** Personal user data and local developer documentation (`DOCS-DEV/`, `.env*`) must never be committed to the public repository.
- **Prompt & Agent Safety:** AI agent instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.github/agents/`) must never instruct agents to bypass security boundaries, expose credentials, or bind local development servers to public network interfaces (`0.0.0.0`).
- **Supply Chain Hygiene:** GitHub Actions and dependencies are monitored via Dependabot and reviewed via `CODEOWNERS`.
