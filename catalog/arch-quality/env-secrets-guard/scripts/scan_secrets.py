"""Deterministic secrets and .env hygiene scanner using pure Python stdlib."""

from __future__ import annotations

import argparse
import json
import re
import struct
from pathlib import Path
from typing import Any

SKILL = "env-secrets-guard"
SCRIPT = "scan_secrets.py"

SKIP_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    "__pycache__",
    ".next",
    "coverage",
    ".tox",
    ".mypy_cache",
}
MAX_FILE_BYTES = 1_000_000
MAX_LINE_LENGTH = 4096
EXAMPLE_SUFFIXES = (".example", ".sample", ".template", ".dist")

AWS_ACCESS_KEY_RE = re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")
GITHUB_TOKEN_RE = re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b")
ANTHROPIC_KEY_RE = re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{20,}")
OPENAI_KEY_RE = re.compile(r"\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_\-]{32,}")
GOOGLE_API_KEY_RE = re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")
HUGGINGFACE_TOKEN_RE = re.compile(r"\bhf_[A-Za-z0-9]{30,}\b")
SLACK_TOKEN_RE = re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}")
PRIVATE_KEY_BLOCK_RE = re.compile(r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----")
ASSIGNMENT_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]{0,80})\s*[:=]\s*[\"']?([^\s\"'#;,]{8,160})[\"']?")

SENSITIVE_KEYWORDS = (
    "API_KEY",
    "SECRET",
    "ACCESS_KEY",
    "AUTH_TOKEN",
    "ACCESS_TOKEN",
    "REFRESH_TOKEN",
    "PRIVATE_KEY",
    "PASSWORD",
    "PASSWD",
    "DB_PASS",
    "DATABASE_URL",
)

PLACEHOLDER_SUBSTRINGS = (
    "example",
    "changeme",
    "change_me",
    "your_",
    "your-",
    "xxx",
    "dummy",
    "placeholder",
    "sample",
    "${",
    "%(",
    "***",
    "todo",
    "none",
    "null",
    "true",
    "false",
)

CODE_LOOKUP_PREFIXES = (
    "os.environ",
    "os.getenv",
    "process.env",
    "import.meta.env",
    "deno.env",
    "bun.env",
    "settings.",
    "config.",
    "env.",
    "self.",
    "cls.",
)


def _redact(value: str) -> str:
    return f"{value[:4]}***" if len(value) > 4 else "***"


def _is_env_file(name: str) -> bool:
    return name == ".env" or name.startswith(".env.")


def _is_example_env(name: str) -> bool:
    return name.endswith(EXAMPLE_SUFFIXES)


def _is_placeholder(value: str) -> bool:
    lowered = value.lower()
    if any(marker in lowered for marker in PLACEHOLDER_SUBSTRINGS):
        return True
    open_angle = value.find("<")
    return open_angle != -1 and value.find(">", open_angle + 1) != -1


def _is_dynamic_code_expr(matched_text: str, value: str) -> bool:
    rhs = matched_text.split("=", 1)[-1] if "=" in matched_text else matched_text.split(":", 1)[-1]
    rhs_stripped = rhs.strip()
    is_quoted = (
        len(rhs_stripped) >= 2
        and rhs_stripped[0] in ("'", '"')
        and rhs_stripped[-1] == rhs_stripped[0]
    )
    if is_quoted:
        return False
    lowered = value.lower()
    if lowered.startswith(CODE_LOOKUP_PREFIXES):
        return True
    if any(ch in value for ch in ("(", ")", "[", "]")):
        return True
    return False


def _wildcard_match(text: str, pattern: str) -> bool:
    """Linear-space two-pointer glob matcher supporting '*' and '?' without regex compilation."""
    t_idx = 0
    p_idx = 0
    star_idx = -1
    match_idx = 0
    t_len = len(text)
    p_len = len(pattern)

    while t_idx < t_len:
        if p_idx < p_len and (pattern[p_idx] == "?" or pattern[p_idx] == text[t_idx]):
            t_idx += 1
            p_idx += 1
        elif p_idx < p_len and pattern[p_idx] == "*":
            star_idx = p_idx
            match_idx = t_idx
            p_idx += 1
        elif star_idx != -1:
            p_idx = star_idx + 1
            match_idx += 1
            t_idx = match_idx
        else:
            return False

    while p_idx < p_len and pattern[p_idx] == "*":
        p_idx += 1

    return p_idx == p_len


def _resolve_git_dir(root: Path) -> Path | None:
    dot_git = root / ".git"
    if dot_git.is_dir():
        return dot_git
    if dot_git.is_file():
        try:
            first_line = dot_git.read_text(encoding="utf-8", errors="replace").splitlines()[0]
        except (IndexError, OSError):
            return None
        if first_line.startswith("gitdir:"):
            raw_target = first_line.partition(":")[2].strip()
            resolved = (root / raw_target).resolve()
            if resolved.is_dir():
                return resolved
    return None


def _read_git_index_paths(git_dir: Path | None) -> set[str]:
    """Parse standard Git DIRC v2/v3 index binary using stdlib struct to detect tracked files."""
    if git_dir is None:
        return set()
    index_path = git_dir / "index"
    if not index_path.is_file():
        return set()
    try:
        data = index_path.read_bytes()
        if len(data) < 12:
            return set()
        magic, version, entry_count = struct.unpack(">4sII", data[:12])
        if magic != b"DIRC" or version not in (2, 3):
            return set()
        tracked: set[str] = set()
        offset = 12
        data_len = len(data)
        for _ in range(entry_count):
            if offset + 62 > data_len:
                break
            flags = struct.unpack(">H", data[offset + 60 : offset + 62])[0]
            header_size = 62 + (2 if (version >= 3 and (flags & 0x4000)) else 0)
            name_start = offset + header_size
            nul_pos = data.find(b"\x00", name_start)
            if nul_pos == -1:
                break
            rel_path = data[name_start:nul_pos].decode("utf-8", errors="replace")
            if rel_path:
                tracked.add(rel_path)
            entry_len = ((nul_pos - offset) + 8) & ~7
            if entry_len <= 0:
                break
            offset += entry_len
        return tracked
    except OSError:
        return set()


def _matches_gitignore_rule(rel: str, name: str, raw_pattern: str) -> bool:
    dir_only = raw_pattern.endswith("/")
    pattern = raw_pattern.rstrip("/")
    if not pattern:
        return False

    anchored = pattern.startswith("/")
    clean = pattern.lstrip("/")
    if clean.startswith("**/"):
        clean = clean[3:]
        anchored = False

    if dir_only:
        parent_parts = Path(rel).parts[:-1]
        if anchored:
            return bool(parent_parts) and _wildcard_match("/".join(parent_parts), clean)
        return any(_wildcard_match(part, clean) for part in parent_parts)

    if "/" in clean or anchored:
        return _wildcard_match(rel, clean)
    return _wildcard_match(name, clean) or _wildcard_match(rel, clean)


def _collect_ignore_files(root: Path, rel: str, git_dir: Path | None) -> list[tuple[Path, str]]:
    """Return [(ignore_file, rel_to_ignore_dir)] ordered from repo exclude down to deepest subdir."""
    candidates: list[tuple[Path, str]] = []
    if git_dir is not None:
        exclude = git_dir / "info" / "exclude"
        if exclude.is_file():
            candidates.append((exclude, rel))

    parts = Path(rel).parts
    current_dir = root
    for depth in range(len(parts)):
        gitignore = current_dir / ".gitignore"
        sub_rel = "/".join(parts[depth:])
        if gitignore.is_file():
            candidates.append((gitignore, sub_rel))
        if depth < len(parts) - 1:
            current_dir = current_dir / parts[depth]
    return candidates


def _is_ignored(root: Path, rel: str, git_dir: Path | None) -> bool:
    ignored = False
    name = Path(rel).name
    for ignore_file, scoped_rel in _collect_ignore_files(root, rel, git_dir):
        try:
            lines = ignore_file.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for raw_line in lines:
            stripped = raw_line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            negated = stripped.startswith("!")
            rule = stripped[1:].strip() if negated else stripped
            if _matches_gitignore_rule(scoped_rel, name, rule):
                ignored = not negated
    return ignored


def _walk(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in sorted(root.rglob("*")):
        rel_parts = path.relative_to(root).parts
        if any(part in SKIP_DIRS for part in rel_parts[:-1]):
            continue
        if path.is_file() and not path.is_symlink():
            files.append(path)
    return files


def _finding(rel: str, line: int, rule: str, severity: str, impact: str) -> dict[str, Any]:
    return {
        "file": rel,
        "line": line,
        "symbol": rule,
        "impact": impact,
        "severity": severity,
    }


def _scan_provider_tokens(rel: str, lineno: int, line: str) -> list[dict[str, Any]]:
    checks = (
        ("aws-access-key-id", AWS_ACCESS_KEY_RE.search(line)),
        ("github-token", GITHUB_TOKEN_RE.search(line)),
        ("anthropic-api-key", ANTHROPIC_KEY_RE.search(line)),
        ("openai-api-key", OPENAI_KEY_RE.search(line)),
        ("google-api-key", GOOGLE_API_KEY_RE.search(line)),
        ("huggingface-token", HUGGINGFACE_TOKEN_RE.search(line)),
        ("slack-token", SLACK_TOKEN_RE.search(line)),
        ("private-key-block", PRIVATE_KEY_BLOCK_RE.search(line)),
    )
    results: list[dict[str, Any]] = []
    for rule, match in checks:
        if match and not _is_placeholder(match.group(0)):
            results.append(
                _finding(
                    rel,
                    lineno,
                    rule,
                    "error",
                    f"Hardcoded credential detected ({_redact(match.group(0))}); "
                    "move it to an environment variable and rotate it.",
                )
            )
    return results


def _has_sensitive_key_name(raw_key: str) -> bool:
    upper_key = raw_key.upper()
    return any(keyword in upper_key for keyword in SENSITIVE_KEYWORDS)


def scan_repo(root: Path) -> tuple[list[dict[str, Any]], int]:
    """Return (findings, files_scanned) for the directory tree under root."""
    findings: list[dict[str, Any]] = []
    scanned = 0
    git_dir = _resolve_git_dir(root)
    tracked_paths = _read_git_index_paths(git_dir)

    for path in _walk(root):
        rel = path.relative_to(root).as_posix()
        name = path.name

        if _is_env_file(name) and not _is_example_env(name):
            if rel in tracked_paths:
                findings.append(
                    _finding(
                        rel,
                        0,
                        "env-file-tracked",
                        "error",
                        "Environment file is tracked by git; remove it from the index and rotate its secrets.",
                    )
                )
            elif not _is_ignored(root, rel, git_dir):
                findings.append(
                    _finding(
                        rel,
                        0,
                        "env-file-not-ignored",
                        "error",
                        "Environment file is not covered by .gitignore; add '.env' and '.env.*'.",
                    )
                )
            continue  # real .env files hold secrets by design; never scan or print their content

        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                continue
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        scanned += 1

        for lineno, line in enumerate(text.splitlines(), start=1):
            if len(line) > MAX_LINE_LENGTH:
                continue
            token_hits = _scan_provider_tokens(rel, lineno, line)
            findings.extend(token_hits)

            assign_match = ASSIGNMENT_RE.search(line)
            if assign_match:
                key_name = assign_match.group(1)
                secret_val = assign_match.group(2)
                if (
                    _has_sensitive_key_name(key_name)
                    and not _is_placeholder(secret_val)
                    and not _is_dynamic_code_expr(assign_match.group(0), secret_val)
                ):
                    findings.append(
                        _finding(
                            rel,
                            lineno,
                            "hardcoded-secret-assignment",
                            "warning",
                            f"Literal value assigned to a secret-like name ({_redact(secret_val)}); "
                            "read it from the environment instead.",
                        )
                    )

    return findings, scanned


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint: exit 0 clean, 1 findings, 2 invalid path."""
    parser = argparse.ArgumentParser(
        description="Scan a repository for secrets and .env hygiene issues."
    )
    parser.add_argument("--path", required=True, help="Repository root directory to scan.")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Emit JSON output.")
    args = parser.parse_args(argv)

    root = Path(args.path)
    if not root.is_dir():
        if args.as_json:
            print(
                json.dumps(
                    {
                        "skill": SKILL,
                        "script": SCRIPT,
                        "status": "error",
                        "target": root.as_posix(),
                        "summary": {"files_scanned": 0, "findings_count": 0},
                        "findings": [],
                    }
                )
            )
        else:
            print(f"error: not a directory: {root}")
        return 2

    findings, scanned = scan_repo(root)
    status = "ok" if not findings else "findings_detected"
    if args.as_json:
        print(
            json.dumps(
                {
                    "skill": SKILL,
                    "script": SCRIPT,
                    "status": status,
                    "target": root.as_posix(),
                    "summary": {
                        "files_scanned": scanned,
                        "findings_count": len(findings),
                        "errors": sum(f["severity"] == "error" for f in findings),
                        "warnings": sum(f["severity"] == "warning" for f in findings),
                    },
                    "findings": findings,
                },
                indent=2,
            )
        )
    else:
        for f in findings:
            print(f"{f['file']}:{f['line']}: {f['severity']}: {f['symbol']}: {f['impact']}")
        print(f"status={status} files_scanned={scanned} findings={len(findings)}")
    return 0 if not findings else 1


if __name__ == "__main__":
    raise SystemExit(main())
