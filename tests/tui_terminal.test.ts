import { describe, expect, it } from "vitest";
import {
	formatBadge,
	isColorEnabled,
	padVisible,
	renderAiUsageGuide,
	renderBox,
	renderHeaderBanner,
	renderNextSteps,
	renderStep,
	renderTable,
	renderTokenBar,
	stripAnsi,
	style,
	suggestCommand,
	visibleLength,
} from "../src/ui/index.js";

describe("Zero-Dependency ANSI TUI Aesthetic Engine (Issue #125)", () => {
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

	it("renders rounded Unicode panels, header banners, and multi-column aligned tables", () => {
		const banner = renderHeaderBanner("Framework & Library", {
			version: "1.3.0",
			colorEnabled: false,
		});
		expect(banner).toContain("╭");
		expect(banner).toContain("╰");
		expect(banner).toContain("SkillOps v1.3.0");
		expect(banner).toContain("Framework & Library");

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

	it("renders visual token budget bars, step indicators, AI usage guides, and fuzzy command suggestions", () => {
		const bar = renderTokenBar(750, 1500, {
			width: 10,
			label: "L1 Budget",
			colorEnabled: false,
		});
		expect(bar).toContain("L1 Budget [█████░░░░░] 50.0% (750 / 1500 tokens)");

		const stepLine = renderStep(
			1,
			4,
			"Stack & AI Agents",
			"TypeScript • Cursor, Claude",
			"done",
			false,
		);
		expect(stepLine).toContain("✔ [1/4] Stack & AI Agents");
		expect(stepLine).toContain("TypeScript • Cursor, Claude");

		const nextSteps = renderNextSteps(
			[
				{
					command: "npx skillops-cli quickstart",
					description: "Setup repository in 1 step",
				},
			],
			false,
		);
		expect(nextSteps).toContain("💡 Next Steps:");
		expect(nextSteps).toContain("npx skillops-cli quickstart");

		const aiGuide = renderAiUsageGuide(
			["claude", "cursor", "copilot"],
			["systematic-debugging"],
			["context-scout"],
			false,
		);
		expect(aiGuide).toContain("Using Your Skills & Subagents");
		expect(aiGuide).toContain("@systematic-debugging");
		expect(aiGuide).toContain("/systematic-debugging");

		const validCmds = [
			"quickstart",
			"install",
			"recommend",
			"info",
			"search",
			"create",
			"list",
			"doctor",
		];
		expect(suggestCommand("insatll", validCmds)).toBe("install");
		expect(suggestCommand("quikstart", validCmds)).toBe("quickstart");
		expect(suggestCommand("recomend", validCmds)).toBe("recommend");
		expect(suggestCommand("zzzzzzzzzz", validCmds)).toBeNull();
	});
});
