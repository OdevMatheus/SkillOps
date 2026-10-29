"""SkillOps — The Python 3.12+ Engine & Benchmark-Verified Library for AI Coding Agent Skills."""

from __future__ import annotations

from enum import IntEnum

__version__ = "0.2.0"


class ExitCode(IntEnum):
    """Canonical CLI exit codes defined in SKILL_CONTRACT.md."""

    SUCCESS = 0
    ERROR = 1
    COLLISION_ERROR = 2
    BUDGET_OR_CONTRACT_ERROR = 3
    EVAL_REGRESSION_ERROR = 4


__all__ = [
    "ExitCode",
    "__version__",
]
