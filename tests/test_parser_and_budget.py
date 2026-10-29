"""Unit tests for `skillops.auditor.parser` and `skillops.auditor.token_budget` (Issue #49)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from skillops.auditor import (
    analyze_catalog_budgets,
    analyze_parsed_skill_budget,
    analyze_skill_budget,
    count_fenced_code_lines,
    detect_description_workflow_leak,
    discover_skill_directories,
    parse_skill_directory,
    parse_skill_file,
    split_skill_md,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
CATALOG_DIR = REPO_ROOT / "catalog"

SAMPLE_DESCRIPTION = (
    "Use when designing, implementing, or auditing Model Context Protocol (MCP) servers "
    "and FastMCP tools in Python or TypeScript to enforce strict JSON-RPC stdio hygiene, "
    "Pydantic input schemas, tool docstring clarity, and localhost-bound SSE transport "
    "security without polluting stdout or exposing untyped tool handlers to AI coding agents."
)


def _write_minimal_skill_md(
    skill_dir: Path,
    *,
    name: str = "sample-skill",
    description: str = SAMPLE_DESCRIPTION,
    include_negative_triggers: bool = True,
    body: str = "# Sample Skill\n\nConcise operational body.\n",
) -> Path:
    skill_dir.mkdir(parents=True, exist_ok=True)
    neg_block = (
        "  negative_triggers:\n    - Do not trigger on static HTML files.\n"
        if include_negative_triggers
        else "  negative_triggers: []\n"
    )
    content = (
        "---\n"
        f"name: {name}\n"
        f"description: >-\n  {description}\n"
        "version: 1.0.0\n"
        "track: ai-engineering\n"
        "tags:\n"
        "  - mcp\n"
        "routing_signals:\n"
        "  languages:\n"
        "    - python\n"
        f"{neg_block}"
        "entrypoints:\n"
        "  scripts:\n"
        "    - path: scripts/check_tool.py\n"
        "      description: Deterministic AST checker for sample skill.\n"
        "---\n"
        f"{body}"
    )
    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text(content, encoding="utf-8")
    return skill_md


def _write_minimal_evals(skill_dir: Path, *, skill_name: str = "sample-skill") -> None:
    evals_dir = skill_dir / "evals"
    evals_dir.mkdir(parents=True, exist_ok=True)
    evals_payload = {
        "skill_name": skill_name,
        "schema_version": "1.0",
        "evals": [
            {
                "id": "eval-01",
                "name": "Run deterministic checker",
                "prompt": "Audit the target Python module using the sample skill checker.",
                "fixtures": [],
                "assertions": [
                    {
                        "id": "assert-01",
                        "type": "tool_call_contains",
                        "target": "check_tool.py",
                        "description": "Invokes check_tool.py.",
                    }
                ],
            }
        ],
    }
    (evals_dir / "evals.json").write_text(json.dumps(evals_payload, indent=2), encoding="utf-8")


def test_split_skill_md_valid_and_invalid_cases() -> None:
    """Verify split_skill_md extracts YAML frontmatter or raises descriptive ValueErrors."""
    raw = "---\nname: demo\ntrack: ai-engineering\n---\n# Heading\nLine 2\n"
    fm, body, total_lines = split_skill_md(raw, source="demo/SKILL.md")
    assert fm["name"] == "demo"
    assert body.startswith("# Heading")
    assert total_lines == 6

    with pytest.raises(ValueError, match="missing valid YAML frontmatter"):
        split_skill_md("# No frontmatter here\n", source="broken/SKILL.md")

    with pytest.raises(ValueError, match="Invalid YAML syntax"):
        split_skill_md("---\nname: [unclosed\n---\n# Body\n", source="bad_yaml/SKILL.md")

    with pytest.raises(ValueError, match="must deserialize to a mapping"):
        split_skill_md("---\n- item1\n- item2\n---\n# Body\n", source="list_yaml/SKILL.md")


def test_parse_skill_file_and_discover_directories(tmp_path: Path) -> None:
    """Verify parse_skill_file and discover_skill_directories handle missing and valid paths."""
    with pytest.raises(ValueError, match=r"SKILL\.md file not found"):
        parse_skill_file(tmp_path / "nonexistent" / "SKILL.md")

    assert discover_skill_directories(tmp_path / "missing_catalog") == []

    discovered = discover_skill_directories(CATALOG_DIR)
    assert len(discovered) >= 4
    names = [d.name for d in discovered]
    assert "mcp-architect" in names
    assert "ast-blast-radius" in names


def test_parse_skill_directory_layout_validations(tmp_path: Path) -> None:
    """Verify parse_skill_directory enforces directory naming, scripts, and eval contracts."""
    empty_dir = tmp_path / "empty-skill"
    empty_dir.mkdir()
    with pytest.raises(ValueError, match=r"SKILL\.md file not found in skill directory"):
        parse_skill_directory(empty_dir)

    mismatched_dir = tmp_path / "wrong-folder-name"
    _write_minimal_skill_md(mismatched_dir, name="sample-skill")
    with pytest.raises(ValueError, match="does not match manifest name"):
        parse_skill_directory(mismatched_dir, require_layout=True)

    skill_dir = tmp_path / "sample-skill"
    skill_md = _write_minimal_skill_md(skill_dir, name="sample-skill")

    # Missing declared script when require_layout=True
    with pytest.raises(ValueError, match="declares missing entrypoint script"):
        parse_skill_directory(skill_dir, require_layout=True)

    # Create declared script, extra script, and __init__.py
    scripts_dir = skill_dir / "scripts"
    scripts_dir.mkdir()
    (scripts_dir / "check_tool.py").write_text("print('ok')\n", encoding="utf-8")
    (scripts_dir / "extra_helper.py").write_text("x = 1\n", encoding="utf-8")
    (scripts_dir / "__init__.py").write_text("", encoding="utf-8")

    # Missing evals/evals.json when require_layout=True
    with pytest.raises(ValueError, match="missing required TDD evaluation suite"):
        parse_skill_directory(skill_md, require_layout=True)

    # Write evals.json with mismatched skill_name
    _write_minimal_evals(skill_dir, skill_name="other-skill")
    with pytest.raises(ValueError, match="EvalSuite skill_name 'other-skill'"):
        parse_skill_directory(skill_dir, require_layout=True, validate_evals=True)

    # Fix evals.json and write mismatched benchmark.json
    _write_minimal_evals(skill_dir, skill_name="sample-skill")
    bench_payload = {
        "skill_name": "wrong-bench-skill",
        "runner": "deterministic-ast",
        "timestamp": "2026-10-29T12:00:00Z",
        "with_skill": {"pass_rate_mean": 0.95, "tokens_mean": 2000, "latency_ms_mean": 1000},
        "without_skill": {"pass_rate_mean": 0.50, "tokens_mean": 4000, "latency_ms_mean": 2000},
        "delta": {
            "pass_rate_gain": 0.45,
            "token_reduction_pct": -50.0,
            "verdict": "CERTIFIED_IMPROVEMENT",
        },
    }
    (skill_dir / "evals" / "benchmark.json").write_text(
        json.dumps(bench_payload, indent=2),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="BenchmarkReport skill_name 'wrong-bench-skill'"):
        parse_skill_directory(skill_dir, require_layout=True, validate_evals=True)

    # Fix benchmark.json and add a reference file
    bench_payload["skill_name"] = "sample-skill"
    (skill_dir / "evals" / "benchmark.json").write_text(
        json.dumps(bench_payload, indent=2),
        encoding="utf-8",
    )
    refs_dir = skill_dir / "references"
    refs_dir.mkdir()
    (refs_dir / "patterns.md").write_text("# Deep Reference\nDetails here.\n", encoding="utf-8")

    parsed = parse_skill_directory(skill_md, require_layout=True, validate_evals=True)
    assert parsed.manifest.name == "sample-skill"
    assert len(parsed.declared_scripts) == 1
    assert len(parsed.extra_scripts) == 1
    assert parsed.extra_scripts[0].name == "extra_helper.py"
    assert len(parsed.reference_files) == 1
    assert parsed.eval_suite is not None
    assert parsed.benchmark_report is not None

    budget = analyze_skill_budget(skill_dir, require_layout=True, validate_evals=True)
    assert budget.within_budget is True
    assert budget.l3_references_count == 1
    assert budget.l3_reference_tokens > 0


def test_budget_lint_helpers_and_warnings(tmp_path: Path) -> None:
    """Verify inline fenced code line counting, workflow leak detection, and budget warnings."""
    md_body = (
        "# Workflow\n\n"
        "```python\n"
        "line1 = 1\n"
        "line2 = 2\n"
        "line3 = 3\n"
        "```\n"
        "\nSome prose.\n\n"
        "```bash\n"
        "echo hello\n"
        "```\n"
    )
    assert count_fenced_code_lines(md_body) == 4
    assert detect_description_workflow_leak("Use when testing. Step 1: run linter.")
    assert not detect_description_workflow_leak(SAMPLE_DESCRIPTION)

    skill_dir = tmp_path / "leaky-skill"
    leaky_desc = (
        "Use when designing, implementing, or auditing Model Context Protocol (MCP) servers "
        "and FastMCP tools in Python or TypeScript. Step 1: First, run the AST validator "
        "to enforce strict JSON-RPC stdio hygiene, Pydantic input schemas, tool docstring "
        "clarity, and localhost-bound SSE transport security without polluting stdout."
    )
    big_code_body = "# Leaky Skill\n\n```python\n" + "\n".join(["x = 1"] * 65) + "\n```\n"
    _write_minimal_skill_md(
        skill_dir,
        name="leaky-skill",
        description=leaky_desc,
        include_negative_triggers=False,
        body=big_code_body,
    )
    scripts_dir = skill_dir / "scripts"
    scripts_dir.mkdir()
    (scripts_dir / "unlisted.py").write_text("y = 2\n", encoding="utf-8")

    parsed = parse_skill_directory(skill_dir, require_layout=False, validate_evals=False)
    metrics = analyze_parsed_skill_budget(
        parsed,
        max_l1_tokens=50,
        max_l2_lines=30,
        max_l2_tokens=50,
        max_inline_code_lines=60,
    )
    assert not metrics.within_budget
    assert len(metrics.violations) == 4  # l1_tokens, l2_lines, l2_tokens, missing_scripts
    assert len(metrics.warnings) == 4  # negative_triggers, workflow_leak, inline_code, extra_script


def test_analyze_catalog_budgets_on_reference_catalog() -> None:
    """Verify analyze_catalog_budgets succeeds across the reference catalog/."""
    summary = analyze_catalog_budgets(CATALOG_DIR, require_layout=True, validate_evals=True)
    assert summary.total_skills >= 4
    assert summary.within_budget is True
    assert summary.total_l1_tokens <= summary.max_bundle_tokens
    assert summary.total_l3_scripts_tokens_saved > 500
    for skill_metric in summary.skills:
        assert skill_metric.within_budget is True
        assert skill_metric.l3_scripts_count >= 1
        assert skill_metric.l3_scripts_tokens > 0
        assert not skill_metric.violations
