"""SkillOps — The Python 3.12+ Engine & Benchmark-Verified Library for AI Coding Agent Skills."""

from __future__ import annotations

from enum import IntEnum

from skillops.models import (
    AssertionType,
    BenchmarkDelta,
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
    RepoFingerprint,
    RepoProfile,
    RoutedBundle,
    RoutingSignals,
    RuntimeTarget,
    ScoredSkill,
    ScriptEntrypoint,
    ScriptFinding,
    ScriptOutput,
    SkillBudgetMetrics,
    SkillEntrypoints,
    SkillManifest,
    SkillOpsConfig,
    SkippedSkill,
    SyncedArtifact,
    SyncLockEntry,
    SyncLockfile,
    SyncReport,
)

__version__ = "0.3.0"


class ExitCode(IntEnum):
    """Canonical CLI exit codes defined in SKILL_CONTRACT.md."""

    SUCCESS = 0
    ERROR = 1
    COLLISION_ERROR = 2
    BUDGET_OR_CONTRACT_ERROR = 3
    EVAL_REGRESSION_ERROR = 4


__all__ = [
    "AssertionType",
    "BenchmarkDelta",
    "BenchmarkReport",
    "BenchmarkRunStats",
    "BenchmarkVerdict",
    "CatalogTrack",
    "CollisionPair",
    "CollisionReport",
    "CollisionSeverity",
    "EvalAssertion",
    "EvalCase",
    "EvalSuite",
    "ExitCode",
    "RepoFingerprint",
    "RepoProfile",
    "RoutedBundle",
    "RoutingSignals",
    "RuntimeTarget",
    "ScoredSkill",
    "ScriptEntrypoint",
    "ScriptFinding",
    "ScriptOutput",
    "SkillBudgetMetrics",
    "SkillEntrypoints",
    "SkillManifest",
    "SkillOpsConfig",
    "SkippedSkill",
    "SyncLockEntry",
    "SyncLockfile",
    "SyncReport",
    "SyncedArtifact",
    "__version__",
]
