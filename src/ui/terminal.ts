/**
 * SkillOps Zero-Dependency Terminal UI (TUI) Aesthetic Engine.
 *
 * Provides ANSI styling with automatic TTY / NO_COLOR / FORCE_COLOR awareness,
 * Unicode rounded panels, ANSI-aware aligned multi-column tables, visual token
 * budget progress bars, step indicators, AI invocation guides, and fuzzy
 * Levenshtein command suggestions.
 */

import { SKILLOPS_VERSION } from "../models.js";

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
		wrapAnsi("36", "39", text, enabled),
	green: (text: string, enabled?: boolean): string =>
		wrapAnsi("32", "39", text, enabled),
	yellow: (text: string, enabled?: boolean): string =>
		wrapAnsi("33", "39", text, enabled),
	red: (text: string, enabled?: boolean): string =>
		wrapAnsi("31", "39", text, enabled),
	magenta: (text: string, enabled?: boolean): string =>
		wrapAnsi("35", "39", text, enabled),
	blue: (text: string, enabled?: boolean): string =>
		wrapAnsi("34", "39", text, enabled),
	gray: (text: string, enabled?: boolean): string =>
		wrapAnsi("90", "39", text, enabled),
	white: (text: string, enabled?: boolean): string =>
		wrapAnsi("37", "39", text, enabled),
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
	const minWidth = options?.minWidth ?? 64;
	const colorEnabled = options?.colorEnabled;
	const borderFn = options?.borderColor ?? style.cyan;

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
 * Render the official SkillOps Framework & Library top banner.
 */
export function renderHeaderBanner(
	subtitle = "Framework & Library for High-End AI Coding Skills & Subagents",
	options?: { version?: string; colorEnabled?: boolean },
): string {
	const ver = options?.version ?? SKILLOPS_VERSION;
	const c = options?.colorEnabled;
	const headline = `${style.bold(style.cyan(`⚡ SkillOps v${ver}`, c), c)} ${style.dim("—", c)} ${subtitle}`;
	return renderBox([headline], {
		borderColor: style.cyan,
		paddingX: 2,
		minWidth: 72,
		colorEnabled: c,
	});
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

export interface TokenBarOptions {
	readonly width?: number;
	readonly label?: string;
	readonly unit?: string;
	readonly colorEnabled?: boolean;
}

/**
 * Render a visual token budget progress bar (`[████████░░░░░░░░] 48.0% (720 / 1,500 tokens)`).
 */
export function renderTokenBar(
	current: number,
	max: number,
	options?: TokenBarOptions,
): string {
	const width = options?.width ?? 18;
	const unit = options?.unit ?? "tokens";
	const c = options?.colorEnabled;
	const safeMax = max > 0 ? max : 1;
	const ratio = Math.max(0, current / safeMax);
	const clampedRatio = Math.min(1, ratio);
	const filledCount = Math.round(clampedRatio * width);
	const emptyCount = Math.max(0, width - filledCount);

	const colorFn =
		ratio > 1 ? style.red : ratio > 0.85 ? style.yellow : style.green;

	const filledStr = colorFn("█".repeat(filledCount), c);
	const emptyStr = style.dim("░".repeat(emptyCount), c);
	const pctStr = `${(ratio * 100).toFixed(1)}%`;
	const prefix = options?.label ? `${style.bold(options.label, c)} ` : "";

	return `${prefix}[${filledStr}${emptyStr}] ${style.bold(pctStr, c)} (${current} / ${max} ${unit})`;
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
			return style.bold(
				style.cyan(`[${customLabel ?? "SKILL"}]`, colorEnabled),
				colorEnabled,
			);
		case "subagent":
			return style.bold(
				style.magenta(`[${customLabel ?? "SUBAGENT"}]`, colorEnabled),
				colorEnabled,
			);
	}
}

/**
 * Render a numbered onboarding step line (`  ✔ [1/4] Title — Detail`).
 */
export function renderStep(
	step: number,
	total: number,
	title: string,
	detail?: string,
	status: "done" | "warn" | "skip" = "done",
	colorEnabled?: boolean,
): string {
	const icon =
		status === "done"
			? style.green("✔", colorEnabled)
			: status === "warn"
				? style.yellow("⚠", colorEnabled)
				: style.dim("○", colorEnabled);
	const stepBadge = style.dim(`[${step}/${total}]`, colorEnabled);
	const titleStyled = style.bold(padVisible(title, 28, "left"), colorEnabled);
	const detailStyled = detail
		? ` ${style.dim("•", colorEnabled)} ${detail}`
		: "";
	return `  ${icon} ${stepBadge} ${titleStyled}${detailStyled}`;
}

export interface NextStepHint {
	readonly command: string;
	readonly description: string;
}

/**
 * Render an actionable "Next steps" footer guiding the developer on what to run next.
 */
export function renderNextSteps(
	hints: readonly NextStepHint[],
	colorEnabled?: boolean,
): string {
	if (hints.length === 0) {
		return "";
	}
	const c = colorEnabled;
	const maxCmdLen = hints.reduce(
		(m, h) => Math.max(m, visibleLength(h.command)),
		0,
	);
	const lines = [
		"",
		`  ${style.bold(style.cyan("💡 Next Steps:", c), c)}`,
		...hints.map(
			(h) =>
				`     ${style.green(padVisible(h.command, maxCmdLen + 2, "left"), c)} ${style.dim(`# ${h.description}`, c)}`,
		),
		"",
	];
	return lines.join("\n");
}

/**
 * Render a practical guide explaining how to invoke installed Skills & Subagents inside the user's AI coding agents.
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
	const lines: string[] = [
		`${style.bold("How to use your installed Skills & Subagents inside your AI:", c)}`,
		"",
	];

	const targetSet = new Set(targets);
	if (targetSet.has("claude") || targetSet.size === 0) {
		lines.push(
			`• ${style.bold("Claude Code:", c)} Ask naturally (auto-routed via .claude/skills/${sampleSkill}/SKILL.md) or delegate to @${sampleAgent}`,
		);
	}
	if (targetSet.has("cursor")) {
		lines.push(
			`• ${style.bold("Cursor IDE:", c)} Type ${style.cyan(`@${sampleSkill}`, c)} in Cursor Chat/Composer or let .cursor/rules/${sampleSkill}.mdc auto-attach`,
		);
	}
	if (targetSet.has("antigravity")) {
		lines.push(
			`• ${style.bold("Antigravity / Gemini:", c)} Auto-activated from .agent/skills/${sampleSkill}/SKILL.md when your prompt matches its domain`,
		);
	}
	if (targetSet.has("copilot")) {
		lines.push(
			`• ${style.bold("GitHub Copilot:", c)} Use ${style.cyan(`/${sampleSkill}`, c)} prompt in Copilot Chat or reference .github/instructions/${sampleSkill}.instructions.md`,
		);
	}
	if (
		targetSet.has("windsurf") ||
		targetSet.has("cline") ||
		targetSet.has("roocode") ||
		targetSet.has("kilocode")
	) {
		lines.push(
			`• ${style.bold("Windsurf / Cline / Roo / Kilo:", c)} Rules in .windsurf/rules/, .clinerules/, .roo/rules/, .kilocode/rules/ activate automatically`,
		);
	}
	lines.push(
		`• ${style.bold("Inspect any Skill/Agent:", c)} Run ${style.green(`npx skillops-cli info ${sampleSkill}`, c)} to view triggers, L3 scripts & prompts`,
	);

	return renderBox(lines, {
		title: "🚀 Using Your Skills & Subagents",
		borderColor: style.green,
		paddingX: 2,
		minWidth: 72,
		colorEnabled: c,
	});
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

/**
 * Suggest the closest valid CLI command when a user makes a typo.
 */
export function suggestCommand(
	unknownCommand: string,
	validCommands: readonly string[],
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
