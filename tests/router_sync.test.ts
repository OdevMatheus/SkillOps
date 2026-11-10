import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
	buildInteractiveCatalogOptions,
	buildInteractiveInstalledOptions,
	buildInteractiveInstalledTargetOptions,
	buildInteractiveTargetOptions,
	isGlobalFlag,
	resolveTargetRepoPath,
	runCli,
} from "../src/cli.js";
import {
	ALL_RUNTIME_TARGETS,
	addSkillOrSubagent,
	applyMultiSelectKey,
	cleanSyncedArtifacts,
	createMultiSelectState,
	detectExistingTargetsForItem,
	discoverInstalledArtifactsOnDisk,
	ExitCode,
	formatProjectStatusReport,
	formatSyncReport,
	inspectProjectStatus,
	removeSkillOrSubagent,
	renderMultiSelectFrame,
	stripAnsi,
	visibleLength,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CATALOG_ROOT = path.join(REPO_ROOT, "catalog");

describe("SkillOps Multi-Runtime Add & Remove Engine", () => {
	it("supports surgical 'addSkillOrSubagent', SHA-256 drift protection, and 'removeSkillOrSubagent'", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-add-remove-test-"),
		);
		try {
			const skillReport = addSkillOrSubagent(
				tmpRepo,
				CATALOG_ROOT,
				"mcp-architect",
				{
					targets: ["claude", "cursor", "codex"],
				},
			);
			expect(skillReport.passed).toBe(true);
			expect(skillReport.drift_conflicts).toEqual([]);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".claude", "skills", "mcp-architect", "SKILL.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".cursor", "rules", "skillops-mcp-architect.mdc"),
				),
			).toBe(true);
			expect(fs.existsSync(path.join(tmpRepo, ".skillops-lock.json"))).toBe(
				true,
			);

			const subagentReport = addSkillOrSubagent(
				tmpRepo,
				CATALOG_ROOT,
				"context-scout",
				{
					targets: ["claude", "copilot"],
				},
			);
			expect(subagentReport.passed).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".claude", "agents", "context-scout.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".github", "agents", "context-scout.agent.md"),
				),
			).toBe(true);

			// Simulate existing skill in cursor with local edits + new target gemini (RN1 #169)
			const driftedRelPath = ".cursor/rules/skillops-mcp-architect.mdc";
			const driftedFullPath = path.join(tmpRepo, driftedRelPath);
			fs.appendFileSync(
				driftedFullPath,
				"\n<!-- manual local edit -->\n",
				"utf-8",
			);
			const contentBeforeSkip = fs.readFileSync(driftedFullPath, "utf-8");

			const skipAdd = addSkillOrSubagent(
				tmpRepo,
				CATALOG_ROOT,
				"mcp-architect",
				{
					targets: ["cursor", "gemini"],
					force: false,
				},
			);
			expect(skipAdd.passed).toBe(true);
			expect(skipAdd.skipped_existing).toContain(driftedRelPath);
			// Existing file in cursor must NOT be overwritten
			expect(fs.readFileSync(driftedFullPath, "utf-8")).toBe(contentBeforeSkip);
			// Meanwhile, gemini (which did not have the skill yet) is created
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".gemini", "skills", "mcp-architect", "SKILL.md"),
				),
			).toBe(true);
			// Final report notifies the user that cursor was skipped at the end
			const formattedSkipReport = stripAnsi(formatSyncReport(skipAdd, "table", false));
			expect(formattedSkipReport).toContain("SKIPPED");
			expect(formattedSkipReport).toContain("Skipped — Already Exists (1)");
			expect(formattedSkipReport).toContain(
				"(cursor) mcp-architect already exists at .cursor/rules/skillops-mcp-architect.mdc",
			);

			// Force overwrite replaces existing skill when --force is explicitly passed
			const forcedAdd = addSkillOrSubagent(
				tmpRepo,
				CATALOG_ROOT,
				"mcp-architect",
				{
					targets: ["cursor"],
					force: true,
				},
			);
			expect(forcedAdd.passed).toBe(true);
			expect(forcedAdd.skipped_existing).toEqual([]);
			expect(forcedAdd.drift_conflicts).toEqual([]);
			expect(fs.readFileSync(driftedFullPath, "utf-8")).not.toContain(
				"<!-- manual local edit -->",
			);

			// Surgically remove mcp-architect via CLI
			expect(
				runCli([
					"node",
					"cli.js",
					"remove",
					"mcp-architect",
					"--repo",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
				]),
			).toBe(ExitCode.SUCCESS);

			expect(
				fs.existsSync(
					path.join(tmpRepo, ".claude", "skills", "mcp-architect", "SKILL.md"),
				),
			).toBe(false);
			expect(fs.existsSync(driftedFullPath)).toBe(false);

			// Simulate local drift on remaining subagent before remove --all
			const remainingFile = path.join(
				tmpRepo,
				".claude",
				"agents",
				"context-scout.md",
			);
			expect(fs.existsSync(remainingFile)).toBe(true);
			fs.appendFileSync(remainingFile, "\n<!-- local edit -->\n", "utf-8");

			const conflictClean = cleanSyncedArtifacts(tmpRepo, CATALOG_ROOT, {
				force: false,
			});
			expect(conflictClean.passed).toBe(false);
			expect(conflictClean.drift_conflicts).toContain(
				".claude/agents/context-scout.md",
			);
			expect(fs.existsSync(path.join(tmpRepo, ".skillops-lock.json"))).toBe(
				true,
			);

			// Force remove --all removes all remaining managed files and .skillops-lock.json
			expect(
				runCli([
					"node",
					"cli.js",
					"remove",
					"--all",
					"--repo",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
					"--force",
				]),
			).toBe(ExitCode.SUCCESS);
			expect(fs.existsSync(path.join(tmpRepo, ".skillops-lock.json"))).toBe(
				false,
			);
			expect(fs.existsSync(remainingFile)).toBe(false);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("transpiles Skills and Subagents natively across all Top 28 AI coding agents (--targets all)", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-top28-sync-"),
		);
		try {
			expect(
				runCli([
					"node",
					"cli.js",
					"add",
					"mcp-architect",
					"--repo",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
					"--targets",
					"all",
				]),
			).toBe(ExitCode.SUCCESS);

			expect(
				runCli([
					"node",
					"cli.js",
					"add",
					"context-scout",
					"--repo",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
					"--targets",
					"all",
				]),
			).toBe(ExitCode.SUCCESS);

			expect(ALL_RUNTIME_TARGETS).toHaveLength(28);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".windsurf", "rules", "skillops-mcp-architect.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".clinerules", "skillops-mcp-architect.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".roo", "rules", "skillops-mcp-architect.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".kiro", "steering", "skillops-mcp-architect.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".gemini", "skills", "mcp-architect", "SKILL.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".vibe", "agents", "skillops-agent-context-scout.toml"),
				),
			).toBe(true);

			// Remove across all targets
			const rmReport = removeSkillOrSubagent(
				tmpRepo,
				CATALOG_ROOT,
				"mcp-architect",
			);
			expect(rmReport.passed).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".windsurf", "rules", "skillops-mcp-architect.md"),
				),
			).toBe(false);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("builds interactive options and supports 'add --all', 'install', 'uninstall', and 'remove --all'", () => {
		const targetOptions = buildInteractiveTargetOptions();
		expect(targetOptions.length).toBe(28);
		expect(targetOptions[0]?.value).toBe("cursor");
		expect(targetOptions[1]?.value).toBe("claude");
		expect(targetOptions[2]?.value).toBe("copilot");
		expect(targetOptions[3]?.value).toBe("antigravity");

		const catalogOptions = buildInteractiveCatalogOptions(CATALOG_ROOT);
		expect(catalogOptions.length).toBe(3);
		expect(catalogOptions.filter((o) => o.kind === "skill").length).toBe(2);
		expect(catalogOptions.filter((o) => o.kind === "agent").length).toBe(1);

		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-cli-workflow-"),
		);
		const outChunks: string[] = [];
		const errChunks: string[] = [];
		const stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk) => {
				outChunks.push(String(chunk));
				return true;
			});
		const stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation((chunk) => {
				errChunks.push(String(chunk));
				return true;
			});

		try {
			expect(
				runCli([
					"node",
					"skillops",
					"install",
					"--all",
					"-p",
					tmpRepo,
					"-t",
					"cursor,gemini",
					"-f",
					"json",
				]),
			).toBe(ExitCode.SUCCESS);
			const addAllJson = JSON.parse(outChunks.join("")) as {
				passed: boolean;
				artifacts: unknown[];
			};
			expect(addAllJson.passed).toBe(true);
			expect(addAllJson.artifacts.length).toBeGreaterThanOrEqual(2);
			outChunks.length = 0;

			const installedOpts = buildInteractiveInstalledOptions(
				tmpRepo,
				CATALOG_ROOT,
			);
			expect(installedOpts.length).toBe(3);
			expect(installedOpts[0]?.value).toBe("mcp-architect");
			expect(installedOpts[0]?.kind).toBe("skill");
			expect(installedOpts[0]?.hint).toContain("[cursor, gemini]");
			expect(installedOpts[1]?.value).toBe("env-secrets-guard");
			expect(installedOpts[1]?.kind).toBe("skill");
			expect(installedOpts[2]?.value).toBe("context-scout");
			expect(installedOpts[2]?.kind).toBe("agent");

			expect(
				runCli([
					"node",
					"skillops",
					"uninstall",
					"--all",
					"-p",
					tmpRepo,
					"-f",
					"json",
				]),
			).toBe(ExitCode.SUCCESS);
			expect(buildInteractiveInstalledOptions(tmpRepo, CATALOG_ROOT)).toEqual(
				[],
			);

			// Unknown command suggests 'install'
			expect(runCli(["node", "skillops", "instal"])).toBe(ExitCode.ERROR);
			expect(errChunks.join("")).toContain(
				"Unknown command 'instal'. Did you mean 'install'?",
			);
		} finally {
			stdoutSpy.mockRestore();
			stderrSpy.mockRestore();
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("validates pre-existing Skill or Subagent in a CLI folder without lockfile, skips without overwriting, and warns at the end (Issue #169)", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-skip-preexisting-"),
		);
		try {
			// Pre-create a manual mcp-architect skill in .claude/skills/mcp-architect/SKILL.md before SkillOps ever runs
			const manualSkillDir = path.join(
				tmpRepo,
				".claude",
				"skills",
				"mcp-architect",
			);
			fs.mkdirSync(manualSkillDir, { recursive: true });
			const manualSkillFile = path.join(manualSkillDir, "SKILL.md");
			const customContent = "# Custom user-owned mcp-architect skill\n";
			fs.writeFileSync(manualSkillFile, customContent, "utf-8");

			const report = addSkillOrSubagent(
				tmpRepo,
				CATALOG_ROOT,
				"mcp-architect",
				{
					targets: ["claude", "cursor"],
				},
			);

			expect(report.passed).toBe(true);
			// Must NOT overwrite the existing skill in claude
			expect(fs.readFileSync(manualSkillFile, "utf-8")).toBe(customContent);
			expect(report.skipped_existing).toEqual([
				".claude/skills/mcp-architect/SKILL.md",
			]);
			expect(
				report.artifacts.find((a) => a.target === "claude")?.action,
			).toBe("skipped");

			// Must still create the skill in cursor
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".cursor", "rules", "skillops-mcp-architect.mdc"),
				),
			).toBe(true);
			expect(
				report.artifacts.find((a) => a.target === "cursor")?.action,
			).toBe("created");

			const tableOut = stripAnsi(formatSyncReport(report, "table", false));
			expect(tableOut).toContain("4 created, 1 skipped");
			expect(tableOut).toContain("Skipped — Already Exists (1)");
			expect(tableOut).toContain(
				"(claude) mcp-architect already exists at .claude/skills/mcp-architect/SKILL.md",
			);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("installs Skills and Subagents across all selected AI IDEs simultaneously via comma or repeated -t flags (Issue #170)", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-multi-ide-install-"),
		);
		try {
			const code = runCli([
				"node",
				"cli.js",
				"add",
				"mcp-architect",
				"context-scout",
				"--repo",
				tmpRepo,
				"--catalog",
				CATALOG_ROOT,
				"-t",
				"cursor",
				"-t",
				"claude",
				"--target",
				"gemini",
			]);
			expect(code).toBe(ExitCode.SUCCESS);

			// Verify all 3 selected AI IDEs received both the Skill and the Subagent
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".cursor", "rules", "skillops-mcp-architect.mdc"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(
						tmpRepo,
						".cursor",
						"rules",
						"skillops-agent-context-scout.mdc",
					),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".claude", "skills", "mcp-architect", "SKILL.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".claude", "agents", "context-scout.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".gemini", "skills", "mcp-architect", "SKILL.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".gemini", "agents", "context-scout.md"),
				),
			).toBe(true);

			const lockRaw = JSON.parse(
				fs.readFileSync(path.join(tmpRepo, ".skillops-lock.json"), "utf-8"),
			) as { targets: string[]; selected_skills: string[]; selected_subagents: string[] };
			expect(lockRaw.targets).toEqual(["cursor", "claude", "gemini"]);
			expect(lockRaw.selected_skills).toEqual(["mcp-architect"]);
			expect(lockRaw.selected_subagents).toEqual(["context-scout"]);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("shows installed status indicators in Step 2 catalog options across single and multiple selected targets (Issue #171)", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-step2-installed-status-"),
		);
		try {
			// 1. Fresh repo: no items installed in any selected target -> clean descriptions without clutter
			const cleanOpts = buildInteractiveCatalogOptions(CATALOG_ROOT, {
				repoPath: tmpRepo,
				targets: ["claude", "cursor"],
			});
			for (const opt of cleanOpts) {
				expect(opt.hint).not.toContain("[installed");
			}

			// 2. Install mcp-architect in claude only, and context-scout in both claude and cursor
			addSkillOrSubagent(tmpRepo, CATALOG_ROOT, "mcp-architect", {
				targets: ["claude"],
			});
			addSkillOrSubagent(tmpRepo, CATALOG_ROOT, "context-scout", {
				targets: ["claude", "cursor"],
			});

			expect(
				detectExistingTargetsForItem(tmpRepo, "mcp-architect", "skill", [
					"claude",
					"cursor",
				]),
			).toEqual(["claude"]);
			expect(
				detectExistingTargetsForItem(tmpRepo, "env-secrets-guard", "skill", [
					"claude",
					"cursor",
				]),
			).toEqual([]);
			expect(
				detectExistingTargetsForItem(tmpRepo, "context-scout", "subagent", [
					"claude",
					"cursor",
				]),
			).toEqual(["claude", "cursor"]);

			// 3. Single selected target (claude): mcp-architect and context-scout are installed in all selected targets ([installed])
			const singleTargetOpts = buildInteractiveCatalogOptions(CATALOG_ROOT, {
				repoPath: tmpRepo,
				targets: ["claude"],
			});
			const singleMcp = singleTargetOpts.find(
				(o) => o.value === "mcp-architect",
			);
			const singleSecrets = singleTargetOpts.find(
				(o) => o.value === "env-secrets-guard",
			);
			const singleScout = singleTargetOpts.find(
				(o) => o.value === "context-scout",
			);
			expect(singleMcp?.hint?.startsWith("[installed] · ")).toBe(true);
			expect(singleSecrets?.hint?.startsWith("[installed")).toBe(false);
			expect(singleScout?.hint?.startsWith("[installed] · ")).toBe(true);

			// 4. Multiple selected targets (claude, cursor):
			//    - mcp-architect exists only in claude -> [installed: claude]
			//    - env-secrets-guard exists in neither -> clean description
			//    - context-scout exists in both -> [installed]
			const multiTargetOpts = buildInteractiveCatalogOptions(CATALOG_ROOT, {
				repoPath: tmpRepo,
				targets: ["claude", "cursor"],
			});
			const multiMcp = multiTargetOpts.find((o) => o.value === "mcp-architect");
			const multiSecrets = multiTargetOpts.find(
				(o) => o.value === "env-secrets-guard",
			);
			const multiScout = multiTargetOpts.find(
				(o) => o.value === "context-scout",
			);
			expect(multiMcp?.hint?.startsWith("[installed: claude] · ")).toBe(true);
			expect(multiSecrets?.hint?.startsWith("[installed")).toBe(false);
			expect(multiScout?.hint?.startsWith("[installed] · ")).toBe(true);

			// 5. Verify Step 2 TUI frame rendering with installed badges & <= 78 column budget
			const step2State = createMultiSelectState(multiTargetOpts, {
				showSelectAll: true,
			});
			const step2Frame = renderMultiSelectFrame(
				"SkillOps — Step 2/2: Select Skills & Agents to Import",
				step2State,
				{
					targetHint: "claude, cursor",
					showSelectAll: true,
					colorEnabled: true,
				},
			);
			expect(stripAnsi(step2Frame)).toContain("[installed: claude]");
			for (const line of step2Frame.split("\n")) {
				expect(visibleLength(line)).toBeLessThanOrEqual(78);
			}
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("discovers and removes installed Skills and Subagents directly from IDE directories on disk when .skillops-lock.json is deleted (Issue #172)", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-lockless-remove-"),
		);
		try {
			// Install mcp-architect, env-secrets-guard, and context-scout across claude, cursor, and copilot
			addSkillOrSubagent(tmpRepo, CATALOG_ROOT, "mcp-architect", {
				targets: ["claude", "cursor", "copilot"],
			});
			addSkillOrSubagent(tmpRepo, CATALOG_ROOT, "env-secrets-guard", {
				targets: ["claude", "cursor"],
			});
			addSkillOrSubagent(tmpRepo, CATALOG_ROOT, "context-scout", {
				targets: ["claude", "cursor", "copilot"],
			});

			// Delete .skillops-lock.json to simulate a gitignored or manually deleted lockfile
			const lockPath = path.join(tmpRepo, ".skillops-lock.json");
			expect(fs.existsSync(lockPath)).toBe(true);
			fs.unlinkSync(lockPath);
			expect(fs.existsSync(lockPath)).toBe(false);

			// 1. Verify discoverInstalledArtifactsOnDisk & buildInteractiveInstalledOptions work without lockfile
			const onDisk = discoverInstalledArtifactsOnDisk(tmpRepo, CATALOG_ROOT);
			expect(onDisk.length).toBeGreaterThanOrEqual(8);
			expect(onDisk.every((d) => d.fromLockfile === false)).toBe(true);

			const installedOptions = buildInteractiveInstalledOptions(
				tmpRepo,
				CATALOG_ROOT,
			);
			expect(installedOptions.map((o) => o.value)).toEqual([
				"env-secrets-guard",
				"mcp-architect",
				"context-scout",
			]);
			expect(
				installedOptions.find((o) => o.value === "mcp-architect")?.hint,
			).toContain("[claude, cursor, copilot]");
			expect(
				installedOptions.find((o) => o.value === "context-scout")?.kind,
			).toBe("agent");

			// 2. Surgically remove mcp-architect via CLI without .skillops-lock.json
			expect(
				runCli([
					"node",
					"cli.js",
					"remove",
					"mcp-architect",
					"--repo",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
				]),
			).toBe(ExitCode.SUCCESS);

			expect(
				fs.existsSync(
					path.join(tmpRepo, ".claude", "skills", "mcp-architect"),
				),
			).toBe(false);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".cursor", "rules", "skillops-mcp-architect.mdc"),
				),
			).toBe(false);
			expect(
				fs.existsSync(
					path.join(
						tmpRepo,
						".github",
						"instructions",
						"skillops-mcp-architect.instructions.md",
					),
				),
			).toBe(false);
			expect(
				fs.existsSync(
					path.join(
						tmpRepo,
						".github",
						"prompts",
						"skillops-mcp-architect.prompt.md",
					),
				),
			).toBe(false);
			expect(fs.existsSync(lockPath)).toBe(false);

			// Remaining items are still intact
			expect(
				fs.existsSync(
					path.join(
						tmpRepo,
						".claude",
						"skills",
						"env-secrets-guard",
						"SKILL.md",
					),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".claude", "agents", "context-scout.md"),
				),
			).toBe(true);

			// 3. Remove all remaining installed items via remove --all without lockfile
			expect(
				runCli([
					"node",
					"cli.js",
					"remove",
					"--all",
					"--repo",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
				]),
			).toBe(ExitCode.SUCCESS);

			expect(buildInteractiveInstalledOptions(tmpRepo, CATALOG_ROOT)).toEqual(
				[],
			);
			expect(fs.existsSync(path.join(tmpRepo, ".claude"))).toBe(false);
			expect(fs.existsSync(path.join(tmpRepo, ".cursor"))).toBe(false);
			expect(fs.existsSync(path.join(tmpRepo, ".github"))).toBe(false);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("supports selective per-IDE uninstallation in interactive TUI and CLI remove flows (Issue #173)", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-selective-remove-"),
		);
		try {
			// Install mcp-architect in cursor and claude, and env-secrets-guard in claude only
			addSkillOrSubagent(tmpRepo, CATALOG_ROOT, "mcp-architect", {
				targets: ["cursor", "claude"],
			});
			addSkillOrSubagent(tmpRepo, CATALOG_ROOT, "env-secrets-guard", {
				targets: ["claude"],
			});

			// 1. Verify Step 1/2 target options for interactive remove when 2+ IDEs have installed items
			const targetOpts = buildInteractiveInstalledTargetOptions(
				tmpRepo,
				CATALOG_ROOT,
			);
			expect(targetOpts.map((o) => o.value)).toEqual(["cursor", "claude"]);
			expect(targetOpts[0]?.hint).toContain("1 item: mcp-architect");
			expect(targetOpts[1]?.hint).toContain("2 items:");

			// Render Step 1/2 interactive target selector frame and select only 'cursor'
			let step1State = createMultiSelectState(targetOpts, {
				showSelectAll: true,
			});
			expect(step1State.options[0]?.label).toBe("[ALL] Select all AI IDEs");
			// Move cursor down to 'cursor' and press Enter (selectCursorOnEmptySubmit)
			step1State = applyMultiSelectKey(step1State, "\x1b[B");
			const step1Frame = renderMultiSelectFrame(
				"SkillOps — Step 1/2: Select AI IDE(s) to Remove From",
				step1State,
				{
					tabLabels: { skill: "Installed AI IDEs", agent: "" },
					submitActionLabel: "continue",
					selectCursorOnEmptySubmit: true,
					showSelectAll: true,
					colorEnabled: false,
				},
			);
			expect(step1Frame).toContain("[ ◆ Installed AI IDEs (2) ]");
			expect(step1Frame).toContain("Target: cursor — Enter to continue");
			step1State = applyMultiSelectKey(step1State, "\r", {
				selectCursorOnEmptySubmit: true,
			});
			expect([...step1State.selected]).toEqual(["cursor"]);

			// 2. Step 2/2 options filtered to 'cursor' only list mcp-architect (not env-secrets-guard)
			const cursorInstalledOpts = buildInteractiveInstalledOptions(
				tmpRepo,
				CATALOG_ROOT,
				["cursor"],
			);
			expect(cursorInstalledOpts.map((o) => o.value)).toEqual([
				"mcp-architect",
			]);
			expect(cursorInstalledOpts[0]?.hint).toContain("[cursor]");

			// 3. Remove mcp-architect ONLY from cursor via CLI (-t cursor)
			expect(
				runCli([
					"node",
					"cli.js",
					"remove",
					"mcp-architect",
					"-p",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
					"-t",
					"cursor",
				]),
			).toBe(ExitCode.SUCCESS);

			// Verify cursor copy was removed while claude installation & lockfile entries remain intact
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".cursor", "rules", "skillops-mcp-architect.mdc"),
				),
			).toBe(false);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".claude", "skills", "mcp-architect", "SKILL.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(
						tmpRepo,
						".claude",
						"skills",
						"env-secrets-guard",
						"SKILL.md",
					),
				),
			).toBe(true);

			const lockAfterSelectiveRemove = JSON.parse(
				fs.readFileSync(path.join(tmpRepo, ".skillops-lock.json"), "utf-8"),
			) as {
				targets: string[];
				selected_skills: string[];
				artifacts: Record<string, { target: string; skill_name: string }>;
			};
			expect(lockAfterSelectiveRemove.targets).toEqual(["claude"]);
			expect(lockAfterSelectiveRemove.selected_skills).toEqual([
				"mcp-architect",
				"env-secrets-guard",
			]);
			expect(
				Object.values(lockAfterSelectiveRemove.artifacts).every(
					(a) => a.target === "claude",
				),
			).toBe(true);

			// 4. Now only 1 IDE (claude) has installed artifacts
			const remainingTargetOpts = buildInteractiveInstalledTargetOptions(
				tmpRepo,
				CATALOG_ROOT,
			);
			expect(remainingTargetOpts.map((o) => o.value)).toEqual(["claude"]);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("auto-detects and pre-selects existing project AI IDEs at the top of Step 1 selector and in default CLI add (Issue #174)", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-step1-autodetect-"),
		);
		try {
			// 1. Fresh repo with no AI IDE directories: standard popularity order, no [detected] badges or pre-selection
			const cleanOpts = buildInteractiveTargetOptions(tmpRepo);
			expect(cleanOpts[0]?.value).toBe("cursor");
			expect(cleanOpts[1]?.value).toBe("claude");
			expect(cleanOpts.every((o) => !o.initialSelected)).toBe(true);
			expect(cleanOpts.every((o) => !o.hint?.startsWith("[detected]"))).toBe(
				true,
			);

			// 2. Create existing IDE directories (.claude/ and .gemini/ plus .cursor/) in the repository
			fs.mkdirSync(path.join(tmpRepo, ".claude"), { recursive: true });
			fs.mkdirSync(path.join(tmpRepo, ".cursor"), { recursive: true });
			fs.mkdirSync(path.join(tmpRepo, ".gemini"), { recursive: true });

			const detectedOpts = buildInteractiveTargetOptions(tmpRepo);
			expect(detectedOpts.length).toBe(ALL_RUNTIME_TARGETS.length);

			// Detected targets appear at the very top of Step 1 with [detected] hints and initialSelected: true
			expect(detectedOpts.slice(0, 3).map((o) => o.value)).toEqual([
				"cursor",
				"claude",
				"gemini",
			]);
			for (const topOpt of detectedOpts.slice(0, 3)) {
				expect(topOpt.initialSelected).toBe(true);
				expect(topOpt.hint).toMatch(/^\[detected\] · /);
			}
			for (const restOpt of detectedOpts.slice(3)) {
				expect(restOpt.initialSelected).toBeUndefined();
				expect(restOpt.hint).not.toMatch(/^\[detected\]/);
			}

			// 3. Verify Step 1 multi-select state initializes with detected IDEs pre-selected and renders cleanly
			const step1State = createMultiSelectState(detectedOpts, {
				showSelectAll: true,
			});
			expect([...step1State.selected]).toEqual(["cursor", "claude", "gemini"]);

			const frame = renderMultiSelectFrame(
				"SkillOps — Step 1/2: Select Your AI IDE / Agent",
				step1State,
				{
					colorEnabled: false,
					subtitle:
						"Select one or more AI coding assistants with Space · Enter to continue",
					tabLabels: {
						skill: "AI IDEs & Agents",
						agent: "",
					},
					submitActionLabel: "continue",
					selectCursorOnEmptySubmit: true,
				},
			);
			expect(frame).toContain("[detected]");
			expect(frame).toContain(
				"3 selected (cursor, claude, gemini) — Enter to continue",
			);
			for (const line of frame.split("\n")) {
				expect(visibleLength(line)).toBeLessThanOrEqual(78);
			}

			// 4. Verify non-interactive CLI add without -t automatically targets the detected repo harnesses
			expect(
				runCli([
					"node",
					"cli.js",
					"add",
					"mcp-architect",
					"-p",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
				]),
			).toBe(ExitCode.SUCCESS);

			expect(
				fs.existsSync(
					path.join(tmpRepo, ".cursor", "rules", "skillops-mcp-architect.mdc"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".claude", "skills", "mcp-architect", "SKILL.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".gemini", "skills", "mcp-architect", "SKILL.md"),
				),
			).toBe(true);
			// Undetected core target (.github / copilot) is not created
			expect(
				fs.existsSync(
					path.join(
						tmpRepo,
						".github",
						"instructions",
						"skillops-mcp-architect.instructions.md",
					),
				),
			).toBe(false);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("bundles and copies all files and nested subdirectories inside a Skill folder across both directory-based and rule-based targets and cleans them up on remove (Issue #175)", () => {
		const tmpWorkspace = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-bundle-all-files-"),
		);
		const tmpCatalog = path.join(tmpWorkspace, "catalog");
		const tmpRepo = path.join(tmpWorkspace, "repo");
		fs.mkdirSync(tmpRepo, { recursive: true });

		try {
			const skillDir = path.join(
				tmpCatalog,
				"arch-quality",
				"polyglot-bundler",
			);
			fs.mkdirSync(path.join(skillDir, "scripts", "helpers"), {
				recursive: true,
			});
			fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
			fs.mkdirSync(path.join(skillDir, "assets", "templates"), {
				recursive: true,
			});
			fs.mkdirSync(path.join(skillDir, "evals"), { recursive: true });

			const skillMdContent = [
				"---",
				'name: "polyglot-bundler"',
				'description: "Use when verifying that a hybrid executable skill bundles and installs every companion file, script, configuration template, shell helper, JSON schema, YAML ruleset, and nested subdirectory across all twenty-eight target AI coding IDEs and CLIs without dropping non-Python or non-Markdown assets during repository synchronization. Do not trigger for unrelated frontend styling tasks."',
				'version: "1.0.0"',
				'track: "arch-quality"',
				"tags:",
				'  - "bundling"',
				'  - "multi-runtime"',
				"routing_signals:",
				'  languages: ["python", "typescript"]',
				'  files_any: ["package.json"]',
				"  dependencies_any: []",
				"  negative_triggers:",
				'    - "Do not trigger for unrelated tasks."',
				"entrypoints:",
				"  scripts:",
				'    - path: "scripts/audit.py"',
				'      description: "Primary Python audit entrypoint."',
				"---",
				"",
				"# Polyglot Bundler (`polyglot-bundler`)",
				"",
				"Run `python catalog/arch-quality/polyglot-bundler/scripts/audit.py` or `bash catalog/arch-quality/polyglot-bundler/scripts/bootstrap.sh`.",
				"",
			].join("\n");

			fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMdContent, "utf-8");
			fs.writeFileSync(
				path.join(skillDir, "scripts", "audit.py"),
				'print("ok")\n',
				"utf-8",
			);
			fs.writeFileSync(
				path.join(skillDir, "scripts", "bootstrap.sh"),
				"#!/usr/bin/env bash\necho ok\n",
				"utf-8",
			);
			fs.writeFileSync(
				path.join(skillDir, "scripts", "helpers", "formatter.mjs"),
				"export const fmt = (x) => String(x);\n",
				"utf-8",
			);
			fs.writeFileSync(
				path.join(skillDir, "references", "checklist.md"),
				"# Checklist\n",
				"utf-8",
			);
			fs.writeFileSync(
				path.join(skillDir, "references", "rules.yaml"),
				"strict: true\n",
				"utf-8",
			);
			fs.writeFileSync(
				path.join(skillDir, "assets", "schema.json"),
				'{"type":"object"}\n',
				"utf-8",
			);
			fs.writeFileSync(
				path.join(skillDir, "assets", "templates", "prompt.txt"),
				"Template body\n",
				"utf-8",
			);
			fs.writeFileSync(
				path.join(skillDir, "evals", "evals.json"),
				'{"skill_name":"polyglot-bundler","cases":[]}\n',
				"utf-8",
			);
			// OS junk files that must be ignored
			fs.writeFileSync(path.join(skillDir, ".DS_Store"), "junk", "utf-8");

			const expectedCompanionRelPaths = [
				"assets/schema.json",
				"assets/templates/prompt.txt",
				"evals/evals.json",
				"references/checklist.md",
				"references/rules.yaml",
				"scripts/audit.py",
				"scripts/bootstrap.sh",
				"scripts/helpers/formatter.mjs",
			];

			const report = addSkillOrSubagent(
				tmpRepo,
				tmpCatalog,
				"polyglot-bundler",
				{
					targets: ["claude", "antigravity", "cursor", "copilot", "windsurf"],
				},
			);
			expect(report.passed).toBe(true);

			// 1. Verify progressive-skill-dir targets (claude, antigravity) receive SKILL.md + all companion files
			for (const base of [
				path.join(tmpRepo, ".claude", "skills", "polyglot-bundler"),
				path.join(tmpRepo, ".agent", "skills", "polyglot-bundler"),
			]) {
				expect(fs.existsSync(path.join(base, "SKILL.md"))).toBe(true);
				expect(fs.existsSync(path.join(base, ".DS_Store"))).toBe(false);
				for (const rel of expectedCompanionRelPaths) {
					expect(fs.existsSync(path.join(base, rel))).toBe(true);
				}
			}

			// 2. Verify rule-based targets (cursor, copilot, windsurf) receive native rule file + all companion files + localized paths
			const cursorRulePath = path.join(
				tmpRepo,
				".cursor",
				"rules",
				"skillops-polyglot-bundler.mdc",
			);
			expect(fs.existsSync(cursorRulePath)).toBe(true);
			expect(fs.readFileSync(cursorRulePath, "utf-8")).toContain(
				".cursor/rules/polyglot-bundler/scripts/audit.py",
			);
			for (const rel of expectedCompanionRelPaths) {
				expect(
					fs.existsSync(
						path.join(tmpRepo, ".cursor", "rules", "polyglot-bundler", rel),
					),
				).toBe(true);
				expect(
					fs.existsSync(
						path.join(
							tmpRepo,
							".github",
							"instructions",
							"polyglot-bundler",
							rel,
						),
					),
				).toBe(true);
				expect(
					fs.existsSync(
						path.join(tmpRepo, ".windsurf", "rules", "polyglot-bundler", rel),
					),
				).toBe(true);
			}

			// 3. Verify removeSkillOrSubagent removes the rule files AND all companion files/folders across all targets
			const rmReport = removeSkillOrSubagent(
				tmpRepo,
				tmpCatalog,
				"polyglot-bundler",
			);
			expect(rmReport.passed).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".claude", "skills", "polyglot-bundler"),
				),
			).toBe(false);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".cursor", "rules", "polyglot-bundler"),
				),
			).toBe(false);
			expect(fs.existsSync(cursorRulePath)).toBe(false);
			expect(
				fs.existsSync(
					path.join(
						tmpRepo,
						".github",
						"instructions",
						"polyglot-bundler",
					),
				),
			).toBe(false);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".windsurf", "rules", "polyglot-bundler"),
				),
			).toBe(false);
		} finally {
			fs.rmSync(tmpWorkspace, { recursive: true, force: true });
		}
	});

	it("supports --global / -g flag to install and remove Skills and Subagents in user home directory (Issue #176)", () => {
		const tmpHome = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-global-home-"),
		);
		const prevGlobalHome = process.env.SKILLOPS_GLOBAL_HOME;
		process.env.SKILLOPS_GLOBAL_HOME = tmpHome;

		const outChunks: string[] = [];
		const stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk) => {
				outChunks.push(String(chunk));
				return true;
			});

		try {
			expect(isGlobalFlag(["add", "--global"])).toBe(true);
			expect(isGlobalFlag(["remove", "-g"])).toBe(true);
			expect(isGlobalFlag(["add", "mcp-architect"])).toBe(false);
			expect(resolveTargetRepoPath(["add", "--global"])).toBe(
				path.resolve(tmpHome),
			);
			expect(resolveTargetRepoPath(["remove", "-g"])).toBe(
				path.resolve(tmpHome),
			);

			// 1. Install mcp-architect and context-scout globally via --global / -g
			expect(
				runCli([
					"node",
					"cli.js",
					"add",
					"mcp-architect",
					"context-scout",
					"--global",
					"--catalog",
					CATALOG_ROOT,
					"-t",
					"claude,cursor",
				]),
			).toBe(ExitCode.SUCCESS);

			const installOutput = stripAnsi(outChunks.join(""));
			expect(installOutput).toContain("[Global: ~]");
			outChunks.length = 0;

			expect(
				fs.existsSync(
					path.join(tmpHome, ".claude", "skills", "mcp-architect", "SKILL.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpHome, ".claude", "agents", "context-scout.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpHome, ".cursor", "rules", "skillops-mcp-architect.mdc"),
				),
			).toBe(true);
			expect(fs.existsSync(path.join(tmpHome, ".skillops-lock.json"))).toBe(
				true,
			);

			// 2. Remove mcp-architect globally via -g
			expect(
				runCli([
					"node",
					"cli.js",
					"remove",
					"mcp-architect",
					"-g",
					"--catalog",
					CATALOG_ROOT,
				]),
			).toBe(ExitCode.SUCCESS);

			const removeOutput = stripAnsi(outChunks.join(""));
			expect(removeOutput).toContain("[Global: ~]");
			outChunks.length = 0;

			expect(
				fs.existsSync(
					path.join(tmpHome, ".claude", "skills", "mcp-architect"),
				),
			).toBe(false);
			expect(
				fs.existsSync(
					path.join(tmpHome, ".cursor", "rules", "skillops-mcp-architect.mdc"),
				),
			).toBe(false);
			// Subagent remains in global home
			expect(
				fs.existsSync(
					path.join(tmpHome, ".claude", "agents", "context-scout.md"),
				),
			).toBe(true);
		} finally {
			stdoutSpy.mockRestore();
			if (prevGlobalHome === undefined) {
				delete process.env.SKILLOPS_GLOBAL_HOME;
			} else {
				process.env.SKILLOPS_GLOBAL_HOME = prevGlobalHome;
			}
			fs.rmSync(tmpHome, { recursive: true, force: true });
		}
	});

	it("classifies all 5 artifact health states via inspectProjectStatus (Issue #200)", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-status-engine-"),
		);
		const tmpCatalog = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-status-catalog-"),
		);
		try {
			fs.cpSync(CATALOG_ROOT, tmpCatalog, { recursive: true });

			// 1. Install mcp-architect into cursor & claude, and context-scout into cursor
			addSkillOrSubagent(tmpRepo, tmpCatalog, "mcp-architect", {
				targets: ["cursor", "claude"],
			});
			addSkillOrSubagent(tmpRepo, tmpCatalog, "context-scout", {
				targets: ["cursor"],
			});

			// Initial status: all installed files are up_to_date
			const cleanStatus = inspectProjectStatus(tmpRepo, tmpCatalog);
			expect(cleanStatus.lockfile_present).toBe(true);
			expect(cleanStatus.passed).toBe(true);
			expect(cleanStatus.installed_skills).toEqual(["mcp-architect"]);
			expect(cleanStatus.installed_subagents).toEqual(["context-scout"]);
			expect(cleanStatus.counts.up_to_date).toBeGreaterThanOrEqual(3);
			expect(cleanStatus.counts.update_available).toBe(0);
			expect(cleanStatus.counts.drift_modified).toBe(0);
			expect(cleanStatus.counts.missing_on_disk).toBe(0);
			expect(cleanStatus.counts.untracked_on_disk).toBe(0);

			// 2. Simulate DRIFT_MODIFIED on .cursor/rules/skillops-mcp-architect.mdc
			const cursorSkillFile = path.join(
				tmpRepo,
				".cursor",
				"rules",
				"skillops-mcp-architect.mdc",
			);
			fs.appendFileSync(cursorSkillFile, "\n<!-- local drift -->\n", "utf-8");

			// 3. Simulate MISSING_ON_DISK by deleting .cursor/rules/skillops-agent-context-scout.mdc
			const cursorAgentFile = path.join(
				tmpRepo,
				".cursor",
				"rules",
				"skillops-agent-context-scout.mdc",
			);
			fs.unlinkSync(cursorAgentFile);

			// 4. Simulate UNTRACKED_ON_DISK by writing a subagent file in .gemini/agents/context-scout.md without lockfile entry
			const geminiAgentsDir = path.join(tmpRepo, ".gemini", "agents");
			fs.mkdirSync(geminiAgentsDir, { recursive: true });
			fs.writeFileSync(
				path.join(geminiAgentsDir, "context-scout.md"),
				"# Untracked context-scout\n",
				"utf-8",
			);

			// 5. Simulate UPDATE_AVAILABLE by updating the catalog's mcp-architect SKILL.md (while .claude/skills/mcp-architect/SKILL.md on disk still matches lockfile)
			const catalogSkillMd = path.join(
				tmpCatalog,
				"ai-engineering",
				"mcp-architect",
				"SKILL.md",
			);
			fs.appendFileSync(
				catalogSkillMd,
				"\n<!-- new catalog upstream content -->\n",
				"utf-8",
			);

			const mixedStatus = inspectProjectStatus(tmpRepo, tmpCatalog);
			expect(mixedStatus.passed).toBe(false);
			expect(mixedStatus.counts.drift_modified).toBe(1);
			expect(mixedStatus.counts.missing_on_disk).toBe(1);
			expect(mixedStatus.counts.untracked_on_disk).toBe(1);
			expect(mixedStatus.counts.update_available).toBe(1);
			expect(mixedStatus.counts.up_to_date).toBeGreaterThanOrEqual(1);

			const byRelPath = new Map(
				mixedStatus.artifacts.map((a) => [a.relativePath, a.state]),
			);
			expect(byRelPath.get(".cursor/rules/skillops-mcp-architect.mdc")).toBe(
				"drift_modified",
			);
			expect(
				byRelPath.get(".cursor/rules/skillops-agent-context-scout.mdc"),
			).toBe("missing_on_disk");
			expect(byRelPath.get(".gemini/agents/context-scout.md")).toBe(
				"untracked_on_disk",
			);
			expect(byRelPath.get(".claude/skills/mcp-architect/SKILL.md")).toBe(
				"update_available",
			);

			// Format table output and verify <= 78 visible cols per line (Issue #201)
			const tableOut = formatProjectStatusReport(mixedStatus, "table", true);
			expect(stripAnsi(tableOut)).toContain(
				"Project Status & Installed Modules",
			);
			expect(stripAnsi(tableOut)).toContain("! DRIFT");
			expect(stripAnsi(tableOut)).toContain("? MISSING");
			expect(stripAnsi(tableOut)).toContain("+ UNTRACK");
			expect(stripAnsi(tableOut)).toContain("~ OUTDATED");
			for (const line of tableOut.split("\n")) {
				expect(visibleLength(line)).toBeLessThanOrEqual(78);
			}

			// Format markdown output
			const mdOut = formatProjectStatusReport(mixedStatus, "markdown", false);
			expect(mdOut).toContain("## SkillOps Project Status Report");
			expect(mdOut).toContain("`drift_modified`");

			// CLI invocation: 'skillops status', 'skillops list -f json', and 'skillops ls -f md'
			const outChunks: string[] = [];
			const stdoutSpy = vi
				.spyOn(process.stdout, "write")
				.mockImplementation((chunk: string | Uint8Array) => {
					outChunks.push(
						typeof chunk === "string"
							? chunk
							: Buffer.from(chunk).toString("utf-8"),
					);
					return true;
				});
			try {
				// Drifted repo returns ExitCode.ERROR on status
				expect(
					runCli([
						"node",
						"cli.js",
						"status",
						"--repo",
						tmpRepo,
						"--catalog",
						tmpCatalog,
					]),
				).toBe(ExitCode.ERROR);
				expect(stripAnsi(outChunks.join(""))).toContain("DRIFT DETECTED");
				outChunks.length = 0;

				expect(
					runCli([
						"node",
						"cli.js",
						"list",
						"--repo",
						tmpRepo,
						"--catalog",
						tmpCatalog,
						"-f",
						"json",
					]),
				).toBe(ExitCode.ERROR);
				const parsedJson = JSON.parse(outChunks.join("")) as {
					installed_skills: string[];
					counts: { drift_modified: number };
				};
				expect(parsedJson.installed_skills).toContain("mcp-architect");
				expect(parsedJson.counts.drift_modified).toBe(1);
			} finally {
				stdoutSpy.mockRestore();
			}
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
			fs.rmSync(tmpCatalog, { recursive: true, force: true });
		}
	});
});
