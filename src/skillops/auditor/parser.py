"""YAML frontmatter and Hybrid Executable Skill directory parser (`SKILL_CONTRACT.md` §3-§6).

Provides deterministic, zero-API parsing and structural layout verification for:
- ``SKILL.md`` YAML frontmatter + Markdown operational body (``SkillManifest``)
- Level 3 bundled Python 3.12+ CLI scripts (``scripts/*.py``)
- Level 3 on-demand domain reference documents (``references/*.md``)
- TDD evaluation suites and comparative benchmarks (``evals/evals.json``, ``evals/benchmark.json``)
"""

from __future__ import annotations

import json
import re
from pathlib import Path  # noqa: TC003
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field

from skillops.models import BenchmarkReport, EvalSuite, SkillManifest

_FRONTMATTER_RE = re.compile(r"\A---\r?\n(?P<yaml>.*?)\r?\n---\r?\n?(?P<body>.*)\Z", re.DOTALL)


class ParsedSkillDirectory(BaseModel):
    """Complete structural snapshot of a Hybrid Executable Skill directory."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    skill_dir: Path = Field(..., description="Root directory of the skill.")
    skill_md_path: Path = Field(..., description="Path to SKILL.md.")
    manifest: SkillManifest = Field(..., description="Validated SKILL.md manifest.")
    raw_frontmatter: dict[str, Any] = Field(
        default_factory=dict,
        description="Raw deserialized YAML frontmatter dictionary.",
    )
    markdown_body: str = Field(..., description="Markdown body excluding YAML frontmatter.")
    total_lines: int = Field(..., ge=1, description="Total line count of SKILL.md.")
    declared_scripts: tuple[Path, ...] = Field(
        default_factory=tuple,
        description="Existing script paths declared in manifest.entrypoints.scripts.",
    )
    missing_scripts: tuple[str, ...] = Field(
        default_factory=tuple,
        description="Relative script paths declared in frontmatter but missing on disk.",
    )
    extra_scripts: tuple[Path, ...] = Field(
        default_factory=tuple,
        description="Python scripts under scripts/*.py not declared in frontmatter.",
    )
    reference_files: tuple[Path, ...] = Field(
        default_factory=tuple,
        description="On-demand Markdown files under references/*.md.",
    )
    eval_suite_path: Path | None = Field(
        default=None,
        description="Path to evals/evals.json if present on disk.",
    )
    eval_suite: EvalSuite | None = Field(
        default=None,
        description="Validated EvalSuite parsed from evals/evals.json.",
    )
    benchmark_path: Path | None = Field(
        default=None,
        description="Path to evals/benchmark.json if present on disk.",
    )
    benchmark_report: BenchmarkReport | None = Field(
        default=None,
        description="Validated BenchmarkReport parsed from evals/benchmark.json.",
    )


def split_skill_md(
    raw_text: str,
    *,
    source: str = "<memory>",
) -> tuple[dict[str, Any], str, int]:
    """Split a raw ``SKILL.md`` document into ``(frontmatter_dict, markdown_body, total_lines)``.

    Raises:
        ValueError: If YAML frontmatter delimiters (``---``) are missing or invalid.
    """
    total_lines = len(raw_text.splitlines())
    match = _FRONTMATTER_RE.match(raw_text)
    if not match:
        msg = f"SKILL.md at '{source}' is missing valid YAML frontmatter (---)."
        raise ValueError(msg)

    try:
        yaml_data = yaml.safe_load(match.group("yaml"))
    except yaml.YAMLError as exc:
        msg = f"Invalid YAML syntax in frontmatter of '{source}': {exc}"
        raise ValueError(msg) from exc

    if not isinstance(yaml_data, dict):
        msg = f"YAML frontmatter in '{source}' must deserialize to a mapping."
        raise ValueError(msg)

    body = match.group("body")
    return yaml_data, body, total_lines


def parse_skill_file(skill_md_path: Path) -> SkillManifest:
    """Parse and validate a ``SKILL.md`` file into a ``SkillManifest``."""
    if not skill_md_path.exists() or not skill_md_path.is_file():
        msg = f"SKILL.md file not found at '{skill_md_path.as_posix()}'."
        raise ValueError(msg)
    return SkillManifest.from_skill_md(skill_md_path)


def discover_skill_directories(catalog_dir: Path) -> list[Path]:
    """Return all skill directories containing ``SKILL.md`` under ``catalog_dir`` sorted."""
    if not catalog_dir.exists():
        return []
    return sorted(
        (skill_md.parent for skill_md in catalog_dir.rglob("SKILL.md")),
        key=lambda item: item.as_posix(),
    )


def parse_skill_directory(
    skill_dir_or_md: Path,
    *,
    require_layout: bool = True,
    validate_evals: bool = True,
) -> ParsedSkillDirectory:
    """Parse a Hybrid Executable Skill directory and verify its Level 1-3 artifact layout.

    Args:
        skill_dir_or_md: Path to either the skill directory or its ``SKILL.md`` file.
        require_layout: If True, raises ``ValueError`` when declared scripts, ``evals.json``,
            or directory naming conventions are violated.
        validate_evals: If True, parses and validates ``evals/evals.json`` and
            ``evals/benchmark.json`` using strict Pydantic v2 models.

    Returns:
        A frozen ``ParsedSkillDirectory`` snapshot.
    """
    if skill_dir_or_md.is_file() and skill_dir_or_md.name == "SKILL.md":
        skill_md_path = skill_dir_or_md
        skill_dir = skill_md_path.parent
    else:
        skill_dir = skill_dir_or_md
        skill_md_path = skill_dir / "SKILL.md"

    if not skill_md_path.exists() or not skill_md_path.is_file():
        msg = f"SKILL.md file not found in skill directory '{skill_dir.as_posix()}'."
        raise ValueError(msg)

    raw_text = skill_md_path.read_text(encoding="utf-8")
    raw_frontmatter, markdown_body, total_lines = split_skill_md(
        raw_text,
        source=skill_md_path.as_posix(),
    )
    manifest = parse_skill_file(skill_md_path)

    if require_layout and skill_dir.name != manifest.name:
        msg = (
            f"Skill directory name '{skill_dir.name}' does not match manifest name "
            f"'{manifest.name}' in '{skill_md_path.as_posix()}'."
        )
        raise ValueError(msg)

    declared_paths: list[Path] = []
    missing_rel_paths: list[str] = []
    declared_rel_set: set[str] = set()

    for entry in manifest.entrypoints.scripts:
        declared_rel_set.add(entry.path)
        candidate = skill_dir / entry.path
        if candidate.exists() and candidate.is_file():
            declared_paths.append(candidate)
        else:
            missing_rel_paths.append(entry.path)

    if require_layout and missing_rel_paths:
        missing_joined = ", ".join(missing_rel_paths)
        msg = (
            f"Skill '{manifest.name}' declares missing entrypoint script(s): {missing_joined} "
            f"under '{skill_dir.as_posix()}'."
        )
        raise ValueError(msg)

    scripts_dir = skill_dir / "scripts"
    extra_scripts: list[Path] = []
    if scripts_dir.exists() and scripts_dir.is_dir():
        for py_file in sorted(scripts_dir.glob("*.py"), key=lambda item: item.as_posix()):
            rel_posix = py_file.relative_to(skill_dir).as_posix()
            if rel_posix not in declared_rel_set and py_file.name != "__init__.py":
                extra_scripts.append(py_file)

    references_dir = skill_dir / "references"
    reference_files: list[Path] = []
    if references_dir.exists() and references_dir.is_dir():
        reference_files = sorted(
            references_dir.rglob("*.md"),
            key=lambda item: item.as_posix(),
        )

    eval_suite_Candidate = skill_dir / "evals" / "evals.json"
    eval_suite_path: Path | None = eval_suite_Candidate if eval_suite_Candidate.exists() else None
    eval_suite: EvalSuite | None = None

    if require_layout and eval_suite_path is None:
        msg = (
            f"Skill '{manifest.name}' is missing required TDD evaluation suite "
            f"at '{(skill_dir / 'evals' / 'evals.json').as_posix()}'."
        )
        raise ValueError(msg)

    if eval_suite_path is not None and validate_evals:
        eval_suite = EvalSuite.from_json_file(eval_suite_path)
        if eval_suite.skill_name != manifest.name:
            msg = (
                f"EvalSuite skill_name '{eval_suite.skill_name}' in "
                f"'{eval_suite_path.as_posix()}' does not match manifest name '{manifest.name}'."
            )
            raise ValueError(msg)

    benchmark_candidate = skill_dir / "evals" / "benchmark.json"
    benchmark_path: Path | None = benchmark_candidate if benchmark_candidate.exists() else None
    benchmark_report: BenchmarkReport | None = None

    if benchmark_path is not None and validate_evals:
        raw_bench: dict[str, Any] = json.loads(benchmark_path.read_text(encoding="utf-8"))
        benchmark_report = BenchmarkReport.model_validate(raw_bench)
        if benchmark_report.skill_name != manifest.name:
            msg = (
                f"BenchmarkReport skill_name '{benchmark_report.skill_name}' in "
                f"'{benchmark_path.as_posix()}' does not match manifest name '{manifest.name}'."
            )
            raise ValueError(msg)

    return ParsedSkillDirectory(
        skill_dir=skill_dir,
        skill_md_path=skill_md_path,
        manifest=manifest,
        raw_frontmatter=raw_frontmatter,
        markdown_body=markdown_body,
        total_lines=total_lines,
        declared_scripts=tuple(declared_paths),
        missing_scripts=tuple(missing_rel_paths),
        extra_scripts=tuple(extra_scripts),
        reference_files=tuple(reference_files),
        eval_suite_path=eval_suite_path,
        eval_suite=eval_suite,
        benchmark_path=benchmark_path,
        benchmark_report=benchmark_report,
    )
