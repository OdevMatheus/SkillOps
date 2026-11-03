# Support & Community Resources

Thank you for using **SkillOps (`npx skillops-cli@latest`)**! To keep the issue tracker focused on actionable engineering tasks, please use the appropriate channel below when seeking help or reporting issues.

---

## 1. Documentation & Self-Diagnosis First

Before opening a support request, run the built-in zero-API diagnostic tools in your repository:

```bash
# Verify Node.js (>=20), Python (>=3.12), .skillops.yml, .skillops-lock.json drift, and Startup Token Tax
npx skillops-cli@latest doctor

# Inspect the Top 20 supported AI coding agents & auto-detected harnesses in your workspace
npx skillops-cli@latest harnesses
```

You can also consult our canonical specifications:
- **[`README.md`](../README.md):** Quick Start, CLI command reference, and the Universal Top-20 AI Coding Agents Matrix.
- **[`SKILL_CONTRACT.md`](../SKILL_CONTRACT.md):** Normative specification for Hybrid Executable Skills, Context-Isolated Subagents, 3-level progressive disclosure budgets, and exit codes.
- **[`docs/BENCHMARKS.md`](../docs/BENCHMARKS.md):** Empirical Startup Token Tax case study and deterministic `with_skill` vs. `without_skill` TDD evaluation metrics.
- **[`docs/architecture/README.md`](../docs/architecture/README.md):** System architecture overview and Architecture Decision Records (`ADR-0001` through `ADR-0004`).

---

## 2. Where to Ask Questions & Get Help

| Topic | Channel |
| :--- | :--- |
| **Usage questions, architecture discussions, or custom skill design** | [**GitHub Discussions**](https://github.com/OdevMatheus/SkillOps/discussions) |
| **Reproducible bugs, CLI errors, or runtime transpiler regressions** | [**GitHub Issues — Bug Report**](https://github.com/OdevMatheus/SkillOps/issues/new?template=bug_report.yml) |
| **New Hybrid Skills, Subagents, or AI harness integrations** | [**GitHub Issues — Feature Request**](https://github.com/OdevMatheus/SkillOps/issues/new?template=feature_request.yml) |
| **Security vulnerabilities or prompt-injection bypasses** | [**Private Vulnerability Reporting (`SECURITY.md`)**](./SECURITY.md) |
