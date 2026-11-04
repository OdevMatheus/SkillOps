import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditCatalog } from "../src/auditor/index.js";
import { buildInteractiveCatalogOptions, runCli } from "../src/cli.js";
import {
	formatCatalogItemInfo,
	formatCatalogSearchReport,
	formatQuickstartReport,
	formatScaffoldReport,
	inspectCatalogItem,
	runQuickstart,
	scaffoldFrameworkItem,
	searchCatalog,
} from "../src/framework/index.js";
import { ExitCode } from "../src/models.js";
import { suggestCommand, visibleLength } from "../src/ui/index.js";

const CATALOG_DIR = path.resolve(process.cwd(), "catalog");
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	vi.restoreAllMocks();
	for (const d of tempDirs.splice(0, tempDirs.length)) {
		fs.rmSync(d, { recursive: true, force: true });
	}
});

describe("SkillOps Library Explorer (info & search)", () => {
	it("inspects a Hybrid Executable Skill and a Context-Isolated Subagent", () => {
		const skillInfo = inspectCatalogItem(CATALOG_DIR, "bug-reproducer-tdd");
		expect(skillInfo.kind).toBe("skill");
		expect(skillInfo.name).toBe("bug-reproducer-tdd");
		expect(skillInfo.l1Tokens).toBeGreaterThan(0);
		expect(skillInfo.l1Tokens).toBeLessThanOrEqual(160);
		expect(skillInfo.scripts.length).toBeGreaterThan(0);

		const tableOut = formatCatalogItemInfo(skillInfo, "table", false);
		expect(tableOut).toContain(
			"SkillOps Library Inspector — bug-reproducer-tdd",
		);
		expect(tableOut).toContain("HYBRID EXECUTABLE SKILL");
		expect(tableOut).toContain("npx skillops-cli add bug-reproducer-tdd");
		expect(tableOut).not.toMatch(/(?:🚀|📚|🛠️|⚙️|🌐|💡|⚡|📦|🔍)/u);
		for (const line of tableOut.split("\n")) {
			expect(visibleLength(line)).toBeLessThanOrEqual(78);
		}

		const mdOut = formatCatalogItemInfo(skillInfo, "markdown", false);
		expect(mdOut).toContain("## Skill: `bug-reproducer-tdd`");

		const subInfo = inspectCatalogItem(CATALOG_DIR, "red-team-breaker");
		expect(subInfo.kind).toBe("subagent");
		expect(subInfo.name).toBe("red-team-breaker");
		expect(subInfo.maxOutputTokens).toBeLessThanOrEqual(400);
		expect(subInfo.tools.length).toBeGreaterThan(0);

		const subTable = formatCatalogItemInfo(subInfo, "table", false);
		expect(subTable).toContain("CONTEXT-ISOLATED SUBAGENT");
		expect(subTable).toContain("@red-team-breaker");
	});

	it("throws a clear error when inspecting an unknown item", () => {
		expect(() => inspectCatalogItem(CATALOG_DIR, "non-existent-item")).toThrow(
			/not found in catalog/i,
		);
	});

	it("searches the Library by keyword across Skills and Subagents", () => {
		const secSearch = searchCatalog(CATALOG_DIR, "security");
		expect(secSearch.total_matches).toBeGreaterThanOrEqual(2);
		const names = secSearch.matches.map((m) => m.name);
		expect(names).toContain("security-sast-gate");
		expect(names).toContain("red-team-breaker");

		const tableOut = formatCatalogSearchReport(secSearch, "table", false);
		expect(tableOut).toContain("SkillOps Library Search");
		expect(tableOut).toContain("security-sast-gate");
		expect(tableOut).not.toMatch(/(?:🚀|📚|🛠️|⚙️|🌐|💡|⚡|📦|🔍)/u);
		for (const line of tableOut.split("\n")) {
			expect(visibleLength(line)).toBeLessThanOrEqual(78);
		}

		const mdOut = formatCatalogSearchReport(secSearch, "markdown", false);
		expect(mdOut).toContain("| SKILL | `security-sast-gate` |");

		const noMatch = searchCatalog(CATALOG_DIR, "zzzznotfound999");
		expect(noMatch.total_matches).toBe(0);
		expect(formatCatalogSearchReport(noMatch, "table", false)).toContain(
			"No matching Skills or Subagents found",
		);
	});
});

describe("SkillOps Framework Scaffolder (create skill & subagent)", () => {
	it("scaffolds a valid Skill and Subagent that pass auditCatalog (INV-SKILL-01..04)", () => {
		const tmpCatalog = makeTempDir("skillops-scaffold-");
		const skillRes = scaffoldFrameworkItem(
			tmpCatalog,
			"skill",
			"graphql-schema-guard",
		);
		expect(skillRes.kind).toBe("skill");
		expect(skillRes.created_files.length).toBe(3);
		for (const f of skillRes.created_files) {
			expect(fs.existsSync(f)).toBe(true);
		}

		const subRes = scaffoldFrameworkItem(
			tmpCatalog,
			"subagent",
			"graphql-federation-inspector",
		);
		expect(subRes.kind).toBe("subagent");
		expect(subRes.created_files.length).toBe(1);
		expect(fs.existsSync(subRes.created_files[0] ?? "")).toBe(true);

		const auditReport = auditCatalog(tmpCatalog, { requireLayout: true });
		expect(auditReport.skills_audited).toBe(1);
		expect(auditReport.subagents_audited).toBe(1);
		expect(auditReport.budget_errors).toEqual([]);
		expect(auditReport.blocking_collisions).toEqual([]);

		expect(formatScaffoldReport(skillRes, "table", false)).toContain(
			"SkillOps Framework Scaffolder",
		);
		expect(formatScaffoldReport(subRes, "markdown", false)).toContain(
			"Created SUBAGENT `graphql-federation-inspector`",
		);
	});

	it("validates kebab-case naming and overwrite protection", () => {
		const tmpCatalog = makeTempDir("skillops-scaffold-err-");
		expect(() =>
			scaffoldFrameworkItem(tmpCatalog, "skill", "Invalid_Name!"),
		).toThrow(/kebab-case/i);

		scaffoldFrameworkItem(tmpCatalog, "skill", "custom-linter");
		expect(() =>
			scaffoldFrameworkItem(tmpCatalog, "skill", "custom-linter"),
		).toThrow(/already exists/i);

		const overwritten = scaffoldFrameworkItem(
			tmpCatalog,
			"skill",
			"custom-linter",
			{
				force: true,
				description: "Updated custom linter skill description for testing.",
			},
		);
		expect(overwritten.name).toBe("custom-linter");
	});
});

describe("SkillOps 1-Command Quickstart & CLI Aliases", () => {
	it("runs 1-step quickstart to configure .skillops.yml, sync artifacts, and setup MCP", () => {
		const tmpRepo = makeTempDir("skillops-quickstart-");
		fs.writeFileSync(
			path.join(tmpRepo, "package.json"),
			JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } }),
			"utf-8",
		);

		const report = runQuickstart(tmpRepo, CATALOG_DIR, {
			targetsArg: "cursor,claude",
			maxSkills: 4,
		});
		expect(report.passed).toBe(true);
		expect(report.active_targets).toEqual(["cursor", "claude"]);
		expect(report.selected_skills.length).toBeLessThanOrEqual(4);
		expect(fs.existsSync(path.join(tmpRepo, ".skillops.yml"))).toBe(true);
		expect(fs.existsSync(path.join(tmpRepo, ".skillops-lock.json"))).toBe(true);
		expect(fs.existsSync(path.join(tmpRepo, ".cursor", "mcp.json"))).toBe(true);

		const rendered = formatQuickstartReport(report, "table", false);
		expect(rendered).toContain("[1/4]");
		expect(rendered).toContain("[4/4]");
		expect(rendered).toContain("Using Your Skills & Subagents");
		expect(rendered).not.toMatch(/(?:🚀|📚|🛠️|⚙️|🌐|💡|⚡|📦|🔍)/u);
		for (const line of rendered.split("\n")) {
			expect(visibleLength(line)).toBeLessThanOrEqual(78);
		}
	});

	it("supports CLI commands info, search, create, quickstart/setup, install, recommend, budget, and uninstall", () => {
		const tmpRepo = makeTempDir("skillops-cli-aliases-");
		const outChunks: string[] = [];
		const errChunks: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			outChunks.push(String(chunk));
			return true;
		});
		vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
			errChunks.push(String(chunk));
			return true;
		});

		// 1. setup (alias for quickstart) with --project, --harness, --top, -f json
		const setupCode = runCli([
			"node",
			"skillops",
			"setup",
			"--project",
			tmpRepo,
			"--harness",
			"cursor",
			"--top",
			"3",
			"-f",
			"json",
		]);
		expect(setupCode).toBe(ExitCode.SUCCESS);
		const setupJson = JSON.parse(outChunks.join("")) as {
			selected_skills: string[];
			active_targets: string[];
		};
		expect(setupJson.active_targets).toEqual(["cursor"]);
		expect(setupJson.selected_skills.length).toBe(3);
		outChunks.length = 0;

		// 2. info / inspect
		const infoCode = runCli([
			"node",
			"skillops",
			"inspect",
			"bug-reproducer-tdd",
			"-f",
			"json",
		]);
		expect(infoCode).toBe(ExitCode.SUCCESS);
		const infoJson = JSON.parse(outChunks.join("")) as { name: string };
		expect(infoJson.name).toBe("bug-reproducer-tdd");
		outChunks.length = 0;

		// 3. search / find
		const findCode = runCli([
			"node",
			"skillops",
			"find",
			"security",
			"-f",
			"json",
		]);
		expect(findCode).toBe(ExitCode.SUCCESS);
		const findJson = JSON.parse(outChunks.join("")) as {
			total_matches: number;
		};
		expect(findJson.total_matches).toBeGreaterThanOrEqual(2);
		outChunks.length = 0;

		// 4. recommend (alias for route) & budget (alias for tokens)
		const recCode = runCli([
			"node",
			"skillops",
			"recommend",
			"-p",
			tmpRepo,
			"--top",
			"2",
			"-f",
			"json",
		]);
		expect(recCode).toBe(ExitCode.SUCCESS);
		const recJson = JSON.parse(outChunks.join("")) as {
			selected_skills: unknown[];
		};
		expect(recJson.selected_skills.length).toBe(2);
		outChunks.length = 0;

		const budgetCode = runCli([
			"node",
			"skillops",
			"budget",
			"-p",
			tmpRepo,
			"-f",
			"json",
		]);
		expect(budgetCode).toBe(ExitCode.SUCCESS);
		const budgetJson = JSON.parse(outChunks.join("")) as {
			passed_budget: boolean;
		};
		expect(budgetJson.passed_budget).toBe(true);
		outChunks.length = 0;

		// 5. install multiple items & uninstall
		const installCode = runCli([
			"node",
			"skillops",
			"install",
			"bug-reproducer-tdd",
			"red-team-breaker",
			"-p",
			tmpRepo,
			"-t",
			"cursor",
		]);
		expect(installCode).toBe(ExitCode.SUCCESS);
		outChunks.length = 0;

		const uninstallCode = runCli([
			"node",
			"skillops",
			"uninstall",
			"red-team-breaker",
			"-p",
			tmpRepo,
		]);
		expect(uninstallCode).toBe(ExitCode.SUCCESS);
		outChunks.length = 0;

		// 6. create skill via CLI
		const tmpCatalog = makeTempDir("skillops-cli-cat-");
		const createCode = runCli([
			"node",
			"skillops",
			"create",
			"skill",
			"redis-cache-guard",
			"--catalog",
			tmpCatalog,
			"-f",
			"json",
		]);
		expect(createCode).toBe(ExitCode.SUCCESS);
		const createdJson = JSON.parse(outChunks.join("")) as { name: string };
		expect(createdJson.name).toBe("redis-cache-guard");
		expect(errChunks).toEqual([]);
	});

	it("renders 3-Pillar Framework/Library global help, per-command --help, and fuzzy typo suggestions (Issue #127)", () => {
		const outChunks: string[] = [];
		const errChunks: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			outChunks.push(String(chunk));
			return true;
		});
		vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
			errChunks.push(String(chunk));
			return true;
		});

		// Global help screen
		expect(runCli(["node", "skillops", "--help"])).toBe(ExitCode.SUCCESS);
		const globalHelp = outChunks.join("");
		expect(globalHelp).toContain("Skills & Agents Library for AI Coding IDEs");
		expect(globalHelp).toContain("add [name...]");
		expect(globalHelp).toContain("list [query]");
		expect(globalHelp).toContain("info <name>");
		expect(globalHelp).toContain("remove <name>");
		expect(globalHelp).toContain("init");
		outChunks.length = 0;

		// Per-command --help via flag and via 'help <cmd>'
		expect(runCli(["node", "skillops", "quickstart", "--help"])).toBe(
			ExitCode.SUCCESS,
		);
		expect(outChunks.join("")).toContain("skillops quickstart");
		expect(outChunks.join("")).toContain("Options & Flags");
		outChunks.length = 0;

		expect(runCli(["node", "skillops", "help", "create"])).toBe(
			ExitCode.SUCCESS,
		);
		expect(outChunks.join("")).toContain("skillops create");
		expect(outChunks.join("")).toContain("graphql-schema-guard");
		outChunks.length = 0;

		// Fuzzy typo suggestions
		expect(suggestCommand("instal")).toBe("install");
		expect(suggestCommand("quikstart")).toBe("quickstart");
		expect(suggestCommand("recomend")).toBe("recommend");

		expect(runCli(["node", "skillops", "instal"])).toBe(ExitCode.ERROR);
		expect(errChunks.join("")).toContain(
			"Unknown command 'instal'. Did you mean 'install'?",
		);
	});

	it("builds interactive catalog options and supports 'list [query]' and 'add --all' (Issue #140)", () => {
		const options = buildInteractiveCatalogOptions(CATALOG_DIR);
		expect(options.length).toBeGreaterThanOrEqual(19);
		expect(options.filter((o) => o.kind === "skill").length).toBe(10);
		expect(options.filter((o) => o.kind === "agent").length).toBe(9);

		const outChunks: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			outChunks.push(String(chunk));
			return true;
		});

		const listFilterCode = runCli([
			"node",
			"skillops",
			"list",
			"security",
			"-f",
			"json",
		]);
		expect(listFilterCode).toBe(ExitCode.SUCCESS);
		const listFilterJson = JSON.parse(outChunks.join("")) as {
			query: string;
			total_matches: number;
		};
		expect(listFilterJson.query).toBe("security");
		expect(listFilterJson.total_matches).toBeGreaterThanOrEqual(2);
		outChunks.length = 0;

		const tmpRepo = makeTempDir("skillops-add-all-");
		const addAllCode = runCli([
			"node",
			"skillops",
			"add",
			"--all",
			"-p",
			tmpRepo,
			"--target",
			"cursor",
			"--dry-run",
			"-f",
			"json",
		]);
		expect(addAllCode).toBe(ExitCode.SUCCESS);
		const addAllJson = JSON.parse(outChunks.join("")) as {
			passed: boolean;
			artifacts: unknown[];
		};
		expect(addAllJson.passed).toBe(true);
		expect(addAllJson.artifacts.length).toBeGreaterThanOrEqual(19);
	});
});
