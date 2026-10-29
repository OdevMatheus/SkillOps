"""Unit tests for `skillops.auditor.collision` (Issue #50)."""

from __future__ import annotations

from pathlib import Path

from skillops.auditor import (
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
from skillops.models import (
    CatalogTrack,
    CollisionPair,
    CollisionSeverity,
    RoutingSignals,
    ScriptEntrypoint,
    SkillEntrypoints,
    SkillManifest,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
CATALOG_DIR = REPO_ROOT / "catalog"

MCP_DESC = (
    "Use when designing, implementing, or auditing Model Context Protocol (MCP) servers "
    "and FastMCP tools in Python or TypeScript to enforce strict JSON-RPC stdio hygiene, "
    "Pydantic input schemas, tool docstring clarity, and localhost-bound SSE transport "
    "security without polluting stdout or exposing untyped tool handlers to AI coding agents."
)

MCP_CLONE_DESC = (
    "Use when building, reviewing, or auditing Model Context Protocol (MCP) servers "
    "and FastMCP tools in Python or TypeScript to enforce strict JSON-RPC stdio hygiene, "
    "Pydantic input schemas, tool docstring clarity, and localhost-bound SSE transport "
    "security without polluting stdout or exposing untyped tool handlers to AI coding agents."
)

SQL_DESC = (
    "Use when writing, optimizing, or reviewing PostgreSQL queries, SQLAlchemy ORM "
    "statements, and Alembic database migrations to prevent unindexed sequential scans, "
    "N+1 query loops, unsafe string-interpolated SQL injection vectors, and table-locking "
    "DDL operations in high-throughput transactional relational database backends and "
    "asynchronous connection pool configurations."
)


def _make_manifest(
    name: str,
    description: str,
    *,
    tags: list[str] | None = None,
    deps: list[str] | None = None,
) -> SkillManifest:
    return SkillManifest(
        name=name,
        description=description,
        version="1.0.0",
        track=CatalogTrack.AI_ENGINEERING,
        tags=tags or ["mcp", "json-rpc"],
        routing_signals=RoutingSignals(
            languages=["python"],
            dependencies_any=deps or ["fastmcp"],
            negative_triggers=["Do not trigger on static CSS files."],
        ),
        entrypoints=SkillEntrypoints(
            scripts=[
                ScriptEntrypoint(
                    path="scripts/check.py",
                    description="Run deterministic AST validation.",
                )
            ]
        ),
        body_lines=40,
        body_tokens=300,
    )


def test_tokenize_and_extract_features_edge_cases() -> None:
    """Verify stopword filtering, empty text handling, and feature extraction."""
    assert tokenize_routing_text("Use when the and or in a") == []
    assert extract_text_features("Use when the and or") == {}
    assert compute_idf_weights([]) == {}
    assert compute_feature_cosine({}, {"ug:mcp": 1.0}) == (0.0, [])
    assert compute_feature_cosine({"ug:mcp": 0.0}, {"ug:mcp": 1.0}) == (0.0, [])
    assert compute_feature_cosine({"ug:mcp": 1.0}, {"ug:sql": 1.0}) == (0.0, [])


def test_text_and_manifest_similarity_discrimination() -> None:
    """Verify near-duplicate skills score high while orthogonal skills score low."""
    sim_clone = compute_text_similarity(MCP_DESC, MCP_CLONE_DESC)
    sim_orthogonal = compute_text_similarity(MCP_DESC, SQL_DESC)
    assert sim_clone >= 0.85
    assert sim_orthogonal < 0.25

    skill_a = _make_manifest("mcp-server-pro", MCP_DESC, tags=["mcp", "fastmcp"], deps=["mcp"])
    skill_b = _make_manifest(
        "mcp-tool-expert", MCP_CLONE_DESC, tags=["mcp", "fastmcp"], deps=["mcp"]
    )
    skill_c = _make_manifest(
        "postgres-doctor", SQL_DESC, tags=["postgresql", "sql"], deps=["sqlalchemy"]
    )

    feat_a = extract_skill_features(skill_a)
    assert "tag:mcp" in feat_a
    assert "dep:mcp" in feat_a

    pair_sim, shared_terms = compute_manifest_similarity(skill_a, skill_b)
    assert pair_sim >= 0.85
    assert "mcp" in shared_terms

    ortho_sim, _ = compute_manifest_similarity(skill_a, skill_c)
    assert ortho_sim < 0.25


def test_compute_collision_matrix_and_remediation() -> None:
    """Verify pairwise collision matrix ordering, thresholds, and remediation advice."""
    skill_a = _make_manifest("mcp-alpha", MCP_DESC, tags=["mcp", "fastmcp"], deps=["fastmcp"])
    skill_b = _make_manifest("mcp-beta", MCP_CLONE_DESC, tags=["mcp", "fastmcp"], deps=["fastmcp"])
    skill_c = _make_manifest("sql-gamma", SQL_DESC, tags=["postgresql", "sql"], deps=["sqlalchemy"])

    assert compute_collision_matrix([skill_a]) == []

    collisions = compute_collision_matrix([skill_a, skill_b, skill_c], include_ok=False)
    assert len(collisions) == 1
    top = collisions[0]
    assert top.skill_a == "mcp-alpha"
    assert top.skill_b == "mcp-beta"
    assert top.severity is CollisionSeverity.BLOCKING_ERROR
    assert "mcp" in top.shared_terms
    assert "Merge" in top.remediation

    all_pairs = compute_collision_matrix([skill_a, skill_b, skill_c], include_ok=True)
    assert len(all_pairs) == 3

    warn_pair = CollisionPair.from_similarity(
        "skill-1",
        "skill-2",
        0.62,
        shared_terms=["fastapi", "pydantic"],
    )
    assert warn_pair.severity is CollisionSeverity.WARNING
    assert "Review trigger boundary overlap" in warn_pair.remediation

    high_pair = CollisionPair.from_similarity(
        "skill-1",
        "skill-2",
        0.76,
        shared_terms=["fastapi"],
    )
    assert high_pair.severity is CollisionSeverity.HIGH_RISK
    assert "Partition scope" in high_pair.remediation


def test_audit_catalog_on_reference_and_colliding_catalogs(tmp_path: Path) -> None:
    """Verify audit_catalog passes the reference catalog and catches injected clones."""
    ref_report = audit_catalog(
        CATALOG_DIR,
        strict=True,
        require_layout=True,
        validate_evals=True,
    )
    assert ref_report.passed is True
    assert ref_report.total_skills >= 4
    assert ref_report.collisions == []

    dup_dir = tmp_path / "catalog" / "ai-engineering"
    for name, desc in (("mcp-one", MCP_DESC), ("mcp-two", MCP_CLONE_DESC)):
        sdir = dup_dir / name
        sdir.mkdir(parents=True)
        (sdir / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: >-\n  {desc}\n"
            "track: ai-engineering\ntags: [mcp, fastmcp]\n"
            "entrypoints:\n  scripts:\n    - path: scripts/check.py\n"
            "      description: Deterministic MCP checker.\n---\n# Body\n",
            encoding="utf-8",
        )

    dup_report = audit_catalog(tmp_path / "catalog", strict=True, require_layout=False)
    assert dup_report.passed is False
    assert len(dup_report.collisions) == 1
    assert dup_report.collisions[0].severity is CollisionSeverity.BLOCKING_ERROR
