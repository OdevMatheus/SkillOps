#!/usr/bin/env python3
"""Deterministic AST scanner for asyncio event-loop blocking calls and orphaned tasks."""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path
from typing import Any

BLOCKING_CALLS: dict[str, str] = {
    "time.sleep": "Replace time.sleep() with await asyncio.sleep() inside async def.",
    "requests.get": "Replace synchronous requests.get() with httpx.AsyncClient.",
    "requests.post": "Replace synchronous requests.post() with httpx.AsyncClient.",
    "requests.put": "Replace synchronous requests.put() with httpx.AsyncClient.",
    "requests.delete": "Replace synchronous requests.delete() with httpx.AsyncClient.",
    "subprocess.run": "Replace subprocess.run() with asyncio.create_subprocess_exec() or asyncio.to_thread().",
    "subprocess.check_output": "Offload blocking subprocess calls via asyncio.to_thread().",
    "urllib.request.urlopen": "Replace urllib.request.urlopen() with an async HTTP client.",
}


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
    """Scan a Python file for event-loop blocking calls and orphaned create_task invocations."""
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
        if isinstance(node, ast.AsyncFunctionDef):
            for child in ast.walk(node):
                if isinstance(child, ast.Expr) and isinstance(child.value, ast.Call):
                    cname = _call_name(child.value)
                    if cname in ("asyncio.create_task", "create_task"):
                        findings.append(
                            {
                                "rule": "ORPHANED_ASYNC_TASK",
                                "severity": "error",
                                "file": file_path.as_posix(),
                                "line": child.lineno,
                                "function": node.name,
                                "message": (
                                    "Unreferenced asyncio.create_task() may be garbage-collected mid-execution; "
                                    "assign the task reference or use asyncio.TaskGroup()."
                                ),
                            }
                        )
                if isinstance(child, ast.Call):
                    cname = _call_name(child)
                    if cname in BLOCKING_CALLS:
                        findings.append(
                            {
                                "rule": "EVENT_LOOP_BLOCKING_CALL",
                                "severity": "error",
                                "file": file_path.as_posix(),
                                "line": child.lineno,
                                "function": node.name,
                                "call": cname,
                                "message": BLOCKING_CALLS[cname],
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
    parser = argparse.ArgumentParser(description="Scan Python async coroutines for blocking hazards.")
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
