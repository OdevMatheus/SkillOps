import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import {
	ALL_RUNTIME_TARGETS,
	analyzeRepoTokenEconomy,
	diagnoseRepository,
	ExitCode,
	evaluateCatalog,
	formatDoctorReport,
	formatEvalSummary,
	formatHarnessInspectionReport,
	formatMcpSetupReport,
	formatTokenEconomyReport,
	handleMcpJsonRpcRequest,
	inspectHarnesses,
	loadSkillOpsConfig,
	SKILLOPS_VERSION,
	setupMcpForHarnesses,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CATALOG_ROOT = path.join(REPO_ROOT, "catalog");

describe("SkillOps NPX Complete CLI, Deterministic Eval Runner & Stdio MCP Server (Issue #62)", () => {
	it("evaluates all catalog skills (with_skill vs without_skill) and exports table, markdown, json, and html", () => {
		const summary = evaluateCatalog(CATALOG_ROOT);
		expect(summary.passed).toBe(true);
		expect(summary.skills_evaluated).toBeGreaterThanOrEqual(4);
		expect(summary.mean_pass_rate_gain).toBeGreaterThanOrEqual(0.2);

		const tableOut = formatEvalSummary(summary, "table");
		expect(tableOut).toContain("CERTIFIED_IMPROVEMENT");

		const mdOut = formatEvalSummary(summary, "markdown");
		expect(mdOut).toContain("## SkillOps Deterministic Benchmark Report");
		expect(mdOut).toContain("| Skill |");

		const htmlOut = formatEvalSummary(summary, "html");
		expect(htmlOut).toContain("<!DOCTYPE html>");
		expect(htmlOut).toContain("SkillOps Benchmark Dashboard");

		const jsonOut = formatEvalSummary(summary, "json");
		const parsed = JSON.parse(jsonOut) as { passed: boolean };
		expect(parsed.passed).toBe(true);
	});

	it("handles JSON-RPC 2.0 MCP requests (initialize, tools/list, tools/call) without stdout pollution", () => {
		const initRes = handleMcpJsonRpcRequest(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: { protocolVersion: "2024-11-05" },
			},
			{ repoPath: REPO_ROOT, catalogDir: CATALOG_ROOT },
		);
		expect(initRes).not.toBeNull();
		expect(
			(initRes!.result as { serverInfo: { name: string } }).serverInfo.name,
		).toBe("skillops-mcp");

		const listRes = handleMcpJsonRpcRequest(
			{
				jsonrpc: "2.0",
				id: 2,
				method: "tools/list",
			},
			{ repoPath: REPO_ROOT, catalogDir: CATALOG_ROOT },
		);
		const tools = (listRes!.result as { tools: Array<{ name: string }> }).tools;
		const toolNames = tools.map((t) => t.name);
		expect(toolNames).toContain("audit_catalog");
		expect(toolNames).toContain("analyze_repo_tokens");
		expect(toolNames).toContain("route_repo_skills");
		expect(toolNames).toContain("run_skill_script");
		expect(toolNames).toContain("get_skill_benchmark");
		expect(toolNames).toContain("list_catalog_items");

		const callScriptRes = handleMcpJsonRpcRequest(
			{
				jsonrpc: "2.0",
				id: 25,
				method: "tools/call",
				params: {
					name: "run_skill_script",
					arguments: { skill_name: "mcp-architect" },
				},
			},
			{ repoPath: REPO_ROOT, catalogDir: CATALOG_ROOT },
		);
		const scriptText = (
			callScriptRes!.result as {
				content: Array<{ type: string; text: string }>;
			}
		).content[0]!.text;
		const scriptPayload = JSON.parse(scriptText) as { status: string };
		expect(scriptPayload.status).toBe("pass");

		const callTokensRes = handleMcpJsonRpcRequest(
			{
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: {
					name: "analyze_repo_tokens",
					arguments: { repo_path: REPO_ROOT },
				},
			},
			{ repoPath: REPO_ROOT, catalogDir: CATALOG_ROOT },
		);
		const contentText = (
			callTokensRes!.result as {
				content: Array<{ type: string; text: string }>;
			}
		).content[0]!.text;
		const tokenPayload = JSON.parse(contentText) as {
			token_savings_pct: number;
			passed_budget: boolean;
			hotspots: unknown[];
		};
		expect(tokenPayload.token_savings_pct).toBeGreaterThanOrEqual(75);
		expect(tokenPayload.passed_budget).toBe(true);
		expect(tokenPayload.hotspots).toHaveLength(0);
	});

	it("executes CLI init, list, and eval commands cleanly", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-cli-init-"),
		);
		try {
			expect(
				runCli([
					"node",
					"cli.js",
					"init",
					"--repo",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
				]),
			).toBe(ExitCode.SUCCESS);
			expect(fs.existsSync(path.join(tmpRepo, ".skillops.yml"))).toBe(true);

			expect(
				runCli([
					"node",
					"cli.js",
					"list",
					"--catalog",
					CATALOG_ROOT,
					"--format",
					"table",
				]),
			).toBe(ExitCode.SUCCESS);

			const htmlReportPath = path.join(tmpRepo, "benchmark.html");
			expect(
				runCli([
					"node",
					"cli.js",
					"eval",
					"--catalog",
					CATALOG_ROOT,
					"--format",
					"html",
					"--out",
					htmlReportPath,
					"--strict",
				]),
			).toBe(ExitCode.SUCCESS);
			expect(fs.existsSync(htmlReportPath)).toBe(true);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("auto-loads and validates .skillops.yml across CLI commands with CLI flag precedence (Issue #102)", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-cfg-test-"),
		);
		try {
			expect(
				runCli([
					"node",
					"cli.js",
					"init",
					"--repo",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
				]),
			).toBe(ExitCode.SUCCESS);

			const loaded = loadSkillOpsConfig(tmpRepo);
			expect(loaded.exists).toBe(true);
			expect(loaded.error).toBeNull();
			expect(loaded.config).not.toBeNull();
			expect(loaded.config!.token_economy.startup_tax_budget).toBe(2500);

			// Customize .skillops.yml to only target "claude" and max_active_skills: 2
			fs.writeFileSync(
				path.join(tmpRepo, ".skillops.yml"),
				[
					'version: "1.0"',
					`catalog_dir: "${CATALOG_ROOT.replace(/\\/g, "/")}"`,
					"token_economy:",
					"  startup_tax_budget: 1800",
					"  max_active_skills: 2",
					"  max_l1_tokens: 900",
					"  max_similarity: 0.78",
					"detected_stack:",
					"  languages: [typescript]",
					"  frameworks: []",
					"targets:",
					"  - claude",
					"",
				].join("\n"),
				"utf-8",
			);

			// Run sync without --targets or --catalog; should auto-load from .skillops.yml
			expect(runCli(["node", "cli.js", "sync", "--repo", tmpRepo])).toBe(
				ExitCode.SUCCESS,
			);
			const lockRaw = JSON.parse(
				fs.readFileSync(path.join(tmpRepo, ".skillops-lock.json"), "utf-8"),
			) as {
				targets: string[];
				selected_skills: string[];
			};
			expect(lockRaw.targets).toEqual(["claude"]);
			expect(lockRaw.selected_skills.length).toBeLessThanOrEqual(2);

			// Corrupt .skillops.yml and verify BUDGET_OR_CONTRACT_ERROR exit code
			fs.writeFileSync(
				path.join(tmpRepo, ".skillops.yml"),
				"version: 1.0\ntargets: [invalid_runtime]\n",
				"utf-8",
			);
			expect(runCli(["node", "cli.js", "tokens", "--repo", tmpRepo])).toBe(
				ExitCode.BUDGET_OR_CONTRACT_ERROR,
			);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("diagnoses repository health, lockfile SHA-256 drift, and missing artifacts via doctor/status and MCP diagnose_repo (Issue #104)", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-doctor-test-"),
		);
		try {
			expect(
				runCli([
					"node",
					"cli.js",
					"init",
					"--repo",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
				]),
			).toBe(ExitCode.SUCCESS);
			expect(
				runCli([
					"node",
					"cli.js",
					"sync",
					"--repo",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
					"--targets",
					"claude,cursor",
				]),
			).toBe(ExitCode.SUCCESS);

			const healthyReport = diagnoseRepository(tmpRepo, {
				catalogDir: CATALOG_ROOT,
			});
			expect(healthyReport.config_valid).toBe(true);
			expect(healthyReport.lockfile_valid).toBe(true);
			expect(healthyReport.drifted_artifacts_count).toBe(0);
			expect(healthyReport.missing_artifacts_count).toBe(0);
			expect(healthyReport.healthy_artifacts_count).toBeGreaterThan(0);
			expect(formatDoctorReport(healthyReport, "markdown")).toContain(
				"SkillOps Doctor & Lockfile Status Report",
			);

			expect(
				runCli([
					"node",
					"cli.js",
					"status",
					"--repo",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
				]),
			).toBe(ExitCode.SUCCESS);

			// Verify MCP diagnose_repo tool
			const mcpDiagRes = handleMcpJsonRpcRequest(
				{
					jsonrpc: "2.0",
					id: 99,
					method: "tools/call",
					params: {
						name: "diagnose_repo",
						arguments: { repo_path: tmpRepo },
					},
				},
				{ repoPath: tmpRepo, catalogDir: CATALOG_ROOT },
			);
			const mcpText = (
				mcpDiagRes!.result as { content: Array<{ type: string; text: string }> }
			).content[0]!.text;
			const mcpDiagPayload = JSON.parse(mcpText) as {
				healthy_artifacts_count: number;
				drifted_artifacts_count: number;
			};
			expect(mcpDiagPayload.healthy_artifacts_count).toBe(
				healthyReport.healthy_artifacts_count,
			);
			expect(mcpDiagPayload.drifted_artifacts_count).toBe(0);

			// Introduce local drift on the first tracked artifact and delete the second
			const firstArtifact = healthyReport.artifacts[0]!;
			const secondArtifact = healthyReport.artifacts[1]!;
			fs.appendFileSync(
				path.join(tmpRepo, firstArtifact.relative_path),
				"\n<!-- local edit -->\n",
				"utf-8",
			);
			fs.unlinkSync(path.join(tmpRepo, secondArtifact.relative_path));

			const driftedReport = diagnoseRepository(tmpRepo, {
				catalogDir: CATALOG_ROOT,
			});
			expect(driftedReport.drifted_artifacts_count).toBe(1);
			expect(driftedReport.missing_artifacts_count).toBe(1);
			expect(driftedReport.status).toBe("fail");

			expect(
				runCli([
					"node",
					"cli.js",
					"doctor",
					"--repo",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
				]),
			).toBe(ExitCode.ERROR);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("emits native GitHub Actions workflow commands (--format github) across audit, tokens, eval, and doctor (Issue #105)", () => {
		const tokenReport = analyzeRepoTokenEconomy(REPO_ROOT, {
			catalogDir: CATALOG_ROOT,
		});
		const ghTokens = formatTokenEconomyReport(tokenReport, "github");
		expect(ghTokens).toContain("::notice title=SkillOps Token Economy::");

		const evalSummary = evaluateCatalog(CATALOG_ROOT);
		const ghEval = formatEvalSummary(evalSummary, "github");
		expect(ghEval).toContain(
			"::notice title=SkillOps Deterministic Benchmark::",
		);

		const docReport = diagnoseRepository(REPO_ROOT, {
			catalogDir: CATALOG_ROOT,
		});
		const ghDoctor = formatDoctorReport(docReport, "github");
		expect(ghDoctor).toContain("::notice title=SkillOps Doctor::");

		expect(
			runCli([
				"node",
				"cli.js",
				"audit",
				"--catalog",
				CATALOG_ROOT,
				"--format",
				"github",
				"--strict",
			]),
		).toBe(ExitCode.SUCCESS);
		expect(
			runCli([
				"node",
				"cli.js",
				"tokens",
				"--repo",
				REPO_ROOT,
				"--catalog",
				CATALOG_ROOT,
				"--format",
				"github",
			]),
		).toBe(ExitCode.SUCCESS);
		expect(
			runCli([
				"node",
				"cli.js",
				"eval",
				"--catalog",
				CATALOG_ROOT,
				"--format",
				"github",
				"--strict",
			]),
		).toBe(ExitCode.SUCCESS);
		expect(
			runCli([
				"node",
				"cli.js",
				"doctor",
				"--repo",
				REPO_ROOT,
				"--catalog",
				CATALOG_ROOT,
				"--format",
				"github",
			]),
		).toBe(ExitCode.SUCCESS);
	});

	it("audits Startup Token Tax across all 20 AI coding agents, reports detected harnesses in doctor, and executes 'skillops harnesses' (Issue #113)", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-tokens-top20-"),
		);
		try {
			// Seed always-on instruction files and MCP configs from multiple AI coding agents
			fs.writeFileSync(
				path.join(tmpRepo, ".windsurfrules"),
				"Always use strict TypeScript.\n",
				"utf-8",
			);
			fs.writeFileSync(
				path.join(tmpRepo, "CONVENTIONS.md"),
				"Follow Aider conventions.\n",
				"utf-8",
			);
			fs.writeFileSync(
				path.join(tmpRepo, ".goosehints"),
				"Use pytest for Python.\n",
				"utf-8",
			);
			fs.mkdirSync(path.join(tmpRepo, ".junie"), { recursive: true });
			fs.writeFileSync(
				path.join(tmpRepo, ".junie", "guidelines.md"),
				"JetBrains Junie guidelines.\n",
				"utf-8",
			);
			fs.mkdirSync(path.join(tmpRepo, ".windsurf", "rules"), {
				recursive: true,
			});
			fs.writeFileSync(
				path.join(tmpRepo, ".windsurf", "rules", "always.md"),
				"---\ntrigger: always_on\n---\nAlways-on Windsurf rule.\n",
				"utf-8",
			);
			fs.mkdirSync(path.join(tmpRepo, ".codex"), { recursive: true });
			fs.writeFileSync(
				path.join(tmpRepo, ".codex", "config.toml"),
				'[mcp_servers.skillops]\ncommand = "npx"\nargs = ["-y", "skillops-cli@latest", "mcp"]\n',
				"utf-8",
			);
			fs.mkdirSync(path.join(tmpRepo, ".zed"), { recursive: true });
			fs.writeFileSync(
				path.join(tmpRepo, ".zed", "settings.json"),
				JSON.stringify(
					{ context_servers: { skillops: { command: "npx" } } },
					null,
					2,
				),
				"utf-8",
			);

			const tokenReport = analyzeRepoTokenEconomy(tmpRepo, {
				catalogDir: CATALOG_ROOT,
			});
			const paths = tokenReport.inspected_files.map((f) => f.path);
			expect(paths).toContain(".windsurfrules");
			expect(paths).toContain("CONVENTIONS.md");
			expect(paths).toContain(".goosehints");
			expect(paths).toContain(".junie/guidelines.md");
			expect(paths).toContain(".windsurf/rules/always.md");
			expect(paths).toContain(".codex/config.toml");
			expect(paths).toContain(".zed/settings.json");

			const docReport = diagnoseRepository(tmpRepo, {
				catalogDir: CATALOG_ROOT,
			});
			expect(docReport.detected_harnesses).toEqual(
				expect.arrayContaining([
					"codex",
					"windsurf",
					"zed",
					"aider",
					"goose",
					"junie",
				]),
			);
			expect(docReport.checks.some((c) => c.id === "detected_harnesses")).toBe(
				true,
			);

			const harnessReport = inspectHarnesses(tmpRepo);
			expect(harnessReport.total_supported).toBe(20);
			expect(harnessReport.detected_count).toBe(6);
			expect(
				formatHarnessInspectionReport(harnessReport, "markdown"),
			).toContain("SkillOps Universal Top-20 AI Coding Agent Harnesses");
			expect(formatHarnessInspectionReport(harnessReport, "table")).toContain(
				"[DETECTED] windsurf",
			);

			expect(
				runCli([
					"node",
					"cli.js",
					"harnesses",
					"--repo",
					tmpRepo,
					"--format",
					"table",
				]),
			).toBe(ExitCode.SUCCESS);
			expect(
				runCli([
					"node",
					"cli.js",
					"harnesses",
					"--repo",
					tmpRepo,
					"--format",
					"json",
				]),
			).toBe(ExitCode.SUCCESS);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("idempotently configures MCP server across all 13 MCP-capable harnesses via 'skillops mcp-setup' and exposes list_supported_harnesses MCP tool (Issue #114)", () => {
		expect(SKILLOPS_VERSION).toBe("1.3.3");
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-mcp-setup-"),
		);
		try {
			// Dry-run across all 20 targets should not write files
			const dryRunReport = setupMcpForHarnesses(tmpRepo, {
				targets: [...ALL_RUNTIME_TARGETS],
				dryRun: true,
			});
			expect(dryRunReport.dry_run).toBe(true);
			expect(dryRunReport.configured_count).toBe(13);
			expect(
				dryRunReport.actions.filter((a) => a.status === "unsupported"),
			).toHaveLength(7);
			expect(fs.existsSync(path.join(tmpRepo, ".mcp.json"))).toBe(false);

			// Actual run across all 20 targets creates all 13 MCP config files
			const firstReport = setupMcpForHarnesses(tmpRepo, {
				targets: [...ALL_RUNTIME_TARGETS],
				dryRun: false,
			});
			expect(firstReport.configured_count).toBe(13);
			expect(
				firstReport.actions.filter((a) => a.status === "created"),
			).toHaveLength(13);
			expect(fs.existsSync(path.join(tmpRepo, ".mcp.json"))).toBe(true);
			expect(fs.existsSync(path.join(tmpRepo, ".vscode", "mcp.json"))).toBe(
				true,
			);
			expect(fs.existsSync(path.join(tmpRepo, ".codex", "config.toml"))).toBe(
				true,
			);
			expect(fs.existsSync(path.join(tmpRepo, ".zed", "settings.json"))).toBe(
				true,
			);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".continue", "mcpServers", "skillops.yaml"),
				),
			).toBe(true);
			expect(fs.existsSync(path.join(tmpRepo, "opencode.json"))).toBe(true);

			// Second run should be 100% idempotent ("unchanged")
			const secondReport = setupMcpForHarnesses(tmpRepo, {
				targets: [...ALL_RUNTIME_TARGETS],
				dryRun: false,
			});
			expect(secondReport.configured_count).toBe(13);
			expect(
				secondReport.actions.filter((a) => a.status === "unchanged"),
			).toHaveLength(13);
			expect(formatMcpSetupReport(secondReport, "markdown")).toContain(
				"SkillOps Universal MCP Server Registration",
			);
			expect(formatMcpSetupReport(secondReport, "table")).toContain("claude");

			// CLI invocation test
			expect(
				runCli([
					"node",
					"cli.js",
					"mcp-setup",
					"--repo",
					tmpRepo,
					"--targets",
					"all",
					"--format",
					"table",
				]),
			).toBe(ExitCode.SUCCESS);

			// MCP list_supported_harnesses tool test
			const mcpHarnessesRes = handleMcpJsonRpcRequest(
				{
					jsonrpc: "2.0",
					id: 114,
					method: "tools/call",
					params: {
						name: "list_supported_harnesses",
						arguments: { repo_path: tmpRepo },
					},
				},
				{ repoPath: tmpRepo, catalogDir: CATALOG_ROOT },
			);
			const mcpText = (
				mcpHarnessesRes!.result as {
					content: Array<{ type: string; text: string }>;
				}
			).content[0]!.text;
			const mcpPayload = JSON.parse(mcpText) as {
				total_supported: number;
				detected_harnesses: string[];
			};
			expect(mcpPayload.total_supported).toBe(20);
			expect(mcpPayload.detected_harnesses.length).toBeGreaterThanOrEqual(10);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});
});
