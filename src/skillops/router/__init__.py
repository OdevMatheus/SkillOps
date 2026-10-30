"""Context-aware repository stack fingerprinter and dynamic skill router (``ADR-0003``)."""

from __future__ import annotations

from skillops.models import RoutedBundle, ScoredSkill, SkippedSkill
from skillops.router.bundle_compiler import (
    DynamicSkillRouter,
    compile_skill_bundle,
    route_repository,
    score_skill_against_profile,
)
from skillops.router.fingerprinter import (
    RepoFingerprint,
    RepoFingerprinter,
    RepoProfile,
    fingerprint_repository,
    normalize_package_name,
)

__all__ = [
    "DynamicSkillRouter",
    "RepoFingerprint",
    "RepoFingerprinter",
    "RepoProfile",
    "RoutedBundle",
    "ScoredSkill",
    "SkippedSkill",
    "compile_skill_bundle",
    "fingerprint_repository",
    "normalize_package_name",
    "route_repository",
    "score_skill_against_profile",
]
