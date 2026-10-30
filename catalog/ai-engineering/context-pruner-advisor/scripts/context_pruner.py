#!/usr/bin/env python3
"""Deterministic Repository Context Footprint & Ignore Rule Advisor."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

HIGH_DRAIN_PATTERNS: tuple[str, ...] = (
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "poetry.lock",
    "Cargo.lock",
    "dist/",
    "build/",
    ".next/",
    "coverage/",
    "node_modules/",
)

ALWAYS_ON_ARTIFACTS: tuple[str, ...] = (
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    ".github/copilot-instructions.md",
)


def estimate_tokens(text: str) -> int:
    words = len(text.split())
    return max(1, int(round(words * 1.35))) if words > 0 else 0


def scan_workspace(root: Path, max_always_on_tokens: int = 800) -> dict[str, object]:
    findings: list[dict[str, object]] = []
    recommended_ignores: list[str] = []

    if root.is_file():
        content = root.read_text(encoding="utf-8", errors="replace")
        tokens = estimate_tokens(content)
        lines = len(content.splitlines())
        if tokens > max_always_on_tokens or lines > 250:
            findings.append(
                {
                    "path": root.name,
                    "lines": lines,
                    "tokens": tokens,
                    "rule": "CTX-BLOATED-INSTRUCTION",
                    "remediation": "Split deep reference sections into L3 references/ files.",
                }
            )
    else:
        for rel in ALWAYS_ON_ARTIFACTS:
            candidate = root / rel
            if candidate.is_file():
                content = candidate.read_text(encoding="utf-8", errors="replace")
                tokens = estimate_tokens(content)
                lines = len(content.splitlines())
                if tokens > max_always_on_tokens:
                    findings.append(
                        {
                            "path": rel,
                            "lines": lines,
                            "tokens": tokens,
                            "rule": "CTX-BLOATED-INSTRUCTION",
                            "remediation": f"Compact {rel} below {max_always_on_tokens} tokens via L3 references.",
                        }
                    )

        ignore_file = root / ".claudeignore"
        existing_ignores = (
            ignore_file.read_text(encoding="utf-8", errors="replace")
            if ignore_file.is_file()
            else ""
        )
        for pattern in HIGH_DRAIN_PATTERNS:
            target = root / pattern.rstrip("/")
            if target.exists() and pattern not in existing_ignores:
                recommended_ignores.append(pattern)

    status = "violation" if findings else "ok"
    return {
        "skill": "context-pruner-advisor",
        "target": str(root),
        "status": status,
        "findings": findings,
        "recommended_ignore_entries": recommended_ignores,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scan workspace for context bloat and missing ignore rules.")
    parser.add_argument("--path", required=True, help="Target file or workspace directory.")
    parser.add_argument("--json", action="store_true", help="Emit structured JSON report.")
    args = parser.parse_args(argv)

    target = Path(args.path)
    if not target.exists():
        print(json.dumps({"error": f"Path not found: {args.path}"}), file=sys.stderr)
        return 2

    report = scan_workspace(target)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"[{report['status'].upper()}] {report['target']} (findings={len(report['findings'])})")
    return 0 if report["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
