#!/usr/bin/env python3
"""Deterministic Agent Harness Linter for Routing Collapse & Subagent Boundaries."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

FRONTMATTER_RE = re.compile(r"^---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)


def inspect_harness(root: Path, max_active_skills: int = 12) -> dict[str, object]:
    findings: list[dict[str, object]] = []
    skill_files = sorted(root.rglob("SKILL.md")) if root.is_dir() else ([root] if root.name == "SKILL.md" else [])
    subagent_files = sorted(root.rglob("SUBAGENT.md")) if root.is_dir() else ([root] if root.name == "SUBAGENT.md" else [])

    if len(skill_files) > max_active_skills:
        findings.append(
            {
                "rule": "HARNESS-CARDINALITY-OVERFLOW",
                "count": len(skill_files),
                "limit": max_active_skills,
                "remediation": "Use `npx skillops route` to select <= 12 active skills per workspace.",
            }
        )

    for sf in skill_files:
        text = sf.read_text(encoding="utf-8", errors="replace")
        m = FRONTMATTER_RE.match(text)
        if not m:
            findings.append({"path": str(sf), "rule": "HARNESS-MISSING-FRONTMATTER"})
            continue
        fm = m.group(1)
        if "negative_triggers:" not in fm:
            findings.append(
                {
                    "path": str(sf),
                    "rule": "HARNESS-MISSING-NEGATIVE-TRIGGERS",
                    "remediation": "Add explicit `routing_signals.negative_triggers` to prevent false-positive activation.",
                }
            )

    for sub in subagent_files:
        text = sub.read_text(encoding="utf-8", errors="replace")
        m = FRONTMATTER_RE.match(text)
        if not m:
            findings.append({"path": str(sub), "rule": "HARNESS-MISSING-FRONTMATTER"})
            continue
        fm = m.group(1)
        if '"*"' in fm or "'*'" in fm:
            findings.append(
                {
                    "path": str(sub),
                    "rule": "HARNESS-WILDCARD-TOOLS",
                    "remediation": "Replace wildcard `tools: ['*']` with least-privilege explicit tools.",
                }
            )
        if "context_isolation: true" not in fm and "context-isolation: true" not in fm:
            findings.append(
                {
                    "path": str(sub),
                    "rule": "HARNESS-UNISOLATED-SUBAGENT",
                    "remediation": "Set `context_isolation: true` on subagent manifest.",
                }
            )

    status = "violation" if findings else "ok"
    return {
        "skill": "agent-harness-auditor",
        "target": str(root),
        "skills_count": len(skill_files),
        "subagents_count": len(subagent_files),
        "status": status,
        "findings": findings,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit agent harness for routing collapse and subagent safety.")
    parser.add_argument("--path", required=True, help="Target harness or catalog directory.")
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    args = parser.parse_args(argv)

    target = Path(args.path)
    if not target.exists():
        print(json.dumps({"error": f"Path not found: {args.path}"}), file=sys.stderr)
        return 2

    report = inspect_harness(target)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"[{report['status'].upper()}] skills={report['skills_count']} subagents={report['subagents_count']} findings={len(report['findings'])}")
    return 0 if report["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
