#!/usr/bin/env python3
"""Deterministic Python AST auditor for FastAPI async boundaries and Pydantic v2 models.

Detects:
1. Event-loop blocking calls inside `async def` functions (`time.sleep`, `requests.*`,
   synchronous `urllib` network calls, and synchronous `httpx` convenience calls).
2. Mutable default values on Pydantic `BaseModel` fields without `Field(default_factory=...)`.
3. FastAPI route handlers missing both `response_model=...` and explicit return type annotations.
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path
from typing import Any

SKILL = "fastapi-async-guard"
SCRIPT = "audit_fastapi_async.py"

SKIP_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
}

HTTP_ROUTE_METHODS = {
    "get",
    "post",
    "put",
    "delete",
    "patch",
    "options",
    "head",
    "api_route",
}

REQUESTS_BLOCKING_ATTRS = {
    "get",
    "post",
    "put",
    "delete",
    "patch",
    "head",
    "options",
    "request",
    "Session",
}

HTTPX_SYNC_ATTRS = {
    "get",
    "post",
    "put",
    "delete",
    "patch",
    "head",
    "options",
    "request",
    "Client",
}

URLLIB_BLOCKING_ATTRS = {"urlopen", "urlretrieve"}
PYDANTIC_MODEL_BASES = {"BaseModel", "SQLModel", "BaseSettings"}
MUTABLE_BUILTIN_CALLS = {"list", "dict", "set"}


def _finding(
    rel_file: str,
    line: int,
    rule: str,
    symbol: str,
    severity: str,
    impact: str,
) -> dict[str, Any]:
    return {
        "file": rel_file,
        "line": line,
        "rule": rule,
        "symbol": symbol,
        "severity": severity,
        "impact": impact,
    }


def _collect_imports(
    nodes: list[ast.stmt],
    module_aliases: dict[str, str] | None = None,
    symbol_aliases: dict[str, tuple[str, str]] | None = None,
) -> tuple[dict[str, str], dict[str, tuple[str, str]]]:
    mod_map = dict(module_aliases or {})
    sym_map = dict(symbol_aliases or {})

    for stmt in nodes:
        if isinstance(stmt, ast.Import):
            for alias in stmt.names:
                bound = alias.asname or alias.name.split(".")[0]
                if alias.name == "urllib.request" and alias.asname:
                    mod_map[alias.asname] = "urllib_request"
                else:
                    mod_map[bound] = alias.name.split(".")[0]
        elif isinstance(stmt, ast.ImportFrom) and stmt.module:
            mod_name = stmt.module
            for alias in stmt.names:
                if alias.name == "*":
                    continue
                bound = alias.asname or alias.name
                if mod_name == "urllib" and alias.name == "request":
                    mod_map[bound] = "urllib_request"
                elif mod_name == "urllib.request":
                    sym_map[bound] = ("urllib_request", alias.name)
                else:
                    sym_map[bound] = (mod_name.split(".")[0], alias.name)

    return mod_map, sym_map


def _iter_async_local_nodes(stmts: list[ast.stmt]) -> list[ast.AST]:
    """Collect AST nodes inside an `async def` body without descending into nested defs/classes."""
    collected: list[ast.AST] = []
    stack: list[ast.AST] = list(reversed(stmts))
    while stack:
        current = stack.pop()
        if isinstance(current, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        collected.append(current)
        children = list(ast.iter_child_nodes(current))
        stack.extend(reversed(children))
    return collected


def _check_blocking_call(
    call: ast.Call,
    fn_name: str,
    rel_file: str,
    mod_map: dict[str, str],
    sym_map: dict[str, tuple[str, str]],
) -> dict[str, Any] | None:
    func = call.func

    if isinstance(func, ast.Name):
        origin = sym_map.get(func.id)
        if origin == ("time", "sleep"):
            return _finding(
                rel_file,
                call.lineno,
                "async-blocking-sleep",
                f"{func.id}()",
                "error",
                f"Blocking 'time.sleep()' inside 'async def {fn_name}' freezes the asyncio event loop; "
                "use 'await asyncio.sleep(...)'.",
            )
        if origin and origin[0] == "requests" and origin[1] in REQUESTS_BLOCKING_ATTRS:
            return _finding(
                rel_file,
                call.lineno,
                "async-blocking-http",
                f"requests.{origin[1]}()",
                "error",
                f"Blocking 'requests.{origin[1]}()' inside 'async def {fn_name}' stalls concurrent requests; "
                "use 'httpx.AsyncClient' with 'await' or 'run_in_threadpool'.",
            )
        if origin and origin[0] == "urllib_request" and origin[1] in URLLIB_BLOCKING_ATTRS:
            return _finding(
                rel_file,
                call.lineno,
                "async-blocking-http",
                f"{origin[1]}()",
                "error",
                f"Synchronous urllib '{origin[1]}()' inside 'async def {fn_name}' blocks the event loop; "
                "use 'httpx.AsyncClient' with 'await'.",
            )

    elif isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
        target_mod = mod_map.get(func.value.id)
        attr = func.attr
        if target_mod == "time" and attr == "sleep":
            return _finding(
                rel_file,
                call.lineno,
                "async-blocking-sleep",
                f"{func.value.id}.sleep()",
                "error",
                f"Blocking 'time.sleep()' inside 'async def {fn_name}' freezes the asyncio event loop; "
                "use 'await asyncio.sleep(...)'.",
            )
        if target_mod == "requests" and attr in REQUESTS_BLOCKING_ATTRS:
            return _finding(
                rel_file,
                call.lineno,
                "async-blocking-http",
                f"{func.value.id}.{attr}()",
                "error",
                f"Blocking 'requests.{attr}()' inside 'async def {fn_name}' stalls concurrent requests; "
                "use 'httpx.AsyncClient' with 'await' or 'run_in_threadpool'.",
            )
        if target_mod == "urllib_request" and attr in URLLIB_BLOCKING_ATTRS:
            return _finding(
                rel_file,
                call.lineno,
                "async-blocking-http",
                f"{func.value.id}.{attr}()",
                "error",
                f"Synchronous urllib '{attr}()' inside 'async def {fn_name}' blocks the event loop; "
                "use 'httpx.AsyncClient' with 'await'.",
            )
        if target_mod == "httpx" and attr in HTTPX_SYNC_ATTRS:
            return _finding(
                rel_file,
                call.lineno,
                "async-blocking-http",
                f"{func.value.id}.{attr}()",
                "error",
                f"Synchronous 'httpx.{attr}()' inside 'async def {fn_name}' blocks the event loop; "
                "use 'async with httpx.AsyncClient() as client: await client.{attr.lower()}(...)'.",
            )

    elif (
        isinstance(func, ast.Attribute)
        and isinstance(func.value, ast.Attribute)
        and isinstance(func.value.value, ast.Name)
    ):
        root_mod = mod_map.get(func.value.value.id)
        if (
            root_mod == "urllib"
            and func.value.attr == "request"
            and func.attr in URLLIB_BLOCKING_ATTRS
        ):
            return _finding(
                rel_file,
                call.lineno,
                "async-blocking-http",
                f"urllib.request.{func.attr}()",
                "error",
                f"Synchronous urllib '{func.attr}()' inside 'async def {fn_name}' blocks the event loop; "
                "use 'httpx.AsyncClient' with 'await'.",
            )

    return None


def _is_classvar_annotation(annotation: ast.expr | None) -> bool:
    if annotation is None:
        return False
    target = annotation.value if isinstance(annotation, ast.Subscript) else annotation
    if isinstance(target, ast.Name):
        return target.id == "ClassVar"
    if isinstance(target, ast.Attribute):
        return target.attr == "ClassVar"
    return False


def _is_mutable_expr(expr: ast.expr | None) -> str | None:
    if expr is None:
        return None
    if isinstance(expr, ast.List):
        return "list"
    if isinstance(expr, ast.Dict):
        return "dict"
    if isinstance(expr, ast.Set):
        return "set"
    if isinstance(expr, ast.Call):
        func = expr.func
        if isinstance(func, ast.Name) and func.id in MUTABLE_BUILTIN_CALLS:
            return func.id
        is_field_call = (isinstance(func, ast.Name) and func.id == "Field") or (
            isinstance(func, ast.Attribute) and func.attr == "Field"
        )
        if is_field_call:
            has_factory = any(kw.arg == "default_factory" for kw in expr.keywords)
            if has_factory:
                return None
            if expr.args:
                nested = _is_mutable_expr(expr.args[0])
                if nested:
                    return nested
            for kw in expr.keywords:
                if kw.arg == "default":
                    nested = _is_mutable_expr(kw.value)
                    if nested:
                        return nested
    return None


def _is_pydantic_model_class(cls_node: ast.ClassDef) -> bool:
    for base in cls_node.bases:
        target = base.value if isinstance(base, ast.Subscript) else base
        if isinstance(target, ast.Name) and target.id in PYDANTIC_MODEL_BASES:
            return True
        if isinstance(target, ast.Attribute) and target.attr in PYDANTIC_MODEL_BASES:
            return True
    return False


def _audit_pydantic_class(cls_node: ast.ClassDef, rel_file: str) -> list[dict[str, Any]]:
    if not _is_pydantic_model_class(cls_node):
        return []
    findings: list[dict[str, Any]] = []
    for stmt in cls_node.body:
        if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            field_name = stmt.target.id
            if field_name.startswith("_") or field_name == "model_config":
                continue
            if _is_classvar_annotation(stmt.annotation):
                continue
            mutable_kind = _is_mutable_expr(stmt.value)
            if mutable_kind:
                findings.append(
                    _finding(
                        rel_file,
                        stmt.lineno,
                        "pydantic-mutable-default",
                        f"{cls_node.name}.{field_name}",
                        "error",
                        f"Pydantic field '{cls_node.name}.{field_name}' uses a mutable {mutable_kind} default; "
                        f"use 'Field(default_factory={mutable_kind})' instead.",
                    )
                )
        elif isinstance(stmt, ast.Assign):
            for target in stmt.targets:
                if isinstance(target, ast.Name):
                    field_name = target.id
                    if field_name.startswith("_") or field_name == "model_config":
                        continue
                    mutable_kind = _is_mutable_expr(stmt.value)
                    if mutable_kind:
                        findings.append(
                            _finding(
                                rel_file,
                                stmt.lineno,
                                "pydantic-mutable-default",
                                f"{cls_node.name}.{field_name}",
                                "error",
                                f"Pydantic field '{cls_node.name}.{field_name}' uses a mutable {mutable_kind} default; "
                                f"use 'Field(default_factory={mutable_kind})' instead.",
                            )
                        )
    return findings


def _extract_route_decorators(fn_node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[ast.Call]:
    routes: list[ast.Call] = []
    for dec in fn_node.decorator_list:
        if (
            isinstance(dec, ast.Call)
            and isinstance(dec.func, ast.Attribute)
            and dec.func.attr in HTTP_ROUTE_METHODS
        ):
            routes.append(dec)
    return routes


def _decorator_has_response_model(dec: ast.Call) -> bool:
    for kw in dec.keywords:
        if kw.arg == "response_model":
            if isinstance(kw.value, ast.Constant) and kw.value.value is None:
                return False
            return True
    return False


def _audit_route_contract(
    fn_node: ast.FunctionDef | ast.AsyncFunctionDef,
    rel_file: str,
) -> list[dict[str, Any]]:
    route_decs = _extract_route_decorators(fn_node)
    if not route_decs:
        return []

    has_response_model = any(_decorator_has_response_model(dec) for dec in route_decs)
    has_return_annotation = fn_node.returns is not None

    if not has_response_model and not has_return_annotation:
        return [
            _finding(
                rel_file,
                fn_node.lineno,
                "fastapi-missing-response-model",
                fn_node.name,
                "error",
                f"FastAPI route '{fn_node.name}' declares neither 'response_model=...' nor an explicit "
                "return type annotation, risking unfiltered response payloads and untyped OpenAPI schemas.",
            )
        ]

    if (
        not has_response_model
        and isinstance(fn_node.returns, ast.Name)
        and fn_node.returns.id in {"dict", "Any"}
    ):
        return [
            _finding(
                rel_file,
                fn_node.lineno,
                "fastapi-untyped-response-model",
                fn_node.name,
                "warning",
                f"FastAPI route '{fn_node.name}' returns untyped '{fn_node.returns.id}' without "
                "'response_model=...'; prefer an explicit Pydantic BaseModel schema.",
            )
        ]

    return []


def audit_python_file(py_path: Path, base_dir: Path) -> list[dict[str, Any]]:
    rel_file = (
        py_path.relative_to(base_dir).as_posix()
        if py_path != base_dir and base_dir in py_path.parents
        else py_path.name
    )
    try:
        source = py_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []

    try:
        tree = ast.parse(source, filename=rel_file)
    except SyntaxError as exc:
        return [
            _finding(
                rel_file,
                exc.lineno or 1,
                "python-syntax-error",
                py_path.name,
                "error",
                f"Python syntax error prevented AST analysis: {exc.msg}.",
            )
        ]

    top_mod_map, top_sym_map = _collect_imports(tree.body)
    findings: list[dict[str, Any]] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            findings.extend(_audit_pydantic_class(node, rel_file))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            findings.extend(_audit_route_contract(node, rel_file))
            if isinstance(node, ast.AsyncFunctionDef):
                fn_mod_map, fn_sym_map = _collect_imports(
                    node.body,
                    top_mod_map,
                    top_sym_map,
                )
                for inner in _iter_async_local_nodes(node.body):
                    if isinstance(inner, ast.Call):
                        hit = _check_blocking_call(
                            inner,
                            node.name,
                            rel_file,
                            fn_mod_map,
                            fn_sym_map,
                        )
                        if hit is not None:
                            findings.append(hit)

    findings.sort(key=lambda item: (item["file"], item["line"], item["rule"]))
    return findings


def _discover_python_files(target: Path) -> list[Path]:
    if target.is_file():
        return [target] if target.suffix == ".py" and not target.is_symlink() else []
    py_files: list[Path] = []
    for candidate in sorted(target.rglob("*.py")):
        rel_parts = candidate.relative_to(target).parts
        if any(part in SKIP_DIRS for part in rel_parts[:-1]):
            continue
        if candidate.is_file() and not candidate.is_symlink():
            py_files.append(candidate)
    return py_files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Deterministic AST auditor for FastAPI async routes and Pydantic v2 models."
    )
    parser.add_argument(
        "--path",
        required=True,
        help="Target Python file or backend directory to audit.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="as_json",
        help="Emit structured JSON report.",
    )
    args = parser.parse_args(argv)

    target = Path(args.path)
    if not target.exists():
        msg = f"Target path does not exist: {target.as_posix()}"
        if args.as_json:
            print(
                json.dumps(
                    {
                        "skill": SKILL,
                        "script": SCRIPT,
                        "status": "error",
                        "summary": msg,
                        "target": target.as_posix(),
                        "findings": [],
                        "data": {"target": target.as_posix(), "findings": []},
                        "metrics": {
                            "files_scanned": 0,
                            "findings_count": 0,
                            "errors": 0,
                            "warnings": 0,
                        },
                    },
                    indent=2,
                )
            )
        else:
            sys.stderr.write(f"error: {msg}\n")
        return 2

    base_dir = target if target.is_dir() else target.parent
    py_files = _discover_python_files(target)
    findings: list[dict[str, Any]] = []
    for py_file in py_files:
        findings.extend(audit_python_file(py_file, base_dir))

    errors = sum(1 for item in findings if item["severity"] == "error")
    warnings = sum(1 for item in findings if item["severity"] == "warning")
    status = "error" if errors > 0 else ("warn" if warnings > 0 else "ok")
    summary_text = (
        f"Audited {len(py_files)} Python file(s): {errors} error(s), {warnings} warning(s)."
    )

    payload = {
        "skill": SKILL,
        "script": SCRIPT,
        "status": status,
        "summary": summary_text,
        "target": target.as_posix(),
        "findings": findings,
        "data": {
            "target": target.as_posix(),
            "findings": findings,
        },
        "metrics": {
            "files_scanned": len(py_files),
            "findings_count": len(findings),
            "errors": errors,
            "warnings": warnings,
        },
    }

    if args.as_json:
        print(json.dumps(payload, indent=2))
    else:
        for item in findings:
            sys.stdout.write(
                f"{item['file']}:{item['line']}: {item['severity']}: "
                f"{item['rule']} ({item['symbol']}): {item['impact']}\n"
            )
        sys.stdout.write(f"[{status.upper()}] {summary_text}\n")

    return 0 if not findings else 1


if __name__ == "__main__":
    raise SystemExit(main())
