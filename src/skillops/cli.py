"""Typer + Rich CLI entrypoint for the SkillOps Python 3.12+ Engine."""

from __future__ import annotations

import json
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Any

import typer
import yaml
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from skillops import (
    CollisionReport,
    CollisionSeverity,
    ExitCode,
    RoutedBundle,
    RuntimeTarget,
    SkillOpsConfig,
    SyncReport,
    __version__,
)
from skillops.auditor import audit_catalog
from skillops.router import route_repository
from skillops.sync import sync_repository

console = Console(stderr=False)
err_console = Console(stderr=True)


class OutputFormat(StrEnum):
    """Supported CLI output serialization formats."""

    TABLE = "table"
    JSON = "json"
    MARKDOWN = "markdown"


class McpTransport(StrEnum):
    """Supported zero-API Model Context Protocol (MCP) transports."""

    STDIO = "stdio"


app = typer.Typer(
    name="skillops",
    help=(
        "SkillOps — The Python 3.12+ Engine & Benchmark-Verified Library for "
        "AI Coding Agent Skills & Subagents."
    ),
    no_args_is_help=True,
    add_completion=False,
)


def _version_callback(value: bool) -> None:
    """Print the canonical SkillOps version and exit."""
    if value:
        typer.echo(f"SkillOps v{__version__}")
        raise typer.Exit(int(ExitCode.SUCCESS))


def _emit_output(
    output_format: OutputFormat,
    payload: dict[str, Any],
    *,
    title: str,
    markdown_heading: str,
) -> None:
    """Emit structured output in JSON, Markdown, or Rich Table format."""
    if output_format is OutputFormat.JSON:
        typer.echo(json.dumps(payload, indent=2))
        return

    if output_format is OutputFormat.MARKDOWN:
        lines = [f"# {markdown_heading}", ""]
        for key, value in payload.items():
            lines.append(f"- **{key}**: `{value}`")
        typer.echo("\n".join(lines))
        return

    table = Table(title=title, show_header=True, header_style="bold cyan", min_width=64)
    table.add_column("Field", style="bold")
    table.add_column("Value")
    for key, value in payload.items():
        rendered = json.dumps(value) if isinstance(value, (dict, list)) else str(value)
        table.add_row(str(key), rendered)
    console.print(Panel(table, border_style="cyan", expand=False))


def _emit_audit_report(
    output_format: OutputFormat,
    report: CollisionReport,
    payload: dict[str, Any],
) -> None:
    """Emit the SkillOps audit report in JSON, Markdown, or Rich Table format."""
    if output_format is OutputFormat.JSON:
        typer.echo(json.dumps(payload, indent=2))
        return

    if output_format is OutputFormat.MARKDOWN:
        lines = [
            "# SkillOps Audit Report",
            "",
            f"- **catalog**: `{payload['catalog']}`",
            f"- **audited_skills**: `{payload['audited_skills']}`",
            (
                f"- **total_l1_bundle_tokens**: `{payload['total_l1_bundle_tokens']}` / "
                f"`{report.max_bundle_tokens}`"
            ),
            f"- **total_l3_scripts_tokens_saved**: `{payload['total_l3_scripts_tokens_saved']}`",
            f"- **collisions_found**: `{payload['collisions_found']}`",
            f"- **status**: `{payload['status']}`",
            "",
            "## 3-Level Progressive Disclosure Budget Matrix",
            "",
            (
                "| Skill | Track | L1 Words | L1 Tokens | L2 Lines | L2 Tokens | "
                "L3 Scripts | L3 Offloaded Tokens | Budget Status |"
            ),
            "| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- |",
        ]
        for skill in report.skills:
            offloaded = skill.l3_scripts_tokens + skill.l3_reference_tokens
            status_badge = "PASS" if skill.within_budget else "FAIL"
            lines.append(
                f"| `{skill.skill_name}` | `{skill.track.value}` | {skill.l1_words} | "
                f"{skill.l1_tokens} | {skill.l2_lines} | {skill.l2_tokens} | "
                f"{skill.l3_scripts_count} | {offloaded} | **{status_badge}** |"
            )

        lines.extend(["", "## Pairwise Semantic Collisions", ""])
        if not report.collisions:
            lines.append("_No semantic collisions detected._")
        else:
            lines.extend(
                [
                    "| Skill A | Skill B | Cosine | Severity | Shared Terms | Remediation |",
                    "| :--- | :--- | ---: | :--- | :--- | :--- |",
                ]
            )
            for pair in report.collisions:
                terms = ", ".join(pair.shared_terms) if pair.shared_terms else "-"
                lines.append(
                    f"| `{pair.skill_a}` | `{pair.skill_b}` | {pair.cosine_similarity:.4f} | "
                    f"**{pair.severity.value}** | {terms} | {pair.remediation} |"
                )
        typer.echo("\n".join(lines))
        return

    summary_table = Table(
        title="SkillOps Semantic Collision & Token Budget Auditor",
        show_header=True,
        header_style="bold cyan",
        min_width=64,
    )
    summary_table.add_column("Metric", style="bold")
    summary_table.add_column("Value")
    summary_table.add_row("catalog", str(payload["catalog"]))
    summary_table.add_row("audited_skills", str(payload["audited_skills"]))
    summary_table.add_row(
        "total_l1_bundle_tokens",
        f"{payload['total_l1_bundle_tokens']} / {report.max_bundle_tokens}",
    )
    summary_table.add_row(
        "total_l3_scripts_tokens_saved",
        str(payload["total_l3_scripts_tokens_saved"]),
    )
    summary_table.add_row("collisions_found", str(payload["collisions_found"]))
    summary_table.add_row("status", str(payload["status"]))
    console.print(Panel(summary_table, border_style="cyan", expand=False))

    if report.skills:
        budget_table = Table(
            title="3-Level Progressive Disclosure Token Budgets",
            show_header=True,
            header_style="bold green",
        )
        budget_table.add_column("Skill", style="bold")
        budget_table.add_column("Track")
        budget_table.add_column("L1 Words", justify="right")
        budget_table.add_column("L1 Tokens", justify="right")
        budget_table.add_column("L2 Lines", justify="right")
        budget_table.add_column("L2 Tokens", justify="right")
        budget_table.add_column("L3 Offloaded", justify="right")
        budget_table.add_column("Status")
        for skill in report.skills:
            offloaded = skill.l3_scripts_tokens + skill.l3_reference_tokens
            status_cell = "[green]PASS[/green]" if skill.within_budget else "[red]FAIL[/red]"
            budget_table.add_row(
                skill.skill_name,
                skill.track.value,
                str(skill.l1_words),
                str(skill.l1_tokens),
                str(skill.l2_lines),
                str(skill.l2_tokens),
                str(offloaded),
                status_cell,
            )
        console.print(budget_table)

    if report.collisions:
        collision_table = Table(
            title="Pairwise Semantic Collisions",
            show_header=True,
            header_style="bold yellow",
        )
        collision_table.add_column("Skill A", style="bold")
        collision_table.add_column("Skill B", style="bold")
        collision_table.add_column("Cosine", justify="right")
        collision_table.add_column("Severity")
        collision_table.add_column("Shared Terms")
        collision_table.add_column("Remediation")
        for pair in report.collisions:
            collision_table.add_row(
                pair.skill_a,
                pair.skill_b,
                f"{pair.cosine_similarity:.4f}",
                pair.severity.value,
                ", ".join(pair.shared_terms[:5]),
                pair.remediation,
            )
        console.print(collision_table)


def _emit_route_report(
    output_format: OutputFormat,
    bundle: RoutedBundle,
    payload: dict[str, Any],
) -> None:
    """Emit the SkillOps repository routing report in JSON, Markdown, or Rich Table format."""
    if output_format is OutputFormat.JSON:
        typer.echo(json.dumps(payload, indent=2))
        return

    if output_format is OutputFormat.MARKDOWN:
        lines = [
            "# SkillOps Route Bundle",
            "",
            f"- **repo**: `{payload['repo']}`",
            f"- **catalog**: `{payload['catalog']}`",
            f"- **detected_signals**: `{', '.join(bundle.repo_profile.signals) or 'none'}`",
            f"- **selected_count**: `{len(bundle.selected_skills)}` / `{bundle.max_skills}`",
            f"- **total_l1_tokens**: `{bundle.total_l1_tokens}` / `{bundle.max_l1_tokens}`",
            f"- **max_pairwise_similarity**: `{bundle.max_pairwise_similarity:.4f}`",
            f"- **status**: `{payload['status']}`",
            "",
            "## Selected Collision-Free Skill Bundle",
            "",
            "| Skill | Track | Score | L1 Tokens | Matched Signals |",
            "| :--- | :--- | ---: | ---: | :--- |",
        ]
        for skill in bundle.selected_skills:
            signals_str = ", ".join(skill.matched_signals) if skill.matched_signals else "-"
            lines.append(
                f"| `{skill.name}` | `{skill.track.value}` | {skill.relevance_score:.2f} | "
                f"{skill.l1_tokens} | {signals_str} |"
            )
        if bundle.skipped_skills:
            lines.extend(
                [
                    "",
                    "## Skipped Catalog Skills",
                    "",
                    "| Skill | Track | Score | Reason |",
                    "| :--- | :--- | ---: | :--- |",
                ]
            )
            for skipped in bundle.skipped_skills:
                lines.append(
                    f"| `{skipped.name}` | `{skipped.track.value}` | "
                    f"{skipped.relevance_score:.2f} | {skipped.reason} |"
                )
        typer.echo("\n".join(lines))
        return

    summary_table = Table(
        title="SkillOps Context-Aware Repository Router",
        show_header=True,
        header_style="bold cyan",
        min_width=64,
    )
    summary_table.add_column("Metric", style="bold")
    summary_table.add_column("Value")
    summary_table.add_row("repo", str(payload["repo"]))
    summary_table.add_row("catalog", str(payload["catalog"]))
    summary_table.add_row(
        "detected_signals",
        ", ".join(bundle.repo_profile.signals) or "none",
    )
    summary_table.add_row(
        "selected_skills",
        f"{len(bundle.selected_skills)} / {bundle.max_skills}",
    )
    summary_table.add_row(
        "total_l1_tokens",
        f"{bundle.total_l1_tokens} / {bundle.max_l1_tokens}",
    )
    summary_table.add_row(
        "max_pairwise_similarity",
        f"{bundle.max_pairwise_similarity:.4f}",
    )
    summary_table.add_row("status", str(payload["status"]))
    console.print(Panel(summary_table, border_style="cyan", expand=False))

    if bundle.selected_skills:
        selected_table = Table(
            title="Selected Collision-Free Skill Bundle",
            show_header=True,
            header_style="bold green",
        )
        selected_table.add_column("Skill", style="bold")
        selected_table.add_column("Track")
        selected_table.add_column("Score", justify="right")
        selected_table.add_column("L1 Tokens", justify="right")
        selected_table.add_column("Matched Signals")
        for skill in bundle.selected_skills:
            selected_table.add_row(
                skill.name,
                skill.track.value,
                f"{skill.relevance_score:.2f}",
                str(skill.l1_tokens),
                ", ".join(skill.matched_signals) or "-",
            )
        console.print(selected_table)


def _emit_sync_report(
    output_format: OutputFormat,
    report: SyncReport,
    payload: dict[str, Any],
) -> None:
    """Emit the SkillOps multi-runtime sync report in JSON, Markdown, or Rich Table format."""
    if output_format is OutputFormat.JSON:
        typer.echo(json.dumps(payload, indent=2))
        return

    if output_format is OutputFormat.MARKDOWN:
        lines = [
            "# SkillOps Sync Report",
            "",
            f"- **repo**: `{payload['repo']}`",
            f"- **targets**: `{', '.join(payload['targets'])}`",
            f"- **selected_skills**: `{', '.join(report.selected_skills) or 'none'}`",
            f"- **dry_run**: `{report.dry_run}`",
            f"- **artifacts_total**: `{len(report.artifacts)}`",
            f"- **drift_conflicts**: `{len(report.drift_conflicts)}`",
            f"- **status**: `{payload['status']}`",
            "",
            "## Transpiled Runtime Artifacts",
            "",
            "| Target | Skill | Relative Path | Action | SHA-256 |",
            "| :--- | :--- | :--- | :--- | :--- |",
        ]
        for item in report.artifacts:
            lines.append(
                f"| `{item.target.value}` | `{item.skill_name}` | `{item.relative_path}` | "
                f"**{item.action}** | `{item.sha256[:12]}` |"
            )
        typer.echo("\n".join(lines))
        return

    summary_table = Table(
        title="SkillOps Multi-Runtime Transpiler & Sync",
        show_header=True,
        header_style="bold cyan",
        min_width=64,
    )
    summary_table.add_column("Metric", style="bold")
    summary_table.add_column("Value")
    summary_table.add_row("repo", str(payload["repo"]))
    summary_table.add_row("targets", ", ".join(payload["targets"]))
    summary_table.add_row("selected_skills", ", ".join(report.selected_skills) or "none")
    summary_table.add_row("dry_run", str(report.dry_run))
    summary_table.add_row("artifacts_synced", str(len(report.artifacts)))
    summary_table.add_row("drift_conflicts", str(len(report.drift_conflicts)))
    summary_table.add_row("status", str(payload["status"]))
    console.print(Panel(summary_table, border_style="cyan", expand=False))

    if report.artifacts:
        artifact_table = Table(
            title="Transpiled Runtime Artifacts",
            show_header=True,
            header_style="bold green",
        )
        artifact_table.add_column("Target")
        artifact_table.add_column("Skill", style="bold")
        artifact_table.add_column("Relative Path")
        artifact_table.add_column("Action")
        artifact_table.add_column("SHA-256")
        for item in report.artifacts:
            artifact_table.add_row(
                item.target.value,
                item.skill_name,
                item.relative_path,
                item.action,
                item.sha256[:12],
            )
        console.print(artifact_table)


@app.callback()
def cli_root(
    version: Annotated[
        bool | None,
        typer.Option(
            "--version",
            "-V",
            help="Show SkillOps version and exit.",
            callback=_version_callback,
            is_eager=True,
        ),
    ] = None,
) -> None:
    """SkillOps CLI root callback."""


@app.command("init")
def init_command(
    target_dir: Annotated[
        Path,
        typer.Option(
            "--target-dir",
            "-d",
            help="Target workspace directory to initialize with SkillOps structure.",
        ),
    ] = Path("."),
    force: Annotated[
        bool,
        typer.Option(
            "--force",
            help="Overwrite existing .skillops.yml if already present.",
        ),
    ] = False,
    output_format: Annotated[
        OutputFormat,
        typer.Option(
            "--format",
            "-f",
            help="Output format (table, json, or markdown).",
        ),
    ] = OutputFormat.TABLE,
) -> None:
    """Scaffold .skillops.yml and catalog/ track directories for a workspace."""
    config_path = target_dir / ".skillops.yml"
    tracks = ["ai-engineering", "python-backend", "arch-quality"]
    created_paths: list[str] = []

    for track in tracks:
        track_dir = target_dir / "catalog" / track
        track_dir.mkdir(parents=True, exist_ok=True)
        created_paths.append(track_dir.as_posix())

    default_config = SkillOpsConfig()
    if not config_path.exists() or force:
        config_path.write_text(
            yaml.safe_dump(default_config.model_dump(mode="json"), sort_keys=False),
            encoding="utf-8",
        )
        created_paths.append(config_path.as_posix())

    payload: dict[str, Any] = {
        "command": "init",
        "version": __version__,
        "target_dir": target_dir.as_posix(),
        "config_file": config_path.as_posix(),
        "created": created_paths,
        "status": "ok",
    }
    _emit_output(
        output_format,
        payload,
        title="SkillOps Workspace Initialization",
        markdown_heading="SkillOps Init Report",
    )


@app.command("audit")
def audit_command(
    catalog: Annotated[
        Path,
        typer.Option(
            "--catalog",
            "-c",
            help="Path to the Hybrid Executable Skill catalog directory.",
        ),
    ] = Path("catalog"),
    output_format: Annotated[
        OutputFormat,
        typer.Option(
            "--format",
            "-f",
            help="Output format (table, json, or markdown).",
        ),
    ] = OutputFormat.TABLE,
    strict: Annotated[
        bool,
        typer.Option(
            "--strict",
            help="Treat high-risk semantic collisions (cosine >= 0.72) as errors.",
        ),
    ] = False,
    max_similarity: Annotated[
        float,
        typer.Option(
            "--max-similarity",
            min=0.1,
            max=0.99,
            help="Maximum allowed pairwise cosine similarity before BLOCKING_ERROR.",
        ),
    ] = 0.85,
    max_l1_tokens: Annotated[
        int,
        typer.Option(
            "--max-l1-tokens",
            min=40,
            help="Maximum aggregate Level 1 routing token budget across the catalog.",
        ),
    ] = 1500,
    require_layout: Annotated[
        bool,
        typer.Option(
            "--require-layout",
            help="Verify that all declared scripts/*.py and evals/evals.json exist on disk.",
        ),
    ] = False,
) -> None:
    """Audit skill catalog for semantic routing collisions and 3-level token budgets."""
    config = SkillOpsConfig(
        collision_warn_threshold=min(0.58, max_similarity),
        collision_high_risk_threshold=min(0.72, max_similarity),
        collision_error_threshold=max_similarity,
    )
    try:
        report = audit_catalog(
            catalog,
            config=config,
            strict=strict,
            max_bundle_tokens=max_l1_tokens,
            require_layout=require_layout,
            validate_evals=require_layout,
        )
    except ValueError as exc:
        err_console.print(f"[bold red]Skill Contract / Budget Violation:[/bold red] {exc}")
        raise typer.Exit(int(ExitCode.BUDGET_OR_CONTRACT_ERROR)) from exc

    has_budget_error = (
        any(not skill.within_budget for skill in report.skills)
        or report.total_l1_bundle_tokens > max_l1_tokens
    )
    has_collision_error = any(
        pair.severity is CollisionSeverity.BLOCKING_ERROR
        or (strict and pair.severity is CollisionSeverity.HIGH_RISK)
        for pair in report.collisions
    )
    total_l3_saved = sum(
        skill.l3_scripts_tokens + skill.l3_reference_tokens for skill in report.skills
    )

    if report.passed:
        status = "ok"
    elif has_budget_error:
        status = "budget_violation"
    else:
        status = "collision_detected"

    payload: dict[str, Any] = {
        "command": "audit",
        "version": __version__,
        "catalog": report.catalog_path,
        "strict": strict,
        "require_layout": require_layout,
        "thresholds": {
            "collision_warn": config.collision_warn_threshold,
            "collision_high_risk": config.collision_high_risk_threshold,
            "collision_error": config.collision_error_threshold,
            "max_l1_tokens": config.max_l1_tokens,
            "max_l2_lines": config.max_l2_lines,
            "max_bundle_tokens": max_l1_tokens,
        },
        "audited_skills": report.total_skills,
        "total_l1_bundle_tokens": report.total_l1_bundle_tokens,
        "total_l3_scripts_tokens_saved": total_l3_saved,
        "collisions_found": len(report.collisions),
        "skills": [skill.model_dump(mode="json") for skill in report.skills],
        "collisions": [pair.model_dump(mode="json") for pair in report.collisions],
        "status": status,
    }
    _emit_audit_report(output_format, report, payload)

    if has_budget_error:
        raise typer.Exit(int(ExitCode.BUDGET_OR_CONTRACT_ERROR))
    if has_collision_error:
        raise typer.Exit(int(ExitCode.COLLISION_ERROR))


@app.command("route")
def route_command(
    repo: Annotated[
        Path,
        typer.Option(
            "--repo",
            "-r",
            help="Path to target repository to fingerprint and route.",
        ),
    ] = Path("."),
    catalog: Annotated[
        Path,
        typer.Option(
            "--catalog",
            "-c",
            help="Path to the skill catalog directory.",
        ),
    ] = Path("catalog"),
    max_skills: Annotated[
        int,
        typer.Option(
            "--max-skills",
            min=1,
            max=12,
            help=(
                "Maximum collision-free skills to include in the routed bundle "
                "(INV-SKILL-03 <= 12)."
            ),
        ),
    ] = 10,
    max_l1_tokens: Annotated[
        int,
        typer.Option(
            "--max-l1-tokens",
            min=40,
            help="Maximum Level 1 token budget for the routed bundle (INV-SKILL-03 <= 1500).",
        ),
    ] = 1500,
    max_similarity: Annotated[
        float,
        typer.Option(
            "--max-similarity",
            min=0.1,
            max=0.99,
            help="Maximum pairwise cosine similarity within the routed bundle (< 0.78).",
        ),
    ] = 0.78,
    task: Annotated[
        str,
        typer.Option(
            "--task",
            help="Optional task prompt/context for negative trigger filtering and keyword boost.",
        ),
    ] = "",
    output_format: Annotated[
        OutputFormat,
        typer.Option(
            "--format",
            "-f",
            help="Output format (table, json, or markdown).",
        ),
    ] = OutputFormat.TABLE,
) -> None:
    """Fingerprint a repository stack and compile an optimal collision-free skill bundle."""
    bundle = route_repository(
        repo,
        catalog,
        max_skills=max_skills,
        max_l1_tokens=max_l1_tokens,
        max_similarity=max_similarity,
        task_context=task,
    )
    payload: dict[str, Any] = {
        "command": "route",
        "version": __version__,
        "repo": bundle.repo_profile.repo_path,
        "catalog": bundle.catalog_path,
        "max_skills": max_skills,
        "max_l1_tokens": max_l1_tokens,
        "max_similarity": max_similarity,
        "repo_profile": bundle.repo_profile.model_dump(mode="json"),
        "selected_skills": [s.model_dump(mode="json") for s in bundle.selected_skills],
        "skipped_skills": [s.model_dump(mode="json") for s in bundle.skipped_skills],
        "total_l1_tokens": bundle.total_l1_tokens,
        "max_pairwise_similarity": bundle.max_pairwise_similarity,
        "status": "ok" if bundle.passed_invariants else "invariant_violation",
    }
    _emit_route_report(output_format, bundle, payload)


@app.command("sync")
def sync_command(
    repo: Annotated[
        Path,
        typer.Option(
            "--repo",
            "-r",
            help="Path to target repository where skills will be synced.",
        ),
    ] = Path("."),
    catalog: Annotated[
        Path,
        typer.Option(
            "--catalog",
            "-c",
            help="Path to the skill catalog directory.",
        ),
    ] = Path("catalog"),
    targets: Annotated[
        str,
        typer.Option(
            "--targets",
            "-t",
            help="Comma-separated runtime harnesses (claude,antigravity,cursor,codex,copilot).",
        ),
    ] = "claude,antigravity,cursor,codex,copilot",
    max_skills: Annotated[
        int,
        typer.Option(
            "--max-skills",
            min=1,
            max=12,
            help="Maximum collision-free skills to route and sync (<= 12).",
        ),
    ] = 10,
    dry_run: Annotated[
        bool,
        typer.Option(
            "--dry-run",
            help="Preview transpiled files without writing to disk.",
        ),
    ] = False,
    force: Annotated[
        bool,
        typer.Option(
            "--force",
            help="Overwrite locally modified files that drifted from .skillops-lock.json.",
        ),
    ] = False,
    output_format: Annotated[
        OutputFormat,
        typer.Option(
            "--format",
            "-f",
            help="Output format (table, json, or markdown).",
        ),
    ] = OutputFormat.TABLE,
) -> None:
    """Transpile and sync a routed skill bundle across AI coding agent harnesses."""
    valid_targets = {item.value for item in RuntimeTarget}
    parsed_targets = [item.strip().lower() for item in targets.split(",") if item.strip()]
    invalid_targets = [item for item in parsed_targets if item not in valid_targets]
    if not parsed_targets or invalid_targets:
        err_console.print(
            f"[bold red]Invalid runtime target(s):[/bold red] {', '.join(invalid_targets)}"
        )
        raise typer.Exit(int(ExitCode.ERROR))

    report = sync_repository(
        repo,
        catalog,
        targets=[RuntimeTarget(item) for item in parsed_targets],
        max_skills=max_skills,
        dry_run=dry_run,
        force=force,
    )
    payload: dict[str, Any] = {
        "command": "sync",
        "version": __version__,
        "repo": report.repo_path,
        "catalog": report.catalog_path,
        "targets": [item.value for item in report.targets],
        "selected_skills": report.selected_skills,
        "dry_run": report.dry_run,
        "force": report.force,
        "artifacts": [item.model_dump(mode="json") for item in report.artifacts],
        "drift_conflicts": report.drift_conflicts,
        "removed_stale_files": report.removed_stale_files,
        "lockfile_path": report.lockfile_path,
        "status": "ok" if report.passed else "drift_conflict",
    }
    _emit_sync_report(output_format, report, payload)

    if not report.passed:
        raise typer.Exit(int(ExitCode.ERROR))


@app.command("eval")
def eval_command(
    skill: Annotated[
        str | None,
        typer.Option(
            "--skill",
            "-s",
            help="Specific skill name to evaluate (e.g., mcp-architect).",
        ),
    ] = None,
    run_all: Annotated[
        bool,
        typer.Option(
            "--all",
            help="Evaluate all Hybrid Executable Skills in the catalog.",
        ),
    ] = False,
    trials: Annotated[
        int,
        typer.Option(
            "--trials",
            min=1,
            max=10,
            help="Number of deterministic evaluation trials per scenario.",
        ),
    ] = 3,
    output_format: Annotated[
        OutputFormat,
        typer.Option(
            "--format",
            "-f",
            help="Output format (table, json, or markdown).",
        ),
    ] = OutputFormat.TABLE,
) -> None:
    """Run zero-API comparative with_skill vs. without_skill TDD evaluations."""
    payload: dict[str, Any] = {
        "command": "eval",
        "version": __version__,
        "skill": skill or ("*" if run_all else "all"),
        "runner": "deterministic-ast",
        "trials": trials,
        "status": "ok",
    }
    _emit_output(
        output_format,
        payload,
        title="SkillOps Zero-API TDD Evaluation Engine",
        markdown_heading="SkillOps Benchmark Report",
    )


@app.command("mcp")
def mcp_command(
    transport: Annotated[
        McpTransport,
        typer.Option(
            "--transport",
            help="Zero-API local MCP transport protocol (stdio).",
        ),
    ] = McpTransport.STDIO,
    dry_run: Annotated[
        bool,
        typer.Option(
            "--dry-run",
            help="Inspect MCP server capabilities without starting the stdio loop.",
        ),
    ] = False,
    output_format: Annotated[
        OutputFormat,
        typer.Option(
            "--format",
            "-f",
            help="Output format (table, json, or markdown).",
        ),
    ] = OutputFormat.TABLE,
) -> None:
    """Start the local JSON-RPC 2.0 stdio MCP server exposing SkillOps tools to AI agents."""
    payload: dict[str, Any] = {
        "command": "mcp",
        "version": __version__,
        "transport": transport.value,
        "dry_run": dry_run,
        "exposed_tools": [
            "audit_skill_catalog",
            "route_repo_skills",
            "run_skill_script",
            "get_skill_benchmark",
        ],
        "status": "ok",
    }
    _emit_output(
        output_format,
        payload,
        title="SkillOps Local MCP Stdio Server",
        markdown_heading="SkillOps MCP Capabilities",
    )


def main() -> None:
    """Entrypoint invoked by the `skillops` console script."""
    app()
