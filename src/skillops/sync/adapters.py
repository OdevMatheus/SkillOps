"""Multi-runtime skill transpilers and lockfile sync manager (``ADR-0003``).

Compiles canonical Hybrid Executable Skills from ``catalog/`` into native runtime
artifacts for five AI coding agent harnesses:
1. **Claude Code:** ``.claude/skills/<id>/SKILL.md`` + ``scripts/`` + ``references/``
2. **Antigravity / Gemini CLI:** ``.agent/skills/<id>/SKILL.md`` + ``scripts/`` + ``references/``
3. **Cursor IDE:** ``.cursor/rules/<id>.mdc`` (YAML frontmatter with ``description``, ``globs``,
   ``alwaysApply``)
4. **OpenAI Codex CLI:** ``.codex/skills/<id>/SKILL.md`` + ``scripts/`` + ``AGENTS.md`` routing
   index
5. **GitHub Copilot:** ``.github/instructions/<id>.instructions.md`` (``applyTo`` frontmatter) +
   ``.github/prompts/<id>.prompt.md``

Tracks every transpiled file in ``.skillops-lock.json`` with SHA-256 digests to ensure
idempotent updates, detect local modifications (requiring ``--force`` to overwrite), and
cleanly remove stale artifacts when a repository's routed bundle changes.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import yaml

from skillops.auditor.parser import ParsedSkillDirectory, parse_skill_directory
from skillops.models import (
    RoutedBundle,
    RuntimeTarget,
    SyncedArtifact,
    SyncLockEntry,
    SyncLockfile,
    SyncReport,
)
from skillops.router.bundle_compiler import route_repository

if TYPE_CHECKING:
    from collections.abc import Sequence

LOCKFILE_NAME = ".skillops-lock.json"
CODEX_MARKER_START = "<!-- SKILLOPS:CODEX:START -->"
CODEX_MARKER_END = "<!-- SKILLOPS:CODEX:END -->"

_CODEX_BLOCK_RE = re.compile(
    rf"{re.escape(CODEX_MARKER_START)}.*?{re.escape(CODEX_MARKER_END)}",
    re.DOTALL,
)

_LANGUAGE_GLOB_MAP: dict[str, str] = {
    "python": "**/*.py",
    "sql": "**/*.sql",
    "typescript": "**/*.ts",
    "javascript": "**/*.js",
    "rust": "**/*.rs",
    "go": "**/*.go",
}


@dataclass(frozen=True, slots=True)
class RenderedArtifact:
    """In-memory transpiled runtime file ready for checksum comparison and disk sync."""

    target: RuntimeTarget
    skill_name: str
    relative_path: str
    content: str
    sha256: str


def normalize_newlines(text: str) -> str:
    """Normalize CRLF/CR line endings to LF for cross-platform SHA-256 determinism."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def compute_sha256(text: str) -> str:
    """Compute the lowercase hex SHA-256 digest of normalized UTF-8 text."""
    normalized = normalize_newlines(text)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _make_rendered_artifact(
    target: RuntimeTarget,
    skill_name: str,
    relative_path: str,
    content: str,
) -> RenderedArtifact:
    normalized = normalize_newlines(content)
    if not normalized.endswith("\n"):
        normalized += "\n"
    return RenderedArtifact(
        target=target,
        skill_name=skill_name,
        relative_path=relative_path.replace("\\", "/").lstrip("/"),
        content=normalized,
        sha256=compute_sha256(normalized),
    )


def derive_globs_for_skill(skill: ParsedSkillDirectory) -> list[str]:
    """Derive deterministic file glob patterns from a skill's ``routing_signals``."""
    globs: list[str] = []
    signals = skill.manifest.routing_signals

    for lang in signals.languages:
        mapped = _LANGUAGE_GLOB_MAP.get(lang.lower().strip())
        if mapped and mapped not in globs:
            globs.append(mapped)

    for pattern in signals.files_any:
        cleaned = pattern.strip().replace("\\", "/")
        if not cleaned:
            continue
        glob_pattern = cleaned if ("/" in cleaned or cleaned.startswith("**")) else f"**/{cleaned}"
        if glob_pattern not in globs:
            globs.append(glob_pattern)

    if not globs:
        globs.append("**/*")

    return globs


def _copy_skill_bundle_tree(
    skill: ParsedSkillDirectory,
    *,
    target: RuntimeTarget,
    base_prefix: str,
) -> list[RenderedArtifact]:
    """Render ``SKILL.md``, ``scripts/*.py``, and ``references/*.md`` under ``base_prefix``."""
    name = skill.manifest.name
    root = f"{base_prefix.rstrip('/')}/{name}"
    raw_skill_md = skill.skill_md_path.read_text(encoding="utf-8")
    artifacts: list[RenderedArtifact] = [
        _make_rendered_artifact(
            target=target,
            skill_name=name,
            relative_path=f"{root}/SKILL.md",
            content=raw_skill_md,
        )
    ]

    for script_path in (*skill.declared_scripts, *skill.extra_scripts):
        rel_script = script_path.relative_to(skill.skill_dir).as_posix()
        artifacts.append(
            _make_rendered_artifact(
                target=target,
                skill_name=name,
                relative_path=f"{root}/{rel_script}",
                content=script_path.read_text(encoding="utf-8"),
            )
        )

    for ref_path in skill.reference_files:
        rel_ref = ref_path.relative_to(skill.skill_dir).as_posix()
        artifacts.append(
            _make_rendered_artifact(
                target=target,
                skill_name=name,
                relative_path=f"{root}/{rel_ref}",
                content=ref_path.read_text(encoding="utf-8"),
            )
        )

    return artifacts


def transpile_claude(skill: ParsedSkillDirectory) -> list[RenderedArtifact]:
    """Transpile a skill for Claude Code (``.claude/skills/<id>/...``)."""
    return _copy_skill_bundle_tree(
        skill,
        target=RuntimeTarget.CLAUDE,
        base_prefix=".claude/skills",
    )


def transpile_antigravity(skill: ParsedSkillDirectory) -> list[RenderedArtifact]:
    """Transpile a skill for Antigravity / Gemini CLI (``.agent/skills/<id>/...``)."""
    return _copy_skill_bundle_tree(
        skill,
        target=RuntimeTarget.ANTIGRAVITY,
        base_prefix=".agent/skills",
    )


def transpile_cursor(skill: ParsedSkillDirectory) -> list[RenderedArtifact]:
    """Transpile a skill into a Cursor ``.cursor/rules/<id>.mdc`` rule file."""
    manifest = skill.manifest
    globs = derive_globs_for_skill(skill)
    frontmatter = {
        "description": manifest.description,
        "globs": globs,
        "alwaysApply": False,
    }
    yaml_header = yaml.safe_dump(frontmatter, sort_keys=False, width=100).strip()
    script_lines = [
        f"- `{entry.path}`: {entry.description}" for entry in manifest.entrypoints.scripts
    ]
    scripts_section = ""
    if script_lines:
        scripts_section = "\n\n## Bundled Deterministic Scripts (SkillOps Level 3)\n\n" + "\n".join(
            script_lines
        )

    mdc_content = f"---\n{yaml_header}\n---\n\n{skill.markdown_body.strip()}{scripts_section}\n"
    return [
        _make_rendered_artifact(
            target=RuntimeTarget.CURSOR,
            skill_name=manifest.name,
            relative_path=f".cursor/rules/{manifest.name}.mdc",
            content=mdc_content,
        )
    ]


def transpile_codex(skill: ParsedSkillDirectory) -> list[RenderedArtifact]:
    """Transpile a skill for OpenAI Codex CLI (``.codex/skills/<id>/...``)."""
    return _copy_skill_bundle_tree(
        skill,
        target=RuntimeTarget.CODEX,
        base_prefix=".codex/skills",
    )


def render_codex_agents_index(
    skills: Sequence[ParsedSkillDirectory],
    *,
    existing_content: str | None = None,
    relative_path: str = "AGENTS.md",
) -> RenderedArtifact:
    """Render the OpenAI Codex ``AGENTS.md`` skill routing index block."""
    block_lines: list[str] = [
        CODEX_MARKER_START,
        "## SkillOps Routed Agent Skills (OpenAI Codex CLI)",
        "",
        "The following Hybrid Executable Skills were routed for this repository:",
        "",
        "| Skill | Track | Playbook Path | Deterministic Scripts | Routing Trigger |",
        "| :--- | :--- | :--- | :--- | :--- |",
    ]
    for skill in skills:
        manifest = skill.manifest
        scripts_str = ", ".join(
            f"`.codex/skills/{manifest.name}/{entry.path}`"
            for entry in manifest.entrypoints.scripts
        )
        block_lines.append(
            f"| `{manifest.name}` | `{manifest.track.value}` | "
            f"`.codex/skills/{manifest.name}/SKILL.md` | {scripts_str} | "
            f"{manifest.description} |"
        )
    block_lines.append(CODEX_MARKER_END)
    managed_block = "\n".join(block_lines)

    if existing_content and _CODEX_BLOCK_RE.search(existing_content):
        full_content = _CODEX_BLOCK_RE.sub(managed_block, existing_content)
    else:
        header = "# AGENTS.md — Repository AI Coding Agent Instructions\n\n"
        full_content = f"{header}{managed_block}\n"

    return _make_rendered_artifact(
        target=RuntimeTarget.CODEX,
        skill_name="_codex_index",
        relative_path=relative_path,
        content=full_content,
    )


def transpile_copilot(skill: ParsedSkillDirectory) -> list[RenderedArtifact]:
    """Transpile a skill for GitHub Copilot (``.github/instructions/`` + ``.github/prompts/``)."""
    manifest = skill.manifest
    globs = derive_globs_for_skill(skill)
    apply_to = ",".join(globs)

    instructions_fm = yaml.safe_dump(
        {
            "applyTo": apply_to,
            "description": manifest.description,
        },
        sort_keys=False,
        width=100,
    ).strip()
    instructions_content = f"---\n{instructions_fm}\n---\n\n{skill.markdown_body.strip()}\n"

    prompt_fm = yaml.safe_dump(
        {
            "mode": "agent",
            "description": manifest.description,
        },
        sort_keys=False,
        width=100,
    ).strip()
    script_list = "\n".join(
        f"- `{entry.path}` — {entry.description}" for entry in manifest.entrypoints.scripts
    )
    prompt_content = (
        f"---\n{prompt_fm}\n---\n\n"
        f"# SkillOps Prompt: `{manifest.name}`\n\n"
        f"Follow the instructions in `.github/instructions/{manifest.name}.instructions.md`.\n\n"
        f"## Bundled Verification Scripts\n\n{script_list}\n"
    )

    return [
        _make_rendered_artifact(
            target=RuntimeTarget.COPILOT,
            skill_name=manifest.name,
            relative_path=f".github/instructions/{manifest.name}.instructions.md",
            content=instructions_content,
        ),
        _make_rendered_artifact(
            target=RuntimeTarget.COPILOT,
            skill_name=manifest.name,
            relative_path=f".github/prompts/{manifest.name}.prompt.md",
            content=prompt_content,
        ),
    ]


def transpile_skill_for_target(
    skill: ParsedSkillDirectory,
    target: RuntimeTarget,
) -> list[RenderedArtifact]:
    """Dispatch transpilation of a single skill to the specified runtime adapter."""
    if target is RuntimeTarget.CLAUDE:
        return transpile_claude(skill)
    if target is RuntimeTarget.ANTIGRAVITY:
        return transpile_antigravity(skill)
    if target is RuntimeTarget.CURSOR:
        return transpile_cursor(skill)
    if target is RuntimeTarget.CODEX:
        return transpile_codex(skill)
    if target is RuntimeTarget.COPILOT:
        return transpile_copilot(skill)
    msg = f"Unsupported RuntimeTarget: {target}"
    raise ValueError(msg)


def _load_lockfile(lockfile_path: Path) -> SyncLockfile | None:
    """Load and validate an existing ``.skillops-lock.json`` if present."""
    if not lockfile_path.is_file():
        return None
    raw = json.loads(lockfile_path.read_text(encoding="utf-8"))
    return SyncLockfile.model_validate(raw)


def _prune_empty_parents(file_path: Path, repo_root: Path) -> None:
    """Remove empty parent directories up to (but excluding) ``repo_root``."""
    current = file_path.parent
    resolved_root = repo_root.resolve()
    while current != resolved_root and current.exists():
        try:
            next(current.iterdir())
            break
        except StopIteration:
            current.rmdir()
            current = current.parent


class MultiRuntimeTranspiler:
    """Deterministic multi-runtime skill transpiler and lockfile synchronizer."""

    def __init__(
        self,
        *,
        targets: Sequence[RuntimeTarget | str] | None = None,
        dry_run: bool = False,
        force: bool = False,
    ) -> None:
        if targets is None:
            self.targets = list(RuntimeTarget)
        else:
            resolved: list[RuntimeTarget] = []
            for item in targets:
                target_enum = item if isinstance(item, RuntimeTarget) else RuntimeTarget(item)
                if target_enum not in resolved:
                    resolved.append(target_enum)
            self.targets = resolved
        self.dry_run = dry_run
        self.force = force

    def render_bundle(
        self,
        skills: Sequence[ParsedSkillDirectory],
        *,
        repo_root: Path,
        previous_lockfile: SyncLockfile | None = None,
    ) -> list[RenderedArtifact]:
        """Render all target artifacts for a sequence of parsed skills."""
        rendered: list[RenderedArtifact] = []
        for target in self.targets:
            for skill in skills:
                rendered.extend(transpile_skill_for_target(skill, target))

            if target is RuntimeTarget.CODEX:
                agents_path = repo_root / "AGENTS.md"
                locked_agents = (
                    previous_lockfile is not None and "AGENTS.md" in previous_lockfile.artifacts
                )
                existing_text: str | None = None
                codex_index_rel = "AGENTS.md"

                if agents_path.is_file():
                    disk_text = agents_path.read_text(encoding="utf-8")
                    if locked_agents or _CODEX_BLOCK_RE.search(disk_text):
                        existing_text = disk_text
                        codex_index_rel = "AGENTS.md"
                    else:
                        # Preserve pre-existing unmanaged AGENTS.md and write .codex/AGENTS.md
                        codex_index_rel = ".codex/AGENTS.md"

                rendered.append(
                    render_codex_agents_index(
                        skills,
                        existing_content=existing_text,
                        relative_path=codex_index_rel,
                    )
                )

        return rendered

    def sync_parsed_skills(
        self,
        skills: Sequence[ParsedSkillDirectory],
        *,
        repo_path: Path,
        catalog_path: Path,
    ) -> SyncReport:
        """Transpile and sync ``skills`` into ``repo_path`` with lockfile verification."""
        repo_root = repo_path.resolve()
        lockfile_path = repo_root / LOCKFILE_NAME
        previous_lockfile = _load_lockfile(lockfile_path)

        rendered_artifacts = self.render_bundle(
            skills,
            repo_root=repo_root,
            previous_lockfile=previous_lockfile,
        )

        new_lock_entries: dict[str, SyncLockEntry] = {}
        if previous_lockfile is not None:
            # Preserve lock entries for runtime targets not included in the current sync invocation
            active_targets = set(self.targets)
            for rel_path, entry in previous_lockfile.artifacts.items():
                if entry.target not in active_targets:
                    new_lock_entries[rel_path] = entry

        synced_artifacts: list[SyncedArtifact] = []
        drift_conflicts: list[str] = []
        removed_stale_files: list[str] = []
        rendered_by_path = {item.relative_path: item for item in rendered_artifacts}

        for item in rendered_artifacts:
            dest_path = repo_root / item.relative_path
            prev_entry = (
                previous_lockfile.artifacts.get(item.relative_path)
                if previous_lockfile is not None
                else None
            )

            if not dest_path.exists():
                action = "planned" if self.dry_run else "created"
                if not self.dry_run:
                    dest_path.parent.mkdir(parents=True, exist_ok=True)
                    dest_path.write_text(item.content, encoding="utf-8", newline="\n")
                new_lock_entries[item.relative_path] = SyncLockEntry(
                    target=item.target,
                    skill_name=item.skill_name,
                    relative_path=item.relative_path,
                    sha256=item.sha256,
                )
            else:
                disk_text = dest_path.read_text(encoding="utf-8")
                disk_sha = compute_sha256(disk_text)
                is_initial_codex_splice = (
                    prev_entry is None
                    and item.relative_path == "AGENTS.md"
                    and bool(_CODEX_BLOCK_RE.search(disk_text))
                )
                if disk_sha == item.sha256:
                    action = "unchanged"
                    new_lock_entries[item.relative_path] = SyncLockEntry(
                        target=item.target,
                        skill_name=item.skill_name,
                        relative_path=item.relative_path,
                        sha256=item.sha256,
                    )
                elif (
                    (prev_entry is not None and disk_sha == prev_entry.sha256)
                    or is_initial_codex_splice
                    or self.force
                ):
                    action = "planned" if self.dry_run else "updated"
                    if not self.dry_run:
                        dest_path.parent.mkdir(parents=True, exist_ok=True)
                        dest_path.write_text(item.content, encoding="utf-8", newline="\n")
                    new_lock_entries[item.relative_path] = SyncLockEntry(
                        target=item.target,
                        skill_name=item.skill_name,
                        relative_path=item.relative_path,
                        sha256=item.sha256,
                    )
                else:
                    action = "skipped_drift"
                    drift_conflicts.append(item.relative_path)
                    if prev_entry is not None:
                        new_lock_entries[item.relative_path] = prev_entry

            synced_artifacts.append(
                SyncedArtifact(
                    target=item.target,
                    skill_name=item.skill_name,
                    relative_path=item.relative_path,
                    sha256=item.sha256,
                    action=action,
                )
            )

        # Clean up stale files from previous lockfile for active targets
        if previous_lockfile is not None:
            active_targets = set(self.targets)
            for rel_path, prev_entry in sorted(previous_lockfile.artifacts.items()):
                if prev_entry.target not in active_targets or rel_path in rendered_by_path:
                    continue
                stale_path = repo_root / rel_path
                if not stale_path.exists():
                    removed_stale_files.append(rel_path)
                    continue

                disk_sha = compute_sha256(stale_path.read_text(encoding="utf-8"))
                if disk_sha == prev_entry.sha256 or self.force:
                    if not self.dry_run:
                        stale_path.unlink()
                        _prune_empty_parents(stale_path, repo_root)
                    removed_stale_files.append(rel_path)
                    synced_artifacts.append(
                        SyncedArtifact(
                            target=prev_entry.target,
                            skill_name=prev_entry.skill_name,
                            relative_path=rel_path,
                            sha256=prev_entry.sha256,
                            action="planned" if self.dry_run else "removed",
                        )
                    )
                else:
                    drift_conflicts.append(rel_path)
                    new_lock_entries[rel_path] = prev_entry
                    synced_artifacts.append(
                        SyncedArtifact(
                            target=prev_entry.target,
                            skill_name=prev_entry.skill_name,
                            relative_path=rel_path,
                            sha256=prev_entry.sha256,
                            action="skipped_drift",
                        )
                    )

        selected_names = [skill.manifest.name for skill in skills]
        all_targets = list(self.targets)
        if previous_lockfile is not None:
            for prev_target in previous_lockfile.targets:
                if prev_target not in all_targets and any(
                    e.target == prev_target for e in new_lock_entries.values()
                ):
                    all_targets.append(prev_target)

        if not self.dry_run:
            lockfile_model = SyncLockfile(
                schema_version="1.0",
                targets=all_targets,
                skills=selected_names,
                artifacts=dict(sorted(new_lock_entries.items())),
            )
            lockfile_path.write_text(
                json.dumps(lockfile_model.model_dump(mode="json"), indent=2) + "\n",
                encoding="utf-8",
                newline="\n",
            )

        return SyncReport(
            repo_path=repo_path.as_posix(),
            catalog_path=catalog_path.as_posix(),
            targets=list(self.targets),
            selected_skills=selected_names,
            dry_run=self.dry_run,
            force=self.force,
            artifacts=synced_artifacts,
            drift_conflicts=drift_conflicts,
            removed_stale_files=removed_stale_files,
            lockfile_path=lockfile_path.as_posix(),
            passed=len(drift_conflicts) == 0,
        )

    def sync_bundle(
        self,
        bundle: RoutedBundle,
        *,
        repo_path: Path,
        catalog_path: Path,
    ) -> SyncReport:
        """Load ``ParsedSkill`` objects from a ``RoutedBundle`` and sync them to ``repo_path``."""
        parsed_skills = [
            parse_skill_directory(
                Path(scored.skill_dir),
                require_layout=False,
                validate_evals=False,
            )
            for scored in bundle.selected_skills
        ]
        return self.sync_parsed_skills(
            parsed_skills,
            repo_path=repo_path,
            catalog_path=catalog_path,
        )


def sync_repository(
    repo_path: Path,
    catalog_path: Path = Path("catalog"),
    *,
    targets: Sequence[RuntimeTarget | str] | None = None,
    max_skills: int = 10,
    max_l1_tokens: int = 1500,
    max_similarity: float = 0.78,
    dry_run: bool = False,
    force: bool = False,
) -> SyncReport:
    """Route a target repository and sync the optimal skill bundle across target runtimes."""
    bundle = route_repository(
        repo_path,
        catalog_path,
        max_skills=max_skills,
        max_l1_tokens=max_l1_tokens,
        max_similarity=max_similarity,
    )
    transpiler = MultiRuntimeTranspiler(
        targets=targets,
        dry_run=dry_run,
        force=force,
    )
    return transpiler.sync_bundle(
        bundle,
        repo_path=repo_path,
        catalog_path=catalog_path,
    )
