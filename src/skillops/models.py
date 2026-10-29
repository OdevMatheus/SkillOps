"""Strict Pydantic v2 schemas for SkillOps manifests, evaluations, collisions, and benchmarks.

Implements the canonical data contracts specified in ``SKILL_CONTRACT.md`` (§4, §5, §6, §7):
- ``SkillManifest`` (Schema 1: ``SKILL.md`` YAML frontmatter & progressive disclosure budget)
- ``ScriptOutput`` (Schema 2: deterministic ``scripts/*.py --json`` output contract)
- ``EvalSuite`` (Schema 3.1: ``evals/evals.json`` TDD pressure scenarios & assertions)
- ``CollisionReport`` (``skillops audit`` pairwise semantic collision & token budget report)
- ``BenchmarkReport`` (Schema 3.2: ``evals/benchmark.json`` A/B evaluation delta & verdict)
- ``SkillOpsConfig`` (``.skillops.yml`` workspace configuration)
"""

from __future__ import annotations

import json
import math
import re
from enum import StrEnum
from typing import TYPE_CHECKING, Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

if TYPE_CHECKING:
    from pathlib import Path

_FRONTMATTER_PATTERN = re.compile(r"\A---\r?\n(?P<yaml>.*?)\r?\n---\r?\n?(?P<body>.*)\Z", re.DOTALL)
_SKILL_NAME_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def estimate_token_count(text: str) -> int:
    """Estimate subword token count (~1.35 tokens per whitespace word plus punctuation).

    Uses a deterministic offline heuristic calibrated against ``cl100k_base`` / ``o200k_base``
    so token budgeting works with zero network access or external model downloads.
    """
    stripped = text.strip()
    if not stripped:
        return 0
    words = stripped.split()
    punctuation_bonus = sum(1 for ch in stripped if ch in "{}[]():,;<>`=/\\|")
    return max(1, math.ceil(len(words) * 1.35 + punctuation_bonus * 0.25))


def count_words(text: str) -> int:
    """Count whitespace-delimited words in a string."""
    stripped = text.strip()
    if not stripped:
        return 0
    return len(stripped.split())


class CatalogTrack(StrEnum):
    """Canonical domain tracks inside the ``catalog/`` directory."""

    AI_ENGINEERING = "ai-engineering"
    PYTHON_BACKEND = "python-backend"
    ARCH_QUALITY = "arch-quality"


class RoutingSignals(BaseModel):
    """Repository fingerprinting signals used by ``skillops route``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    languages: list[str] = Field(default_factory=list, description="Target programming languages.")
    files_any: list[str] = Field(
        default_factory=list,
        description="Repository indicator files (e.g., pyproject.toml, Dockerfile).",
    )
    dependencies_any: list[str] = Field(
        default_factory=list,
        description="Package dependencies that trigger routing (e.g., fastapi, mcp, sqlalchemy).",
    )
    negative_triggers: list[str] = Field(
        default_factory=list,
        description="Explicit task contexts where the skill must NOT be routed.",
    )


class ScriptEntrypoint(BaseModel):
    """Metadata for a bundled deterministic Python 3.12+ CLI helper script."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str = Field(..., min_length=1, description="Relative path inside the skill directory.")
    description: str = Field(..., min_length=10, description="Concise summary of the CLI tool.")

    @field_validator("path")
    @classmethod
    def _validate_script_path(cls, value: str) -> str:
        normalized = value.replace("\\", "/").strip("/")
        if not normalized.startswith("scripts/") or not normalized.endswith(".py"):
            msg = "Script entrypoint path must reside under 'scripts/*.py'."
            raise ValueError(msg)
        return normalized


class SkillEntrypoints(BaseModel):
    """Bundled executable entrypoints declared in ``SKILL.md`` frontmatter."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    scripts: list[ScriptEntrypoint] = Field(
        ...,
        min_length=1,
        description="At least one deterministic Python script is required for catalog skills.",
    )


class SkillManifest(BaseModel):
    """Validated ``SKILL.md`` manifest enforcing ``INV-SKILL-01`` progressive disclosure budgets."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(..., description="Kebab-case skill identifier.")
    description: str = Field(
        ...,
        description=(
            "Level 1 routing description. Must start with 'Use when' and stay within "
            "40-110 words (<= 160 tokens) per INV-SKILL-01."
        ),
    )
    version: str = Field(
        default="1.0.0",
        pattern=r"^\d+\.\d+\.\d+$",
        description="Semantic version of the skill.",
    )
    track: CatalogTrack = Field(..., description="Catalog domain track.")
    tags: list[str] = Field(..., min_length=1, description="Domain discovery tags.")
    routing_signals: RoutingSignals = Field(
        default_factory=RoutingSignals,
        description="Deterministic repository routing signals.",
    )
    entrypoints: SkillEntrypoints = Field(
        ...,
        description="Bundled deterministic CLI script entrypoints.",
    )
    body_lines: int = Field(
        default=0,
        ge=0,
        le=250,
        description="Line count of the SKILL.md Markdown body (INV-SKILL-01 <= 250 lines).",
    )
    body_tokens: int = Field(
        default=0,
        ge=0,
        le=1800,
        description="Estimated token count of the SKILL.md body (INV-SKILL-01 <= 1,800 tokens).",
    )

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        if not _SKILL_NAME_PATTERN.match(value):
            msg = f"Skill name '{value}' must be lowercase kebab-case (e.g., 'mcp-architect')."
            raise ValueError(msg)
        return value

    @field_validator("description")
    @classmethod
    def _validate_description_budget(cls, value: str) -> str:
        cleaned = " ".join(value.strip().split())
        if not cleaned.startswith("Use when"):
            msg = "Skill description must start with 'Use when' per SKILL_CONTRACT.md §4.2."
            raise ValueError(msg)
        words = count_words(cleaned)
        if words < 40 or words > 110:
            msg = (
                f"Skill description must contain between 40 and 110 words per INV-SKILL-01 "
                f"(got {words} words)."
            )
            raise ValueError(msg)
        tokens = estimate_token_count(cleaned)
        if tokens > 160:
            msg = (
                f"Skill description exceeds Level 1 budget of 160 tokens per INV-SKILL-01 "
                f"(estimated {tokens} tokens)."
            )
            raise ValueError(msg)
        return cleaned

    @property
    def description_words(self) -> int:
        """Return word count of the Level 1 routing description."""
        return count_words(self.description)

    @property
    def description_tokens(self) -> int:
        """Return estimated token count of the Level 1 routing description."""
        return estimate_token_count(self.description)

    @classmethod
    def from_skill_md(cls, path: Path) -> SkillManifest:
        """Parse and validate a ``SKILL.md`` file (YAML frontmatter + Markdown body)."""
        raw_text = path.read_text(encoding="utf-8")
        total_lines = len(raw_text.splitlines())
        if total_lines > 250:
            msg = (
                f"SKILL.md at '{path.as_posix()}' has {total_lines} lines, exceeding "
                "INV-SKILL-01 maximum of 250 lines."
            )
            raise ValueError(msg)

        match = _FRONTMATTER_PATTERN.match(raw_text)
        if not match:
            msg = f"SKILL.md at '{path.as_posix()}' is missing valid YAML frontmatter (---)."
            raise ValueError(msg)

        yaml_data = yaml.safe_load(match.group("yaml"))
        if not isinstance(yaml_data, dict):
            msg = f"YAML frontmatter in '{path.as_posix()}' must deserialize to a mapping."
            raise ValueError(msg)

        body = match.group("body")
        body_line_count = len(body.splitlines())
        body_token_count = estimate_token_count(body)
        payload: dict[str, Any] = {
            **yaml_data,
            "body_lines": body_line_count,
            "body_tokens": body_token_count,
        }
        return cls.model_validate(payload)


class ScriptFinding(BaseModel):
    """Single actionable finding emitted by a deterministic ``scripts/*.py`` tool."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    file: str = Field(..., min_length=1, description="Relative path to inspected file.")
    line: int = Field(..., ge=1, description="1-based line number of the finding.")
    symbol: str = Field(..., min_length=1, description="Function, class, route, or SQL statement.")
    impact: str = Field(..., min_length=5, description="Actionable explanation of the issue.")
    severity: str = Field(default="warning", description="Finding severity (info, warning, error).")


class ScriptOutput(BaseModel):
    """Standard JSON output contract for ``catalog/**/scripts/*.py --json`` (``INV-SKILL-04``)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    skill: str = Field(..., min_length=1, description="Skill identifier.")
    script: str = Field(..., min_length=1, description="Script filename.")
    status: str = Field(..., pattern=r"^(ok|findings_detected|error)$")
    target: str = Field(..., min_length=1, description="Target file or directory analyzed.")
    summary: dict[str, int | float | str | bool] = Field(
        default_factory=dict,
        description="Compact quantitative summary metrics.",
    )
    findings: list[ScriptFinding] = Field(
        default_factory=list,
        description="Structured findings list.",
    )


class AssertionType(StrEnum):
    """Supported deterministic TDD evaluation assertion types in ``evals/evals.json``."""

    TOOL_CALL_CONTAINS = "tool_call_contains"
    REGEX_MATCH = "regex_match"
    JSON_FIELD_EQUALS = "json_field_equals"
    EXIT_CODE_ZERO = "exit_code_zero"
    AST_CONTAINS = "ast_contains"


class EvalAssertion(BaseModel):
    """Single verifiable assertion inside an evaluation scenario."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(..., min_length=3, description="Unique assertion identifier.")
    type: AssertionType = Field(..., description="Assertion verification mechanism.")
    target: str = Field(..., min_length=1, description="Pattern, tool name, or JSON key.")
    description: str = Field(..., min_length=5, description="Human-readable assertion intent.")


class EvalCase(BaseModel):
    """Single pressure test scenario inside ``evals/evals.json``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(..., min_length=3, description="Scenario identifier.")
    name: str = Field(..., min_length=5, description="Descriptive scenario name.")
    prompt: str = Field(..., min_length=15, description="Realistic user prompt given to the agent.")
    fixtures: list[str] = Field(
        default_factory=list,
        description="Relative paths to fixture files or directories.",
    )
    assertions: list[EvalAssertion] = Field(
        ...,
        min_length=1,
        description="Verifiable assertions required to pass this scenario.",
    )


class EvalSuite(BaseModel):
    """Validated ``evals/evals.json`` suite for a Hybrid Executable Skill."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    skill_name: str = Field(..., description="Target skill identifier.")
    schema_version: str = Field(default="1.0", pattern=r"^\d+\.\d+$")
    evals: list[EvalCase] = Field(
        ...,
        min_length=1,
        description="List of TDD evaluation scenarios.",
    )

    @field_validator("skill_name")
    @classmethod
    def _validate_skill_name(cls, value: str) -> str:
        if not _SKILL_NAME_PATTERN.match(value):
            msg = f"Invalid skill_name '{value}'; must be lowercase kebab-case."
            raise ValueError(msg)
        return value

    @classmethod
    def from_json_file(cls, path: Path) -> EvalSuite:
        """Load and validate an ``evals/evals.json`` file from disk."""
        raw = json.loads(path.read_text(encoding="utf-8"))
        return cls.model_validate(raw)


class CollisionSeverity(StrEnum):
    """Semantic similarity risk classification between two skill descriptions."""

    OK = "OK"
    WARNING = "WARNING"
    HIGH_RISK = "HIGH_RISK"
    BLOCKING_ERROR = "BLOCKING_ERROR"


class CollisionPair(BaseModel):
    """Pairwise semantic similarity result between two skills (``INV-SKILL-02``)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    skill_a: str = Field(..., min_length=1)
    skill_b: str = Field(..., min_length=1)
    cosine_similarity: float = Field(..., ge=0.0, le=1.0)
    severity: CollisionSeverity

    @classmethod
    def from_similarity(
        cls,
        skill_a: str,
        skill_b: str,
        cosine_similarity: float,
        *,
        warn_threshold: float = 0.58,
        high_risk_threshold: float = 0.72,
        error_threshold: float = 0.85,
    ) -> CollisionPair:
        """Classify a pair of skills based on their semantic cosine similarity."""
        if cosine_similarity >= error_threshold:
            severity = CollisionSeverity.BLOCKING_ERROR
        elif cosine_similarity >= high_risk_threshold:
            severity = CollisionSeverity.HIGH_RISK
        elif cosine_similarity >= warn_threshold:
            severity = CollisionSeverity.WARNING
        else:
            severity = CollisionSeverity.OK
        return cls(
            skill_a=skill_a,
            skill_b=skill_b,
            cosine_similarity=round(cosine_similarity, 4),
            severity=severity,
        )


class SkillBudgetMetrics(BaseModel):
    """Per-skill progressive disclosure token and line metrics (``INV-SKILL-01``)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    skill_name: str = Field(..., min_length=1)
    track: CatalogTrack
    l1_words: int = Field(..., ge=0)
    l1_tokens: int = Field(..., ge=0)
    l2_lines: int = Field(..., ge=0)
    l2_tokens: int = Field(..., ge=0)
    l3_scripts_count: int = Field(default=0, ge=0)
    l3_scripts_tokens: int = Field(default=0, ge=0)
    l3_references_count: int = Field(default=0, ge=0)
    l3_reference_tokens: int = Field(default=0, ge=0)
    warnings: list[str] = Field(default_factory=list)
    violations: list[str] = Field(default_factory=list)
    within_budget: bool = Field(default=True)


class CollisionReport(BaseModel):
    """Structured output of ``skillops audit`` combining collision and token budget checks."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    catalog_path: str = Field(..., min_length=1)
    total_skills: int = Field(..., ge=0)
    total_l1_bundle_tokens: int = Field(..., ge=0)
    max_bundle_tokens: int = Field(default=1500, ge=1)
    skills: list[SkillBudgetMetrics] = Field(default_factory=list)
    collisions: list[CollisionPair] = Field(default_factory=list)
    passed: bool = Field(...)


class BenchmarkRunStats(BaseModel):
    """Aggregated trial metrics for either ``with_skill`` or ``without_skill`` runs."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    pass_rate_mean: float = Field(..., ge=0.0, le=1.0)
    pass_rate_stddev: float = Field(default=0.0, ge=0.0, le=1.0)
    tokens_mean: int = Field(..., ge=1)
    latency_ms_mean: int = Field(..., ge=0)


class BenchmarkVerdict(StrEnum):
    """Certification verdict for ``skillops eval`` (``INV-SKILL-05``)."""

    CERTIFIED_IMPROVEMENT = "CERTIFIED_IMPROVEMENT"
    NEUTRAL = "NEUTRAL"
    REJECTED_REGRESSION = "REJECTED_REGRESSION"


class BenchmarkDelta(BaseModel):
    """Computed delta comparing ``with_skill`` against the ``without_skill`` baseline."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    pass_rate_gain: float = Field(..., ge=-1.0, le=1.0)
    token_reduction_pct: float = Field(
        ...,
        description="Percentage change in token usage (negative means fewer tokens used).",
    )
    verdict: BenchmarkVerdict


class BenchmarkReport(BaseModel):
    """Validated ``evals/benchmark.json`` report enforcing ``INV-SKILL-05`` regression detection."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    skill_name: str = Field(..., min_length=1)
    runner: str = Field(
        default="deterministic-ast",
        min_length=1,
        description="Zero-API local evaluation runner identifier.",
    )
    timestamp: str = Field(..., min_length=10)
    with_skill: BenchmarkRunStats
    without_skill: BenchmarkRunStats
    delta: BenchmarkDelta

    @model_validator(mode="after")
    def _enforce_regression_invariant(self) -> BenchmarkReport:
        """Enforce INV-SKILL-05: reject skills that regress pass rate or inflate tokens >25%."""
        gain = round(self.with_skill.pass_rate_mean - self.without_skill.pass_rate_mean, 4)
        token_change_pct = round(
            (
                (self.with_skill.tokens_mean - self.without_skill.tokens_mean)
                / self.without_skill.tokens_mean
            )
            * 100.0,
            2,
        )
        should_reject = gain <= 0.0 or (token_change_pct > 25.0 and gain < 0.05)
        if should_reject and self.delta.verdict is not BenchmarkVerdict.REJECTED_REGRESSION:
            msg = (
                f"INV-SKILL-05 violation for '{self.skill_name}': with_skill pass_rate_gain={gain} "
                f"and token_change_pct={token_change_pct}% requires verdict='REJECTED_REGRESSION'."
            )
            raise ValueError(msg)
        return self

    @classmethod
    def from_runs(
        cls,
        *,
        skill_name: str,
        timestamp: str,
        with_skill: BenchmarkRunStats,
        without_skill: BenchmarkRunStats,
        runner: str = "deterministic-ast",
    ) -> BenchmarkReport:
        """Compute delta and verdict from ``with_skill`` and ``without_skill`` runs."""
        gain = round(with_skill.pass_rate_mean - without_skill.pass_rate_mean, 4)
        token_change_pct = round(
            ((with_skill.tokens_mean - without_skill.tokens_mean) / without_skill.tokens_mean)
            * 100.0,
            2,
        )
        if gain <= 0.0 or (token_change_pct > 25.0 and gain < 0.05):
            verdict = BenchmarkVerdict.REJECTED_REGRESSION
        elif gain >= 0.15:
            verdict = BenchmarkVerdict.CERTIFIED_IMPROVEMENT
        else:
            verdict = BenchmarkVerdict.NEUTRAL

        return cls(
            skill_name=skill_name,
            runner=runner,
            timestamp=timestamp,
            with_skill=with_skill,
            without_skill=without_skill,
            delta=BenchmarkDelta(
                pass_rate_gain=gain,
                token_reduction_pct=token_change_pct,
                verdict=verdict,
            ),
        )


class SkillOpsConfig(BaseModel):
    """Workspace configuration schema stored in ``.skillops.yml``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    version: str = Field(default="1.0")
    catalog_dir: str = Field(default="catalog")
    max_bundle_skills: int = Field(default=12, ge=1, le=12)
    max_l1_tokens: int = Field(default=160, ge=40, le=200)
    max_l2_lines: int = Field(default=250, ge=50, le=500)
    collision_warn_threshold: float = Field(default=0.58, ge=0.1, le=0.99)
    collision_high_risk_threshold: float = Field(default=0.72, ge=0.1, le=0.99)
    collision_error_threshold: float = Field(default=0.85, ge=0.1, le=0.99)
    targets: list[str] = Field(
        default_factory=lambda: ["claude", "antigravity", "cursor", "codex", "copilot"]
    )
