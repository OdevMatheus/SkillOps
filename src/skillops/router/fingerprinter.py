"""Deterministic repository stack fingerprinter for ``skillops route`` (``ADR-0003``).

Inspects any target repository (`pyproject.toml`, `requirements*.txt`, `uv.lock`,
`package.json`, `Cargo.toml`, `go.mod`, `Dockerfile`, `docker-compose*.yml`, SQL
migrations, `.github/workflows/*.yml`, and Python AST imports/constructs) to produce a
structured ``RepoProfile`` without executing any untrusted code.
"""

from __future__ import annotations

import ast
import json
import re
import tomllib
from typing import TYPE_CHECKING, Any

import yaml

from skillops.models import RepoFingerprint, RepoProfile

if TYPE_CHECKING:
    from pathlib import Path

_IGNORED_DIRS: frozenset[str] = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        ".venv",
        "venv",
        "env",
        "node_modules",
        "__pycache__",
        ".mypy_cache",
        ".ruff_cache",
        ".pytest_cache",
        ".tox",
        ".nox",
        "dist",
        "build",
        ".next",
        ".nuxt",
        "target",
        "coverage",
        "htmlcov",
    }
)

_EXTENSION_TO_LANGUAGE: dict[str, str] = {
    ".py": "python",
    ".pyi": "python",
    ".sql": "sql",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".rs": "rust",
    ".go": "go",
}

_PEP508_NAME_RE = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")
_PY312_VERSION_RE = re.compile(r"(?:^|>=|~=|==|\b)3\.(1[2-9]|[2-9]\d)\b|py31[2-9]", re.IGNORECASE)
_DOCKER_PY312_RE = re.compile(r"FROM\s+[^\s]*python:(3\.(?:1[2-9]|[2-9]\d))", re.IGNORECASE)
_POSTGRES_SQL_RE = re.compile(
    r"\b(SERIAL|BIGSERIAL|JSONB|TIMESTAMPTZ|UUID|BYTEA|CREATE\s+EXTENSION|pg_trgm|vector)\b",
    re.IGNORECASE,
)

_INDICATOR_FILENAMES: frozenset[str] = frozenset(
    {
        "pyproject.toml",
        "setup.py",
        "setup.cfg",
        "uv.lock",
        "poetry.lock",
        "Pipfile",
        "package.json",
        "tsconfig.json",
        "next.config.js",
        "next.config.mjs",
        "next.config.ts",
        "Cargo.toml",
        "go.mod",
        "Dockerfile",
        ".dockerignore",
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
        "alembic.ini",
        ".python-version",
        ".skillops.yml",
        ".mcp.json",
        "AGENTS.md",
        "CLAUDE.md",
        "SKILL_CONTRACT.md",
    }
)

_AST_IMPORT_TO_PACKAGE: dict[str, str] = {
    "fastapi": "fastapi",
    "starlette": "starlette",
    "uvicorn": "uvicorn",
    "pydantic": "pydantic",
    "pydantic_settings": "pydantic-settings",
    "sqlalchemy": "sqlalchemy",
    "sqlmodel": "sqlmodel",
    "asyncpg": "asyncpg",
    "psycopg": "psycopg",
    "psycopg2": "psycopg2",
    "alembic": "alembic",
    "pgvector": "pgvector",
    "sqlite3": "sqlite3",
    "aiosqlite": "aiosqlite",
    "redis": "redis",
    "asyncio": "asyncio",
    "anyio": "anyio",
    "aiohttp": "aiohttp",
    "httpx": "httpx",
    "agents": "openai-agents",
    "mcp": "mcp",
    "fastmcp": "fastmcp",
    "typer": "typer",
    "rich": "rich",
    "pytest": "pytest",
    "django": "django",
    "flask": "flask",
}


def normalize_package_name(raw_spec: str) -> str | None:
    """Extract and normalize a PEP 508 or npm package name to lowercase hyphenated form."""
    cleaned = raw_spec.split("#", 1)[0].strip()
    if not cleaned or cleaned.startswith(("-", "git+", "http://", "https://", ".")):
        return None
    if cleaned.startswith("@"):
        parts = cleaned.split()
        scoped = parts[0].strip()
        if scoped.count("@") > 1:
            scoped = scoped.rsplit("@", 1)[0]
        return scoped.lower()
    match = _PEP508_NAME_RE.match(cleaned)
    return re.sub(r"[-_.]+", "-", match.group(1)).lower() if match else None


def _safe_read_text(path: Path) -> str:
    """Read UTF-8 text from ``path``, returning an empty string on I/O or decode failure."""
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


class _MutableRepoScan:
    """Internal accumulator populated while walking and inspecting a repository."""

    def __init__(self) -> None:
        self.languages: set[str] = set()
        self.python_version: str | None = None
        self.python_312_plus: bool = False
        self.frameworks: set[str] = set()
        self.databases: set[str] = set()
        self.dependencies: set[str] = set()
        self.detected_files: set[str] = set()
        self.signals: set[str] = set()
        self.file_counts: dict[str, int] = {}
        self.has_async_constructs: bool = False
        self.has_mcp_protocol_patterns: bool = False


class RepoFingerprinter:
    """Deterministic zero-execution stack fingerprinter for ``skillops route``."""

    def __init__(self, *, max_python_files_ast: int = 250) -> None:
        self._max_python_files_ast = max_python_files_ast

    def fingerprint(self, repo_path: Path) -> RepoProfile:
        """Inspect ``repo_path`` and return a deterministic ``RepoProfile``."""
        resolved = repo_path.resolve()
        if not resolved.exists() or not resolved.is_dir():
            msg = (
                f"Target repository path '{repo_path.as_posix()}' "
                "does not exist or is not a directory."
            )
            raise FileNotFoundError(msg)

        scan = _MutableRepoScan()
        python_files: list[Path] = []
        sql_files: list[Path] = []

        for file_path in self._iter_repo_files(resolved):
            rel_posix = file_path.relative_to(resolved).as_posix()
            name = file_path.name
            ext = file_path.suffix.lower()

            if ext:
                scan.file_counts[ext] = scan.file_counts.get(ext, 0) + 1
                lang = _EXTENSION_TO_LANGUAGE.get(ext)
                if lang:
                    scan.languages.add(lang)

            self._record_indicator_file(file_path, rel_posix, name, scan)

            if ext in {".py", ".pyi"}:
                python_files.append(file_path)
            elif ext == ".sql":
                sql_files.append(file_path)

        for py_file in python_files[: self._max_python_files_ast]:
            self._inspect_python_ast(py_file, scan)

        for sql_file in sql_files[:100]:
            self._inspect_sql_file(sql_file, scan)

        self._derive_signals(scan)

        return RepoProfile(
            repo_path=resolved.as_posix(),
            languages=sorted(scan.languages),
            python_version=scan.python_version,
            python_312_plus=scan.python_312_plus,
            frameworks=sorted(scan.frameworks),
            databases=sorted(scan.databases),
            dependencies=sorted(scan.dependencies),
            detected_files=sorted(scan.detected_files),
            signals=sorted(scan.signals),
            file_counts=dict(sorted(scan.file_counts.items())),
        )

    def _iter_repo_files(self, root: Path) -> list[Path]:
        """Deterministically walk non-ignored files inside ``root``."""
        collected: list[Path] = []
        stack: list[Path] = [root]
        while stack:
            current = stack.pop()
            entries = sorted(current.iterdir(), key=lambda p: p.name)
            dirs_to_visit: list[Path] = []
            for entry in entries:
                if entry.is_symlink():
                    continue
                if entry.is_dir():
                    if entry.name not in _IGNORED_DIRS:
                        dirs_to_visit.append(entry)
                elif entry.is_file():
                    collected.append(entry)
            stack.extend(reversed(dirs_to_visit))
        return collected

    def _record_indicator_file(
        self,
        file_path: Path,
        rel_posix: str,
        name: str,
        scan: _MutableRepoScan,
    ) -> None:
        """Check whether ``file_path`` is a manifest, CI, Docker, or migration file."""
        lower_name = name.lower()

        if (
            name in _INDICATOR_FILENAMES
            or lower_name.startswith(("requirements", "dockerfile", "docker-compose"))
            or rel_posix.startswith(".github/workflows/")
            or rel_posix.endswith("SKILL.md")
            or ("migrations/" in rel_posix and file_path.suffix.lower() in {".sql", ".py"})
            or ("alembic/" in rel_posix and file_path.suffix.lower() == ".py")
        ):
            scan.detected_files.add(rel_posix)

        if name == "pyproject.toml":
            scan.languages.add("python")
            self._parse_pyproject_toml(file_path, scan)
        elif lower_name.startswith("requirements") and lower_name.endswith((".txt", ".in")):
            scan.languages.add("python")
            self._parse_requirements_txt(file_path, scan)
        elif name == ".python-version":
            scan.languages.add("python")
            self._parse_python_version_file(file_path, scan)
        elif name == "uv.lock":
            scan.languages.add("python")
            self._parse_uv_lock(file_path, scan)
        elif name == "package.json":
            self._parse_package_json(file_path, scan)
        elif name in {"next.config.js", "next.config.mjs", "next.config.ts"}:
            scan.frameworks.add("nextjs")
            scan.signals.add("nextjs")
        elif name == "Cargo.toml":
            scan.languages.add("rust")
            self._parse_cargo_toml(file_path, scan)
        elif name == "go.mod":
            scan.languages.add("go")
            self._parse_go_mod(file_path, scan)
        elif lower_name == "dockerfile" or lower_name.startswith("dockerfile."):
            scan.signals.add("docker")
            self._parse_dockerfile(file_path, scan)
        elif lower_name in {
            "docker-compose.yml",
            "docker-compose.yaml",
            "compose.yml",
            "compose.yaml",
        }:
            scan.signals.add("docker")
            self._parse_docker_compose(file_path, scan)
        elif rel_posix.startswith(".github/workflows/") and file_path.suffix.lower() in {
            ".yml",
            ".yaml",
        }:
            scan.signals.add("github-actions")
            self._parse_github_workflow(file_path, scan)
        elif name == "alembic.ini":
            scan.databases.add("alembic")
            scan.databases.add("sqlalchemy")
            scan.signals.add("sqlalchemy")
        elif name == ".mcp.json":
            scan.frameworks.add("mcp")
            scan.signals.add("mcp")
        elif rel_posix.endswith("SKILL.md") or name in {".skillops.yml", "SKILL_CONTRACT.md"}:
            scan.signals.add("agent-skills")

    def _parse_pyproject_toml(self, path: Path, scan: _MutableRepoScan) -> None:
        """Extract Python version, dependencies, and tool settings from ``pyproject.toml``."""
        try:
            data = tomllib.loads(_safe_read_text(path))
        except tomllib.TOMLDecodeError:
            return

        project = data.get("project")
        if isinstance(project, dict):
            req_py = project.get("requires-python")
            if isinstance(req_py, str) and req_py.strip():
                scan.python_version = req_py.strip()
                if _PY312_VERSION_RE.search(req_py):
                    scan.python_312_plus = True

            deps = project.get("dependencies")
            if isinstance(deps, list):
                self._add_dep_list(deps, scan)

            opt_deps = project.get("optional-dependencies")
            if isinstance(opt_deps, dict):
                for group_deps in opt_deps.values():
                    if isinstance(group_deps, list):
                        self._add_dep_list(group_deps, scan)

        dep_groups = data.get("dependency-groups")
        if isinstance(dep_groups, dict):
            for group_deps in dep_groups.values():
                if isinstance(group_deps, list):
                    self._add_dep_list(group_deps, scan)

        tool = data.get("tool")
        if isinstance(tool, dict):
            self._inspect_pyproject_tools(tool, scan)

    def _inspect_pyproject_tools(self, tool: dict[str, Any], scan: _MutableRepoScan) -> None:
        """Inspect ``[tool.*]`` sections in ``pyproject.toml``."""
        poetry = tool.get("poetry")
        if isinstance(poetry, dict):
            poetry_deps = poetry.get("dependencies")
            if isinstance(poetry_deps, dict):
                py_spec = poetry_deps.get("python")
                if isinstance(py_spec, str) and not scan.python_version:
                    scan.python_version = py_spec
                    if _PY312_VERSION_RE.search(py_spec):
                        scan.python_312_plus = True
                self._add_dep_list([k for k in poetry_deps if k != "python"], scan)

        ruff = tool.get("ruff")
        if isinstance(ruff, dict):
            scan.signals.add("ruff")
            target_ver = ruff.get("target-version")
            if isinstance(target_ver, str) and _PY312_VERSION_RE.search(target_ver):
                scan.python_312_plus = True

        mypy = tool.get("mypy")
        if isinstance(mypy, dict):
            py_ver = mypy.get("python_version")
            if isinstance(py_ver, str) and _PY312_VERSION_RE.search(py_ver):
                scan.python_312_plus = True
            if mypy.get("strict") is True:
                scan.signals.add("mypy-strict")

        pytest_cfg = tool.get("pytest")
        if isinstance(pytest_cfg, dict):
            scan.signals.add("pytest")
            ini = pytest_cfg.get("ini_options")
            if isinstance(ini, dict) and "asyncio_mode" in ini:
                scan.signals.add("asyncio")

    def _add_dep_list(self, items: list[Any], scan: _MutableRepoScan) -> None:
        for item in items:
            if isinstance(item, str):
                norm = normalize_package_name(item)
                if norm:
                    scan.dependencies.add(norm)

    def _parse_requirements_txt(self, path: Path, scan: _MutableRepoScan) -> None:
        self._add_dep_list(_safe_read_text(path).splitlines(), scan)

    def _parse_python_version_file(self, path: Path, scan: _MutableRepoScan) -> None:
        ver = _safe_read_text(path).strip()
        if ver:
            if not scan.python_version:
                scan.python_version = ver
            if _PY312_VERSION_RE.search(ver):
                scan.python_312_plus = True

    def _parse_uv_lock(self, path: Path, scan: _MutableRepoScan) -> None:
        try:
            data = tomllib.loads(_safe_read_text(path))
        except tomllib.TOMLDecodeError:
            return
        req_py = data.get("requires-python")
        if isinstance(req_py, str) and _PY312_VERSION_RE.search(req_py):
            scan.python_312_plus = True
            if not scan.python_version:
                scan.python_version = req_py
        packages = data.get("package")
        if isinstance(packages, list):
            pkg_names = [
                pkg["name"]
                for pkg in packages
                if isinstance(pkg, dict) and isinstance(pkg.get("name"), str)
            ]
            self._add_dep_list(pkg_names, scan)

    def _parse_package_json(self, path: Path, scan: _MutableRepoScan) -> None:
        try:
            data = json.loads(_safe_read_text(path))
        except json.JSONDecodeError:
            return
        if not isinstance(data, dict):
            return

        scan.languages.add("javascript")
        for section in ("dependencies", "devDependencies", "peerDependencies"):
            deps = data.get(section)
            if isinstance(deps, dict):
                self._add_dep_list(list(deps.keys()), scan)
        if "typescript" in scan.dependencies:
            scan.languages.add("typescript")

    def _parse_cargo_toml(self, path: Path, scan: _MutableRepoScan) -> None:
        try:
            data = tomllib.loads(_safe_read_text(path))
        except tomllib.TOMLDecodeError:
            return
        for section in ("dependencies", "dev-dependencies"):
            deps = data.get(section)
            if isinstance(deps, dict):
                self._add_dep_list(list(deps.keys()), scan)

    def _parse_go_mod(self, path: Path, scan: _MutableRepoScan) -> None:
        for line in _safe_read_text(path).splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith(("module ", "go ", "require", ")", "//")):
                parts = stripped.split()
                if parts:
                    scan.dependencies.add(parts[0].lower())

    def _parse_dockerfile(self, path: Path, scan: _MutableRepoScan) -> None:
        text = _safe_read_text(path)
        match = _DOCKER_PY312_RE.search(text)
        if match:
            scan.languages.add("python")
            scan.python_312_plus = True
            if not scan.python_version:
                scan.python_version = match.group(1)
        if re.search(r"\bpostgres(?::|\b)", text, re.IGNORECASE):
            scan.databases.add("postgresql")

    def _parse_docker_compose(self, path: Path, scan: _MutableRepoScan) -> None:
        text = _safe_read_text(path)
        if re.search(r"\b(?:postgres|pgvector/pgvector|postgis)\b", text, re.IGNORECASE):
            scan.databases.add("postgresql")
        if re.search(r"\bredis(?::|\b)", text, re.IGNORECASE):
            scan.databases.add("redis")

    def _parse_github_workflow(self, path: Path, scan: _MutableRepoScan) -> None:
        text = _safe_read_text(path)
        try:
            loaded = yaml.safe_load(text)
        except yaml.YAMLError:
            loaded = None

        if _PY312_VERSION_RE.search(text):
            scan.python_312_plus = True
        if isinstance(loaded, dict) and "pytest" in text:
            scan.signals.add("pytest")

    def _inspect_python_ast(self, path: Path, scan: _MutableRepoScan) -> None:
        """Inspect a Python file's AST for imports, PEP 695 3.12+ constructs, and async usage."""
        source = _safe_read_text(path)
        if not source:
            return

        if '"jsonrpc": "2.0"' in source or "tools/list" in source or "tools/call" in source:
            scan.has_mcp_protocol_patterns = True

        try:
            tree = ast.parse(source, filename=path.as_posix())
        except SyntaxError:
            return

        for node in ast.walk(tree):
            if isinstance(node, ast.TypeAlias):
                scan.python_312_plus = True
            elif isinstance(
                node,
                ast.AsyncFunctionDef | ast.AsyncFor | ast.AsyncWith | ast.Await,
            ):
                scan.has_async_constructs = True
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    top_mod = alias.name.split(".", 1)[0]
                    mapped = _AST_IMPORT_TO_PACKAGE.get(top_mod)
                    if mapped:
                        scan.dependencies.add(mapped)
            elif isinstance(node, ast.ImportFrom) and node.module:
                top_mod = node.module.split(".", 1)[0]
                mapped = _AST_IMPORT_TO_PACKAGE.get(top_mod)
                if mapped:
                    scan.dependencies.add(mapped)

    def _inspect_sql_file(self, path: Path, scan: _MutableRepoScan) -> None:
        """Inspect a ``.sql`` file for PostgreSQL/pgvector dialect indicators."""
        if _POSTGRES_SQL_RE.search(_safe_read_text(path)):
            scan.databases.add("postgresql")

    def _derive_signals(self, scan: _MutableRepoScan) -> None:
        """Derive canonical frameworks, databases, and stack signals from collected evidence."""
        deps = scan.dependencies

        if scan.python_312_plus:
            scan.signals.add("python-3.12+")

        if deps & {"fastapi", "starlette"}:
            scan.frameworks.add("fastapi")
            scan.signals.add("fastapi")

        if deps & {"pydantic", "pydantic-settings"}:
            scan.frameworks.add("pydantic")
            scan.signals.add("pydantic")

        if deps & {"typer"}:
            scan.frameworks.add("typer")

        if deps & {"django", "djangorestframework"}:
            scan.frameworks.add("django")

        if deps & {"flask"}:
            scan.frameworks.add("flask")

        if deps & {"sqlalchemy", "sqlmodel", "alembic"}:
            scan.databases.add("sqlalchemy")
            scan.signals.add("sqlalchemy")

        if deps & {"asyncpg", "psycopg", "psycopg2", "psycopg2-binary", "pgvector"}:
            scan.databases.add("postgresql")
            for drv in ("asyncpg", "psycopg", "pgvector"):
                if drv in deps:
                    scan.databases.add(drv)

        if "postgresql" in scan.databases:
            scan.signals.add("postgresql")

        if deps & {"sqlite3", "aiosqlite"}:
            scan.databases.add("sqlite")

        if "redis" in deps:
            scan.databases.add("redis")

        if scan.has_async_constructs or (
            deps & {"asyncio", "anyio", "aiohttp", "asyncpg", "aiosqlite", "pytest-asyncio"}
        ):
            scan.signals.add("asyncio")

        if deps & {"openai-agents"}:
            scan.frameworks.add("openai-agents")
            scan.signals.add("openai-agents-sdk")

        if scan.has_mcp_protocol_patterns or (
            deps & {"mcp", "fastmcp", "@modelcontextprotocol/sdk"}
        ):
            scan.frameworks.add("mcp")
            scan.signals.add("mcp")

        if "next" in deps or "nextjs" in scan.frameworks:
            scan.frameworks.add("nextjs")
            scan.signals.add("nextjs")

        if deps & {"react", "react-dom"}:
            scan.frameworks.add("react")
            scan.signals.add("react")

        if "pytest" in deps:
            scan.signals.add("pytest")
        if "ruff" in deps:
            scan.signals.add("ruff")
        if "mypy" in deps:
            scan.signals.add("mypy")


def fingerprint_repository(
    repo_path: Path,
    *,
    max_python_files_ast: int = 250,
) -> RepoProfile:
    """Inspect ``repo_path`` and return its deterministic ``RepoProfile``."""
    return RepoFingerprinter(max_python_files_ast=max_python_files_ast).fingerprint(repo_path)


__all__ = [
    "RepoFingerprint",
    "RepoFingerprinter",
    "RepoProfile",
    "fingerprint_repository",
    "normalize_package_name",
]
