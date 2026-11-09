---
name: "env-secrets-guard"
description: "Use when adding or reviewing code that reads configuration, API keys, tokens or passwords, creating .env files, editing .gitignore, or before committing and pushing to detect hardcoded credentials, tracked or unignored .env files, and missing .env.example templates. Do not trigger for rotating secrets in cloud consoles, configuring secret managers or vaults, or purely visual UI work."
version: "1.0.0"
track: "arch-quality"
tags:
  - "security"
  - "secrets"
  - "dotenv"
  - "gitignore"
  - "pre-commit"
routing_signals:
  languages: ["python", "typescript", "javascript"]
  files_any: [".env", ".env.example", ".gitignore"]
  dependencies_any: ["python-dotenv", "dotenv"]
  negative_triggers:
    - "Do not trigger for secret rotation in cloud consoles or vault and secret manager configuration."
entrypoints:
  scripts:
    - path: "scripts/scan_secrets.py"
      description: "Scans a repository for hardcoded credentials and .env files that are tracked by git or not ignored."
---

# Env Secrets Guard (`env-secrets-guard`)

## When to Use This Skill
Invoke this skill whenever code reads credentials from configuration, a `.env` file is created or changed, `.gitignore` is edited, or before a commit or push. The bundled script does the detection, so do not grep for secrets by hand.

## Mandatory Execution Workflow

1. **Run the deterministic scanner first** from the repository root:
   ```bash
   python catalog/arch-quality/env-secrets-guard/scripts/scan_secrets.py --path . --json
   ```
   Exit code `0` means clean, `1` means findings, `2` means the path is invalid. Findings never include full secret values, only a 4-character prefix.
2. **Fix `env-file-tracked` (error):** run `git rm --cached <file>`, add the file to `.gitignore`, and tell the user the secret is already in git history and must be rotated. Do not rewrite history without explicit approval.
3. **Fix `env-file-not-ignored` (error):** add `.env` and `.env.*` to `.gitignore`, then keep a safe template with an allow rule such as `!.env.example`.
4. **Fix hardcoded credentials (`*-key`, `*-token`, `private-key-block`, `hardcoded-secret-assignment`):**
   - Replace the literal with a read from the environment (`os.environ["NAME"]` in Python, `process.env.NAME` in Node).
   - Fail fast when the variable is missing instead of falling back to a default secret.
   - Add the variable name, with a placeholder value, to `.env.example`.
   - Tell the user that any value already committed or shared must be rotated, even if removed from the code.
5. **Never print, log or paste a full secret** in the answer, in commit messages, or in new files. Refer to findings by `file:line` and rule name.
6. **Re-run the scanner** and confirm `"status": "ok"` (exit code `0`) before reporting the work as done.

## Interpreting Findings

| Rule | Severity | Meaning |
| :--- | :---: | :--- |
| `env-file-tracked` | error | A real `.env*` file is in the git index. |
| `env-file-not-ignored` | error | A real `.env*` file exists and `.gitignore` does not cover it. |
| `aws-access-key-id`, `github-token`, `anthropic-api-key`, `openai-api-key`, `google-api-key`, `huggingface-token`, `slack-token` | error | Provider key with a known prefix. |
| `private-key-block` | error | A PEM private key header is present in a file. |
| `hardcoded-secret-assignment` | warning | A secret-like name is assigned a literal string. Confirm it is not a placeholder. |

## Scanner Behavior and Limits
- Skips `.git`, `node_modules`, virtualenvs, build output, files over 1 MB and non-UTF-8 files.
- Never reads the content of real `.env*` files. It only checks whether they are tracked or ignored. Files ending in `.example`, `.sample`, `.template` or `.dist` are scanned like source files.
- Values containing words like `example`, `changeme`, `your_` or `xxx`, and template syntax such as `${VAR}`, are treated as placeholders.
- It is a heuristic scanner. A clean result does not prove the repository is free of secrets, and it does not inspect git history.
