"""Unit tests for MultiRuntimeTranspiler and runtime adapters (Issue #56)."""

from __future__ import annotations

from pathlib import Path

import yaml

from skillops.auditor.parser import discover_skill_directories, parse_skill_directory
from skillops.models import RuntimeTarget, SyncLockfile
from skillops.sync import (
    CODEX_MARKER_END,
    CODEX_MARKER_START,
    LOCKFILE_NAME,
    MultiRuntimeTranspiler,
    compute_sha256,
    derive_globs_for_skill,
    render_codex_agents_index,
    sync_repository,
    transpile_antigravity,
    transpile_claude,
    transpile_codex,
    transpile_copilot,
    transpile_cursor,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
CATALOG_ROOT = REPO_ROOT / "catalog"


def _write_synthetic_skill(
    catalog_dir: Path,
    *,
    track: str = "python-backend",
    name: str,
    description: str,
    languages: list[str] | None = None,
    files_any: list[str] | None = None,
    with_reference: bool = False,
) -> Path:
    skill_dir = catalog_dir / track / name
    scripts_dir = skill_dir / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    script_path = scripts_dir / "check_tool.py"
    script_path.write_text('"""Deterministic helper script."""\nprint("ok")\n', encoding="utf-8")

    if with_reference:
        refs_dir = skill_dir / "references"
        refs_dir.mkdir(parents=True, exist_ok=True)
        (refs_dir / "guide.md").write_text("# Reference Guide\n\nDetails.\n", encoding="utf-8")

    frontmatter = {
        "name": name,
        "description": description,
        "version": "1.0.0",
        "track": track,
        "tags": [name, track],
        "routing_signals": {
            "languages": languages if languages is not None else [],
            "files_any": files_any if files_any is not None else [],
            "dependencies_any": ["fastapi"],
            "negative_triggers": [],
        },
        "entrypoints": {
            "scripts": [
                {
                    "path": "scripts/check_tool.py",
                    "description": "Deterministic static verifier script for testing.",
                }
            ]
        },
    }
    yaml_str = yaml.safe_dump(frontmatter, sort_keys=False).strip()
    skill_md = f"---\n{yaml_str}\n---\n\n# {name}\n\nPlaybook instructions for `{name}`.\n"
    (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
    return skill_dir


def test_individual_runtime_adapters_on_catalog_skill() -> None:
    """Verify all 5 runtime adapters produce valid native artifacts for a catalog skill."""
    skills = [parse_skill_directory(d) for d in discover_skill_directories(CATALOG_ROOT)]
    fastapi_skill = next(s for s in skills if s.manifest.name == "fastapi-production")

    claude_items = transpile_claude(fastapi_skill)
    claude_paths = {item.relative_path for item in claude_items}
    assert ".claude/skills/fastapi-production/SKILL.md" in claude_paths
    assert ".claude/skills/fastapi-production/scripts/audit_fastapi_routes.py" in claude_paths

    agy_items = transpile_antigravity(fastapi_skill)
    agy_paths = {item.relative_path for item in agy_items}
    assert ".agent/skills/fastapi-production/SKILL.md" in agy_paths
    assert ".agent/skills/fastapi-production/scripts/audit_fastapi_routes.py" in agy_paths

    cursor_items = transpile_cursor(fastapi_skill)
    assert len(cursor_items) == 1
    mdc = cursor_items[0]
    assert mdc.relative_path == ".cursor/rules/fastapi-production.mdc"
    assert "alwaysApply: false" in mdc.content
    assert "globs:" in mdc.content
    assert "**/*.py" in mdc.content
    assert "scripts/audit_fastapi_routes.py" in mdc.content

    codex_items = transpile_codex(fastapi_skill)
    codex_paths = {item.relative_path for item in codex_items}
    assert ".codex/skills/fastapi-production/SKILL.md" in codex_paths
    assert ".codex/skills/fastapi-production/scripts/audit_fastapi_routes.py" in codex_paths

    index_artifact = render_codex_agents_index([fastapi_skill])
    assert index_artifact.relative_path == "AGENTS.md"
    assert CODEX_MARKER_START in index_artifact.content
    assert CODEX_MARKER_END in index_artifact.content
    assert ".codex/skills/fastapi-production/SKILL.md" in index_artifact.content

    copilot_items = transpile_copilot(fastapi_skill)
    copilot_by_path = {item.relative_path: item for item in copilot_items}
    assert ".github/instructions/fastapi-production.instructions.md" in copilot_by_path
    assert ".github/prompts/fastapi-production.prompt.md" in copilot_by_path
    assert (
        "applyTo:"
        in copilot_by_path[".github/instructions/fastapi-production.instructions.md"].content
    )
    assert (
        "mode: agent" in copilot_by_path[".github/prompts/fastapi-production.prompt.md"].content
        or 'mode: "agent"'
        in copilot_by_path[".github/prompts/fastapi-production.prompt.md"].content
    )


def test_derive_globs_and_references_copy(tmp_path: Path) -> None:
    """Verify fallback glob generation and copying of Level 3 reference markdown files."""
    desc = (
        "Use when auditing generic polyglot repositories for structural invariants, "
        "verifying static rules, inspecting configuration layouts, and running "
        "deterministic verification scripts across clean workspace directories. "
        "Do not use when performing runtime load testing, executing external network "
        "calls, or modifying production database schemas without static verification."
    )
    skill_dir = _write_synthetic_skill(
        tmp_path / "catalog",
        name="generic-checker",
        description=desc,
        languages=[],
        files_any=[],
        with_reference=True,
    )
    parsed = parse_skill_directory(skill_dir, require_layout=False, validate_evals=False)
    assert derive_globs_for_skill(parsed) == ["**/*"]

    claude_artifacts = transpile_claude(parsed)
    rel_paths = {item.relative_path for item in claude_artifacts}
    assert ".claude/skills/generic-checker/references/guide.md" in rel_paths


def test_sync_repository_idempotency_and_dry_run(tmp_path: Path) -> None:
    """Verify dry-run writes nothing, initial sync creates lockfile, and repeat sync works."""
    target_repo = tmp_path / "target_app"
    target_repo.mkdir()
    (target_repo / "pyproject.toml").write_text(
        '[project]\nname = "app"\nrequires-python = ">=3.12"\n'
        'dependencies = ["fastapi", "sqlalchemy", "mcp"]\n',
        encoding="utf-8",
    )
    (target_repo / "main.py").write_text("import fastapi\n", encoding="utf-8")

    # 1. Dry-run should plan artifacts without touching disk
    dry_report = sync_repository(
        target_repo,
        CATALOG_ROOT,
        dry_run=True,
    )
    assert dry_report.passed is True
    assert dry_report.dry_run is True
    assert len(dry_report.artifacts) > 0
    assert all(item.action == "planned" for item in dry_report.artifacts)
    assert not (target_repo / LOCKFILE_NAME).exists()
    assert not (target_repo / ".claude").exists()

    # 2. Real sync creates all 5 runtime directories and .skillops-lock.json
    sync_report = sync_repository(
        target_repo,
        CATALOG_ROOT,
        dry_run=False,
    )
    assert sync_report.passed is True
    assert len(sync_report.drift_conflicts) == 0
    assert all(item.action == "created" for item in sync_report.artifacts)
    lockfile_path = target_repo / LOCKFILE_NAME
    assert lockfile_path.is_file()

    lockfile = SyncLockfile.model_validate_json(lockfile_path.read_text(encoding="utf-8"))
    assert set(lockfile.targets) == set(RuntimeTarget)
    assert "fastapi-production" in lockfile.skills
    assert ".cursor/rules/fastapi-production.mdc" in lockfile.artifacts
    assert "AGENTS.md" in lockfile.artifacts

    # 3. Second sync with identical state reports 'unchanged'
    repeat_report = sync_repository(
        target_repo,
        CATALOG_ROOT,
        dry_run=False,
    )
    assert repeat_report.passed is True
    assert all(item.action == "unchanged" for item in repeat_report.artifacts)


def test_sync_drift_detection_and_force_override(tmp_path: Path) -> None:
    """Verify local file edits trigger drift_conflicts unless force=True is supplied."""
    target_repo = tmp_path / "drift_repo"
    target_repo.mkdir()
    (target_repo / "pyproject.toml").write_text(
        '[project]\nname = "app"\nrequires-python = ">=3.12"\ndependencies = ["fastapi"]\n',
        encoding="utf-8",
    )

    initial = sync_repository(
        target_repo,
        CATALOG_ROOT,
        targets=[RuntimeTarget.CURSOR],
    )
    assert initial.passed is True

    mdc_file = target_repo / ".cursor/rules/fastapi-production.mdc"
    assert mdc_file.is_file()
    original_sha = compute_sha256(mdc_file.read_text(encoding="utf-8"))

    # Simulate user local edit
    mdc_file.write_text("# Locally modified cursor rule\n", encoding="utf-8")

    # Sync without --force must detect drift and refuse to overwrite
    drifted = sync_repository(
        target_repo,
        CATALOG_ROOT,
        targets=[RuntimeTarget.CURSOR],
        force=False,
    )
    assert drifted.passed is False
    assert ".cursor/rules/fastapi-production.mdc" in drifted.drift_conflicts
    assert mdc_file.read_text(encoding="utf-8") == "# Locally modified cursor rule\n"

    # Sync with force=True must overwrite and restore canonical checksum
    forced = sync_repository(
        target_repo,
        CATALOG_ROOT,
        targets=[RuntimeTarget.CURSOR],
        force=True,
    )
    assert forced.passed is True
    assert len(forced.drift_conflicts) == 0
    restored_sha = compute_sha256(mdc_file.read_text(encoding="utf-8"))
    assert restored_sha == original_sha


def test_sync_stale_file_removal_and_target_preservation(tmp_path: Path) -> None:
    """Verify stale skills are removed when bundle shrinks and other targets are preserved."""
    target_repo = tmp_path / "stale_repo"
    target_repo.mkdir()
    (target_repo / "pyproject.toml").write_text(
        '[project]\nname = "app"\nrequires-python = ">=3.12"\n'
        'dependencies = ["fastapi", "sqlalchemy", "mcp"]\n',
        encoding="utf-8",
    )

    skills = [parse_skill_directory(d) for d in discover_skill_directories(CATALOG_ROOT)]
    transpiler_all = MultiRuntimeTranspiler(
        targets=[RuntimeTarget.CLAUDE, RuntimeTarget.CURSOR],
    )
    first_report = transpiler_all.sync_parsed_skills(
        skills,
        repo_path=target_repo,
        catalog_path=CATALOG_ROOT,
    )
    assert first_report.passed is True
    assert (target_repo / ".cursor/rules/mcp-architect.mdc").is_file()
    assert (target_repo / ".claude/skills/mcp-architect/SKILL.md").is_file()

    # Now sync ONLY Cursor with just 1 skill (fastapi-production):
    # - Stale cursor rules should be removed
    # - Claude artifacts should remain untouched in the lockfile and on disk
    only_fastapi = [s for s in skills if s.manifest.name == "fastapi-production"]
    transpiler_cursor = MultiRuntimeTranspiler(targets=[RuntimeTarget.CURSOR])
    second_report = transpiler_cursor.sync_parsed_skills(
        only_fastapi,
        repo_path=target_repo,
        catalog_path=CATALOG_ROOT,
    )
    assert second_report.passed is True
    assert ".cursor/rules/mcp-architect.mdc" in second_report.removed_stale_files
    assert not (target_repo / ".cursor/rules/mcp-architect.mdc").exists()
    assert (target_repo / ".cursor/rules/fastapi-production.mdc").is_file()
    # Claude target was not in `targets`, so its files and lock entries remain intact
    assert (target_repo / ".claude/skills/mcp-architect/SKILL.md").is_file()
    lockfile = SyncLockfile.model_validate_json(
        (target_repo / LOCKFILE_NAME).read_text(encoding="utf-8")
    )
    assert ".claude/skills/mcp-architect/SKILL.md" in lockfile.artifacts


def test_codex_agents_md_preserves_unmanaged_root_agents_file(tmp_path: Path) -> None:
    """Verify Codex adapter does not clobber a pre-existing unmanaged AGENTS.md file."""
    target_repo = tmp_path / "unmanaged_agents_repo"
    target_repo.mkdir()
    custom_agents = "# Custom Project Governance\n\nDo not overwrite this file.\n"
    (target_repo / "AGENTS.md").write_text(custom_agents, encoding="utf-8")
    (target_repo / "pyproject.toml").write_text(
        '[project]\nname = "app"\nrequires-python = ">=3.12"\ndependencies = ["fastapi"]\n',
        encoding="utf-8",
    )

    report = sync_repository(
        target_repo,
        CATALOG_ROOT,
        targets=[RuntimeTarget.CODEX],
    )
    assert report.passed is True
    # Unmanaged root AGENTS.md is untouched
    assert (target_repo / "AGENTS.md").read_text(encoding="utf-8") == custom_agents
    # Fallback .codex/AGENTS.md was created instead
    assert (target_repo / ".codex/AGENTS.md").is_file()
    assert CODEX_MARKER_START in (target_repo / ".codex/AGENTS.md").read_text(encoding="utf-8")

    # Now test splicing into an AGENTS.md that explicitly contains CODEX_MARKER_START/END
    spliced_repo = tmp_path / "spliced_agents_repo"
    spliced_repo.mkdir()
    (spliced_repo / "AGENTS.md").write_text(
        f"# Team Header\n\n{CODEX_MARKER_START}\nold table\n{CODEX_MARKER_END}\n\n# Team Footer\n",
        encoding="utf-8",
    )
    (spliced_repo / "pyproject.toml").write_text(
        '[project]\nname = "app"\nrequires-python = ">=3.12"\ndependencies = ["fastapi"]\n',
        encoding="utf-8",
    )
    spliced_report = sync_repository(
        spliced_repo,
        CATALOG_ROOT,
        targets=[RuntimeTarget.CODEX],
    )
    assert spliced_report.passed is True
    updated_agents = (spliced_repo / "AGENTS.md").read_text(encoding="utf-8")
    assert "# Team Header" in updated_agents
    assert "# Team Footer" in updated_agents
    assert "fastapi-production" in updated_agents
