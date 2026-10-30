"""Unit and CLI smoke tests for the SkillOps Typer/Rich CLI entrypoint."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from typer.testing import CliRunner

from skillops import ExitCode, __version__
from skillops.cli import McpTransport, OutputFormat, RuntimeTarget, app

if TYPE_CHECKING:
    from pathlib import Path

runner = CliRunner()


def test_package_version_and_exit_codes() -> None:
    """Verify canonical package version and SKILL_CONTRACT.md exit code values."""
    assert __version__ == "0.3.0"
    assert int(ExitCode.SUCCESS) == 0
    assert int(ExitCode.ERROR) == 1
    assert int(ExitCode.COLLISION_ERROR) == 2
    assert int(ExitCode.BUDGET_OR_CONTRACT_ERROR) == 3
    assert int(ExitCode.EVAL_REGRESSION_ERROR) == 4


def test_enums_values() -> None:
    """Verify CLI enum options cover all supported formats, MCP stdio, and AI harnesses."""
    assert set(OutputFormat) == {
        OutputFormat.TABLE,
        OutputFormat.JSON,
        OutputFormat.MARKDOWN,
    }
    assert set(McpTransport) == {
        McpTransport.STDIO,
    }
    assert {target.value for target in RuntimeTarget} == {
        "claude",
        "antigravity",
        "cursor",
        "codex",
        "copilot",
    }


def test_cli_version_flag() -> None:
    """Verify `skillops --version` and `-V` print the canonical version and exit 0."""
    for flag in ("--version", "-V"):
        result = runner.invoke(app, [flag])
        assert result.exit_code == 0
        assert f"SkillOps v{__version__}" in result.stdout


def test_cli_help_lists_all_canonical_commands() -> None:
    """Verify `skillops --help` exposes all zero-API SKILL_CONTRACT.md subcommands."""
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for command in ("init", "audit", "route", "sync", "eval", "mcp"):
        assert command in result.stdout
    assert runner.invoke(app, ["serve"]).exit_code != 0


def test_init_command_scaffolds_workspace(tmp_path: Path) -> None:
    """Verify `skillops init` scaffolds .skillops.yml and catalog track folders."""
    result = runner.invoke(
        app,
        ["init", "--target-dir", str(tmp_path), "--format", "json"],
    )
    assert result.exit_code == int(ExitCode.SUCCESS)
    payload = json.loads(result.stdout)
    assert payload["command"] == "init"
    assert (tmp_path / ".skillops.yml").exists()
    assert (tmp_path / "catalog" / "ai-engineering").is_dir()
    assert (tmp_path / "catalog" / "python-backend").is_dir()
    assert (tmp_path / "catalog" / "arch-quality").is_dir()


def test_audit_command_on_reference_catalog_and_violations(tmp_path: Path) -> None:
    """Verify `skillops audit` validates reference catalog skills and detects violations."""
    real_audit = runner.invoke(
        app,
        [
            "audit",
            "--catalog",
            "catalog",
            "--format",
            "json",
            "--strict",
            "--require-layout",
        ],
    )
    assert real_audit.exit_code == int(ExitCode.SUCCESS)
    real_payload = json.loads(real_audit.stdout)
    assert real_payload["audited_skills"] >= 4
    assert real_payload["collisions_found"] == 0
    assert real_payload["total_l3_scripts_tokens_saved"] > 2000
    assert len(real_payload["skills"]) >= 4
    assert real_payload["status"] == "ok"

    real_table = runner.invoke(
        app,
        ["audit", "--catalog", "catalog", "--format", "table"],
    )
    assert real_table.exit_code == int(ExitCode.SUCCESS)
    assert "3-Level Progressive Disclosure Token Budgets" in real_table.stdout

    real_md = runner.invoke(
        app,
        ["audit", "--catalog", "catalog", "--format", "markdown"],
    )
    assert real_md.exit_code == int(ExitCode.SUCCESS)
    assert "## 3-Level Progressive Disclosure Budget Matrix" in real_md.stdout
    assert "_No semantic collisions detected._" in real_md.stdout

    bundle_overflow = runner.invoke(
        app,
        [
            "audit",
            "--catalog",
            "catalog",
            "--max-l1-tokens",
            "50",
            "--format",
            "json",
        ],
    )
    assert bundle_overflow.exit_code == int(ExitCode.BUDGET_OR_CONTRACT_ERROR)
    overflow_payload = json.loads(bundle_overflow.stdout)
    assert overflow_payload["status"] == "budget_violation"

    bad_catalog = tmp_path / "bad_catalog" / "ai-engineering" / "broken-skill"
    bad_catalog.mkdir(parents=True)
    (bad_catalog / "SKILL.md").write_text("# Missing frontmatter\n", encoding="utf-8")
    bad_result = runner.invoke(
        app,
        ["audit", "--catalog", str(tmp_path / "bad_catalog")],
    )
    assert bad_result.exit_code == int(ExitCode.BUDGET_OR_CONTRACT_ERROR)

    dup_root = tmp_path / "dup_catalog" / "ai-engineering"
    desc = (
        "Use when designing, implementing, or auditing Model Context Protocol (MCP) servers "
        "and FastMCP tools in Python or TypeScript to enforce strict JSON-RPC stdio hygiene, "
        "Pydantic input schemas, tool docstring clarity, and localhost-bound SSE transport "
        "security without polluting stdout or exposing untyped tool handlers to AI coding agents."
    )
    for skill_name in ("mcp-alpha", "mcp-beta"):
        sdir = dup_root / skill_name
        (sdir / "scripts").mkdir(parents=True)
        (sdir / "scripts" / "check.py").write_text('"""Check."""\n', encoding="utf-8")
        (sdir / "SKILL.md").write_text(
            f"---\nname: {skill_name}\ndescription: {desc}\ntrack: ai-engineering\n"
            "tags: [mcp]\nentrypoints:\n  scripts:\n    - path: scripts/check.py\n"
            "      description: Check MCP server tool annotations.\n---\n# Body\n",
            encoding="utf-8",
        )
    dup_result = runner.invoke(
        app,
        ["audit", "--catalog", str(tmp_path / "dup_catalog"), "--strict", "--format", "json"],
    )
    assert dup_result.exit_code == int(ExitCode.COLLISION_ERROR)
    dup_payload = json.loads(dup_result.stdout)
    assert dup_payload["status"] == "collision_detected"
    assert len(dup_payload["collisions"]) == 1

    dup_table = runner.invoke(
        app,
        ["audit", "--catalog", str(tmp_path / "dup_catalog"), "--format", "table"],
    )
    assert dup_table.exit_code == int(ExitCode.COLLISION_ERROR)
    assert "Pairwise Semantic Collisions" in dup_table.stdout

    dup_md = runner.invoke(
        app,
        ["audit", "--catalog", str(tmp_path / "dup_catalog"), "--format", "markdown"],
    )
    assert dup_md.exit_code == int(ExitCode.COLLISION_ERROR)
    assert "| `mcp-alpha` | `mcp-beta` |" in dup_md.stdout


def test_audit_command_json_and_table_modes(tmp_path: Path) -> None:
    """Verify `skillops audit` supports both JSON and Rich table/markdown outputs."""
    catalog_dir = tmp_path / "catalog"
    catalog_dir.mkdir()

    json_result = runner.invoke(
        app,
        [
            "audit",
            "--catalog",
            str(catalog_dir),
            "--format",
            "json",
            "--strict",
            "--max-similarity",
            "0.80",
        ],
    )
    assert json_result.exit_code == int(ExitCode.SUCCESS)
    payload = json.loads(json_result.stdout)
    assert payload["command"] == "audit"
    assert payload["status"] == "ok"
    assert payload["strict"] is True
    assert payload["thresholds"]["collision_warn"] == 0.58
    assert payload["thresholds"]["collision_high_risk"] == 0.72
    assert payload["thresholds"]["collision_error"] == 0.80

    table_result = runner.invoke(
        app,
        ["audit", "--catalog", str(catalog_dir), "--format", "table"],
    )
    assert table_result.exit_code == int(ExitCode.SUCCESS)
    assert "SkillOps Semantic Collision & Token Budget Auditor" in table_result.stdout

    md_result = runner.invoke(
        app,
        ["audit", "--catalog", str(catalog_dir), "--format", "markdown"],
    )
    assert md_result.exit_code == int(ExitCode.SUCCESS)
    assert "# SkillOps Audit Report" in md_result.stdout


def test_route_command_json_and_table_modes(tmp_path: Path) -> None:
    """Verify `skillops route` fingerprints target repo parameters and respects max_skills."""
    json_result = runner.invoke(
        app,
        [
            "route",
            "--repo",
            str(tmp_path),
            "--max-skills",
            "8",
            "--format",
            "json",
        ],
    )
    assert json_result.exit_code == int(ExitCode.SUCCESS)
    payload = json.loads(json_result.stdout)
    assert payload["command"] == "route"
    assert payload["max_skills"] == 8
    assert payload["status"] == "ok"

    table_result = runner.invoke(
        app,
        ["route", "--repo", str(tmp_path), "--format", "table"],
    )
    assert table_result.exit_code == int(ExitCode.SUCCESS)
    assert "SkillOps Context-Aware Repository Router" in table_result.stdout


def test_sync_command_valid_and_invalid_targets(tmp_path: Path) -> None:
    """Verify `skillops sync` validates multi-runtime harness targets."""
    ok_result = runner.invoke(
        app,
        [
            "sync",
            "--repo",
            str(tmp_path),
            "--targets",
            "claude,antigravity,cursor,codex,copilot",
            "--dry-run",
            "--format",
            "json",
        ],
    )
    assert ok_result.exit_code == int(ExitCode.SUCCESS)
    payload = json.loads(ok_result.stdout)
    assert payload["command"] == "sync"
    assert payload["dry_run"] is True
    assert payload["targets"] == [
        "claude",
        "antigravity",
        "cursor",
        "codex",
        "copilot",
    ]

    bad_result = runner.invoke(
        app,
        ["sync", "--repo", str(tmp_path), "--targets", "claude,unknown-harness"],
    )
    assert bad_result.exit_code == int(ExitCode.ERROR)


def test_eval_command_zero_api_deterministic_mode() -> None:
    """Verify `skillops eval` executes in 100% zero-API deterministic mode."""
    det_result = runner.invoke(
        app,
        [
            "eval",
            "--skill",
            "mcp-architect",
            "--trials",
            "3",
            "--format",
            "json",
        ],
    )
    assert det_result.exit_code == int(ExitCode.SUCCESS)
    payload = json.loads(det_result.stdout)
    assert payload["command"] == "eval"
    assert payload["skill"] == "mcp-architect"
    assert payload["runner"] == "deterministic-ast"
    assert payload["trials"] == 3

    table_result = runner.invoke(
        app,
        ["eval", "--all"],
    )
    assert table_result.exit_code == int(ExitCode.SUCCESS)
    assert "SkillOps Zero-API TDD Evaluation Engine" in table_result.stdout


def test_mcp_command_stdio() -> None:
    """Verify `skillops mcp` supports zero-API local stdio transport."""
    result = runner.invoke(
        app,
        ["mcp", "--transport", "stdio", "--dry-run", "--format", "json"],
    )
    assert result.exit_code == int(ExitCode.SUCCESS)
    payload = json.loads(result.stdout)
    assert payload["command"] == "mcp"
    assert payload["transport"] == "stdio"
    assert "audit_skill_catalog" in payload["exposed_tools"]
