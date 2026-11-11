# Support & Community Resources

Thank you for using **SkillOps (`npx skillops-cli@latest`)**! Please use the channels below when seeking help, contributing Skills, or reporting bugs.

---

## 1. Quick Verification & Preview

Before opening a bug report, you can preview how SkillOps transpiles files in your repository without modifying disk using `--dry-run`:

```bash
# Preview interactive or targeted installation without writing files
npx skillops-cli@latest add mcp-architect -t cursor,claude --dry-run

# Inspect CLI help and available flags
npx skillops-cli@latest --help
```

Consult our core documentation:
- **[`README.md`](../README.md):** Quick Start, interactive TUI guide, commands (`add` / `remove`), and the 28 supported AI IDEs & CLIs.
- **[`CONTRIBUTING.md`](../CONTRIBUTING.md):** Two-Track Contribution Policy (**Track A:** Direct PRs for new catalog Skills/Subagents; **Track B:** Issue-first workflow for Core CLI changes).
- **[`SKILL_CONTRACT.md`](../SKILL_CONTRACT.md):** Normative specification for `SKILL.md` and `SUBAGENT.md`.

---

## 2. Where to Go

| Topic | Channel |
| :--- | :--- |
| **Contribute a new Skill (`SKILL.md`) or Subagent (`SUBAGENT.md`)** | [**Open a Pull Request Directly (Track A — No Issue Needed)**](https://github.com/skillops-toolkit/SkillOps/compare) |
| **Questions, ideas, or custom Skill discussions** | [**GitHub Discussions**](https://github.com/skillops-toolkit/SkillOps/discussions) |
| **Reproducible CLI bugs or adapter regressions (`src/`)** | [**GitHub Issues — Bug Report (Track B)**](https://github.com/skillops-toolkit/SkillOps/issues/new?template=bug_report.yml) |
| **Core CLI / TUI / Transpiler feature proposals (`src/`)** | [**GitHub Issues — Feature Proposal (Track B)**](https://github.com/skillops-toolkit/SkillOps/issues/new?template=feature_request.yml) |
| **Security vulnerabilities** | [**Private Vulnerability Reporting (`SECURITY.md`)**](./SECURITY.md) |
