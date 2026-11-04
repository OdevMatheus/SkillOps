/**
 * Charmbracelet Lip Gloss & Bubbles Inspired Terminal Styling Engine (`src/ui/lipgloss.ts`).
 *
 * Zero-dependency TypeScript implementation of Lip Gloss TrueColor (24-bit RGB)
 * palettes, background pills, Bubbles paginator dots, keycap status bars, and
 * ANSI-aware horizontal block composition (`joinHorizontal`).
 */

import { isColorEnabled, padVisible, visibleLength } from "./terminal.js";

const ESC = String.fromCharCode(27);

/**
 * Official Charmbracelet Lip Gloss / Huh / Bubbles inspired TrueColor palette.
 */
export const CHARM_PALETTE = {
	indigo: "#7D56F4",
	fuchsia: "#EE6FF8",
	hotPink: "#F25D94",
	mint: "#04B575",
	amber: "#FFBD2E",
	coral: "#FF5F56",
	cyan: "#00D7FF",
	lavender: "#B4A7D6",
	white: "#FAFAFA",
	muted: "#6C6C6C",
	subtle: "#4A4A4A",
	surface: "#2A2438",
	keycapBg: "#302B3F",
} as const;

export type CharmColorKey = keyof typeof CHARM_PALETTE;

/**
 * Parse a `#RRGGBB` or `#RGB` hex color string into an `[r, g, b]` tuple.
 */
export function hexToRgb(hex: string): readonly [number, number, number] {
	const cleaned = hex.trim().replace(/^#/, "");
	if (cleaned.length === 3) {
		const r = Number.parseInt(`${cleaned[0]}${cleaned[0]}`, 16);
		const g = Number.parseInt(`${cleaned[1]}${cleaned[1]}`, 16);
		const b = Number.parseInt(`${cleaned[2]}${cleaned[2]}`, 16);
		return [
			Number.isNaN(r) ? 255 : r,
			Number.isNaN(g) ? 255 : g,
			Number.isNaN(b) ? 255 : b,
		];
	}
	const r = Number.parseInt(cleaned.slice(0, 2), 16);
	const g = Number.parseInt(cleaned.slice(2, 4), 16);
	const b = Number.parseInt(cleaned.slice(4, 6), 16);
	return [
		Number.isNaN(r) ? 255 : r,
		Number.isNaN(g) ? 255 : g,
		Number.isNaN(b) ? 255 : b,
	];
}

/**
 * Apply 24-bit TrueColor foreground (`\x1b[38;2;R;G;Bm`) when color is enabled.
 */
export function fgHex(hex: string, text: string, enabled?: boolean): string {
	const useColor = enabled ?? isColorEnabled();
	if (!useColor || text.length === 0) {
		return text;
	}
	const [r, g, b] = hexToRgb(hex);
	return `${ESC}[38;2;${r};${g};${b}m${text}${ESC}[39m`;
}

/**
 * Apply 24-bit TrueColor background (`\x1b[48;2;R;G;Bm`) when color is enabled.
 */
export function bgHex(hex: string, text: string, enabled?: boolean): string {
	const useColor = enabled ?? isColorEnabled();
	if (!useColor || text.length === 0) {
		return text;
	}
	const [r, g, b] = hexToRgb(hex);
	return `${ESC}[48;2;${r};${g};${b}m${text}${ESC}[49m`;
}

export interface PillOptions {
	readonly fg?: string;
	readonly bg?: string;
	readonly bold?: boolean;
	readonly colorEnabled?: boolean;
}

/**
 * Render a Lip Gloss background pill badge without altering visible character length.
 */
export function renderPill(text: string, options?: PillOptions): string {
	const useColor = options?.colorEnabled ?? isColorEnabled();
	if (!useColor || text.length === 0) {
		return text;
	}
	const fg = options?.fg ?? CHARM_PALETTE.white;
	const bg = options?.bg ?? CHARM_PALETTE.indigo;
	const bold = options?.bold ?? true;
	let styled = fgHex(fg, text, true);
	styled = bgHex(bg, styled, true);
	if (bold) {
		styled = `${ESC}[1m${styled}${ESC}[22m`;
	}
	return styled;
}

/**
 * Render a Charm `bubbles/help` style keybinding hint (`key action`).
 */
export function renderKeycap(
	keyLabel: string,
	actionLabel: string,
	colorEnabled?: boolean,
): string {
	const useColor = colorEnabled ?? isColorEnabled();
	if (!useColor) {
		return `${keyLabel} ${actionLabel}`;
	}
	const keyStyled = `${ESC}[1m${fgHex(CHARM_PALETTE.lavender, keyLabel, true)}${ESC}[22m`;
	const actionStyled = fgHex(CHARM_PALETTE.muted, actionLabel, true);
	return `${keyStyled} ${actionStyled}`;
}

/**
 * Render Charm `bubbles/paginator` style pagination dots (`• ◦ ◦`).
 */
export function renderPaginationDots(
	currentPage: number,
	totalPages: number,
	colorEnabled?: boolean,
): string {
	const safeTotal = Math.max(1, Math.min(12, totalPages));
	const safeCurrent = Math.max(0, Math.min(safeTotal - 1, currentPage));
	const useColor = colorEnabled ?? isColorEnabled();
	const dots: string[] = [];
	for (let i = 0; i < safeTotal; i++) {
		if (i === safeCurrent) {
			dots.push(
				useColor
					? `${ESC}[1m${fgHex(CHARM_PALETTE.hotPink, "•", true)}${ESC}[22m`
					: "•",
			);
		} else {
			dots.push(useColor ? fgHex(CHARM_PALETTE.muted, "◦", true) : "◦");
		}
	}
	return dots.join(" ");
}

/**
 * Compose two multi-line blocks horizontally (`lipgloss.JoinHorizontal`).
 */
export function joinHorizontal(
	align: "top" | "center" | "bottom",
	leftBlock: string,
	rightBlock: string,
	gap = 2,
): string {
	const leftLines = leftBlock.split("\n");
	const rightLines = rightBlock.split("\n");
	const totalRows = Math.max(leftLines.length, rightLines.length);
	const leftWidth = leftLines.reduce(
		(max, line) => Math.max(max, visibleLength(line)),
		0,
	);
	const gapStr = " ".repeat(Math.max(0, gap));

	const padBlockLines = (lines: string[]): string[] => {
		const diff = totalRows - lines.length;
		if (diff <= 0) {
			return lines;
		}
		if (align === "bottom") {
			return [...Array.from({ length: diff }, () => ""), ...lines];
		}
		if (align === "center") {
			const top = Math.floor(diff / 2);
			const bottom = diff - top;
			return [
				...Array.from({ length: top }, () => ""),
				...lines,
				...Array.from({ length: bottom }, () => ""),
			];
		}
		return [...lines, ...Array.from({ length: diff }, () => "")];
	};

	const paddedLeft = padBlockLines(leftLines);
	const paddedRight = padBlockLines(rightLines);

	const out: string[] = [];
	for (let i = 0; i < totalRows; i++) {
		const l = padVisible(paddedLeft[i] ?? "", leftWidth, "left");
		const r = paddedRight[i] ?? "";
		out.push(r.length > 0 ? `${l}${gapStr}${r}` : l.trimEnd());
	}
	return out.join("\n");
}
