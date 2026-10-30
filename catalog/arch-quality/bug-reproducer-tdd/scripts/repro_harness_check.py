#!/usr/bin/env python3
"""Deterministic checker for TDD bug-reproduction test harnesses."""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path
from typing import Any


def check_test_file(file_path: Path) -> list[dict[str, Any]]:
    """Verify a Python test module has explicit assertions, no sleep calls, and no skip decorators."""
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

    test_funcs = [
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_")
    ]
    if not test_funcs:
        findings.append(
            {
                "rule": "NO_TEST_FUNCTIONS_FOUND",
                "severity": "error",
                "file": file_path.as_posix(),
                "line": 1,
                "message": "Reproduction harness must define at least one test_* function.",
            }
        )

    for func in test_funcs:
        for dec in func.decorator_list:
            dec_src = ast.unparse(dec) if hasattr(ast, "unparse") else ""
            if "skip" in dec_src or "xfail" in dec_src:
                findings.append(
                    {
                        "rule": "SKIPPED_REPRODUCTION_TEST",
                        "severity": "error",
                        "file": file_path.as_posix(),
                        "line": func.lineno,
                        "function": func.name,
                        "message": f"Reproduction test '{func.name}' must not use skip/xfail decorators.",
                    }
                )

        has_assertion = False
        for child in ast.walk(func):
            if isinstance(child, ast.Assert):
                has_assertion = True
            elif isinstance(child, ast.Call):
                call_src = ast.unparse(child.func) if hasattr(ast, "unparse") else ""
                if any(tok in call_src for tok in ("pytest.raises", "assert", "assertEqual", "assertRaises")):
                    has_assertion = True
                if call_src in ("time.sleep", "asyncio.sleep", "sleep"):
                    findings.append(
                        {
                            "rule": "FLAKY_SLEEP_IN_TEST",
                            "severity": "error",
                            "file": file_path.as_posix(),
                            "line": child.lineno,
                            "function": func.name,
                            "message": "Avoid sleep() in reproduction tests; use deterministic mocks or clock injection.",
                        }
                    )
        if not has_assertion:
            findings.append(
                {
                    "rule": "MISSING_EXPLICIT_ASSERTION",
                    "severity": "error",
                    "file": file_path.as_posix(),
                    "line": func.lineno,
                    "function": func.name,
                    "message": f"Test '{func.name}' lacks an explicit assert or pytest.raises check.",
                }
            )
    return findings


def analyze_target(target_path: Path) -> dict[str, Any]:
    files = [target_path] if target_path.is_file() else sorted(target_path.rglob("test_*.py"))
    findings: list[dict[str, Any]] = []
    for f in files:
        findings.extend(check_test_file(f))
    return {
        "status": "error" if findings else "ok",
        "target": target_path.as_posix(),
        "files_scanned": len(files),
        "finding_count": len(findings),
        "findings": findings,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate TDD bug-reproduction test harnesses.")
    parser.add_argument("--path", required=True, type=Path, help="Target test file or directory.")
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
