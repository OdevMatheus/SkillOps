/**
 * SkillOps NPX CLI Entrypoint (`npx skillops@latest <command>`).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import {
	analyzeRepoTokenEconomy,
	auditCatalog,
	auditCatalogTokenBudgets,
	diagnoseRepository,
	discoverSkillDirectories,
	discoverSubagentFiles,
	formatDoctorReport,
	formatHarnessInspectionReport,
	formatTokenEconomyReport,
	inspectHarnesses,
	parseSkillDirectory,
	parseSubagentFile,
} from "./auditor/index.js";
import { evaluateCatalog, formatEvalSummary } from "./eval/index.js";
import {
	formatCatalogItemInfo,
	formatCatalogSearchReport,
	formatQuickstartReport,
	formatScaffoldReport,
	inspectCatalogItem,
	runQuickstart,
	scaffoldFrameworkItem,
	searchCatalog,
} from "./framework/index.js";
import {
	formatMcpSetupReport,
	setupMcpForHarnesses,
	startMcpStdioServer,
} from "./mcp/index.js";
import {
	ALL_RUNTIME_TARGETS,
	CORE_RUNTIME_TARGETS,
	ExitCode,
	RUNTIME_HARNESS_SPECS,
	type RuntimeTarget,
	SKILLOPS_VERSION,
	type SkillOpsConfig,
	SkillOpsConfigSchema,
	SyncLockfileSchema,
	loadSkillOpsConfig,
	resolveRuntimeTargets,
} from "./models.js";
import {
	fingerprintRepository,
	formatRoutedBundle,
	routeRepository,
} from "./router/index.js";
import {
	addSkillOrSubagent,
	cleanSyncedArtifacts,
	formatSyncReport,
	removeSkillOrSubagent,
	syncRepository,
} from "./sync/index.js";
import {
	type MultiSelectOption,
	findCommandHelpSpec,
	renderCommandHelp,
	renderGlobalHelp,
	renderNextSteps,
	renderProgressBar,
	runMultiSelectPrompt,
	suggestCommand,
} from "./ui/index.js";

const PACKAGE_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

function getFlagValue(
	args: readonly string[],
	...flagNames: string[]
): string | undefined {
	for (const flag of flagNames) {
		const idx = args.indexOf(flag);
		const val = idx !== -1 ? args[idx + 1] : undefined;
		if (val && !val.startsWith("-")) {
			return val;
		}
	}
	return undefined;
}

function getPositionalArgs(args: readonly string[]): string[] {
	const valueTakingFlags = new Set([
		"--repo",
		"--project",
		"-p",
		"--targets",
		"--harness",
		"--harnesses",
		"--target",
		"-t",
		"--catalog",
		"--format",
		"-f",
		"--top",
		"--max-skills",
		"--max-l1-tokens",
		"--max-similarity",
		"--budget",
		"--task",
		"--skill",
		"--out",
		"--description",
		"-d",
	]);
	const positionals: string[] = [];
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (!arg) {
			continue;
		}
		if (arg.startsWith("-")) {
			if (valueTakingFlags.has(arg)) {
				i += 1;
			}
			continue;
		}
		positionals.push(arg);
	}
	return positionals;
}

function resolveTargetsArg(args: readonly string[]): string | undefined {
	const explicit = getFlagValue(
		args,
		"--targets",
		"--harness",
		"--harnesses",
		"--target",
		"-t",
	);
	if (explicit) {
		return explicit;
	}
	if (args.includes("--auto")) {
		return "auto";
	}
	return undefined;
}

function resolveCatalogDir(
	args: readonly string[],
	repoPath?: string,
	loadedConfig?: SkillOpsConfig | null,
): string {
	const catalogFlag = getFlagValue(args, "--catalog");
	if (catalogFlag) {
		return path.resolve(catalogFlag);
	}
	const baseRepo = repoPath ? path.resolve(repoPath) : process.cwd();
	if (loadedConfig?.catalog_dir) {
		const cfgCatalog = path.resolve(baseRepo, loadedConfig.catalog_dir);
		if (fs.existsSync(cfgCatalog)) {
			return cfgCatalog;
		}
	}
	if (repoPath) {
		const repoCatalog = path.join(path.resolve(repoPath), "catalog");
		if (fs.existsSync(repoCatalog)) {
			return repoCatalog;
		}
	}
	const cwdCatalog = path.resolve(process.cwd(), "catalog");
	if (fs.existsSync(cwdCatalog)) {
		return cwdCatalog;
	}
	return path.join(PACKAGE_ROOT, "catalog");
}

const POPULAR_AI_ORDER: readonly RuntimeTarget[] = [
	"cursor",
	"claude",
	"copilot",
	"antigravity",
	"windsurf",
	"codex",
	"gemini",
	"cline",
	"roocode",
	"kilocode",
	"zed",
	"continue",
	"aider",
	"kiro",
	"trae",
	"augment",
	"factory",
	"qwen",
	"opencode",
	"openhands",
	"amp",
	"goose",
	"warp",
	"crush",
	"vibe",
	"junie",
	"amazonq",
	"idx",
];

export function buildInteractiveTargetOptions(): MultiSelectOption[] {
	const popularSet = new Set<RuntimeTarget>(POPULAR_AI_ORDER);
	const orderedTargets: RuntimeTarget[] = [
		...POPULAR_AI_ORDER,
		...ALL_RUNTIME_TARGETS.filter((t) => !popularSet.has(t)),
	];

	return orderedTargets.map((targetId) => {
		const spec = RUNTIME_HARNESS_SPECS[targetId];
		return {
			value: spec.id,
			label: spec.id,
			kind: "ide",
			tab: "skill",
			hint: `${spec.displayName} (${spec.skillsDir})`,
		};
	});
}

export function buildInteractiveCatalogOptions(
	catalogDir: string,
): MultiSelectOption[] {
	const options: MultiSelectOption[] = [];
	const seen = new Set<string>();

	for (const skillDir of discoverSkillDirectories(catalogDir)) {
		try {
			const parsed = parseSkillDirectory(skillDir, { requireLayout: false });
			if (!seen.has(parsed.manifest.name)) {
				seen.add(parsed.manifest.name);
				options.push({
					value: parsed.manifest.name,
					label: parsed.manifest.name,
					kind: "skill",
					hint: parsed.manifest.description,
				});
			}
		} catch {
			// Skip invalid entry
		}
	}

	for (const saPath of discoverSubagentFiles(catalogDir)) {
		try {
			const parsed = parseSubagentFile(saPath);
			if (!seen.has(parsed.manifest.name)) {
				seen.add(parsed.manifest.name);
				options.push({
					value: parsed.manifest.name,
					label: parsed.manifest.name,
					kind: "agent",
					hint: parsed.manifest.description,
				});
			}
		} catch {
			// Skip invalid entry
		}
	}

	return options;
}

export function buildInteractiveInstalledOptions(
	repoPath: string,
	catalogDir: string,
	targetFilter?: readonly RuntimeTarget[],
): MultiSelectOption[] {
	const lockfilePath = path.join(path.resolve(repoPath), ".skillops-lock.json");
	if (!fs.existsSync(lockfilePath)) {
		return [];
	}

	let parsedLock: ReturnType<typeof SyncLockfileSchema.safeParse>;
	try {
		const raw = JSON.parse(fs.readFileSync(lockfilePath, "utf-8")) as unknown;
		parsedLock = SyncLockfileSchema.safeParse(raw);
	} catch {
		return [];
	}
	if (!parsedLock.success) {
		return [];
	}

	const lock = parsedLock.data;
	const targetSet =
		targetFilter && targetFilter.length > 0 ? new Set(targetFilter) : null;
	const targetsByItem = new Map<string, Set<RuntimeTarget>>();

	for (const entry of Object.values(lock.artifacts)) {
		if (entry.skill_name === "codex-agents-index") {
			continue;
		}
		if (targetSet && !targetSet.has(entry.target)) {
			continue;
		}
		let itemTargets = targetsByItem.get(entry.skill_name);
		if (!itemTargets) {
			itemTargets = new Set<RuntimeTarget>();
			targetsByItem.set(entry.skill_name, itemTargets);
		}
		itemTargets.add(entry.target);
	}

	if (targetsByItem.size === 0) {
		return [];
	}

	const catalogOptions = buildInteractiveCatalogOptions(catalogDir);
	const catalogMap = new Map(catalogOptions.map((o) => [o.value, o]));
	const subagentSet = new Set(lock.selected_subagents);

	const skills: MultiSelectOption[] = [];
	const agents: MultiSelectOption[] = [];

	for (const [itemName, itemTargets] of targetsByItem.entries()) {
		const catalogOpt = catalogMap.get(itemName);
		const isAgent = catalogOpt
			? catalogOpt.kind === "agent"
			: subagentSet.has(itemName);
		const targetsLabel = [...itemTargets].join(", ");
		const baseHint = catalogOpt?.hint ?? "Installed in project";
		const option: MultiSelectOption = {
			value: itemName,
			label: itemName,
			kind: isAgent ? "agent" : "skill",
			tab: isAgent ? "agent" : "skill",
			hint: `[${targetsLabel}] · ${baseHint}`,
		};
		if (isAgent) {
			agents.push(option);
		} else {
			skills.push(option);
		}
	}

	return [...skills, ...agents];
}

export function runCli(argv: readonly string[]): number {
	const args = argv.slice(2);
	if (
		args.includes("--version") ||
		args.includes("-V") ||
		args[0] === "version"
	) {
		process.stdout.write(`skillops ${SKILLOPS_VERSION}\n`);
		return ExitCode.SUCCESS;
	}

	if (args[0] === "help") {
		const targetCmd = args[1];
		if (targetCmd && !targetCmd.startsWith("-")) {
			const spec = findCommandHelpSpec(targetCmd);
			if (spec) {
				process.stdout.write(`${renderCommandHelp(spec, SKILLOPS_VERSION)}\n`);
				return ExitCode.SUCCESS;
			}
		}
		process.stdout.write(`${renderGlobalHelp(SKILLOPS_VERSION)}\n`);
		return ExitCode.SUCCESS;
	}

	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		process.stdout.write(`${renderGlobalHelp(SKILLOPS_VERSION)}\n`);
		return ExitCode.SUCCESS;
	}

	if (args.includes("--help") || args.includes("-h")) {
		const firstCmd = args[0];
		if (firstCmd) {
			const spec = findCommandHelpSpec(firstCmd);
			if (spec) {
				process.stdout.write(`${renderCommandHelp(spec, SKILLOPS_VERSION)}\n`);
				return ExitCode.SUCCESS;
			}
		}
		process.stdout.write(`${renderGlobalHelp(SKILLOPS_VERSION)}\n`);
		return ExitCode.SUCCESS;
	}

	const command = args[0] ?? "";

	if (command === "quickstart" || command === "setup") {
		const repoPath = path.resolve(
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd(),
		);
		const cfgRes = loadSkillOpsConfig(repoPath);
		if (cfgRes.error) {
			process.stderr.write(
				`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`,
			);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
		const targetsArg = resolveTargetsArg(args);
		const maxSkillsRaw = getFlagValue(args, "--max-skills", "--top");
		const maxSkills = maxSkillsRaw
			? Number.parseInt(maxSkillsRaw, 10)
			: undefined;
		const dryRun = args.includes("--dry-run");
		const force = args.includes("--force");
		const skipMcp = args.includes("--skip-mcp") || args.includes("--no-mcp");
		const rawFormat = getFlagValue(args, "--format", "-f") ?? "table";
		const format: "table" | "json" | "markdown" =
			rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

		try {
			const report = runQuickstart(repoPath, catalogDir, {
				targetsArg,
				maxSkills,
				dryRun,
				force,
				skipMcp,
			});
			process.stdout.write(formatQuickstartReport(report, format));
			return report.passed ? ExitCode.SUCCESS : ExitCode.ERROR;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`Invalid --targets: ${msg}\n`);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
	}

	if (command === "info" || command === "show" || command === "inspect") {
		const positionals = getPositionalArgs(args);
		const itemName = positionals[0];
		if (!itemName) {
			process.stderr.write(
				"Usage: npx skillops-cli info <skill-or-subagent-name> [options]\n",
			);
			return ExitCode.ERROR;
		}
		const repoPath =
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd();
		const cfgRes = loadSkillOpsConfig(repoPath);
		const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
		const rawFormat = getFlagValue(args, "--format", "-f") ?? "table";
		const format: "table" | "json" | "markdown" =
			rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

		try {
			const info = inspectCatalogItem(catalogDir, itemName);
			process.stdout.write(formatCatalogItemInfo(info, format));
			return ExitCode.SUCCESS;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`Error: ${msg}\n`);
			return ExitCode.ERROR;
		}
	}

	if (command === "search" || command === "find") {
		const positionals = getPositionalArgs(args);
		const query = positionals.join(" ");
		const repoPath =
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd();
		const cfgRes = loadSkillOpsConfig(repoPath);
		const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
		const rawFormat = getFlagValue(args, "--format", "-f") ?? "table";
		const format: "table" | "json" | "markdown" =
			rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

		const report = searchCatalog(catalogDir, query);
		process.stdout.write(formatCatalogSearchReport(report, format));
		return ExitCode.SUCCESS;
	}

	if (command === "create" || command === "new") {
		const positionals = getPositionalArgs(args);
		let kind: "skill" | "subagent" = "skill";
		let rawName: string | undefined;

		const firstPos = positionals[0]?.toLowerCase();
		if (firstPos === "skill" || firstPos === "skills") {
			kind = "skill";
			rawName = positionals[1];
		} else if (
			firstPos === "subagent" ||
			firstPos === "subagents" ||
			firstPos === "agent" ||
			firstPos === "agents"
		) {
			kind = "subagent";
			rawName = positionals[1];
		} else {
			rawName = positionals[0];
		}

		if (!rawName) {
			process.stderr.write(
				"Usage: npx skillops-cli create <skill|subagent> <kebab-case-name> [--description <text>] [--force]\n",
			);
			return ExitCode.ERROR;
		}

		const repoPath =
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd();
		const cfgRes = loadSkillOpsConfig(repoPath);
		const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
		const description = getFlagValue(args, "--description", "-d");
		const force = args.includes("--force");
		const rawFormat = getFlagValue(args, "--format", "-f") ?? "table";
		const format: "table" | "json" | "markdown" =
			rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

		try {
			const result = scaffoldFrameworkItem(catalogDir, kind, rawName, {
				description,
				force,
			});
			process.stdout.write(formatScaffoldReport(result, format));
			return ExitCode.SUCCESS;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`Error: ${msg}\n`);
			return ExitCode.ERROR;
		}
	}

	if (command === "init") {
		const repoPath = path.resolve(
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd(),
		);
		const catalogDir = resolveCatalogDir(args, repoPath);
		const profile = fingerprintRepository(repoPath);

		const targetsArg = resolveTargetsArg(args);
		let initTargets: RuntimeTarget[];
		try {
			initTargets = targetsArg
				? resolveRuntimeTargets(targetsArg, repoPath)
				: profile.detected_harnesses.length > 0
					? profile.detected_harnesses
					: [...CORE_RUNTIME_TARGETS];
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`Invalid --targets: ${msg}\n`);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}

		const configPayload = SkillOpsConfigSchema.parse({
			version: "1.0",
			catalog_dir:
				path.relative(repoPath, catalogDir).replace(/\\/g, "/") || "catalog",
			token_economy: {
				startup_tax_budget: 2500,
				max_active_skills: 12,
				max_l1_tokens: 1500,
				max_similarity: 0.78,
			},
			detected_stack: {
				languages: profile.languages,
				frameworks: profile.frameworks,
			},
			targets: initTargets,
		});

		const configPath = path.join(repoPath, ".skillops.yml");
		fs.mkdirSync(repoPath, { recursive: true });
		fs.writeFileSync(configPath, YAML.stringify(configPayload), "utf-8");
		process.stdout.write(
			`Initialized SkillOps configuration at ${configPath.replace(/\\/g, "/")}\n`,
		);
		return ExitCode.SUCCESS;
	}

	if (command === "list") {
		const positionals = getPositionalArgs(args);
		const repoPath =
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd();
		const cfgRes = loadSkillOpsConfig(repoPath);
		if (cfgRes.error) {
			process.stderr.write(
				`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`,
			);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
		const rawFormat = getFlagValue(args, "--format", "-f") ?? "table";

		if (positionals.length > 0) {
			const format: "table" | "json" | "markdown" =
				rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";
			const report = searchCatalog(catalogDir, positionals.join(" "));
			process.stdout.write(formatCatalogSearchReport(report, format));
			return ExitCode.SUCCESS;
		}

		const summary = auditCatalogTokenBudgets(catalogDir, {
			requireLayout: false,
		});

		if (rawFormat === "json") {
			process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
			return ExitCode.SUCCESS;
		}

		if (rawFormat === "markdown") {
			const lines = [
				"## SkillOps Catalog — High-End Skills & Context-Isolated Subagents",
				"",
				"### Hybrid Executable Skills (`INV-SKILL-01` .. `03`)",
				"",
				"| Skill | L1 Tokens | L2 Lines | L2 Tokens | Scripts |Savings |",
				"| :--- | ---: | ---: | ---: | ---: | ---: |",
				...summary.skills.map((s) => {
					const totalRaw = s.l1Tokens + s.l2Tokens;
					const savingsPct =
						totalRaw > 0
							? (((totalRaw - s.l1Tokens) / totalRaw) * 100).toFixed(1)
							: "0.0";
					return `| \`${s.skillName}\` | ${s.l1Tokens} | ${s.l2Lines} | ${s.l2Tokens} | ${s.scriptsCount} | ${savingsPct}% |`;
				}),
				"",
				"### Context-Isolated Subagents (`INV-SKILL-04`)",
				"",
				"| Subagent | Prompt Tokens | Max Output Tokens | Tools |",
				"| :--- | ---: | ---: | ---: |",
				...summary.subagents.map(
					(a) =>
						`| \`${a.subagentName}\` | ${a.systemPromptTokens} | <= ${a.maxOutputTokens} | ${a.tools.length} |`,
				),
				"",
			];
			process.stdout.write(lines.join("\n"));
			return ExitCode.SUCCESS;
		}

		const l1Bar = renderProgressBar(summary.totalL1Tokens, 1500, {
			width: 10,
			unit: "tokens",
		});
		const firstSkill = summary.skills[0]?.skillName ?? "security-sast-gate";
		const lines = [
			`=== SkillOps Catalog (v${SKILLOPS_VERSION}) ===`,
			`Skills (${summary.skills.length}) — Total L1 Routing Tax: ${summary.totalL1Tokens} tokens`,
			`L1 Budget Meter: ${l1Bar}`,
			...summary.skills.map(
				(s) =>
					`  [SKILL] ${s.skillName} — L1: ${s.l1Tokens}t | L2: ${s.l2Lines} lines (${s.l2Tokens}t) | L3 Scripts: ${s.scriptsCount}`,
			),
			`Subagents (${summary.subagents.length}) — Context-Isolated Specialist Agents:`,
			...summary.subagents.map(
				(a) =>
					`  [SUBAGENT] ${a.subagentName} (prompt=${a.systemPromptTokens}t, max_out<=${a.maxOutputTokens}t, tools=${a.tools.length})`,
			),
			renderNextSteps([
				{
					command: "npx skillops-cli add",
					description: "Interactive import into your AI IDE",
				},
				{
					command: `npx skillops-cli info ${firstSkill}`,
					description: "Inspect triggers & usage",
				},
				{
					command: "npx skillops-cli search <keyword>",
					description: "Search Skills & Subagents",
				},
			]),
		];
		process.stdout.write(lines.join("\n"));
		return ExitCode.SUCCESS;
	}

	if (command === "audit") {
		const repoPath =
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd();
		const cfgRes = loadSkillOpsConfig(repoPath);
		if (cfgRes.error) {
			process.stderr.write(
				`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`,
			);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
		const strict = args.includes("--strict");
		const requireLayout = args.includes("--require-layout");
		const format = getFlagValue(args, "--format", "-f") ?? "table";

		const report = auditCatalog(catalogDir, { requireLayout });
		if (format === "json") {
			process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		} else if (format === "github") {
			const ghLines: string[] = [];
			for (const err of report.budget_errors) {
				ghLines.push(`::error title=SkillOps Budget/Contract Error::${err}`);
			}
			for (const col of report.blocking_collisions) {
				ghLines.push(
					`::error title=SkillOps Blocking Collision::${col.skill_a} <-> ${col.skill_b} cosine=${col.similarity.toFixed(4)} (shared: ${col.shared_terms.join(", ")})`,
				);
			}
			for (const col of report.high_risk_collisions) {
				ghLines.push(
					`::warning title=SkillOps High-Risk Collision::${col.skill_a} <-> ${col.skill_b} cosine=${col.similarity.toFixed(4)} (shared: ${col.shared_terms.join(", ")})`,
				);
			}
			ghLines.push(
				`::notice title=SkillOps Catalog Audit::Audited ${report.skills_audited} skills and ${report.subagents_audited} subagents (L1=${report.total_l1_tokens}t, max_cosine=${report.max_similarity.toFixed(4)}).`,
			);
			process.stdout.write(`${ghLines.join("\n")}\n`);
		} else {
			process.stdout.write(
				[
					`=== SkillOps Zero-API Catalog & Subagent Auditor (v${SKILLOPS_VERSION}) ===`,
					`Catalog: ${report.catalog_path}`,
					`Skills Audited: ${report.skills_audited} | Subagents Audited: ${report.subagents_audited}`,
					`Total L1 Tokens: ${report.total_l1_tokens} | Max Pairwise Cosine: ${report.max_similarity.toFixed(4)}`,
					`Budget/Contract Errors: ${report.budget_errors.length}`,
					...report.pairs.map(
						(p) =>
							`  [${p.severity}] ${p.skill_a} <-> ${p.skill_b}: cosine=${p.similarity.toFixed(4)} (shared: ${p.shared_terms.join(", ")})`,
					),
					...report.budget_errors.map((e) => `  [ERROR] ${e}`),
					"",
				].join("\n"),
			);
		}

		if (report.budget_errors.length > 0) {
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		if (
			report.blocking_collisions.length > 0 ||
			(strict && report.high_risk_collisions.length > 0)
		) {
			return ExitCode.COLLISION_ERROR;
		}
		return ExitCode.SUCCESS;
	}

	if (command === "tokens" || command === "budget") {
		const repoPath =
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd();
		const cfgRes = loadSkillOpsConfig(repoPath);
		if (cfgRes.error) {
			process.stderr.write(
				`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`,
			);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
		const budgetRaw = getFlagValue(args, "--budget");
		const startupTaxBudget = budgetRaw
			? Number.parseInt(budgetRaw, 10)
			: (cfgRes.config?.token_economy.startup_tax_budget ?? 2500);
		const rawFormat = getFlagValue(args, "--format", "-f") ?? "table";
		const format: "table" | "json" | "markdown" | "github" =
			rawFormat === "json" || rawFormat === "markdown" || rawFormat === "github"
				? rawFormat
				: "table";
		const strict = args.includes("--strict");

		const report = analyzeRepoTokenEconomy(repoPath, {
			catalogDir,
			startupTaxBudget,
		});
		process.stdout.write(formatTokenEconomyReport(report, format));

		if (strict && !report.passed_budget) {
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		return ExitCode.SUCCESS;
	}

	if (command === "route" || command === "recommend") {
		const repoPath =
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd();
		const cfgRes = loadSkillOpsConfig(repoPath);
		if (cfgRes.error) {
			process.stderr.write(
				`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`,
			);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
		const taskPrompt = getFlagValue(args, "--task") ?? "";
		const maxSkillsRaw = getFlagValue(args, "--max-skills", "--top");
		const maxSkills = maxSkillsRaw
			? Number.parseInt(maxSkillsRaw, 10)
			: (cfgRes.config?.token_economy.max_active_skills ?? 12);
		const maxL1Raw = getFlagValue(args, "--max-l1-tokens");
		const maxL1Tokens = maxL1Raw
			? Number.parseInt(maxL1Raw, 10)
			: (cfgRes.config?.token_economy.max_l1_tokens ?? 1500);
		const maxSimRaw = getFlagValue(args, "--max-similarity");
		const maxSimilarity = maxSimRaw
			? Number.parseFloat(maxSimRaw)
			: (cfgRes.config?.token_economy.max_similarity ?? 0.78);
		const rawFormat = getFlagValue(args, "--format", "-f") ?? "table";
		const format: "table" | "json" | "markdown" =
			rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

		const bundle = routeRepository(repoPath, catalogDir, {
			taskPrompt,
			maxSkills,
			maxL1Tokens,
			maxSimilarity,
		});
		process.stdout.write(formatRoutedBundle(bundle, format));
		return bundle.passed_invariants ? ExitCode.SUCCESS : ExitCode.ERROR;
	}

	if (command === "sync") {
		const repoPath =
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd();
		const cfgRes = loadSkillOpsConfig(repoPath);
		if (cfgRes.error) {
			process.stderr.write(
				`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`,
			);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
		const targetsArg = resolveTargetsArg(args);
		let targets: RuntimeTarget[];
		try {
			targets = targetsArg
				? resolveRuntimeTargets(targetsArg, repoPath)
				: (cfgRes.config?.targets ?? [...CORE_RUNTIME_TARGETS]);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`Invalid --targets: ${msg}\n`);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		const maxSkillsRaw = getFlagValue(args, "--max-skills", "--top");
		const maxSkills = maxSkillsRaw
			? Number.parseInt(maxSkillsRaw, 10)
			: cfgRes.config?.token_economy.max_active_skills;
		const dryRun = args.includes("--dry-run");
		const force = args.includes("--force");
		const rawFormat = getFlagValue(args, "--format", "-f") ?? "table";
		const format: "table" | "json" | "markdown" =
			rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

		const report = syncRepository(repoPath, catalogDir, {
			targets,
			dryRun,
			force,
			maxSkills,
			maxL1Tokens: cfgRes.config?.token_economy.max_l1_tokens,
			maxSimilarity: cfgRes.config?.token_economy.max_similarity,
		});
		process.stdout.write(formatSyncReport(report, format));
		return report.passed ? ExitCode.SUCCESS : ExitCode.ERROR;
	}

	if (command === "add" || command === "install" || command === "i") {
		const positionals = getPositionalArgs(args);
		const repoPath =
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd();
		const cfgRes = loadSkillOpsConfig(repoPath);
		if (cfgRes.error) {
			process.stderr.write(
				`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`,
			);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
		const targetsArg = resolveTargetsArg(args);
		let targets: RuntimeTarget[];
		try {
			targets = targetsArg
				? resolveRuntimeTargets(targetsArg, repoPath)
				: (cfgRes.config?.targets ?? [...CORE_RUNTIME_TARGETS]);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`Invalid --targets: ${msg}\n`);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		const dryRun = args.includes("--dry-run");
		const force = args.includes("--force");
		const rawFormat = getFlagValue(args, "--format", "-f") ?? "table";
		const format: "table" | "json" | "markdown" =
			rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

		const importAll = args.includes("--all");
		const itemsToAdd =
			importAll && positionals.length === 0
				? buildInteractiveCatalogOptions(catalogDir).map((o) => o.value)
				: positionals;

		if (itemsToAdd.length === 0) {
			if (command === "add") {
				process.stderr.write(
					"Usage: npx skillops-cli add <skill-or-subagent-name> [more-names...] [options]\n",
				);
				return ExitCode.ERROR;
			}
			const maxSkillsRaw = getFlagValue(args, "--max-skills", "--top");
			const maxSkills = maxSkillsRaw
				? Number.parseInt(maxSkillsRaw, 10)
				: cfgRes.config?.token_economy.max_active_skills;
			const report = syncRepository(repoPath, catalogDir, {
				targets,
				dryRun,
				force,
				maxSkills,
				maxL1Tokens: cfgRes.config?.token_economy.max_l1_tokens,
				maxSimilarity: cfgRes.config?.token_economy.max_similarity,
			});
			process.stdout.write(formatSyncReport(report, format));
			return report.passed ? ExitCode.SUCCESS : ExitCode.ERROR;
		}

		try {
			const reports = itemsToAdd.map((itemName) =>
				addSkillOrSubagent(repoPath, catalogDir, itemName, {
					targets,
					dryRun,
					force,
				}),
			);
			const firstReport = reports[0];
			if (!firstReport) {
				return ExitCode.ERROR;
			}
			const finalReport =
				reports.length === 1
					? firstReport
					: {
							...firstReport,
							artifacts: reports.flatMap((r) => r.artifacts),
							drift_conflicts: [
								...new Set(reports.flatMap((r) => r.drift_conflicts)),
							],
							passed: reports.every((r) => r.passed),
						};
			process.stdout.write(formatSyncReport(finalReport, format));
			return finalReport.passed ? ExitCode.SUCCESS : ExitCode.ERROR;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`Error: ${msg}\n`);
			return ExitCode.ERROR;
		}
	}

	if (command === "remove" || command === "uninstall" || command === "rm") {
		const positionals = getPositionalArgs(args);
		const removeAll = args.includes("--all");
		const repoPath =
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd();
		const cfgRes = loadSkillOpsConfig(repoPath);
		if (cfgRes.error) {
			process.stderr.write(
				`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`,
			);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
		const rawTargetsArg = resolveTargetsArg(args);
		const dryRun = args.includes("--dry-run");
		const force = args.includes("--force");
		const rawFormat = getFlagValue(args, "--format", "-f") ?? "table";
		const format: "table" | "json" | "markdown" =
			rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

		try {
			const targets = rawTargetsArg
				? resolveRuntimeTargets(rawTargetsArg, repoPath)
				: undefined;

			if (removeAll && positionals.length === 0 && !targets) {
				const report = cleanSyncedArtifacts(repoPath, catalogDir, {
					dryRun,
					force,
				});
				process.stdout.write(formatSyncReport(report, format));
				return report.passed ? ExitCode.SUCCESS : ExitCode.ERROR;
			}

			const itemsToRemove =
				removeAll && positionals.length === 0
					? buildInteractiveInstalledOptions(repoPath, catalogDir, targets).map(
							(o) => o.value,
						)
					: positionals;

			if (itemsToRemove.length === 0) {
				process.stderr.write(
					"Usage: npx skillops-cli remove <skill-or-subagent-name> [options]\n",
				);
				return ExitCode.ERROR;
			}

			const reports = itemsToRemove.map((itemName) =>
				removeSkillOrSubagent(repoPath, catalogDir, itemName, {
					targets,
					dryRun,
					force,
				}),
			);
			const firstReport = reports[0];
			if (!firstReport) {
				return ExitCode.ERROR;
			}
			const finalReport =
				reports.length === 1
					? firstReport
					: {
							...firstReport,
							artifacts: reports.flatMap((r) => r.artifacts),
							drift_conflicts: [
								...new Set(reports.flatMap((r) => r.drift_conflicts)),
							],
							passed: reports.every((r) => r.passed),
						};
			process.stdout.write(formatSyncReport(finalReport, format));
			return finalReport.passed ? ExitCode.SUCCESS : ExitCode.ERROR;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`Error: ${msg}\n`);
			return ExitCode.ERROR;
		}
	}

	if (command === "clean") {
		const repoPath =
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd();
		const cfgRes = loadSkillOpsConfig(repoPath);
		if (cfgRes.error) {
			process.stderr.write(
				`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`,
			);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
		const dryRun = args.includes("--dry-run");
		const force = args.includes("--force");
		const rawFormat = getFlagValue(args, "--format", "-f") ?? "table";
		const format: "table" | "json" | "markdown" =
			rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

		const report = cleanSyncedArtifacts(repoPath, catalogDir, {
			dryRun,
			force,
		});
		process.stdout.write(formatSyncReport(report, format));
		return report.passed ? ExitCode.SUCCESS : ExitCode.ERROR;
	}

	if (command === "eval") {
		const catalogDir = resolveCatalogDir(args);
		const skillFilter = getFlagValue(args, "--skill");
		const rawFormat = getFlagValue(args, "--format", "-f") ?? "table";
		const format: "table" | "json" | "markdown" | "html" | "github" =
			rawFormat === "json" ||
			rawFormat === "markdown" ||
			rawFormat === "html" ||
			rawFormat === "github"
				? rawFormat
				: "table";
		const outRaw = getFlagValue(args, "--out");
		const outPath = outRaw ? path.resolve(outRaw) : null;
		const strict = args.includes("--strict");

		const summary = evaluateCatalog(catalogDir, { skillFilter });
		const rendered = formatEvalSummary(summary, format);

		if (outPath) {
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			fs.writeFileSync(outPath, rendered, "utf-8");
		}
		process.stdout.write(rendered);

		if (strict && !summary.passed) {
			return ExitCode.EVAL_REGRESSION_ERROR;
		}
		return ExitCode.SUCCESS;
	}

	if (command === "harnesses") {
		const repoPath = path.resolve(
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd(),
		);
		const rawFormat = getFlagValue(args, "--format", "-f") ?? "table";
		const format: "table" | "json" | "markdown" =
			rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

		const report = inspectHarnesses(repoPath);
		process.stdout.write(formatHarnessInspectionReport(report, format));
		return ExitCode.SUCCESS;
	}

	if (command === "doctor" || command === "status") {
		const repoPath = path.resolve(
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd(),
		);
		const loadedConfigRes = loadSkillOpsConfig(repoPath);
		const catalogDir = resolveCatalogDir(
			args,
			repoPath,
			loadedConfigRes.config,
		);
		const rawFormat = getFlagValue(args, "--format", "-f") ?? "table";
		const format: "table" | "json" | "markdown" | "github" =
			rawFormat === "json" || rawFormat === "markdown" || rawFormat === "github"
				? rawFormat
				: "table";
		const strict = args.includes("--strict");

		const report = diagnoseRepository(repoPath, { catalogDir });
		process.stdout.write(`${formatDoctorReport(report, format)}\n`);

		if (!report.config_valid) {
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		if (
			!report.lockfile_valid ||
			report.drifted_artifacts_count > 0 ||
			report.missing_artifacts_count > 0
		) {
			return ExitCode.ERROR;
		}
		if (strict && report.status !== "pass") {
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		return ExitCode.SUCCESS;
	}

	if (command === "mcp") {
		const repoPath = path.resolve(
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd(),
		);
		const catalogDir = resolveCatalogDir(args, repoPath);
		startMcpStdioServer({ repoPath, catalogDir });
		return ExitCode.SUCCESS;
	}

	if (command === "mcp-setup") {
		const repoPath = path.resolve(
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd(),
		);
		const cfgRes = loadSkillOpsConfig(repoPath);
		if (cfgRes.error) {
			process.stderr.write(
				`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`,
			);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		const targetsArg = resolveTargetsArg(args);
		let targets: RuntimeTarget[];
		try {
			targets = targetsArg
				? resolveRuntimeTargets(targetsArg, repoPath)
				: (cfgRes.config?.targets ?? [...CORE_RUNTIME_TARGETS]);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`Invalid --targets: ${msg}\n`);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		const dryRun = args.includes("--dry-run");
		const rawFormat = getFlagValue(args, "--format", "-f") ?? "table";
		const format: "table" | "json" | "markdown" =
			rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

		const report = setupMcpForHarnesses(repoPath, { targets, dryRun });
		process.stdout.write(formatMcpSetupReport(report, format));
		return ExitCode.SUCCESS;
	}

	const suggestion = suggestCommand(command);
	const hint = suggestion ? ` Did you mean '${suggestion}'?` : "";
	process.stderr.write(
		`Unknown command '${command}'.${hint} Run 'npx skillops-cli --help'.\n`,
	);
	return ExitCode.ERROR;
}

export async function runCliInteractive(
	argv: readonly string[],
): Promise<number> {
	const args = argv.slice(2);
	const command = args[0];

	if (
		command === "add" &&
		!args.includes("--help") &&
		!args.includes("-h") &&
		process.stdin.isTTY &&
		process.stdout.isTTY
	) {
		const repoPath =
			getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd();
		const cfgRes = loadSkillOpsConfig(repoPath);
		if (cfgRes.error) {
			process.stderr.write(
				`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`,
			);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}
		const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
		const explicitTargetsArg = resolveTargetsArg(args);
		const positionals = getPositionalArgs(args);
		const needsCatalogPrompt =
			!args.includes("--all") && positionals.length === 0;

		let resolvedTargetsArg = explicitTargetsArg;

		// Step 1: Explicitly select AI IDE / Agent when -t / --target is not passed
		if (!resolvedTargetsArg) {
			const targetOptions = buildInteractiveTargetOptions();
			const step1Title = needsCatalogPrompt
				? "SkillOps — Step 1/2: Select Your AI IDE / Agent"
				: "SkillOps — Select Your AI IDE / Agent";
			const selectedTargets = await runMultiSelectPrompt(
				step1Title,
				targetOptions,
				{
					tabLabels: {
						skill: "AI IDEs & Agents",
						agent: "",
					},
					submitActionLabel: "continue",
					selectCursorOnEmptySubmit: true,
				},
			);

			if (!selectedTargets || selectedTargets.length === 0) {
				process.stdout.write("No AI IDE selected.\n");
				return ExitCode.SUCCESS;
			}
			resolvedTargetsArg = selectedTargets.join(",");
		}

		let targets: RuntimeTarget[];
		try {
			targets = resolveRuntimeTargets(resolvedTargetsArg, repoPath);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`Invalid --targets: ${msg}\n`);
			return ExitCode.BUDGET_OR_CONTRACT_ERROR;
		}

		const extraArgs: string[] = [];
		if (!explicitTargetsArg) {
			extraArgs.push("-t", targets.join(","));
		}

		// Step 2: Select Skills & Agents when no names or --all were passed
		if (needsCatalogPrompt) {
			const options = buildInteractiveCatalogOptions(catalogDir);
			const step2Title = !explicitTargetsArg
				? "SkillOps — Step 2/2: Select Skills & Agents to Import"
				: "SkillOps — Select Skills & Agents to Import";
			const selected = await runMultiSelectPrompt(step2Title, options, {
				targetHint: targets.join(", "),
				showSelectAll: true,
			});

			if (!selected || selected.length === 0) {
				process.stdout.write("No Skills or Agents selected.\n");
				return ExitCode.SUCCESS;
			}
			extraArgs.push(...selected);
		}

		return runCli([...argv, ...extraArgs]);
	}

	if (
		(command === "remove" || command === "uninstall" || command === "rm") &&
		!args.includes("--help") &&
		!args.includes("-h") &&
		!args.includes("--all") &&
		process.stdin.isTTY &&
		process.stdout.isTTY
	) {
		const positionals = getPositionalArgs(args);
		if (positionals.length === 0) {
			const repoPath =
				getFlagValue(args, "--repo", "--project", "-p") ?? process.cwd();
			const cfgRes = loadSkillOpsConfig(repoPath);
			if (cfgRes.error) {
				process.stderr.write(
					`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`,
				);
				return ExitCode.BUDGET_OR_CONTRACT_ERROR;
			}
			const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
			const explicitTargetsArg = resolveTargetsArg(args);
			let targets: RuntimeTarget[] | undefined;
			if (explicitTargetsArg) {
				try {
					targets = resolveRuntimeTargets(explicitTargetsArg, repoPath);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					process.stderr.write(`Invalid --targets: ${msg}\n`);
					return ExitCode.BUDGET_OR_CONTRACT_ERROR;
				}
			}

			const installedOptions = buildInteractiveInstalledOptions(
				repoPath,
				catalogDir,
				targets,
			);
			if (installedOptions.length === 0) {
				process.stdout.write(
					"No imported Skills or Agents found in this project.\n",
				);
				return ExitCode.SUCCESS;
			}

			const selected = await runMultiSelectPrompt(
				"SkillOps — Select Installed Skills & Agents to Remove",
				installedOptions,
				{
					submitActionLabel: "remove",
					targetHint: targets ? targets.join(", ") : undefined,
					showSelectAll: true,
				},
			);

			if (!selected || selected.length === 0) {
				process.stdout.write("No Skills or Agents selected for removal.\n");
				return ExitCode.SUCCESS;
			}

			return runCli([...argv, ...selected]);
		}
	}

	return runCli(argv);
}

function isDirectCliInvocation(): boolean {
	const entryArg = process.argv[1];
	if (!entryArg) {
		return false;
	}
	try {
		const resolvedArg = fs.existsSync(entryArg)
			? fs.realpathSync(entryArg)
			: path.resolve(entryArg);
		const selfPath = fileURLToPath(import.meta.url);
		const resolvedSelf = fs.existsSync(selfPath)
			? fs.realpathSync(selfPath)
			: selfPath;
		const base = path.basename(resolvedArg, path.extname(resolvedArg));
		return (
			pathToFileURL(resolvedArg).href === pathToFileURL(resolvedSelf).href ||
			base === "skillops" ||
			base === "skillops-cli"
		);
	} catch {
		return false;
	}
}

if (isDirectCliInvocation()) {
	runCliInteractive(process.argv).then((code) => {
		process.exit(code);
	});
}
