#!/usr/bin/env python3
"""Deterministic context-window token budget profiler for AI coding agent repositories.

Scans always-on instruction files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/*`,
`.github/instructions/*`) and progressive-disclosure skills (`.claude/skills/*/SKILL.md`,
`.agent/skills/*/SKILL.md`, `catalog/**/SKILL.md`) to estimate startup vs on-demand token load,
flag bloated files (`> 500` lines or `> 2,500` words), and recommend `references/` splits.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

SKILL = "context-budget-profiler"
SCRIPT = "profile_context_budget.py"

MAX_LINES_THRESHOLD = 500
MAX_WORDS_THRESHOLD = 2500
SKILL_RECOMMENDED_LINES = 250
SKILL_L1_TOKEN_CAP = 160
DEFAULT_STARTUP_BUDGET = 2500

PUNCT_CODE_CHARS = frozenset("{}[]()<>:;,.=`~@#$%^&*|\\/")

ALWAYS_ON_REL_PATHS = (
    "CLAUDE.md",
    ".claude/CLAUDE.md",
    "AGENTS.md",
    "GEMINI.md",
    ".gemini/GEMINI.md",
    ".gemini/STYLEGUIDE.md",
    ".github/copilot-instructions.md",
    ".cursorrules",
    ".windsurfrules",
    ".roorules",
    ".kilocoderules",
    ".continuerules",
    "CONVENTIONS.md",
    "WARP.md",
    "QWEN.md",
    "CRUSH.md",
    "AGENT.md",
)

RULE_DIR_GLOBS = (
    ".cursor/rules/*",
    ".github/instructions/*",
    ".windsurf/rules/*",
    ".roo/rules/*",
    ".kiro/steering/*",
)

SKILL_GLOBS = (
    ".claude/skills/*/SKILL.md",
    ".agent/skills/*/SKILL.md",
    ".codex/skills/*/SKILL.md",
    ".gemini/skills/*/SKILL.md",
)

SUBAGENT_GLOBS = (
    "catalog/subagents/*/SUBAGENT.md",
    ".claude/agents/*.md",
    ".agent/agents/*.md",
    ".github/agents/*.agent.md",
)

SKIP_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    ".venv",
    "venv",
    "__pycache__",
    ".worktrees",
}


def estimate_tokens(text: str) -> int:
    """Deterministic zero-API token estimator matching SkillOps SKILL_CONTRACT.md."""
    stripped = text.strip()
    if not stripped:
        return 0
    words = len(stripped.split())
    punct_bonus = sum(1 for ch in stripped if ch in PUNCT_CODE_CHARS) // 4
    return max(1, math.ceil(words * 1.33) + punct_bonus)


def _slugify_heading(heading: str) -> str:
    chars: list[str] = []
    prev_dash = False
    for ch in heading.lower():
        if ch.isalnum():
            chars.append(ch)
            prev_dash = False
        elif not prev_dash and chars:
            chars.append("-")
            prev_dash = True
    slug = "".join(chars).strip("-")
    return slug[:48] or "details"


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n") and not text.startswith("---\r\n"):
        return {}, text
    lines = text.splitlines()
    end_idx = -1
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            end_idx = idx
            break
    if end_idx == -1:
        return {}, text

    fm: dict[str, str] = {}
    current_key: str | None = None
    for raw in lines[1:end_idx]:
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not raw.startswith((" ", "\t")) and ":" in raw:
            key, val = raw.split(":", 1)
            current_key = key.strip()
            fm[current_key] = val.strip().strip("\"'")
        elif current_key is not None and not stripped.startswith("-"):
            fm[current_key] = f"{fm[current_key]} {stripped}".strip()
    body = "\n".join(lines[end_idx + 1 :])
    return fm, body


def _extract_heavy_sections(body: str, limit: int = 3) -> list[dict[str, Any]]:
    sections: list[tuple[str, list[str]]] = []
    current_title = "introduction"
    current_lines: list[str] = []

    for line in body.splitlines():
        if line.startswith("## ") or line.startswith("### "):
            if current_lines:
                sections.append((current_title, current_lines))
            current_title = line.lstrip("#").strip()
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines:
        sections.append((current_title, current_lines))

    scored: list[dict[str, Any]] = []
    for title, sec_lines in sections:
        sec_text = "\n".join(sec_lines)
        words = len(sec_text.split())
        tokens = estimate_tokens(sec_text)
        if words >= 80 and title != "introduction":
            scored.append(
                {
                    "heading": title,
                    "lines": len(sec_lines),
                    "words": words,
                    "estimated_tokens": tokens,
                    "suggested_reference": f"references/{_slugify_heading(title)}.md",
                }
            )

    scored.sort(key=lambda item: item["estimated_tokens"], reverse=True)
    return scored[:limit]


def _discover_context_files(repo: Path) -> list[tuple[Path, str]]:
    seen: set[Path] = set()
    discovered: list[tuple[Path, str]] = []

    def _add(candidate: Path, default_tier: str) -> None:
        if not candidate.exists() or candidate.is_symlink() or not candidate.is_file():
            return
        rel_parts = candidate.relative_to(repo).parts
        if any(part in SKIP_DIRS for part in rel_parts[:-1]):
            return
        resolved = candidate.resolve()
        if resolved in seen:
            return
        seen.add(resolved)
        discovered.append((candidate, default_tier))

    for rel_path in ALWAYS_ON_REL_PATHS:
        _add(repo / rel_path, "always-on")

    clinerules = repo / ".clinerules"
    if clinerules.is_file():
        _add(clinerules, "always-on")
    elif clinerules.is_dir() and not clinerules.is_symlink():
        for child in sorted(clinerules.glob("*")):
            if child.suffix in {".md", ".mdc", ".txt"}:
                _add(child, "scoped-rule")

    for pattern in RULE_DIR_GLOBS:
        for match in sorted(repo.glob(pattern)):
            if match.suffix in {".md", ".mdc", ".txt"}:
                _add(match, "scoped-rule")

    for pattern in SKILL_GLOBS:
        for match in sorted(repo.glob(pattern)):
            _add(match, "on-demand-skill")

    catalog_dir = repo / "catalog"
    if catalog_dir.is_dir() and not catalog_dir.is_symlink():
        for match in sorted(catalog_dir.rglob("SKILL.md")):
            _add(match, "on-demand-skill")

    for pattern in SUBAGENT_GLOBS:
        for match in sorted(repo.glob(pattern)):
            _add(match, "isolated-subagent")

    return discovered


def _classify_effective_tier(default_tier: str, fm: dict[str, str]) -> str:
    if default_tier == "scoped-rule":
        always_apply = fm.get("alwaysApply", "").lower()
        apply_to = fm.get("applyTo", "").strip()
        inclusion = fm.get("inclusion", "").lower()
        if always_apply == "true" or apply_to in {"**", "**/*"} or inclusion == "always":
            return "always-on"
    return default_tier


def profile_repository(
    repo: Path,
    startup_budget: int = DEFAULT_STARTUP_BUDGET,
) -> dict[str, Any]:
    files_report: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []
    split_suggestions: list[dict[str, Any]] = []

    for file_path, raw_tier in _discover_context_files(repo):
        rel = file_path.relative_to(repo).as_posix()
        try:
            text = file_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        raw_lines = text.splitlines()
        line_count = len(raw_lines)
        word_count = len(text.split())
        total_tokens = estimate_tokens(text)
        fm, body = _parse_frontmatter(text)
        tier = _classify_effective_tier(raw_tier, fm)

        desc_tokens = estimate_tokens(fm.get("description", ""))
        if tier == "always-on":
            startup_tokens = total_tokens
        else:
            startup_tokens = desc_tokens if desc_tokens > 0 else min(total_tokens, 120)

        is_bloated = line_count > MAX_LINES_THRESHOLD or word_count > MAX_WORDS_THRESHOLD

        files_report.append(
            {
                "file": rel,
                "tier": tier,
                "lines": line_count,
                "words": word_count,
                "estimated_tokens": total_tokens,
                "startup_tokens": startup_tokens,
                "bloated": is_bloated,
            }
        )

        if is_bloated:
            severity = "error" if tier == "always-on" else "warning"
            findings.append(
                {
                    "file": rel,
                    "line": 1,
                    "rule": "bloated-context-file",
                    "severity": severity,
                    "impact": (
                        f"Context file '{rel}' ({line_count} lines, {word_count} words, "
                        f"~{total_tokens} tokens) exceeds the progressive-disclosure threshold "
                        f"({MAX_LINES_THRESHOLD} lines / {MAX_WORDS_THRESHOLD} words)."
                    ),
                }
            )

        if tier == "on-demand-skill":
            if line_count > SKILL_RECOMMENDED_LINES and not is_bloated:
                findings.append(
                    {
                        "file": rel,
                        "line": 1,
                        "rule": "skill-body-over-250-lines",
                        "severity": "warning",
                        "impact": (
                            f"Skill '{rel}' has {line_count} lines (recommended <= {SKILL_RECOMMENDED_LINES}); "
                            "extract deep lookup tables or templates into 'references/'."
                        ),
                    }
                )
            if desc_tokens > SKILL_L1_TOKEN_CAP:
                findings.append(
                    {
                        "file": rel,
                        "line": 1,
                        "rule": "skill-l1-description-over-budget",
                        "severity": "warning",
                        "impact": (
                            f"Skill '{rel}' frontmatter description consumes ~{desc_tokens} L1 tokens "
                            f"(cap <= {SKILL_L1_TOKEN_CAP} tokens)."
                        ),
                    }
                )

        needs_split_plan = is_bloated or (tier == "always-on" and line_count > 300)
        if needs_split_plan:
            heavy_sections = _extract_heavy_sections(body)
            base_parent = Path(rel).parent.as_posix()
            target_dir = "references" if base_parent == "." else f"{base_parent}/references"
            split_suggestions.append(
                {
                    "source_file": rel,
                    "tier": tier,
                    "current_tokens": total_tokens,
                    "recommended_target_dir": target_dir,
                    "strategy": (
                        "Keep core invariants and workflow commands in the entrypoint file; "
                        f"move detailed examples and lookup tables into '{target_dir}/' loaded on demand."
                    ),
                    "candidate_sections": heavy_sections,
                }
            )

    always_on_tokens = sum(
        item["startup_tokens"] for item in files_report if item["tier"] == "always-on"
    )
    routing_l1_tokens = sum(
        item["startup_tokens"] for item in files_report if item["tier"] != "always-on"
    )
    total_startup_tokens = always_on_tokens + routing_l1_tokens
    total_context_tokens = sum(item["estimated_tokens"] for item in files_report)

    if total_startup_tokens > startup_budget:
        findings.append(
            {
                "file": ".",
                "line": 1,
                "rule": "startup-token-budget-exceeded",
                "severity": "warning",
                "impact": (
                    f"Estimated startup context load (~{total_startup_tokens} tokens across always-on files "
                    f"and L1 skill descriptions) exceeds budget of {startup_budget} tokens."
                ),
            }
        )

    errors = sum(1 for f in findings if f["severity"] == "error")
    warnings = sum(1 for f in findings if f["severity"] == "warning")
    bloated_count = sum(1 for f in files_report if f["bloated"])
    status = "error" if errors > 0 else ("warn" if warnings > 0 else "ok")
    summary_text = (
        f"Profiled {len(files_report)} context file(s): ~{total_startup_tokens} startup tokens "
        f"(budget {startup_budget}), {bloated_count} bloated file(s), {errors} error(s), {warnings} warning(s)."
    )

    return {
        "skill": SKILL,
        "script": SCRIPT,
        "status": status,
        "summary": summary_text,
        "repo": repo.as_posix(),
        "findings": findings,
        "split_suggestions": split_suggestions,
        "data": {
            "files": files_report,
            "findings": findings,
            "split_suggestions": split_suggestions,
        },
        "metrics": {
            "files_scanned": len(files_report),
            "bloated_files": bloated_count,
            "always_on_tokens": always_on_tokens,
            "skill_l1_routing_tokens": routing_l1_tokens,
            "total_startup_tokens": total_startup_tokens,
            "total_on_disk_context_tokens": total_context_tokens,
            "startup_budget": startup_budget,
            "errors": errors,
            "warnings": warnings,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Profile AI agent instruction and skill token budgets across a repository."
    )
    parser.add_argument(
        "--repo",
        "--path",
        dest="repo",
        default=".",
        help="Repository root directory to profile.",
    )
    parser.add_argument(
        "--startup-budget",
        type=int,
        default=DEFAULT_STARTUP_BUDGET,
        help=f"Maximum recommended always-on + L1 startup token tax (default: {DEFAULT_STARTUP_BUDGET}).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="as_json",
        help="Emit structured JSON report.",
    )
    args = parser.parse_args(argv)

    repo = Path(args.repo)
    if not repo.is_dir():
        msg = f"Repository directory does not exist: {repo.as_posix()}"
        if args.as_json:
            print(
                json.dumps(
                    {
                        "skill": SKILL,
                        "script": SCRIPT,
                        "status": "error",
                        "summary": msg,
                        "repo": repo.as_posix(),
                        "findings": [],
                        "split_suggestions": [],
                        "data": {"files": [], "findings": [], "split_suggestions": []},
                        "metrics": {"files_scanned": 0, "errors": 1, "warnings": 0},
                    },
                    indent=2,
                )
            )
        else:
            sys.stderr.write(f"error: {msg}\n")
        return 2

    payload = profile_repository(repo, startup_budget=args.startup_budget)
    if args.as_json:
        print(json.dumps(payload, indent=2))
    else:
        sys.stdout.write(f"[{payload['status'].upper()}] {payload['summary']}\n")
        for item in payload["findings"]:
            sys.stdout.write(
                f"  - {item['file']}:{item['line']} [{item['severity']}] "
                f"{item['rule']}: {item['impact']}\n"
            )
    return 1 if payload["metrics"]["errors"] > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
