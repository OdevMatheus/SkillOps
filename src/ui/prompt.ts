/**
 * Zero-dependency interactive terminal multi-select prompt (`src/ui/prompt.ts`).
 *
 * Supports keyboard navigation (`↑`/`↓` or `j`/`k`), `Space` to toggle selection,
 * `a` to toggle all, `Enter` to confirm, and `Esc`/`Ctrl+C` to cancel.
 */

import { padVisible, style, visibleLength } from "./terminal.js";

export interface MultiSelectOption {
	readonly value: string;
	readonly label: string;
	readonly kind?: "skill" | "agent" | "ide";
	readonly hint?: string;
	readonly initialSelected?: boolean;
}

export interface MultiSelectState {
	readonly options: readonly MultiSelectOption[];
	readonly cursor: number;
	readonly selected: ReadonlySet<string>;
	readonly status: "active" | "submitted" | "cancelled";
}

export interface RenderMultiSelectOptions {
	readonly subtitle?: string;
	readonly targetHint?: string;
	readonly maxVisible?: number;
	readonly colorEnabled?: boolean;
}

/**
 * Initialize a deterministic multi-select state from a list of options.
 */
export function createMultiSelectState(
	options: readonly MultiSelectOption[],
): MultiSelectState {
	const initial = new Set<string>();
	for (const opt of options) {
		if (opt.initialSelected) {
			initial.add(opt.value);
		}
	}
	return {
		options,
		cursor: 0,
		selected: initial,
		status: "active",
	};
}

/**
 * Pure state reducer for keyboard input in the multi-select TUI.
 */
export function applyMultiSelectKey(
	state: MultiSelectState,
	key: string,
): MultiSelectState {
	if (state.status !== "active" || state.options.length === 0) {
		return state;
	}

	const count = state.options.length;

	// Cancel: Ctrl+C (\x03), Escape (\x1b), or 'q'
	if (key === "\x03" || key === "\x1b" || key === "q" || key === "Q") {
		return {
			...state,
			status: "cancelled",
		};
	}

	// Submit: Enter (\r or \n)
	if (key === "\r" || key === "\n") {
		return {
			...state,
			status: "submitted",
		};
	}

	// Move Up: Up arrow (\x1b[A, \x1bOA) or 'k'
	if (key === "\x1b[A" || key === "\x1bOA" || key === "k" || key === "K") {
		const nextCursor = (state.cursor - 1 + count) % count;
		return {
			...state,
			cursor: nextCursor,
		};
	}

	// Move Down: Down arrow (\x1b[B, \x1bOB) or 'j'
	if (key === "\x1b[B" || key === "\x1bOB" || key === "j" || key === "J") {
		const nextCursor = (state.cursor + 1) % count;
		return {
			...state,
			cursor: nextCursor,
		};
	}

	// Toggle current option: Space (" ")
	if (key === " ") {
		const currentOpt = state.options[state.cursor];
		if (!currentOpt) {
			return state;
		}
		const nextSelected = new Set(state.selected);
		if (nextSelected.has(currentOpt.value)) {
			nextSelected.delete(currentOpt.value);
		} else {
			nextSelected.add(currentOpt.value);
		}
		return {
			...state,
			selected: nextSelected,
		};
	}

	// Toggle all options: 'a' or 'A'
	if (key === "a" || key === "A") {
		const allSelected = state.selected.size === count;
		const nextSelected = new Set<string>();
		if (!allSelected) {
			for (const opt of state.options) {
				nextSelected.add(opt.value);
			}
		}
		return {
			...state,
			selected: nextSelected,
		};
	}

	return state;
}

/**
 * Render a single frame of the multi-select tree prompt (guaranteed <= 78 columns).
 */
export function renderMultiSelectFrame(
	title: string,
	state: MultiSelectState,
	options: RenderMultiSelectOptions = {},
): string {
	const c = options.colorEnabled;
	const bar = style.dim("│", c);
	const maxVisible = options.maxVisible ?? 10;
	const total = state.options.length;

	const header = `${style.bold(style.cyan(`◆ ${title}`, c), c)}`;
	const instructions = `${bar}  ${style.dim("(↑/↓ move · Space select · 'a' toggle all · Enter confirm)", c)}`;

	const lines: string[] = [header];
	if (options.subtitle) {
		lines.push(`${bar}  ${options.subtitle}`);
	}
	lines.push(instructions, bar);

	// Compute sliding window so the prompt never exceeds terminal height
	let startIdx = 0;
	if (total > maxVisible) {
		const half = Math.floor(maxVisible / 2);
		startIdx = Math.max(0, Math.min(state.cursor - half, total - maxVisible));
	}
	const endIdx = Math.min(total, startIdx + maxVisible);

	if (startIdx > 0) {
		lines.push(`${bar}  ${style.dim(`↑ ${startIdx} more above...`, c)}`);
	}

	const maxLabelCols = Math.min(
		26,
		state.options.reduce((m, o) => Math.max(m, visibleLength(o.label)), 14),
	);

	for (let i = startIdx; i < endIdx; i++) {
		const opt = state.options[i];
		if (!opt) continue;
		const isCurrent = i === state.cursor;
		const isChecked = state.selected.has(opt.value);

		const pointer = isCurrent ? style.cyan("❯", c) : " ";
		const checkbox = isChecked ? style.green("◼", c) : style.dim("◻", c);

		const kindTag =
			opt.kind === "skill"
				? style.cyan("skill ", c)
				: opt.kind === "agent"
					? style.magenta("agent ", c)
					: "";

		const labelRaw =
			opt.label.length > maxLabelCols
				? `${opt.label.slice(0, maxLabelCols - 1)}…`
				: opt.label;
		const labelPadded = padVisible(labelRaw, maxLabelCols + 1, "left");
		const styledLabel = isCurrent
			? style.bold(labelPadded, c)
			: isChecked
				? style.green(labelPadded, c)
				: labelPadded;

		const prefixWidth =
			6 +
			(opt.kind === "skill" || opt.kind === "agent" ? 6 : 0) +
			maxLabelCols +
			1;
		const maxHintCols = Math.max(10, 75 - prefixWidth);
		const rawHint = opt.hint ?? "";
		const shortHint =
			rawHint.length > maxHintCols
				? `${rawHint.slice(0, maxHintCols - 1)}…`
				: rawHint;
		const hintPart = shortHint ? ` ${style.dim(shortHint, c)}` : "";

		lines.push(
			`${bar}  ${pointer} ${checkbox} ${kindTag}${styledLabel}${hintPart}`,
		);
	}

	if (endIdx < total) {
		lines.push(`${bar}  ${style.dim(`↓ ${total - endIdx} more below...`, c)}`);
	}

	lines.push(bar);
	const targetSuffix = options.targetHint
		? ` · IDE: ${options.targetHint}`
		: "";
	lines.push(
		`${style.dim("╰─", c)} ${style.bold(`${state.selected.size} selected`, c)}${style.dim(`${targetSuffix} — Enter to import`, c)}`,
	);

	return lines.join("\n");
}

/**
 * Run an interactive multi-select prompt in a TTY terminal.
 * Returns the array of selected values, or `null` if cancelled by user.
 */
export async function runMultiSelectPrompt(
	title: string,
	options: readonly MultiSelectOption[],
	renderOpts: RenderMultiSelectOptions = {},
): Promise<string[] | null> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return null;
	}

	let state = createMultiSelectState(options);
	let renderedLineCount = 0;

	const render = () => {
		const frame = renderMultiSelectFrame(title, state, renderOpts);
		if (renderedLineCount > 0) {
			process.stdout.write(`\x1b[${renderedLineCount}A\x1b[J`);
		}
		process.stdout.write(`${frame}\n`);
		renderedLineCount = frame.split("\n").length;
	};

	return new Promise<string[] | null>((resolve) => {
		const stdin = process.stdin;
		const wasRaw = stdin.isRaw;
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf-8");

		// Hide cursor while navigating
		process.stdout.write("\x1b[?25l");
		render();

		const cleanup = () => {
			stdin.removeListener("data", onData);
			if (stdin.isTTY) {
				stdin.setRawMode(Boolean(wasRaw));
			}
			stdin.pause();
			process.stdout.write("\x1b[?25h");
		};

		const onData = (chunk: string | Buffer) => {
			const key = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
			state = applyMultiSelectKey(state, key);

			if (state.status === "cancelled") {
				if (renderedLineCount > 0) {
					process.stdout.write(`\x1b[${renderedLineCount}A\x1b[J`);
				}
				cleanup();
				resolve(null);
				return;
			}

			if (state.status === "submitted") {
				if (renderedLineCount > 0) {
					process.stdout.write(`\x1b[${renderedLineCount}A\x1b[J`);
				}
				cleanup();
				resolve([...state.selected]);
				return;
			}

			render();
		};

		stdin.on("data", onData);
	});
}
