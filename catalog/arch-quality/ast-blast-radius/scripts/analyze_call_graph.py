"""Deterministic Python AST call-graph and symbol blast-radius analyzer."""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path
from typing import Any


def analyze_symbol_usages(path: Path, symbol: str) -> list[dict[str, Any]]:
    """Find all call sites and imports of ``symbol`` inside a Python file."""
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=path.as_posix())
    findings: list[dict[str, Any]] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            called_name = ""
            if isinstance(node.func, ast.Name):
                called_name = node.func.id
            elif isinstance(node.func, ast.Attribute):
                called_name = node.func.attr
            if called_name == symbol:
                findings.append(
                    {
                        "file": path.as_posix(),
                        "line": node.lineno,
                        "symbol": symbol,
                        "impact": (
                            f"Direct call to '{symbol}()' with {len(node.args)} positional "
                            f"and {len(node.keywords)} keyword argument(s)."
                        ),
                        "severity": "warning",
                    }
                )
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name == symbol:
                    findings.append(
                        {
                            "file": path.as_posix(),
                            "line": node.lineno,
                            "symbol": symbol,
                            "impact": f"Imports '{symbol}' from '{node.module or ''}'.",
                            "severity": "info",
                        }
                    )

    return findings


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint for analyze_call_graph.py."""
    parser = argparse.ArgumentParser(description="Compute AST blast radius for a Python symbol.")
    parser.add_argument("--path", required=True, help="Target Python file or directory.")
    parser.add_argument(
        "--symbol",
        default="from_skill_md",
        help="Target function or class name to trace.",
    )
    parser.add_argument("--json", action="store_true", dest="as_json", help="Emit JSON output.")
    args = parser.parse_args(argv)

    target_path = Path(args.path)
    if not target_path.exists():
        if args.as_json:
            print(
                json.dumps(
                    {
                        "skill": "ast-blast-radius",
                        "script": "analyze_call_graph.py",
                        "status": "error",
                        "target": target_path.as_posix(),
                        "summary": {"direct_callers": 0, "risk_level": "unknown"},
                        "findings": [],
                    }
                )
            )
        return 2

    py_files = [target_path] if target_path.is_file() else sorted(target_path.rglob("*.py"))
    findings: list[dict[str, Any]] = []
    for py_file in py_files:
        findings.extend(analyze_symbol_usages(py_file, args.symbol))

    caller_count = sum(1 for item in findings if item["severity"] == "warning")
    risk_level = "low" if caller_count <= 2 else ("medium" if caller_count <= 7 else "high")
    payload = {
        "skill": "ast-blast-radius",
        "script": "analyze_call_graph.py",
        "status": "ok",
        "target": f"{target_path.as_posix()}:{args.symbol}",
        "summary": {
            "files_scanned": len(py_files),
            "direct_callers": caller_count,
            "total_references": len(findings),
            "risk_level": risk_level,
        },
        "findings": findings,
    }
    if args.as_json:
        print(json.dumps(payload, indent=2))
    else:
        sys.stdout.write(
            f"[OK] Symbol '{args.symbol}': {caller_count} caller(s), risk={risk_level}\n"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
