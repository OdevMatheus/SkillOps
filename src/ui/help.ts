/**
 * SkillOps CLI Help System, 3-Pillar Framework/Library Dashboard & Fuzzy Typo Matcher (`src/ui/help.ts`).
 */

import {
	formatBadge,
	padVisible,
	renderHeaderBanner,
	renderNextSteps,
	renderSectionHeader,
	renderTable,
	style,
} from "./terminal.js";

export interface CommandOptionSpec {
	readonly flags: string;
	readonly description: string;
}

export interface CommandHelpSpec {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly pillar: "library" | "framework" | "runtime";
	readonly summary: string;
	readonly usage: string;
	readonly options: readonly CommandOptionSpec[];
	readonly examples: readonly {
		readonly command: string;
		readonly description: string;
	}[];
}

export const COMMAND_HELP_SPECS: readonly CommandHelpSpec[] = [
	{
		name: "quickstart",
		aliases: ["setup"],
		pillar: "library",
		summary: "1-step onboarding: detect, route & sync",
		usage: "npx skillops-cli quickstart [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Target repository directory (default: cwd)",
			},
			{
				flags: "-t, --harness <list|auto|all>",
				description: "Target AI coding harnesses (claude,cursor...)",
			},
			{
				flags: "--top, --max-skills <n>",
				description: "Max Skills to activate in bundle (default: 12)",
			},
			{
				flags: "--skip-mcp, --no-mcp",
				description: "Skip automatic MCP server registration",
			},
			{
				flags: "--dry-run",
				description: "Preview planned changes without writing files",
			},
			{
				flags: "--force",
				description: "Overwrite locally modified artifacts",
			},
			{
				flags: "-f, --format <table|json|md>",
				description: "Output report format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli quickstart",
				description: "Auto-detect stack, sync Skills & wire MCP",
			},
			{
				command: "npx skillops-cli quickstart -t cursor,claude --top 6",
				description: "Sync top 6 Skills to Cursor & Claude Code",
			},
		],
	},
	{
		name: "list",
		aliases: [],
		pillar: "library",
		summary: "Browse all 10 Skills & 9 Subagents",
		usage: "npx skillops-cli list [options]",
		options: [
			{
				flags: "--catalog <dir>",
				description: "Custom catalog directory to list",
			},
			{
				flags: "-f, --format <table|json|md>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli list",
				description: "Display all Skills & Subagents in the Library",
			},
			{
				command: "npx skillops-cli info mcp-architect",
				description: "Inspect a specific Skill from the Library",
			},
		],
	},
	{
		name: "search",
		aliases: ["find"],
		pillar: "library",
		summary: "Search catalog by keyword, stack or domain",
		usage: "npx skillops-cli search <query> [options]",
		options: [
			{
				flags: "--catalog <dir>",
				description: "Custom catalog directory to search",
			},
			{
				flags: "-f, --format <table|json|md>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli search mcp",
				description: "Find Skills/Subagents matching MCP/JSON-RPC",
			},
			{
				command: "npx skillops-cli find context",
				description: "Find context-isolated exploration Subagents",
			},
		],
	},
	{
		name: "info",
		aliases: ["show", "inspect"],
		pillar: "library",
		summary: "Inspect triggers, L2 budget & AI usage",
		usage: "npx skillops-cli info <name> [options]",
		options: [
			{
				flags: "--catalog <dir>",
				description: "Custom catalog directory",
			},
			{
				flags: "-f, --format <table|json|md>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli info mcp-architect",
				description: "Inspect triggers, L3 scripts & IDE invocation",
			},
			{
				command: "npx skillops-cli show context-scout",
				description: "Inspect the context-scout Subagent card",
			},
		],
	},
	{
		name: "add",
		aliases: ["install"],
		pillar: "library",
		summary: "Install Skills/Subagents into AI harnesses",
		usage: "npx skillops-cli add <name...> [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Target repository directory",
			},
			{
				flags: "-t, --harness <list|auto|all>",
				description: "Target AI harnesses (claude,cursor,all...)",
			},
			{
				flags: "--dry-run",
				description: "Preview planned writes without modifying disk",
			},
			{
				flags: "--force",
				description: "Overwrite locally drifted files",
			},
			{
				flags: "-f, --format <table|json|md>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli install mcp-architect",
				description: "Install mcp-architect into harnesses",
			},
			{
				command: "npx skillops-cli add mcp-architect -t claude,cursor",
				description: "Install mcp-architect into Claude & Cursor",
			},
		],
	},
	{
		name: "remove",
		aliases: ["uninstall", "rm"],
		pillar: "library",
		summary: "Remove imported Skills/Subagents from harnesses",
		usage: "npx skillops-cli remove [name...] [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Target repository directory",
			},
			{
				flags: "-t, --harness <list>",
				description: "Restrict removal to specific harnesses",
			},
			{
				flags: "--all",
				description: "Remove all imported Skills & Agents from project",
			},
			{
				flags: "--force",
				description: "Remove even if SHA-256 drift is detected",
			},
		],
		examples: [
			{
				command: "npx skillops-cli remove",
				description: "Interactive selector of installed Skills & Agents",
			},
			{
				command: "npx skillops-cli uninstall mcp-architect",
				description: "Remove runtime files & update lockfile",
			},
		],
	},
	{
		name: "route",
		aliases: ["recommend"],
		pillar: "library",
		summary: "Recommend optimal <=12 Skill bundle",
		usage: "npx skillops-cli recommend [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Repository directory to fingerprint",
			},
			{
				flags: "--task <prompt>",
				description: "Task prompt to boost task-specific Skills",
			},
			{
				flags: "--top, --max-skills <n>",
				description: "Maximum Skills to select (default: 12)",
			},
			{
				flags: "--max-l1-tokens <n>",
				description: "Maximum L1 routing token budget (default: 1500)",
			},
			{
				flags: "-f, --format <table|json|md>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli recommend",
				description: "Recommend best Skills for current repo stack",
			},
			{
				command: 'npx skillops-cli route --task "slow postgres" --top 4',
				description: "Route top 4 Skills for a specific task",
			},
		],
	},
	{
		name: "create",
		aliases: ["new"],
		pillar: "framework",
		summary: "Scaffold custom Skill or Subagent template",
		usage: "npx skillops-cli create <skill|subagent> <name> [options]",
		options: [
			{
				flags: "-d, --description <text>",
				description: "Custom trigger description (INV-SKILL-01..04)",
			},
			{
				flags: "--catalog <dir>",
				description: "Target catalog directory (default: ./catalog)",
			},
			{
				flags: "--force",
				description: "Overwrite existing Skill or Subagent template",
			},
			{
				flags: "-f, --format <table|json|md>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli create skill graphql-schema-guard",
				description: "Scaffold a new Skill with L3 script & evals",
			},
			{
				command: "npx skillops-cli create subagent migration-reviewer",
				description: "Scaffold a new Context-Isolated Subagent",
			},
		],
	},
	{
		name: "audit",
		aliases: [],
		pillar: "framework",
		summary: "Verify L1/L2 budgets & TF-IDF collisions",
		usage: "npx skillops-cli audit [options]",
		options: [
			{
				flags: "--catalog <dir>",
				description: "Catalog directory to audit",
			},
			{
				flags: "--require-layout",
				description: "Enforce evals/evals.json and L3 scripts",
			},
			{
				flags: "--strict",
				description: "Fail on HIGH_RISK as well as BLOCKING collisions",
			},
			{
				flags: "-f, --format <table|json|gh>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli audit --require-layout --strict",
				description: "Certify token budgets & zero collisions",
			},
		],
	},
	{
		name: "eval",
		aliases: [],
		pillar: "framework",
		summary: "Run deterministic A/B TDD benchmarks",
		usage: "npx skillops-cli eval [options]",
		options: [
			{
				flags: "--catalog <dir>",
				description: "Catalog directory to evaluate",
			},
			{
				flags: "--skill <name>",
				description: "Evaluate a single Skill by name",
			},
			{
				flags: "--out <file>",
				description: "Write benchmark report (HTML/Markdown) to disk",
			},
			{
				flags: "--strict",
				description: "Exit 4 if any Skill fails CERTIFIED_IMPROVEMENT",
			},
			{
				flags: "-f, --format <table|json|html>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli eval --strict",
				description: "Run deterministic A/B evals across catalog",
			},
			{
				command: "npx skillops-cli eval -f html --out benchmark.html",
				description: "Export standalone HTML benchmark dashboard",
			},
		],
	},
	{
		name: "init",
		aliases: [],
		pillar: "runtime",
		summary: "Create .skillops.yml and detect harnesses",
		usage: "npx skillops-cli init [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Target repository directory",
			},
			{
				flags: "-t, --harness <list|auto|all>",
				description: "Initial target harnesses for .skillops.yml",
			},
		],
		examples: [
			{
				command: "npx skillops-cli init",
				description: "Create .skillops.yml with detected harnesses",
			},
		],
	},
	{
		name: "sync",
		aliases: [],
		pillar: "runtime",
		summary: "Transpile bundle across 28 AI agents",
		usage: "npx skillops-cli sync [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Target repository directory",
			},
			{
				flags: "-t, --harness <list|auto|all>",
				description: "Target AI harnesses (default: .skillops.yml)",
			},
			{
				flags: "--top, --max-skills <n>",
				description: "Maximum Skills to sync",
			},
			{
				flags: "--dry-run",
				description: "Preview planned artifacts without writing",
			},
			{
				flags: "--force",
				description: "Overwrite locally drifted files",
			},
		],
		examples: [
			{
				command: "npx skillops-cli sync --auto",
				description: "Sync bundle into all detected AI harnesses",
			},
			{
				command: "npx skillops-cli sync --harness all",
				description: "Transpile across all 28 supported AI agents",
			},
		],
	},
	{
		name: "clean",
		aliases: [],
		pillar: "runtime",
		summary: "Remove all tracked runtime artifacts",
		usage: "npx skillops-cli clean [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Target repository directory",
			},
			{
				flags: "--dry-run",
				description: "Preview files that would be removed",
			},
			{
				flags: "--force",
				description: "Remove even if local edits are detected",
			},
		],
		examples: [
			{
				command: "npx skillops-cli clean",
				description: "Remove all synced artifacts & lockfile",
			},
		],
	},
	{
		name: "tokens",
		aliases: ["budget"],
		pillar: "runtime",
		summary: "Analyze Startup Token Tax & context bloat",
		usage: "npx skillops-cli budget [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Repository directory to inspect",
			},
			{
				flags: "--budget <tokens>",
				description: "Startup Token Tax ceiling (default: 2500)",
			},
			{
				flags: "--strict",
				description: "Exit 3 if Startup Token Tax exceeds budget",
			},
			{
				flags: "-f, --format <table|json|md>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli budget",
				description: "Inspect repository Startup Token Tax & savings",
			},
		],
	},
	{
		name: "doctor",
		aliases: ["status"],
		pillar: "runtime",
		summary: "Diagnose environment, drift & token budget",
		usage: "npx skillops-cli doctor [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Repository directory to diagnose",
			},
			{
				flags: "--strict",
				description: "Fail on warnings as well as errors",
			},
			{
				flags: "-f, --format <table|json|md>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli doctor",
				description: "Run full repository & lockfile health check",
			},
		],
	},
	{
		name: "harnesses",
		aliases: [],
		pillar: "runtime",
		summary: "List 28 supported AI agents & repo status",
		usage: "npx skillops-cli harnesses [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Repository directory to scan for AI harnesses",
			},
			{
				flags: "-f, --format <table|json|md>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli harnesses",
				description: "View all 28 supported AI IDEs/CLI agents",
			},
		],
	},
	{
		name: "mcp-setup",
		aliases: [],
		pillar: "runtime",
		summary: "Wire MCP server across 20 AI IDEs & agents",
		usage: "npx skillops-cli mcp-setup [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Target repository directory",
			},
			{
				flags: "-t, --harness <list|auto|all>",
				description: "Target harnesses to configure MCP for",
			},
			{
				flags: "--dry-run",
				description: "Preview MCP config files without writing",
			},
		],
		examples: [
			{
				command: "npx skillops-cli mcp-setup --auto",
				description: "Wire SkillOps MCP into detected IDEs",
			},
		],
	},
	{
		name: "mcp",
		aliases: [],
		pillar: "runtime",
		summary: "Start stdio JSON-RPC 2.0 MCP server",
		usage: "npx skillops-cli mcp [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Repository root served over MCP",
			},
		],
		examples: [
			{
				command: "npx skillops-cli mcp",
				description: "Start stdio MCP server for AI IDEs",
			},
		],
	},
];

/**
 * Find a command help specification by primary name or alias.
 */
export function findCommandHelpSpec(
	commandOrAlias: string,
): CommandHelpSpec | undefined {
	const normalized = commandOrAlias.trim().toLowerCase();
	return COMMAND_HELP_SPECS.find(
		(spec) => spec.name === normalized || spec.aliases.includes(normalized),
	);
}

/**
 * Render the compact, emoji-free global help tree (`npx skillops-cli --help`) focused on the 5 core commands.
 */
export function renderGlobalHelp(
	version: string,
	colorEnabled?: boolean,
): string {
	const c = colorEnabled;
	const bar = style.dim("│", c);
	const banner = renderHeaderBanner(
		"Skills & Agents Library for AI Coding IDEs",
		{
			version,
			colorEnabled: c,
		},
	);

	const coreCmds: readonly { readonly cmd: string; readonly desc: string }[] = [
		{
			cmd: "add [name...]",
			desc: "Import Skills or Agents (interactive if no name given)",
		},
		{
			cmd: "remove [name...]",
			desc: "Remove Skills or Agents (interactive if no name given)",
		},
		{
			cmd: "list [query]",
			desc: "List or filter available Skills & Agents in catalog",
		},
		{
			cmd: "search <query>",
			desc: "Search Skills & Agents by keyword, stack, or domain",
		},
		{
			cmd: "info <name>",
			desc: "View details and how to use a Skill or Agent",
		},
	];

	const cmdRows = coreCmds
		.map(
			(item) =>
				`${bar}  ${padVisible(style.bold(style.cyan(item.cmd, c), c), 18, "left")}${item.desc}`,
		)
		.join("\n");

	return [
		banner,
		`${bar}  Usage: skillops <command> [options]`,
		renderSectionHeader("Commands", c),
		cmdRows,
		renderSectionHeader("Options", c),
		`${bar}  ${padVisible(style.cyan("-t, --target <ide>", c), 22, "left")}AI IDE (cursor, claude, copilot, antigravity...)`,
		`${bar}  ${padVisible(style.cyan("-p, --project <dir>", c), 22, "left")}Project folder (default: current directory)`,
		`${bar}  ${padVisible(style.cyan("--all", c), 22, "left")}Import or remove all Skills & Agents`,
		renderSectionHeader("Examples", c),
		`${bar}  ${style.dim("$", c)} ${style.green("skillops add", c)}                                  ${style.dim("— Interactive import", c)}`,
		`${bar}  ${style.dim("$", c)} ${style.green("skillops remove", c)}                               ${style.dim("— Interactive removal", c)}`,
		`${bar}  ${style.dim("$", c)} ${style.green("skillops list", c)}                                 ${style.dim("— Browse catalog", c)}`,
		bar,
		`${style.dim("╰─", c)} ${style.dim("Run", c)} ${style.cyan("skillops <cmd> -h", c)} ${style.dim("for command options.", c)}`,
	].join("\n");
}

/**
 * Render detailed per-command help (`npx skillops-cli <cmd> --help` or `npx skillops-cli help <cmd>`).
 */
export function renderCommandHelp(
	spec: CommandHelpSpec,
	version: string,
	colorEnabled?: boolean,
): string {
	const c = colorEnabled;
	const bar = style.dim("│", c);
	const pillarBadge =
		spec.pillar === "library"
			? formatBadge("info", "LIBRARY", c)
			: spec.pillar === "framework"
				? formatBadge("pass", "FRAMEWORK", c)
				: formatBadge("subagent", "RUNTIME", c);

	const aliasText =
		spec.aliases.length > 0
			? ` (aliases: ${spec.aliases.map((a) => style.cyan(a, c)).join(", ")})`
			: "";

	const headerLines = [
		`${style.bold(style.cyan(`◆ SkillOps v${version}`, c), c)} ${style.dim("—", c)} ${style.bold(`skillops ${spec.name}`, c)}${aliasText} ${pillarBadge}`,
		`${bar}  ${spec.summary}`,
		`${bar}  ${style.bold("Usage:", c)} ${style.green(spec.usage, c)}`,
	].join("\n");

	const optionsSection =
		spec.options.length > 0
			? [
					renderSectionHeader("Options & Flags", c),
					renderTable(
						["Flag", "Description"],
						spec.options.map((o) => [style.cyan(o.flags, c), o.description]),
						{ colorEnabled: c, indent: 3 },
					),
				].join("\n")
			: "";

	const examplesSection = renderNextSteps(spec.examples, c);

	return [headerLines, optionsSection, examplesSection]
		.filter(Boolean)
		.join("\n");
}
