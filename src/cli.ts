/**
 * SkillOps NPX CLI Entrypoint (`npx skillops-cli@latest <add|remove>`).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	discoverSkillDirectories,
	discoverSubagentFiles,
	parseSkillDirectory,
	parseSubagentFile,
} from "./auditor/index.js";
import {
	ALL_RUNTIME_TARGETS,
	CORE_RUNTIME_TARGETS,
	ExitCode,
	loadSkillOpsConfig,
	RUNTIME_HARNESS_SPECS,
	type RuntimeTarget,
	resolveRuntimeTargets,
	SKILLOPS_VERSION,
	type SkillOpsConfig,
	SyncLockfileSchema,
} from "./models.js";
import {
	addSkillOrSubagent,
	cleanSyncedArtifacts,
	detectExistingTargetsForItem,
	formatSyncReport,
	removeSkillOrSubagent,
} from "./sync/index.js";
import {
	findCommandHelpSpec,
	type MultiSelectOption,
	renderCancelledStep,
	renderCommandHelp,
	renderCompletedStep,
	renderGlobalHelp,
	runMultiSelectPrompt,
	suggestCommand,
} from "./ui/index.js";

const PACKAGE_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

function getAllFlagValues(
	args: readonly string[],
	...flagNames: string[]
): string[] {
	const flagSet = new Set(flagNames);
	const values: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg || !flagSet.has(arg)) {
			continue;
		}
		const val = args[i + 1];
		if (val && !val.startsWith("-")) {
			values.push(val);
			i += 1;
		}
	}
	return values;
}

function getFlagValue(
	args: readonly string[],
	...flagNames: string[]
): string | undefined {
	return getAllFlagValues(args, ...flagNames)[0];
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
	const explicitValues = getAllFlagValues(
		args,
		"--targets",
		"--harness",
		"--harnesses",
		"--target",
		"-t",
	);
	if (explicitValues.length > 0) {
		return explicitValues.join(",");
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

export interface BuildCatalogOptionsContext {
	readonly repoPath?: string;
	readonly targets?: readonly RuntimeTarget[];
}

function formatCatalogOptionHint(
	baseDescription: string,
	existingTargets: readonly RuntimeTarget[],
	candidateTargets: readonly RuntimeTarget[],
): string {
	if (candidateTargets.length === 0 || existingTargets.length === 0) {
		return baseDescription;
	}
	if (existingTargets.length >= candidateTargets.length) {
		return `[installed] · ${baseDescription}`;
	}
	const listLabel =
		existingTargets.length <= 2
			? existingTargets.join(", ")
			: `${existingTargets.slice(0, 2).join(", ")}, +${existingTargets.length - 2}`;
	return `[installed: ${listLabel}] · ${baseDescription}`;
}

export function buildInteractiveCatalogOptions(
	catalogDir: string,
	context?: BuildCatalogOptionsContext,
): MultiSelectOption[] {
	const options: MultiSelectOption[] = [];
	const seen = new Set<string>();
	const repoPath = context?.repoPath;
	const candidateTargets = context?.targets ?? [];
	const shouldCheckDisk = Boolean(repoPath && candidateTargets.length > 0);

	for (const skillDir of discoverSkillDirectories(catalogDir)) {
		try {
			const parsed = parseSkillDirectory(skillDir, { requireLayout: false });
			if (!seen.has(parsed.manifest.name)) {
				seen.add(parsed.manifest.name);
				const existingTargets =
					shouldCheckDisk && repoPath
						? detectExistingTargetsForItem(
								repoPath,
								parsed.manifest.name,
								"skill",
								candidateTargets,
							)
						: [];
				options.push({
					value: parsed.manifest.name,
					label: parsed.manifest.name,
					kind: "skill",
					hint: formatCatalogOptionHint(
						parsed.manifest.description,
						existingTargets,
						candidateTargets,
					),
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
				const existingTargets =
					shouldCheckDisk && repoPath
						? detectExistingTargetsForItem(
								repoPath,
								parsed.manifest.name,
								"subagent",
								candidateTargets,
							)
						: [];
				options.push({
					value: parsed.manifest.name,
					label: parsed.manifest.name,
					kind: "agent",
					hint: formatCatalogOptionHint(
						parsed.manifest.description,
						existingTargets,
						candidateTargets,
					),
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
			process.stderr.write(
				"Usage: npx skillops-cli add <skill-or-subagent-name> [more-names...] [options]\n",
			);
			return ExitCode.ERROR;
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
							targets: [...new Set(reports.flatMap((r) => r.targets))],
							artifacts: reports.flatMap((r) => r.artifacts),
							skipped_existing: [
								...new Set(reports.flatMap((r) => r.skipped_existing)),
							],
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
							targets: [...new Set(reports.flatMap((r) => r.targets))],
							artifacts: reports.flatMap((r) => r.artifacts),
							skipped_existing: [
								...new Set(reports.flatMap((r) => r.skipped_existing)),
							],
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
		(command === "add" || command === "install" || command === "i") &&
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
					subtitle:
						"Select one or more AI coding assistants with Space · Enter to continue",
					tabLabels: {
						skill: "AI IDEs & Agents",
						agent: "",
					},
					submitActionLabel: "continue",
					selectCursorOnEmptySubmit: true,
					showSelectAll: true,
				},
			);

			if (!selectedTargets || selectedTargets.length === 0) {
				process.stdout.write(`${renderCancelledStep("No AI IDE selected.")}\n`);
				return ExitCode.SUCCESS;
			}
			resolvedTargetsArg = selectedTargets.join(",");
			process.stdout.write(
				`${renderCompletedStep(needsCatalogPrompt ? "Step 1/2 · AI IDE(s)" : "AI IDE(s)", selectedTargets.join(", "))}\n`,
			);
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
			const options = buildInteractiveCatalogOptions(catalogDir, {
				repoPath,
				targets,
			});
			const step2Title = !explicitTargetsArg
				? "SkillOps — Step 2/2: Select Skills & Agents to Import"
				: "SkillOps — Select Skills & Agents to Import";
			const selected = await runMultiSelectPrompt(step2Title, options, {
				subtitle: "Switch tabs with ←/→ · Press Space to select · Enter to install",
				targetHint: targets.join(", "),
				showSelectAll: true,
			});

			if (!selected || selected.length === 0) {
				process.stdout.write(
					`${renderCancelledStep("No Skills or Agents selected.")}\n`,
				);
				return ExitCode.SUCCESS;
			}
			process.stdout.write(
				`${renderCompletedStep(!explicitTargetsArg ? "Step 2/2 · Selected" : "Selected", selected.join(", "))}\n\n`,
			);
			extraArgs.push(...selected);
		} else if (!explicitTargetsArg) {
			process.stdout.write("\n");
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
					`${renderCancelledStep("No imported Skills or Agents found in this project.")}\n`,
				);
				return ExitCode.SUCCESS;
			}

			const selected = await runMultiSelectPrompt(
				"SkillOps — Select Installed Skills & Agents to Remove",
				installedOptions,
				{
					subtitle: "Select installed items with Space · Press Enter to remove",
					submitActionLabel: "remove",
					targetHint: targets ? targets.join(", ") : undefined,
					showSelectAll: true,
				},
			);

			if (!selected || selected.length === 0) {
				process.stdout.write(
					`${renderCancelledStep("No Skills or Agents selected for removal.")}\n`,
				);
				return ExitCode.SUCCESS;
			}

			process.stdout.write(
				`${renderCompletedStep("Selected to remove", selected.join(", "))}\n\n`,
			);

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
