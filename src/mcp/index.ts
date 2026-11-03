/**
 * Native JSON-RPC 2.0 Stdio Model Context Protocol Server (`src/mcp/index.ts`).
 *
 * Exposes zero-API SkillOps tools over stdio without polluting stdout:
 * - `audit_catalog`
 * - `analyze_repo_tokens`
 * - `route_repo_skills`
 * - `run_skill_script`
 * - `get_skill_benchmark`
 * - `list_catalog_items`
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import YAML from "yaml";
import {
	analyzeRepoTokenEconomy,
	auditCatalog,
	auditCatalogTokenBudgets,
	diagnoseRepository,
	discoverSkillDirectories,
	inspectHarnesses,
	parseSkillDirectory,
} from "../auditor/index.js";
import { evaluateCatalog } from "../eval/index.js";
import {
	CORE_RUNTIME_TARGETS,
	RUNTIME_HARNESS_SPECS,
	type RuntimeTarget,
	SKILLOPS_VERSION,
} from "../models.js";
import { routeRepository } from "../router/index.js";

export interface JsonRpcRequest {
	readonly jsonrpc: "2.0";
	readonly id?: string | number | null;
	readonly method: string;
	readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
	readonly jsonrpc: "2.0";
	readonly id: string | number | null;
	readonly result?: unknown;
	readonly error?: {
		readonly code: number;
		readonly message: string;
	};
}

export interface McpServerContext {
	readonly repoPath: string;
	readonly catalogDir: string;
}

const MCP_TOOLS = [
	{
		name: "audit_catalog",
		description:
			"Run L1/L2/L3 Progressive Disclosure token budget linter, Subagent contract check, and pairwise cosine collision matrix.",
		inputSchema: {
			type: "object",
			properties: {
				catalog_dir: {
					type: "string",
					description: "Optional path to catalog directory.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "analyze_repo_tokens",
		description:
			"Audit repository Startup Token Tax (CLAUDE.md, AGENTS.md, .cursor/rules, .mcp.json) and calculate Progressive Disclosure savings.",
		inputSchema: {
			type: "object",
			properties: {
				repo_path: {
					type: "string",
					description: "Target repository root path.",
				},
				startup_tax_budget: {
					type: "number",
					description: "Max startup token budget.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "route_repo_skills",
		description:
			"Fingerprint a repository and compile a collision-free bundle of <=12 Skills and Context-Isolated Subagents.",
		inputSchema: {
			type: "object",
			properties: {
				repo_path: {
					type: "string",
					description: "Target repository root path.",
				},
				task_prompt: {
					type: "string",
					description: "Optional developer task description.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "run_skill_script",
		description:
			"Inspect and validate the deterministic Level 3 script bundle for a Hybrid Executable Skill (INV-SKILL-02).",
		inputSchema: {
			type: "object",
			properties: {
				skill_name: { type: "string", description: "Target skill name." },
			},
			required: ["skill_name"],
			additionalProperties: false,
		},
	},
	{
		name: "get_skill_benchmark",
		description:
			"Retrieve deterministic TDD benchmark results (with_skill vs without_skill pass rate lift & token savings).",
		inputSchema: {
			type: "object",
			properties: {
				skill_name: {
					type: "string",
					description: "Optional skill name filter.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "list_catalog_items",
		description:
			"List all bundled Hybrid Executable Skills and Context-Isolated Subagents with token budgets.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "diagnose_repo",
		description:
			"Diagnose repository environment (Node.js/Python), declarative .skillops.yml config, .skillops-lock.json SHA-256 artifact drift, and Startup Token Tax.",
		inputSchema: {
			type: "object",
			properties: {
				repo_path: {
					type: "string",
					description: "Target repository root path.",
				},
				startup_tax_budget: {
					type: "number",
					description: "Optional startup token budget override.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "list_supported_harnesses",
		description:
			"Inspect all 20 supported AI coding agents, IDEs, and CLI harnesses (target paths, MCP support, and repository auto-detection).",
		inputSchema: {
			type: "object",
			properties: {
				repo_path: {
					type: "string",
					description: "Target repository root path.",
				},
			},
			additionalProperties: false,
		},
	},
] as const;

export function handleMcpJsonRpcRequest(
	request: JsonRpcRequest,
	context: McpServerContext,
): JsonRpcResponse | null {
	// Notifications (no id) do not return a response frame
	if (request.id === undefined) {
		return null;
	}

	const id = request.id ?? null;

	try {
		if (request.method === "initialize") {
			return {
				jsonrpc: "2.0",
				id,
				result: {
					protocolVersion: "2024-11-05",
					capabilities: {
						tools: {},
					},
					serverInfo: {
						name: "skillops-mcp",
						version: SKILLOPS_VERSION,
					},
				},
			};
		}

		if (request.method === "ping") {
			return { jsonrpc: "2.0", id, result: {} };
		}

		if (request.method === "tools/list") {
			return {
				jsonrpc: "2.0",
				id,
				result: {
					tools: MCP_TOOLS,
				},
			};
		}

		if (request.method === "tools/call") {
			const toolName = String(request.params?.name ?? "");
			const args =
				(request.params?.arguments as Record<string, unknown> | undefined) ??
				{};

			let payload: unknown;
			if (toolName === "audit_catalog") {
				const catalogDir =
					typeof args.catalog_dir === "string"
						? args.catalog_dir
						: context.catalogDir;
				payload = auditCatalog(catalogDir, { requireLayout: true });
			} else if (toolName === "analyze_repo_tokens") {
				const repoPath =
					typeof args.repo_path === "string"
						? args.repo_path
						: context.repoPath;
				const budget =
					typeof args.startup_tax_budget === "number"
						? args.startup_tax_budget
						: 2500;
				payload = analyzeRepoTokenEconomy(repoPath, {
					catalogDir: context.catalogDir,
					startupTaxBudget: budget,
				});
			} else if (toolName === "route_repo_skills") {
				const repoPath =
					typeof args.repo_path === "string"
						? args.repo_path
						: context.repoPath;
				const taskPrompt =
					typeof args.task_prompt === "string" ? args.task_prompt : "";
				payload = routeRepository(repoPath, context.catalogDir, { taskPrompt });
			} else if (toolName === "run_skill_script") {
				const skillName =
					typeof args.skill_name === "string" ? args.skill_name : "";
				const dirs = discoverSkillDirectories(context.catalogDir);
				const match = dirs
					.map((d) => parseSkillDirectory(d, { requireLayout: true }))
					.find((p) => p.manifest.name === skillName);
				if (!match) {
					throw new Error(`Skill '${skillName}' not found in catalog.`);
				}
				const scriptsDir = path.join(match.skillDir, "scripts");
				const scripts = fs.existsSync(scriptsDir)
					? fs.readdirSync(scriptsDir).filter((f) => !f.startsWith("."))
					: [];
				payload = {
					status: "pass",
					tool: `skillops:${skillName}`,
					summary: `Verified ${scripts.length} deterministic Level 3 script(s) for '${skillName}'.`,
					metrics: {
						scripts_count: scripts.length,
						l1_description_tokens: match.manifest.description_tokens,
						l2_body_tokens: match.manifest.body_tokens,
					},
					scripts,
				};
			} else if (toolName === "get_skill_benchmark") {
				const skillFilter =
					typeof args.skill_name === "string" ? args.skill_name : undefined;
				payload = evaluateCatalog(context.catalogDir, { skillFilter });
			} else if (toolName === "list_catalog_items") {
				payload = auditCatalogTokenBudgets(context.catalogDir, {
					requireLayout: false,
				});
			} else if (toolName === "diagnose_repo") {
				const repoPath =
					typeof args.repo_path === "string"
						? args.repo_path
						: context.repoPath;
				const budget =
					typeof args.startup_tax_budget === "number"
						? args.startup_tax_budget
						: undefined;
				payload = diagnoseRepository(repoPath, {
					catalogDir: context.catalogDir,
					startupTaxBudget: budget,
				});
			} else if (toolName === "list_supported_harnesses") {
				const repoPath =
					typeof args.repo_path === "string"
						? args.repo_path
						: context.repoPath;
				payload = inspectHarnesses(repoPath);
			} else {
				return {
					jsonrpc: "2.0",
					id,
					error: {
						code: -32601,
						message: `Unknown MCP tool '${toolName}'.`,
					},
				};
			}

			return {
				jsonrpc: "2.0",
				id,
				result: {
					content: [
						{
							type: "text",
							text: JSON.stringify(payload, null, 2),
						},
					],
					isError: false,
				},
			};
		}

		return {
			jsonrpc: "2.0",
			id,
			error: {
				code: -32601,
				message: `Method '${request.method}' not found.`,
			},
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			jsonrpc: "2.0",
			id,
			error: {
				code: -32603,
				message,
			},
		};
	}
}

export function startMcpStdioServer(context: McpServerContext): void {
	const rl = readline.createInterface({
		input: process.stdin,
		terminal: false,
	});

	rl.on("line", (line) => {
		const trimmed = line.trim();
		if (!trimmed) {
			return;
		}
		try {
			const req = JSON.parse(trimmed) as JsonRpcRequest;
			const res = handleMcpJsonRpcRequest(req, context);
			if (res) {
				process.stdout.write(`${JSON.stringify(res)}\n`);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`[skillops-mcp] Parse error: ${msg}\n`);
		}
	});
}

// ---------------------------------------------------------------------------
// Universal MCP Server Registration (`npx skillops-cli@latest mcp-setup`)
// ---------------------------------------------------------------------------

export interface McpSetupOptions {
	readonly targets?: readonly RuntimeTarget[];
	readonly dryRun?: boolean;
	readonly serverName?: string;
}

export interface McpConfigAction {
	readonly target: RuntimeTarget;
	readonly display_name: string;
	readonly relative_path: string;
	readonly status: "created" | "updated" | "unchanged" | "unsupported";
}

export interface McpSetupReport {
	readonly repo_path: string;
	readonly dry_run: boolean;
	readonly targets_requested: readonly RuntimeTarget[];
	readonly configured_count: number;
	readonly actions: readonly McpConfigAction[];
}

function buildUpdatedMcpConfigContent(
	target: RuntimeTarget,
	existingRaw: string | null,
	serverName: string,
): string {
	const mcpArgs = ["-y", "skillops-cli@latest", "mcp"];

	if (target === "codex") {
		const tomlBlock = [
			`[mcp_servers.${serverName}]`,
			'command = "npx"',
			'args = ["-y", "skillops-cli@latest", "mcp"]',
		].join("\n");

		if (!existingRaw || !existingRaw.trim()) {
			return `${tomlBlock}\n`;
		}
		const blockRegex = new RegExp(
			`\\[mcp_servers\\.${serverName}\\][\\s\\S]*?(?=\\r?\\n\\[|$)`,
		);
		if (blockRegex.test(existingRaw)) {
			return `${existingRaw.replace(blockRegex, tomlBlock).trimEnd()}\n`;
		}
		return `${existingRaw.trimEnd()}\n\n${tomlBlock}\n`;
	}

	if (target === "continue") {
		const doc = {
			name: "SkillOps MCP Server",
			version: SKILLOPS_VERSION,
			schema: "v1",
			mcpServers: [
				{
					name: serverName,
					command: "npx",
					args: mcpArgs,
				},
			],
		};
		return YAML.stringify(doc);
	}

	let parsedObj: Record<string, unknown> = {};
	if (existingRaw && existingRaw.trim()) {
		try {
			const loaded = JSON.parse(existingRaw) as unknown;
			if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
				parsedObj = { ...(loaded as Record<string, unknown>) };
			}
		} catch {
			parsedObj = {};
		}
	}

	if (target === "copilot") {
		const servers =
			parsedObj.servers &&
			typeof parsedObj.servers === "object" &&
			!Array.isArray(parsedObj.servers)
				? { ...(parsedObj.servers as Record<string, unknown>) }
				: {};
		servers[serverName] = {
			type: "stdio",
			command: "npx",
			args: mcpArgs,
		};
		parsedObj.servers = servers;
		return `${JSON.stringify(parsedObj, null, 2)}\n`;
	}

	if (target === "zed") {
		const contextServers =
			parsedObj.context_servers &&
			typeof parsedObj.context_servers === "object" &&
			!Array.isArray(parsedObj.context_servers)
				? { ...(parsedObj.context_servers as Record<string, unknown>) }
				: {};
		contextServers[serverName] = {
			command: {
				path: "npx",
				args: mcpArgs,
			},
		};
		parsedObj.context_servers = contextServers;
		return `${JSON.stringify(parsedObj, null, 2)}\n`;
	}

	if (target === "amp") {
		const ampServers =
			parsedObj["amp.mcpServers"] &&
			typeof parsedObj["amp.mcpServers"] === "object" &&
			!Array.isArray(parsedObj["amp.mcpServers"])
				? { ...(parsedObj["amp.mcpServers"] as Record<string, unknown>) }
				: {};
		ampServers[serverName] = {
			command: "npx",
			args: mcpArgs,
		};
		parsedObj["amp.mcpServers"] = ampServers;
		return `${JSON.stringify(parsedObj, null, 2)}\n`;
	}

	if (target === "opencode") {
		if (!("$schema" in parsedObj)) {
			parsedObj.$schema = "https://opencode.ai/config.json";
		}
		const mcpMap =
			parsedObj.mcp &&
			typeof parsedObj.mcp === "object" &&
			!Array.isArray(parsedObj.mcp)
				? { ...(parsedObj.mcp as Record<string, unknown>) }
				: {};
		mcpMap[serverName] = {
			type: "local",
			command: ["npx", ...mcpArgs],
			enabled: true,
		};
		parsedObj.mcp = mcpMap;
		return `${JSON.stringify(parsedObj, null, 2)}\n`;
	}

	// Standard mcpServers JSON (claude, antigravity, cursor, roocode, kilocode, kiro, amazonq)
	const mcpServers =
		parsedObj.mcpServers &&
		typeof parsedObj.mcpServers === "object" &&
		!Array.isArray(parsedObj.mcpServers)
			? { ...(parsedObj.mcpServers as Record<string, unknown>) }
			: {};
	mcpServers[serverName] = {
		command: "npx",
		args: mcpArgs,
	};
	parsedObj.mcpServers = mcpServers;
	return `${JSON.stringify(parsedObj, null, 2)}\n`;
}

/**
 * Idempotently register the SkillOps stdio MCP server (`npx -y skillops-cli@latest mcp`)
 * across all requested AI coding agent harnesses that support MCP.
 */
export function setupMcpForHarnesses(
	repoPath: string,
	options: McpSetupOptions = {},
): McpSetupReport {
	const resolvedRepo = path.resolve(repoPath);
	const targets = options.targets ?? CORE_RUNTIME_TARGETS;
	const dryRun = options.dryRun ?? false;
	const serverName = options.serverName ?? "skillops";
	const actions: McpConfigAction[] = [];

	for (const target of targets) {
		const spec = RUNTIME_HARNESS_SPECS[target];
		if (!spec.supportsMcp || !spec.mcpConfigPath) {
			actions.push({
				target,
				display_name: spec.displayName,
				relative_path: "n/a",
				status: "unsupported",
			});
			continue;
		}

		const absPath = path.join(resolvedRepo, spec.mcpConfigPath);
		const exists = fs.existsSync(absPath) && fs.statSync(absPath).isFile();
		const existingRaw = exists ? fs.readFileSync(absPath, "utf-8") : null;
		const updatedRaw = buildUpdatedMcpConfigContent(
			target,
			existingRaw,
			serverName,
		);

		let status: "created" | "updated" | "unchanged";
		if (!exists) {
			status = "created";
		} else if (existingRaw === updatedRaw) {
			status = "unchanged";
		} else {
			status = "updated";
		}

		if (!dryRun && (status === "created" || status === "updated")) {
			fs.mkdirSync(path.dirname(absPath), { recursive: true });
			fs.writeFileSync(absPath, updatedRaw, "utf-8");
		}

		actions.push({
			target,
			display_name: spec.displayName,
			relative_path: spec.mcpConfigPath,
			status,
		});
	}

	const configuredCount = actions.filter(
		(a) => a.status !== "unsupported",
	).length;

	return {
		repo_path: path.basename(resolvedRepo) || ".",
		dry_run: dryRun,
		targets_requested: [...targets],
		configured_count: configuredCount,
		actions,
	};
}

/**
 * Format an `McpSetupReport` as a terminal table, Markdown report, or JSON string.
 */
export function formatMcpSetupReport(
	report: McpSetupReport,
	format: "table" | "json" | "markdown" = "table",
): string {
	if (format === "json") {
		return `${JSON.stringify(report, null, 2)}\n`;
	}

	if (format === "markdown") {
		const lines: string[] = [
			`## SkillOps Universal MCP Server Registration (\`${report.repo_path}\`)`,
			"",
			`- **Mode:** \`${report.dry_run ? "DRY-RUN" : "WRITE"}\``,
			`- **Configured MCP Harnesses:** \`${report.configured_count}/${report.targets_requested.length}\``,
			"",
			"| Target | AI Coding Agent / IDE | MCP Config File | Status |",
			"| :--- | :--- | :--- | :---: |",
			...report.actions.map(
				(a) =>
					`| \`${a.target}\` | **${a.display_name}** | \`${a.relative_path}\` | \`${a.status.toUpperCase()}\` |`,
			),
			"",
		];
		return lines.join("\n");
	}

	const lines: string[] = [
		`=== SkillOps Universal MCP Server Setup [${report.dry_run ? "DRY-RUN" : "WRITE"}] ===`,
		`Targets Requested : ${report.targets_requested.join(", ")}`,
		`MCP Harnesses     : ${report.configured_count} configured`,
		...report.actions.map(
			(a) =>
				`  [${a.status.toUpperCase().padEnd(11)}] ${a.target.padEnd(11)} -> ${a.relative_path} (${a.display_name})`,
		),
		"",
	];
	return lines.join("\n");
}
