/**
 * Deterministic Security Scanner for Hybrid Executable Skills & Subagents (`src/auditor/security.ts`).
 *
 * Enforces Step 2 (Issue #190), Step 3 (Issue #191), and Lagune Defense Plan hardening:
 * - Blocks outbound network/exfiltration clients in Python (`urllib.request`, `urllib2`, `urllib3`,
 *   `http.client`, `httplib`, `socket`, `socketserver`, `requests`, `httpx`, `aiohttp`, `ftplib`,
 *   `smtplib`, `telnetlib`, `xmlrpc.client`, `paramiko`, `websocket`, `websockets`) while allowing
 *   offline URL parsers (`urllib.parse`, `urllib.error`) and local preview servers (`http.server`,
 *   `http.cookies`, `http.HTTPStatus`, `webbrowser`).
 * - Blocks dynamic code execution and unsafe deserialization in Python (`eval`, `exec`, `__import__`,
 *   `importlib`, `builtins`, `getattr(__builtins__, ...)`, 3-arg `compile()`, `pickle`, `marshal`,
 *   `shelve`, `ctypes`, `cffi`) while allowing `from re import compile` + `compile(r'...')`,
 *   `def eval()`, and `model.eval()`.
 * - Blocks dangerous Node/Web primitives in JS/TS (`child_process`, `vm`, `worker_threads`, `net`,
 *   `http`, `https`, `http2`, `tls`, `dgram`, `dns`, `undici`, global `fetch()`, `new WebSocket()`,
 *   dynamic `import()`, `eval()`, `Function()`, `process.binding()`, `process.dlopen()`) while
 *   allowing class methods (`async eval(...) { ... }`).
 * - Blocks unsafe shell execution (`os.system`, `os.popen`, `pty`, `subprocess` with `shell=True`,
 *   and shell pipe-to-interpreter / reverse-shell payloads in `.sh` scripts) while allowing safe
 *   array-based `subprocess.run([...])` (`shell=False`) and local `curl` healthchecks.
 * - Blocks Trojan-Source (CVE-2021-42574) bidirectional control characters and LLM invisible Unicode
 *   Tag prompt-injection characters (`U+E0000..U+E007F`) across every UTF-8 text file in a Skill
 *   directory, plus zero-width script identifier spoofing inside executable scripts.
 * - Enforces `MAX_SCANNED_LINE_LENGTH` and strictly linear O(n) scanning with zero polynomial regexes.
 * - Never trusts inline comments inside scanned files; maintainer exceptions are loaded exclusively
 *   from `.skillops-security-allowlist.json` when auditing the built-in catalog.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSkillDirectories, discoverSubagentFiles } from "./parser.js";

export const MAX_SCANNED_LINE_LENGTH = 4096;

export type SkillSecurityRuleId =
	| "forbidden-network-import"
	| "forbidden-dynamic-exec"
	| "forbidden-shell-execution"
	| "forbidden-trojan-unicode"
	| "forbidden-symlink"
	| "forbidden-binary-file"
	| "forbidden-path-traversal"
	| "suspicious-long-line";

export interface SkillSecurityFinding {
	readonly file: string;
	readonly line: number;
	readonly rule: SkillSecurityRuleId;
	readonly symbol: string;
	readonly message: string;
}

export interface SkillSecurityAuditReport {
	readonly targetDir: string;
	readonly passed: boolean;
	readonly scannedFiles: string[];
	readonly findings: SkillSecurityFinding[];
}

export interface SecurityAllowlistEntry {
	readonly relative_path: string;
	readonly rule: SkillSecurityRuleId;
	readonly sha256: string;
	readonly reason?: string;
}

export interface SecurityAllowlistFile {
	readonly version: string;
	readonly exceptions: readonly SecurityAllowlistEntry[];
}

export interface SecurityAuditOptions {
	readonly allowlistPath?: string;
	readonly allowOverrides?: boolean;
}

/**
 * Python root modules that are unconditionally forbidden because their sole purpose
 * is outbound network communication, raw sockets, or remote administration.
 */
const FORBIDDEN_PYTHON_NETWORK_ROOT_MODULES = new Set([
	"urllib2",
	"urllib3",
	"httplib",
	"socket",
	"socketserver",
	"requests",
	"httpx",
	"aiohttp",
	"ftplib",
	"smtplib",
	"telnetlib",
	"paramiko",
	"websocket",
	"websockets",
]);

/**
 * Dotted Python submodules that perform outbound network requests, kept distinct from
 * benign sibling submodules such as `urllib.parse`, `urllib.error`, or `http.server`.
 */
const FORBIDDEN_PYTHON_NETWORK_SUBMODULES = new Set([
	"urllib.request",
	"urllib.urlopen",
	"http.client",
	"xmlrpc.client",
]);

const FORBIDDEN_PYTHON_EXEC_MODULES = new Set([
	"pickle",
	"cPickle",
	"marshal",
	"shelve",
	"ctypes",
	"cffi",
	"importlib",
	"builtins",
]);

const FORBIDDEN_PYTHON_SHELL_MODULES = new Set(["pty", "commands"]);

const FORBIDDEN_PYTHON_OS_CALLS = new Set([
	"system",
	"popen",
	"spawnl",
	"spawnle",
	"spawnlp",
	"spawnlpe",
	"spawnv",
	"spawnve",
	"spawnvp",
	"spawnvpe",
	"posix_spawn",
	"posix_spawnp",
	"execl",
	"execle",
	"execlp",
	"execpe",
	"execlpe",
	"execv",
	"execve",
	"execvp",
	"execvpe",
]);

const FORBIDDEN_JS_SHELL_MODULES = new Set(["child_process"]);

const FORBIDDEN_JS_EXEC_MODULES = new Set(["vm", "worker_threads"]);

const FORBIDDEN_JS_NETWORK_MODULES = new Set([
	"net",
	"http",
	"https",
	"http2",
	"tls",
	"dgram",
	"dns",
	"undici",
]);

const GLOBAL_JS_OBJECTS = new Set(["globalThis", "global", "window", "self"]);

const SHELL_PIPE_INTERPRETERS = new Set([
	"sh",
	"bash",
	"zsh",
	"dash",
	"ksh",
	"python",
	"python2",
	"python3",
	"node",
	"perl",
	"ruby",
	"eval",
]);

const BASE64_PIPE_INTERPRETERS = new Set([
	"sh",
	"bash",
	"zsh",
	"dash",
	"ksh",
	"python",
	"python2",
	"python3",
	"node",
	"eval",
]);

const IGNORED_SCAN_DIRS = new Set([
	".git",
	"__pycache__",
	"node_modules",
	".pytest_cache",
	".ruff_cache",
	".mypy_cache",
]);

const IGNORED_SCAN_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/**
 * Opaque compiled binary and archive extensions forbidden inside curated Skill directories
 * because they cannot be audited line-by-line in GitHub Pull Request diffs.
 */
export const FORBIDDEN_BINARY_AND_ARCHIVE_EXTENSIONS = new Set([
	".exe",
	".dll",
	".so",
	".dylib",
	".bin",
	".wasm",
	".pyc",
	".pyo",
	".pyd",
	".msi",
	".scr",
	".com",
	".jar",
	".class",
	".zip",
	".tar",
	".gz",
	".tgz",
	".7z",
	".rar",
	".bz2",
	".xz",
]);

const NON_TEXT_MEDIA_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".ico",
	".bmp",
	".pdf",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".eot",
	".mp3",
	".mp4",
	".wav",
	".ogg",
	".webm",
]);

const KNOWN_TEXT_EXTENSIONS = new Set([
	".md",
	".mdc",
	".py",
	".sh",
	".mjs",
	".js",
	".cjs",
	".ts",
	".tsx",
	".json",
	".yaml",
	".yml",
	".toml",
	".txt",
	".ini",
	".cfg",
	".xml",
	".svg",
	".html",
	".css",
]);

const EXECUTABLE_SCRIPT_EXTENSIONS = new Set([
	".py",
	".sh",
	".mjs",
	".js",
	".cjs",
	".ts",
	".tsx",
]);

/**
 * Trojan-Source (CVE-2021-42574) bidirectional control characters, mid-file BOM (`U+FEFF`),
 * and LLM ASCII-smuggling Unicode Tag characters (`U+E0000..U+E007F`), forbidden across ALL UTF-8 text files.
 */
const TROJAN_BIDI_OR_TAG_REGEX =
	/[\u0000\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/u;

/**
 * Zero-width characters forbidden inside executable scripts (`.py`, `.sh`, `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`)
 * where they can spoof identifiers or hide payload boundaries.
 */
const SCRIPT_ZERO_WIDTH_REGEX = /[\u200B-\u200D\u2060-\u2064\uFEFF]/u;

function resolveBuiltinPackageRoot(): string {
	const moduleDir = path.dirname(fileURLToPath(import.meta.url));
	const parentOne = path.resolve(moduleDir, "..");
	if (fs.existsSync(path.join(parentOne, "package.json"))) {
		return parentOne;
	}
	return path.resolve(moduleDir, "..", "..");
}

function isPathInsideBuiltinCatalog(resolvedTarget: string): boolean {
	const pkgRoot = resolveBuiltinPackageRoot();
	const builtinCatalog = path.join(pkgRoot, "catalog");
	if (!fs.existsSync(builtinCatalog) || !fs.existsSync(resolvedTarget)) {
		return false;
	}
	try {
		const realBuiltin = fs.realpathSync(builtinCatalog);
		const realTarget = fs.realpathSync(resolvedTarget);
		if (realTarget === realBuiltin) {
			return true;
		}
		const rel = path.relative(realBuiltin, realTarget);
		return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
	} catch {
		return false;
	}
}

function loadBuiltinAllowlistEntries(
	resolvedTarget: string,
	options?: SecurityAuditOptions,
): SecurityAllowlistEntry[] {
	if (options?.allowOverrides === false) {
		return [];
	}
	if (!isPathInsideBuiltinCatalog(resolvedTarget)) {
		return [];
	}
	const pkgRoot = resolveBuiltinPackageRoot();
	const candidatePath = options?.allowlistPath
		? path.resolve(options.allowlistPath)
		: path.join(pkgRoot, ".skillops-security-allowlist.json");
	if (!fs.existsSync(candidatePath)) {
		return [];
	}
	try {
		const lstat = fs.lstatSync(candidatePath);
		if (lstat.isSymbolicLink() || !lstat.isFile()) {
			return [];
		}
		const raw = fs.readFileSync(candidatePath, "utf-8");
		const parsed = JSON.parse(raw) as {
			exceptions?: Array<{
				relative_path?: unknown;
				rule?: unknown;
				rule_id?: unknown;
				sha256?: unknown;
				reason?: unknown;
			}>;
		};
		if (!Array.isArray(parsed.exceptions)) {
			return [];
		}
		const entries: SecurityAllowlistEntry[] = [];
		for (const item of parsed.exceptions) {
			const relPath =
				typeof item?.relative_path === "string"
					? item.relative_path.replace(/\\/g, "/").replace(/^\/+/, "")
					: "";
			const ruleVal =
				typeof item?.rule === "string"
					? item.rule
					: typeof item?.rule_id === "string"
						? item.rule_id
						: "";
			const sha =
				typeof item?.sha256 === "string" ? item.sha256.toLowerCase() : "";
			if (relPath && ruleVal && /^[0-9a-f]{64}$/.test(sha)) {
				entries.push({
					relative_path: relPath,
					rule: ruleVal as SkillSecurityRuleId,
					sha256: sha,
					reason: typeof item?.reason === "string" ? item.reason : undefined,
				});
			}
		}
		return entries;
	} catch {
		return [];
	}
}

function isFindingCoveredByAllowlist(
	entries: readonly SecurityAllowlistEntry[],
	fullFilePath: string,
	rule: SkillSecurityRuleId,
	fileSha256: string,
): boolean {
	if (entries.length === 0) {
		return false;
	}
	const pkgRoot = resolveBuiltinPackageRoot();
	const builtinCatalog = path.join(pkgRoot, "catalog");
	const relToPkg = path.relative(pkgRoot, fullFilePath).replace(/\\/g, "/");
	const relToCatalog = path
		.relative(builtinCatalog, fullFilePath)
		.replace(/\\/g, "/");

	for (const entry of entries) {
		if (
			entry.rule === rule &&
			entry.sha256 === fileSha256 &&
			(entry.relative_path === relToPkg || entry.relative_path === relToCatalog)
		) {
			return true;
		}
	}
	return false;
}

function makeLongLineFinding(
	relFile: string,
	lineNo: number,
	actualLength: number,
): SkillSecurityFinding {
	return {
		file: relFile,
		line: lineNo,
		rule: "suspicious-long-line",
		symbol: `line>${MAX_SCANNED_LINE_LENGTH}`,
		message: `Line ${lineNo} in '${relFile}' exceeds maximum scanned line length (${actualLength} > ${MAX_SCANNED_LINE_LENGTH}).`,
	};
}

export function hasForbiddenBinaryExtension(filename: string): string | null {
	const lower = filename.toLowerCase();
	if (lower.endsWith(".tar.gz")) {
		return ".tar.gz";
	}
	const ext = path.extname(lower);
	if (FORBIDDEN_BINARY_AND_ARCHIVE_EXTENSIONS.has(ext)) {
		return ext;
	}
	return null;
}

/**
 * Scan raw text content for oversized lines (`MAX_SCANNED_LINE_LENGTH`), Trojan-Source
 * bidirectional overrides, LLM Unicode Tag smuggling, and (when `isExecutableScript` is true)
 * zero-width identifier spoofing characters.
 */
export function scanTextForTrojanUnicode(
	relFile: string,
	rawContent: string,
	isExecutableScript: boolean,
): SkillSecurityFinding[] {
	const findings: SkillSecurityFinding[] = [];
	// Strip a leading UTF-8 BOM at index 0 if present; mid-file BOM is still flagged
	const normalized = rawContent.startsWith("\uFEFF")
		? rawContent.slice(1)
		: rawContent;
	const lines = normalized.split(/\r?\n/);

	for (let idx = 0; idx < lines.length; idx++) {
		const line = lines[idx] ?? "";
		const lineNo = idx + 1;

		if (line.length > MAX_SCANNED_LINE_LENGTH) {
			findings.push(makeLongLineFinding(relFile, lineNo, line.length));
			continue;
		}

		const bidiMatch = TROJAN_BIDI_OR_TAG_REGEX.exec(line);
		if (bidiMatch?.[0]) {
			const cp = bidiMatch[0]
				.codePointAt(0)!
				.toString(16)
				.toUpperCase()
				.padStart(4, "0");
			findings.push({
				file: relFile,
				line: lineNo,
				rule: "forbidden-trojan-unicode",
				symbol: `U+${cp}`,
				message: `Forbidden Trojan-Source / invisible control character U+${cp} detected in '${relFile}'.`,
			});
			continue;
		}

		if (isExecutableScript) {
			const zwMatch = SCRIPT_ZERO_WIDTH_REGEX.exec(line);
			if (zwMatch?.[0]) {
				const cp = zwMatch[0]
					.codePointAt(0)!
					.toString(16)
					.toUpperCase()
					.padStart(4, "0");
				findings.push({
					file: relFile,
					line: lineNo,
					rule: "forbidden-trojan-unicode",
					symbol: `U+${cp}`,
					message: `Forbidden zero-width character U+${cp} detected in executable script '${relFile}'.`,
				});
			}
		}
	}

	return findings;
}

function classifyPythonModuleImport(
	modulePath: string,
	importedNames: readonly string[] = [],
): { rule: SkillSecurityRuleId; symbol: string; message: string } | null {
	const cleanPath = modulePath.trim();
	if (!cleanPath) return null;
	const parts = cleanPath.split(".");
	const rootMod = parts[0] ?? "";
	const firstTwo = parts.slice(0, 2).join(".");

	if (FORBIDDEN_PYTHON_NETWORK_ROOT_MODULES.has(rootMod)) {
		return {
			rule: "forbidden-network-import",
			symbol: rootMod,
			message: `Forbidden outbound network module '${rootMod}' imported in Skill script (violates zero-network policy).`,
		};
	}

	if (FORBIDDEN_PYTHON_NETWORK_SUBMODULES.has(firstTwo)) {
		return {
			rule: "forbidden-network-import",
			symbol: firstTwo,
			message: `Forbidden outbound network client '${firstTwo}' imported in Skill script (violates zero-network policy).`,
		};
	}

	if (rootMod === "urllib" && parts.length === 1) {
		for (const name of importedNames) {
			if (name === "request" || name === "urlopen") {
				return {
					rule: "forbidden-network-import",
					symbol: `urllib.${name}`,
					message: `Forbidden outbound network client 'urllib.${name}' imported in Skill script (violates zero-network policy).`,
				};
			}
		}
	}

	if (rootMod === "http" && parts.length === 1) {
		for (const name of importedNames) {
			if (name === "client") {
				return {
					rule: "forbidden-network-import",
					symbol: "http.client",
					message:
						"Forbidden outbound network client 'http.client' imported in Skill script (violates zero-network policy).",
				};
			}
		}
	}

	if (rootMod === "xmlrpc" && parts.length === 1) {
		for (const name of importedNames) {
			if (name === "client") {
				return {
					rule: "forbidden-network-import",
					symbol: "xmlrpc.client",
					message:
						"Forbidden outbound network client 'xmlrpc.client' imported in Skill script (violates zero-network policy).",
				};
			}
		}
	}

	if (rootMod === "os" && parts.length === 1) {
		for (const name of importedNames) {
			if (FORBIDDEN_PYTHON_OS_CALLS.has(name)) {
				return {
					rule: "forbidden-shell-execution",
					symbol: `os.${name}()`,
					message: `Forbidden shell execution function 'os.${name}()' imported in Skill script.`,
				};
			}
		}
	}

	if (FORBIDDEN_PYTHON_EXEC_MODULES.has(rootMod)) {
		return {
			rule: "forbidden-dynamic-exec",
			symbol: rootMod,
			message: `Forbidden dynamic execution / unsafe deserialization module '${rootMod}' imported in Skill script.`,
		};
	}

	if (FORBIDDEN_PYTHON_SHELL_MODULES.has(rootMod)) {
		return {
			rule: "forbidden-shell-execution",
			symbol: rootMod,
			message: `Forbidden terminal/shell module '${rootMod}' imported in Skill script.`,
		};
	}

	return null;
}

interface PyToken {
	readonly kind: "ident" | "string" | "punct" | "newline" | "other";
	readonly value: string;
	readonly line: number;
}

function isAsciiAlphaOrUnderscore(ch: string): boolean {
	const code = ch.charCodeAt(0);
	return (
		(code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95
	);
}

function isAsciiAlnumOrUnderscore(ch: string): boolean {
	const code = ch.charCodeAt(0);
	return (
		(code >= 48 && code <= 57) ||
		(code >= 65 && code <= 90) ||
		(code >= 97 && code <= 122) ||
		code === 95
	);
}

function isAsciiDigit(ch: string): boolean {
	const code = ch.charCodeAt(0);
	return code >= 48 && code <= 57;
}

const PYTHON_STRING_PREFIXES = new Set([
	"r",
	"u",
	"b",
	"f",
	"fr",
	"rf",
	"br",
	"rb",
]);

function tokenizePython(source: string): PyToken[] {
	const tokens: PyToken[] = [];
	const n = source.length;
	let i = 0;
	let line = 1;
	let parenDepth = 0;

	const consumePythonString = (startLine: number): void => {
		const next3 = source.slice(i, i + 3);
		if (next3 === '"""' || next3 === "'''") {
			const quote = next3;
			i += 3;
			while (i < n && source.slice(i, i + 3) !== quote) {
				if (source[i] === "\\") {
					i += 1;
					if (i < n) {
						if (source[i] === "\n") {
							line += 1;
						}
						i += 1;
					}
					continue;
				}
				if (source[i] === "\n") {
					line += 1;
				}
				i += 1;
			}
			if (i < n) {
				i += 3;
			}
			tokens.push({ kind: "string", value: '""', line: startLine });
			return;
		}

		const quote = source[i]!;
		i += 1;
		while (i < n && source[i] !== quote && source[i] !== "\n") {
			if (source[i] === "\\") {
				i += 1;
				if (i < n) {
					if (source[i] === "\n") {
						line += 1;
					}
					i += 1;
				}
				continue;
			}
			i += 1;
		}
		if (i < n && source[i] === quote) {
			i += 1;
		}
		tokens.push({ kind: "string", value: '""', line: startLine });
	};

	while (i < n) {
		const ch = source[i]!;

		if (ch === "\r") {
			i += 1;
			continue;
		}

		if (ch === "\n") {
			if (parenDepth === 0) {
				tokens.push({ kind: "newline", value: "\n", line });
			}
			line += 1;
			i += 1;
			continue;
		}

		// Explicit backslash line continuation (`\` followed by optional spaces/CR and `\n`)
		if (ch === "\\") {
			let lookahead = i + 1;
			while (
				lookahead < n &&
				(source[lookahead] === " " ||
					source[lookahead] === "\t" ||
					source[lookahead] === "\r")
			) {
				lookahead += 1;
			}
			if (lookahead < n && source[lookahead] === "\n") {
				line += 1;
				i = lookahead + 1;
				continue;
			}
			i += 1;
			continue;
		}

		if (ch === " " || ch === "\t" || ch === "\f" || ch === "\v") {
			i += 1;
			continue;
		}

		// Comment until end of physical line (`\` inside comment never continues the comment)
		if (ch === "#") {
			while (i < n && source[i] !== "\n") {
				i += 1;
			}
			continue;
		}

		if (ch === '"' || ch === "'") {
			consumePythonString(line);
			continue;
		}

		if (isAsciiAlphaOrUnderscore(ch)) {
			const start = i;
			const startLine = line;
			while (i < n && isAsciiAlnumOrUnderscore(source[i]!)) {
				i += 1;
			}
			const ident = source.slice(start, i);
			if (
				ident.length <= 2 &&
				PYTHON_STRING_PREFIXES.has(ident.toLowerCase()) &&
				i < n &&
				(source[i] === '"' || source[i] === "'")
			) {
				consumePythonString(startLine);
				continue;
			}
			tokens.push({ kind: "ident", value: ident, line: startLine });
			continue;
		}

		if (isAsciiDigit(ch)) {
			const startLine = line;
			while (
				i < n &&
				(isAsciiAlnumOrUnderscore(source[i]!) || source[i] === ".")
			) {
				i += 1;
			}
			tokens.push({ kind: "other", value: "0", line: startLine });
			continue;
		}

		if (ch === "(" || ch === "[" || ch === "{") {
			parenDepth += 1;
			tokens.push({ kind: "punct", value: ch, line });
			i += 1;
			continue;
		}

		if (ch === ")" || ch === "]" || ch === "}") {
			if (parenDepth > 0) {
				parenDepth -= 1;
			}
			tokens.push({ kind: "punct", value: ch, line });
			i += 1;
			continue;
		}

		if (
			ch === "." ||
			ch === "," ||
			ch === ";" ||
			ch === ":" ||
			ch === "=" ||
			ch === "*"
		) {
			// Distinguish `==` from assignment/keyword `=`
			if (ch === "=" && source[i + 1] === "=") {
				tokens.push({ kind: "punct", value: "==", line });
				i += 2;
				continue;
			}
			tokens.push({ kind: "punct", value: ch, line });
			i += 1;
			continue;
		}

		tokens.push({ kind: "other", value: ch, line });
		i += 1;
	}

	return tokens;
}

function readDottedPythonModule(
	tokens: readonly PyToken[],
	startIdx: number,
): { modulePath: string; nextIdx: number } {
	let idx = startIdx;
	// Skip leading relative import dots (`from ..pkg import foo`)
	while (
		idx < tokens.length &&
		tokens[idx]?.kind === "punct" &&
		tokens[idx]?.value === "."
	) {
		idx += 1;
	}
	const parts: string[] = [];
	while (idx < tokens.length && tokens[idx]?.kind === "ident") {
		parts.push(tokens[idx]!.value);
		idx += 1;
		if (
			idx < tokens.length &&
			tokens[idx]?.kind === "punct" &&
			tokens[idx]?.value === "."
		) {
			idx += 1;
		} else {
			break;
		}
	}
	return { modulePath: parts.join("."), nextIdx: idx };
}

function analyzePythonCompileArgs(
	tokens: readonly PyToken[],
	openParenIdx: number,
): { argCount: number; hasModeKwarg: boolean } {
	let depth = 1;
	let idx = openParenIdx + 1;
	const segments: PyToken[][] = [[]];

	while (idx < tokens.length && depth > 0) {
		const tok = tokens[idx]!;
		if (
			tok.kind === "punct" &&
			(tok.value === "(" || tok.value === "[" || tok.value === "{")
		) {
			depth += 1;
			segments[segments.length - 1]!.push(tok);
		} else if (
			tok.kind === "punct" &&
			(tok.value === ")" || tok.value === "]" || tok.value === "}")
		) {
			depth -= 1;
			if (depth === 0) {
				break;
			}
			segments[segments.length - 1]!.push(tok);
		} else if (depth === 1 && tok.kind === "punct" && tok.value === ",") {
			segments.push([]);
		} else if (tok.kind !== "newline") {
			segments[segments.length - 1]!.push(tok);
		}
		idx += 1;
	}

	const nonEmpty = segments.filter((seg) => seg.length > 0);
	let hasModeKwarg = false;
	for (const seg of nonEmpty) {
		if (
			seg[0]?.kind === "ident" &&
			seg[0].value === "mode" &&
			seg[1]?.kind === "punct" &&
			seg[1].value === "="
		) {
			hasModeKwarg = true;
		}
	}

	return { argCount: nonEmpty.length, hasModeKwarg };
}

export function scanPythonScriptContent(
	relFile: string,
	rawContent: string,
): SkillSecurityFinding[] {
	const findings: SkillSecurityFinding[] = [];
	const rawLines = rawContent.split(/\r?\n/);
	const sanitizedLines: string[] = [];

	// 1. Enforce MAX_SCANNED_LINE_LENGTH on physical lines and joined backslash-continued lines
	let logicalAccLength = 0;
	let logicalStartLine = 1;
	let inContinuation = false;

	for (let idx = 0; idx < rawLines.length; idx++) {
		const rawLine = rawLines[idx] ?? "";
		const lineNo = idx + 1;

		if (rawLine.length > MAX_SCANNED_LINE_LENGTH) {
			findings.push(makeLongLineFinding(relFile, lineNo, rawLine.length));
			sanitizedLines.push("");
			logicalAccLength = 0;
			inContinuation = false;
			continue;
		}

		const continuesNext =
			rawLine.endsWith("\\") && !rawLine.trimStart().startsWith("#");
		if (!inContinuation) {
			logicalStartLine = lineNo;
			logicalAccLength = rawLine.length;
		} else {
			logicalAccLength += rawLine.length;
		}

		if (logicalAccLength > MAX_SCANNED_LINE_LENGTH) {
			findings.push(
				makeLongLineFinding(relFile, logicalStartLine, logicalAccLength),
			);
			// Blank out the oversized continued block while preserving line count
			for (let back = logicalStartLine - 1; back < sanitizedLines.length; back++) {
				sanitizedLines[back] = "";
			}
			sanitizedLines.push("");
			if (!continuesNext) {
				logicalAccLength = 0;
				inContinuation = false;
			} else {
				inContinuation = true;
				logicalAccLength = 0;
			}
			continue;
		}

		sanitizedLines.push(rawLine);
		inContinuation = continuesNext;
		if (!continuesNext) {
			logicalAccLength = 0;
		}
	}

	const tokens = tokenizePython(sanitizedLines.join("\n"));

	for (let idx = 0; idx < tokens.length; idx++) {
		const tok = tokens[idx]!;
		const prev = idx > 0 ? tokens[idx - 1] : undefined;
		const isStmtStart =
			!prev ||
			prev.kind === "newline" ||
			(prev.kind === "punct" && (prev.value === ";" || prev.value === ":"));

		// 1. `from <module> import <symbols>`
		if (tok.kind === "ident" && tok.value === "from" && isStmtStart) {
			const { modulePath, nextIdx } = readDottedPythonModule(tokens, idx + 1);
			if (
				tokens[nextIdx]?.kind === "ident" &&
				tokens[nextIdx]?.value === "import"
			) {
				const importedSymbols: string[] = [];
				let scanIdx = nextIdx + 1;
				let paren = 0;
				let expectSymbol = true;
				while (scanIdx < tokens.length) {
					const cur = tokens[scanIdx]!;
					if (cur.kind === "newline" && paren === 0) break;
					if (cur.kind === "punct" && cur.value === ";" && paren === 0) break;
					if (cur.kind === "punct" && cur.value === "(") {
						paren += 1;
						scanIdx += 1;
						continue;
					}
					if (cur.kind === "punct" && cur.value === ")") {
						paren = Math.max(0, paren - 1);
						scanIdx += 1;
						continue;
					}
					if (cur.kind === "punct" && cur.value === ",") {
						expectSymbol = true;
						scanIdx += 1;
						continue;
					}
					if (cur.kind === "ident" && cur.value === "as") {
						expectSymbol = false;
						scanIdx += 2;
						continue;
					}
					if (expectSymbol && cur.kind === "ident") {
						importedSymbols.push(cur.value);
						expectSymbol = false;
					}
					scanIdx += 1;
				}

				const violation = classifyPythonModuleImport(
					modulePath,
					importedSymbols,
				);
				if (violation) {
					findings.push({
						file: relFile,
						line: tok.line,
						...violation,
					});
				}
				idx = scanIdx - 1;
				continue;
			}
		}

		// 2. `import <mod1>, <mod2> as alias`
		if (tok.kind === "ident" && tok.value === "import" && isStmtStart) {
			let scanIdx = idx + 1;
			while (scanIdx < tokens.length) {
				const cur = tokens[scanIdx]!;
				if (cur.kind === "newline") break;
				if (cur.kind === "punct" && cur.value === ";") break;
				if (cur.kind === "punct" && cur.value === ",") {
					scanIdx += 1;
					continue;
				}
				if (cur.kind === "ident") {
					const { modulePath, nextIdx } = readDottedPythonModule(
						tokens,
						scanIdx,
					);
					const violation = classifyPythonModuleImport(modulePath);
					if (violation) {
						findings.push({
							file: relFile,
							line: cur.line,
							...violation,
						});
					}
					scanIdx = nextIdx;
					if (
						tokens[scanIdx]?.kind === "ident" &&
						tokens[scanIdx]?.value === "as"
					) {
						scanIdx += 2;
					}
					continue;
				}
				scanIdx += 1;
			}
			idx = scanIdx - 1;
			continue;
		}

		// 3. Attribute network calls `urllib.request` / `urllib.urlopen`
		if (
			tok.kind === "ident" &&
			tok.value === "urllib" &&
			tokens[idx + 1]?.kind === "punct" &&
			tokens[idx + 1]?.value === "." &&
			tokens[idx + 2]?.kind === "ident" &&
			(tokens[idx + 2]?.value === "request" ||
				tokens[idx + 2]?.value === "urlopen")
		) {
			const alreadyReported = findings.some(
				(f) => f.line === tok.line && f.rule === "forbidden-network-import",
			);
			if (!alreadyReported) {
				findings.push({
					file: relFile,
					line: tok.line,
					rule: "forbidden-network-import",
					symbol: "urllib.request",
					message:
						"Forbidden outbound network call via 'urllib.request' in Skill script (violates zero-network policy).",
				});
			}
			continue;
		}

		// 4. Dynamic execution builtins: `eval()`, `exec()`, `__import__()`
		if (
			tok.kind === "ident" &&
			(tok.value === "eval" ||
				tok.value === "exec" ||
				tok.value === "__import__") &&
			tokens[idx + 1]?.kind === "punct" &&
			tokens[idx + 1]?.value === "("
		) {
			const isAttr = prev?.kind === "punct" && prev.value === ".";
			const isDef = prev?.kind === "ident" && prev.value === "def";
			if (!isAttr && !isDef) {
				findings.push({
					file: relFile,
					line: tok.line,
					rule: "forbidden-dynamic-exec",
					symbol: `${tok.value}()`,
					message: `Forbidden dynamic code execution call '${tok.value}()' in Skill script.`,
				});
			}
			continue;
		}

		// 5. 3-arg dynamic `compile(source, filename, mode)` (allows 1/2-arg `from re import compile`)
		if (
			tok.kind === "ident" &&
			tok.value === "compile" &&
			tokens[idx + 1]?.kind === "punct" &&
			tokens[idx + 1]?.value === "("
		) {
			const isAttr = prev?.kind === "punct" && prev.value === ".";
			const isDef = prev?.kind === "ident" && prev.value === "def";
			if (!isAttr && !isDef) {
				const { argCount, hasModeKwarg } = analyzePythonCompileArgs(
					tokens,
					idx + 1,
				);
				if (argCount >= 3 || hasModeKwarg) {
					findings.push({
						file: relFile,
						line: tok.line,
						rule: "forbidden-dynamic-exec",
						symbol: "compile()",
						message:
							"Forbidden dynamic code compilation 'compile()' in Skill script.",
					});
				}
			}
			continue;
		}

		// 6. `getattr(__builtins__, ...)` / `getattr(builtins, ...)`
		if (
			tok.kind === "ident" &&
			tok.value === "getattr" &&
			tokens[idx + 1]?.kind === "punct" &&
			tokens[idx + 1]?.value === "("
		) {
			const isAttr = prev?.kind === "punct" && prev.value === ".";
			const isDef = prev?.kind === "ident" && prev.value === "def";
			const targetArg = tokens[idx + 2];
			if (
				!isAttr &&
				!isDef &&
				targetArg?.kind === "ident" &&
				(targetArg.value === "__builtins__" || targetArg.value === "builtins")
			) {
				findings.push({
					file: relFile,
					line: tok.line,
					rule: "forbidden-dynamic-exec",
					symbol: `getattr(${targetArg.value})`,
					message: `Forbidden dynamic builtins lookup 'getattr(${targetArg.value}, ...)' in Skill script.`,
				});
			}
			continue;
		}

		// Direct `__builtins__[...]` or `__builtins__.<attr>` access
		if (
			tok.kind === "ident" &&
			tok.value === "__builtins__" &&
			tokens[idx + 1]?.kind === "punct" &&
			(tokens[idx + 1]?.value === "[" || tokens[idx + 1]?.value === ".")
		) {
			findings.push({
				file: relFile,
				line: tok.line,
				rule: "forbidden-dynamic-exec",
				symbol: "__builtins__",
				message:
					"Forbidden direct '__builtins__' dictionary access in Skill script.",
			});
			continue;
		}

		// 7. Unsafe OS shell calls: `os.system()`, `os.popen()`, `os.spawn*()`, `os.exec*()`
		if (
			tok.kind === "ident" &&
			tok.value === "os" &&
			tokens[idx + 1]?.kind === "punct" &&
			tokens[idx + 1]?.value === "." &&
			tokens[idx + 2]?.kind === "ident" &&
			FORBIDDEN_PYTHON_OS_CALLS.has(tokens[idx + 2]!.value) &&
			tokens[idx + 3]?.kind === "punct" &&
			tokens[idx + 3]?.value === "("
		) {
			const fnName = tokens[idx + 2]!.value;
			findings.push({
				file: relFile,
				line: tok.line,
				rule: "forbidden-shell-execution",
				symbol: `os.${fnName}()`,
				message: `Forbidden shell execution call 'os.${fnName}()' in Skill script.`,
			});
			continue;
		}

		// 8. `shell=True` keyword argument
		if (
			tok.kind === "ident" &&
			tok.value === "shell" &&
			tokens[idx + 1]?.kind === "punct" &&
			tokens[idx + 1]?.value === "=" &&
			tokens[idx + 2]?.kind === "ident" &&
			tokens[idx + 2]?.value === "True"
		) {
			findings.push({
				file: relFile,
				line: tok.line,
				rule: "forbidden-shell-execution",
				symbol: "shell=True",
				message:
					"Forbidden 'shell=True' in subprocess invocation; pass argument arrays with shell=False.",
			});
		}
	}

	return findings;
}

interface JsToken {
	readonly kind: "ident" | "string" | "punct";
	readonly value: string;
	readonly line: number;
}

const JS_REGEX_PRECEDING_PUNCT = new Set([
	"(",
	"[",
	"{",
	"}",
	";",
	",",
	":",
	"=",
	"==",
	"===",
	"!=",
	"!==",
	"!",
	"&",
	"&&",
	"|",
	"||",
	"??",
	"?",
	"~",
	"^",
	"+",
	"-",
	"*",
	"%",
	"<",
	">",
	"<=",
	">=",
	"=>",
]);

const JS_REGEX_PRECEDING_KEYWORDS = new Set([
	"return",
	"throw",
	"case",
	"typeof",
	"void",
	"delete",
	"in",
	"of",
	"instanceof",
	"new",
	"await",
	"yield",
	"do",
	"else",
]);

const JS_METHOD_MODIFIERS = new Set([
	"async",
	"static",
	"public",
	"private",
	"protected",
	"readonly",
	"override",
	"get",
	"set",
]);

const JS_EXPR_FORCING_OPERATORS = new Set([
	"=",
	"==",
	"===",
	"!=",
	"!==",
	"(",
	"[",
	":",
	"=>",
	"!",
	"&&",
	"||",
	"?",
	"??",
	"+",
	"-",
	"*",
	"/",
	"%",
	".",
	"?.",
]);

const JS_EXPR_FORCING_KEYWORDS = new Set([
	"return",
	"throw",
	"await",
	"new",
	"typeof",
	"void",
	"delete",
	"yield",
	"case",
]);

function isJsIdentStart(ch: string): boolean {
	return isAsciiAlphaOrUnderscore(ch) || ch === "$";
}

function isJsIdentPart(ch: string): boolean {
	return isAsciiAlnumOrUnderscore(ch) || ch === "$";
}

function canStartJsRegexLiteral(prev: JsToken | undefined): boolean {
	if (!prev) return true;
	if (prev.kind === "punct") {
		return JS_REGEX_PRECEDING_PUNCT.has(prev.value);
	}
	if (prev.kind === "ident") {
		return JS_REGEX_PRECEDING_KEYWORDS.has(prev.value);
	}
	return false;
}

function tokenizeJsOrTs(source: string): JsToken[] {
	const tokens: JsToken[] = [];
	const n = source.length;
	let i = 0;
	let line = 1;
	let braceDepth = 0;
	const templateResumeBraceStack: number[] = [];

	const scanTemplateSegment = (): void => {
		const startLine = line;
		let textVal = "";
		while (i < n) {
			const ch = source[i]!;
			if (ch === "\\") {
				i += 1;
				if (i < n) {
					if (source[i] === "\n") {
						line += 1;
					}
					textVal += source[i]!;
					i += 1;
				}
				continue;
			}
			if (ch === "`") {
				i += 1;
				tokens.push({ kind: "string", value: textVal, line: startLine });
				return;
			}
			if (ch === "$" && source[i + 1] === "{") {
				tokens.push({ kind: "string", value: textVal, line: startLine });
				tokens.push({ kind: "punct", value: "+", line });
				tokens.push({ kind: "punct", value: "(", line });
				templateResumeBraceStack.push(braceDepth);
				i += 2;
				return;
			}
			if (ch === "\n") {
				line += 1;
			}
			textVal += ch;
			i += 1;
		}
		tokens.push({ kind: "string", value: textVal, line: startLine });
	};

	while (i < n) {
		const ch = source[i]!;
		const next2 = source.slice(i, i + 2);

		if (ch === "\r") {
			i += 1;
			continue;
		}

		if (ch === "\n") {
			line += 1;
			i += 1;
			continue;
		}

		if (ch === " " || ch === "\t" || ch === "\f" || ch === "\v") {
			i += 1;
			continue;
		}

		// Single-line comment
		if (next2 === "//") {
			while (i < n && source[i] !== "\n") {
				i += 1;
			}
			continue;
		}

		// Multi-line comment
		if (next2 === "/*") {
			i += 2;
			while (i < n && source.slice(i, i + 2) !== "*/") {
				if (source[i] === "\n") {
					line += 1;
				}
				i += 1;
			}
			if (i < n) {
				i += 2;
			}
			continue;
		}

		// Single or double quoted string
		if (ch === "'" || ch === '"') {
			const quote = ch;
			const startLine = line;
			let val = "";
			i += 1;
			while (i < n && source[i] !== quote && source[i] !== "\n") {
				if (source[i] === "\\") {
					i += 1;
					if (i < n) {
						if (source[i] === "\n") {
							line += 1;
						}
						val += source[i]!;
						i += 1;
					}
					continue;
				}
				val += source[i]!;
				i += 1;
			}
			if (i < n && source[i] === quote) {
				i += 1;
			}
			tokens.push({ kind: "string", value: val, line: startLine });
			continue;
		}

		// Template literal
		if (ch === "`") {
			i += 1;
			scanTemplateSegment();
			continue;
		}

		// Closing brace of `${ ... }` template expression
		if (
			ch === "}" &&
			templateResumeBraceStack.length > 0 &&
			templateResumeBraceStack[templateResumeBraceStack.length - 1] ===
				braceDepth
		) {
			templateResumeBraceStack.pop();
			tokens.push({ kind: "punct", value: ")", line });
			tokens.push({ kind: "punct", value: "+", line });
			i += 1;
			scanTemplateSegment();
			continue;
		}

		// Regex literal `/.../`
		if (
			ch === "/" &&
			next2 !== "//" &&
			next2 !== "/*" &&
			canStartJsRegexLiteral(tokens[tokens.length - 1])
		) {
			const startLine = line;
			let scan = i + 1;
			let inClass = false;
			let closed = false;
			while (scan < n && source[scan] !== "\n") {
				const rc = source[scan]!;
				if (rc === "\\") {
					scan += 2;
					continue;
				}
				if (rc === "[") {
					inClass = true;
				} else if (rc === "]") {
					inClass = false;
				} else if (rc === "/" && !inClass) {
					closed = true;
					scan += 1;
					while (scan < n && isAsciiAlphaOrUnderscore(source[scan]!)) {
						scan += 1;
					}
					break;
				}
				scan += 1;
			}
			if (closed) {
				tokens.push({ kind: "punct", value: "/regex/", line: startLine });
				i = scan;
				continue;
			}
		}

		// Identifier or keyword
		if (isJsIdentStart(ch)) {
			const start = i;
			const startLine = line;
			while (i < n && isJsIdentPart(source[i]!)) {
				i += 1;
			}
			tokens.push({
				kind: "ident",
				value: source.slice(start, i),
				line: startLine,
			});
			continue;
		}

		// Numeric literal
		if (isAsciiDigit(ch)) {
			const startLine = line;
			while (i < n && (isJsIdentPart(source[i]!) || source[i] === ".")) {
				i += 1;
			}
			tokens.push({ kind: "punct", value: "0", line: startLine });
			continue;
		}

		// Multi-character operators
		const next3 = source.slice(i, i + 3);
		if (next3 === "===" || next3 === "!==") {
			tokens.push({ kind: "punct", value: next3, line });
			i += 3;
			continue;
		}
		if (
			next2 === "=>" ||
			next2 === "==" ||
			next2 === "!=" ||
			next2 === "<=" ||
			next2 === ">=" ||
			next2 === "&&" ||
			next2 === "||" ||
			next2 === "??" ||
			next2 === "?."
		) {
			tokens.push({ kind: "punct", value: next2, line });
			i += 2;
			continue;
		}

		if (ch === "{") {
			braceDepth += 1;
		} else if (ch === "}" && braceDepth > 0) {
			braceDepth -= 1;
		}

		tokens.push({ kind: "punct", value: ch, line });
		i += 1;
	}

	return tokens;
}

function classifyJsModuleSpecifier(
	rawSpec: string,
): { rule: SkillSecurityRuleId; symbol: string; message: string } | null {
	const trimmed = rawSpec.trim();
	if (!trimmed) return null;
	const withoutNodePrefix = trimmed.startsWith("node:")
		? trimmed.slice(5)
		: trimmed;
	const rootMod = withoutNodePrefix.split("/")[0] ?? "";

	if (FORBIDDEN_JS_SHELL_MODULES.has(rootMod)) {
		return {
			rule: "forbidden-shell-execution",
			symbol: rootMod,
			message: `Forbidden Node.js child process module '${trimmed}' imported in Skill script.`,
		};
	}

	if (FORBIDDEN_JS_EXEC_MODULES.has(rootMod)) {
		return {
			rule: "forbidden-dynamic-exec",
			symbol: rootMod,
			message: `Forbidden Node.js execution/worker module '${trimmed}' imported in Skill script.`,
		};
	}

	if (FORBIDDEN_JS_NETWORK_MODULES.has(rootMod)) {
		return {
			rule: "forbidden-network-import",
			symbol: rootMod,
			message: `Forbidden outbound network module '${trimmed}' imported in Skill script (violates zero-network policy).`,
		};
	}

	return null;
}

function getCallOpenParenIndex(
	tokens: readonly JsToken[],
	identIdx: number,
): number {
	const next = tokens[identIdx + 1];
	if (next?.kind === "punct" && next.value === "(") {
		return identIdx + 1;
	}
	if (
		next?.kind === "punct" &&
		next.value === "?." &&
		tokens[identIdx + 2]?.kind === "punct" &&
		tokens[identIdx + 2]?.value === "("
	) {
		return identIdx + 2;
	}
	return -1;
}

function findMatchingCloseParen(
	tokens: readonly JsToken[],
	openParenIdx: number,
): number {
	let depth = 1;
	for (let i = openParenIdx + 1; i < tokens.length; i++) {
		const tok = tokens[i]!;
		if (tok.kind === "punct" && tok.value === "(") {
			depth += 1;
		} else if (tok.kind === "punct" && tok.value === ")") {
			depth -= 1;
			if (depth === 0) {
				return i;
			}
		}
	}
	return -1;
}

function isJsMethodOrFunctionDeclaration(
	tokens: readonly JsToken[],
	identIdx: number,
): boolean {
	const prev = tokens[identIdx - 1];
	if (prev?.kind === "ident" && prev.value === "function") {
		return true;
	}
	if (
		prev?.kind === "punct" &&
		prev.value === "*" &&
		tokens[identIdx - 2]?.kind === "ident" &&
		tokens[identIdx - 2]?.value === "function"
	) {
		return true;
	}

	// Check preceding modifiers (`async eval(...) {`, `public async eval(...) {`)
	let prefixIdx = identIdx - 1;
	while (
		prefixIdx >= 0 &&
		tokens[prefixIdx]?.kind === "ident" &&
		JS_METHOD_MODIFIERS.has(tokens[prefixIdx]!.value)
	) {
		prefixIdx -= 1;
	}
	const beforePrefix = prefixIdx >= 0 ? tokens[prefixIdx] : undefined;
	if (beforePrefix?.kind === "ident" && beforePrefix.value === "function") {
		return true;
	}
	if (
		beforePrefix?.kind === "punct" &&
		JS_EXPR_FORCING_OPERATORS.has(beforePrefix.value)
	) {
		return false;
	}
	if (
		beforePrefix?.kind === "ident" &&
		JS_EXPR_FORCING_KEYWORDS.has(beforePrefix.value)
	) {
		return false;
	}

	const openParenIdx =
		tokens[identIdx + 1]?.kind === "punct" && tokens[identIdx + 1]?.value === "("
			? identIdx + 1
			: -1;
	if (openParenIdx === -1) {
		return false;
	}
	const closeParenIdx = findMatchingCloseParen(tokens, openParenIdx);
	if (closeParenIdx === -1) {
		return false;
	}

	const afterParen = tokens[closeParenIdx + 1];
	if (afterParen?.kind === "punct" && afterParen.value === "{") {
		return true;
	}

	// Optional TypeScript return type annotation `: ReturnType {`
	if (afterParen?.kind === "punct" && afterParen.value === ":") {
		let angleDepth = 0;
		let parenDepth = 0;
		for (let k = closeParenIdx + 2; k < tokens.length; k++) {
			const t = tokens[k]!;
			if (t.kind === "punct") {
				if (t.value === "<") angleDepth += 1;
				else if (t.value === ">" && angleDepth > 0) angleDepth -= 1;
				else if (t.value === "(") parenDepth += 1;
				else if (t.value === ")" && parenDepth > 0) parenDepth -= 1;
				else if (angleDepth === 0 && parenDepth === 0) {
					if (t.value === "{") return true;
					if (t.value === ";" || t.value === "=" || t.value === ",") {
						return false;
					}
				}
			}
		}
	}

	return false;
}

function isGlobalOrBareMemberAccess(
	tokens: readonly JsToken[],
	identIdx: number,
): boolean {
	const prev = tokens[identIdx - 1];
	if (!prev || prev.kind !== "punct") {
		return true;
	}
	if (prev.value !== "." && prev.value !== "?.") {
		return true;
	}
	const receiver = tokens[identIdx - 2];
	return (
		receiver?.kind === "ident" && GLOBAL_JS_OBJECTS.has(receiver.value)
	);
}

export function scanJsOrTsScriptContent(
	relFile: string,
	rawContent: string,
): SkillSecurityFinding[] {
	const findings: SkillSecurityFinding[] = [];
	const rawLines = rawContent.split(/\r?\n/);
	const sanitizedLines: string[] = [];

	for (let idx = 0; idx < rawLines.length; idx++) {
		const rawLine = rawLines[idx] ?? "";
		if (rawLine.length > MAX_SCANNED_LINE_LENGTH) {
			findings.push(makeLongLineFinding(relFile, idx + 1, rawLine.length));
			sanitizedLines.push("");
		} else {
			sanitizedLines.push(rawLine);
		}
	}

	const tokens = tokenizeJsOrTs(sanitizedLines.join("\n"));

	for (let idx = 0; idx < tokens.length; idx++) {
		const tok = tokens[idx]!;
		const prev = idx > 0 ? tokens[idx - 1] : undefined;

		// 1. Static ESM `import "spec"` or `import/export ... from "spec"`
		if (
			tok.kind === "ident" &&
			(tok.value === "import" || tok.value === "from") &&
			tokens[idx + 1]?.kind === "string"
		) {
			const specTok = tokens[idx + 1]!;
			const violation = classifyJsModuleSpecifier(specTok.value);
			if (violation) {
				findings.push({
					file: relFile,
					line: specTok.line,
					...violation,
				});
			}
			continue;
		}

		// 2. Dynamic `import(...)`
		if (tok.kind === "ident" && tok.value === "import") {
			const openParenIdx = getCallOpenParenIndex(tokens, idx);
			const isMember =
				prev?.kind === "punct" && (prev.value === "." || prev.value === "?.");
			if (
				openParenIdx !== -1 &&
				!isMember &&
				!isJsMethodOrFunctionDeclaration(tokens, idx)
			) {
				const argTok = tokens[openParenIdx + 1];
				if (argTok?.kind === "string") {
					const modViolation = classifyJsModuleSpecifier(argTok.value);
					if (modViolation) {
						findings.push({
							file: relFile,
							line: tok.line,
							...modViolation,
						});
					}
				}
				findings.push({
					file: relFile,
					line: tok.line,
					rule: "forbidden-dynamic-exec",
					symbol: "import()",
					message: "Forbidden dynamic 'import()' expression in Skill script.",
				});
				continue;
			}
		}

		// 3. CommonJS `require("spec")` and `createRequire(...)`
		if (tok.kind === "ident" && tok.value === "require") {
			const openParenIdx = getCallOpenParenIndex(tokens, idx);
			if (
				openParenIdx !== -1 &&
				!isJsMethodOrFunctionDeclaration(tokens, idx)
			) {
				const argTok = tokens[openParenIdx + 1];
				if (argTok?.kind === "string") {
					const violation = classifyJsModuleSpecifier(argTok.value);
					if (violation) {
						findings.push({
							file: relFile,
							line: tok.line,
							...violation,
						});
					}
				}
				continue;
			}
		}

		if (tok.kind === "ident" && tok.value === "createRequire") {
			const openParenIdx = getCallOpenParenIndex(tokens, idx);
			if (
				openParenIdx !== -1 &&
				!isJsMethodOrFunctionDeclaration(tokens, idx)
			) {
				findings.push({
					file: relFile,
					line: tok.line,
					rule: "forbidden-dynamic-exec",
					symbol: "createRequire()",
					message:
						"Forbidden dynamic CommonJS loader 'createRequire()' in Skill script.",
				});
				continue;
			}
		}

		// 4. Global `fetch(...)`
		if (tok.kind === "ident" && tok.value === "fetch") {
			const openParenIdx = getCallOpenParenIndex(tokens, idx);
			if (
				openParenIdx !== -1 &&
				isGlobalOrBareMemberAccess(tokens, idx) &&
				!isJsMethodOrFunctionDeclaration(tokens, idx)
			) {
				findings.push({
					file: relFile,
					line: tok.line,
					rule: "forbidden-network-import",
					symbol: "fetch()",
					message:
						"Forbidden outbound network call 'fetch()' in Skill script (violates zero-network policy).",
				});
				continue;
			}
		}

		// 5. `new WebSocket(...)` or `new globalThis.WebSocket(...)`
		if (tok.kind === "ident" && tok.value === "new") {
			const next1 = tokens[idx + 1];
			const isDirectWs = next1?.kind === "ident" && next1.value === "WebSocket";
			const isGlobalWs =
				next1?.kind === "ident" &&
				GLOBAL_JS_OBJECTS.has(next1.value) &&
				tokens[idx + 2]?.kind === "punct" &&
				(tokens[idx + 2]?.value === "." || tokens[idx + 2]?.value === "?.") &&
				tokens[idx + 3]?.kind === "ident" &&
				tokens[idx + 3]?.value === "WebSocket";
			if (isDirectWs || isGlobalWs) {
				findings.push({
					file: relFile,
					line: tok.line,
					rule: "forbidden-network-import",
					symbol: "WebSocket",
					message:
						"Forbidden outbound WebSocket client 'new WebSocket()' in Skill script (violates zero-network policy).",
				});
				continue;
			}
		}

		// 6. `eval(...)` and `Function(...)` (including indirect `(0, eval)(...)`)
		if (
			tok.kind === "ident" &&
			(tok.value === "eval" || tok.value === "Function")
		) {
			const openParenIdx = getCallOpenParenIndex(tokens, idx);
			const isIndirectEval =
				tok.value === "eval" &&
				prev?.kind === "punct" &&
				prev.value === "," &&
				tokens[idx + 1]?.kind === "punct" &&
				tokens[idx + 1]?.value === ")" &&
				tokens[idx + 2]?.kind === "punct" &&
				tokens[idx + 2]?.value === "(";
			if (
				(openParenIdx !== -1 || isIndirectEval) &&
				isGlobalOrBareMemberAccess(tokens, idx) &&
				!isJsMethodOrFunctionDeclaration(tokens, idx)
			) {
				findings.push({
					file: relFile,
					line: tok.line,
					rule: "forbidden-dynamic-exec",
					symbol: `${tok.value}()`,
					message: `Forbidden dynamic code execution '${tok.value}()' in Skill script.`,
				});
				continue;
			}
		}

		// 7. `process.binding(...)` and `process.dlopen(...)`
		if (
			tok.kind === "ident" &&
			tok.value === "process" &&
			tokens[idx + 1]?.kind === "punct" &&
			(tokens[idx + 1]?.value === "." || tokens[idx + 1]?.value === "?.") &&
			tokens[idx + 2]?.kind === "ident" &&
			(tokens[idx + 2]?.value === "binding" ||
				tokens[idx + 2]?.value === "dlopen") &&
			getCallOpenParenIndex(tokens, idx + 2) !== -1
		) {
			const method = tokens[idx + 2]!.value;
			findings.push({
				file: relFile,
				line: tok.line,
				rule: "forbidden-dynamic-exec",
				symbol: `process.${method}()`,
				message: `Forbidden native Node.js bridge 'process.${method}()' in Skill script.`,
			});
		}
	}

	return findings;
}

function stripShellInlineComment(line: string): string {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i]!;
		if (ch === "\\" && !inSingle) {
			i += 1;
			continue;
		}
		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
			continue;
		}
		if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
			continue;
		}
		if (
			ch === "#" &&
			!inSingle &&
			!inDouble &&
			(i === 0 || line[i - 1] === " " || line[i - 1] === "\t")
		) {
			return line.slice(0, i);
		}
	}
	return line;
}

function splitWhitespaceTokens(segment: string): string[] {
	const out: string[] = [];
	let start = -1;
	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i]!;
		const isWs = ch === " " || ch === "\t" || ch === "\r";
		if (!isWs && start === -1) {
			start = i;
		} else if (isWs && start !== -1) {
			out.push(segment.slice(start, i));
			start = -1;
		}
	}
	if (start !== -1) {
		out.push(segment.slice(start));
	}
	return out;
}

function extractLeadingShellCommand(segment: string): string {
	const tokens = splitWhitespaceTokens(segment);
	for (const tok of tokens) {
		if (tok === "sudo" || tok === "env") {
			continue;
		}
		// Skip inline KEY=VAL assignments after `env` or at start of command
		if (tok.includes("=") && !tok.startsWith("-")) {
			continue;
		}
		if (tok.startsWith("-")) {
			continue;
		}
		return tok;
	}
	return "";
}

export function scanShellScriptContent(
	relFile: string,
	rawContent: string,
): SkillSecurityFinding[] {
	const findings: SkillSecurityFinding[] = [];
	const lines = rawContent.split(/\r?\n/);

	for (let idx = 0; idx < lines.length; idx++) {
		const rawLine = lines[idx] ?? "";
		const lineNo = idx + 1;

		if (rawLine.length > MAX_SCANNED_LINE_LENGTH) {
			findings.push(makeLongLineFinding(relFile, lineNo, rawLine.length));
			continue;
		}

		const uncommented = stripShellInlineComment(rawLine).trim();
		if (!uncommented) {
			continue;
		}

		// Split pipeline segments (`|` but not `||`) in O(n) time
		const pipeSegments: string[] = [];
		let segStart = 0;
		for (let i = 0; i < uncommented.length; i++) {
			if (uncommented[i] === "|") {
				if (uncommented[i + 1] === "|") {
					i += 1;
					continue;
				}
				pipeSegments.push(uncommented.slice(segStart, i));
				segStart = i + 1;
			}
		}
		pipeSegments.push(uncommented.slice(segStart));

		for (let p = 0; p + 1 < pipeSegments.length; p++) {
			const left = pipeSegments[p]!;
			const right = pipeSegments[p + 1]!;
			const leftTokens = splitWhitespaceTokens(left);
			const rightCmd = extractLeadingShellCommand(right);
			const rightCmdLower = rightCmd.toLowerCase();

			// 1. Remote download piped directly into an interpreter (`curl ... | sh`)
			const downloader = leftTokens.find((t) => t === "curl" || t === "wget");
			if (downloader && SHELL_PIPE_INTERPRETERS.has(rightCmd)) {
				findings.push({
					file: relFile,
					line: lineNo,
					rule: "forbidden-network-import",
					symbol: `${downloader} | ${rightCmd}`,
					message: `Forbidden remote pipe execution '${downloader} | ${rightCmd}' in Skill shell script.`,
				});
			}

			// 2. PowerShell download cradle (`Invoke-WebRequest / iwr ... | iex`)
			const psDownloader = leftTokens.find((t) => {
				const low = t.toLowerCase();
				return (
					low === "invoke-webrequest" ||
					low === "invoke-restmethod" ||
					low === "iwr" ||
					low === "irm"
				);
			});
			if (
				psDownloader &&
				(rightCmdLower === "iex" || rightCmdLower === "invoke-expression")
			) {
				findings.push({
					file: relFile,
					line: lineNo,
					rule: "forbidden-network-import",
					symbol: psDownloader,
					message: `Forbidden remote PowerShell execution cradle '${psDownloader}' in Skill script.`,
				});
			}

			// 3. Obfuscated base64 decode piped into shell or eval
			const hasBase64 = leftTokens.includes("base64");
			const hasDecodeFlag =
				leftTokens.includes("-d") || leftTokens.includes("--decode");
			if (hasBase64 && hasDecodeFlag && BASE64_PIPE_INTERPRETERS.has(rightCmd)) {
				findings.push({
					file: relFile,
					line: lineNo,
					rule: "forbidden-dynamic-exec",
					symbol: "base64 -d | sh",
					message:
						"Forbidden obfuscated base64 pipe execution in Skill shell script.",
				});
			}
		}

		// 4. Reverse shell primitives (`/dev/tcp/`, `/dev/udp/`, `nc ... -e/-c/-l`)
		const devSockMatch = /\/dev\/(?:tcp|udp)\//.exec(uncommented);
		if (devSockMatch?.[0]) {
			findings.push({
				file: relFile,
				line: lineNo,
				rule: "forbidden-shell-execution",
				symbol: devSockMatch[0],
				message:
					"Forbidden reverse-shell primitive detected in Skill shell script.",
			});
		} else {
			// Check each command separated by `;` or pipeline for `nc`/`ncat`/`netcat` with `-e`/`-c`/`-l`
			for (const pipeSeg of pipeSegments) {
				for (const subCmd of pipeSeg.split(";")) {
					const cmdTokens = splitWhitespaceTokens(subCmd);
					const ncIdx = cmdTokens.findIndex(
						(t) => t === "nc" || t === "ncat" || t === "netcat",
					);
					if (ncIdx !== -1) {
						const hasExecOrListenFlag = cmdTokens
							.slice(ncIdx + 1)
							.some((t) => t === "-e" || t === "-c" || t === "-l");
						if (hasExecOrListenFlag) {
							findings.push({
								file: relFile,
								line: lineNo,
								rule: "forbidden-shell-execution",
								symbol: cmdTokens[ncIdx]!,
								message:
									"Forbidden reverse-shell primitive detected in Skill shell script.",
							});
							break;
						}
					}
				}
			}
		}
	}

	return findings;
}

interface WalkedSecurityTree {
	readonly candidateTextFiles: string[];
	readonly structuralFindings: SkillSecurityFinding[];
}

function walkSkillSecurityTree(
	rootDir: string,
	currentDir: string = rootDir,
): WalkedSecurityTree {
	if (!fs.existsSync(currentDir)) {
		return { candidateTextFiles: [], structuralFindings: [] };
	}

	const rootStat = fs.lstatSync(currentDir);
	if (rootStat.isSymbolicLink()) {
		const rel =
			path.relative(rootDir, currentDir).replace(/\\/g, "/") || ".";
		return {
			candidateTextFiles: [],
			structuralFindings: [
				{
					file: rel,
					line: 1,
					rule: "forbidden-symlink",
					symbol: "symlink",
					message: `Forbidden symbolic link '${rel}' inside Skill directory.`,
				},
			],
		};
	}

	if (!rootStat.isDirectory()) {
		return { candidateTextFiles: [], structuralFindings: [] };
	}

	const candidateTextFiles: string[] = [];
	const structuralFindings: SkillSecurityFinding[] = [];
	const entries = fs.readdirSync(currentDir, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(currentDir, entry.name);
		const relFile = path.relative(rootDir, fullPath).replace(/\\/g, "/");
		const entryLstat = fs.lstatSync(fullPath);

		if (entry.isSymbolicLink() || entryLstat.isSymbolicLink()) {
			structuralFindings.push({
				file: relFile,
				line: 1,
				rule: "forbidden-symlink",
				symbol: "symlink",
				message: `Forbidden symbolic link '${relFile}' inside Skill directory.`,
			});
			continue;
		}

		if (entryLstat.isDirectory()) {
			if (IGNORED_SCAN_DIRS.has(entry.name)) {
				continue;
			}
			const child = walkSkillSecurityTree(rootDir, fullPath);
			candidateTextFiles.push(...child.candidateTextFiles);
			structuralFindings.push(...child.structuralFindings);
			continue;
		}

		if (entryLstat.isFile()) {
			if (IGNORED_SCAN_FILES.has(entry.name)) {
				continue;
			}

			const forbiddenExt = hasForbiddenBinaryExtension(entry.name);
			if (forbiddenExt) {
				structuralFindings.push({
					file: relFile,
					line: 1,
					rule: "forbidden-binary-file",
					symbol: forbiddenExt,
					message: `Forbidden binary or archive file '${relFile}' (${forbiddenExt}) inside Skill directory.`,
				});
				continue;
			}

			const ext = path.extname(entry.name).toLowerCase();
			if (NON_TEXT_MEDIA_EXTENSIONS.has(ext)) {
				continue;
			}

			candidateTextFiles.push(fullPath);
		}
	}

	return {
		candidateTextFiles: candidateTextFiles.sort(),
		structuralFindings,
	};
}

function decodeUtf8TextIfApplicable(
	rawBuffer: Buffer,
	ext: string,
): string | null {
	if (KNOWN_TEXT_EXTENSIONS.has(ext) || EXECUTABLE_SCRIPT_EXTENSIONS.has(ext)) {
		return rawBuffer.toString("utf-8");
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(rawBuffer);
	} catch {
		return null;
	}
}

/**
 * Audit a single Skill directory for forbidden network exfiltration, dynamic code execution,
 * unsafe shell primitives, Trojan-Source hidden Unicode, symbolic links, and forbidden binary files.
 */
export function auditSkillSecurity(
	skillDir: string,
	options?: SecurityAuditOptions,
): SkillSecurityAuditReport {
	const resolvedSkillDir = path.resolve(skillDir);
	const allowlistEntries = loadBuiltinAllowlistEntries(
		resolvedSkillDir,
		options,
	);
	const { candidateTextFiles, structuralFindings } =
		walkSkillSecurityTree(resolvedSkillDir);
	const scannedFiles: string[] = [];
	const findings: SkillSecurityFinding[] = [...structuralFindings];

	for (const fullPath of candidateTextFiles) {
		const relFile = path
			.relative(resolvedSkillDir, fullPath)
			.replace(/\\/g, "/");
		const ext = path.extname(fullPath).toLowerCase();
		const isExecutableScript = EXECUTABLE_SCRIPT_EXTENSIONS.has(ext);
		if (isExecutableScript) {
			scannedFiles.push(relFile);
		}

		const rawBuffer = fs.readFileSync(fullPath);
		const rawContent = decodeUtf8TextIfApplicable(rawBuffer, ext);
		if (rawContent === null) {
			continue;
		}

		const fileSha256 =
			allowlistEntries.length > 0
				? crypto.createHash("sha256").update(rawBuffer).digest("hex")
				: "";

		const fileFindings: SkillSecurityFinding[] = [];
		const longLineSeen = new Set<number>();

		for (const tf of scanTextForTrojanUnicode(
			relFile,
			rawContent,
			isExecutableScript,
		)) {
			if (tf.rule === "suspicious-long-line") {
				longLineSeen.add(tf.line);
			}
			fileFindings.push(tf);
		}

		let scriptFindings: SkillSecurityFinding[] = [];
		if (ext === ".py") {
			scriptFindings = scanPythonScriptContent(relFile, rawContent);
		} else if (ext === ".sh") {
			scriptFindings = scanShellScriptContent(relFile, rawContent);
		} else if (isExecutableScript) {
			scriptFindings = scanJsOrTsScriptContent(relFile, rawContent);
		}

		for (const sf of scriptFindings) {
			if (sf.rule === "suspicious-long-line" && longLineSeen.has(sf.line)) {
				continue;
			}
			fileFindings.push(sf);
		}

		for (const item of fileFindings) {
			if (
				fileSha256 &&
				isFindingCoveredByAllowlist(
					allowlistEntries,
					fullPath,
					item.rule,
					fileSha256,
				)
			) {
				continue;
			}
			findings.push(item);
		}
	}

	return {
		targetDir: resolvedSkillDir.replace(/\\/g, "/"),
		passed: findings.length === 0,
		scannedFiles,
		findings,
	};
}

function scanTopLevelCatalogSymlinks(
	catalogRoot: string,
	coveredSkillDirs: ReadonlySet<string>,
	currentDir: string = catalogRoot,
): SkillSecurityFinding[] {
	if (!fs.existsSync(currentDir)) {
		return [];
	}
	const findings: SkillSecurityFinding[] = [];
	const rootStat = fs.lstatSync(currentDir);
	if (rootStat.isSymbolicLink()) {
		const rel =
			path.relative(catalogRoot, currentDir).replace(/\\/g, "/") || ".";
		return [
			{
				file: rel,
				line: 1,
				rule: "forbidden-symlink",
				symbol: "symlink",
				message: `Forbidden symbolic link '${rel}' in catalog directory.`,
			},
		];
	}
	if (!rootStat.isDirectory()) {
		return [];
	}

	for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
		const fullPath = path.join(currentDir, entry.name);
		const resolvedFull = path.resolve(fullPath);
		if (coveredSkillDirs.has(resolvedFull)) {
			continue;
		}
		const rel = path.relative(catalogRoot, fullPath).replace(/\\/g, "/");
		const entryLstat = fs.lstatSync(fullPath);
		if (entry.isSymbolicLink() || entryLstat.isSymbolicLink()) {
			findings.push({
				file: rel,
				line: 1,
				rule: "forbidden-symlink",
				symbol: "symlink",
				message: `Forbidden symbolic link '${rel}' in catalog directory.`,
			});
			continue;
		}
		if (entryLstat.isDirectory() && !IGNORED_SCAN_DIRS.has(entry.name)) {
			findings.push(
				...scanTopLevelCatalogSymlinks(catalogRoot, coveredSkillDirs, fullPath),
			);
		}
	}
	return findings;
}

/**
 * Audit every Skill directory and Subagent file under `catalogDir` for security violations.
 */
export function auditCatalogSecurity(
	catalogDir: string,
	options?: SecurityAuditOptions,
): SkillSecurityAuditReport {
	const resolvedCatalog = path.resolve(catalogDir);
	const allowlistEntries = loadBuiltinAllowlistEntries(
		resolvedCatalog,
		options,
	);
	const skillDirs = discoverSkillDirectories(resolvedCatalog);
	const coveredSkillDirs = new Set(skillDirs.map((d) => path.resolve(d)));
	const scannedFiles: string[] = [];
	const findings: SkillSecurityFinding[] = [
		...scanTopLevelCatalogSymlinks(resolvedCatalog, coveredSkillDirs),
	];

	for (const skillDir of skillDirs) {
		const report = auditSkillSecurity(skillDir, options);
		const skillRelPrefix = path
			.relative(resolvedCatalog, skillDir)
			.replace(/\\/g, "/");
		for (const sf of report.scannedFiles) {
			scannedFiles.push(`${skillRelPrefix}/${sf}`);
		}
		for (const f of report.findings) {
			findings.push({
				...f,
				file: `${skillRelPrefix}/${f.file}`,
			});
		}
	}

	const subagentFiles = discoverSubagentFiles(resolvedCatalog);
	for (const saFullPath of subagentFiles) {
		const relFile = path
			.relative(resolvedCatalog, saFullPath)
			.replace(/\\/g, "/");
		const lstat = fs.lstatSync(saFullPath);
		if (lstat.isSymbolicLink()) {
			findings.push({
				file: relFile,
				line: 1,
				rule: "forbidden-symlink",
				symbol: "symlink",
				message: `Forbidden symbolic link '${relFile}' in Subagent definition.`,
			});
			continue;
		}
		const rawBuffer = fs.readFileSync(saFullPath);
		const rawContent = rawBuffer.toString("utf-8");
		const fileSha256 =
			allowlistEntries.length > 0
				? crypto.createHash("sha256").update(rawBuffer).digest("hex")
				: "";
		for (const tf of scanTextForTrojanUnicode(relFile, rawContent, false)) {
			if (
				fileSha256 &&
				isFindingCoveredByAllowlist(
					allowlistEntries,
					saFullPath,
					tf.rule,
					fileSha256,
				)
			) {
				continue;
			}
			findings.push(tf);
		}
	}

	return {
		targetDir: resolvedCatalog.replace(/\\/g, "/"),
		passed: findings.length === 0,
		scannedFiles,
		findings,
	};
}
