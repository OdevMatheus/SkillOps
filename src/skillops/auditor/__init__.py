"""SkillOps Semantic Collision Auditor & 3-Level Progressive Disclosure Token Budget Linter."""

from __future__ import annotations

from skillops.auditor.collision import (
    audit_catalog,
    compute_collision_matrix,
    compute_feature_cosine,
    compute_idf_weights,
    compute_manifest_similarity,
    compute_text_similarity,
    extract_skill_features,
    extract_text_features,
    tokenize_routing_text,
)
from skillops.auditor.parser import (
    ParsedSkillDirectory,
    discover_skill_directories,
    parse_skill_directory,
    parse_skill_file,
    split_skill_md,
)
from skillops.auditor.token_budget import (
    CatalogBudgetSummary,
    analyze_catalog_budgets,
    analyze_parsed_skill_budget,
    analyze_skill_budget,
    count_fenced_code_lines,
    detect_description_workflow_leak,
)

__all__ = [
    "CatalogBudgetSummary",
    "ParsedSkillDirectory",
    "analyze_catalog_budgets",
    "analyze_parsed_skill_budget",
    "analyze_skill_budget",
    "audit_catalog",
    "compute_collision_matrix",
    "compute_feature_cosine",
    "compute_idf_weights",
    "compute_manifest_similarity",
    "compute_text_similarity",
    "count_fenced_code_lines",
    "detect_description_workflow_leak",
    "discover_skill_directories",
    "extract_skill_features",
    "extract_text_features",
    "parse_skill_directory",
    "parse_skill_file",
    "split_skill_md",
    "tokenize_routing_text",
]
