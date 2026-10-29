"""Pairwise Semantic Similarity & Routing Collision Engine (`SKILL_CONTRACT.md` §1, `ADR-0002`).

Solves *Implicit Routing Collapse* (``arXiv:2610.18522``) with a 100% Zero-API, deterministic
hybrid vectorizer combining:
- Filtered domain word unigrams (sublinear TF)
- Technical phrase word bigrams
- Morphological character 4-grams (capturing stems like ``postgres`` / ``postgresql``)
- Weighted ``tags`` and ``routing_signals.dependencies_any`` features
- Catalog-wide smoothed Inverse Document Frequency (IDF) weighting
"""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import TYPE_CHECKING

from skillops.auditor.parser import discover_skill_directories, parse_skill_directory
from skillops.auditor.token_budget import analyze_parsed_skill_budget
from skillops.models import (
    CollisionPair,
    CollisionReport,
    CollisionSeverity,
    SkillBudgetMetrics,
    SkillManifest,
    SkillOpsConfig,
)

if TYPE_CHECKING:
    from collections.abc import Sequence
    from pathlib import Path

_WORD_RE = re.compile(r"[a-z0-9]+")

# Routing template stopwords that appear in almost every SKILL.md description ("Use when...")
_ROUTING_STOPWORDS: frozenset[str] = frozenset(
    {
        "a",
        "across",
        "agent",
        "agents",
        "ai",
        "all",
        "also",
        "an",
        "and",
        "any",
        "application",
        "applications",
        "are",
        "as",
        "at",
        "auditing",
        "be",
        "before",
        "between",
        "both",
        "build",
        "building",
        "by",
        "can",
        "changes",
        "check",
        "checking",
        "code",
        "codebase",
        "coding",
        "compute",
        "configuring",
        "create",
        "creating",
        "data",
        "default",
        "design",
        "designing",
        "detect",
        "detecting",
        "deterministic",
        "do",
        "during",
        "editing",
        "enforce",
        "enforcing",
        "ensure",
        "ensuring",
        "every",
        "existing",
        "exposing",
        "file",
        "files",
        "for",
        "from",
        "full",
        "generate",
        "high",
        "how",
        "if",
        "implement",
        "implementing",
        "in",
        "include",
        "including",
        "inspect",
        "inspecting",
        "into",
        "is",
        "it",
        "its",
        "level",
        "local",
        "maintain",
        "modifying",
        "module",
        "modules",
        "must",
        "new",
        "no",
        "not",
        "of",
        "on",
        "only",
        "or",
        "other",
        "out",
        "over",
        "overly",
        "pattern",
        "patterns",
        "per",
        "perform",
        "prevent",
        "preventing",
        "production",
        "project",
        "projects",
        "provide",
        "providing",
        "refactoring",
        "related",
        "repository",
        "review",
        "reviewing",
        "risk",
        "risks",
        "run",
        "running",
        "safe",
        "safely",
        "safety",
        "shared",
        "should",
        "skill",
        "skills",
        "so",
        "source",
        "specific",
        "standard",
        "strict",
        "structured",
        "such",
        "support",
        "system",
        "systems",
        "target",
        "task",
        "tasks",
        "that",
        "the",
        "their",
        "them",
        "then",
        "these",
        "this",
        "through",
        "to",
        "tool",
        "tools",
        "type",
        "types",
        "under",
        "up",
        "update",
        "updating",
        "use",
        "used",
        "using",
        "validate",
        "validating",
        "validation",
        "verify",
        "verifying",
        "via",
        "when",
        "where",
        "which",
        "while",
        "with",
        "within",
        "without",
        "workflow",
        "workflows",
        "write",
        "writing",
        "zero",
    }
)


def tokenize_routing_text(text: str) -> list[str]:
    """Tokenize routing metadata into lowercase domain terms, removing generic prompt stopwords."""
    raw_tokens = _WORD_RE.findall(text.lower())
    return [tok for tok in raw_tokens if len(tok) >= 2 and tok not in _ROUTING_STOPWORDS]


def extract_text_features(text: str) -> dict[str, float]:
    """Extract weighted unigram, bigram, and character 4-gram features from a text string."""
    tokens = tokenize_routing_text(text)
    if not tokens:
        return {}

    features: dict[str, float] = {}
    counts = Counter(tokens)
    for term, count in counts.items():
        features[f"ug:{term}"] = 1.0 + math.log(count)
        if len(term) >= 5:
            padded = f"^{term}$"
            for idx in range(len(padded) - 3):
                gram = padded[idx : idx + 4]
                key = f"c4:{gram}"
                features[key] = features.get(key, 0.0) + 0.22

    for idx in range(len(tokens) - 1):
        bg_key = f"bg:{tokens[idx]}_{tokens[idx + 1]}"
        features[bg_key] = features.get(bg_key, 0.0) + 1.25

    return features


def extract_skill_features(manifest: SkillManifest) -> dict[str, float]:
    """Extract a composite routing feature vector from a ``SkillManifest``."""
    features = extract_text_features(manifest.description)

    for name_tok in tokenize_routing_text(manifest.name.replace("-", " ")):
        key = f"ug:{name_tok}"
        features[key] = features.get(key, 0.0) + 1.35

    for tag in manifest.tags:
        clean_tag = tag.strip().lower()
        if clean_tag:
            tag_key = f"tag:{clean_tag}"
            features[tag_key] = features.get(tag_key, 0.0) + 1.5
            for tok in tokenize_routing_text(clean_tag):
                ug_key = f"ug:{tok}"
                features[ug_key] = features.get(ug_key, 0.0) + 0.75

    for dep in manifest.routing_signals.dependencies_any:
        clean_dep = dep.strip().lower()
        if clean_dep:
            dep_key = f"dep:{clean_dep}"
            features[dep_key] = features.get(dep_key, 0.0) + 1.4

    return features


def compute_idf_weights(feature_maps: Sequence[dict[str, float]]) -> dict[str, float]:
    """Compute smoothed Inverse Document Frequency (IDF) weights across a skill catalog."""
    n_docs = len(feature_maps)
    if n_docs == 0:
        return {}

    doc_freq: Counter[str] = Counter()
    for fmap in feature_maps:
        for feat in fmap:
            doc_freq[feat] += 1

    return {feat: 1.0 + math.log((n_docs + 1.0) / (df + 1.0)) for feat, df in doc_freq.items()}


def compute_feature_cosine(
    vec_a: dict[str, float],
    vec_b: dict[str, float],
    *,
    idf_weights: dict[str, float] | None = None,
) -> tuple[float, list[str]]:
    """Compute weighted cosine similarity and top shared human-readable domain terms."""
    if not vec_a or not vec_b:
        return 0.0, []

    weights = idf_weights or {}
    weighted_a = {k: v * weights.get(k, 1.0) for k, v in vec_a.items()}
    weighted_b = {k: v * weights.get(k, 1.0) for k, v in vec_b.items()}

    norm_a = math.sqrt(sum(val * val for val in weighted_a.values()))
    norm_b = math.sqrt(sum(val * val for val in weighted_b.values()))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0, []

    shared_keys = set(weighted_a) & set(weighted_b)
    if not shared_keys:
        return 0.0, []

    dot = sum(weighted_a[k] * weighted_b[k] for k in shared_keys)
    cosine = min(1.0, max(0.0, dot / (norm_a * norm_b)))

    readable_contributions: dict[str, float] = {}
    for key in shared_keys:
        if key.startswith(("ug:", "tag:", "dep:")):
            term = key.split(":", 1)[1]
            readable_contributions[term] = (
                readable_contributions.get(term, 0.0) + weighted_a[key] * weighted_b[key]
            )

    top_terms = [
        term
        for term, _ in sorted(
            readable_contributions.items(),
            key=lambda item: (-item[1], item[0]),
        )[:6]
    ]
    return round(cosine, 4), top_terms


def compute_text_similarity(text_a: str, text_b: str) -> float:
    """Compute zero-API semantic cosine similarity between two raw text descriptions."""
    feat_a = extract_text_features(text_a)
    feat_b = extract_text_features(text_b)
    sim, _ = compute_feature_cosine(feat_a, feat_b)
    return sim


def compute_manifest_similarity(
    skill_a: SkillManifest,
    skill_b: SkillManifest,
    *,
    idf_weights: dict[str, float] | None = None,
) -> tuple[float, list[str]]:
    """Compute ``(cosine_similarity, shared_terms)`` between two ``SkillManifest`` objects."""
    feat_a = extract_skill_features(skill_a)
    feat_b = extract_skill_features(skill_b)
    return compute_feature_cosine(feat_a, feat_b, idf_weights=idf_weights)


def compute_collision_matrix(
    manifests: Sequence[SkillManifest],
    *,
    warn_threshold: float = 0.58,
    high_risk_threshold: float = 0.72,
    error_threshold: float = 0.85,
    include_ok: bool = False,
) -> list[CollisionPair]:
    """Compute pairwise semantic collisions across ``manifests`` sorted by similarity descending."""
    if len(manifests) < 2:
        return []

    ordered = sorted(manifests, key=lambda item: item.name)
    feature_maps = [extract_skill_features(m) for m in ordered]
    idf = compute_idf_weights(feature_maps)

    pairs: list[CollisionPair] = []
    for idx_a, left in enumerate(ordered):
        for idx_b in range(idx_a + 1, len(ordered)):
            right = ordered[idx_b]
            sim, shared_terms = compute_feature_cosine(
                feature_maps[idx_a],
                feature_maps[idx_b],
                idf_weights=idf,
            )
            pair = CollisionPair.from_similarity(
                left.name,
                right.name,
                sim,
                warn_threshold=warn_threshold,
                high_risk_threshold=high_risk_threshold,
                error_threshold=error_threshold,
                shared_terms=shared_terms,
            )
            if include_ok or pair.severity is not CollisionSeverity.OK:
                pairs.append(pair)

    return sorted(
        pairs,
        key=lambda item: (-item.cosine_similarity, item.skill_a, item.skill_b),
    )


def audit_catalog(
    catalog_dir: Path,
    *,
    config: SkillOpsConfig | None = None,
    strict: bool = False,
    max_bundle_tokens: int = 1500,
    require_layout: bool = False,
    validate_evals: bool = False,
) -> CollisionReport:
    """Audit a skill catalog for both 3-level token budgets and pairwise semantic collisions."""
    cfg = config or SkillOpsConfig()
    skill_dirs = discover_skill_directories(catalog_dir)
    manifests: list[SkillManifest] = []
    budget_metrics: list[SkillBudgetMetrics] = []

    for skill_dir in skill_dirs:
        parsed = parse_skill_directory(
            skill_dir,
            require_layout=require_layout,
            validate_evals=validate_evals,
        )
        manifests.append(parsed.manifest)
        budget_metrics.append(
            analyze_parsed_skill_budget(
                parsed,
                max_l1_tokens=cfg.max_l1_tokens,
                max_l2_lines=cfg.max_l2_lines,
            )
        )

    collisions = compute_collision_matrix(
        manifests,
        warn_threshold=cfg.collision_warn_threshold,
        high_risk_threshold=cfg.collision_high_risk_threshold,
        error_threshold=cfg.collision_error_threshold,
    )

    has_collision_error = any(
        pair.severity is CollisionSeverity.BLOCKING_ERROR
        or (strict and pair.severity is CollisionSeverity.HIGH_RISK)
        for pair in collisions
    )
    all_within_budget = all(item.within_budget for item in budget_metrics)
    total_l1_tokens = sum(item.l1_tokens for item in budget_metrics)

    return CollisionReport(
        catalog_path=catalog_dir.as_posix(),
        total_skills=len(manifests),
        total_l1_bundle_tokens=total_l1_tokens,
        max_bundle_tokens=max_bundle_tokens,
        skills=budget_metrics,
        collisions=collisions,
        passed=not has_collision_error
        and all_within_budget
        and total_l1_tokens <= max_bundle_tokens,
    )
