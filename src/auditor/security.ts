/**
 * Deterministic Security Scanner for Hybrid Executable Skills & Subagents (`src/auditor/security.ts`).
 *
 * Enforces Step 2 (Issue #190) and Step 3 (Issue #191) with Zero False Positives on legitimate large Skills:
 * - Blocks outbound network/exfiltration clients in Python (`urllib.request`, `urllib2`, `urllib3`,
 *   `http.client`, `httplib`, `socket`, `socketserver`, `requests`, `httpx`, `aiohttp`, `ftplib`,
 *   `smtplib`, `telnetlib`, `xmlrpc.client`, `paramiko`, `websocket`, `websockets`) while allowing
 *   offline URL parsers (`urllib.parse`, `urllib.error`) and local preview servers (`http.server`,
 *   `http.cookies`, `http.HTTPStatus`, `webbrowser`).
 * - Blocks dynamic code execution and unsafe deserialization (`eval`, `exec`, `__import__`,
 *   `pickle`, `marshal`, `shelve`, `ctypes`, `cffi`) while allowing `re.compile()`, `def eval()`,
 *   `model.eval()`, and JS class methods (`async eval(...) { ... }`).
 * - Blocks unsafe shell execution (`os.system`, `os.popen`, `pty`, `subprocess` with `shell=True`,
 *   and shell pipe-to-interpreter / reverse-shell payloads in `.sh` scripts) while allowing safe
 *   array-based `subprocess.run([...])` (`shell=False`) and local `curl` healthchecks.
 * - Blocks Trojan-Source (CVE-2021-42574) bidirectional control characters, LLM invisible Unicode Tag
 *   prompt-injection characters (`U+E0000..U+E007F`), and zero-width script identifier spoofing.
 * - Blocks symbolic links and opaque binary/archive payloads (`.exe`, `.dll`, `.so`, `.dylib`, `.bin`,
 *   `.wasm`, `.pyc`, `.zip`, `.tar`, `.gz`, etc.) inside Skill directories.
 * - Supports explicit maintainer-reviewed inline overrides (`skillops-security: allow`).
 */

import fs from "node:fs";
import path from "node:path";
import { discoverSkillDirectories, discoverSubagentFiles } from "./parser.js";

export type SkillSecurityRuleId =
	| "forbidden-network-import"
	| "forbidden-dynamic-exec"
	| "forbidden-shell-execution"
	| "forbidden-trojan-unicode"
	| "forbidden-symlink"
	| "forbidden-binary-file"
	| "forbidden-path-traversal";

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
]);

const FORBIDDEN_PYTHON_SHELL_MODULES = new Set(["pty", "commands"]);

const IGNORED_SCAN_DIRS = new Set([
	".git",
	"__pycache__",
	"node_modules",
	".pytest_cache",
	".ruff_cache",
	".mypy_cache",
]);

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

const TEXT_SCAN_EXTENSIONS = new Set([
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
]);

const EXECUTABLE_SCRIPT_EXTENSIONS = new Set([
	".py",
	".sh",
	".mjs",
	".js",
	".cjs",
	".ts",
]);

/**
 * Trojan-Source (CVE-2021-42574) bidirectional control characters and LLM ASCII-smuggling
 * Unicode Tag characters (`U+E0000..U+E007F`), forbidden across ALL text and Markdown files.
 */
const TROJAN_BIDI_OR_TAG_REGEX =
	/[\u0000\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u{E0000}-\u{E007F}]/u;

/**
 * Zero-width characters forbidden inside executable scripts (`.py`, `.sh`, `.js`, `.mjs`, `.ts`)
 * where they can spoof identifiers or hide payload boundaries.
 */
const SCRIPT_ZERO_WIDTH_REGEX = /[\u200B\u200C\u2060-\u2064\uFEFF]/u;

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
 * Scan raw text content for Trojan-Source bidirectional overrides, LLM Unicode Tag smuggling,
 * and (when `isExecutableScript` is true) zero-width identifier spoofing characters.
 */
export function scanTextForTrojanUnicode(
	relFile: string,
	rawContent: string,
	isExecutableScript: boolean,
): SkillSecurityFinding[] {
	const findings: SkillSecurityFinding[] = [];
	// Strip a leading UTF-8 BOM at index 0 if present; mid-file BOM in scripts is still inspected
	const normalized = rawContent.startsWith("\uFEFF")
		? rawContent.slice(1)
		: rawContent;
	const lines = normalized.split(/\r?\n/);

	for (let idx = 0; idx < lines.length; idx++) {
		const line = lines[idx] ?? "";
		const lineNo = idx + 1;

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

/**
 * Check whether a file or specific line carries a maintainer-reviewed override directive.
 */
function hasSecurityAllowDirective(line: string): boolean {
	return /skillops-security:\s*allow\b/i.test(line);
}

/**
 * Replace Python string literals and comments with spaces while preserving line breaks
 * so token checks only inspect executable Python code.
 */
function stripPythonStringsAndComments(source: string): string {
	let result = "";
	let i = 0;
	const n = source.length;

	while (i < n) {
		const ch = source[i]!;
		const next3 = source.slice(i, i + 3);

		// Comment until end of line
		if (ch === "#") {
			while (i < n && source[i] !== "\n") {
				result += " ";
				i += 1;
			}
			continue;
		}

		// Triple-quoted string (''' or """)
		if (next3 === '"""' || next3 === "'''") {
			const quote = next3;
			result += "   ";
			i += 3;
			while (i < n && source.slice(i, i + 3) !== quote) {
				if (source[i] === "\\") {
					result += source[i] === "\n" ? "\n" : " ";
					i += 1;
					if (i < n) {
						result += source[i] === "\n" ? "\n" : " ";
						i += 1;
					}
					continue;
				}
				result += source[i] === "\n" ? "\n" : " ";
				i += 1;
			}
			if (i < n) {
				result += "   ";
				i += 3;
			}
			continue;
		}

		// Single-line string ("..." or '...')
		if (ch === '"' || ch === "'") {
			const quote = ch;
			result += " ";
			i += 1;
			while (i < n && source[i] !== quote && source[i] !== "\n") {
				if (source[i] === "\\") {
					result += " ";
					i += 1;
					if (i < n && source[i] !== "\n") {
						result += " ";
						i += 1;
					}
					continue;
				}
				result += " ";
				i += 1;
			}
			if (i < n && source[i] === quote) {
				result += " ";
				i += 1;
			}
			continue;
		}

		result += ch;
		i += 1;
	}

	return result;
}

/**
 * Replace JS/TS comments (`//`, `/* ... * /`) and string/template literals (`'...'`, `"..."`, `` `...` ``)
 * with spaces while preserving line breaks so regex checks never false-positive on text or licences.
 */
function stripJsStringsAndComments(source: string): string {
	let result = "";
	let i = 0;
	const n = source.length;

	while (i < n) {
		const ch = source[i]!;
		const next2 = source.slice(i, i + 2);

		// Single-line comment
		if (next2 === "//") {
			while (i < n && source[i] !== "\n") {
				result += " ";
				i += 1;
			}
			continue;
		}

		// Multi-line block comment
		if (next2 === "/*") {
			result += "  ";
			i += 2;
			while (i < n && source.slice(i, i + 2) !== "*/") {
				result += source[i] === "\n" ? "\n" : " ";
				i += 1;
			}
			if (i < n) {
				result += "  ";
				i += 2;
			}
			continue;
		}

		// Single, double, or backtick string literal
		if (ch === "'" || ch === '"' || ch === "`") {
			const quote = ch;
			result += " ";
			i += 1;
			while (i < n && source[i] !== quote) {
				if (source[i] === "\\") {
					result += source[i] === "\n" ? "\n" : " ";
					i += 1;
					if (i < n) {
						result += source[i] === "\n" ? "\n" : " ";
						i += 1;
					}
					continue;
				}
				if (quote !== "`" && source[i] === "\n") {
					break;
				}
				result += source[i] === "\n" ? "\n" : " ";
				i += 1;
			}
			if (i < n && source[i] === quote) {
				result += " ";
				i += 1;
			}
			continue;
		}

		result += ch;
		i += 1;
	}

	return result;
}

function classifyPythonModuleImport(
	modulePath: string,
	importedNames: string[] = [],
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

	// Check `from urllib import request, urlopen` or `from http import client`
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

	if (FORBIDDEN_PYTHON_EXEC_MODULES.has(rootMod)) {
		return {
			rule: "forbidden-dynamic-exec",
			symbol: rootMod,
			message: `Forbidden unsafe deserialization/FFI module '${rootMod}' imported in Skill script.`,
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

function scanPythonScriptContent(
	relFile: string,
	rawContent: string,
): SkillSecurityFinding[] {
	if (/skillops-security:\s*allow-file\b/i.test(rawContent)) {
		return [];
	}

	const findings: SkillSecurityFinding[] = [];
	const rawLines = rawContent.split(/\r?\n/);
	const stripped = stripPythonStringsAndComments(rawContent);
	const lines = stripped.split(/\r?\n/);

	for (let idx = 0; idx < lines.length; idx++) {
		const line = lines[idx] ?? "";
		const rawLine = rawLines[idx] ?? "";
		const lineNo = idx + 1;

		if (hasSecurityAllowDirective(rawLine)) {
			continue;
		}

		// 1. Check `from a.b import c, d`
		const fromImportMatch =
			/^\s*from\s+([A-Za-z_][A-Za-z0-9_.]*)\s+import\s+(.+)$/.exec(line);
		if (fromImportMatch?.[1] && fromImportMatch[2]) {
			const modPath = fromImportMatch[1];
			const importedSymbols = fromImportMatch[2]
				.replace(/[()]/g, "")
				.split(",")
				.map((s) => s.trim().split(/\s+/)[0] ?? "")
				.filter(Boolean);
			const violation = classifyPythonModuleImport(modPath, importedSymbols);
			if (violation) {
				findings.push({
					file: relFile,
					line: lineNo,
					...violation,
				});
			}
		}

		// 2. Check `import a, b.c as d`
		const directImportMatch = /^\s*import\s+(.+)$/.exec(line);
		if (directImportMatch?.[1]) {
			const clauses = directImportMatch[1].split(",");
			for (const clause of clauses) {
				const modPath = clause.trim().split(/\s+/)[0] ?? "";
				const violation = classifyPythonModuleImport(modPath);
				if (violation) {
					findings.push({
						file: relFile,
						line: lineNo,
						...violation,
					});
				}
			}
		}

		// 3. Check usage of `urllib.request.urlopen` when `import urllib` was used
		if (/\burllib\s*\.\s*(request|urlopen)\b/.test(line)) {
			const alreadyReported = findings.some(
				(f) => f.line === lineNo && f.rule === "forbidden-network-import",
			);
			if (!alreadyReported) {
				findings.push({
					file: relFile,
					line: lineNo,
					rule: "forbidden-network-import",
					symbol: "urllib.request",
					message:
						"Forbidden outbound network call via 'urllib.request' in Skill script (violates zero-network policy).",
				});
			}
		}

		// 4. Check dynamic code execution builtins: eval(), exec(), __import__()
		// Excludes method definitions (`def eval(...)`) and attribute calls (`model.eval()`).
		// Note: `compile()` is intentionally permitted to avoid false positives with `from re import compile`.
		if (!/\bdef\s+(eval|exec|__import__)\s*\(/.test(line)) {
			const dynExecMatch = /(?<![.\w])(eval|exec|__import__)\s*\(/.exec(line);
			if (dynExecMatch?.[1]) {
				findings.push({
					file: relFile,
					line: lineNo,
					rule: "forbidden-dynamic-exec",
					symbol: `${dynExecMatch[1]}()`,
					message: `Forbidden dynamic code execution call '${dynExecMatch[1]}()' in Skill script.`,
				});
			}
		}

		// 5. Check unsafe shell execution: os.system, os.popen, os.spawn*, os.exec*, or shell=True
		const osShellMatch =
			/\bos\s*\.\s*(system|popen|spawn[lv]?[pe]?|exec[lv][pe]?)\s*\(/.exec(
				line,
			);
		if (osShellMatch?.[1]) {
			findings.push({
				file: relFile,
				line: lineNo,
				rule: "forbidden-shell-execution",
				symbol: `os.${osShellMatch[1]}()`,
				message: `Forbidden shell execution call 'os.${osShellMatch[1]}()' in Skill script.`,
			});
		}

		if (/\bshell\s*=\s*True\b/.test(line)) {
			findings.push({
				file: relFile,
				line: lineNo,
				rule: "forbidden-shell-execution",
				symbol: "shell=True",
				message:
					"Forbidden 'shell=True' in subprocess invocation; pass argument arrays with shell=False.",
			});
		}
	}

	return findings;
}

function scanJsOrTsScriptContent(
	relFile: string,
	rawContent: string,
): SkillSecurityFinding[] {
	if (/skillops-security:\s*allow-file\b/i.test(rawContent)) {
		return [];
	}

	const findings: SkillSecurityFinding[] = [];
	const rawLines = rawContent.split(/\r?\n/);
	const stripped = stripJsStringsAndComments(rawContent);
	const lines = stripped.split(/\r?\n/);

	for (let idx = 0; idx < lines.length; idx++) {
		const line = lines[idx] ?? "";
		const rawLine = rawLines[idx] ?? "";
		const lineNo = idx + 1;

		if (!line.trim() || hasSecurityAllowDirective(rawLine)) {
			continue;
		}

		// Ignore function or class method declarations like `async eval(fn, arg) {` or `function eval(...)`
		const isMethodOrFnDeclaration =
			/\b(function|async)\s+eval\s*\(/.test(line) ||
			/^\s*(?:async\s+)?eval\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/.test(line);

		if (!isMethodOrFnDeclaration) {
			const jsExecMatch = /(?<![.\w$])(eval|Function)\s*\(/.exec(line);
			if (jsExecMatch?.[1]) {
				findings.push({
					file: relFile,
					line: lineNo,
					rule: "forbidden-dynamic-exec",
					symbol: `${jsExecMatch[1]}()`,
					message: `Forbidden dynamic code execution '${jsExecMatch[1]}()' in Skill script.`,
				});
			}
		}
	}

	return findings;
}

function scanShellScriptContent(
	relFile: string,
	rawContent: string,
): SkillSecurityFinding[] {
	if (/skillops-security:\s*allow-file\b/i.test(rawContent)) {
		return [];
	}

	const findings: SkillSecurityFinding[] = [];
	const lines = rawContent.split(/\r?\n/);

	for (let idx = 0; idx < lines.length; idx++) {
		const line = lines[idx] ?? "";
		const trimmed = line.trim();
		const lineNo = idx + 1;

		if (
			!trimmed ||
			trimmed.startsWith("#") ||
			hasSecurityAllowDirective(line)
		) {
			continue;
		}

		// 1. Remote download piped directly into an interpreter (curl/wget ... | sh/bash/python/node)
		const pipeExecMatch =
			/\b(curl|wget)\b[^\n#|]*\|\s*(?:sudo\s+|env\s+)?(sh|bash|zsh|dash|ksh|python[23]?|node|perl|ruby|eval)\b/.exec(
				line,
			);
		if (pipeExecMatch?.[1]) {
			findings.push({
				file: relFile,
				line: lineNo,
				rule: "forbidden-network-import",
				symbol: `${pipeExecMatch[1]} | ${pipeExecMatch[2]}`,
				message: `Forbidden remote pipe execution '${pipeExecMatch[1]} | ${pipeExecMatch[2]}' in Skill shell script.`,
			});
		}

		// 2. PowerShell download cradle (Invoke-WebRequest / iwr ... | iex)
		const psCradleMatch =
			/\b(Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b[^\n#|]*\|\s*(iex|Invoke-Expression)\b/i.exec(
				line,
			);
		if (psCradleMatch?.[1]) {
			findings.push({
				file: relFile,
				line: lineNo,
				rule: "forbidden-network-import",
				symbol: psCradleMatch[1],
				message: `Forbidden remote PowerShell execution cradle '${psCradleMatch[1]}' in Skill script.`,
			});
		}

		// 3. Reverse shell primitives (/dev/tcp/, nc -e, netcat -e, ncat -e)
		const revShellMatch =
			/(\/dev\/(?:tcp|udp)\/|\b(?:nc|ncat|netcat)\b[^\n#]*\s-[elc]\b)/.exec(
				line,
			);
		if (revShellMatch?.[1]) {
			findings.push({
				file: relFile,
				line: lineNo,
				rule: "forbidden-shell-execution",
				symbol: revShellMatch[1].trim(),
				message:
					"Forbidden reverse-shell primitive detected in Skill shell script.",
			});
		}

		// 4. Obfuscated base64 decode piped into shell or eval
		if (
			/\bbase64\s+(?:-d|--decode)\b[^\n#|]*\|\s*(?:sh|bash|zsh|python[23]?|node|eval)\b/.test(
				line,
			)
		) {
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

	return findings;
}

interface WalkedSecurityTree {
	readonly textAndScriptFiles: string[];
	readonly structuralFindings: SkillSecurityFinding[];
}

function walkSkillSecurityTree(
	rootDir: string,
	currentDir: string = rootDir,
): WalkedSecurityTree {
	if (!fs.existsSync(currentDir)) {
		return { textAndScriptFiles: [], structuralFindings: [] };
	}

	const rootStat = fs.lstatSync(currentDir);
	if (rootStat.isSymbolicLink()) {
		const rel =
			path.relative(rootDir, currentDir).replace(/\\/g, "/") || ".";
		return {
			textAndScriptFiles: [],
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
		return { textAndScriptFiles: [], structuralFindings: [] };
	}

	const textAndScriptFiles: string[] = [];
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
			textAndScriptFiles.push(...child.textAndScriptFiles);
			structuralFindings.push(...child.structuralFindings);
			continue;
		}

		if (entryLstat.isFile()) {
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
			if (TEXT_SCAN_EXTENSIONS.has(ext)) {
				textAndScriptFiles.push(fullPath);
			}
		}
	}

	return {
		textAndScriptFiles: textAndScriptFiles.sort(),
		structuralFindings,
	};
}

/**
 * Audit a single Skill directory for forbidden network exfiltration, dynamic code execution,
 * unsafe shell primitives, Trojan-Source hidden Unicode, symbolic links, and forbidden binary files.
 */
export function auditSkillSecurity(skillDir: string): SkillSecurityAuditReport {
	const resolvedSkillDir = path.resolve(skillDir);
	const { textAndScriptFiles, structuralFindings } =
		walkSkillSecurityTree(resolvedSkillDir);
	const scannedFiles: string[] = [];
	const findings: SkillSecurityFinding[] = [...structuralFindings];

	for (const fullPath of textAndScriptFiles) {
		const relFile = path
			.relative(resolvedSkillDir, fullPath)
			.replace(/\\/g, "/");
		const ext = path.extname(fullPath).toLowerCase();
		const isExecutableScript = EXECUTABLE_SCRIPT_EXTENSIONS.has(ext);
		if (isExecutableScript) {
			scannedFiles.push(relFile);
		}

		const rawContent = fs.readFileSync(fullPath, "utf-8");
		findings.push(
			...scanTextForTrojanUnicode(relFile, rawContent, isExecutableScript),
		);

		if (ext === ".py") {
			findings.push(...scanPythonScriptContent(relFile, rawContent));
		} else if (ext === ".sh") {
			findings.push(...scanShellScriptContent(relFile, rawContent));
		} else if (isExecutableScript) {
			findings.push(...scanJsOrTsScriptContent(relFile, rawContent));
		}
	}

	return {
		targetDir: resolvedSkillDir.replace(/\\/g, "/"),
		passed: findings.length === 0,
		scannedFiles,
		findings,
	};
}

/**
 * Audit every Skill directory and Subagent file under `catalogDir` for security violations.
 */
export function auditCatalogSecurity(
	catalogDir: string,
): SkillSecurityAuditReport {
	const resolvedCatalog = path.resolve(catalogDir);
	const skillDirs = discoverSkillDirectories(resolvedCatalog);
	const scannedFiles: string[] = [];
	const findings: SkillSecurityFinding[] = [];

	for (const skillDir of skillDirs) {
		const report = auditSkillSecurity(skillDir);
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
		const rawContent = fs.readFileSync(saFullPath, "utf-8");
		findings.push(...scanTextForTrojanUnicode(relFile, rawContent, false));
	}

	return {
		targetDir: resolvedCatalog.replace(/\\/g, "/"),
		passed: findings.length === 0,
		scannedFiles,
		findings,
	};
}
