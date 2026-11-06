import { describe, expect, it } from "vitest";
import { formatSyncReport } from "../src/sync/index.js";
import {
	applyMultiSelectKey,
	bgHex,
	CHARM_PALETTE,
	createMultiSelectState,
	fgHex,
	formatActionBadge,
	formatBadge,
	hexToRgb,
	isColorEnabled,
	joinHorizontal,
	padVisible,
	renderAiUsageGuide,
	renderBox,
	renderCancelledStep,
	renderCompletedStep,
	renderGlobalHelp,
	renderHeaderBanner,
	renderKeycap,
	renderMultiSelectFrame,
	renderNextSteps,
	renderPaginationDots,
	renderPill,
	renderTable,
	stripAnsi,
	style,
	suggestCommand,
	visibleLength,
} from "../src/ui/index.js";

describe("Zero-Dependency ANSI TUI Aesthetic Engine", () => {
	it("respects NO_COLOR, FORCE_COLOR, TERM=dumb, and TTY detection", () => {
		expect(isColorEnabled({ env: { NO_COLOR: "1" }, isTTY: true })).toBe(false);
		expect(isColorEnabled({ env: { FORCE_COLOR: "1" }, isTTY: false })).toBe(
			true,
		);
		expect(isColorEnabled({ env: { FORCE_COLOR: "0" }, isTTY: true })).toBe(
			false,
		);
		expect(isColorEnabled({ env: { TERM: "dumb" }, isTTY: true })).toBe(false);
		expect(isColorEnabled({ env: {}, isTTY: true })).toBe(true);
		expect(isColorEnabled({ env: {}, isTTY: false })).toBe(false);
	});

	it("applies and strips ANSI escape codes while computing accurate visible lengths", () => {
		const colored = style.bold(style.cyan("SkillOps", true), true);
		expect(colored).not.toBe("SkillOps");
		expect(stripAnsi(colored)).toBe("SkillOps");
		expect(visibleLength(colored)).toBe(8);

		const paddedRight = padVisible(colored, 12, "right");
		expect(visibleLength(paddedRight)).toBe(12);
		expect(stripAnsi(paddedRight)).toBe("    SkillOps");

		const plain = style.cyan("SkillOps", false);
		expect(plain).toBe("SkillOps");
	});

	it("renders rounded Unicode panels, clean tree header banners, and multi-column aligned tables", () => {
		const banner = renderHeaderBanner("Framework & Library", {
			version: "1.3.9",
			colorEnabled: false,
		});
		expect(banner).toContain("◆ SkillOps v1.3.9");
		expect(banner).toContain("Framework & Library");
		expect(banner).not.toContain("⚡");

		const box = renderBox(["Line 1", "Line 2"], {
			title: "Panel Title",
			minWidth: 30,
			colorEnabled: false,
		});
		expect(box).toContain("╭─ Panel Title ");
		expect(box).toContain("│  Line 1");
		expect(box).toContain("╰");

		const table = renderTable(
			["Skill", "Tokens", "Status"],
			[
				["systematic-debugging", "93", formatBadge("pass", "READY", false)],
				["test-driven-development", "94", formatBadge("pass", "READY", false)],
			],
			{ align: ["left", "right", "left"], colorEnabled: false },
		);
		expect(table).toContain("Skill");
		expect(table).toContain("systematic-debugging");
		expect(table).toContain("✔ READY");
	});

	it("renders AI usage guides, 2-command global help, multi-select state machine, and fuzzy command suggestions", () => {
		const nextSteps = renderNextSteps(
			[
				{
					command: "npx skillops-cli add",
					description: "Install Skills interactively",
				},
			],
			false,
		);
		expect(nextSteps).toContain("╰─ Next Steps:");
		expect(nextSteps).toContain("npx skillops-cli add");
		expect(nextSteps).not.toContain("💡");

		const aiGuide = renderAiUsageGuide(
			["claude", "cursor", "copilot"],
			["systematic-debugging"],
			["context-scout"],
			false,
		);
		expect(aiGuide).toContain("Using Your Skills & Subagents");
		expect(aiGuide).toContain("@systematic-debugging");
		expect(aiGuide).toContain("/systematic-debugging");
		expect(aiGuide).not.toContain("🚀");
		for (const line of aiGuide.split("\n")) {
			expect(visibleLength(line)).toBeLessThanOrEqual(78);
		}

		const helpOut = renderGlobalHelp("1.3.9", false);
		expect(helpOut).not.toMatch(/(?:🚀|📚|🛠️|⚙️|🌐|💡|⚡|📦|🔍)/u);
		expect(helpOut).toContain("add [name...]");
		expect(helpOut).toContain("remove [name...]");
		expect(helpOut).not.toContain("quickstart");
		expect(helpOut).not.toContain("tokens");
		const helpLines = helpOut.split("\n");
		expect(helpLines.length).toBeLessThanOrEqual(20);
		for (const line of helpLines) {
			expect(visibleLength(line)).toBeLessThanOrEqual(78);
		}

		// Multi-select interactive state machine & frame rendering (Tabbed + Live Search)
		let msState = createMultiSelectState([
			{
				value: "bug-reproducer-tdd",
				label: "bug-reproducer-tdd",
				kind: "skill",
				hint: "Reproduce bugs with failing tests first",
			},
			{
				value: "security-sast-gate",
				label: "security-sast-gate",
				kind: "skill",
				hint: "OWASP AST & taint vulnerability gate",
			},
			{
				value: "red-team-breaker",
				label: "red-team-breaker",
				kind: "agent",
				hint: "Stress-test auth, inputs & trust boundaries",
			},
		]);
		expect(msState.activeTab).toBe("skill");
		expect(msState.cursor).toBe(0);
		expect(msState.selected.size).toBe(0);

		// Press Space to select first skill, Right arrow (\x1b[C) to switch to Agents tab, Space to select agent
		msState = applyMultiSelectKey(msState, " ");
		expect(msState.selected.has("bug-reproducer-tdd")).toBe(true);
		msState = applyMultiSelectKey(msState, "\x1b[C");
		expect(msState.activeTab).toBe("agent");
		expect(msState.cursor).toBe(0);
		msState = applyMultiSelectKey(msState, " ");
		expect(msState.selected.has("red-team-breaker")).toBe(true);
		expect(msState.selected.size).toBe(2);

		const frame = renderMultiSelectFrame(
			"SkillOps — Import Skills & Agents",
			msState,
			{ targetHint: "cursor, claude", colorEnabled: false },
		);
		expect(frame).toContain("2 selected (1 Skills, 1 Agents)");
		expect(frame).toContain("[ ◆ Agents (1) ]");
		expect(frame).toContain("❯ ◉ red-team-breaker");
		for (const line of frame.split("\n")) {
			expect(visibleLength(line)).toBeLessThanOrEqual(78);
		}

		// Live '/' search: press '/', type 'sast', verify auto-switch to 'skill' tab and filtered frame
		msState = applyMultiSelectKey(msState, "/");
		expect(msState.searchMode).toBe(true);
		for (const ch of "sast") {
			msState = applyMultiSelectKey(msState, ch);
		}
		expect(msState.searchQuery).toBe("sast");
		expect(msState.activeTab).toBe("skill");
		const searchFrame = renderMultiSelectFrame(
			"SkillOps — Import Skills & Agents",
			msState,
			{ colorEnabled: false },
		);
		expect(searchFrame).toContain("/ Filter: sast█");
		expect(searchFrame).toContain("[ ◆ Skills (1/2) ]");
		for (const line of searchFrame.split("\n")) {
			expect(visibleLength(line)).toBeLessThanOrEqual(78);
		}

		// Press Escape once to clear search filter without cancelling prompt
		msState = applyMultiSelectKey(msState, "\x1b");
		expect(msState.searchMode).toBe(false);
		expect(msState.searchQuery).toBe("");
		expect(msState.status).toBe("active");

		// Toggle all in current tab ('skill') with 'a', then submit with Enter
		msState = applyMultiSelectKey(msState, "a");
		expect(msState.selected.has("security-sast-gate")).toBe(true);
		expect(msState.selected.size).toBe(3);
		msState = applyMultiSelectKey(msState, "\r");
		expect(msState.status).toBe("submitted");

		// Step 1 AI IDE selector mode: single unified page ordered by popularity + selectCursorOnEmptySubmit
		let ideState = createMultiSelectState([
			{
				value: "cursor",
				label: "cursor",
				kind: "ide",
				tab: "skill",
				hint: "Cursor AI IDE (.cursor/rules)",
			},
			{
				value: "antigravity",
				label: "antigravity",
				kind: "ide",
				tab: "skill",
				hint: "Google Antigravity IDE (.agent/skills)",
			},
			{
				value: "gemini",
				label: "gemini",
				kind: "ide",
				tab: "skill",
				hint: "Google Gemini CLI (.gemini/skills)",
			},
		]);
		ideState = applyMultiSelectKey(ideState, "\x1b[C");
		expect(ideState.activeTab).toBe("skill");
		ideState = applyMultiSelectKey(ideState, "\x1b[B");
		expect(ideState.cursor).toBe(1);
		const ideFrame = renderMultiSelectFrame(
			"SkillOps — Step 1/2: Select Your AI IDE / Agent",
			ideState,
			{
				tabLabels: { skill: "AI IDEs & Agents", agent: "" },
				submitActionLabel: "continue",
				selectCursorOnEmptySubmit: true,
				colorEnabled: false,
			},
		);
		expect(ideFrame).toContain("[ ◆ AI IDEs & Agents (3) ]");
		expect(ideFrame).not.toContain("←/→ tab");
		expect(ideFrame).toContain("Target: antigravity — Enter to continue");
		for (const line of ideFrame.split("\n")) {
			expect(visibleLength(line)).toBeLessThanOrEqual(78);
		}
		ideState = applyMultiSelectKey(ideState, "\r", {
			selectCursorOnEmptySubmit: true,
		});
		expect(ideState.status).toBe("submitted");
		expect([...ideState.selected]).toEqual(["antigravity"]);

		// Select All option at the top of Skills & Agents tabs (showSelectAll: true)
		let selectAllState = createMultiSelectState(
			[
				{
					value: "arch-skill",
					label: "arch-skill",
					kind: "skill",
					hint: "Architecture skill",
				},
				{
					value: "sec-skill",
					label: "sec-skill",
					kind: "skill",
					hint: "Security skill",
				},
				{
					value: "verify-agent",
					label: "verify-agent",
					kind: "agent",
					hint: "Verification agent",
				},
			],
			{ showSelectAll: true },
		);
		expect(selectAllState.options[0]?.isSelectAll).toBe(true);
		expect(selectAllState.options[0]?.label).toBe("[ALL] Select all Skills");
		selectAllState = applyMultiSelectKey(selectAllState, " ");
		expect([...selectAllState.selected]).toEqual(["arch-skill", "sec-skill"]);
		const allCheckedFrame = renderMultiSelectFrame(
			"SkillOps — Step 2/2: Select Skills & Agents to Import",
			selectAllState,
			{ colorEnabled: false },
		);
		expect(allCheckedFrame).toContain("◉ [ALL] Select all Skills");
		expect(allCheckedFrame).toContain("2 selected (2 Skills, 0 Agents)");
		for (const line of allCheckedFrame.split("\n")) {
			expect(visibleLength(line)).toBeLessThanOrEqual(78);
		}
		selectAllState = applyMultiSelectKey(selectAllState, " ");
		expect([...selectAllState.selected]).toEqual([]);

		expect(suggestCommand("insatll")).toBe("install");
		expect(suggestCommand("remov")).toBe("remove");
		expect(suggestCommand("zzzzzzzzzz")).toBeNull();
	});

	it("renders Charmbracelet Lip Gloss TrueColor (24-bit RGB) pills, paginator dots, keycaps, and horizontal layouts", () => {
		expect(hexToRgb("#DAFA9C")).toEqual([218, 250, 156]);
		expect(hexToRgb("#F0A")).toEqual([255, 0, 170]);

		const fgStyled = fgHex(CHARM_PALETTE.indigo, "Charm", true);
		expect(fgStyled).toContain("\x1b[38;2;218;250;156mCharm\x1b[39m");
		expect(stripAnsi(fgStyled)).toBe("Charm");
		expect(visibleLength(fgStyled)).toBe(5);

		const bgStyled = bgHex(CHARM_PALETTE.hotPink, "Bubble", true);
		expect(bgStyled).toContain("\x1b[48;2;218;250;156mBubble\x1b[49m");
		expect(stripAnsi(bgStyled)).toBe("Bubble");

		const pill = renderPill("[ ◆ Skills (10) ]", {
			fg: CHARM_PALETTE.inkDark,
			bg: CHARM_PALETTE.indigo,
			bold: true,
			colorEnabled: true,
		});
		expect(pill).toContain("\x1b[48;2;218;250;156m");
		expect(pill).toContain("\x1b[38;2;15;15;15m");
		expect(stripAnsi(pill)).toBe("[ ◆ Skills (10) ]");
		expect(visibleLength(pill)).toBe(17);

		const keycap = renderKeycap("Space", "select", true);
		expect(stripAnsi(keycap)).toBe("Space select");
		expect(visibleLength(keycap)).toBe(12);

		const dots = renderPaginationDots(1, 3, true);
		expect(stripAnsi(dots)).toBe("◦ • ◦");

		const sideBySide = joinHorizontal("top", "Left 1\nLeft 2", "Right 1", 2);
		expect(sideBySide.split("\n")).toEqual(["Left 1  Right 1", "Left 2"]);

		const manyState = createMultiSelectState(
			Array.from({ length: 15 }, (_, idx) => ({
				value: `skill-${idx + 1}`,
				label: `skill-${idx + 1}`,
				kind: "skill" as const,
				hint: `Automated verification skill #${idx + 1}`,
			})),
			{ showSelectAll: true },
		);
		const colorFrame = renderMultiSelectFrame(
			"SkillOps — Step 2/2: Select Skills & Agents to Import",
			manyState,
			{ maxVisible: 6, colorEnabled: true },
		);
		expect(colorFrame).toContain("\x1b[48;2;218;250;156m");
		expect(stripAnsi(colorFrame)).toContain("• ◦ ◦");
		for (const line of colorFrame.split("\n")) {
			expect(visibleLength(line)).toBeLessThanOrEqual(78);
		}

		const createdBadge = formatActionBadge("created", true);
		expect(visibleLength(createdBadge)).toBe(11);
		expect(stripAnsi(createdBadge)).toBe(" + CREATED ");

		const removedBadge = formatActionBadge("removed", true);
		expect(visibleLength(removedBadge)).toBe(11);
		expect(stripAnsi(removedBadge)).toBe(" - REMOVED ");

		const stepLine = renderCompletedStep(
			"Step 1/2 · AI IDE(s)",
			"cursor, claude",
			true,
		);
		expect(visibleLength(stepLine)).toBeLessThanOrEqual(78);
		expect(stripAnsi(stepLine)).toContain("Step 1/2 · AI IDE(s)");
		expect(stripAnsi(stepLine)).toContain("cursor, claude");

		const cancelLine = renderCancelledStep("No AI IDE selected.", true);
		expect(visibleLength(cancelLine)).toBeLessThanOrEqual(78);
		expect(stripAnsi(cancelLine)).toContain("No AI IDE selected.");

		const syncReportOut = formatSyncReport(
			{
				repo_path: "/workspace/demo",
				catalog_path: "/workspace/demo/catalog",
				targets: ["cursor", "claude"],
				dry_run: false,
				force: false,
				artifacts: [
					{
						target: "cursor",
						skill_name: "mcp-architect",
						relative_path: ".cursor/rules/skillops-mcp-architect.mdc",
						sha256: "a".repeat(64),
						action: "created",
					},
					{
						target: "claude",
						skill_name: "mcp-architect",
						relative_path: ".claude/skills/mcp-architect/SKILL.md",
						sha256: "b".repeat(64),
						action: "created",
					},
				],
				drift_conflicts: [],
				lockfile_path: "/workspace/demo/.skillops-lock.json",
				passed: true,
			},
			"table",
			true,
		);
		expect(stripAnsi(syncReportOut)).toContain(
			"◆ SkillOps v1.3.9 — Skills & Subagents Installed",
		);
		expect(stripAnsi(syncReportOut)).toContain("+ CREATED");
		expect(stripAnsi(syncReportOut)).toContain("(cursor)");
		for (const line of syncReportOut.split("\n")) {
			expect(visibleLength(line)).toBeLessThanOrEqual(78);
		}
	});
});
