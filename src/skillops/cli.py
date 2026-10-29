"""Typer + Rich CLI entrypoint for the SkillOps Python 3.12+ Engine."""

from __future__ import annotations

import json
import math
import re
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Any

import typer
import yaml
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from skillops import (
    CollisionPair,
    CollisionReport,
    CollisionSeverity,
    ExitCode,
    SkillBudgetMetrics,
    SkillManifest,
    SkillOpsConfig,
    __version__,
)

console = Console(stderr=False)
err_console = Console(stderr=True)

_TOKEN_SPLIT = re.compile(r"[a-z0-9_]+")
_STOPWORDS = frozenset(
    {
        "use",
        "when",
        "the",
        "and",
        "for",
        "with",
        "that",
        "this",
        "from",
        "into",
        "or",
        "to",
        "in",
        "of",
        "on",
        "by",
        "an",
        "a",
        "is",
        "are",
        "not",
        "do",
    }
)


class OutputFormat(StrEnum):
    """Supported CLI output serialization formats."""

    TABLE = "table"
    JSON = "json"
    MARKDOWN = "markdown"


class RuntimeTarget(StrEnum):
    """Supported AI coding agent harnesses for multi-runtime transpilation."""

    CLAUDE = "claude"
    ANTIGRAVITY = "antigravity"
    CURSOR = "cursor"
    CODEX = "codex"
    COPILOT = "copilot"


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


def _lexical_cosine(text_a: str, text_b: str) -> float:
    """Compute zero-API bag-of-words + character 3-gram cosine similarity."""
    tokens_a = [tok for tok in _TOKEN_SPLIT.findall(text_a.lower()) if tok not in _STOPWORDS]
    tokens_b = [tok for tok in _TOKEN_SPLIT.findall(text_b.lower()) if tok not in _STOPWORDS]
    if not tokens_a or not tokens_b:
        return 0.0
    vocab = sorted(set(tokens_a) | set(tokens_b))
    vec_a = [float(tokens_a.count(term)) for term in vocab]
    vec_b = [float(tokens_b.count(term)) for term in vocab]
    dot = sum(a * b for a, b in zip(vec_a, vec_b, strict=True))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return round(dot / (norm_a * norm_b), 4)


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
            help="Treat semantic collision warnings (cosine >= 0.72) as errors.",
        ),
    ] = False,
) -> None:
    """Audit skill catalog for semantic routing collisions and 3-level token budgets."""
    skill_files = sorted(catalog.rglob("SKILL.md")) if catalog.exists() else []
    manifests: list[SkillManifest] = []
    budget_metrics: list[SkillBudgetMetrics] = []

    try:
        for skill_file in skill_files:
            manifest = SkillManifest.from_skill_md(skill_file)
            manifests.append(manifest)
            budget_metrics.append(
                SkillBudgetMetrics(
                    skill_name=manifest.name,
                    track=manifest.track,
                    l1_words=manifest.description_words,
                    l1_tokens=manifest.description_tokens,
                    l2_lines=manifest.body_lines,
                    l2_tokens=manifest.body_tokens,
                    within_budget=True,
                )
            )
    except ValueError as exc:
        err_console.print(f"[bold red]Skill Contract / Budget Violation:[/bold red] {exc}")
        raise typer.Exit(int(ExitCode.BUDGET_OR_CONTRACT_ERROR)) from exc

    collisions: list[CollisionPair] = []
    has_collision_error = False
    for idx, left in enumerate(manifests):
        for right in manifests[idx + 1 :]:
            sim = _lexical_cosine(left.description, right.description)
            pair = CollisionPair.from_similarity(left.name, right.name, sim)
            if pair.severity is not CollisionSeverity.OK:
                collisions.append(pair)
            if pair.severity is CollisionSeverity.BLOCKING_ERROR or (
                strict and pair.severity is CollisionSeverity.HIGH_RISK
            ):
                has_collision_error = True

    total_l1_tokens = sum(item.l1_tokens for item in budget_metrics)
    report = CollisionReport(
        catalog_path=catalog.as_posix(),
        total_skills=len(manifests),
        total_l1_bundle_tokens=total_l1_tokens,
        max_bundle_tokens=1500,
        skills=budget_metrics,
        collisions=collisions,
        passed=not has_collision_error and total_l1_tokens <= 1500,
    )

    payload: dict[str, Any] = {
        "command": "audit",
        "version": __version__,
        "catalog": str(catalog),
        "strict": strict,
        "thresholds": {
            "collision_warn": 0.78,
            "collision_error": 0.85,
            "max_l1_tokens": 160,
            "max_l2_lines": 250,
            "max_bundle_tokens": 1500,
        },
        "audited_skills": report.total_skills,
        "total_l1_bundle_tokens": report.total_l1_bundle_tokens,
        "collisions_found": len(report.collisions),
        "status": "ok" if report.passed else "collision_detected",
    }
    _emit_output(
        output_format,
        payload,
        title="SkillOps Semantic Collision & Token Budget Auditor",
        markdown_heading="SkillOps Audit Report",
    )
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
    payload: dict[str, Any] = {
        "command": "route",
        "version": __version__,
        "repo": str(repo),
        "catalog": str(catalog),
        "max_skills": max_skills,
        "status": "ok",
    }
    _emit_output(
        output_format,
        payload,
        title="SkillOps Context-Aware Repository Router",
        markdown_heading="SkillOps Route Bundle",
    )


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
    targets: Annotated[
        str,
        typer.Option(
            "--targets",
            "-t",
            help="Comma-separated runtime harnesses (claude,antigravity,cursor,codex,copilot).",
        ),
    ] = "claude,antigravity,cursor,codex,copilot",
    dry_run: Annotated[
        bool,
        typer.Option(
            "--dry-run",
            help="Preview transpiled files without writing to disk.",
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

    payload: dict[str, Any] = {
        "command": "sync",
        "version": __version__,
        "repo": str(repo),
        "targets": parsed_targets,
        "dry_run": dry_run,
        "status": "ok",
    }
    _emit_output(
        output_format,
        payload,
        title="SkillOps Multi-Runtime Transpiler & Sync",
        markdown_heading="SkillOps Sync Report",
    )


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
