---
name: "security-sast-gate"
description: "Use when auditing source code for OWASP Top 10 security vulnerabilities, unsafe pickle or YAML deserialization sinks, shell command execution hazards, weak MD5 or SHA-1 cryptographic hashing algorithms, hardcoded secret credential literals, and filesystem path traversal vectors before merging pull requests or deploying backend services."
version: "1.0.0"
track: "arch-quality"
tags:
  - "security"
  - "sast"
  - "owasp"
  - "cryptography"
  - "deserialization"
routing_signals:
  languages: ["python", "typescript"]
  files_any: ["pyproject.toml", "package.json", "Dockerfile"]
  dependencies_any: ["cryptography", "pyyaml", "jwt"]
  negative_triggers:
    - "Do not trigger for pure typography styling, markdown changelog formatting, or colour palette updates."
entrypoints:
  scripts:
    - path: "scripts/owasp_ast_scanner.py"
      description: "Static AST security scanner detecting shell=True command execution, pickle/yaml unsafe loads, weak md5/sha1 digests, and hardcoded credentials."
---

# Security SAST Gate (`security-sast-gate`)

## When to Use This Skill
Invoke this skill during security code reviews or pre-commit SAST checks to detect and remediate OWASP Top 10 sinks—including OS command execution, arbitrary code deserialization, weak cryptographic digests, and hardcoded secrets.

## Mandatory Execution Workflow

1. **Run the Deterministic OWASP AST Scanner First:**
   ```bash
   python catalog/arch-quality/security-sast-gate/scripts/owasp_ast_scanner.py --path <target_dir_or_file> --json
   ```
2. **Eliminate Arbitrary Code Execution & Deserialization Sinks:**
   - Never invoke `eval()`, `exec()`, `pickle.loads()`, or `yaml.load()` without `Loader=yaml.SafeLoader` (prefer `yaml.safe_load()`).
   - Never pass `shell=True` to `subprocess.run()` / `subprocess.Popen()`; pass a list of string arguments (`["git", "status"]`) with `shell=False`.
3. **Enforce Modern Cryptographic Primitives & Secret Hygiene:**
   - Replace broken `hashlib.md5()` and `hashlib.sha1()` digests with `hashlib.sha256()` or `secrets.compare_digest()`.
   - Load API keys, signing secrets, and passwords exclusively from environment variables or a secret manager—never hardcode string literals.
4. **Re-Verify Zero SAST Findings:**
   - Re-run `owasp_ast_scanner.py` and confirm `"status": "ok"` (`0` findings).
