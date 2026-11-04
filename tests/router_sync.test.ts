import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import {
	ALL_RUNTIME_TARGETS,
	addSkillOrSubagent,
	cleanSyncedArtifacts,
	ExitCode,
	fingerprintRepository,
	removeSkillOrSubagent,
	routeRepository,
	syncRepository,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CATALOG_ROOT = path.join(REPO_ROOT, "catalog");

describe("SkillOps NPX Router & Multi-Runtime Subagent/Skill Transpiler (Issue #61)", () => {
	it("fingerprints a polyglot Python + FastAPI + PostgreSQL + TypeScript repository", () => {
		const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "skillops-fp-test-"));
		try {
			fs.writeFileSync(
				path.join(tmpRepo, "pyproject.toml"),
				[
					"[project]",
					'name = "demo-api"',
					'requires-python = ">=3.12"',
					'dependencies = ["fastapi>=0.115.0", "pydantic>=2.10.0", "sqlalchemy>=2.0.0", "asyncpg>=0.30.0"]',
				].join("\n"),
				"utf-8",
			);
			fs.writeFileSync(
				path.join(tmpRepo, "package.json"),
				JSON.stringify(
					{
						name: "demo-web",
						dependencies: { zod: "^3.24.0" },
						devDependencies: { typescript: "^5.8.0", vitest: "^3.0.0" },
					},
					null,
					2,
				),
				"utf-8",
			);
			const wfDir = path.join(tmpRepo, ".github", "workflows");
			fs.mkdirSync(wfDir, { recursive: true });
			fs.writeFileSync(
				path.join(wfDir, "ci.yml"),
				"name: CI\non: [push]\n",
				"utf-8",
			);

			const profile = fingerprintRepository(tmpRepo);
			expect(profile.languages).toContain("python");
			expect(profile.languages).toContain("typescript");
			expect(profile.frameworks).toContain("fastapi");
			expect(profile.frameworks).toContain("pydantic");
			expect(profile.databases).toContain("postgresql");
			expect(profile.ci_systems).toContain("github-actions");
			expect(profile.python_312_plus).toBe(true);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("compiles a collision-free RoutedBundle with matched Skills and Subagents", () => {
		const bundle = routeRepository(REPO_ROOT, CATALOG_ROOT, {
			maxSkills: 12,
			maxL1Tokens: 1500,
			maxSimilarity: 0.78,
			taskPrompt: "audit MCP server and FastAPI postgres query performance",
		});

		expect(bundle.passed_invariants).toBe(true);
		expect(bundle.selected_skills.length).toBeGreaterThanOrEqual(2);
		expect(bundle.selected_skills.length).toBeLessThanOrEqual(12);
		expect(bundle.total_l1_tokens).toBeLessThanOrEqual(1500);
		expect(bundle.max_pairwise_similarity).toBeLessThan(0.78);
		expect(bundle.recommended_subagents.length).toBeGreaterThanOrEqual(1);
	});

	it("transpiles Skills and Subagents across all 5 runtimes and enforces .skillops-lock.json drift protection", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-sync-test-"),
		);
		try {
			fs.writeFileSync(
				path.join(tmpRepo, "pyproject.toml"),
				[
					"[project]",
					'name = "sync-demo"',
					'requires-python = ">=3.12"',
					'dependencies = ["fastapi>=0.115.0", "pydantic>=2.10.0", "psycopg>=3.2.0"]',
				].join("\n"),
				"utf-8",
			);

			const report = syncRepository(tmpRepo, CATALOG_ROOT, {
				targets: ["claude", "antigravity", "cursor", "codex", "copilot"],
			});

			expect(report.passed).toBe(true);
			expect(report.drift_conflicts).toEqual([]);
			expect(report.artifacts.length).toBeGreaterThan(5);
			expect(fs.existsSync(path.join(tmpRepo, ".skillops-lock.json"))).toBe(
				true,
			);

			// Verify runtime-specific Skill + Subagent outputs exist
			expect(fs.existsSync(path.join(tmpRepo, ".claude", "skills"))).toBe(true);
			expect(fs.existsSync(path.join(tmpRepo, ".claude", "agents"))).toBe(true);
			expect(fs.existsSync(path.join(tmpRepo, ".agent", "skills"))).toBe(true);
			expect(fs.existsSync(path.join(tmpRepo, ".agent", "agents"))).toBe(true);
			expect(fs.existsSync(path.join(tmpRepo, ".cursor", "rules"))).toBe(true);
			expect(fs.existsSync(path.join(tmpRepo, ".codex", "skills"))).toBe(true);
			expect(fs.existsSync(path.join(tmpRepo, "AGENTS.md"))).toBe(true);
			expect(fs.existsSync(path.join(tmpRepo, ".github", "instructions"))).toBe(
				true,
			);
			expect(fs.existsSync(path.join(tmpRepo, ".github", "agents"))).toBe(true);

			// Simulate local drift on one synced file
			const firstArtifact = report.artifacts[0]!;
			const driftedFullPath = path.join(tmpRepo, firstArtifact.relative_path);
			fs.appendFileSync(
				driftedFullPath,
				"\n<!-- manual local edit -->\n",
				"utf-8",
			);

			const conflictReport = syncRepository(tmpRepo, CATALOG_ROOT, {
				targets: ["claude", "antigravity", "cursor", "codex", "copilot"],
				force: false,
			});
			expect(conflictReport.passed).toBe(false);
			expect(conflictReport.drift_conflicts).toContain(
				firstArtifact.relative_path,
			);

			// Force overwrite resolves drift
			const forcedReport = syncRepository(tmpRepo, CATALOG_ROOT, {
				targets: ["claude", "antigravity", "cursor", "codex", "copilot"],
				force: true,
			});
			expect(forcedReport.passed).toBe(true);
			expect(forcedReport.drift_conflicts).toEqual([]);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("supports surgical single-item 'addSkillOrSubagent' and CLI route/sync/add commands", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-add-test-"),
		);
		try {
			const skillReport = addSkillOrSubagent(
				tmpRepo,
				CATALOG_ROOT,
				"mcp-architect",
				{
					targets: ["claude", "cursor"],
				},
			);
			expect(skillReport.passed).toBe(true);
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

			const subagentReport = addSkillOrSubagent(
				tmpRepo,
				CATALOG_ROOT,
				"skill-auditor",
				{
					targets: ["claude", "copilot"],
				},
			);
			expect(subagentReport.passed).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".claude", "agents", "skill-auditor.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".github", "agents", "skill-auditor.agent.md"),
				),
			).toBe(true);

			// Verify CLI route and add commands
			expect(
				runCli([
					"node",
					"cli.js",
					"route",
					"--repo",
					REPO_ROOT,
					"--catalog",
					CATALOG_ROOT,
					"--format",
					"json",
				]),
			).toBe(ExitCode.SUCCESS);

			expect(
				runCli([
					"node",
					"cli.js",
					"add",
					"ast-blast-radius",
					"--repo",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
					"--targets",
					"claude",
				]),
			).toBe(ExitCode.SUCCESS);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});

	it("supports surgical 'removeSkillOrSubagent' and 'cleanSyncedArtifacts' lifecycle commands with drift protection (Issue #103)", () => {
		const tmpRepo = fs.mkdtempSync(
			path.join(os.tmpdir(), "skillops-remove-clean-"),
		);
		try {
			syncRepository(tmpRepo, CATALOG_ROOT, {
				targets: ["claude", "cursor", "codex"],
			});

			const claudeMcpSkill = path.join(
				tmpRepo,
				".claude",
				"skills",
				"mcp-architect",
				"SKILL.md",
			);
			expect(fs.existsSync(claudeMcpSkill)).toBe(true);

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

			expect(fs.existsSync(claudeMcpSkill)).toBe(false);
			expect(
				fs.existsSync(
					path.join(tmpRepo, ".cursor", "rules", "skillops-mcp-architect.mdc"),
				),
			).toBe(false);

			// Simulate local drift on a remaining file before clean
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

			// Force clean removes all remaining managed files and .skillops-lock.json
			expect(
				runCli([
					"node",
					"cli.js",
					"clean",
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

	it("transpiles Skills and Subagents natively across all Top 28 AI coding agents (--targets all & --targets auto) (Issue #112)", () => {
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

			// Verify all 28 AI coding agent skill artifacts on disk
			const expectedSkillPaths = [
				".claude/skills/mcp-architect/SKILL.md",
				".agent/skills/mcp-architect/SKILL.md",
				".cursor/rules/skillops-mcp-architect.mdc",
				".codex/skills/mcp-architect/SKILL.md",
				".github/instructions/skillops-mcp-architect.instructions.md",
				".github/prompts/skillops-mcp-architect.prompt.md",
				".windsurf/rules/skillops-mcp-architect.md",
				".clinerules/skillops-mcp-architect.md",
				".roo/rules/skillops-mcp-architect.md",
				".kilocode/rules/skillops-mcp-architect.md",
				".zed/rules/skillops-mcp-architect.md",
				".continue/rules/skillops-mcp-architect.md",
				".aider/conventions/skillops-mcp-architect.md",
				".openhands/microagents/skillops-mcp-architect.md",
				".amp/skills/mcp-architect/SKILL.md",
				".goose/skills/mcp-architect/SKILL.md",
				".opencode/skills/mcp-architect/SKILL.md",
				".kiro/steering/skillops-mcp-architect.md",
				".trae/rules/skillops-mcp-architect.md",
				".amazonq/rules/skillops-mcp-architect.md",
				".junie/skills/skillops-mcp-architect.md",
				".gemini/skills/mcp-architect/SKILL.md",
				".factory/skills/mcp-architect/SKILL.md",
				".qwen/skills/mcp-architect/SKILL.md",
				".augment/rules/skillops-mcp-architect.md",
				".vibe/skills/mcp-architect/SKILL.md",
				".warp/skills/mcp-architect/SKILL.md",
				".crush/skills/mcp-architect/SKILL.md",
				".idx/rules/skillops-mcp-architect.md",
			];
			for (const rel of expectedSkillPaths) {
				expect(
					fs.existsSync(path.join(tmpRepo, rel)),
					`Missing skill artifact: ${rel}`,
				).toBe(true);
			}

			// Verify all 28 AI coding agent subagent artifacts on disk
			const expectedSubagentPaths = [
				".claude/agents/context-scout.md",
				".agent/agents/context-scout.md",
				".cursor/rules/skillops-agent-context-scout.mdc",
				".codex/agents/context-scout.md",
				".github/agents/context-scout.agent.md",
				".windsurf/workflows/skillops-agent-context-scout.md",
				".clinerules/workflows/skillops-agent-context-scout.md",
				".roo/rules-architect/skillops-agent-context-scout.md",
				".kilocode/workflows/skillops-agent-context-scout.md",
				".zed/rules/skillops-agent-context-scout.md",
				".continue/prompts/skillops-agent-context-scout.prompt",
				".aider/conventions/skillops-agent-context-scout.md",
				".openhands/microagents/skillops-agent-context-scout.md",
				".amp/agents/context-scout.md",
				".goose/agents/context-scout.md",
				".opencode/agent/context-scout.md",
				".kiro/agents/skillops-agent-context-scout.md",
				".trae/agents/skillops-agent-context-scout.md",
				".amazonq/cli-agents/skillops-agent-context-scout.json",
				".junie/agents/skillops-agent-context-scout.md",
				".gemini/agents/context-scout.md",
				".factory/droids/skillops-agent-context-scout.md",
				".qwen/agents/context-scout.md",
				".augment/agents/skillops-agent-context-scout.md",
				".vibe/agents/skillops-agent-context-scout.toml",
				".warp/agents/context-scout.md",
				".crush/agents/context-scout.md",
				".idx/agents/skillops-agent-context-scout.md",
			];
			for (const rel of expectedSubagentPaths) {
				expect(
					fs.existsSync(path.join(tmpRepo, rel)),
					`Missing subagent artifact: ${rel}`,
				).toBe(true);
			}

			// Verify lockfile recorded all 28 targets
			const lockRaw = JSON.parse(
				fs.readFileSync(path.join(tmpRepo, ".skillops-lock.json"), "utf-8"),
			) as { targets: string[]; artifacts: Record<string, unknown> };
			expect(lockRaw.targets).toHaveLength(ALL_RUNTIME_TARGETS.length);
			expect(Object.keys(lockRaw.artifacts).length).toBeGreaterThanOrEqual(56);

			// Clean all 28 runtimes cleanly
			expect(
				runCli([
					"node",
					"cli.js",
					"clean",
					"--repo",
					tmpRepo,
					"--catalog",
					CATALOG_ROOT,
				]),
			).toBe(ExitCode.SUCCESS);
			expect(fs.existsSync(path.join(tmpRepo, ".skillops-lock.json"))).toBe(
				false,
			);
		} finally {
			fs.rmSync(tmpRepo, { recursive: true, force: true });
		}
	});
});
