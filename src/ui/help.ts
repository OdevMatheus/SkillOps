/**
 * SkillOps CLI Help System (`src/ui/help.ts`) — Focused exclusively on `add` and `remove`.
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
				flags: "-t, --target <list|auto|all>",
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
				command: "npx skillops-cli add",
				description: "Launch interactive 2-step TUI selector",
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
		summary: "Remove installed Skills or Subagents from AI harnesses",
		usage: "npx skillops-cli remove [name...] [options]",
		options: [
			{
				flags: "-p, --project <dir>",
				description: "Target repository directory (default: current directory)",
			},
			{
				flags: "-t, --target <list>",
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
				command: "npx skillops-cli remove",
				description: "Interactive selector of installed Skills & Agents",
			},
			{
				command: "npx skillops-cli remove mcp-architect",
				description: "Remove runtime files & update lockfile",
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

	const coreCmds: readonly { readonly cmd: string; readonly desc: string }[] = [
		{
			cmd: "add [name...]",
			desc: "Install Skills or Agents (interactive if no name given)",
		},
		{
			cmd: "remove [name...]",
			desc: "Remove Skills or Agents (interactive if no name given)",
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
		`${bar}  Usage: skillops <add|remove> [options]`,
		renderSectionHeader("Commands", c),
		cmdRows,
		renderSectionHeader("Options", c),
		`${bar}  ${padVisible(style.cyan("-t, --target <ide>", c), 22, "left")}AI IDE (cursor, claude, copilot, antigravity...)`,
		`${bar}  ${padVisible(style.cyan("-p, --project <dir>", c), 22, "left")}Project folder (default: current directory)`,
		`${bar}  ${padVisible(style.cyan("--all", c), 22, "left")}Install or remove all Skills & Agents`,
		renderSectionHeader("Examples", c),
		`${bar}  ${style.dim("$", c)} ${style.green("skillops add", c)}                                  ${style.dim("— Interactive install", c)}`,
		`${bar}  ${style.dim("$", c)} ${style.green("skillops remove", c)}                               ${style.dim("— Interactive removal", c)}`,
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
	const pillarBadge = formatBadge("info", "LIBRARY", c);

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
