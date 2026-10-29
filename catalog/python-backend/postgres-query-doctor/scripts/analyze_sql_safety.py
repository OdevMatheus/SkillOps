"""Deterministic static SQL and PostgreSQL migration safety analyzer."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

_NON_CONCURRENT_INDEX = re.compile(
    r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?!\s+CONCURRENTLY\b)",
    re.IGNORECASE,
)
_SELECT_STAR = re.compile(r"\bSELECT\s+\*\s+FROM\b", re.IGNORECASE)
_UNBOUNDED_MUTATION = re.compile(
    r"\b(DELETE\s+FROM|UPDATE\s+[a-zA-Z0-9_.]+(?:\s+SET\s+[^;]+)?)\s*;",
    re.IGNORECASE,
)


def audit_sql_file(path: Path) -> list[dict[str, Any]]:
    """Inspect a .sql or migration file for PostgreSQL production hazards."""
    lines = path.read_text(encoding="utf-8").splitlines()
    findings: list[dict[str, Any]] = []

    for idx, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue

        if _NON_CONCURRENT_INDEX.search(stripped):
            findings.append(
                {
                    "file": path.as_posix(),
                    "line": idx,
                    "symbol": "CREATE INDEX",
                    "impact": (
                        "CREATE INDEX without CONCURRENTLY acquires a table lock that blocks "
                        "concurrent writes in production."
                    ),
                    "severity": "error",
                }
            )

        if _SELECT_STAR.search(stripped):
            findings.append(
                {
                    "file": path.as_posix(),
                    "line": idx,
                    "symbol": "SELECT *",
                    "impact": (
                        "SELECT * prevents PostgreSQL index-only scans and inflates wire I/O; "
                        "project explicit column names."
                    ),
                    "severity": "warning",
                }
            )

        if _UNBOUNDED_MUTATION.search(stripped) and "WHERE" not in stripped.upper():
            findings.append(
                {
                    "file": path.as_posix(),
                    "line": idx,
                    "symbol": "UPDATE/DELETE without WHERE",
                    "impact": (
                        "Unbounded UPDATE or DELETE statement without a WHERE clause detected."
                    ),
                    "severity": "error",
                }
            )

    return findings


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint for analyze_sql_safety.py."""
    parser = argparse.ArgumentParser(description="Analyze PostgreSQL SQL and migration files.")
    parser.add_argument("--path", required=True, help="Target .sql/.py file or directory.")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Emit JSON output.")
    args = parser.parse_args(argv)

    target_path = Path(args.path)
    if not target_path.exists():
        if args.as_json:
            print(
                json.dumps(
                    {
                        "skill": "postgres-query-doctor",
                        "script": "analyze_sql_safety.py",
                        "status": "error",
                        "target": target_path.as_posix(),
                        "summary": {"files_scanned": 0, "findings_count": 0},
                        "findings": [],
                    }
                )
            )
        return 2

    files = (
        [target_path]
        if target_path.is_file()
        else sorted(list(target_path.rglob("*.sql")) + list(target_path.rglob("*.py")))
    )
    all_findings: list[dict[str, Any]] = []
    for sql_file in files:
        all_findings.extend(audit_sql_file(sql_file))

    status = "ok" if not all_findings else "findings_detected"
    payload = {
        "skill": "postgres-query-doctor",
        "script": "analyze_sql_safety.py",
        "status": status,
        "target": target_path.as_posix(),
        "summary": {
            "files_scanned": len(files),
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
