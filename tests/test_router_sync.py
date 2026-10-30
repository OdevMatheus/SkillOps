"""End-to-end CLI tests for `skillops route` and `skillops sync` (Issue #57)."""

from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from skillops import ExitCode
from skillops.cli import app
from skillops.models import SyncLockfile
from skillops.sync import LOCKFILE_NAME

runner = CliRunner()
REPO_ROOT = Path(__file__).resolve().parents[1]
CATALOG_ROOT = REPO_ROOT / "catalog"


def _create_fastapi_repo(repo_dir: Path) -> None:
    repo_dir.mkdir(parents=True, exist_ok=True)
    (repo_dir / "pyproject.toml").write_text(
        '[project]\nname = "demo-service"\nrequires-python = ">=3.12"\n'
        'dependencies = ["fastapi>=0.115.0", "sqlalchemy>=2.0.0", "mcp>=1.0.0"]\n',
        encoding="utf-8",
    )
    (repo_dir / "app.py").write_text(
        "import asyncio\nfrom fastapi import FastAPI\napp = FastAPI()\n",
        encoding="utf-8",
    )


def test_cli_route_json_table_and_markdown(tmp_path: Path) -> None:
    """Verify `skillops route` outputs valid JSON, Rich Table, and Markdown reports."""
    repo_dir = tmp_path / "service_repo"
    _create_fastapi_repo(repo_dir)

    json_res = runner.invoke(
        app,
        [
            "route",
            "--repo",
            str(repo_dir),
            "--catalog",
            str(CATALOG_ROOT),
            "--max-skills",
            "8",
            "--task",
            "audit fastapi routes and sql queries",
            "--format",
            "json",
        ],
    )
    assert json_res.exit_code == int(ExitCode.SUCCESS)
    payload = json.loads(json_res.stdout)
    assert payload["command"] == "route"
    assert payload["status"] == "ok"
    assert payload["total_l1_tokens"] <= 1500
    assert payload["max_pairwise_similarity"] < 0.78
    selected_names = [item["name"] for item in payload["selected_skills"]]
    assert "fastapi-production" in selected_names
    assert "postgres-query-doctor" in selected_names

    table_res = runner.invoke(
        app,
        [
            "route",
            "--repo",
            str(repo_dir),
            "--catalog",
            str(CATALOG_ROOT),
            "--format",
            "table",
        ],
    )
    assert table_res.exit_code == int(ExitCode.SUCCESS)
    assert "SkillOps Context-Aware Repository Router" in table_res.stdout
    assert "Selected Collision-Free Skill Bundle" in table_res.stdout

    md_res = runner.invoke(
        app,
        [
            "route",
            "--repo",
            str(repo_dir),
            "--catalog",
            str(CATALOG_ROOT),
            "--max-skills",
            "1",
            "--format",
            "markdown",
        ],
    )
    assert md_res.exit_code == int(ExitCode.SUCCESS)
    assert "# SkillOps Route Bundle" in md_res.stdout
    assert "## Selected Collision-Free Skill Bundle" in md_res.stdout
    assert "## Skipped Catalog Skills" in md_res.stdout


def test_cli_sync_dry_run_and_multi_format_lockfile_verification(tmp_path: Path) -> None:
    """Verify `skillops sync` supports dry-run, table/markdown/json, and drift exit codes."""
    repo_dir = tmp_path / "sync_repo"
    _create_fastapi_repo(repo_dir)

    # 1. Dry-run in Markdown format
    dry_md = runner.invoke(
        app,
        [
            "sync",
            "--repo",
            str(repo_dir),
            "--catalog",
            str(CATALOG_ROOT),
            "--targets",
            "cursor,copilot",
            "--dry-run",
            "--format",
            "markdown",
        ],
    )
    assert dry_md.exit_code == int(ExitCode.SUCCESS)
    assert "# SkillOps Sync Report" in dry_md.stdout
    assert "**planned**" in dry_md.stdout
    assert not (repo_dir / LOCKFILE_NAME).exists()

    # 2. Real sync across all 5 targets in Table format
    sync_table = runner.invoke(
        app,
        [
            "sync",
            "--repo",
            str(repo_dir),
            "--catalog",
            str(CATALOG_ROOT),
            "--targets",
            "claude,antigravity,cursor,codex,copilot",
            "--format",
            "table",
        ],
    )
    assert sync_table.exit_code == int(ExitCode.SUCCESS)
    assert "SkillOps Multi-Runtime Transpiler & Sync" in sync_table.stdout
    assert "Transpiled Runtime Artifacts" in sync_table.stdout

    lockfile_path = repo_dir / LOCKFILE_NAME
    assert lockfile_path.is_file()
    lockfile = SyncLockfile.model_validate_json(lockfile_path.read_text(encoding="utf-8"))
    assert len(lockfile.artifacts) > 0
    assert (repo_dir / ".claude/skills/fastapi-production/SKILL.md").is_file()
    assert (repo_dir / ".agent/skills/fastapi-production/SKILL.md").is_file()
    assert (repo_dir / ".cursor/rules/fastapi-production.mdc").is_file()
    assert (repo_dir / ".codex/skills/fastapi-production/SKILL.md").is_file()
    assert (repo_dir / "AGENTS.md").is_file()
    assert (repo_dir / ".github/instructions/fastapi-production.instructions.md").is_file()
    assert (repo_dir / ".github/prompts/fastapi-production.prompt.md").is_file()

    # 3. Introduce local drift and verify CLI exits with ExitCode.ERROR (1) without --force
    cursor_rule = repo_dir / ".cursor/rules/fastapi-production.mdc"
    cursor_rule.write_text("# Drifted local edit\n", encoding="utf-8")

    drift_res = runner.invoke(
        app,
        [
            "sync",
            "--repo",
            str(repo_dir),
            "--catalog",
            str(CATALOG_ROOT),
            "--targets",
            "cursor",
            "--format",
            "json",
        ],
    )
    assert drift_res.exit_code == int(ExitCode.ERROR)
    drift_payload = json.loads(drift_res.stdout)
    assert drift_payload["status"] == "drift_conflict"
    assert ".cursor/rules/fastapi-production.mdc" in drift_payload["drift_conflicts"]

    # 4. Re-run with --force and verify CLI exits 0 and resolves drift
    force_res = runner.invoke(
        app,
        [
            "sync",
            "--repo",
            str(repo_dir),
            "--catalog",
            str(CATALOG_ROOT),
            "--targets",
            "cursor",
            "--force",
            "--format",
            "json",
        ],
    )
    assert force_res.exit_code == int(ExitCode.SUCCESS)
    force_payload = json.loads(force_res.stdout)
    assert force_payload["status"] == "ok"
    assert force_payload["drift_conflicts"] == []
