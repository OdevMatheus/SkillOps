"""Three-Level Progressive Disclosure Token Budget Analyzer (`SKILL_CONTRACT.md` §2, `ADR-0002`).

Quantifies and enforces context-window budgets across all three progressive disclosure tiers:
- **Level 1 (Always-Loaded Routing Metadata):** 40-110 words (`<= 160 tokens`), starting with
  ``"Use when"``, free of procedural workflow leaks, with explicit negative trigger boundaries.
- **Level 2 (On-Demand Core Workflow — ``SKILL.md`` Body):** ``<= 250 lines`` and
  ``<= 1,800 tokens``, warning when inline code blocks exceed ``60`` lines.
- **Level 3 (Out-of-Context Bundled Execution & References):** ``scripts/*.py`` (quantifying
  context tokens saved by deterministic CLI execution) and ``references/*.md``.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from skillops.auditor.parser import (
    ParsedSkillDirectory,
    discover_skill_directories,
    parse_skill_directory,
)
from skillops.models import (
    SkillBudgetMetrics,
    SkillOpsConfig,
    estimate_token_count,
)

if TYPE_CHECKING:
    from pathlib import Path

_FENCED_CODE_BLOCK_RE = re.compile(r"```[^\n]*\n(?P<code>.*?)```", re.DOTALL)
_WORKFLOW_LEAK_RE = re.compile(
    r"\b(?:step\s*1|step\s*2|first,\s+run|then\s+run|next,\s+execute|finally,\s+run)\b",
    re.IGNORECASE,
)


class CatalogBudgetSummary(BaseModel):
    """Catalog-wide 3-level progressive disclosure token budget summary."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    catalog_path: str = Field(..., min_length=1)
    total_skills: int = Field(..., ge=0)
    total_l1_tokens: int = Field(..., ge=0)
    total_l2_tokens: int = Field(..., ge=0)
    total_l3_scripts_tokens_saved: int = Field(
        ...,
        ge=0,
        description="Context tokens kept out of LLM prompt by offloading logic to scripts/*.py.",
    )
    total_l3_reference_tokens: int = Field(..., ge=0)
    max_bundle_tokens: int = Field(default=1500, ge=1)
    skills: list[SkillBudgetMetrics] = Field(default_factory=list)
    within_budget: bool = Field(...)


def count_fenced_code_lines(markdown_body: str) -> int:
    """Count total lines inside fenced Markdown code blocks (```` ... ````)."""
    total = 0
    for match in _FENCED_CODE_BLOCK_RE.finditer(markdown_body):
        code_content = match.group("code")
        total += len(code_content.splitlines())
    return total


def detect_description_workflow_leak(description: str) -> bool:
    """Return True if a Level 1 description leaks step-by-step workflow instructions."""
    return bool(_WORKFLOW_LEAK_RE.search(description))


def analyze_parsed_skill_budget(
    parsed: ParsedSkillDirectory,
    *,
    max_l1_tokens: int = 160,
    max_l2_lines: int = 250,
    max_l2_tokens: int = 1800,
    max_inline_code_lines: int = 60,
) -> SkillBudgetMetrics:
    """Compute Level 1, Level 2, and Level 3 token budget metrics for a ``ParsedSkillDirectory``."""
    manifest = parsed.manifest
    l1_words = manifest.description_words
    l1_tokens = manifest.description_tokens
    l2_lines = manifest.body_lines
    l2_tokens = manifest.body_tokens

    warnings: list[str] = []
    violations: list[str] = []

    if l1_tokens > max_l1_tokens:
        violations.append(
            f"Level 1 description uses {l1_tokens} tokens, exceeding max_l1_tokens={max_l1_tokens}."
        )
    if parsed.total_lines > max_l2_lines or l2_lines > max_l2_lines:
        violations.append(
            f"Level 2 SKILL.md uses {parsed.total_lines} total lines ({l2_lines} body lines), "
            f"exceeding max_l2_lines={max_l2_lines}."
        )
    if l2_tokens > max_l2_tokens:
        violations.append(
            f"Level 2 SKILL.md body uses {l2_tokens} tokens, exceeding "
            f"max_l2_tokens={max_l2_tokens}."
        )
    if parsed.missing_scripts:
        violations.append(
            f"Missing declared Level 3 script(s): {', '.join(parsed.missing_scripts)}."
        )

    if not manifest.routing_signals.negative_triggers:
        warnings.append(
            "No negative_triggers configured in routing_signals; add explicit scope boundaries "
            "to prevent false-positive routing."
        )
    if detect_description_workflow_leak(manifest.description):
        warnings.append(
            "Level 1 description appears to summarize step-by-step workflow instructions "
            "(SKILL_CONTRACT.md §4.2 Violation Risk)."
        )

    inline_code_lines = count_fenced_code_lines(parsed.markdown_body)
    if inline_code_lines > max_inline_code_lines:
        warnings.append(
            f"SKILL.md body contains {inline_code_lines} lines of inline fenced code "
            f"(>{max_inline_code_lines}); offload heavy code into Level 3 scripts/*.py."
        )
    if parsed.extra_scripts:
        extra_names = ", ".join(p.name for p in parsed.extra_scripts)
        warnings.append(
            f"Undocumented script(s) found in scripts/ not listed in entrypoints: {extra_names}."
        )

    l3_scripts_tokens = 0
    for script_path in parsed.declared_scripts:
        script_text = script_path.read_text(encoding="utf-8")
        l3_scripts_tokens += estimate_token_count(script_text)

    l3_reference_tokens = 0
    for ref_path in parsed.reference_files:
        ref_text = ref_path.read_text(encoding="utf-8")
        l3_reference_tokens += estimate_token_count(ref_text)

    return SkillBudgetMetrics(
        skill_name=manifest.name,
        track=manifest.track,
        l1_words=l1_words,
        l1_tokens=l1_tokens,
        l2_lines=l2_lines,
        l2_tokens=l2_tokens,
        l3_scripts_count=len(parsed.declared_scripts),
        l3_scripts_tokens=l3_scripts_tokens,
        l3_references_count=len(parsed.reference_files),
        l3_reference_tokens=l3_reference_tokens,
        warnings=warnings,
        violations=violations,
        within_budget=len(violations) == 0,
    )


def analyze_skill_budget(
    skill_dir_or_md: Path,
    *,
    max_l1_tokens: int = 160,
    max_l2_lines: int = 250,
    max_l2_tokens: int = 1800,
    max_inline_code_lines: int = 60,
    require_layout: bool = True,
    validate_evals: bool = True,
) -> SkillBudgetMetrics:
    """Parse a skill directory and compute its 3-level progressive disclosure budget metrics."""
    parsed = parse_skill_directory(
        skill_dir_or_md,
        require_layout=require_layout,
        validate_evals=validate_evals,
    )
    return analyze_parsed_skill_budget(
        parsed,
        max_l1_tokens=max_l1_tokens,
        max_l2_lines=max_l2_lines,
        max_l2_tokens=max_l2_tokens,
        max_inline_code_lines=max_inline_code_lines,
    )


def analyze_catalog_budgets(
    catalog_dir: Path,
    *,
    config: SkillOpsConfig | None = None,
    max_bundle_tokens: int = 1500,
    require_layout: bool = True,
    validate_evals: bool = True,
) -> CatalogBudgetSummary:
    """Analyze 3-level progressive disclosure budgets across all skills in ``catalog_dir``."""
    cfg = config or SkillOpsConfig()
    skill_dirs = discover_skill_directories(catalog_dir)
    metrics_list: list[SkillBudgetMetrics] = []

    for skill_dir in skill_dirs:
        metrics = analyze_skill_budget(
            skill_dir,
            max_l1_tokens=cfg.max_l1_tokens,
            max_l2_lines=cfg.max_l2_lines,
            require_layout=require_layout,
            validate_evals=validate_evals,
        )
        metrics_list.append(metrics)

    total_l1 = sum(item.l1_tokens for item in metrics_list)
    total_l2 = sum(item.l2_tokens for item in metrics_list)
    total_l3_scripts = sum(item.l3_scripts_tokens for item in metrics_list)
    total_l3_refs = sum(item.l3_reference_tokens for item in metrics_list)
    all_skills_within_budget = all(item.within_budget for item in metrics_list)

    return CatalogBudgetSummary(
        catalog_path=catalog_dir.as_posix(),
        total_skills=len(metrics_list),
        total_l1_tokens=total_l1,
        total_l2_tokens=total_l2,
        total_l3_scripts_tokens_saved=total_l3_scripts,
        total_l3_reference_tokens=total_l3_refs,
        max_bundle_tokens=max_bundle_tokens,
        skills=metrics_list,
        within_budget=all_skills_within_budget and total_l1 <= max_bundle_tokens,
    )
