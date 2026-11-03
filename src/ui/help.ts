/**
 * SkillOps CLI Help System, 3-Pillar Framework/Library Dashboard & Fuzzy Typo Matcher (`src/ui/help.ts`).
 */

import {
	formatBadge,
	renderBox,
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
		summary:
			"1-step onboarding: detect project stack, route optimal Skills & Subagents, sync to AI harnesses & wire MCP",
		usage: "npx skillops-cli quickstart [options]",
		options: [
			{
				flags: "--project, --repo, -p <dir>",
				description: "Target repository directory (default: current directory)",
			},
			{
				flags: "--harness, --targets, -t <list|auto|all>",
				description:
					"Target AI coding harnesses (e.g. claude,cursor,windsurf or auto/all)",
			},
			{
				flags: "--top, --max-skills <n>",
				description:
					"Maximum number of Skills to activate in the bundle (default: 12)",
			},
			{
				flags: "--skip-mcp, --no-mcp",
				description: "Skip automatic MCP server registration",
			},
			{
				flags: "--dry-run",
				description: "Preview planned changes without writing files to disk",
			},
			{
				flags: "--force",
				description:
					"Overwrite locally modified artifacts if drift is detected",
			},
			{
				flags: "--format, -f <table|json|markdown>",
				description: "Output report format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli quickstart",
				description:
					"Auto-detect stack & harnesses, install optimal Skills/Subagents, and configure MCP",
			},
			{
				command: "npx skillops-cli quickstart --harness cursor,claude --top 6",
				description:
					"Quickstart specifically for Cursor and Claude Code with top 6 Skills",
			},
		],
	},
	{
		name: "list",
		aliases: [],
		pillar: "library",
		summary:
			"Browse all bundled Hybrid Executable Skills & Context-Isolated Subagents with token budgets",
		usage: "npx skillops-cli list [options]",
		options: [
			{
				flags: "--catalog <dir>",
				description: "Custom catalog directory to list",
			},
			{
				flags: "--format, -f <table|json|markdown>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli list",
				description:
					"Display all 10 Skills and 9 Subagents with L1/L2 token footprints",
			},
			{
				command: "npx skillops-cli info security-sast-gate",
				description:
					"Deep-inspect a specific Skill from the Library after listing",
			},
		],
	},
	{
		name: "search",
		aliases: ["find"],
		pillar: "library",
		summary:
			"Search the Library of Skills & Subagents by keyword, domain, framework, or routing signal",
		usage: "npx skillops-cli search <query> [options]",
		options: [
			{
				flags: "--catalog <dir>",
				description: "Custom catalog directory to search",
			},
			{
				flags: "--format, -f <table|json|markdown>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli search security",
				description:
					"Find Skills and Subagents matching security/SAST/OWASP signals",
			},
			{
				command: "npx skillops-cli find postgres",
				description:
					"Find database & PostgreSQL optimization Skills in the Library",
			},
		],
	},
	{
		name: "info",
		aliases: ["show", "inspect"],
		pillar: "library",
		summary:
			"Inspect a Skill or Subagent's L1 routing triggers, L2 token budget, L3 scripts & how to use it in your AI",
		usage: "npx skillops-cli info <skill-or-subagent-name> [options]",
		options: [
			{
				flags: "--catalog <dir>",
				description: "Custom catalog directory",
			},
			{
				flags: "--format, -f <table|json|markdown>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli info bug-reproducer-tdd",
				description:
					"Inspect routing triggers, L3 scripts & IDE invocation guide for bug-reproducer-tdd",
			},
			{
				command: "npx skillops-cli show red-team-breaker",
				description:
					"Inspect the red-team-breaker Context-Isolated Subagent card",
			},
		],
	},
	{
		name: "add",
		aliases: ["install", "i"],
		pillar: "library",
		summary:
			"Install one or more Skills or Subagents into your active AI coding harnesses",
		usage: "npx skillops-cli add <name...> [options]",
		options: [
			{
				flags: "--project, --repo, -p <dir>",
				description: "Target repository directory",
			},
			{
				flags: "--harness, --targets, -t <list|auto|all>",
				description:
					"Target AI coding harnesses (e.g. claude,cursor,windsurf or all)",
			},
			{
				flags: "--dry-run",
				description: "Preview planned file writes without modifying disk",
			},
			{
				flags: "--force",
				description: "Overwrite locally drifted files",
			},
			{
				flags: "--format, -f <table|json|markdown>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli install security-sast-gate",
				description:
					"Install the security-sast-gate Skill into configured/default harnesses",
			},
			{
				command:
					"npx skillops-cli add mcp-architect context-scout --harness claude,cursor",
				description: "Install both a Skill and a Subagent into Claude & Cursor",
			},
		],
	},
	{
		name: "remove",
		aliases: ["uninstall", "rm"],
		pillar: "library",
		summary:
			"Surgically uninstall a synced Skill or Subagent from active AI harnesses",
		usage: "npx skillops-cli remove <name...> [options]",
		options: [
			{
				flags: "--project, --repo, -p <dir>",
				description: "Target repository directory",
			},
			{
				flags: "--harness, --targets, -t <list>",
				description: "Restrict removal to specific harnesses",
			},
			{
				flags: "--force",
				description: "Remove even if local SHA-256 drift is detected",
			},
		],
		examples: [
			{
				command: "npx skillops-cli uninstall mcp-architect",
				description:
					"Remove all transpiled runtime files for mcp-architect and update .skillops-lock.json",
			},
		],
	},
	{
		name: "route",
		aliases: ["recommend"],
		pillar: "library",
		summary:
			"Fingerprint repository stack and recommend the optimal collision-free <=12 Skill bundle",
		usage: "npx skillops-cli recommend [options]",
		options: [
			{
				flags: "--project, --repo, -p <dir>",
				description: "Repository directory to fingerprint",
			},
			{
				flags: "--task <prompt>",
				description:
					"Optional natural-language task prompt to boost task-specific Skills",
			},
			{
				flags: "--top, --max-skills <n>",
				description: "Maximum Skills to select (default: 12)",
			},
			{
				flags: "--max-l1-tokens <n>",
				description: "Maximum total L1 routing token budget (default: 1500)",
			},
			{
				flags: "--format, -f <table|json|markdown>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli recommend",
				description:
					"Recommend the best Skills & Subagents for the current repository stack",
			},
			{
				command:
					'npx skillops-cli route --task "optimize slow postgres queries in FastAPI" --top 4',
				description:
					"Route top 4 Skills tailored to a specific engineering task",
			},
		],
	},
	{
		name: "create",
		aliases: ["new"],
		pillar: "framework",
		summary:
			"Scaffold a custom Skill (SKILL.md + L3 script + evals.json) or Subagent (SUBAGENT.md) using the SkillOps Framework",
		usage:
			"npx skillops-cli create <skill|subagent> <kebab-case-name> [options]",
		options: [
			{
				flags: "--description, -d <text>",
				description:
					"Custom trigger description (automatically normalized to INV-SKILL-01..04 contracts)",
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
				flags: "--format, -f <table|json|markdown>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli create skill graphql-schema-guard",
				description:
					"Scaffold a new INV-SKILL-01..03 compliant Skill with Level 3 script & eval suite",
			},
			{
				command: "npx skillops-cli create subagent migration-reviewer",
				description:
					"Scaffold a new INV-SKILL-04 compliant Context-Isolated Subagent",
			},
		],
	},
	{
		name: "audit",
		aliases: [],
		pillar: "framework",
		summary:
			"Run L1/L2/L3 token budget linter, Subagent contract verifier & TF-IDF cosine collision matrix",
		usage: "npx skillops-cli audit [options]",
		options: [
			{
				flags: "--catalog <dir>",
				description: "Catalog directory to audit",
			},
			{
				flags: "--require-layout",
				description:
					"Enforce full directory layout including evals/evals.json and executable L3 scripts",
			},
			{
				flags: "--strict",
				description:
					"Fail with non-zero exit code on HIGH_RISK collisions as well as BLOCKING collisions",
			},
			{
				flags: "--format, -f <table|json|github>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli audit --require-layout --strict",
				description:
					"Certify that all Skills & Subagents pass token budgets and zero-collision invariants",
			},
		],
	},
	{
		name: "eval",
		aliases: [],
		pillar: "framework",
		summary:
			"Execute zero-API deterministic TDD benchmarks (with_skill vs without_skill) and export dashboards",
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
				description:
					"Write formatted benchmark report (e.g. HTML/Markdown) to disk",
			},
			{
				flags: "--strict",
				description:
					"Exit with code 4 if any Skill fails CERTIFIED_IMPROVEMENT",
			},
			{
				flags: "--format, -f <table|json|markdown|html|github>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli eval --strict",
				description:
					"Run deterministic A/B evals across all Skills in the catalog",
			},
			{
				command: "npx skillops-cli eval --format html --out benchmark.html",
				description: "Export a standalone HTML benchmark dashboard",
			},
		],
	},
	{
		name: "init",
		aliases: [],
		pillar: "runtime",
		summary:
			"Scaffold declarative .skillops.yml and detect repository AI coding harnesses",
		usage: "npx skillops-cli init [options]",
		options: [
			{
				flags: "--project, --repo, -p <dir>",
				description: "Target repository directory",
			},
			{
				flags: "--harness, --targets, -t <list|auto|all>",
				description: "Initial target harnesses to record in .skillops.yml",
			},
		],
		examples: [
			{
				command: "npx skillops-cli init",
				description:
					"Create .skillops.yml with auto-detected stack and harnesses",
			},
		],
	},
	{
		name: "sync",
		aliases: [],
		pillar: "runtime",
		summary:
			"Transpile routed Skills & Subagents across up to 20 AI coding agents with SHA-256 lockfile protection",
		usage: "npx skillops-cli sync [options]",
		options: [
			{
				flags: "--project, --repo, -p <dir>",
				description: "Target repository directory",
			},
			{
				flags: "--harness, --targets, -t <list|auto|all>",
				description:
					"Target AI coding harnesses (default: .skillops.yml targets or core 5)",
			},
			{
				flags: "--top, --max-skills <n>",
				description: "Maximum Skills to sync",
			},
			{
				flags: "--dry-run",
				description: "Preview planned artifacts without writing files",
			},
			{
				flags: "--force",
				description: "Overwrite locally drifted files",
			},
		],
		examples: [
			{
				command: "npx skillops-cli sync --auto",
				description:
					"Sync optimal Skills & Subagents into all AI harnesses detected in the repo",
			},
			{
				command: "npx skillops-cli sync --harness all",
				description: "Transpile across all 20 supported AI coding agents",
			},
		],
	},
	{
		name: "clean",
		aliases: [],
		pillar: "runtime",
		summary:
			"Remove all SkillOps-managed runtime artifacts tracked in .skillops-lock.json",
		usage: "npx skillops-cli clean [options]",
		options: [
			{
				flags: "--project, --repo, -p <dir>",
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
				description:
					"Cleanly remove all synced artifacts and .skillops-lock.json",
			},
		],
	},
	{
		name: "tokens",
		aliases: ["budget"],
		pillar: "runtime",
		summary:
			"Analyze repository Startup Token Tax, Progressive Disclosure savings & context bloat hotspots",
		usage: "npx skillops-cli budget [options]",
		options: [
			{
				flags: "--project, --repo, -p <dir>",
				description: "Repository directory to inspect",
			},
			{
				flags: "--budget <tokens>",
				description: "Startup Token Tax ceiling (default: 2500)",
			},
			{
				flags: "--strict",
				description:
					"Fail with exit code 3 if Startup Token Tax exceeds budget",
			},
			{
				flags: "--format, -f <table|json|markdown|github>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli budget",
				description:
					"Inspect repository Startup Token Tax and Progressive Disclosure savings",
			},
		],
	},
	{
		name: "doctor",
		aliases: ["status"],
		pillar: "runtime",
		summary:
			"Diagnose Node/Python environment, .skillops.yml validity, lockfile SHA-256 drift & Startup Token Tax",
		usage: "npx skillops-cli doctor [options]",
		options: [
			{
				flags: "--project, --repo, -p <dir>",
				description: "Repository directory to diagnose",
			},
			{
				flags: "--strict",
				description: "Fail on warnings as well as errors",
			},
			{
				flags: "--format, -f <table|json|markdown|github>",
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
		summary:
			"List all 20 supported AI coding agents, target paths, MCP support & repository detection status",
		usage: "npx skillops-cli harnesses [options]",
		options: [
			{
				flags: "--project, --repo, -p <dir>",
				description: "Repository directory to scan for AI harnesses",
			},
			{
				flags: "--format, -f <table|json|markdown>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "npx skillops-cli harnesses",
				description:
					"View all 20 supported AI coding IDEs/CLI agents and which ones are active in your repo",
			},
		],
	},
	{
		name: "mcp-setup",
		aliases: [],
		pillar: "runtime",
		summary:
			"Register SkillOps MCP server across all 13 MCP-compatible AI coding IDEs & agents",
		usage: "npx skillops-cli mcp-setup [options]",
		options: [
			{
				flags: "--project, --repo, -p <dir>",
				description: "Target repository directory",
			},
			{
				flags: "--harness, --targets, -t <list|auto|all>",
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
				description:
					"Automatically wire SkillOps MCP server into detected IDEs (.mcp.json, .cursor/mcp.json, etc.)",
			},
		],
	},
	{
		name: "mcp",
		aliases: [],
		pillar: "runtime",
		summary: "Start native JSON-RPC 2.0 stdio Model Context Protocol server",
		usage: "npx skillops-cli mcp [options]",
		options: [
			{
				flags: "--project, --repo, -p <dir>",
				description: "Repository root served over MCP",
			},
		],
		examples: [
			{
				command: "npx skillops-cli mcp",
				description:
					"Start stdio MCP server (invoked automatically by AI IDEs)",
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
 * Render the 3-Pillar Framework & Library global help screen (`npx skillops-cli --help`).
 */
export function renderGlobalHelp(
	version: string,
	colorEnabled?: boolean,
): string {
	const c = colorEnabled;
	const banner = renderHeaderBanner(
		"The Zero-API Framework & Library for High-End AI Coding Skills & Context-Isolated Subagents",
		{
			version,
			colorEnabled: c,
		},
	);

	const quickstartBox = renderBox(
		[
			`${style.bold(style.green("npx skillops-cli quickstart", c), c)}    ${style.dim("# 1-step setup: detect stack, install Skills/Subagents & wire MCP", c)}`,
			`${style.bold(style.cyan("npx skillops-cli info <name>", c), c)}   ${style.dim("# Inspect any Skill/Subagent & see how to invoke it in your AI", c)}`,
			`${style.bold(style.magenta("npx skillops-cli create skill <name>", c), c)} ${style.dim("# Scaffold your own custom Skill using the SkillOps Framework", c)}`,
		],
		{
			title: "🚀 10-Second Quickstart (Library + Framework)",
			borderColor: style.cyan,
			minWidth: 88,
			colorEnabled: c,
		},
	);

	const formatCmdSection = (pillar: "library" | "framework" | "runtime") => {
		const specs = COMMAND_HELP_SPECS.filter((s) => s.pillar === pillar);
		return renderTable(
			["Command", "Aliases", "Description"],
			specs.map((s) => [
				style.bold(style.cyan(s.name, c), c),
				s.aliases.length > 0
					? style.dim(s.aliases.join(", "), c)
					: style.dim("—", c),
				s.summary,
			]),
			{ colorEnabled: c, indent: 2 },
		);
	};

	const globalFlagsTable = renderTable(
		["Global Flag", "Description"],
		[
			[
				style.cyan("--project, --repo, -p <dir>", c),
				"Target project/repository directory (default: current working directory)",
			],
			[
				style.cyan("--harness, --targets, -t <list|auto|all>", c),
				"Target AI coding harnesses (e.g. claude,cursor,windsurf,copilot or auto/all)",
			],
			[
				style.cyan("--format, -f <table|json|markdown|github>", c),
				"Output format for reports and CI pipelines (default: table)",
			],
			[
				style.cyan("--help, -h / --version, -V", c),
				"Show global or per-command help (`npx skillops-cli <cmd> --help`) / CLI version",
			],
		],
		{ colorEnabled: c, indent: 2 },
	);

	return [
		`SkillOps v${version} — The Zero-API NPX Engine for High-End AI Skills & Subagents`,
		"Usage: npx skillops-cli <command> [options]",
		"",
		banner,
		quickstartBox,
		renderSectionHeader(
			"📚 1. Library of High-End Skills & Subagents (Explore, Search & Install)",
			c,
		),
		formatCmdSection("library"),
		renderSectionHeader(
			"🛠️ 2. Framework for Building Custom Skills & Subagents (Scaffold, Audit & Certify)",
			c,
		),
		formatCmdSection("framework"),
		renderSectionHeader(
			"⚙️ 3. Universal Runtime Sync, Token Economy & Diagnostics (Top 20 AI Harnesses)",
			c,
		),
		formatCmdSection("runtime"),
		renderSectionHeader("🌐 Global Options", c),
		globalFlagsTable,
		"",
		`  ${style.dim("💡 Tip: Run", c)} ${style.bold(style.cyan("npx skillops-cli <command> --help", c), c)} ${style.dim("for detailed flags and copy-paste examples.", c)}`,
		"",
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

	const headerBox = renderBox(
		[
			`${pillarBadge} ${style.bold(style.cyan(`skillops ${spec.name}`, c), c)}${aliasText}`,
			"",
			spec.summary,
			"",
			`${style.bold("Usage:", c)} ${style.green(spec.usage, c)}`,
		],
		{
			title: `SkillOps v${version} — Command Reference`,
			borderColor: style.cyan,
			minWidth: 78,
			colorEnabled: c,
		},
	);

	const optionsSection =
		spec.options.length > 0
			? [
					renderSectionHeader("Options & Flags", c),
					renderTable(
						["Flag", "Description"],
						spec.options.map((o) => [style.cyan(o.flags, c), o.description]),
						{ colorEnabled: c, indent: 2 },
					),
				].join("\n")
			: "";

	const examplesSection = renderNextSteps(spec.examples, c);

	return [headerBox, optionsSection, examplesSection]
		.filter(Boolean)
		.join("\n");
}
