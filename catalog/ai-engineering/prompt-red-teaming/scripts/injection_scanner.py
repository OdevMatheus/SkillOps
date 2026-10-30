#!/usr/bin/env python3
"""Deterministic Scanner for Unisolated Prompt Interpolations & RAG Injection Hazards."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

UNSAFE_INTERPOLATION_RE = re.compile(
    r"""(f["']{1,3}[^"']*\{(user_input|query|rag_chunk|document|external_text|web_content)\}[^"']*["']{1,3})""",
    re.IGNORECASE,
)
OVERRIDE_PHRASE_RE = re.compile(
    r"(ignore previous instructions|disregard all prior rules|system override|you are now in developer mode)",
    re.IGNORECASE,
)


def scan_file(path: Path) -> list[dict[str, object]]:
    findings: list[dict[str, object]] = []
    text = path.read_text(encoding="utf-8", errors="replace")
    for idx, line in enumerate(text.splitlines(), start=1):
        if UNSAFE_INTERPOLATION_RE.search(line) and "<untrusted_" not in line:
            findings.append(
                {
                    "path": str(path),
                    "line": idx,
                    "rule": "PROMPT-UNISOLATED-INTERPOLATION",
                    "remediation": "Wrap untrusted variables in <untrusted_context> XML tags and strip closing tags.",
                }
            )
        if OVERRIDE_PHRASE_RE.search(line):
            findings.append(
                {
                    "path": str(path),
                    "line": idx,
                    "rule": "PROMPT-INJECTION-PAYLOAD",
                    "remediation": "Neutralize direct instruction-override payload in fixture or prompt template.",
                }
            )
    return findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scan prompt files and RAG code for injection vulnerabilities.")
    parser.add_argument("--path", required=True, help="Target file or directory.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args(argv)

    target = Path(args.path)
    if not target.exists():
        print(json.dumps({"error": f"Path not found: {args.path}"}), file=sys.stderr)
        return 2

    files = [target] if target.is_file() else sorted(p for p in target.rglob("*") if p.suffix in {".py", ".ts", ".md"})
    all_findings: list[dict[str, object]] = []
    for f in files:
        all_findings.extend(scan_file(f))

    status = "violation" if all_findings else "ok"
    report = {
        "skill": "prompt-red-teaming",
        "target": str(target),
        "files_scanned": len(files),
        "status": status,
        "findings": all_findings,
    }
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"[{status.upper()}] scanned={len(files)} findings={len(all_findings)}")
    return 0 if status == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
