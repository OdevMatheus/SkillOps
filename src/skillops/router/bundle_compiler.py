"""Context-aware dynamic skill router and greedy collision-free bundle compiler (``ADR-0003``).

Matches a ``RepoProfile`` against ``catalog/`` skills and compiles an optimal bundle $B$ of
at most 12 skills respecting ``<= 1,500`` Level 1 tokens and ``< 0.78`` pairwise cosine
similarity (``INV-SKILL-03``).
"""

from __future__ import annotations

from fnmatch import fnmatch
from pathlib import Path

from skillops.auditor.collision import (
    compute_feature_cosine,
    compute_idf_weights,
    extract_skill_features,
    tokenize_routing_text,
)
from skillops.auditor.parser import (
    ParsedSkillDirectory,
    discover_skill_directories,
    parse_skill_directory,
)
from skillops.models import (
    RepoProfile,
    RoutedBundle,
    ScoredSkill,
    SkillManifest,
    SkippedSkill,
)
from skillops.router.fingerprinter import fingerprint_repository, normalize_package_name


def _matches_file_signal(pattern: str, detected_files: set[str], basenames: set[str]) -> bool:
    """Return True if ``pattern`` matches any detected repository file or basename."""
    normalized = pattern.replace("\\", "/").strip("/")
    if normalized in detected_files or normalized in basenames:
        return True
    return any(fnmatch(f, normalized) or fnmatch(Path(f).name, normalized) for f in detected_files)


def score_skill_against_profile(
    manifest: SkillManifest,
    profile: RepoProfile,
    *,
    task_context: str = "",
) -> tuple[float, list[str], str | None]:
    """Compute relevance score $S(k) \\in [0, 100]$ for ``manifest`` against ``profile``.

    Returns ``(relevance_score, matched_signals, rejection_reason)``.
    """
    task_lower = task_context.lower().strip()
    if task_lower:
        for neg in manifest.routing_signals.negative_triggers:
            clean_neg = neg.lower().strip()
            if clean_neg and clean_neg in task_lower:
                return 0.0, [], f"negative_trigger:{clean_neg}"

    repo_langs = {lang.lower() for lang in profile.languages}
    repo_files = set(profile.detected_files)
    repo_basenames = {Path(f).name for f in repo_files}

    repo_ecosystem_tokens: set[str] = set()
    for item in (
        *profile.dependencies,
        *profile.frameworks,
        *profile.databases,
        *profile.signals,
    ):
        cleaned = item.lower().strip()
        repo_ecosystem_tokens.add(cleaned)
        norm = normalize_package_name(cleaned)
        if norm:
            repo_ecosystem_tokens.add(norm)
        for sub in tokenize_routing_text(cleaned.replace("-", " ")):
            repo_ecosystem_tokens.add(sub)

    matched_signals: list[str] = []
    score = 0.0

    # 1. Language compatibility & match (up to 30 pts)
    skill_langs = [lang.lower().strip() for lang in manifest.routing_signals.languages if lang]
    if skill_langs:
        matched_langs = [lang for lang in skill_langs if lang in repo_langs]
        if not matched_langs and repo_langs:
            return 0.0, [], "language_mismatch"
        if matched_langs:
            score += 30.0
            for lang in matched_langs:
                matched_signals.append(f"lang:{lang}")
    elif repo_langs:
        score += 15.0

    # 2. Indicator files match (up to 25 pts)
    matched_files = [
        pat
        for pat in manifest.routing_signals.files_any
        if _matches_file_signal(pat, repo_files, repo_basenames)
    ]
    if matched_files:
        score += min(25.0, 20.0 + 2.5 * (len(matched_files) - 1))
        for pat in matched_files:
            matched_signals.append(f"file:{pat}")

    # 3. Dependencies / Frameworks / Databases match (up to 35 pts)
    skill_deps = [dep.lower().strip() for dep in manifest.routing_signals.dependencies_any if dep]
    if skill_deps:
        matched_deps: list[str] = []
        for dep in skill_deps:
            norm_dep = normalize_package_name(dep) or dep
            if dep in repo_ecosystem_tokens or norm_dep in repo_ecosystem_tokens:
                matched_deps.append(dep)
        if matched_deps:
            score += min(35.0, 25.0 + 5.0 * (len(matched_deps) - 1))
            for dep in matched_deps:
                matched_signals.append(f"dep:{dep}")
    elif matched_signals:
        # General architectural / quality skill applicable to any repo matching language/files
        score += 15.0
        matched_signals.append(f"track:{manifest.track.value}")

    # 4. Tag & domain keyword alignment (up to 15 pts)
    matched_tags: list[str] = []
    for tag in manifest.tags:
        clean_tag = tag.lower().strip()
        if not clean_tag or clean_tag in repo_langs:
            continue
        tag_tokens = set(tokenize_routing_text(clean_tag.replace("-", " ")))
        if clean_tag in repo_ecosystem_tokens or (
            tag_tokens and tag_tokens.issubset(repo_ecosystem_tokens)
        ):
            matched_tags.append(clean_tag)

    if matched_tags:
        score += min(15.0, 5.0 * len(matched_tags))
        for tag in matched_tags:
            matched_signals.append(f"tag:{tag}")

    if profile.python_312_plus and "python" in skill_langs:
        score += 5.0
        if "signal:python-3.12+" not in matched_signals:
            matched_signals.append("signal:python-3.12+")

    if task_lower:
        task_tokens = set(tokenize_routing_text(task_lower))
        skill_keywords = {
            t.lower() for t in (*manifest.tags, *manifest.name.split("-")) if t.strip()
        }
        matched_task = sorted(task_tokens & skill_keywords)
        if matched_task:
            score += min(10.0, 5.0 * len(matched_task))
            for tok in matched_task:
                matched_signals.append(f"task:{tok}")

    final_score = round(min(100.0, score), 2)
    return final_score, matched_signals, None


class DynamicSkillRouter:
    """Compiles a deterministic, collision-free bundle of 5 to 12 skills for a repository."""

    def __init__(
        self,
        *,
        max_skills: int = 12,
        max_l1_tokens: int = 1500,
        max_similarity: float = 0.78,
        min_score: float = 20.0,
    ) -> None:
        if max_skills < 1 or max_skills > 12:
            msg = f"INV-SKILL-03 requires 1 <= max_skills <= 12 (got {max_skills})."
            raise ValueError(msg)
        self._max_skills = max_skills
        self._max_l1_tokens = max_l1_tokens
        self._max_similarity = max_similarity
        self._min_score = min_score

    def compile_bundle(
        self,
        profile: RepoProfile,
        catalog_dir: Path,
        *,
        task_context: str = "",
    ) -> RoutedBundle:
        """Score all skills in ``catalog_dir`` against ``profile`` and select an optimal bundle."""
        skill_dirs = discover_skill_directories(catalog_dir)
        parsed_skills: list[ParsedSkillDirectory] = [
            parse_skill_directory(d, require_layout=False, validate_evals=False) for d in skill_dirs
        ]

        feature_maps: dict[str, dict[str, float]] = {
            p.manifest.name: extract_skill_features(p.manifest) for p in parsed_skills
        }
        idf_weights = compute_idf_weights(list(feature_maps.values()))

        candidates: list[tuple[ParsedSkillDirectory, float, list[str]]] = []
        skipped: list[SkippedSkill] = []

        for parsed in parsed_skills:
            manifest = parsed.manifest
            score, matched, reject_reason = score_skill_against_profile(
                manifest,
                profile,
                task_context=task_context,
            )
            if reject_reason is not None:
                skipped.append(
                    SkippedSkill(
                        name=manifest.name,
                        track=manifest.track,
                        relevance_score=score,
                        reason=reject_reason,
                    )
                )
            elif score < self._min_score:
                skipped.append(
                    SkippedSkill(
                        name=manifest.name,
                        track=manifest.track,
                        relevance_score=score,
                        reason=f"below_min_score ({score} < {self._min_score})",
                    )
                )
            else:
                candidates.append((parsed, score, matched))

        # Sort deterministically: highest relevance score first, then lowest L1 tokens, then name
        candidates.sort(
            key=lambda item: (
                -item[1],
                item[0].manifest.description_tokens,
                item[0].manifest.name,
            )
        )

        selected: list[ScoredSkill] = []
        selected_manifests: list[SkillManifest] = []
        total_l1_tokens = 0
        max_pairwise_sim = 0.0

        for parsed, score, matched in candidates:
            manifest = parsed.manifest
            l1_tokens = manifest.description_tokens

            if len(selected) >= self._max_skills:
                skipped.append(
                    SkippedSkill(
                        name=manifest.name,
                        track=manifest.track,
                        relevance_score=score,
                        reason=f"exceeds_max_skills ({self._max_skills})",
                    )
                )
                continue

            if total_l1_tokens + l1_tokens > self._max_l1_tokens:
                skipped.append(
                    SkippedSkill(
                        name=manifest.name,
                        track=manifest.track,
                        relevance_score=score,
                        reason=(
                            f"exceeds_max_l1_tokens "
                            f"({total_l1_tokens + l1_tokens} > {self._max_l1_tokens})"
                        ),
                    )
                )
                continue

            # Check pairwise semantic similarity against all skills already in the bundle
            colliding_partner: str | None = None
            colliding_sim: float = 0.0
            cand_features = feature_maps[manifest.name]

            for existing in selected_manifests:
                sim, _ = compute_feature_cosine(
                    cand_features,
                    feature_maps[existing.name],
                    idf_weights=idf_weights,
                )
                if sim >= self._max_similarity:
                    colliding_partner = existing.name
                    colliding_sim = sim
                    break

            if colliding_partner is not None:
                skipped.append(
                    SkippedSkill(
                        name=manifest.name,
                        track=manifest.track,
                        relevance_score=score,
                        reason=f"collision_with:{colliding_partner} (sim={colliding_sim:.4f})",
                    )
                )
                continue

            # Update max pairwise similarity among accepted bundle skills
            for existing in selected_manifests:
                sim, _ = compute_feature_cosine(
                    cand_features,
                    feature_maps[existing.name],
                    idf_weights=idf_weights,
                )
                if sim > max_pairwise_sim:
                    max_pairwise_sim = sim

            selected.append(
                ScoredSkill(
                    name=manifest.name,
                    track=manifest.track,
                    skill_dir=parsed.skill_dir.as_posix(),
                    relevance_score=score,
                    l1_tokens=l1_tokens,
                    matched_signals=matched,
                )
            )
            selected_manifests.append(manifest)
            total_l1_tokens += l1_tokens

        passed_invariants = (
            len(selected) <= self._max_skills
            and total_l1_tokens <= self._max_l1_tokens
            and max_pairwise_sim < self._max_similarity
        )

        return RoutedBundle(
            repo_profile=profile,
            catalog_path=catalog_dir.as_posix(),
            max_skills=self._max_skills,
            max_l1_tokens=self._max_l1_tokens,
            max_similarity=self._max_similarity,
            selected_skills=selected,
            skipped_skills=skipped,
            total_l1_tokens=total_l1_tokens,
            max_pairwise_similarity=round(max_pairwise_sim, 4),
            passed_invariants=passed_invariants,
        )

    def route_repository(
        self,
        repo_path: Path,
        catalog_dir: Path,
        *,
        task_context: str = "",
    ) -> RoutedBundle:
        """Fingerprint ``repo_path`` and compile an optimal collision-free skill bundle."""
        profile = fingerprint_repository(repo_path)
        return self.compile_bundle(profile, catalog_dir, task_context=task_context)


def compile_skill_bundle(
    profile: RepoProfile,
    catalog_dir: Path,
    *,
    max_skills: int = 12,
    max_l1_tokens: int = 1500,
    max_similarity: float = 0.78,
    min_score: float = 20.0,
    task_context: str = "",
) -> RoutedBundle:
    """Compile an optimal collision-free skill bundle for ``profile`` from ``catalog_dir``."""
    router = DynamicSkillRouter(
        max_skills=max_skills,
        max_l1_tokens=max_l1_tokens,
        max_similarity=max_similarity,
        min_score=min_score,
    )
    return router.compile_bundle(profile, catalog_dir, task_context=task_context)


def route_repository(
    repo_path: Path,
    catalog_dir: Path,
    *,
    max_skills: int = 12,
    max_l1_tokens: int = 1500,
    max_similarity: float = 0.78,
    min_score: float = 20.0,
    task_context: str = "",
) -> RoutedBundle:
    """Fingerprint ``repo_path`` and compile an optimal skill bundle from ``catalog_dir``."""
    router = DynamicSkillRouter(
        max_skills=max_skills,
        max_l1_tokens=max_l1_tokens,
        max_similarity=max_similarity,
        min_score=min_score,
    )
    return router.route_repository(repo_path, catalog_dir, task_context=task_context)


__all__ = [
    "DynamicSkillRouter",
    "compile_skill_bundle",
    "route_repository",
    "score_skill_against_profile",
]
