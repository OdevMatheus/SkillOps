import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSkillDirectory, parseSubagentFile } from "../src/auditor/index.js";
import {
	parseCatalogSkills,
	parseCatalogSubagents,
	runCli,
} from "../src/cli.js";
import { ALL_RUNTIME_TARGETS, ExitCode } from "../src/models.js";
import {
	addSkillOrSubagent,
	inspectProjectStatus,
	renderSkillFilesForRuntime,
	renderSubagentFilesForRuntime,
	resolveSafeRepoTargetPath,
	updateInstalledSkills,
} from "../src/sync/adapters.js";
import {
	findCommandHelpSpec,
	renderCommandHelp,
	renderGlobalHelp,
	runMultiSelectPrompt,
	stripAnsi,
	visibleLength,
} from "../src/ui/index.js";

const BUILTIN_CATALOG_DIR = path.resolve(process.cwd(), "catalog");

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function writeCustomSkill(
	catalogRoot: string,
	options: {
		name: string;
		track?: string;
		description?: string;
		body?: string;
		scripts?: Record<string, string>;
		references?: Record<string, string>;
		assets?: Record<string, string>;
		includeEvals?: boolean;
	},
): string {
	const track = options.track ?? "ai-engineering";
	const skillDir = path.join(catalogRoot, track, options.name);
	fs.mkdirSync(skillDir, { recursive: true });

	const scriptFiles =
		options.scripts && Object.keys(options.scripts).length > 0
			? options.scripts
			: { "check.py": "print('ok')\n" };
	const scriptEntries = Object.keys(scriptFiles).map((rel) => ({
		path: `scripts/${rel}`,
		description: `Deterministic validation script for ${rel}`,
	}));

	const scriptsYaml = [
		"  scripts:",
		...scriptEntries.flatMap((s) => [
			`    - path: ${s.path}`,
			`      description: "${s.description}"`,
		]),
	].join("\n");

	const description =
		options.description ??
		"Use when validating multi-runtime transpilation, CLI flag aliases, static security gates, companion file path rewriting, or lockfile synchronization across AI coding assistants and local project workspaces. Enforces deterministic offline verification, strict repository boundary containment, and SHA-256 drift detection without mutating unrelated developer configurations or external runtime folders.";
	const body =
		options.body ??
		[
			`# ${options.name}`,
			"",
			"Run `python3 scripts/check.py --json` and consult `references/guide.md`.",
		].join("\n");

	const skillMd = [
		"---",
		`name: ${options.name}`,
		`version: "1.0.0"`,
		`track: ${track}`,
		`description: "${description}"`,
		"tags:",
		"  - testing",
		"  - transpiler",
		"routing_signals:",
		"  files_any:",
		'    - "src/**/*.ts"',
		"entrypoints:",
		scriptsYaml,
		"---",
		"",
		body,
		"",
	].join("\n");

	fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");

	for (const [rel, content] of Object.entries(scriptFiles)) {
		const full = path.join(skillDir, "scripts", rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content, "utf-8");
	}

	for (const [rel, content] of Object.entries(options.references ?? {})) {
		const full = path.join(skillDir, "references", rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content, "utf-8");
	}

	for (const [rel, content] of Object.entries(options.assets ?? {})) {
		const full = path.join(skillDir, "assets", rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content, "utf-8");
	}

	if (options.includeEvals ?? true) {
		const evalsDir = path.join(skillDir, "evals");
		fs.mkdirSync(evalsDir, { recursive: true });
		fs.writeFileSync(
			path.join(evalsDir, "evals.json"),
			JSON.stringify(
				{
					skill_name: options.name,
					evals: [
						{
							id: 1,
							prompt: "Run deterministic check",
							expected_output: "Clean JSON report",
							assertions: ["Outputs valid JSON"],
						},
					],
				},
				null,
				2,
			),
			"utf-8",
		);
	}

	return skillDir;
}

function captureCliRun(argv: readonly string[]): {
	code: number;
	stdout: string;
	stderr: string;
} {
	let stdout = "";
	let stderr = "";
	const outSpy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk: string | Uint8Array) => {
			stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
			return true;
		});
	const errSpy = vi
		.spyOn(process.stderr, "write")
		.mockImplementation((chunk: string | Uint8Array) => {
			stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
			return true;
		});
	try {
		const code = runCli(argv);
		return { code, stdout, stderr };
	} finally {
		outSpy.mockRestore();
		errSpy.mockRestore();
	}
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir && fs.existsSync(dir)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe("Track 2 — CLI Audit, Help Invariants, Security & 28-IDE Transpiler Sync", () => {
	it("supports --agents and --agent aliases across add, status, update, and remove without misparsing target names as slugs", () => {
		const tmpRepo = makeTempDir("skillops-agents-flag-");

		const addRes = captureCliRun([
			"node",
			"skillops",
			"add",
			"mcp-architect",
			"--agents",
			"cursor",
			"-p",
			tmpRepo,
			"--json",
		]);
		expect(addRes.code).toBe(ExitCode.SUCCESS);
		expect(addRes.stderr).toBe("");
		const parsedAdd = JSON.parse(addRes.stdout) as {
			targets: string[];
			passed: boolean;
		};
		expect(parsedAdd.passed).toBe(true);
		expect(parsedAdd.targets).toEqual(["cursor"]);
		expect(
			fs.existsSync(
				path.join(tmpRepo, ".cursor", "rules", "skillops-mcp-architect.mdc"),
			),
		).toBe(true);
		expect(
			fs.existsSync(path.join(tmpRepo, ".claude", "skills", "mcp-architect")),
		).toBe(false);

		// Inline --agent=windsurf syntax
		const addInlineRes = captureCliRun([
			"node",
			"skillops",
			"add",
			"mcp-architect",
			"--agent=windsurf",
			"-p",
			tmpRepo,
			"-f",
			"json",
		]);
		expect(addInlineRes.code).toBe(ExitCode.SUCCESS);
		expect(
			fs.existsSync(
				path.join(tmpRepo, ".windsurf", "rules", "skillops-mcp-architect.md"),
			),
		).toBe(true);

		const statusRes = captureCliRun([
			"node",
			"skillops",
			"status",
			"--agents",
			"cursor",
			"-p",
			tmpRepo,
			"--json",
		]);
		expect(statusRes.code).toBe(ExitCode.SUCCESS);
		const parsedStatus = JSON.parse(statusRes.stdout) as { targets: string[] };
		expect(parsedStatus.targets).toEqual(["cursor"]);

		const updateRes = captureCliRun([
			"node",
			"skillops",
			"update",
			"--agents",
			"cursor",
			"-p",
			tmpRepo,
			"--json",
		]);
		expect(updateRes.code).toBe(ExitCode.SUCCESS);

		const removeRes = captureCliRun([
			"node",
			"skillops",
			"remove",
			"mcp-architect",
			"--agents",
			"cursor",
			"-p",
			tmpRepo,
			"--json",
		]);
		expect(removeRes.code).toBe(ExitCode.SUCCESS);
		expect(
			fs.existsSync(
				path.join(tmpRepo, ".cursor", "rules", "skillops-mcp-architect.mdc"),
			),
		).toBe(false);
		expect(
			fs.existsSync(
				path.join(tmpRepo, ".windsurf", "rules", "skillops-mcp-architect.md"),
			),
		).toBe(true);
	});

	it("runs 'skillops audit' and 'skillops doctor' with --strict, --catalog, and JSON/Markdown output", () => {
		const builtinRes = captureCliRun([
			"node",
			"skillops",
			"audit",
			"--catalog",
			BUILTIN_CATALOG_DIR,
			"--json",
		]);
		expect(builtinRes.code).toBe(ExitCode.SUCCESS);
		const builtinJson = JSON.parse(builtinRes.stdout) as {
			passed: boolean;
			skills_count: number;
			subagents_count: number;
			targets_checked: number;
			rendered_artifacts_count: number;
			security_findings: unknown[];
		};
		expect(builtinJson.passed).toBe(true);
		expect(builtinJson.skills_count).toBeGreaterThan(0);
		expect(builtinJson.subagents_count).toBeGreaterThan(0);
		expect(builtinJson.targets_checked).toBe(ALL_RUNTIME_TARGETS.length);
		expect(builtinJson.rendered_artifacts_count).toBeGreaterThan(
			builtinJson.skills_count * ALL_RUNTIME_TARGETS.length,
		);
		expect(builtinJson.security_findings).toEqual([]);

		// Alias 'doctor' with markdown output
		const doctorRes = captureCliRun([
			"node",
			"skillops",
			"doctor",
			"--catalog",
			BUILTIN_CATALOG_DIR,
			"-f",
			"markdown",
		]);
		expect(doctorRes.code).toBe(ExitCode.SUCCESS);
		expect(doctorRes.stdout).toContain("## SkillOps Catalog & Security Audit Report");

		// Custom catalog without evals/evals.json: passes non-strict, fails --strict with ExitCode.BUDGET_OR_CONTRACT_ERROR (3)
		const layoutCatalog = makeTempDir("skillops-audit-layout-");
		writeCustomSkill(layoutCatalog, {
			name: "no-evals-skill",
			includeEvals: false,
			scripts: { "check.py": "print('ok')\n" },
		});
		expect(parseCatalogSkills(layoutCatalog, { requireLayout: false })).toHaveLength(1);
		expect(parseCatalogSubagents(layoutCatalog)).toHaveLength(0);

		const nonStrictRes = captureCliRun([
			"node",
			"skillops",
			"audit",
			"--catalog",
			layoutCatalog,
			"--json",
		]);
		expect(nonStrictRes.code).toBe(ExitCode.SUCCESS);

		const strictRes = captureCliRun([
			"node",
			"skillops",
			"audit",
			"--strict",
			"--catalog",
			layoutCatalog,
			"--json",
		]);
		expect(strictRes.code).toBe(ExitCode.BUDGET_OR_CONTRACT_ERROR);
		const strictJson = JSON.parse(strictRes.stdout) as {
			passed: boolean;
			contract_errors: string[];
		};
		expect(strictJson.passed).toBe(false);
		expect(strictJson.contract_errors.join("\n")).toContain("evals/evals.json");

		// Malicious custom catalog fails with ExitCode.ERROR (1)
		const badCatalog = makeTempDir("skillops-audit-malicious-");
		writeCustomSkill(badCatalog, {
			name: "evil-net-skill",
			scripts: {
				"check.py": "import urllib.request\nresult = eval('1 + 1')\n",
			},
		});
		const badRes = captureCliRun([
			"node",
			"skillops",
			"audit",
			"--catalog",
			badCatalog,
			"-f",
			"json",
		]);
		expect(badRes.code).toBe(ExitCode.ERROR);
		const badJson = JSON.parse(badRes.stdout) as {
			passed: boolean;
			security_findings: Array<{ rule: string }>;
		};
		expect(badJson.passed).toBe(false);
		expect(badJson.security_findings.length).toBeGreaterThan(0);

		// Typo suggestion includes 'audit'
		const typoRes = captureCliRun(["node", "skillops", "audti"]);
		expect(typoRes.code).toBe(ExitCode.ERROR);
		expect(typoRes.stderr).toContain("Did you mean 'audit'?");
	});

	it("preserves compact <= 20-line and <= 78-col help invariants while documenting audit and --agents", () => {
		const helpOut = renderGlobalHelp("1.5.2", false);
		const lines = helpOut.split("\n");
		expect(lines.length).toBeLessThanOrEqual(20);
		for (const line of lines) {
			expect(visibleLength(line)).toBeLessThanOrEqual(78);
		}
		expect(helpOut).toContain("add [name...]");
		expect(helpOut).toContain("remove [name...]");
		expect(helpOut).toContain("audit");
		expect(helpOut).toContain("--agents");
		expect(helpOut).not.toContain("quickstart");
		expect(helpOut).not.toContain("tokens");
		expect(helpOut).not.toMatch(/🚀|📚|🛠️|⚙️|🌐|💡|⚡|📦|🔍/);

		const auditSpec = findCommandHelpSpec("audit");
		const doctorSpec = findCommandHelpSpec("doctor");
		expect(auditSpec).toBeDefined();
		expect(doctorSpec?.name).toBe("audit");
		const auditHelp = stripAnsi(renderCommandHelp(auditSpec!, "1.5.2", false));
		expect(auditHelp).toContain("--strict");
		expect(auditHelp).toContain("--catalog");
	});

	it("enforces ancestor symlink/junction containment, control-char rejection, and NTFS stream colon blocking in resolveSafeRepoTargetPath", () => {
		const tmpRepo = makeTempDir("skillops-safe-path-");
		const outsideDir = makeTempDir("skillops-outside-");

		expect(() =>
			resolveSafeRepoTargetPath(tmpRepo, ".cursor/rules/bad\0file.mdc"),
		).toThrow(/escapes target repository boundary/i);
		expect(() =>
			resolveSafeRepoTargetPath(tmpRepo, ".cursor/rules/bad\x07file.mdc"),
		).toThrow(/escapes target repository boundary/i);
		expect(() =>
			resolveSafeRepoTargetPath(
				tmpRepo,
				".cursor/rules/skill.mdc:Zone.Identifier",
			),
		).toThrow(/escapes target repository boundary/i);
		expect(() =>
			resolveSafeRepoTargetPath(tmpRepo, "../../outside.md"),
		).toThrow(/escapes target repository boundary/i);

		// Ancestor directory junction / symlink escaping outside repo
		fs.mkdirSync(path.join(tmpRepo, ".cursor"), { recursive: true });
		const linkType = process.platform === "win32" ? "junction" : "dir";
		fs.symlinkSync(outsideDir, path.join(tmpRepo, ".cursor", "rules"), linkType);

		expect(() =>
			resolveSafeRepoTargetPath(
				tmpRepo,
				".cursor/rules/skillops-mcp-architect.mdc",
			),
		).toThrow(/symbolic link|escapes target repository boundary/i);

		const validPath = resolveSafeRepoTargetPath(
			tmpRepo,
			".claude/skills/mcp-architect/SKILL.md",
		);
		expect(validPath).toBe(
			path.join(tmpRepo, ".claude", "skills", "mcp-architect", "SKILL.md"),
		);
	});

	it("rejects prototype-pollution keys (__proto__, constructor, prototype) in .skillops-lock.json", () => {
		const tmpRepo = makeTempDir("skillops-null-proto-");
		const poisonedJson = [
			"{",
			'  "schema_version": "1.0",',
			'  "skillops_version": "1.5.2",',
			'  "targets": ["cursor"],',
			'  "selected_skills": [],',
			'  "selected_subagents": [],',
			'  "total_l1_tokens": 0,',
			'  "artifacts": {',
			'    "__proto__": {',
			'      "target": "cursor",',
			'      "skill_name": "evil",',
			'      "relative_path": "__proto__",',
			'      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
			"    }",
			"  }",
			"}",
		].join("\n");
		fs.writeFileSync(
			path.join(tmpRepo, ".skillops-lock.json"),
			poisonedJson,
			"utf-8",
		);

		expect(() => inspectProjectStatus(tmpRepo, BUILTIN_CATALOG_DIR)).toThrow(
			/Forbidden prototype key/i,
		);
		expect(() =>
			addSkillOrSubagent(tmpRepo, BUILTIN_CATALOG_DIR, "mcp-architect", {
				targets: ["cursor"],
			}),
		).toThrow(/Forbidden prototype key/i);
	});

	it("runs auditSkillSecurity on custom catalogs during addSkillOrSubagent and updateInstalledSkills", () => {
		const tmpRepo = makeTempDir("skillops-custom-sec-repo-");
		const customCatalog = makeTempDir("skillops-custom-sec-cat-");

		const skillDir = writeCustomSkill(customCatalog, {
			name: "custom-safe-helper",
			scripts: {
				"check.py": "import json\nprint(json.dumps({'ok': True}))\n",
			},
		});

		const initialReport = addSkillOrSubagent(
			tmpRepo,
			customCatalog,
			"custom-safe-helper",
			{ targets: ["claude"] },
		);
		expect(initialReport.passed).toBe(true);

		// Inject forbidden network + dynamic eval into custom catalog script
		fs.writeFileSync(
			path.join(skillDir, "scripts", "check.py"),
			"import urllib.request\nurllib.request.urlopen('https://example.com')\n",
			"utf-8",
		);

		const tmpRepo2 = makeTempDir("skillops-custom-sec-repo2-");
		expect(() =>
			addSkillOrSubagent(tmpRepo2, customCatalog, "custom-safe-helper", {
				targets: ["claude"],
			}),
		).toThrow(/Security violation in custom catalog skill/i);

		expect(() =>
			updateInstalledSkills(tmpRepo, customCatalog, { targets: ["claude"] }),
		).toThrow(/Security violation in custom catalog skill/i);
	});

	it("automatically synchronizes Codex AGENTS.md index on add and update when AGENTS.md is present", () => {
		const tmpRepo = makeTempDir("skillops-codex-agents-repo-");
		const customCatalog = makeTempDir("skillops-codex-agents-cat-");

		writeCustomSkill(customCatalog, {
			name: "codex-demo-skill",
			description:
				"Use when synchronizing initial Codex workspace instructions, verifying AGENTS.md marker blocks, and auditing multi-runtime skill discovery across local project directories and target harnesses. Ensures custom developer prose outside managed markers remains untouched while keeping deterministic paths, companion scripts, and SHA-256 lockfile entries accurate across CLI install workflows.",
			scripts: { "check.py": "print('ok')\n" },
		});

		// Without AGENTS.md, codex install does NOT create AGENTS.md
		const emptyRepo = makeTempDir("skillops-codex-no-agents-");
		addSkillOrSubagent(emptyRepo, customCatalog, "codex-demo-skill", {
			targets: ["codex"],
		});
		expect(fs.existsSync(path.join(emptyRepo, "AGENTS.md"))).toBe(false);

		// With existing AGENTS.md, user prose outside markers is preserved and index block is wired
		const userHeader = "# Project Agent Guide\n\nAlways run unit tests before committing.\n";
		fs.writeFileSync(path.join(tmpRepo, "AGENTS.md"), userHeader, "utf-8");

		const addReport = addSkillOrSubagent(
			tmpRepo,
			customCatalog,
			"codex-demo-skill",
			{ targets: ["codex"] },
		);
		expect(addReport.passed).toBe(true);
		expect(
			addReport.artifacts.some(
				(a) =>
					a.skill_name === "codex-agents-index" &&
					a.relative_path === "AGENTS.md",
			),
		).toBe(true);

		const agentsMdAfterAdd = fs.readFileSync(
			path.join(tmpRepo, "AGENTS.md"),
			"utf-8",
		);
		expect(agentsMdAfterAdd).toContain("Always run unit tests before committing.");
		expect(agentsMdAfterAdd).toContain(
			"`.codex/skills/codex-demo-skill/SKILL.md`",
		);

		// Also install built-in subagent into codex and verify .codex/agents/<name>.md path
		addSkillOrSubagent(tmpRepo, BUILTIN_CATALOG_DIR, "context-scout", {
			targets: ["codex"],
		});
		const agentsMdWithSubagent = fs.readFileSync(
			path.join(tmpRepo, "AGENTS.md"),
			"utf-8",
		);
		expect(agentsMdWithSubagent).toContain(
			"`.codex/agents/context-scout.md`",
		);

		// Update skill description in customCatalog and verify updateInstalledSkills refreshes AGENTS.md
		writeCustomSkill(customCatalog, {
			name: "codex-demo-skill",
			description:
				"Use when refreshing updated Codex workspace instructions after catalog revisions, validating AGENTS.md marker block updates, and checking multi-runtime synchronization across local project repositories and harnesses. Preserves custom developer documentation outside managed markers while updating deterministic skill references, subagent links, and lockfile hashes cleanly during CLI update workflows.",
			scripts: { "check.py": "print('ok')\n" },
		});
		const updReport = updateInstalledSkills(tmpRepo, customCatalog, {
			targets: ["codex"],
			names: ["codex-demo-skill"],
		});
		expect(updReport.passed).toBe(true);
		const agentsMdAfterUpdate = fs.readFileSync(
			path.join(tmpRepo, "AGENTS.md"),
			"utf-8",
		);
		expect(agentsMdAfterUpdate).toContain(
			"refreshing updated Codex workspace instructions after catalog revisions",
		);
	});

	it("rewrites both catalog/<track>/<name>/... and bare companion paths without corrupting SKILL.md YAML frontmatter", () => {
		const customCatalog = makeTempDir("skillops-rewrite-cat-");
		const skillDir = writeCustomSkill(customCatalog, {
			name: "path-rewrite-demo",
			track: "ai-engineering",
			body: [
				"# Path Rewrite Demo",
				"",
				"- Bare backtick: `python3 scripts/check.py --json`",
				"- Bare link: [Guide](references/guide.md)",
				"- Bare asset: \"assets/schema.json\"",
				"- Bare evals: evals/evals.json",
				"- Legacy catalog path: `python3 catalog/ai-engineering/path-rewrite-demo/scripts/check.py`",
			].join("\n"),
			scripts: { "check.py": "print('ok')\n" },
			references: { "guide.md": "# Guide\n" },
			assets: { "schema.json": "{}\n" },
		});

		const parsed = parseSkillDirectory(skillDir, { requireLayout: true });

		const cursorFiles = renderSkillFilesForRuntime(parsed, "cursor");
		const cursorMdc = cursorFiles.find((f) => f.relativePath.endsWith(".mdc"))!;
		expect(cursorMdc.content).toContain(
			"`python3 .cursor/rules/path-rewrite-demo/scripts/check.py --json`",
		);
		expect(cursorMdc.content).toContain(
			"(.cursor/rules/path-rewrite-demo/references/guide.md)",
		);
		expect(cursorMdc.content).toContain(
			"\".cursor/rules/path-rewrite-demo/assets/schema.json\"",
		);
		expect(cursorMdc.content).toContain(
			".cursor/rules/path-rewrite-demo/evals/evals.json",
		);
		expect(cursorMdc.content).not.toContain(
			".cursor/rules/path-rewrite-demo/.cursor/rules/path-rewrite-demo/",
		);

		const claudeFiles = renderSkillFilesForRuntime(parsed, "claude");
		const claudeSkillMd = claudeFiles.find((f) =>
			f.relativePath.endsWith("/SKILL.md"),
		)!;
		// Frontmatter entrypoints.scripts[0].path stays relative to skill dir
		expect(claudeSkillMd.content).toContain("- path: scripts/check.py");
		// Markdown body rewrites bare companion paths to workspace-rooted .claude/skills/...
		expect(claudeSkillMd.content).toContain(
			"`python3 .claude/skills/path-rewrite-demo/scripts/check.py --json`",
		);
	});

	it("prunes stale companion files removed from the catalog during updateInstalledSkills while respecting local drift", () => {
		const tmpRepo = makeTempDir("skillops-prune-repo-");
		const customCatalog = makeTempDir("skillops-prune-cat-");

		const skillDir = writeCustomSkill(customCatalog, {
			name: "prune-demo-skill",
			scripts: {
				"keep.py": "print('keep v1')\n",
				"obsolete_clean.py": "print('remove me')\n",
				"obsolete_edited.py": "print('user will edit me')\n",
			},
		});

		addSkillOrSubagent(tmpRepo, customCatalog, "prune-demo-skill", {
			targets: ["claude", "cursor"],
		});

		const claudeCleanScript = path.join(
			tmpRepo,
			".claude",
			"skills",
			"prune-demo-skill",
			"scripts",
			"obsolete_clean.py",
		);
		const cursorEditedScript = path.join(
			tmpRepo,
			".cursor",
			"rules",
			"prune-demo-skill",
			"scripts",
			"obsolete_edited.py",
		);
		expect(fs.existsSync(claudeCleanScript)).toBe(true);
		expect(fs.existsSync(cursorEditedScript)).toBe(true);

		// Locally modify cursor's obsolete_edited.py to trigger drift protection
		fs.writeFileSync(cursorEditedScript, "print('custom local edit')\n", "utf-8");

		// Remove both obsolete scripts from the catalog skill
		fs.rmSync(path.join(skillDir, "scripts", "obsolete_clean.py"));
		fs.rmSync(path.join(skillDir, "scripts", "obsolete_edited.py"));
		writeCustomSkill(customCatalog, {
			name: "prune-demo-skill",
			scripts: {
				"keep.py": "print('keep v2')\n",
			},
		});

		// Update claude cleanly: both unmodified obsolete scripts are pruned
		const claudeUpd = updateInstalledSkills(tmpRepo, customCatalog, {
			targets: ["claude"],
		});
		expect(claudeUpd.passed).toBe(true);
		expect(fs.existsSync(claudeCleanScript)).toBe(false);
		expect(
			claudeUpd.artifacts.some(
				(a) =>
					a.relative_path.endsWith("obsolete_clean.py") &&
					a.action === "removed",
			),
		).toBe(true);

		// Update cursor without --force: obsolete_clean.py is removed, obsolete_edited.py reports conflict
		const cursorUpd = updateInstalledSkills(tmpRepo, customCatalog, {
			targets: ["cursor"],
		});
		expect(cursorUpd.passed).toBe(false);
		expect(cursorUpd.drift_conflicts).toContain(
			".cursor/rules/prune-demo-skill/scripts/obsolete_edited.py",
		);
		expect(fs.existsSync(cursorEditedScript)).toBe(true);

		// Re-run with --force: drifted stale file is pruned cleanly
		const cursorForceUpd = updateInstalledSkills(tmpRepo, customCatalog, {
			targets: ["cursor"],
			force: true,
		});
		expect(cursorForceUpd.passed).toBe(true);
		expect(fs.existsSync(cursorEditedScript)).toBe(false);
	});

	it("preserves subagent tool allowlists and read-only sandbox constraints across all 28 runtime targets", () => {
		const scoutPath = path.join(
			BUILTIN_CATALOG_DIR,
			"subagents",
			"context-scout",
			"SUBAGENT.md",
		);
		const scout = parseSubagentFile(scoutPath);

		const constraintTargets = [
			"windsurf",
			"kiro",
			"gemini",
			"cline",
			"roocode",
			"kilocode",
			"zed",
			"continue",
			"aider",
			"openhands",
			"amp",
			"goose",
			"trae",
			"amazonq",
			"junie",
			"factory",
			"qwen",
			"augment",
			"vibe",
			"warp",
			"crush",
			"idx",
			"cursor",
		] as const;

		for (const target of constraintTargets) {
			const planned = renderSubagentFilesForRuntime(scout, target);
			expect(planned.length).toBeGreaterThan(0);
			const combined = planned.map((p) => p.content).join("\n");
			expect(combined).toContain("## Tool & Sandbox Constraints");
			expect(combined).toContain("Allowed tools");
			expect(combined).toContain("Read-only rule");
		}

		// Ensure all 28 targets render non-empty artifacts without throwing
		for (const target of ALL_RUNTIME_TARGETS) {
			const planned = renderSubagentFilesForRuntime(scout, target);
			expect(planned.length).toBeGreaterThan(0);
		}
	});

	it("restores terminal cursor and raw mode and removes signal listeners on external SIGINT and SIGTERM", async () => {
		for (const sig of ["SIGINT", "SIGTERM"] as const) {
			const stdinObj = process.stdin as unknown as Record<string, unknown>;
			const stdoutObj = process.stdout as unknown as Record<string, unknown>;
			const origStdinIsTTY = stdinObj.isTTY;
			const origStdinIsRaw = stdinObj.isRaw;
			const origSetRawMode = stdinObj.setRawMode;
			const origResume = process.stdin.resume;
			const origPause = process.stdin.pause;
			const origSetEncoding = process.stdin.setEncoding;
			const origStdoutIsTTY = stdoutObj.isTTY;

			const rawModeCalls: boolean[] = [];
			let capturedOut = "";

			stdinObj.isTTY = true;
			stdinObj.isRaw = false;
			stdinObj.setRawMode = (mode: boolean) => {
				stdinObj.isRaw = mode;
				rawModeCalls.push(mode);
				return process.stdin;
			};
			process.stdin.resume = () => process.stdin;
			process.stdin.pause = () => process.stdin;
			process.stdin.setEncoding = () => process.stdin;
			stdoutObj.isTTY = true;

			const writeSpy = vi
				.spyOn(process.stdout, "write")
				.mockImplementation((chunk: string | Uint8Array) => {
					capturedOut +=
						typeof chunk === "string"
							? chunk
							: Buffer.from(chunk).toString("utf-8");
					return true;
				});

			try {
				const sigintBefore = process.listenerCount("SIGINT");
				const sigtermBefore = process.listenerCount("SIGTERM");

				const promptPromise = runMultiSelectPrompt("Select Skills", [
					{ value: "mcp-architect", label: "mcp-architect", kind: "skill" },
					{ value: "context-scout", label: "context-scout", kind: "agent" },
				]);

				expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
				expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);

				process.emit(sig);
				const result = await promptPromise;

				expect(result).toBeNull();
				expect(rawModeCalls).toEqual([true, false]);
				expect(capturedOut).toContain("\x1b[?25h");
				expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
				expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
			} finally {
				writeSpy.mockRestore();
				stdinObj.isTTY = origStdinIsTTY;
				stdinObj.isRaw = origStdinIsRaw;
				stdinObj.setRawMode = origSetRawMode;
				process.stdin.resume = origResume;
				process.stdin.pause = origPause;
				process.stdin.setEncoding = origSetEncoding;
				stdoutObj.isTTY = origStdoutIsTTY;
			}
		}
	});
});
