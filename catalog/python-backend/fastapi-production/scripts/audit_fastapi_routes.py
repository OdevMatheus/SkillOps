"""Deterministic AST auditor for FastAPI routers and async endpoint safety."""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path
from typing import Any

_HTTP_METHODS = frozenset({"get", "post", "put", "delete", "patch"})
_BLOCKING_CALLS = frozenset(
    {
        "time.sleep",
        "requests.get",
        "requests.post",
        "requests.put",
        "requests.delete",
        "requests.request",
        "subprocess.run",
    }
)


def _call_qualname(node: ast.Call) -> str:
    if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name):
        return f"{node.func.value.id}.{node.func.attr}"
    if isinstance(node.func, ast.Name):
        return node.func.id
    return ""


def _is_route_decorator(dec: ast.expr) -> ast.Call | None:
    if (
        isinstance(dec, ast.Call)
        and isinstance(dec.func, ast.Attribute)
        and dec.func.attr in _HTTP_METHODS
    ):
        return dec
    return None


def audit_fastapi_file(path: Path) -> list[dict[str, Any]]:
    """Inspect a Python file for FastAPI production hazards."""
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=path.as_posix())
    findings: list[dict[str, Any]] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            for kw in node.keywords:
                if (
                    kw.arg == "allow_origins"
                    and isinstance(kw.value, ast.List)
                    and any(
                        isinstance(elt, ast.Constant) and elt.value == "*" for elt in kw.value.elts
                    )
                ):
                    findings.append(
                        {
                            "file": path.as_posix(),
                            "line": node.lineno,
                            "symbol": "CORSMiddleware(allow_origins=['*'])",
                            "impact": (
                                "Wildcard CORS allow_origins=['*'] detected; restrict to explicit "
                                "trusted origins in production."
                            ),
                            "severity": "warning",
                        }
                    )

        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            route_calls = [
                call
                for dec in node.decorator_list
                if (call := _is_route_decorator(dec)) is not None
            ]
            if not route_calls:
                continue

            has_response_model = any(
                any(kw.arg == "response_model" for kw in call.keywords) for call in route_calls
            )
            if not has_response_model and node.returns is None:
                findings.append(
                    {
                        "file": path.as_posix(),
                        "line": node.lineno,
                        "symbol": node.name,
                        "impact": (
                            f"FastAPI route '{node.name}' is missing both 'response_model' "
                            "and an explicit return type annotation."
                        ),
                        "severity": "error",
                    }
                )

            if isinstance(node, ast.AsyncFunctionDef):
                for child in ast.walk(node):
                    if isinstance(child, ast.Call):
                        qual = _call_qualname(child)
                        if qual in _BLOCKING_CALLS:
                            findings.append(
                                {
                                    "file": path.as_posix(),
                                    "line": child.lineno,
                                    "symbol": f"{node.name}:{qual}",
                                    "impact": (
                                        f"Blocking call '{qual}()' inside async def '{node.name}' "
                                        "stalls the asyncio event loop."
                                    ),
                                    "severity": "error",
                                }
                            )

    return findings


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint for audit_fastapi_routes.py."""
    parser = argparse.ArgumentParser(description="Audit FastAPI route files.")
    parser.add_argument("--path", required=True, help="Target Python file or directory.")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Emit JSON output.")
    args = parser.parse_args(argv)

    target_path = Path(args.path)
    if not target_path.exists():
        if args.as_json:
            print(
                json.dumps(
                    {
                        "skill": "fastapi-production",
                        "script": "audit_fastapi_routes.py",
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
        all_findings.extend(audit_fastapi_file(py_file))

    status = "ok" if not all_findings else "findings_detected"
    payload = {
        "skill": "fastapi-production",
        "script": "audit_fastapi_routes.py",
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
