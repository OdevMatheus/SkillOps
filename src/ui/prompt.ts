/**
 * Zero-dependency interactive terminal multi-select prompt (`src/ui/prompt.ts`).
 *
 * Supports:
 * - Horizontal tabs (`←`/`→` or `Tab`) separating `Skills` and `Agents`
 * - Vertical navigation (`↑`/`↓` or `j`/`k`)
 * - Real-time keyword filtering (`/` to search, `Backspace` to edit, `Esc` to clear)
 * - `Space` to toggle selection across tabs, `a` to toggle all in current tab, `Enter` to confirm
 */

import {
	CHARM_PALETTE,
	fgHex,
	renderKeycap,
	renderPaginationDots,
	renderPill,
} from "./lipgloss.js";
import { padVisible, style, visibleLength } from "./terminal.js";

export type MultiSelectTab = "skill" | "agent";

export interface MultiSelectOption {
	readonly value: string;
	readonly label: string;
	readonly kind?: "skill" | "agent" | "ide";
	readonly tab?: MultiSelectTab;
	readonly hint?: string;
	readonly initialSelected?: boolean;
	readonly isSelectAll?: boolean;
}

export interface CreateMultiSelectStateOptions {
	readonly showSelectAll?: boolean;
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
	readonly showSelectAll?: boolean;
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
	if (opt.isSelectAll) {
		return false;
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
	stateOptions: CreateMultiSelectStateOptions = {},
): MultiSelectState {
	let finalOptions: readonly MultiSelectOption[] = options;
	if (
		stateOptions.showSelectAll &&
		!options.some((opt) => opt.isSelectAll === true)
	) {
		const skillItems = options.filter((opt) => optionMatchesTab(opt, "skill"));
		const agentItems = options.filter((opt) => optionMatchesTab(opt, "agent"));
		const withAll: MultiSelectOption[] = [];
		if (skillItems.length > 0) {
			const isIdeSelector =
				agentItems.length === 0 &&
				skillItems.every((opt) => opt.kind === "ide");
			withAll.push({
				value: isIdeSelector ? "__all_ides__" : "__all_skills__",
				label: isIdeSelector
					? "[ALL] Select all AI IDEs"
					: "[ALL] Select all Skills",
				kind: isIdeSelector ? "ide" : "skill",
				tab: "skill",
				isSelectAll: true,
				hint: isIdeSelector
					? `Select or deselect all ${skillItems.length} AI IDEs & CLIs`
					: `Select or deselect all ${skillItems.length} Skills in this tab`,
			});
			withAll.push(...skillItems);
		}
		if (agentItems.length > 0) {
			withAll.push({
				value: "__all_agents__",
				label: "[ALL] Select all Agents",
				kind: "agent",
				tab: "agent",
				isSelectAll: true,
				hint: `Select or deselect all ${agentItems.length} Agents in this tab`,
			});
			withAll.push(...agentItems);
		}
		if (withAll.length > 0) {
			finalOptions = withAll;
		}
	}

	const initial = new Set<string>();
	for (const opt of finalOptions) {
		if (opt.initialSelected && !opt.isSelectAll) {
			initial.add(opt.value);
		}
	}
	const hasSkills = finalOptions.some((opt) => optionMatchesTab(opt, "skill"));
	return {
		options: finalOptions,
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
			if (currentOpt?.isSelectAll) {
				finalSelected = new Set(
					visibleOnSubmit
						.filter((opt) => !opt.isSelectAll)
						.map((opt) => opt.value),
				);
			} else if (currentOpt) {
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
		if (currentOpt.isSelectAll) {
			const realVisible = visible.filter((opt) => !opt.isSelectAll);
			if (realVisible.length === 0) {
				return state;
			}
			const allTabSelected = realVisible.every((opt) =>
				state.selected.has(opt.value),
			);
			const nextSelected = new Set(state.selected);
			if (allTabSelected) {
				for (const opt of realVisible) {
					nextSelected.delete(opt.value);
				}
			} else {
				for (const opt of realVisible) {
					nextSelected.add(opt.value);
				}
			}
			return {
				...state,
				selected: nextSelected,
			};
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
		const realVisible = visible.filter((opt) => !opt.isSelectAll);
		if (realVisible.length === 0) {
			return state;
		}
		const allTabSelected = realVisible.every((opt) =>
			state.selected.has(opt.value),
		);
		const nextSelected = new Set(state.selected);
		if (allTabSelected) {
			for (const opt of realVisible) {
				nextSelected.delete(opt.value);
			}
		} else {
			for (const opt of realVisible) {
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

	const realOptions = state.options.filter((o) => !o.isSelectAll);
	const totalSkills = realOptions.filter((o) =>
		optionMatchesTab(o, "skill"),
	).length;
	const totalAgents = realOptions.filter((o) =>
		optionMatchesTab(o, "agent"),
	).length;
	const filteredSkills = getFilteredTabOptions(state, "skill");
	const filteredAgents = getFilteredTabOptions(state, "agent");
	const realFilteredSkills = filteredSkills.filter((o) => !o.isSelectAll);
	const realFilteredAgents = filteredAgents.filter((o) => !o.isSelectAll);
	const visible = state.activeTab === "skill" ? filteredSkills : filteredAgents;
	const realVisible =
		state.activeTab === "skill" ? realFilteredSkills : realFilteredAgents;
	const total = visible.length;

	const skillTabTitle = options.tabLabels?.skill ?? "Skills";
	const agentTabTitle = options.tabLabels?.agent ?? "Agents";
	const submitVerb = options.submitActionLabel ?? "import";
	const isSinglePage = totalAgents === 0 || totalSkills === 0;

	const header = renderPill(`◆ ${title}`, {
		fg: CHARM_PALETTE.inkDark,
		bg: CHARM_PALETTE.indigo,
		bold: true,
		colorEnabled: c,
	});
	const sep = style.dim(" · ", c);
	const keyItems = [
		renderKeycap("↑/↓", "move", c),
		...(isSinglePage ? [] : [renderKeycap("←/→", "tab", c)]),
		renderKeycap("Space", "select", c),
		...(state.searchMode
			? [renderKeycap("Esc", "clear", c)]
			: [renderKeycap("/", "search", c), renderKeycap("a", "all", c)]),
		renderKeycap("Enter", submitVerb, c),
	];
	const instructions = `${bar}  ${keyItems.join(sep)}`;

	const lines: string[] = [header];
	if (options.subtitle) {
		lines.push(`${bar}  ${fgHex(CHARM_PALETTE.lavender, options.subtitle, c)}`);
	}
	lines.push(instructions, bar);

	// Render horizontal Tabs + Search bar
	const hasQuery = state.searchQuery.length > 0;
	const skillCountStr = hasQuery
		? `${realFilteredSkills.length}/${totalSkills}`
		: `${totalSkills}`;
	const agentCountStr = hasQuery
		? `${realFilteredAgents.length}/${totalAgents}`
		: `${totalAgents}`;

	const skillTabLabel =
		state.activeTab === "skill"
			? renderPill(`[ ◆ ${skillTabTitle} (${skillCountStr}) ]`, {
					fg: CHARM_PALETTE.inkDark,
					bg: CHARM_PALETTE.indigo,
					bold: true,
					colorEnabled: c,
				})
			: fgHex(CHARM_PALETTE.lavender, `○ ${skillTabTitle} (${skillCountStr})`, c);
	const agentTabLabel =
		state.activeTab === "agent"
			? renderPill(`[ ◆ ${agentTabTitle} (${agentCountStr}) ]`, {
					fg: CHARM_PALETTE.inkDark,
					bg: CHARM_PALETTE.hotPink,
					bold: true,
					colorEnabled: c,
				})
			: fgHex(CHARM_PALETTE.lavender, `○ ${agentTabTitle} (${agentCountStr})`, c);

	const rawQuerySlice =
		state.searchQuery.length > 14
			? `…${state.searchQuery.slice(-13)}`
			: state.searchQuery;
	const searchSuffix =
		state.searchMode || hasQuery
			? `   ${renderPill(
					`/ Filter: ${rawQuerySlice}${state.searchMode ? "█" : ""}`,
					{
						fg: CHARM_PALETTE.amber,
						bg: CHARM_PALETTE.surface,
						bold: true,
						colorEnabled: c,
					},
				)}`
			: `   ${style.dim("(", c)}${fgHex(CHARM_PALETTE.amber, "/", c)} ${fgHex(CHARM_PALETTE.lavender, "search", c)}${style.dim(")", c)}`;

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
			`${bar}  ${fgHex(CHARM_PALETTE.amber, `No ${tabName} match "${state.searchQuery}". Press Esc to clear filter.`, c)}`,
		);
	} else {
		let startIdx = 0;
		if (total > maxVisible) {
			const half = Math.floor(maxVisible / 2);
			startIdx = Math.max(0, Math.min(state.cursor - half, total - maxVisible));
		}
		const endIdx = Math.min(total, startIdx + maxVisible);
		const totalPages = Math.max(1, Math.ceil(total / maxVisible));
		const currentPage = Math.min(
			totalPages - 1,
			Math.floor(state.cursor / maxVisible),
		);
		const pageDots =
			totalPages > 1
				? `  ${renderPaginationDots(currentPage, totalPages, c)}`
				: "";

		if (startIdx > 0) {
			lines.push(
				`${bar}  ${fgHex(CHARM_PALETTE.lavender, `↑ ${startIdx} more above...`, c)}${endIdx >= total ? pageDots : ""}`,
			);
		}

		const maxLabelCols = Math.min(
			26,
			visible.reduce((m, o) => Math.max(m, visibleLength(o.label)), 14),
		);

		for (let i = startIdx; i < endIdx; i++) {
			const opt = visible[i];
			if (!opt) continue;
			const isCurrent = i === state.cursor;
			const allRealSelected =
				realVisible.length > 0 &&
				realVisible.every((o) => state.selected.has(o.value));
			const someRealSelected =
				realVisible.some((o) => state.selected.has(o.value)) &&
				!allRealSelected;
			const isChecked = opt.isSelectAll
				? allRealSelected
				: state.selected.has(opt.value);

			const pointer = isCurrent
				? fgHex(CHARM_PALETTE.hotPink, style.bold("❯", c), c)
				: " ";
			const checkbox = isChecked
				? style.bold(style.green("◉", c), c)
				: opt.isSelectAll && someRealSelected
					? fgHex(CHARM_PALETTE.amber, style.bold("◐", c), c)
					: isCurrent
						? fgHex(CHARM_PALETTE.fuchsia, "◯", c)
						: style.dim("◯", c);

			const labelRaw =
				opt.label.length > maxLabelCols
					? `${opt.label.slice(0, maxLabelCols - 1)}…`
					: opt.label;
			const labelPadded = padVisible(labelRaw, maxLabelCols + 1, "left");
			const styledLabel = opt.isSelectAll
				? isCurrent
					? fgHex(CHARM_PALETTE.amber, style.bold(labelPadded, c), c)
					: isChecked
						? style.bold(style.green(labelPadded, c), c)
						: fgHex(CHARM_PALETTE.cyan, style.bold(labelPadded, c), c)
				: isCurrent
					? isChecked
						? style.bold(style.green(labelPadded, c), c)
						: fgHex(CHARM_PALETTE.fuchsia, style.bold(labelPadded, c), c)
					: isChecked
						? style.bold(style.green(labelPadded, c), c)
						: fgHex(CHARM_PALETTE.white, labelPadded, c);

			const prefixWidth = 7 + maxLabelCols + 1;
			const maxHintCols = Math.max(10, 76 - prefixWidth);
			const rawHint = opt.hint ?? "";
			const shortHint =
				rawHint.length > maxHintCols
					? `${rawHint.slice(0, maxHintCols - 1)}…`
					: rawHint;
			const styleHintText = (text: string): string =>
				isCurrent
					? fgHex(CHARM_PALETTE.lavender, text, c)
					: isChecked
						? fgHex(CHARM_PALETTE.cyan, text, c)
						: style.dim(text, c);
			let styledShortHint = styleHintText(shortHint);
			if (shortHint.startsWith("[installed")) {
				const closeBracketIdx = shortHint.indexOf("]");
				if (closeBracketIdx !== -1) {
					const badgeText = shortHint.slice(0, closeBracketIdx + 1);
					const restText = shortHint.slice(closeBracketIdx + 1);
					styledShortHint = `${fgHex(CHARM_PALETTE.mint, style.bold(badgeText, c), c)}${restText ? styleHintText(restText) : ""}`;
				}
			}
			const hintPart = shortHint ? ` ${styledShortHint}` : "";

			lines.push(`${bar}  ${pointer} ${checkbox} ${styledLabel}${hintPart}`);
		}

		if (endIdx < total) {
			lines.push(
				`${bar}  ${fgHex(CHARM_PALETTE.lavender, `↓ ${total - endIdx} more below...`, c)}${pageDots}`,
			);
		}
	}

	lines.push(bar);
	const selectedSkillsCount = realOptions.filter(
		(o) => optionMatchesTab(o, "skill") && state.selected.has(o.value),
	).length;
	const selectedAgentsCount = realOptions.filter(
		(o) => optionMatchesTab(o, "agent") && state.selected.has(o.value),
	).length;

	const currentOptLabel = visible[state.cursor]?.label ?? "";
	const selectedList = [...state.selected];
	const selectedPreview =
		selectedList.length <= 3
			? selectedList.join(", ")
			: `${selectedList.slice(0, 2).join(", ")}, +${selectedList.length - 2}`;
	const summaryText = options.tabLabels
		? state.selected.size > 0
			? `${state.selected.size} selected (${selectedPreview})`
			: options.selectCursorOnEmptySubmit && currentOptLabel
				? `Target: ${currentOptLabel}`
				: "0 selected"
		: `${state.selected.size} selected (${selectedSkillsCount} ${skillTabTitle}, ${selectedAgentsCount} ${agentTabTitle})`;
	const rawTarget = options.targetHint ?? "";
	const shortTarget =
		rawTarget.length > 18 ? `${rawTarget.slice(0, 17)}…` : rawTarget;
	const targetSuffix = shortTarget
		? fgHex(CHARM_PALETTE.cyan, ` · IDE: ${shortTarget}`, c)
		: "";
	const styledSummary =
		state.selected.size > 0
			? fgHex(CHARM_PALETTE.mint, style.bold(summaryText, c), c)
			: fgHex(CHARM_PALETTE.lavender, style.bold(summaryText, c), c);
	const ctaText = `Enter to ${submitVerb}`;
	const styledCta =
		state.selected.size > 0 || options.selectCursorOnEmptySubmit
			? renderPill(ctaText, {
					fg: CHARM_PALETTE.inkDark,
					bg:
						submitVerb === "remove"
							? CHARM_PALETTE.hotPink
							: CHARM_PALETTE.mint,
					bold: true,
					colorEnabled: c,
				})
			: fgHex(CHARM_PALETTE.amber, style.bold(ctaText, c), c);

	lines.push(
		`${style.dim("╰─", c)} ${styledSummary}${targetSuffix}${style.dim(" — ", c)}${styledCta}`,
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

	let state = createMultiSelectState(options, {
		showSelectAll: renderOpts.showSelectAll,
	});
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
