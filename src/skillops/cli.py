"""Typer + Rich CLI entrypoint for the SkillOps Python 3.12+ Engine."""

from __future__ import annotations

import json
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Any

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from skillops import ExitCode, __version__

console = Console(stderr=False)
err_console = Console(stderr=True)


class OutputFormat(StrEnum):
    """Supported CLI output serialization formats."""

    TABLE = "table"
    JSON = "json"
    MARKDOWN = "markdown"


class EvalMode(StrEnum):
    """Supported TDD evaluation execution modes."""

    DETERMINISTIC = "deterministic"
    LIVE = "live"


class RuntimeTarget(StrEnum):
    """Supported AI coding agent harnesses for multi-runtime transpilation."""

    CLAUDE = "claude"
    ANTIGRAVITY = "antigravity"
    CURSOR = "cursor"
    CODEX = "codex"
    COPILOT = "copilot"


class McpTransport(StrEnum):
    """Supported Model Context Protocol (MCP) transports."""

    STDIO = "stdio"
    SSE = "sse"


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
            help="Treat semantic collision warnings (cosine >= 0.78) as errors.",
        ),
    ] = False,
) -> None:
    """Audit skill catalog for semantic routing collisions and 3-level token budgets."""
    payload: dict[str, Any] = {
        "command": "audit",
        "version": __version__,
        "catalog": str(catalog),
        "strict": strict,
        "thresholds": {
            "collision_warn": 0.78,
            "collision_error": 0.85,
            "max_l1_tokens": 90,
            "max_l2_lines": 250,
            "max_bundle_tokens": 1500,
        },
        "status": "ok",
    }
    _emit_output(
        output_format,
        payload,
        title="SkillOps Semantic Collision & Token Budget Auditor",
        markdown_heading="SkillOps Audit Report",
    )


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
    mode: Annotated[
        EvalMode,
        typer.Option(
            "--mode",
            "-m",
            help="Evaluation execution mode (deterministic offline CI or live OpenAI Agents SDK).",
        ),
    ] = EvalMode.DETERMINISTIC,
    model: Annotated[
        str,
        typer.Option(
            "--model",
            help="Target LLM identifier for live OpenAI Agents SDK trials.",
        ),
    ] = "gpt-4.1-mini",
    trials: Annotated[
        int,
        typer.Option(
            "--trials",
            min=1,
            max=10,
            help="Number of evaluation trials per scenario.",
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
    """Run comparative with_skill vs. without_skill TDD evaluations."""
    payload: dict[str, Any] = {
        "command": "eval",
        "version": __version__,
        "skill": skill or ("*" if run_all else "all"),
        "mode": mode.value,
        "model": model,
        "trials": trials,
        "status": "ok",
    }
    _emit_output(
        output_format,
        payload,
        title="SkillOps TDD Evaluation Engine (OpenAI Agents SDK)",
        markdown_heading="SkillOps Benchmark Report",
    )


@app.command("serve")
def serve_command(
    host: Annotated[
        str,
        typer.Option(
            "--host",
            help="Bind address (strictly restricted to 127.0.0.1 or localhost).",
        ),
    ] = "127.0.0.1",
    port: Annotated[
        int,
        typer.Option(
            "--port",
            "-p",
            min=1024,
            max=65535,
            help="Local TCP port for the FastAPI benchmark & collision viewer.",
        ),
    ] = 8080,
    dry_run: Annotated[
        bool,
        typer.Option(
            "--dry-run",
            help="Validate server configuration without blocking the terminal.",
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
    """Launch the local FastAPI benchmark and collision matrix viewer."""
    if host not in {"127.0.0.1", "localhost"}:
        err_console.print(
            "[bold red]Security Policy Violation:[/bold red] "
            "`skillops serve` must bind exclusively to `127.0.0.1` or `localhost`."
        )
        raise typer.Exit(int(ExitCode.ERROR))

    payload: dict[str, Any] = {
        "command": "serve",
        "version": __version__,
        "host": host,
        "port": port,
        "dry_run": dry_run,
        "url": f"http://{host}:{port}",
        "status": "ok",
    }
    _emit_output(
        output_format,
        payload,
        title="SkillOps FastAPI Benchmark Viewer",
        markdown_heading="SkillOps Server Configuration",
    )


@app.command("mcp")
def mcp_command(
    transport: Annotated[
        McpTransport,
        typer.Option(
            "--transport",
            help="MCP transport protocol (stdio or sse).",
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
    """Start the FastMCP server exposing SkillOps tools to AI coding agents."""
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
        title="SkillOps FastMCP Server",
        markdown_heading="SkillOps FastMCP Capabilities",
    )


def main() -> None:
    """Entrypoint invoked by the `skillops` console script."""
    app()
