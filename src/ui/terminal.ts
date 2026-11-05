/**
 * SkillOps Zero-Dependency Terminal UI (TUI) Aesthetic Engine.
 *
 * Provides ANSI styling with automatic TTY / NO_COLOR / FORCE_COLOR awareness,
 * Unicode rounded panels, ANSI-aware aligned multi-column tables, visual token
 * budget progress bars, step indicators, AI invocation guides, and fuzzy
 * Levenshtein command suggestions.
 */

import { SKILLOPS_VERSION } from "../models.js";
import { CHARM_PALETTE, fgHex, renderPill } from "./lipgloss.js";

const ESC = String.fromCharCode(27);
const ANSI_ESCAPE_REGEX = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

export interface ColorOverrideOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly isTTY?: boolean;
}

/**
 * Determine whether ANSI terminal colors should be emitted.
 * Respects https://no-color.org (`NO_COLOR`), `FORCE_COLOR`, `TERM=dumb`, and `stdout.isTTY`.
 */
export function isColorEnabled(options?: ColorOverrideOptions): boolean {
	const env = options?.env ?? process.env;
	const isTTY = options?.isTTY ?? Boolean(process.stdout?.isTTY);

	if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") {
		return false;
	}
	if (env.FORCE_COLOR !== undefined) {
		const val = env.FORCE_COLOR.trim().toLowerCase();
		if (val === "0" || val === "false") {
			return false;
		}
		if (val === "1" || val === "2" || val === "3" || val === "true") {
			return true;
		}
	}
	if (env.TERM === "dumb") {
		return false;
	}
	return isTTY;
}

function wrapAnsi(
	openCode: string,
	closeCode: string,
	text: string,
	enabled?: boolean,
): string {
	const useColor = enabled ?? isColorEnabled();
	if (!useColor || text.length === 0) {
		return text;
	}
	return `${ESC}[${openCode}m${text}${ESC}[${closeCode}m`;
}

export const style = {
	bold: (text: string, enabled?: boolean): string =>
		wrapAnsi("1", "22", text, enabled),
	dim: (text: string, enabled?: boolean): string =>
		wrapAnsi("2", "22", text, enabled),
	italic: (text: string, enabled?: boolean): string =>
		wrapAnsi("3", "23", text, enabled),
	underline: (text: string, enabled?: boolean): string =>
		wrapAnsi("4", "24", text, enabled),
	cyan: (text: string, enabled?: boolean): string =>
		fgHex(CHARM_PALETTE.cyan, text, enabled),
	green: (text: string, enabled?: boolean): string =>
		fgHex(CHARM_PALETTE.mint, text, enabled),
	yellow: (text: string, enabled?: boolean): string =>
		fgHex(CHARM_PALETTE.amber, text, enabled),
	red: (text: string, enabled?: boolean): string =>
		fgHex(CHARM_PALETTE.coral, text, enabled),
	magenta: (text: string, enabled?: boolean): string =>
		fgHex(CHARM_PALETTE.fuchsia, text, enabled),
	blue: (text: string, enabled?: boolean): string =>
		fgHex(CHARM_PALETTE.indigo, text, enabled),
	gray: (text: string, enabled?: boolean): string =>
		fgHex(CHARM_PALETTE.muted, text, enabled),
	white: (text: string, enabled?: boolean): string =>
		fgHex(CHARM_PALETTE.white, text, enabled),
};

/**
 * Strip all ANSI SGR escape sequences from a string.
 */
export function stripAnsi(text: string): string {
	return text.replace(ANSI_ESCAPE_REGEX, "");
}

/**
 * Compute visible character width of a string ignoring ANSI color codes.
 */
export function visibleLength(text: string): number {
	return Array.from(stripAnsi(text)).length;
}

/**
 * Pad a potentially ANSI-styled string to a target visible width.
 */
export function padVisible(
	text: string,
	width: number,
	align: "left" | "right" | "center" = "left",
): string {
	const len = visibleLength(text);
	if (len >= width) {
		return text;
	}
	const diff = width - len;
	if (align === "right") {
		return `${" ".repeat(diff)}${text}`;
	}
	if (align === "center") {
		const left = Math.floor(diff / 2);
		const right = diff - left;
		return `${" ".repeat(left)}${text}${" ".repeat(right)}`;
	}
	return `${text}${" ".repeat(diff)}`;
}

export interface BoxOptions {
	readonly title?: string;
	readonly borderColor?: (text: string, enabled?: boolean) => string;
	readonly paddingX?: number;
	readonly minWidth?: number;
	readonly colorEnabled?: boolean;
}

/**
 * Render a rounded Unicode panel (`╭───╮ │ ╰───╯`).
 */
export function renderBox(
	lines: readonly string[],
	options?: BoxOptions,
): string {
	const paddingX = options?.paddingX ?? 2;
	const minWidth = options?.minWidth ?? 36;
	const colorEnabled = options?.colorEnabled;
	const borderFn = options?.borderColor ?? style.blue;

	const titleText = options?.title ? ` ${options.title.trim()} ` : "";
	const titleVisibleLen = visibleLength(titleText);

	const maxLineLen = lines.reduce(
		(max, line) => Math.max(max, visibleLength(line)),
		0,
	);
	const innerWidth = Math.max(
		minWidth,
		maxLineLen + paddingX * 2,
		titleVisibleLen + 4,
	);
	const contentWidth = innerWidth - paddingX * 2;

	const padStr = " ".repeat(paddingX);
	const topBorder =
		titleVisibleLen > 0
			? `${borderFn("╭─", colorEnabled)}${style.bold(titleText, colorEnabled)}${borderFn(`${"─".repeat(Math.max(1, innerWidth - titleVisibleLen - 1))}╮`, colorEnabled)}`
			: borderFn(`╭${"─".repeat(innerWidth)}╮`, colorEnabled);

	const bodyLines = lines.map((line) => {
		const padded = padVisible(line, contentWidth, "left");
		return `${borderFn("│", colorEnabled)}${padStr}${padded}${padStr}${borderFn("│", colorEnabled)}`;
	});

	const bottomBorder = borderFn(`╰${"─".repeat(innerWidth)}╯`, colorEnabled);
	return [topBorder, ...bodyLines, bottomBorder].join("\n");
}

/**
 * Render the official SkillOps Framework & Library top header line (clean tree root).
 */
export function renderHeaderBanner(
	subtitle = "Framework & Library for AI Skills & Subagents",
	options?: { version?: string; colorEnabled?: boolean },
): string {
	const ver = options?.version ?? SKILLOPS_VERSION;
	const c = options?.colorEnabled;
	const brandPill = renderPill(`◆ SkillOps v${ver}`, {
		fg: CHARM_PALETTE.white,
		bg: CHARM_PALETTE.indigo,
		bold: true,
		colorEnabled: c,
	});
	return `${brandPill} ${style.dim("—", c)} ${fgHex(CHARM_PALETTE.lavender, subtitle, c)}`;
}

export interface TableOptions {
	readonly align?: readonly ("left" | "right" | "center")[];
	readonly indent?: number;
	readonly colorEnabled?: boolean;
}

/**
 * Render an ANSI-aware multi-column aligned table with Unicode header rules.
 */
export function renderTable(
	headers: readonly string[],
	rows: readonly (readonly string[])[],
	options?: TableOptions,
): string {
	const indent = " ".repeat(options?.indent ?? 2);
	const c = options?.colorEnabled;
	const colCount = headers.length;
	const widths: number[] = headers.map((h) => visibleLength(h));

	for (const row of rows) {
		for (let i = 0; i < colCount; i++) {
			const cell = row[i] ?? "";
			widths[i] = Math.max(widths[i] ?? 0, visibleLength(cell));
		}
	}

	const aligns = options?.align ?? headers.map(() => "left" as const);

	const headerLine = headers
		.map((h, i) =>
			style.bold(
				style.cyan(padVisible(h, widths[i] ?? 0, aligns[i] ?? "left"), c),
				c,
			),
		)
		.join("  ");

	const separatorLine = widths
		.map((w) => style.dim("─".repeat(Math.max(1, w)), c))
		.join("  ");

	const bodyLines = rows.map((row) =>
		headers
			.map((_, i) =>
				padVisible(row[i] ?? "", widths[i] ?? 0, aligns[i] ?? "left"),
			)
			.join("  "),
	);

	return [
		`${indent}${headerLine}`,
		`${indent}${separatorLine}`,
		...bodyLines.map((line) => `${indent}${line}`),
	].join("\n");
}

/**
 * Render a clean minimalist tree section header (`├─ Title`).
 */
export function renderSectionHeader(
	title: string,
	colorEnabled?: boolean,
): string {
	const c = colorEnabled;
	return `${style.dim("│", c)}\n${style.dim("├─", c)} ${style.bold(style.cyan(title, c), c)}`;
}

export type BadgeType =
	| "pass"
	| "warn"
	| "fail"
	| "info"
	| "skill"
	| "subagent";

/**
 * Render a semantic status or artifact badge.
 */
export function formatBadge(
	type: BadgeType,
	customLabel?: string,
	colorEnabled?: boolean,
): string {
	switch (type) {
		case "pass":
			return style.bold(
				style.green(`✔ ${customLabel ?? "PASS"}`, colorEnabled),
				colorEnabled,
			);
		case "warn":
			return style.bold(
				style.yellow(`⚠ ${customLabel ?? "WARN"}`, colorEnabled),
				colorEnabled,
			);
		case "fail":
			return style.bold(
				style.red(`✖ ${customLabel ?? "FAIL"}`, colorEnabled),
				colorEnabled,
			);
		case "info":
			return style.bold(
				style.cyan(`ℹ ${customLabel ?? "INFO"}`, colorEnabled),
				colorEnabled,
			);
		case "skill":
			return renderPill(`[${customLabel ?? "SKILL"}]`, {
				fg: CHARM_PALETTE.white,
				bg: CHARM_PALETTE.indigo,
				bold: true,
				colorEnabled,
			});
		case "subagent":
			return renderPill(`[${customLabel ?? "SUBAGENT"}]`, {
				fg: CHARM_PALETTE.white,
				bg: CHARM_PALETTE.hotPink,
				bold: true,
				colorEnabled,
			});
	}
}

export interface NextStepHint {
	readonly command: string;
	readonly description: string;
}

/**
 * Render an actionable "Next Steps" tree footer guiding the developer on what to run next.
 */
export function renderNextSteps(
	hints: readonly NextStepHint[],
	colorEnabled?: boolean,
): string {
	if (hints.length === 0) {
		return "";
	}
	const c = colorEnabled;
	const maxCmdLen = Math.min(
		44,
		hints.reduce((m, h) => Math.max(m, visibleLength(h.command)), 0),
	);
	const lines = [
		style.dim("│", c),
		`${style.dim("╰─", c)} ${style.bold(style.cyan("Next Steps:", c), c)}`,
		...hints.map((h) => {
			const cmdPadded = padVisible(h.command, maxCmdLen, "left");
			const prefixCols = 5 + visibleLength(cmdPadded) + 3;
			const maxDescCols = Math.max(10, 76 - prefixCols);
			const desc =
				h.description.length > maxDescCols
					? `${h.description.slice(0, maxDescCols - 1)}…`
					: h.description;
			return `   ${style.dim("$", c)} ${style.green(cmdPadded, c)} ${style.dim(`— ${desc}`, c)}`;
		}),
	];
	return `${lines.join("\n")}\n`;
}

/**
 * Render a compact, emoji-free tree guide explaining how to invoke installed Skills & Subagents.
 */
export function renderAiUsageGuide(
	targets: readonly string[],
	skills: readonly string[],
	subagents: readonly string[],
	colorEnabled?: boolean,
): string {
	const c = colorEnabled;
	const sampleSkill = skills[0] ?? "systematic-debugging";
	const sampleAgent = subagents[0] ?? "context-scout";
	const bar = style.dim("│", c);
	const lines: string[] = [
		bar,
		`${style.dim("├─", c)} ${style.bold(style.cyan("Using Your Skills & Subagents", c), c)}`,
	];

	const targetSet = new Set(targets);
	if (targetSet.has("claude") || targetSet.size === 0) {
		lines.push(
			`${bar}  • ${style.bold("Claude Code:", c)} Auto-routed (${sampleSkill}) or @${sampleAgent}`,
		);
	}
	if (targetSet.has("cursor")) {
		lines.push(
			`${bar}  • ${style.bold("Cursor IDE:", c)} Type ${style.cyan(`@${sampleSkill}`, c)} in Chat (.cursor/rules/)`,
		);
	}
	if (targetSet.has("antigravity")) {
		lines.push(
			`${bar}  • ${style.bold("Antigravity:", c)} Auto-activated (.agent/skills/${sampleSkill})`,
		);
	}
	if (targetSet.has("copilot")) {
		lines.push(
			`${bar}  • ${style.bold("Copilot:", c)} Use ${style.cyan(`/${sampleSkill}`, c)} in Chat (.github/instructions/)`,
		);
	}
	if (
		targetSet.has("windsurf") ||
		targetSet.has("cline") ||
		targetSet.has("roocode") ||
		targetSet.has("kilocode")
	) {
		lines.push(
			`${bar}  • ${style.bold("Windsurf/Cline/Roo/Kilo:", c)} Workspace rules load automatically`,
		);
	}

	return lines.join("\n");
}

/**
 * Compute Levenshtein edit distance between two strings for typo suggestions.
 */
export function levenshteinDistance(a: string, b: string): number {
	const s1 = a.toLowerCase();
	const s2 = b.toLowerCase();
	const m = s1.length;
	const n = s2.length;
	let prevRow: number[] = Array.from({ length: n + 1 }, (_, j) => j);

	for (let i = 1; i <= m; i++) {
		const currRow: number[] = [i];
		for (let j = 1; j <= n; j++) {
			const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
			const deletion = (prevRow[j] ?? 0) + 1;
			const insertion = (currRow[j - 1] ?? 0) + 1;
			const substitution = (prevRow[j - 1] ?? 0) + cost;
			currRow[j] = Math.min(deletion, insertion, substitution);
		}
		prevRow = currRow;
	}
	return prevRow[n] ?? 0;
}

export const DEFAULT_VALID_COMMANDS: readonly string[] = [
	"add",
	"install",
	"remove",
	"uninstall",
	"rm",
];

/**
 * Suggest the closest valid CLI command when a user makes a typo.
 */
export function suggestCommand(
	unknownCommand: string,
	validCommands: readonly string[] = DEFAULT_VALID_COMMANDS,
): string | null {
	const needle = unknownCommand.trim().toLowerCase();
	if (!needle) {
		return null;
	}

	for (const candidate of validCommands) {
		if (candidate.startsWith(needle) || needle.startsWith(candidate)) {
			return candidate;
		}
	}

	let bestMatch: string | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const candidate of validCommands) {
		const dist = levenshteinDistance(needle, candidate);
		if (dist < bestDistance) {
			bestDistance = dist;
			bestMatch = candidate;
		}
	}

	const maxAllowedDistance = Math.max(2, Math.floor(needle.length * 0.45));
	return bestDistance <= maxAllowedDistance ? bestMatch : null;
}
