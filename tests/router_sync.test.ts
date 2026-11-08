import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
	buildInteractiveCatalogOptions,
	buildInteractiveInstalledOptions,
	buildInteractiveTargetOptions,
	runCli,
} from "../src/cli.js";
import {
	ALL_RUNTIME_TARGETS,
	addSkillOrSubagent,
	cleanSyncedArtifacts,
	ExitCode,
	formatSyncReport,
	removeSkillOrSubagent,
	stripAnsi,
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
			expect(tableOut).toContain("1 created, 1 skipped");
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
});
