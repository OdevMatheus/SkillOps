"""Unit and integration tests for ``skillops.router.fingerprinter`` (Issue #54)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from skillops.router import (
    RepoFingerprint,
    RepoFingerprinter,
    RepoProfile,
    fingerprint_repository,
    normalize_package_name,
)


def test_normalize_package_name_handles_pep508_and_npm_scopes() -> None:
    """Verify PEP 508 specifiers, extras, comments, and scoped npm packages normalize cleanly."""
    assert normalize_package_name("FastAPI[all]>=0.115.0 # web") == "fastapi"
    assert normalize_package_name("pydantic_settings~=2.6.0") == "pydantic-settings"
    assert normalize_package_name("@modelcontextprotocol/sdk@1.2.0") == "@modelcontextprotocol/sdk"
    assert normalize_package_name("-r base.txt") is None
    assert normalize_package_name("   # comment only") is None
    assert normalize_package_name("git+https://github.com/org/repo.git") is None


def test_fingerprint_current_skillops_repository() -> None:
    """Verify fingerprinting the SkillOps workspace detects Python 3.12+, Pydantic, and CI."""
    repo_root = Path(__file__).resolve().parents[1]
    profile = fingerprint_repository(repo_root)

    assert isinstance(profile, RepoProfile)
    assert RepoFingerprint is RepoProfile
    assert "python" in profile.languages
    assert profile.python_312_plus is True
    assert profile.python_version == ">=3.12"
    assert "pydantic" in profile.frameworks
    assert "typer" in profile.frameworks
    assert "pyproject.toml" in profile.detected_files
    assert "SKILL_CONTRACT.md" in profile.detected_files
    assert ".skillops.yml" in profile.detected_files
    assert {
        "python-3.12+",
        "pydantic",
        "github-actions",
        "pytest",
        "ruff",
        "mypy-strict",
        "agent-skills",
    }.issubset(set(profile.signals))


def test_fingerprint_python_fastapi_postgres_agents_mcp_docker_repo(tmp_path: Path) -> None:
    """Detect Python 3.12+, FastAPI, Pydantic, SQLAlchemy, AsyncIO, Agents, MCP, Docker, and CI."""
    (tmp_path / "pyproject.toml").write_text(
        """
[project]
name = "enterprise-agent-service"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "pydantic>=2.10.0",
    "sqlalchemy[asyncio]>=2.0.36",
    "asyncpg>=0.30.0",
    "openai-agents>=0.1.0",
    "mcp>=1.2.0",
]

[dependency-groups]
dev = ["pytest>=8.3.0", "pytest-asyncio>=0.24.0"]
""".strip(),
        encoding="utf-8",
    )

    (tmp_path / "Dockerfile").write_text(
        "FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\n",
        encoding="utf-8",
    )
    (tmp_path / "docker-compose.yml").write_text(
        "services:\n  db:\n    image: pgvector/pgvector:pg16\n"
        "  cache:\n    image: redis:7-alpine\n",
        encoding="utf-8",
    )

    migrations_dir = tmp_path / "migrations"
    migrations_dir.mkdir()
    (migrations_dir / "001_init.sql").write_text(
        "CREATE EXTENSION IF NOT EXISTS vector;\n"
        "CREATE TABLE items (id UUID PRIMARY KEY, payload JSONB, created_at TIMESTAMPTZ);\n",
        encoding="utf-8",
    )

    workflows_dir = tmp_path / ".github" / "workflows"
    workflows_dir.mkdir(parents=True)
    (workflows_dir / "ci.yml").write_text(
        "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n"
        "    steps:\n      - run: pytest\n",
        encoding="utf-8",
    )

    src_dir = tmp_path / "src" / "app"
    src_dir.mkdir(parents=True)
    (src_dir / "main.py").write_text(
        """
from agents import Agent, Runner
from fastapi import FastAPI
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

type UserId = str

app = FastAPI()

async def run_agent(session: AsyncSession, user_id: UserId) -> dict[str, str]:
    return {"jsonrpc": "2.0", "method": "tools/list", "user": user_id}
""".strip(),
        encoding="utf-8",
    )

    # Ignored directory with decoys that must not pollute file counts
    ignored_venv = tmp_path / ".venv" / "lib"
    ignored_venv.mkdir(parents=True)
    (ignored_venv / "decoy.py").write_text("import django\n", encoding="utf-8")

    profile = RepoFingerprinter().fingerprint(tmp_path)

    assert set(profile.languages) == {"python", "sql"}
    assert profile.python_312_plus is True
    assert {"fastapi", "pydantic", "openai-agents", "mcp"}.issubset(set(profile.frameworks))
    assert {"postgresql", "sqlalchemy", "asyncpg", "redis"}.issubset(set(profile.databases))
    assert "django" not in profile.frameworks
    assert {
        "python-3.12+",
        "fastapi",
        "pydantic",
        "sqlalchemy",
        "postgresql",
        "asyncio",
        "openai-agents-sdk",
        "mcp",
        "docker",
        "github-actions",
        "pytest",
    }.issubset(set(profile.signals))
    assert "migrations/001_init.sql" in profile.detected_files
    assert "Dockerfile" in profile.detected_files
    assert "docker-compose.yml" in profile.detected_files
    assert ".github/workflows/ci.yml" in profile.detected_files


def test_fingerprint_nextjs_react_typescript_and_mcp_repo(tmp_path: Path) -> None:
    """Detect Next.js, React, TypeScript, and MCP signals from package.json and next.config.mjs."""
    (tmp_path / "package.json").write_text(
        json.dumps(
            {
                "name": "web-agent-dashboard",
                "dependencies": {
                    "next": "15.1.0",
                    "react": "19.0.0",
                    "react-dom": "19.0.0",
                    "@modelcontextprotocol/sdk": "1.1.0",
                },
                "devDependencies": {
                    "typescript": "5.7.2",
                },
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "next.config.mjs").write_text("export default {};\n", encoding="utf-8")
    (tmp_path / ".mcp.json").write_text('{"mcpServers": {}}\n', encoding="utf-8")
    app_dir = tmp_path / "src" / "app"
    app_dir.mkdir(parents=True)
    (app_dir / "page.tsx").write_text(
        "export default function Page() { return null; }\n", encoding="utf-8"
    )

    profile = fingerprint_repository(tmp_path)

    assert {"javascript", "typescript"}.issubset(set(profile.languages))
    assert {"nextjs", "react", "mcp"}.issubset(set(profile.frameworks))
    assert {"nextjs", "react", "mcp"}.issubset(set(profile.signals))
    assert "package.json" in profile.detected_files
    assert "next.config.mjs" in profile.detected_files
    assert ".mcp.json" in profile.detected_files


def test_fingerprint_polyglot_poetry_uv_cargo_gomod_and_malformed_files(tmp_path: Path) -> None:
    """Verify Poetry, uv.lock, requirements.txt, alembic.ini, Cargo, Go, and malformed files."""
    (tmp_path / "pyproject.toml").write_text(
        """
[tool.poetry.dependencies]
python = "^3.12"
flask = "^3.0.0"
sqlite-utils = "^3.36"
""".strip(),
        encoding="utf-8",
    )
    (tmp_path / "uv.lock").write_text(
        'version = 1\nrequires-python = ">=3.12"\n'
        '[[package]]\nname = "aiosqlite"\nversion = "0.20.0"\n',
        encoding="utf-8",
    )
    (tmp_path / "requirements-dev.txt").write_text(
        "ruff>=0.9.0\nmypy>=1.14.0\n",
        encoding="utf-8",
    )
    (tmp_path / ".python-version").write_text("3.12.7\n", encoding="utf-8")
    (tmp_path / "alembic.ini").write_text(
        "[alembic]\nscript_location = alembic\n", encoding="utf-8"
    )
    (tmp_path / "Cargo.toml").write_text(
        '[package]\nname = "worker"\n[dependencies]\ntokio = "1.0"\n',
        encoding="utf-8",
    )
    (tmp_path / "go.mod").write_text(
        "module example.com/cli\n\ngo 1.23\n\nrequire (\n\tgithub.com/spf13/cobra v1.8.0\n)\n",
        encoding="utf-8",
    )
    # Malformed package.json and syntax-error Python file must not crash fingerprinting
    (tmp_path / "package.json").write_text("{invalid json", encoding="utf-8")
    (tmp_path / "broken.py").write_text("def broken(:\n", encoding="utf-8")

    profile = fingerprint_repository(tmp_path)

    assert {"python", "rust", "go"}.issubset(set(profile.languages))
    assert profile.python_312_plus is True
    assert "flask" in profile.frameworks
    assert {"alembic", "sqlalchemy", "sqlite"}.issubset(set(profile.databases))
    assert {"tokio", "github.com/spf13/cobra", "ruff", "mypy", "aiosqlite"}.issubset(
        set(profile.dependencies)
    )


def test_fingerprint_raises_for_missing_directory(tmp_path: Path) -> None:
    """Verify FileNotFoundError is raised when the target path does not exist."""
    missing = tmp_path / "does-not-exist"
    with pytest.raises(FileNotFoundError, match="does not exist"):
        fingerprint_repository(missing)
