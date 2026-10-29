"""Unit and CLI smoke tests for the SkillOps Typer/Rich CLI entrypoint."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from typer.testing import CliRunner

from skillops import ExitCode, __version__
from skillops.cli import EvalMode, OutputFormat, RuntimeTarget, app

if TYPE_CHECKING:
    from pathlib import Path

runner = CliRunner()


def test_package_version_and_exit_codes() -> None:
    """Verify canonical package version and SKILL_CONTRACT.md exit code values."""
    assert __version__ == "0.2.0"
    assert int(ExitCode.SUCCESS) == 0
    assert int(ExitCode.ERROR) == 1
    assert int(ExitCode.COLLISION_ERROR) == 2
    assert int(ExitCode.BUDGET_OR_CONTRACT_ERROR) == 3
    assert int(ExitCode.EVAL_REGRESSION_ERROR) == 4


def test_enums_values() -> None:
    """Verify CLI enum options cover all supported formats, eval modes, and AI harnesses."""
    assert set(OutputFormat) == {
        OutputFormat.TABLE,
        OutputFormat.JSON,
        OutputFormat.MARKDOWN,
    }
    assert set(EvalMode) == {
        EvalMode.DETERMINISTIC,
        EvalMode.LIVE,
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


def test_cli_help_lists_all_six_canonical_commands() -> None:
    """Verify `skillops --help` exposes all 6 SKILL_CONTRACT.md subcommands."""
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for command in ("audit", "route", "sync", "eval", "serve", "mcp"):
        assert command in result.stdout


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
        ],
    )
    assert json_result.exit_code == int(ExitCode.SUCCESS)
    payload = json.loads(json_result.stdout)
    assert payload["command"] == "audit"
    assert payload["status"] == "ok"
    assert payload["strict"] is True
    assert payload["thresholds"]["collision_warn"] == 0.78
    assert payload["thresholds"]["collision_error"] == 0.85

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


def test_eval_command_deterministic_and_live_modes() -> None:
    """Verify `skillops eval` supports deterministic and live OpenAI Agents SDK modes."""
    det_result = runner.invoke(
        app,
        [
            "eval",
            "--skill",
            "mcp-architect",
            "--mode",
            "deterministic",
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
    assert payload["mode"] == "deterministic"
    assert payload["trials"] == 3

    table_result = runner.invoke(
        app,
        ["eval", "--all", "--mode", "live", "--model", "gpt-4.1-mini"],
    )
    assert table_result.exit_code == int(ExitCode.SUCCESS)
    assert "SkillOps TDD Evaluation Engine" in table_result.stdout


def test_serve_command_enforces_localhost_isolation() -> None:
    """Verify `skillops serve` enforces localhost binding (127.0.0.1 / localhost) by default."""
    ok_result = runner.invoke(
        app,
        ["serve", "--host", "127.0.0.1", "--port", "8080", "--dry-run", "--format", "json"],
    )
    assert ok_result.exit_code == int(ExitCode.SUCCESS)
    payload = json.loads(ok_result.stdout)
    assert payload["command"] == "serve"
    assert payload["host"] == "127.0.0.1"
    assert payload["port"] == 8080

    unsafe_result = runner.invoke(
        app,
        ["serve", "--host", "0.0.0.0", "--port", "8080", "--dry-run"],
    )
    assert unsafe_result.exit_code == int(ExitCode.ERROR)


def test_mcp_command_stdio_and_sse() -> None:
    """Verify `skillops mcp` supports stdio and sse transports in dry-run/status mode."""
    result = runner.invoke(
        app,
        ["mcp", "--transport", "stdio", "--dry-run", "--format", "json"],
    )
    assert result.exit_code == int(ExitCode.SUCCESS)
    payload = json.loads(result.stdout)
    assert payload["command"] == "mcp"
    assert payload["transport"] == "stdio"
    assert "audit_skill_catalog" in payload["exposed_tools"]
