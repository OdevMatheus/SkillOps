import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import {
	ALL_RUNTIME_TARGETS,
	CORE_RUNTIME_TARGETS,
	countWords,
	createSkillManifest,
	createSubagentManifest,
	detectInstalledHarnesses,
	discoverSkillDirectories,
	discoverSubagentFiles,
	ExitCode,
	estimateTokenCount,
	parseSkillDirectory,
	parseSubagentFile,
	RUNTIME_HARNESS_SPECS,
	resolveRuntimeTargets,
	SKILLOPS_VERSION,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CATALOG_ROOT = path.join(REPO_ROOT, "catalog");

const VALID_DESCRIPTION =
	"Use when designing, implementing, or auditing Model Context Protocol (MCP) servers, JSON-RPC 2.0 stdio transports, tool input schemas, and context-window token footprints across enterprise coding agents and local developer harnesses. Do not trigger for generic REST APIs, GraphQL resolvers, or frontend UI component styling.";

describe("SkillOps Core Models & Subagent Contracts", () => {
	it("validates a compliant SkillManifest and computes L1 words and tokens", () => {
		const manifest = createSkillManifest({
			name: "mcp-architect",
			description: VALID_DESCRIPTION,
			version: "1.0.0",
			track: "ai-engineering",
			tags: ["mcp", "json-rpc", "token-economy"],
			routing_signals: {
				languages: ["typescript", "python"],
				files_any: ["package.json", "pyproject.toml"],
				dependencies_any: ["@modelcontextprotocol/sdk", "mcp"],
				negative_triggers: ["frontend css styling"],
			},
			entrypoints: {
				scripts: [
					{
						path: "scripts/validate_mcp_server.py",
						description:
							"Deterministic MCP server transport and schema token auditor.",
					},
				],
			},
			body_lines: 120,
			body_tokens: 950,
		});

		expect(manifest.name).toBe("mcp-architect");
		expect(manifest.description_words).toBeGreaterThanOrEqual(40);
		expect(manifest.description_words).toBeLessThanOrEqual(110);
		expect(manifest.description_tokens).toBeLessThanOrEqual(160);
		expect(countWords(VALID_DESCRIPTION)).toBe(manifest.description_words);
		expect(estimateTokenCount(VALID_DESCRIPTION)).toBe(
			manifest.description_tokens,
		);
	});

	it("rejects SkillManifest descriptions violating INV-SKILL-01 word or prefix rules", () => {
		expect(() =>
			createSkillManifest({
				name: "bad-prefix",
				description:
					"This skill does not start with the mandatory prefix even though it has plenty of words to reach forty words in total so that we only test the prefix validation rule in isolation here today for testing.",
				track: "ai-engineering",
				tags: ["test"],
				entrypoints: {
					scripts: [
						{
							path: "scripts/check.mjs",
							description: "Check script for testing.",
						},
					],
				},
			}),
		).toThrow(/must start with 'Use when'/);

		expect(() =>
			createSkillManifest({
				name: "too-short",
				description:
					"Use when testing short descriptions that fail the forty word minimum.",
				track: "ai-engineering",
				tags: ["test"],
				entrypoints: {
					scripts: [
						{
							path: "scripts/check.mjs",
							description: "Check script for testing.",
						},
					],
				},
			}),
		).toThrow(/between 40 and 110 words/);
	});

	it("validates SubagentManifest and strictly forbids wildcard tool permissions (INV-SKILL-04)", () => {
		const subagent = createSubagentManifest({
			name: "context-scout",
			description:
				"Use when exploring large repositories in an isolated context window to return a surgical <=400-token briefing with exact file and line ranges.",
			tools: ["read", "search"],
			"user-invocable": true,
			"max-output-tokens": 350,
			tags: ["context-isolation", "token-economy"],
			system_prompt_lines: 45,
			system_prompt_tokens: 320,
		});

		expect(subagent.name).toBe("context-scout");
		expect(subagent.context_isolation).toBe(true);
		expect(subagent.max_output_tokens).toBe(350);
		expect(subagent.tools).toEqual(["read", "search"]);

		// Wildcard '*' must be rejected per INV-SKILL-04
		expect(() =>
			createSubagentManifest({
				name: "unsafe-agent",
				description:
					"Use when running arbitrary commands across the workspace without least privilege boundaries.",
				tools: ["read", "*"],
			}),
		).toThrow(/cannot contain wildcard/);

		// Output briefing > 400 tokens must be rejected
		expect(() =>
			createSubagentManifest({
				name: "bloated-output-agent",
				description:
					"Use when returning huge uncompacted dumps back to the main agent conversation context.",
				tools: ["read"],
				max_output_tokens: 1200,
			}),
		).toThrow();
	});

	it("discovers and parses real repository catalog skills and subagents", () => {
		const skillDirs = discoverSkillDirectories(CATALOG_ROOT);
		expect(skillDirs.length).toBe(1);

		const skillNames: string[] = [];
		for (const dir of skillDirs) {
			const parsed = parseSkillDirectory(dir, { requireLayout: true });
			skillNames.push(parsed.manifest.name);
			expect(parsed.manifest.description_words).toBeGreaterThanOrEqual(40);
			expect(parsed.totalLines).toBeLessThanOrEqual(250);
			expect(parsed.declaredScripts.length).toBeGreaterThanOrEqual(1);
		}

		expect(skillNames).toEqual(["mcp-architect"]);

		const subagentFiles = discoverSubagentFiles(CATALOG_ROOT);
		expect(subagentFiles.length).toBe(1);
		const parsedSubagents = subagentFiles.map((f) => parseSubagentFile(f));
		const subagentNames = parsedSubagents.map((s) => s.manifest.name);
		expect(subagentNames).toEqual(["context-scout"]);
		const contextScout = parsedSubagents.find(
			(s) => s.manifest.name === "context-scout",
		);
		expect(contextScout).toBeDefined();
		expect(contextScout!.manifest.tools).toEqual(["read", "search"]);
	});

	it("executes CLI --version and --help cleanly", () => {
		expect(runCli(["node", "cli.js", "--version"])).toBe(ExitCode.SUCCESS);
		expect(runCli(["node", "cli.js", "--help"])).toBe(ExitCode.SUCCESS);
		expect(runCli(["node", "cli.js", "help", "add"])).toBe(ExitCode.SUCCESS);
		expect(runCli(["node", "cli.js", "help", "remove"])).toBe(ExitCode.SUCCESS);
		expect(SKILLOPS_VERSION).toBe("1.3.9");
	});

	it("validates Top-28 AI Coding Agent registry, auto-detection matrix, and target resolution", () => {
		expect(ALL_RUNTIME_TARGETS).toHaveLength(28);
		expect(CORE_RUNTIME_TARGETS).toEqual([
			"claude",
			"antigravity",
			"cursor",
			"codex",
			"copilot",
		]);

		for (const target of ALL_RUNTIME_TARGETS) {
			const spec = RUNTIME_HARNESS_SPECS[target];
			expect(spec).toBeDefined();
			expect(spec.id).toBe(target);
			expect(spec.displayName.length).toBeGreaterThan(2);
			expect(spec.skillsDir.length).toBeGreaterThan(2);
			expect(spec.subagentsDir.length).toBeGreaterThan(2);
			expect(spec.detectionPaths.length).toBeGreaterThanOrEqual(1);
		}

		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-harnesses-test-"),
		);
		try {
			expect(detectInstalledHarnesses(tmpRepo)).toEqual([]);
			expect(resolveRuntimeTargets("auto", tmpRepo)).toEqual([
				...CORE_RUNTIME_TARGETS,
			]);
			expect(resolveRuntimeTargets("all", tmpRepo)).toEqual([
				...ALL_RUNTIME_TARGETS,
			]);
			expect(resolveRuntimeTargets("core", tmpRepo)).toEqual([
				...CORE_RUNTIME_TARGETS,
			]);
			expect(
				resolveRuntimeTargets("claude,windsurf,roocode,kiro,junie", tmpRepo),
			).toEqual(["claude", "windsurf", "roocode", "kiro", "junie"]);

			fs.writeFileSync(
				path.join(tmpRepo, ".windsurfrules"),
				"# Windsurf\n",
				"utf-8",
			);
			fs.mkdirSync(path.join(tmpRepo, ".roo"), { recursive: true });
			fs.writeFileSync(
				path.join(tmpRepo, "CONVENTIONS.md"),
				"# Aider\n",
				"utf-8",
			);
			fs.mkdirSync(path.join(tmpRepo, ".kiro"), { recursive: true });
			fs.mkdirSync(path.join(tmpRepo, ".junie"), { recursive: true });

			const detected = detectInstalledHarnesses(tmpRepo);
			expect(detected).toEqual(["windsurf", "roocode", "aider", "kiro", "junie"]);
			expect(resolveRuntimeTargets("auto", tmpRepo)).toEqual([
				"windsurf",
				"roocode",
				"aider",
				"kiro",
				"junie",
			]);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});
});
