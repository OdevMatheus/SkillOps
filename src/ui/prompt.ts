/**
 * Zero-dependency interactive terminal multi-select prompt (`src/ui/prompt.ts`).
 *
 * Supports:
 * - Horizontal tabs (`←`/`→` or `Tab`) separating `Skills` and `Agents`
 * - Vertical navigation (`↑`/`↓` or `j`/`k`)
 * - Real-time keyword filtering (`/` to search, `Backspace` to edit, `Esc` to clear)
 * - `Space` to toggle selection across tabs, `a` to toggle all in current tab, `Enter` to confirm
 */

import { padVisible, style, visibleLength } from "./terminal.js";

export type MultiSelectTab = "skill" | "agent";

export interface MultiSelectOption {
	readonly value: string;
	readonly label: string;
	readonly kind?: "skill" | "agent" | "ide";
	readonly tab?: MultiSelectTab;
	readonly hint?: string;
	readonly initialSelected?: boolean;
}

export interface MultiSelectState {
	readonly options: readonly MultiSelectOption[];
	readonly activeTab: MultiSelectTab;
	readonly cursor: number;
	readonly selected: ReadonlySet<string>;
	readonly searchMode: boolean;
	readonly searchQuery: string;
	readonly status: "active" | "submitted" | "cancelled";
}

export interface ApplyMultiSelectKeyOptions {
	readonly selectCursorOnEmptySubmit?: boolean;
}

export interface RenderMultiSelectOptions {
	readonly subtitle?: string;
	readonly targetHint?: string;
	readonly tabLabels?: {
		readonly skill: string;
		readonly agent: string;
	};
	readonly submitActionLabel?: string;
	readonly selectCursorOnEmptySubmit?: boolean;
	readonly maxVisible?: number;
	readonly colorEnabled?: boolean;
}

function optionMatchesTab(
	opt: MultiSelectOption,
	tab: MultiSelectTab,
): boolean {
	if (opt.tab) {
		return opt.tab === tab;
	}
	if (opt.kind === "agent") {
		return tab === "agent";
	}
	return tab === "skill";
}

function optionMatchesQuery(opt: MultiSelectOption, rawQuery: string): boolean {
	const q = rawQuery.trim().toLowerCase();
	if (!q) {
		return true;
	}
	return (
		opt.label.toLowerCase().includes(q) ||
		opt.value.toLowerCase().includes(q) ||
		(opt.hint ?? "").toLowerCase().includes(q)
	);
}

/**
 * Return the filtered options for a given tab (`skill` or `agent`) and active `searchQuery`.
 */
export function getFilteredTabOptions(
	state: MultiSelectState,
	tab: MultiSelectTab = state.activeTab,
): MultiSelectOption[] {
	return state.options.filter(
		(opt) =>
			optionMatchesTab(opt, tab) && optionMatchesQuery(opt, state.searchQuery),
	);
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
	const hasSkills = options.some((opt) => optionMatchesTab(opt, "skill"));
	return {
		options,
		activeTab: hasSkills ? "skill" : "agent",
		cursor: 0,
		selected: initial,
		searchMode: false,
		searchQuery: "",
		status: "active",
	};
}

/**
 * Pure state reducer for keyboard input in the tabbed + searchable multi-select TUI.
 */
export function applyMultiSelectKey(
	state: MultiSelectState,
	key: string,
	options: ApplyMultiSelectKeyOptions = {},
): MultiSelectState {
	if (state.status !== "active" || state.options.length === 0) {
		return state;
	}

	// Hard cancel: Ctrl+C (\x03)
	if (key === "\x03") {
		return {
			...state,
			status: "cancelled",
		};
	}

	// Escape (\x1b): clear search if active, otherwise cancel prompt
	if (key === "\x1b") {
		if (state.searchMode || state.searchQuery.length > 0) {
			return {
				...state,
				searchMode: false,
				searchQuery: "",
				cursor: 0,
			};
		}
		return {
			...state,
			status: "cancelled",
		};
	}

	// Submit: Enter (\r or \n)
	if (key === "\r" || key === "\n") {
		let finalSelected = state.selected;
		if (options.selectCursorOnEmptySubmit && state.selected.size === 0) {
			const visibleOnSubmit = getFilteredTabOptions(state, state.activeTab);
			const currentOpt = visibleOnSubmit[state.cursor];
			if (currentOpt) {
				finalSelected = new Set([currentOpt.value]);
			}
		}
		return {
			...state,
			selected: finalSelected,
			searchMode: false,
			status: "submitted",
		};
	}

	// Switch Tab: Left (\x1b[D, \x1bOD), Right (\x1b[C, \x1bOC), or Tab (\t)
	if (
		key === "\x1b[D" ||
		key === "\x1bOD" ||
		key === "\x1b[C" ||
		key === "\x1bOC" ||
		key === "\t" ||
		(!state.searchMode &&
			(key === "h" || key === "H" || key === "l" || key === "L"))
	) {
		const nextTab: MultiSelectTab =
			state.activeTab === "skill" ? "agent" : "skill";
		const hasNextTabOptions = state.options.some((opt) =>
			optionMatchesTab(opt, nextTab),
		);
		if (!hasNextTabOptions) {
			return state;
		}
		return {
			...state,
			activeTab: nextTab,
			cursor: 0,
		};
	}

	const visible = getFilteredTabOptions(state, state.activeTab);
	const count = visible.length;

	// Move Up: Up arrow (\x1b[A, \x1bOA) or 'k' (when not typing search)
	if (
		key === "\x1b[A" ||
		key === "\x1bOA" ||
		(!state.searchMode && (key === "k" || key === "K"))
	) {
		if (count === 0) {
			return state;
		}
		const nextCursor = (state.cursor - 1 + count) % count;
		return {
			...state,
			cursor: nextCursor,
		};
	}

	// Move Down: Down arrow (\x1b[B, \x1bOB) or 'j' (when not typing search)
	if (
		key === "\x1b[B" ||
		key === "\x1bOB" ||
		(!state.searchMode && (key === "j" || key === "J"))
	) {
		if (count === 0) {
			return state;
		}
		const nextCursor = (state.cursor + 1) % count;
		return {
			...state,
			cursor: nextCursor,
		};
	}

	// Toggle current option: Space (" ")
	if (key === " ") {
		const currentOpt = visible[state.cursor];
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

	// Search Mode input handling
	if (state.searchMode) {
		// Backspace (\x7f or \b)
		if (key === "\x7f" || key === "\b") {
			if (state.searchQuery.length === 0) {
				return {
					...state,
					searchMode: false,
					cursor: 0,
				};
			}
			const nextQuery = state.searchQuery.slice(0, -1);
			return {
				...state,
				searchQuery: nextQuery,
				cursor: 0,
			};
		}

		// Printable search character (letters, digits, hyphen, underscore, dot)
		if (/^[a-zA-Z0-9_.-]$/.test(key)) {
			const nextQuery = `${state.searchQuery}${key}`;
			const nextState: MultiSelectState = {
				...state,
				searchQuery: nextQuery,
				cursor: 0,
			};
			// Auto-switch tab if current tab has 0 matches and the other tab has matches
			const currentMatches = getFilteredTabOptions(nextState, state.activeTab);
			if (currentMatches.length === 0) {
				const otherTab: MultiSelectTab =
					state.activeTab === "skill" ? "agent" : "skill";
				const otherMatches = getFilteredTabOptions(nextState, otherTab);
				if (otherMatches.length > 0) {
					return {
						...nextState,
						activeTab: otherTab,
					};
				}
			}
			return nextState;
		}

		return state;
	}

	// Activate search mode: '/'
	if (key === "/") {
		return {
			...state,
			searchMode: true,
			cursor: 0,
		};
	}

	// Quit when not in search mode: 'q' or 'Q'
	if (key === "q" || key === "Q") {
		return {
			...state,
			status: "cancelled",
		};
	}

	// Toggle all options in active tab: 'a' or 'A'
	if (key === "a" || key === "A") {
		if (visible.length === 0) {
			return state;
		}
		const allTabSelected = visible.every((opt) =>
			state.selected.has(opt.value),
		);
		const nextSelected = new Set(state.selected);
		if (allTabSelected) {
			for (const opt of visible) {
				nextSelected.delete(opt.value);
			}
		} else {
			for (const opt of visible) {
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
 * Render a single frame of the tabbed + searchable multi-select tree prompt (guaranteed <= 78 columns).
 */
export function renderMultiSelectFrame(
	title: string,
	state: MultiSelectState,
	options: RenderMultiSelectOptions = {},
): string {
	const c = options.colorEnabled;
	const bar = style.dim("│", c);
	const maxVisible = options.maxVisible ?? 10;

	const totalSkills = state.options.filter((o) =>
		optionMatchesTab(o, "skill"),
	).length;
	const totalAgents = state.options.filter((o) =>
		optionMatchesTab(o, "agent"),
	).length;
	const filteredSkills = getFilteredTabOptions(state, "skill");
	const filteredAgents = getFilteredTabOptions(state, "agent");
	const visible = state.activeTab === "skill" ? filteredSkills : filteredAgents;
	const total = visible.length;

	const skillTabTitle = options.tabLabels?.skill ?? "Skills";
	const agentTabTitle = options.tabLabels?.agent ?? "Agents";
	const submitVerb = options.submitActionLabel ?? "import";
	const isSinglePage = totalAgents === 0 || totalSkills === 0;

	const header = `${style.bold(style.cyan(`◆ ${title}`, c), c)}`;
	const tabHint = isSinglePage ? "" : " · ←/→ tab";
	const instructions = state.searchMode
		? `${bar}  ${style.dim(`↑/↓ move${tabHint} · Space select · Esc clear · Enter ${submitVerb}`, c)}`
		: `${bar}  ${style.dim(`↑/↓ move${tabHint} · Space select · / search · a all · Enter ${submitVerb}`, c)}`;

	const lines: string[] = [header];
	if (options.subtitle) {
		lines.push(`${bar}  ${options.subtitle}`);
	}
	lines.push(instructions, bar);

	// Render horizontal Tabs + Search bar
	const hasQuery = state.searchQuery.length > 0;
	const skillCountStr = hasQuery
		? `${filteredSkills.length}/${totalSkills}`
		: `${totalSkills}`;
	const agentCountStr = hasQuery
		? `${filteredAgents.length}/${totalAgents}`
		: `${totalAgents}`;

	const skillTabLabel =
		state.activeTab === "skill"
			? style.bold(
					style.cyan(`[ ◆ ${skillTabTitle} (${skillCountStr}) ]`, c),
					c,
				)
			: style.dim(`○ ${skillTabTitle} (${skillCountStr})`, c);
	const agentTabLabel =
		state.activeTab === "agent"
			? style.bold(
					style.magenta(`[ ◆ ${agentTabTitle} (${agentCountStr}) ]`, c),
					c,
				)
			: style.dim(`○ ${agentTabTitle} (${agentCountStr})`, c);

	const rawQuerySlice =
		state.searchQuery.length > 14
			? `…${state.searchQuery.slice(-13)}`
			: state.searchQuery;
	const searchSuffix =
		state.searchMode || hasQuery
			? `   ${style.yellow(`/ Filter: ${rawQuerySlice}${state.searchMode ? "█" : ""}`, c)}`
			: `   ${style.dim("(/ search)", c)}`;

	const singleTabLabel = totalSkills > 0 ? skillTabLabel : agentTabLabel;

	lines.push(
		isSinglePage
			? `${style.dim("├─", c)} ${singleTabLabel}${searchSuffix}`
			: `${style.dim("├─", c)} ${skillTabLabel}   ${agentTabLabel}${searchSuffix}`,
		bar,
	);

	if (total === 0) {
		const tabName = state.activeTab === "skill" ? skillTabTitle : agentTabTitle;
		lines.push(
			`${bar}  ${style.dim(`No ${tabName} match "${state.searchQuery}". Press Esc to clear filter.`, c)}`,
		);
	} else {
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
			visible.reduce((m, o) => Math.max(m, visibleLength(o.label)), 14),
		);

		for (let i = startIdx; i < endIdx; i++) {
			const opt = visible[i];
			if (!opt) continue;
			const isCurrent = i === state.cursor;
			const isChecked = state.selected.has(opt.value);

			const pointer = isCurrent ? style.cyan("❯", c) : " ";
			const checkbox = isChecked ? style.green("◉", c) : style.dim("◯", c);

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

			const prefixWidth = 7 + maxLabelCols + 1;
			const maxHintCols = Math.max(10, 76 - prefixWidth);
			const rawHint = opt.hint ?? "";
			const shortHint =
				rawHint.length > maxHintCols
					? `${rawHint.slice(0, maxHintCols - 1)}…`
					: rawHint;
			const hintPart = shortHint ? ` ${style.dim(shortHint, c)}` : "";

			lines.push(`${bar}  ${pointer} ${checkbox} ${styledLabel}${hintPart}`);
		}

		if (endIdx < total) {
			lines.push(
				`${bar}  ${style.dim(`↓ ${total - endIdx} more below...`, c)}`,
			);
		}
	}

	lines.push(bar);
	const selectedSkillsCount = state.options.filter(
		(o) => optionMatchesTab(o, "skill") && state.selected.has(o.value),
	).length;
	const selectedAgentsCount = state.options.filter(
		(o) => optionMatchesTab(o, "agent") && state.selected.has(o.value),
	).length;

	const currentOptLabel = visible[state.cursor]?.label ?? "";
	const summaryText = options.tabLabels
		? state.selected.size > 0
			? `${state.selected.size} selected`
			: options.selectCursorOnEmptySubmit && currentOptLabel
				? `Target: ${currentOptLabel}`
				: "0 selected"
		: `${state.selected.size} selected (${selectedSkillsCount} ${skillTabTitle}, ${selectedAgentsCount} ${agentTabTitle})`;
	const rawTarget = options.targetHint ?? "";
	const shortTarget =
		rawTarget.length > 18 ? `${rawTarget.slice(0, 17)}…` : rawTarget;
	const targetSuffix = shortTarget ? ` · IDE: ${shortTarget}` : "";

	lines.push(
		`${style.dim("╰─", c)} ${style.bold(summaryText, c)}${style.dim(`${targetSuffix} — Enter to ${submitVerb}`, c)}`,
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
			state = applyMultiSelectKey(state, key, {
				selectCursorOnEmptySubmit: renderOpts.selectCursorOnEmptySubmit,
			});

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
