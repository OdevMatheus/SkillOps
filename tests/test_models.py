"""Unit tests for strict Pydantic v2 contracts and the Reference Hybrid Skill Catalog."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from skillops.models import (
    AssertionType,
    BenchmarkReport,
    BenchmarkRunStats,
    BenchmarkVerdict,
    CatalogTrack,
    CollisionPair,
    CollisionReport,
    CollisionSeverity,
    EvalAssertion,
    EvalCase,
    EvalSuite,
    ScriptEntrypoint,
    ScriptOutput,
    SkillEntrypoints,
    SkillManifest,
    SkillOpsConfig,
    count_words,
    estimate_token_count,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
CATALOG_DIR = REPO_ROOT / "catalog"

VALID_DESCRIPTION = (
    "Use when designing, implementing, or auditing Model Context Protocol (MCP) servers "
    "and FastMCP tools in Python or TypeScript to enforce strict JSON-RPC stdio hygiene, "
    "Pydantic input schemas, tool docstring clarity, and localhost-bound SSE transport "
    "security without polluting stdout or exposing untyped tool handlers to AI coding agents."
)


def test_word_and_token_estimation_helpers() -> None:
    """Verify deterministic word and token estimation helpers handle empty and normal text."""
    assert count_words("   ") == 0
    assert estimate_token_count("   ") == 0
    assert count_words(VALID_DESCRIPTION) >= 40
    assert 40 <= estimate_token_count(VALID_DESCRIPTION) <= 160


def test_skill_manifest_validates_invariants() -> None:
    """Verify SkillManifest accepts valid metadata and rejects INV-SKILL-01 violations."""
    manifest = SkillManifest(
        name="mcp-architect",
        description=VALID_DESCRIPTION,
        version="1.0.0",
        track=CatalogTrack.AI_ENGINEERING,
        tags=["mcp", "fastmcp"],
        entrypoints=SkillEntrypoints(
            scripts=[
                ScriptEntrypoint(
                    path="scripts/validate_mcp_server.py",
                    description="Audit FastMCP tool handlers and stdio safety.",
                )
            ]
        ),
        body_lines=45,
        body_tokens=320,
    )
    assert manifest.description_words >= 40
    assert manifest.description_tokens <= 160

    with pytest.raises(ValidationError, match="lowercase kebab-case"):
        SkillManifest(
            name="Invalid_Name",
            description=VALID_DESCRIPTION,
            track=CatalogTrack.AI_ENGINEERING,
            tags=["mcp"],
            entrypoints=manifest.entrypoints,
        )

    with pytest.raises(ValidationError, match="start with 'Use when'"):
        SkillManifest(
            name="bad-prefix",
            description="Always run this skill whenever you write Python code in any repository.",
            track=CatalogTrack.AI_ENGINEERING,
            tags=["mcp"],
            entrypoints=manifest.entrypoints,
        )

    with pytest.raises(ValidationError, match="between 40 and 110 words"):
        SkillManifest(
            name="too-short",
            description="Use when testing short descriptions that violate the minimum word floor.",
            track=CatalogTrack.AI_ENGINEERING,
            tags=["mcp"],
            entrypoints=manifest.entrypoints,
        )

    with pytest.raises(ValidationError, match="scripts/\\*\\.py"):
        ScriptEntrypoint(
            path="bin/run.sh",
            description="Invalid non-Python script path.",
        )


def test_from_skill_md_enforces_250_line_cap(tmp_path: Path) -> None:
    """Verify SkillManifest.from_skill_md rejects files >250 lines or missing frontmatter."""
    no_frontmatter = tmp_path / "NO_FM.md"
    no_frontmatter.write_text("# Missing YAML frontmatter\n", encoding="utf-8")
    with pytest.raises(ValueError, match="missing valid YAML frontmatter"):
        SkillManifest.from_skill_md(no_frontmatter)

    oversized = tmp_path / "OVERSIZED.md"
    oversized.write_text("\n".join(["line"] * 255), encoding="utf-8")
    with pytest.raises(ValueError, match="exceeding INV-SKILL-01 maximum of 250 lines"):
        SkillManifest.from_skill_md(oversized)


def test_collision_pair_and_report_classification() -> None:
    """Verify pairwise semantic collision severity thresholds (INV-SKILL-02)."""
    ok_pair = CollisionPair.from_similarity("mcp-architect", "postgres-query-doctor", 0.21)
    assert ok_pair.severity is CollisionSeverity.OK

    warn_pair = CollisionPair.from_similarity("skill-a", "skill-b", 0.62)
    assert warn_pair.severity is CollisionSeverity.WARNING

    high_pair = CollisionPair.from_similarity("skill-a", "skill-b", 0.78)
    assert high_pair.severity is CollisionSeverity.HIGH_RISK

    err_pair = CollisionPair.from_similarity("skill-a", "skill-b", 0.89)
    assert err_pair.severity is CollisionSeverity.BLOCKING_ERROR

    report = CollisionReport(
        catalog_path="catalog",
        total_skills=2,
        total_l1_bundle_tokens=150,
        collisions=[err_pair],
        passed=False,
    )
    assert not report.passed


def test_eval_suite_and_benchmark_report_regression_guard() -> None:
    """Verify EvalSuite and BenchmarkReport enforce INV-SKILL-05 regression detection."""
    suite = EvalSuite(
        skill_name="mcp-architect",
        evals=[
            EvalCase(
                id="eval-01",
                name="Verify MCP stdio safety",
                prompt="Audit our MCP server in server.py and remove stdout print calls.",
                assertions=[
                    EvalAssertion(
                        id="assert-01",
                        type=AssertionType.TOOL_CALL_CONTAINS,
                        target="validate_mcp_server.py",
                        description="Runs the bundled MCP validation script.",
                    )
                ],
            )
        ],
    )
    assert suite.skill_name == "mcp-architect"

    certified = BenchmarkReport.from_runs(
        skill_name="mcp-architect",
        runner="deterministic-ast",
        timestamp="2026-10-29T14:00:00Z",
        with_skill=BenchmarkRunStats(pass_rate_mean=0.95, tokens_mean=2800, latency_ms_mean=3100),
        without_skill=BenchmarkRunStats(
            pass_rate_mean=0.60, tokens_mean=5200, latency_ms_mean=6000
        ),
    )
    assert certified.delta.verdict is BenchmarkVerdict.CERTIFIED_IMPROVEMENT

    regressed = BenchmarkReport.from_runs(
        skill_name="bad-skill",
        runner="deterministic-ast",
        timestamp="2026-10-29T14:00:00Z",
        with_skill=BenchmarkRunStats(pass_rate_mean=0.50, tokens_mean=6000, latency_ms_mean=5000),
        without_skill=BenchmarkRunStats(
            pass_rate_mean=0.65, tokens_mean=4000, latency_ms_mean=4000
        ),
    )
    assert regressed.delta.verdict is BenchmarkVerdict.REJECTED_REGRESSION

    with pytest.raises(ValidationError, match="INV-SKILL-05 violation"):
        BenchmarkReport.model_validate(
            {
                "skill_name": "dishonest-skill",
                "runner": "deterministic-ast",
                "timestamp": "2026-10-29T14:00:00Z",
                "with_skill": {
                    "pass_rate_mean": 0.50,
                    "pass_rate_stddev": 0.0,
                    "tokens_mean": 5000,
                    "latency_ms_mean": 4000,
                },
                "without_skill": {
                    "pass_rate_mean": 0.60,
                    "pass_rate_stddev": 0.0,
                    "tokens_mean": 4000,
                    "latency_ms_mean": 3500,
                },
                "delta": {
                    "pass_rate_gain": -0.10,
                    "token_reduction_pct": 25.0,
                    "verdict": "CERTIFIED_IMPROVEMENT",
                },
            }
        )


def test_reference_catalog_skills_pass_all_contracts() -> None:
    """Validate all Reference Hybrid Executable Skills in catalog/ (manifests, evals, scripts)."""
    skill_md_files = sorted(CATALOG_DIR.rglob("SKILL.md"))
    assert len(skill_md_files) >= 4

    for skill_md in skill_md_files:
        skill_dir = skill_md.parent
        manifest = SkillManifest.from_skill_md(skill_md)
        assert manifest.name == skill_dir.name
        assert 40 <= manifest.description_words <= 110
        assert manifest.description_tokens <= 160
        assert manifest.body_lines <= 250

        evals_path = skill_dir / "evals" / "evals.json"
        assert evals_path.exists(), f"Missing evals.json in {skill_dir}"
        suite = EvalSuite.from_json_file(evals_path)
        assert suite.skill_name == manifest.name
        assert len(suite.evals) >= 2

        bench_path = skill_dir / "evals" / "benchmark.json"
        assert bench_path.exists(), f"Missing benchmark.json in {skill_dir}"
        bench_raw: dict[str, Any] = json.loads(bench_path.read_text(encoding="utf-8"))
        bench = BenchmarkReport.model_validate(bench_raw)
        assert bench.skill_name == manifest.name
        assert bench.delta.verdict is BenchmarkVerdict.CERTIFIED_IMPROVEMENT

        for script_entry in manifest.entrypoints.scripts:
            script_path = skill_dir / script_entry.path
            assert script_path.exists(), f"Missing bundled script {script_path}"
            proc = subprocess.run(
                [sys.executable, str(script_path), "--path", str(script_path), "--json"],
                capture_output=True,
                text=True,
                check=False,
            )
            assert proc.returncode in {0, 1}
            output = ScriptOutput.model_validate(json.loads(proc.stdout))
            assert output.skill == manifest.name


def test_skillops_config_defaults() -> None:
    """Verify SkillOpsConfig default values match .skillops.yml."""
    cfg = SkillOpsConfig()
    assert cfg.max_bundle_skills == 12
    assert "claude" in cfg.targets
    assert "antigravity" in cfg.targets
