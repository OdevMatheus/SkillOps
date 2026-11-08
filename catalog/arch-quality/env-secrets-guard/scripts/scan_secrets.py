"""Deterministic secrets and .env hygiene scanner for any repository."""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import subprocess
from pathlib import Path
from typing import Any

SKILL = "env-secrets-guard"
SCRIPT = "scan_secrets.py"

SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "dist", "build",
    "__pycache__", ".next", "coverage", ".tox", ".mypy_cache",
}
MAX_FILE_BYTES = 1_000_000
EXAMPLE_SUFFIXES = (".example", ".sample", ".template", ".dist")

# (rule id, compiled regex). Provider keys use fixed prefixes to keep false positives low.
TOKEN_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("aws-access-key-id", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b")),
    ("anthropic-api-key", re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{20,}")),
    ("openai-api-key", re.compile(r"\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_\-]{32,}")),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    ("huggingface-token", re.compile(r"\bhf_[A-Za-z0-9]{30,}\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}")),
    ("private-key-block", re.compile(r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----")),
]
ASSIGNMENT_RULE = re.compile(
    r"""(?ix)
    \b[\w.-]*(?:secret|passw(?:or)?d|api[_-]?key|access[_-]?token|auth[_-]?token)[\w.-]*
    \s*[:=]\s*
    ["']([^"'\s]{8,})["']
    """
)
PLACEHOLDER = re.compile(
    r"(?i)example|changeme|change_me|your[_-]|xxx|dummy|placeholder|sample|<[^>]+>|\$\{|%\(|\*{3,}"
)


def _redact(value: str) -> str:
    return f"{value[:4]}***" if len(value) > 4 else "***"


def _is_env_file(name: str) -> bool:
    return name == ".env" or name.startswith(".env.")


def _is_example_env(name: str) -> bool:
    return name.endswith(EXAMPLE_SUFFIXES)


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            ["git", "-C", root.as_posix(), *args],
            capture_output=True, text=True, check=False, timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None


def _in_git_repo(root: Path) -> bool:
    res = _git(root, "rev-parse", "--is-inside-work-tree")
    return bool(res and res.returncode == 0 and res.stdout.strip() == "true")


def _is_ignored(root: Path, rel: str, use_git: bool) -> bool:
    if use_git:
        res = _git(root, "check-ignore", "-q", "--", rel)
        return bool(res and res.returncode == 0)
    # ponytail: no-git fallback only fnmatches simple .gitignore lines (no negation or nesting)
    gitignore = root / ".gitignore"
    if not gitignore.is_file():
        return False
    name = Path(rel).name
    for line in gitignore.read_text(encoding="utf-8", errors="replace").splitlines():
        pattern = line.strip().rstrip("/")
        if pattern and not pattern.startswith(("#", "!")):
            if fnmatch.fnmatch(name, pattern) or fnmatch.fnmatch(rel, pattern):
                return True
    return False


def _is_tracked(root: Path, rel: str, use_git: bool) -> bool:
    if not use_git:
        return False
    res = _git(root, "ls-files", "--error-unmatch", "--", rel)
    return bool(res and res.returncode == 0)


def _walk(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in sorted(root.rglob("*")):
        rel_parts = path.relative_to(root).parts
        if any(part in SKIP_DIRS for part in rel_parts[:-1]):
            continue
        if path.is_file() and not path.is_symlink():
            files.append(path)
    return files


def _finding(rel: str, line: int, rule: str, severity: str, impact: str) -> dict[str, Any]:
    return {"file": rel, "line": line, "symbol": rule, "impact": impact, "severity": severity}


def scan_repo(root: Path) -> tuple[list[dict[str, Any]], int]:
    """Return (findings, files_scanned) for the directory tree under root."""
    findings: list[dict[str, Any]] = []
    scanned = 0
    use_git = _in_git_repo(root)

    for path in _walk(root):
        rel = path.relative_to(root).as_posix()
        name = path.name

        if _is_env_file(name) and not _is_example_env(name):
            if _is_tracked(root, rel, use_git):
                findings.append(_finding(
                    rel, 0, "env-file-tracked", "error",
                    "Environment file is tracked by git; remove it from the index and rotate its secrets.",
                ))
            elif not _is_ignored(root, rel, use_git):
                findings.append(_finding(
                    rel, 0, "env-file-not-ignored", "error",
                    "Environment file is not covered by .gitignore; add '.env' and '.env.*'.",
                ))
            continue  # real .env files hold secrets by design; never scan or print their content

        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                continue
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        scanned += 1

        for lineno, line in enumerate(text.splitlines(), start=1):
            for rule, pattern in TOKEN_RULES:
                match = pattern.search(line)
                if match and not PLACEHOLDER.search(match.group(0)):
                    findings.append(_finding(
                        rel, lineno, rule, "error",
                        f"Hardcoded credential detected ({_redact(match.group(0))}); "
                        "move it to an environment variable and rotate it.",
                    ))
            match = ASSIGNMENT_RULE.search(line)
            if match and not PLACEHOLDER.search(match.group(1)):
                findings.append(_finding(
                    rel, lineno, "hardcoded-secret-assignment", "warning",
                    f"Literal value assigned to a secret-like name ({_redact(match.group(1))}); "
                    "read it from the environment instead.",
                ))

    return findings, scanned


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint: exit 0 clean, 1 findings, 2 invalid path."""
    parser = argparse.ArgumentParser(description="Scan a repository for secrets and .env hygiene issues.")
    parser.add_argument("--path", required=True, help="Repository root directory to scan.")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Emit JSON output.")
    args = parser.parse_args(argv)

    root = Path(args.path)
    if not root.is_dir():
        if args.as_json:
            print(json.dumps({
                "skill": SKILL, "script": SCRIPT, "status": "error",
                "target": root.as_posix(),
                "summary": {"files_scanned": 0, "findings_count": 0}, "findings": [],
            }))
        else:
            print(f"error: not a directory: {root}")
        return 2

    findings, scanned = scan_repo(root)
    status = "ok" if not findings else "findings_detected"
    if args.as_json:
        print(json.dumps({
            "skill": SKILL, "script": SCRIPT, "status": status,
            "target": root.as_posix(),
            "summary": {
                "files_scanned": scanned,
                "findings_count": len(findings),
                "errors": sum(f["severity"] == "error" for f in findings),
                "warnings": sum(f["severity"] == "warning" for f in findings),
            },
            "findings": findings,
        }, indent=2))
    else:
        for f in findings:
            print(f"{f['file']}:{f['line']}: {f['severity']}: {f['symbol']}: {f['impact']}")
        print(f"status={status} files_scanned={scanned} findings={len(findings)}")
    return 0 if not findings else 1


if __name__ == "__main__":
    raise SystemExit(main())
