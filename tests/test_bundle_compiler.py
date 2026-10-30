"""Unit and integration tests for ``skillops.router.bundle_compiler`` (Issue #55)."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from skillops.router import (
    DynamicSkillRouter,
    RepoProfile,
    compile_skill_bundle,
    route_repository,
)


def _ensure_min_words(text: str, domain_seed: str) -> str:
    """Ensure synthetic skill description has at least 44 words using domain-specific tokens."""
    words = text.split()
    idx = 1
    clean_seed = domain_seed.replace("-", "")
    while len(words) < 44:
        words.append(f"{clean_seed}term{idx}")
        idx += 1
    return " ".join(words)


def _write_synthetic_skill(
    catalog_root: Path,
    *,
    track: str,
    name: str,
    description: str,
    tags: list[str],
    languages: list[str],
    files_any: list[str],
    dependencies_any: list[str],
    seed_override: str | None = None,
) -> None:
    skill_dir = catalog_root / track / name
    scripts_dir = skill_dir / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    script_file = scripts_dir / "check.py"
    script_file.write_text("print('{}')\n", encoding="utf-8")

    padded_description = _ensure_min_words(description, seed_override or name)

    frontmatter = {
        "name": name,
        "description": padded_description,
        "version": "1.0.0",
        "track": track,
        "tags": tags,
        "routing_signals": {
            "languages": languages,
            "files_any": files_any,
            "dependencies_any": dependencies_any,
            "negative_triggers": ["Do not trigger on static HTML templates."],
        },
        "entrypoints": {
            "scripts": [
                {
                    "path": "scripts/check.py",
                    "description": f"Deterministic verification helper for {name}.",
                }
            ]
        },
    }
    yaml_str = yaml.safe_dump(frontmatter, sort_keys=False).strip()
    (skill_dir / "SKILL.md").write_text(
        f"---\n{yaml_str}\n---\n\n# {name}\n\nExecute `python scripts/check.py --json`.\n",
        encoding="utf-8",
    )


def test_route_skillops_repository_against_real_catalog() -> None:
    """Verify routing the SkillOps repo against catalog/ selects relevant Python skills cleanly."""
    repo_root = Path(__file__).resolve().parents[1]
    catalog_dir = repo_root / "catalog"

    bundle = route_repository(repo_root, catalog_dir)

    assert bundle.passed_invariants is True
    assert 1 <= len(bundle.selected_skills) <= 12
    assert bundle.total_l1_tokens <= 1500
    assert bundle.max_pairwise_similarity < 0.78

    selected_names = [s.name for s in bundle.selected_skills]
    assert "ast-blast-radius" in selected_names
    assert "mcp-architect" in selected_names


def test_greedy_bundle_compiler_enforces_collision_cap_and_token_limits(tmp_path: Path) -> None:
    """Verify greedy bundle selection enforces <0.78 similarity, <=12 skills, and token caps."""
    catalog_dir = tmp_path / "catalog"

    # 1. Two colliding FastAPI skills (near-identical 45-word descriptions -> second skipped)
    fastapi_desc = (
        "Use when building or auditing FastAPI production endpoints, Pydantic v2 request "
        "and response schemas, Lifespan context managers, async route dependencies, and HTTP "
        "exception handlers in Python backend microservices to prevent event-loop blocking, "
        "broken OpenAPI contracts, and unvalidated payload security vulnerabilities before "
        "deploying services."
    )
    _write_synthetic_skill(
        catalog_dir,
        track="python-backend",
        name="fastapi-primary",
        description=fastapi_desc,
        tags=["fastapi", "pydantic", "asyncio"],
        languages=["python"],
        files_any=["pyproject.toml", "Dockerfile"],
        dependencies_any=["fastapi", "pydantic"],
        seed_override="fastapishared",
    )
    _write_synthetic_skill(
        catalog_dir,
        track="python-backend",
        name="fastapi-duplicate",
        description=fastapi_desc,
        tags=["fastapi", "pydantic"],
        languages=["python"],
        files_any=["pyproject.toml"],
        dependencies_any=["fastapi"],
        seed_override="fastapishared",
    )

    # 2. A Rust skill that must be skipped due to language_mismatch
    _write_synthetic_skill(
        catalog_dir,
        track="arch-quality",
        name="rust-borrow-checker",
        description=(
            "Use when debugging Rust lifetime annotations, trait bounds, borrow checker errors, "
            "unsafe raw pointer blocks, Send and Sync concurrency markers, or Tokio async task "
            "pinning in Cargo workspaces and native systems binaries before compiling release "
            "artifacts or publishing crates."
        ),
        tags=["rust", "tokio", "cargo"],
        languages=["rust"],
        files_any=["Cargo.toml"],
        dependencies_any=["tokio"],
    )

    # 3. A low-score skill with no matching files, deps, or tags (below_min_score)
    _write_synthetic_skill(
        catalog_dir,
        track="arch-quality",
        name="cobol-mainframe-bridge",
        description=(
            "Use when translating legacy COBOL copybooks, EBCDIC fixed-width mainframe records, "
            "JCL batch job control decks, and CICS transaction screens into modern gateway "
            "schemas without corrupting packed decimal financial arithmetic or zoned fields "
            "during batch settlement runs."
        ),
        tags=["cobol", "ebcdic", "jcl"],
        languages=[],
        files_any=["mainframe.jcl"],
        dependencies_any=["pycics"],
    )

    # 4. 13 distinct domain skills (~45 words each) to test max_skills=12 cap and token limits
    distinct_domains = [
        (
            "postgres-indexing",
            "postgresql",
            (
                "Use when tuning PostgreSQL B-tree, GIN, and HNSW vector indexes, inspecting "
                "EXPLAIN ANALYZE execution buffers, resolving sequential table scans, configuring "
                "autovacuum dead-tuple thresholds, or eliminating foreign-key lock contention "
                "across high-throughput relational database tables and partitioned schemas."
            ),
        ),
        (
            "sqlalchemy-async-session",
            "sqlalchemy",
            (
                "Use when configuring SQLAlchemy 2.0 AsyncSession transaction boundaries, "
                "eliminating implicit lazy-loading greenlet errors with selectinload or "
                "joinedload eager queries, sizing QueuePool connection limits, or mapping "
                "declarative ORM models in asynchronous persistence layers."
            ),
        ),
        (
            "mcp-stdio-transport",
            "mcp",
            (
                "Use when implementing Model Context Protocol JSON-RPC 2.0 stdio transport "
                "framing, registering deterministic tool input schemas, negotiating server "
                "capabilities, sanitizing stdout protocol streams, or confining filesystem "
                "resource URIs against path traversal attacks."
            ),
        ),
        (
            "openai-agents-handoffs",
            "openai-agents",
            (
                "Use when orchestrating OpenAI Agents SDK multi-agent handoff topologies, "
                "attaching parallel input and output guardrails, defining structured Pydantic "
                "output schemas, managing SQLite session memory, or instrumenting run trace "
                "spans across autonomous workflows."
            ),
        ),
        (
            "asyncio-taskgroup-cancellation",
            "asyncio",
            (
                "Use when designing Python 3.12 asyncio TaskGroup structured concurrency blocks, "
                "enforcing bounded Semaphore backpressure, shielding critical cleanup coroutines "
                "from CancelledError propagation, or eliminating dangling background tasks in "
                "event-driven worker loops."
            ),
        ),
        (
            "docker-multistage-hardening",
            "docker",
            (
                "Use when authoring Docker multi-stage distroless container builds, enforcing "
                "non-root UID execution privileges, optimizing BuildKit layer cache mounts, "
                "stripping build-time compilers from runtime images, or configuring container "
                "healthcheck probes."
            ),
        ),
        (
            "github-actions-oidc",
            "github-actions",
            (
                "Use when hardening GitHub Actions continuous integration workflows, restricting "
                "GITHUB_TOKEN permissions to least privilege, pinning third-party actions to "
                "immutable commit SHAs, configuring dependency matrix caches, or signing OIDC "
                "provenance attestations."
            ),
        ),
        (
            "pytest-fixture-isolation",
            "pytest",
            (
                "Use when structuring Pytest parametrized test suites, isolating external side "
                "effects with monkeypatch and tmp_path sandboxes, asserting deterministic "
                "exception match patterns, or enforcing ninety percent branch coverage quality "
                "gates in automated test runners."
            ),
        ),
        (
            "mypy-strict-generics",
            "mypy",
            (
                "Use when resolving Mypy strict mode type checking errors, declaring PEP 695 "
                "generic type parameters, narrowing union types with TypeGuard and TypeIs, "
                "defining structural Protocol interfaces, or typing decorator overloads with "
                "ParamSpec."
            ),
        ),
        (
            "ruff-ast-lint-rules",
            "ruff",
            (
                "Use when configuring Ruff linter rule selectors, reducing McCabe cyclomatic "
                "complexity in deeply nested functions, enforcing deterministic isort import "
                "blocks, eliminating unused bindings, or standardizing line lengths across "
                "workspace packages."
            ),
        ),
        (
            "redis-lua-ratelimiter",
            "redis",
            (
                "Use when implementing Redis atomic Lua token-bucket rate limiters, managing "
                "distributed consumer group streams, preventing cache stampedes with singleflight "
                "TTL locks, or configuring eviction policies for low-latency in-memory state "
                "stores."
            ),
        ),
        (
            "alembic-zero-downtime",
            "alembic",
            (
                "Use when authoring Alembic zero-downtime database schema migrations, executing "
                "expand-and-contract column renames, building indexes concurrently outside "
                "transaction blocks, or verifying reversible downgrade scripts before production "
                "rollouts."
            ),
        ),
        (
            "jwt-eddsa-verification",
            "security",
            (
                "Use when verifying EdDSA and RS256 asymmetric JSON Web Token cryptographic "
                "signatures, rotating remote JWKS public key caches, enforcing strict issuer "
                "and audience claim validation, or preventing algorithm confusion attacks in "
                "authentication middleware."
            ),
        ),
    ]

    for idx, (slug, dep_signal, desc_text) in enumerate(distinct_domains):
        _write_synthetic_skill(
            catalog_dir,
            track="arch-quality" if idx % 2 == 0 else "ai-engineering",
            name=slug,
            description=desc_text,
            tags=[dep_signal],
            languages=["python"],
            files_any=["*.toml"],
            dependencies_any=[dep_signal],
        )

    profile = RepoProfile(
        repo_path=tmp_path.as_posix(),
        languages=["python", "sql"],
        python_version=">=3.12",
        python_312_plus=True,
        frameworks=["fastapi", "pydantic", "openai-agents", "mcp"],
        databases=["postgresql", "sqlalchemy", "alembic", "redis"],
        dependencies=[
            "fastapi",
            "pydantic",
            "sqlalchemy",
            "postgresql",
            "mcp",
            "openai-agents",
            "asyncio",
            "pytest",
            "mypy",
            "ruff",
            "redis",
            "alembic",
            "security",
        ],
        detected_files=["pyproject.toml", "Dockerfile", ".github/workflows/ci.yml"],
        signals=[
            "python-3.12+",
            "fastapi",
            "pydantic",
            "sqlalchemy",
            "postgresql",
            "mcp",
            "openai-agents-sdk",
            "asyncio",
            "docker",
            "github-actions",
            "pytest",
            "mypy-strict",
            "ruff",
        ],
    )

    bundle = compile_skill_bundle(profile, catalog_dir, max_skills=12, max_l1_tokens=1500)

    assert bundle.passed_invariants is True
    assert len(bundle.selected_skills) == 12
    assert bundle.total_l1_tokens <= 1500
    assert bundle.max_pairwise_similarity < 0.78

    skipped_by_name = {s.name: s.reason for s in bundle.skipped_skills}
    assert skipped_by_name.get("rust-borrow-checker") == "language_mismatch"
    assert "below_min_score" in skipped_by_name.get("cobol-mainframe-bridge", "")
    assert "collision_with:fastapi-primary" in skipped_by_name.get("fastapi-duplicate", "")
    assert any("exceeds_max_skills" in r for r in skipped_by_name.values())

    # Verify tight token cap triggers exceeds_max_l1_tokens
    tight_bundle = compile_skill_bundle(profile, catalog_dir, max_skills=12, max_l1_tokens=200)
    assert tight_bundle.total_l1_tokens <= 200
    assert any("exceeds_max_l1_tokens" in s.reason for s in tight_bundle.skipped_skills)


def test_dynamic_skill_router_validates_inv_skill_03_max_skills_bounds() -> None:
    """Verify DynamicSkillRouter rejects max_skills outside [1, 12] per INV-SKILL-03."""
    with pytest.raises(ValueError, match="INV-SKILL-03"):
        DynamicSkillRouter(max_skills=13)
    with pytest.raises(ValueError, match="INV-SKILL-03"):
        DynamicSkillRouter(max_skills=0)
