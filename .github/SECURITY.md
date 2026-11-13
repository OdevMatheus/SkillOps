# Security Policy & User Trust Model

## Supported Versions

Only the latest release line of **SkillOps (`skillops-cli`)** receives active security updates and CodeQL SAST patches:

| Version | Supported | Notes |
| :--- | :---: | :--- |
| **`1.5.x`** | ✅ | Supported — 28 AI IDEs & CLIs Transpiler, AST Security Scanner (`INV-SKILL-06`), Lip Gloss TUI, SHA-256 Lockfile & Active LTS |
| **`< 1.5.0`** | ❌ | Unsupported — upgrade via `npx skillops-cli@latest` |

---

## 5-Pillar Defense-in-Depth Architecture (Why SkillOps Is Safe to Run)

Because AI coding Skills (`SKILL.md`), Subagents (`SUBAGENT.md`), and bundled helper scripts (`scripts/*.py`) run inside developer workspaces, **SkillOps** combines automated static analysis with mandatory human code review across 5 independent security pillars:

### Pillar 1 — 100% Curated, Maintainer-Reviewed Registry (`CODEOWNERS` Gate)
- **No Unverified Remote Fetching:** `skillops-cli` never downloads arbitrary third-party URLs or unreviewed Git repositories at runtime. It installs exclusively from the curated, version-pinned `catalog/` bundled inside the audited release.
- **Mandatory Code Owner Approval:** Every Pull Request targeting `main` is governed by GitHub Ruleset protection (`require_code_owner_review: true` via [`.github/CODEOWNERS`](./CODEOWNERS)). No community PR can be merged without explicit manual line-by-line review from `@OdevMatheus`.
- **Automatic Stale Review Dismissal:** Pushing any new commit to an open PR automatically invalidates prior approvals (`dismiss_stale_reviews_on_push: true`), preventing post-approval commit tampering.

### Pillar 2 — Deterministic AST Security Scanner & CodeQL SAST (`INV-SKILL-06`)
Every catalog Skill and script is audited on every PR and push by [`src/auditor/security.ts`](../src/auditor/security.ts), [`.github/workflows/ai-ci.yml`](./workflows/ai-ci.yml), and **GitHub CodeQL SAST** ([`.github/workflows/codeql.yml`](./workflows/codeql.yml)):
- **Zero Outbound Network Exfiltration (`forbidden-network-import`):** Blocks outbound network clients (`urllib.request`, `urllib2`, `urllib3`, `http.client`, `httplib`, `socket`, `socketserver`, `requests`, `httpx`, `aiohttp`, `ftplib`, `smtplib`, `telnetlib`, `xmlrpc.client`, `paramiko`, `websocket`, `websockets`) and remote shell pipes (`curl | sh`, `wget | bash`, `Invoke-WebRequest | iex`). Safe offline URL parsers (`urllib.parse`) and local preview servers (`http.server`, `webbrowser`) remain allowed.
- **Zero Dynamic Code Execution & Deserialization (`forbidden-dynamic-exec`):** Blocks `eval()`, `exec()`, `__import__()`, `Function()`, `pickle`, `cPickle`, `marshal`, `shelve`, `ctypes`, `cffi`, and base64-decoded shell execution (`base64 -d | sh`).
- **Zero Unsafe Shell Execution (`forbidden-shell-execution`):** Blocks `os.system()`, `os.popen()`, `os.spawn*()`, `os.exec*()`, `pty`, reverse-shell primitives (`/dev/tcp/`, `nc -e`), and `subprocess` calls with `shell=True`.

### Pillar 3 — Anti-Trojan Unicode, Symlink & Boundary Containment Guards
- **Anti-Trojan Source & Invisible Prompt Injection (`forbidden-trojan-unicode`):** Blocks CVE-2021-42574 bidirectional Unicode control characters (`U+202A..U+202E`, `U+2066..U+2069`, `U+200E`, `U+200F`, `U+061C`), LLM invisible Unicode Tag smuggling (`U+E0000..U+E007F`), and zero-width script identifier spoofing (`U+200B`, `U+200C`, `U+2060..U+2064`).
- **Zero Symlinks & Opaque Binaries (`forbidden-symlink`, `forbidden-binary-file`):** Rejects symbolic links and compiled binary/archive payloads (`.exe`, `.dll`, `.so`, `.dylib`, `.bin`, `.wasm`, `.pyc`, `.zip`, `.tar.gz`, `.7z`, `.jar`) that cannot be inspected in GitHub PR diffs.
- **Strict Repository Boundary Containment (`resolveSafeRepoTargetPath`):** Every planned file write or removal is verified via `path.resolve` containment in [`src/sync/adapters.ts`](../src/sync/adapters.ts) so no path can escape the target repository or overwrite a symbolic link.

### Pillar 4 — Cryptographic NPM Provenance (`--provenance`)
- Every official release of `skillops-cli` is built and published on GitHub-hosted runners via [`.github/workflows/npm-publish.yml`](./workflows/npm-publish.yml) using `npm publish --provenance`, generating a verifiable Sigstore attestation linking the npm tarball to the exact commit and workflow run.

### Pillar 5 — Local Inspection (`--dry-run`) & SHA-256 Lockfile (`.skillops-lock.json`)
- **Pre-Install Inspection:** Run `npx skillops-cli add <name> --dry-run` to inspect every target path before a single byte is written to disk.
- **Cryptographic Drift Protection:** `.skillops-lock.json` stores the SHA-256 hash of every installed file. `skillops add` and `skillops remove` refuse to overwrite or delete locally modified files unless `--force` is explicitly provided.

---

## How Users Can Verify Package & Catalog Integrity Locally

```bash
# 1. Verify npm package Sigstore provenance signatures
npm audit signatures

# 2. Preview planned file paths without writing to disk
npx skillops-cli@latest add mcp-architect --dry-run

# 3. Run the deterministic catalog security scanner on a local clone
node --input-type=module -e 'import { auditCatalogSecurity } from "./dist/index.js"; console.log(auditCatalogSecurity("./catalog"));'
```

---

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

If you discover a security vulnerability in **SkillOps**, please report it privately via [GitHub Private Vulnerability Reporting](https://github.com/skillops-toolkit/SkillOps/security/advisories/new) with:

1. A clear description of the vulnerability.
2. Steps to reproduce the issue.
3. Potential impact (e.g., indirect prompt injection, arbitrary code execution via skill scripts, path traversal, or credential exposure).
4. Suggested mitigation or fix (if available).

**Response SLA:** Security reports are acknowledged within **48 hours** and triaged with a remediation plan or advisory within **7 days**.
