/**
 * SkillOps CLI Help System (`src/ui/help.ts`) — Focused exclusively on `add` and `remove`.
 */

import { CHARM_PALETTE, fgHex, renderPill } from "./lipgloss.js";
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
		name: "add",
		aliases: ["install", "i"],
		summary: "Install Skills or Subagents into AI coding IDEs & CLIs",
		usage: "npx skillops-cli add [name...] [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Target repository directory (default: current directory)",
			},
			{
				flags: "-g, --global",
				description: "Target user home directory (~) instead of current project",
			},
			{
				flags: "-t, --target, --agents <list|auto|all>",
				description: "Target AI harnesses (cursor,claude,copilot,all...)",
			},
			{
				flags: "--all",
				description: "Install all Skills & Subagents from the library",
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
				command: "skillops add",
				description: "Interactive 2-step TUI selector",
			},
			{
				command: "skillops add mcp-architect --agents cursor",
				description: "Install into Cursor IDE",
			},
		],
	},
	{
		name: "remove",
		aliases: ["uninstall", "rm"],
		summary: "Remove installed Skills or Subagents from AI harnesses",
		usage: "npx skillops-cli remove [name...] [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Target repository directory (default: current directory)",
			},
			{
				flags: "-g, --global",
				description: "Target user home directory (~) instead of current project",
			},
			{
				flags: "-t, --target, --agents <list>",
				description: "Restrict removal to specific AI harnesses",
			},
			{
				flags: "--all",
				description: "Remove all installed Skills & Subagents from project",
			},
			{
				flags: "--dry-run",
				description: "Preview planned removals without modifying disk",
			},
			{
				flags: "--force",
				description: "Remove even if SHA-256 drift is detected",
			},
			{
				flags: "-f, --format <table|json|md>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "skillops remove",
				description: "Interactive selector of installed items",
			},
			{
				command: "skillops remove mcp-architect",
				description: "Remove runtime files & update lockfile",
			},
		],
	},
	{
		name: "status",
		aliases: ["list", "ls"],
		summary: "Inspect installed Skills, Subagents, and SHA-256 file health",
		usage: "npx skillops-cli status [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Target repository directory (default: current directory)",
			},
			{
				flags: "-g, --global",
				description: "Inspect user home directory (~) instead of current project",
			},
			{
				flags: "-t, --target, --agents <list>",
				description: "Restrict status report to specific AI harnesses",
			},
			{
				flags: "-f, --format <table|json|md>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "skillops status",
				description: "Inspect installed Skills, Subagents & file health",
			},
			{
				command: "skillops list -f json",
				description: "Export machine-readable status report as JSON",
			},
		],
	},
	{
		name: "update",
		aliases: ["sync", "upgrade"],
		summary: "Update installed Skills & Subagents while preserving local edits",
		usage: "npx skillops-cli update [name...] [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Target repository directory (default: current directory)",
			},
			{
				flags: "-g, --global",
				description: "Update user home directory (~) instead of current project",
			},
			{
				flags: "-t, --target, --agents <list>",
				description: "Restrict update to specific AI harnesses",
			},
			{
				flags: "--dry-run",
				description: "Preview planned updates without modifying disk",
			},
			{
				flags: "--force",
				description:
					"Overwrite locally drifted files with latest catalog version",
			},
			{
				flags: "-f, --format <table|json|md>",
				description: "Output format (default: table)",
			},
		],
		examples: [
			{
				command: "skillops update",
				description: "Update all installed Skills & Subagents in project",
			},
			{
				command: "skillops update mcp-architect --force",
				description: "Force-refresh mcp-architect overwriting local edits",
			},
		],
	},
	{
		name: "audit",
		aliases: ["doctor"],
		summary:
			"Validate catalog manifests, Level 3 layout, security & transpilation",
		usage: "npx skillops-cli audit [options]",
		options: [
			{
				flags: "--catalog <dir>",
				description: "Catalog directory to audit (default: project or built-in)",
			},
			{
				flags: "--strict",
				description: "Require Level 3 scripts and evals/evals.json layout",
			},
			{
				flags: "--json, -f, --format <fmt>",
				description: "Output format: table, json, or md (default: table)",
			},
		],
		examples: [
			{
				command: "skillops audit --strict",
				description: "Run strict layout, security & 28-IDE transpiler audit",
			},
			{
				command: "skillops audit --json",
				description: "Export machine-readable audit report as JSON",
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
 * Render the compact global help tree (`npx skillops-cli --help`) focused exclusively on `add` and `remove`.
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

	const coreCmds: readonly {
		readonly cmd: string;
		readonly color: string;
		readonly desc: string;
	}[] = [
		{
			cmd: "add [name...]",
			color: CHARM_PALETTE.mint,
			desc: "Install Skills or Agents (interactive if no name given)",
		},
		{
			cmd: "status",
			color: CHARM_PALETTE.cyan,
			desc: "Inspect installed Skills, Agents & SHA-256 health",
		},
		{
			cmd: "update [name...]",
			color: CHARM_PALETTE.amber,
			desc: "Update installed Skills & Agents (preserves local edits)",
		},
		{
			cmd: "remove [name...]",
			color: CHARM_PALETTE.hotPink,
			desc: "Remove Skills or Agents (interactive if no name given)",
		},
		{
			cmd: "audit",
			color: CHARM_PALETTE.indigo,
			desc: "Validate catalog contracts, layout & static security",
		},
	];

	const cmdRows = coreCmds
		.map(
			(item) =>
				`${bar}  ${padVisible(fgHex(item.color, style.bold(item.cmd, c), c), 18, "left")}${fgHex(CHARM_PALETTE.white, item.desc, c)}`,
		)
		.join("\n");

	const usageLine = `${bar}  ${fgHex(CHARM_PALETTE.lavender, style.bold("Usage:", c), c)} ${style.bold(style.green("skillops", c), c)} ${fgHex(CHARM_PALETTE.cyan, "<add|status|update|remove|audit>", c)} ${style.dim("[options]", c)}`;

	return [
		banner,
		usageLine,
		renderSectionHeader("Commands", c),
		cmdRows,
		renderSectionHeader("Options", c),
		`${bar}  ${padVisible(style.bold(style.cyan("-t, --target, --agents", c), c), 24, "left")}${fgHex(CHARM_PALETTE.lavender, "AI IDE (cursor, claude, copilot, antigravity...)", c)}`,
		`${bar}  ${padVisible(style.bold(style.cyan("-p, --project <dir>", c), c), 24, "left")}${fgHex(CHARM_PALETTE.lavender, "Project folder (default: current directory)", c)}`,
		`${bar}  ${padVisible(style.bold(style.cyan("-g, --global", c), c), 24, "left")}${fgHex(CHARM_PALETTE.lavender, "Install or remove globally in user home (~)", c)}`,
		`${bar}  ${padVisible(style.bold(style.cyan("--all", c), c), 24, "left")}${fgHex(CHARM_PALETTE.lavender, "Install or remove all Skills & Agents", c)}`,
		renderSectionHeader("Examples", c),
		`${bar}  ${fgHex(CHARM_PALETTE.hotPink, "$", c)} ${style.bold(style.green("skillops add --agents cursor", c), c)}                  ${style.dim("—", c)} ${fgHex(CHARM_PALETTE.lavender, "Install into Cursor IDE", c)}`,
		`${bar}  ${fgHex(CHARM_PALETTE.hotPink, "$", c)} ${style.bold(style.green("skillops audit --strict", c), c)}                       ${style.dim("—", c)} ${fgHex(CHARM_PALETTE.lavender, "Validate catalog safety", c)}`,
		`${style.dim("╰─", c)} ${fgHex(CHARM_PALETTE.lavender, "Run", c)} ${style.bold(style.cyan("skillops <cmd> -h", c), c)} ${fgHex(CHARM_PALETTE.lavender, "for command options.", c)}`,
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
	const pillarBadge = formatBadge("info", "LIBRARY", c);
	const brandPill = renderPill(`◆ SkillOps v${version}`, {
		fg: CHARM_PALETTE.inkDark,
		bg: CHARM_PALETTE.indigo,
		bold: true,
		colorEnabled: c,
	});
	const cmdAccent =
		spec.name === "remove" ? CHARM_PALETTE.hotPink : CHARM_PALETTE.mint;

	const aliasText =
		spec.aliases.length > 0
			? ` ${style.dim("(aliases:", c)} ${spec.aliases.map((a) => style.bold(style.cyan(a, c), c)).join(style.dim(", ", c))}${style.dim(")", c)}`
			: "";

	const headerLines = [
		`${brandPill} ${style.dim("—", c)} ${fgHex(cmdAccent, style.bold(`skillops ${spec.name}`, c), c)}${aliasText} ${pillarBadge}`,
		`${bar}  ${fgHex(CHARM_PALETTE.lavender, spec.summary, c)}`,
		`${bar}  ${style.bold("Usage:", c)} ${style.bold(style.green(spec.usage, c), c)}`,
	].join("\n");

	const optionsSection =
		spec.options.length > 0
			? [
					renderSectionHeader("Options & Flags", c),
					renderTable(
						["Flag", "Description"],
						spec.options.map((o) => [
							style.bold(style.cyan(o.flags, c), c),
							fgHex(CHARM_PALETTE.lavender, o.description, c),
						]),
						{ colorEnabled: c, indent: 3 },
					),
				].join("\n")
			: "";

	const examplesSection = renderNextSteps(spec.examples, c);

	return [headerLines, optionsSection, examplesSection]
		.filter(Boolean)
		.join("\n");
}
