"""Deterministic AST auditor for FastMCP / Model Context Protocol Python servers."""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path
from typing import Any


def _is_mcp_tool_decorator(node: ast.expr) -> bool:
    """Return True if decorator is @mcp.tool or @mcp.tool()."""
    target = node.func if isinstance(node, ast.Call) else node
    if isinstance(target, ast.Attribute) and target.attr == "tool":
        return True
    return isinstance(target, ast.Name) and target.id == "tool"


def audit_mcp_file(path: Path) -> list[dict[str, Any]]:
    """Analyze a Python file for MCP stdio pollution, untyped tools, and unsafe host bindings."""
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=path.as_posix())
    findings: list[dict[str, Any]] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id == "print":
                writes_to_stderr = any(
                    kw.arg == "file"
                    and isinstance(kw.value, ast.Attribute)
                    and kw.value.attr == "stderr"
                    for kw in node.keywords
                )
                if not writes_to_stderr:
                    findings.append(
                        {
                            "file": path.as_posix(),
                            "line": node.lineno,
                            "symbol": "print()",
                            "impact": (
                                "Bare print() to stdout corrupts MCP JSON-RPC stdio framing; "
                                "use sys.stderr or logging."
                            ),
                            "severity": "error",
                        }
                    )
            for kw in node.keywords:
                if (
                    kw.arg == "host"
                    and isinstance(kw.value, ast.Constant)
                    and kw.value.value == "0.0.0.0"
                ):
                    findings.append(
                        {
                            "file": path.as_posix(),
                            "line": node.lineno,
                            "symbol": "host='0.0.0.0'",
                            "impact": (
                                "MCP server binds to 0.0.0.0; bind exclusively to "
                                "127.0.0.1 or localhost."
                            ),
                            "severity": "error",
                        }
                    )

        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            is_tool = any(_is_mcp_tool_decorator(dec) for dec in node.decorator_list)
            if not is_tool:
                continue
            if not ast.get_docstring(node):
                findings.append(
                    {
                        "file": path.as_posix(),
                        "line": node.lineno,
                        "symbol": node.name,
                        "impact": (
                            f"MCP tool '{node.name}' is missing a docstring required for "
                            "LLM tool schema generation."
                        ),
                        "severity": "warning",
                    }
                )
            missing_args = [
                arg.arg
                for arg in node.args.args
                if arg.arg not in {"self", "cls"} and arg.annotation is None
            ]
            if missing_args or node.returns is None:
                findings.append(
                    {
                        "file": path.as_posix(),
                        "line": node.lineno,
                        "symbol": node.name,
                        "impact": (
                            f"MCP tool '{node.name}' is missing explicit parameter or return "
                            "type annotations."
                        ),
                        "severity": "error",
                    }
                )

    return findings


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint for validate_mcp_server.py."""
    parser = argparse.ArgumentParser(description="Audit MCP server Python files.")
    parser.add_argument("--path", required=True, help="Target Python file or directory.")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Emit JSON output.")
    args = parser.parse_args(argv)

    target_path = Path(args.path)
    if not target_path.exists():
        if args.as_json:
            print(
                json.dumps(
                    {
                        "skill": "mcp-architect",
                        "script": "validate_mcp_server.py",
                        "status": "error",
                        "target": target_path.as_posix(),
                        "summary": {"files_scanned": 0, "findings_count": 0},
                        "findings": [],
                    }
                )
            )
        return 2

    py_files = [target_path] if target_path.is_file() else sorted(target_path.rglob("*.py"))
    all_findings: list[dict[str, Any]] = []
    for py_file in py_files:
        all_findings.extend(audit_mcp_file(py_file))

    status = "ok" if not all_findings else "findings_detected"
    payload = {
        "skill": "mcp-architect",
        "script": "validate_mcp_server.py",
        "status": status,
        "target": target_path.as_posix(),
        "summary": {
            "files_scanned": len(py_files),
            "findings_count": len(all_findings),
        },
        "findings": all_findings,
    }
    if args.as_json:
        print(json.dumps(payload, indent=2))
    else:
        sys.stdout.write(f"[{status.upper()}] {len(all_findings)} finding(s) in {target_path}\n")
    return 0 if not all_findings else 1


if __name__ == "__main__":
    raise SystemExit(main())
