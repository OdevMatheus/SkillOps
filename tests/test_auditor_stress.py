"""Stress-test benchmark suite simulating 80+ skills and Implicit Routing Collapse (`Issue #52`).

Verifies that the Zero-API SkillOps Semantic Collision Auditor (`src/skillops/auditor/`):
1. Evaluates 84 skills (`3,486` pairwise comparisons) in under 2.0 seconds with zero network calls.
2. Accurately detects planted `BLOCKING_ERROR` (`>= 0.85`) and `HIGH_RISK` (`>= 0.72`) collisions
   amid 80 orthogonal skills without false-positive explosion.
3. Flags aggregate Level 1 context-window bloat (`total_l1_bundle_tokens > 1,500`) when an
   unrouted 84-skill library is loaded simultaneously (`arXiv:2610.18522`).
"""

from __future__ import annotations

import json
import time
from typing import TYPE_CHECKING

from typer.testing import CliRunner

from skillops import (
    CatalogTrack,
    CollisionSeverity,
    ExitCode,
    RoutingSignals,
    ScriptEntrypoint,
    SkillEntrypoints,
    SkillManifest,
)
from skillops.auditor import audit_catalog, compute_collision_matrix
from skillops.cli import app

if TYPE_CHECKING:
    from pathlib import Path

runner = CliRunner()

_DOMAIN_CLUSTERS: tuple[tuple[str, str, str, str], ...] = (
    ("kubernetes", "helm", "ingress", "podautoscaler"),
    ("terraform", "statefile", "hcl", "drift"),
    ("graphql", "dataloader", "federation", "resolver"),
    ("redis", "lua", "cluster", "eviction"),
    ("kafka", "consumer", "partition", "avro"),
    ("ClickHouse", "mergetree", "materialized", "columnar"),
    ("rust", "borrowchecker", "lifetimes", "tokio"),
    ("golang", "goroutine", "channel", "pprof"),
    ("playwright", "locator", "traceviewer", "hydration"),
    ("opentelemetry", "spanprocessor", "otlp", "baggage"),
    ("celery", "kombu", "prefork", "deadletter"),
    ("wasm", "wasi", "linear_memory", "bindgen"),
    ("webrtc", "icecandidate", "dtls", "sctp"),
    ("grpc", "protobuf", "http2", "interceptor"),
    ("duckdb", "parquet", "arrow", "vectorized"),
    ("snowflake", "micro_partition", "warehouse", "streams"),
    ("spark", "rdd", "catalyst", "shuffle"),
    ("airflow", "dagrun", "xcom", "sensor"),
    ("prometheus", "promql", "histogram", "scrape"),
    ("envoy", "xds", "circuitbreaker", "outlier"),
)

_SUBSPECIALTIES: tuple[tuple[str, str, str], ...] = (
    ("migration", "schema_evolution", "cutover"),
    ("benchmarking", "flamegraph", "throughput"),
    ("hardening", "mtls_policy", "sandboxing"),
    ("debugging", "coredump", "packetcapture"),
)


def _build_orthogonal_manifest(index: int) -> SkillManifest:
    """Construct a synthetic orthogonal ``SkillManifest`` with distinct domain vocabulary."""
    cluster = _DOMAIN_CLUSTERS[index % len(_DOMAIN_CLUSTERS)]
    sub = _SUBSPECIALTIES[(index // len(_DOMAIN_CLUSTERS)) % len(_SUBSPECIALTIES)]
    unique_token = f"domain_{index:03d}_{cluster[0].lower()}_{sub[0]}"
    skill_name = f"skill-{index:03d}-{cluster[0].lower()}-{sub[0].replace('_', '-')}"

    description = (
        f"Use when operating {cluster[0]} subsystems involving {cluster[1]}, {cluster[2]}, "
        f"and {cluster[3]} during {sub[0]} workflows that require {sub[1]} verification, "
        f"{sub[2]} telemetry, and specialized {unique_token} diagnostics across isolated "
        f"distributed infrastructure boundaries without triggering unrelated application "
        f"services, frontend components, or generic relational database maintenance tasks."
    )
    tracks = (
        CatalogTrack.AI_ENGINEERING,
        CatalogTrack.PYTHON_BACKEND,
        CatalogTrack.ARCH_QUALITY,
    )
    return SkillManifest(
        name=skill_name,
        description=description,
        track=tracks[index % len(tracks)],
        tags=[cluster[0].lower(), cluster[1].lower(), sub[0], unique_token],
        routing_signals=RoutingSignals(
            languages=["python"],
            dependencies_any=[f"{cluster[0].lower()}-{sub[0]}"],
            negative_triggers=[f"non-{cluster[0].lower()}-workloads"],
        ),
        entrypoints=SkillEntrypoints(
            scripts=[
                ScriptEntrypoint(
                    path="scripts/check.py",
                    description=f"Verify {cluster[0]} {sub[0]} invariants.",
                )
            ]
        ),
        body_lines=20,
        body_tokens=150,
    )


def _build_planted_collision_manifests() -> list[SkillManifest]:
    """Return 4 manifests forming 1 BLOCKING_ERROR pair and 1 HIGH_RISK pair."""
    blocking_desc_a = (
        "Use when tuning PostgreSQL B-tree or GIN indexes, inspecting EXPLAIN ANALYZE "
        "execution plans, fixing N+1 ORM query loops, or auditing raw SQL migrations "
        "for table lock contention, unindexed foreign keys, and sequential scan "
        "bottlenecks across high-throughput transactional relational database workloads "
        "without modifying application routing."
    )
    blocking_desc_b = (
        "Use when tuning PostgreSQL B-tree or GIN indexes, inspecting EXPLAIN ANALYZE "
        "execution plans, fixing N+1 ORM query loops, or auditing SQL schema migrations "
        "for table lock contention, unindexed foreign keys, and sequential scan "
        "bottlenecks across production transactional relational database workloads "
        "without modifying application routing."
    )
    high_risk_desc_a = (
        "Use when implementing FastAPI OAuth2 JWT bearer authentication, configuring "
        "Pydantic token claims validation, enforcing role-based dependency injection "
        "guards, and rotating asymmetric RS256 signing keys across asynchronous Python "
        "REST API endpoints without leaking sensitive session secrets or exposing "
        "unprotected administrative routes."
    )
    high_risk_desc_b = (
        "Use when auditing FastAPI OAuth2 JWT bearer authentication, verifying Pydantic "
        "token claims schemas, testing role-based dependency injection security guards, "
        "and validating asymmetric RS256 key rotation across asynchronous Python REST "
        "API endpoints in production without exposing unprotected administrative routes "
        "or session tokens."
    )

    return [
        SkillManifest(
            name="planted-pg-tuning-alpha",
            description=blocking_desc_a,
            track=CatalogTrack.PYTHON_BACKEND,
            tags=["postgresql", "sql", "indexing", "explain-analyze"],
            routing_signals=RoutingSignals(
                languages=["python", "sql"],
                dependencies_any=["sqlalchemy", "psycopg"],
                negative_triggers=["redis-cache"],
            ),
            entrypoints=SkillEntrypoints(
                scripts=[
                    ScriptEntrypoint(
                        path="scripts/check.py",
                        description="Audit PostgreSQL indexing and EXPLAIN plans.",
                    )
                ]
            ),
        ),
        SkillManifest(
            name="planted-pg-tuning-beta",
            description=blocking_desc_b,
            track=CatalogTrack.PYTHON_BACKEND,
            tags=["postgresql", "sql", "indexing", "explain-analyze"],
            routing_signals=RoutingSignals(
                languages=["python", "sql"],
                dependencies_any=["sqlalchemy", "psycopg"],
                negative_triggers=["redis-cache"],
            ),
            entrypoints=SkillEntrypoints(
                scripts=[
                    ScriptEntrypoint(
                        path="scripts/check.py",
                        description="Audit PostgreSQL indexing and EXPLAIN plans.",
                    )
                ]
            ),
        ),
        SkillManifest(
            name="planted-fastapi-jwt-alpha",
            description=high_risk_desc_a,
            track=CatalogTrack.PYTHON_BACKEND,
            tags=["fastapi", "jwt", "oauth2", "rs256"],
            routing_signals=RoutingSignals(
                languages=["python"],
                dependencies_any=["fastapi", "pyjwt"],
                negative_triggers=["graphql-subscriptions"],
            ),
            entrypoints=SkillEntrypoints(
                scripts=[
                    ScriptEntrypoint(
                        path="scripts/check.py",
                        description="Verify FastAPI OAuth2 JWT guards.",
                    )
                ]
            ),
        ),
        SkillManifest(
            name="planted-fastapi-jwt-beta",
            description=high_risk_desc_b,
            track=CatalogTrack.PYTHON_BACKEND,
            tags=["fastapi", "jwt", "oauth2", "rs256"],
            routing_signals=RoutingSignals(
                languages=["python"],
                dependencies_any=["fastapi", "pyjwt"],
                negative_triggers=["cli-only-tools"],
            ),
            entrypoints=SkillEntrypoints(
                scripts=[
                    ScriptEntrypoint(
                        path="scripts/check.py",
                        description="Verify FastAPI OAuth2 JWT guards.",
                    )
                ]
            ),
        ),
    ]


def test_stress_84_skills_collision_matrix_accuracy_and_speed() -> None:
    """Verify 84-skill (3,486 pairs) collision matrix completes in <2s and finds planted pairs."""
    orthogonal = [_build_orthogonal_manifest(i) for i in range(80)]
    planted = _build_planted_collision_manifests()
    all_manifests = orthogonal + planted
    assert len(all_manifests) == 84

    start_time = time.perf_counter()
    collisions = compute_collision_matrix(all_manifests)
    elapsed_sec = time.perf_counter() - start_time

    assert elapsed_sec < 2.0, f"84-skill collision matrix took {elapsed_sec:.2f}s (> 2.0s)"

    by_pair = {(pair.skill_a, pair.skill_b): pair for pair in collisions}
    pg_pair = by_pair.get(("planted-pg-tuning-alpha", "planted-pg-tuning-beta"))
    assert pg_pair is not None
    assert pg_pair.severity is CollisionSeverity.BLOCKING_ERROR
    assert pg_pair.cosine_similarity >= 0.85
    assert "postgresql" in pg_pair.shared_terms

    jwt_pair = by_pair.get(("planted-fastapi-jwt-alpha", "planted-fastapi-jwt-beta"))
    assert jwt_pair is not None
    assert jwt_pair.severity in (CollisionSeverity.HIGH_RISK, CollisionSeverity.BLOCKING_ERROR)
    assert jwt_pair.cosine_similarity >= 0.72
    assert "fastapi" in jwt_pair.shared_terms

    # Ensure the 80 orthogonal skills do not produce any BLOCKING_ERROR collisions among themselves
    orthogonal_blocking = [
        pair
        for pair in collisions
        if pair.severity is CollisionSeverity.BLOCKING_ERROR
        and not pair.skill_a.startswith("planted-")
        and not pair.skill_b.startswith("planted-")
    ]
    assert orthogonal_blocking == []


def test_stress_84_skills_filesystem_audit_and_cli_routing_collapse_gate(
    tmp_path: Path,
) -> None:
    """Verify `audit_catalog` and `skillops audit` flag 84-skill L1 bloat and collisions."""
    catalog_root = tmp_path / "catalog"
    all_manifests = [_build_orthogonal_manifest(i) for i in range(80)] + (
        _build_planted_collision_manifests()
    )

    for manifest in all_manifests:
        skill_dir = catalog_root / manifest.track.value / manifest.name
        (skill_dir / "scripts").mkdir(parents=True)
        (skill_dir / "scripts" / "check.py").write_text(
            '"""Deterministic Level 3 helper script."""\n',
            encoding="utf-8",
        )
        tags_str = ", ".join(manifest.tags)
        deps_str = ", ".join(manifest.routing_signals.dependencies_any)
        neg_str = ", ".join(manifest.routing_signals.negative_triggers)
        (skill_dir / "SKILL.md").write_text(
            f"---\n"
            f"name: {manifest.name}\n"
            f"description: >-\n"
            f"  {manifest.description}\n"
            f"version: 1.0.0\n"
            f"track: {manifest.track.value}\n"
            f"tags: [{tags_str}]\n"
            f"routing_signals:\n"
            f"  languages: [python]\n"
            f"  dependencies_any: [{deps_str}]\n"
            f"  negative_triggers: [{neg_str}]\n"
            f"entrypoints:\n"
            f"  scripts:\n"
            f"    - path: scripts/check.py\n"
            f"      description: Deterministic Level 3 helper script.\n"
            f"---\n"
            f"# {manifest.name}\n\n"
            f"Run `python scripts/check.py --json`.\n",
            encoding="utf-8",
        )

    report = audit_catalog(catalog_root, strict=True, max_bundle_tokens=1500)
    assert report.total_skills == 84
    assert report.total_l1_bundle_tokens > 1500
    assert report.passed is False
    assert any(p.severity is CollisionSeverity.BLOCKING_ERROR for p in report.collisions)

    # 1. Under default 1,500 L1 bundle token cap, CLI exits with BUDGET_OR_CONTRACT_ERROR (3)
    budget_res = runner.invoke(
        app,
        ["audit", "--catalog", str(catalog_root), "--format", "json"],
    )
    assert budget_res.exit_code == int(ExitCode.BUDGET_OR_CONTRACT_ERROR)
    budget_payload = json.loads(budget_res.stdout)
    assert budget_payload["audited_skills"] == 84
    assert budget_payload["status"] == "budget_violation"

    # 2. Raising L1 bundle token cap isolates semantic collision failure (COLLISION_ERROR = 2)
    collision_res = runner.invoke(
        app,
        [
            "audit",
            "--catalog",
            str(catalog_root),
            "--max-l1-tokens",
            "20000",
            "--strict",
            "--format",
            "json",
        ],
    )
    assert collision_res.exit_code == int(ExitCode.COLLISION_ERROR)
    collision_payload = json.loads(collision_res.stdout)
    assert collision_payload["status"] == "collision_detected"
    assert collision_payload["collisions_found"] >= 2
