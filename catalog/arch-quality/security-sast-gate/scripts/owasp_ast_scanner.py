#!/usr/bin/env python3
"""Deterministic OWASP SAST scanner for Python AST sinks and hardcoded credentials."""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path
from typing import Any

DANGEROUS_CALLS: dict[str, tuple[str, str]] = {
    "eval": ("ARBITRARY_CODE_EVAL", "Never use eval() on untrusted input; use ast.literal_eval() or structured parsing."),
    "exec": ("ARBITRARY_CODE_EXEC", "Never use exec() in application code."),
    "os.system": ("OS_COMMAND_INJECTION", "Replace os.system() with subprocess.run([...], shell=False, check=True)."),
    "pickle.loads": ("INSECURE_DESERIALIZATION", "Never deserialize untrusted payloads with pickle.loads(); use JSON/Pydantic."),
    "pickle.load": ("INSECURE_DESERIALIZATION", "Never deserialize untrusted streams with pickle.load(); use JSON/Pydantic."),
    "hashlib.md5": ("WEAK_CRYPTO_HASH", "Replace broken MD5 digest with hashlib.sha256()."),
    "hashlib.sha1": ("WEAK_CRYPTO_HASH", "Replace weak SHA-1 digest with hashlib.sha256()."),
}

SECRET_VAR_KEYWORDS = ("api_key", "secret_key", "password", "private_key", "access_token")


def _call_name(node: ast.Call) -> str:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        parts: list[str] = [node.func.attr]
        curr: ast.AST = node.func.value
        while isinstance(curr, ast.Attribute):
            parts.append(curr.attr)
            curr = curr.value
        if isinstance(curr, ast.Name):
            parts.append(curr.id)
        return ".".join(reversed(parts))
    return ""


def scan_python_file(file_path: Path) -> list[dict[str, Any]]:
    """Scan a Python module for OWASP AST security vulnerabilities."""
    findings: list[dict[str, Any]] = []
    try:
        source = file_path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(file_path))
    except (OSError, SyntaxError) as exc:
        return [
            {
                "rule": "SYNTAX_OR_IO_ERROR",
                "severity": "error",
                "file": file_path.as_posix(),
                "line": 1,
                "message": str(exc),
            }
        ]

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            cname = _call_name(node)
            if cname in DANGEROUS_CALLS:
                rule_id, msg = DANGEROUS_CALLS[cname]
                findings.append(
                    {
                        "rule": rule_id,
                        "severity": "error",
                        "file": file_path.as_posix(),
                        "line": node.lineno,
                        "call": cname,
                        "message": msg,
                    }
                )
            if cname.startswith("subprocess."):
                for kw in node.keywords:
                    if kw.arg == "shell" and isinstance(kw.value, ast.Constant) and kw.value.value is True:
                        findings.append(
                            {
                                "rule": "SUBPROCESS_SHELL_TRUE",
                                "severity": "error",
                                "file": file_path.as_posix(),
                                "line": node.lineno,
                                "call": cname,
                                "message": "Never pass shell=True to subprocess calls; pass an explicit argv list.",
                            }
                        )
            if cname == "yaml.load":
                has_safe_loader = any(
                    kw.arg == "Loader" and "SafeLoader" in (ast.unparse(kw.value) if hasattr(ast, "unparse") else "")
                    for kw in node.keywords
                )
                if not has_safe_loader:
                    findings.append(
                        {
                            "rule": "UNSAFE_YAML_LOAD",
                            "severity": "error",
                            "file": file_path.as_posix(),
                            "line": node.lineno,
                            "call": cname,
                            "message": "Use yaml.safe_load() instead of yaml.load() without SafeLoader.",
                        }
                    )
        elif isinstance(node, ast.Assign):
            if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str) and len(node.value.value) >= 8:
                for target in node.targets:
                    if isinstance(target, ast.Name) and any(k in target.id.lower() for k in SECRET_VAR_KEYWORDS):
                        findings.append(
                            {
                                "rule": "HARDCODED_SECRET_LITERAL",
                                "severity": "error",
                                "file": file_path.as_posix(),
                                "line": node.lineno,
                                "variable": target.id,
                                "message": f"Hardcoded credential assigned to '{target.id}'; load from environment variables.",
                            }
                        )
    return findings


def analyze_target(target_path: Path) -> dict[str, Any]:
    files = [target_path] if target_path.is_file() else sorted(target_path.rglob("*.py"))
    findings: list[dict[str, Any]] = []
    for f in files:
        findings.extend(scan_python_file(f))
    return {
        "status": "error" if findings else "ok",
        "target": target_path.as_posix(),
        "files_scanned": len(files),
        "finding_count": len(findings),
        "findings": findings,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run deterministic OWASP SAST AST scan.")
    parser.add_argument("--path", required=True, type=Path, help="Target Python file or directory.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args(argv)

    if not args.path.exists():
        payload = {"status": "error", "message": f"Path not found: {args.path.as_posix()}"}
        print(json.dumps(payload, indent=2))
        return 2

    report = analyze_target(args.path)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"[{report['status'].upper()}] {report['target']} ({report['finding_count']} findings)")
    return 1 if report["status"] == "error" else 0


if __name__ == "__main__":
    sys.exit(main())
