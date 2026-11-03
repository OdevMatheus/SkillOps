/**
 * Multi-Runtime Transpiler for Skills & Context-Isolated Subagents (`src/sync/adapters.ts`).
 *
 * Implements Issue #61:
 * - Transpiles Hybrid Executable Skills (SKILL.md + Level 3 scripts/references) and
 *   Context-Isolated Subagents (SUBAGENT.md) across:
 *   1. Claude Code (`.claude/skills/<name>/`, `.claude/agents/<name>.md`)
 *   2. Antigravity / Gemini CLI (`.agent/skills/<name>/`, `.agent/agents/<name>.md`)
 *   3. Cursor (`.cursor/rules/skillops-<name>.mdc`, `.cursor/rules/skillops-agent-<name>.mdc`)
 *   4. OpenAI Codex CLI (`.codex/skills/<name>/`, `.codex/agents/<name>.md`, `AGENTS.md`)
 *   5. GitHub Copilot (`.github/instructions/`, `.github/prompts/`, `.github/agents/<name>.agent.md`)
 * - Enforces `.skillops-lock.json` SHA-256 integrity, local drift detection, and surgical `add`.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
	discoverSkillDirectories,
	discoverSubagentFiles,
	type ParsedSkillDirectory,
	type ParsedSubagentFile,
	parseSkillDirectory,
	parseSubagentFile,
} from "../auditor/parser.js";
import {
	ALL_RUNTIME_TARGETS,
	CORE_RUNTIME_TARGETS,
	type RoutedBundle,
	RUNTIME_HARNESS_SPECS,
	type RuntimeTarget,
	SKILLOPS_VERSION,
	type SyncedArtifact,
	type SyncLockEntry,
	type SyncLockfile,
	SyncLockfileSchema,
	type SyncReport,
	SyncReportSchema,
} from "../models.js";
import { type RouteOptions, routeRepository } from "../router/index.js";
import { renderBox, renderNextSteps, style } from "../ui/terminal.js";

export interface SyncOptions extends RouteOptions {
	readonly targets?: readonly RuntimeTarget[];
	readonly dryRun?: boolean;
	readonly force?: boolean;
}

export interface AddOptions {
	readonly targets?: readonly RuntimeTarget[];
	readonly dryRun?: boolean;
	readonly force?: boolean;
}

export interface RemoveOptions {
	readonly targets?: readonly RuntimeTarget[];
	readonly dryRun?: boolean;
	readonly force?: boolean;
}

export interface CleanOptions {
	readonly dryRun?: boolean;
	readonly force?: boolean;
}

interface PlannedFile {
	readonly target: RuntimeTarget;
	readonly itemName: string;
	readonly relativePath: string;
	readonly content: string;
}

const CODEX_MARKER_START = "<!-- SKILLOPS:START -->";
const CODEX_MARKER_END = "<!-- SKILLOPS:END -->";

export function computeSha256(content: string): string {
	return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

export function renderSkillFilesForRuntime(
	parsed: ParsedSkillDirectory,
	target: RuntimeTarget,
): PlannedFile[] {
	const name = parsed.manifest.name;
	const spec = RUNTIME_HARNESS_SPECS[target];
	const files: PlannedFile[] = [];
	const globs =
		parsed.manifest.routing_signals.files_any.length > 0
			? parsed.manifest.routing_signals.files_any
			: ["**/*"];
	const body = parsed.markdownBody.trim();

	if (spec.skillFormat === "progressive-skill-dir") {
		const baseDir = `${spec.skillsDir}/${name}`;

		files.push({
			target,
			itemName: name,
			relativePath: `${baseDir}/SKILL.md`,
			content: parsed.rawText,
		});

		for (const scriptFull of parsed.declaredScripts) {
			const scriptRel = path
				.relative(parsed.skillDir, scriptFull)
				.replace(/\\/g, "/");
			files.push({
				target,
				itemName: name,
				relativePath: `${baseDir}/${scriptRel}`,
				content: fs.readFileSync(scriptFull, "utf-8"),
			});
		}

		for (const refFull of parsed.referenceFiles) {
			const refRel = path
				.relative(parsed.skillDir, refFull)
				.replace(/\\/g, "/");
			files.push({
				target,
				itemName: name,
				relativePath: `${baseDir}/${refRel}`,
				content: fs.readFileSync(refFull, "utf-8"),
			});
		}
		return files;
	}

	if (target === "cursor") {
		const mdcFrontmatter = YAML.stringify({
			description: parsed.manifest.description,
			globs,
			alwaysApply: false,
		}).trim();
		files.push({
			target,
			itemName: name,
			relativePath: `.cursor/rules/skillops-${name}.mdc`,
			content: `---\n${mdcFrontmatter}\n---\n\n${body}\n`,
		});
		return files;
	}

	if (target === "copilot") {
		const applyTo =
			parsed.manifest.routing_signals.files_any.length > 0
				? parsed.manifest.routing_signals.files_any.join(",")
				: "**";
		const instrFrontmatter = YAML.stringify({
			applyTo,
			description: parsed.manifest.description,
		}).trim();
		files.push({
			target,
			itemName: name,
			relativePath: `.github/instructions/skillops-${name}.instructions.md`,
			content: `---\n${instrFrontmatter}\n---\n\n${body}\n`,
		});

		const promptFrontmatter = YAML.stringify({
			mode: "agent",
			description: parsed.manifest.description,
		}).trim();
		files.push({
			target,
			itemName: name,
			relativePath: `.github/prompts/skillops-${name}.prompt.md`,
			content: `---\n${promptFrontmatter}\n---\n\n${body}\n`,
		});
		return files;
	}

	if (target === "windsurf") {
		const wsFrontmatter = YAML.stringify({
			trigger: "model_decision",
			description: parsed.manifest.description,
			globs,
		}).trim();
		files.push({
			target,
			itemName: name,
			relativePath: `.windsurf/rules/skillops-${name}.md`,
			content: `---\n${wsFrontmatter}\n---\n\n${body}\n`,
		});
		return files;
	}

	if (target === "openhands") {
		const ohFrontmatter = YAML.stringify({
			name,
			type: "knowledge",
			version: parsed.manifest.version,
			agent: "CodeActAgent",
			triggers: parsed.manifest.tags,
		}).trim();
		files.push({
			target,
			itemName: name,
			relativePath: `.openhands/microagents/skillops-${name}.md`,
			content: `---\n${ohFrontmatter}\n---\n\n${body}\n`,
		});
		return files;
	}

	if (target === "kiro") {
		const kiroFrontmatter = YAML.stringify({
			inclusion: "fileMatch",
			fileMatchPattern: globs[0] ?? "**/*",
			description: parsed.manifest.description,
		}).trim();
		files.push({
			target,
			itemName: name,
			relativePath: `.kiro/steering/skillops-${name}.md`,
			content: `---\n${kiroFrontmatter}\n---\n\n${body}\n`,
		});
		return files;
	}

	// Remaining markdown-rule harnesses: cline, roocode, kilocode, zed, continue, aider, trae, amazonq, junie
	const ruleFrontmatter = YAML.stringify({
		name,
		description: parsed.manifest.description,
		track: parsed.manifest.track,
		tags: parsed.manifest.tags,
		globs,
		alwaysApply: false,
	}).trim();
	files.push({
		target,
		itemName: name,
		relativePath: `${spec.skillsDir}/skillops-${name}.md`,
		content: `---\n${ruleFrontmatter}\n---\n\n${body}\n`,
	});

	return files;
}

export function renderSubagentFilesForRuntime(
	subagent: ParsedSubagentFile,
	target: RuntimeTarget,
): PlannedFile[] {
	const name = subagent.manifest.name;
	const spec = RUNTIME_HARNESS_SPECS[target];
	const promptBody = subagent.systemPromptBody.trim();
	const fm = YAML.stringify({
		name: subagent.manifest.name,
		description: subagent.manifest.description,
		model_tier: subagent.manifest.model_tier,
		tools: subagent.manifest.tools,
		max_output_tokens: subagent.manifest.max_output_tokens,
	}).trim();
	const normalizedDoc = `---\n${fm}\n---\n\n${promptBody}\n`;

	if (
		target === "claude" ||
		target === "antigravity" ||
		target === "codex" ||
		target === "amp" ||
		target === "goose" ||
		target === "opencode"
	) {
		return [
			{
				target,
				itemName: name,
				relativePath: `${spec.subagentsDir}/${name}.md`,
				content: normalizedDoc,
			},
		];
	}

	if (target === "copilot") {
		return [
			{
				target,
				itemName: name,
				relativePath: `.github/agents/${name}.agent.md`,
				content: normalizedDoc,
			},
		];
	}

	if (target === "cursor") {
		const mdcFm = YAML.stringify({
			description: `[Subagent: ${name}] ${subagent.manifest.description}`,
			alwaysApply: false,
		}).trim();
		return [
			{
				target,
				itemName: name,
				relativePath: `.cursor/rules/skillops-agent-${name}.mdc`,
				content: `---\n${mdcFm}\n---\n\n${promptBody}\n`,
			},
		];
	}

	if (target === "continue") {
		const contFm = YAML.stringify({
			name,
			description: subagent.manifest.description,
			invokable: true,
		}).trim();
		return [
			{
				target,
				itemName: name,
				relativePath: `.continue/prompts/skillops-agent-${name}.prompt`,
				content: `---\n${contFm}\n---\n\n${promptBody}\n`,
			},
		];
	}

	if (target === "openhands") {
		const ohFm = YAML.stringify({
			name: `agent-${name}`,
			type: "knowledge",
			version: "1.0.0",
			agent: "CodeActAgent",
			triggers: [name, ...subagent.manifest.tags],
		}).trim();
		return [
			{
				target,
				itemName: name,
				relativePath: `.openhands/microagents/skillops-agent-${name}.md`,
				content: `---\n${ohFm}\n---\n\n${promptBody}\n`,
			},
		];
	}

	if (target === "amazonq") {
		const qPayload = {
			name,
			description: subagent.manifest.description,
			prompt: promptBody,
			tools: subagent.manifest.tools,
			max_output_tokens: subagent.manifest.max_output_tokens,
		};
		return [
			{
				target,
				itemName: name,
				relativePath: `.amazonq/cli-agents/skillops-agent-${name}.json`,
				content: `${JSON.stringify(qPayload, null, 2)}\n`,
			},
		];
	}

	// Remaining harnesses: windsurf, cline, roocode, kilocode, zed, aider, kiro, trae, junie
	return [
		{
			target,
			itemName: name,
			relativePath: `${spec.subagentsDir}/skillops-agent-${name}.md`,
			content: normalizedDoc,
		},
	];
}

export function renderCodexAgentsIndex(
	existingContent: string | null,
	skills: readonly ParsedSkillDirectory[],
	subagents: readonly ParsedSubagentFile[],
): string {
	const blockLines: string[] = [
		CODEX_MARKER_START,
		"## SkillOps Routed Skills & Context-Isolated Subagents",
		"",
		"### Active Progressive Disclosure Skills",
		...skills.map(
			(s) =>
				`- **\`${s.manifest.name}\`** (\`.codex/skills/${s.manifest.name}/SKILL.md\`): ${s.manifest.description}`,
		),
		"",
		"### Active Context-Isolated Subagents",
		...subagents.map(
			(sa) =>
				`- **\`${sa.manifest.name}\`** (\`.codex/agents/${sa.manifest.name}.md\`, max output \`${sa.manifest.max_output_tokens}\` tokens): ${sa.manifest.description}`,
		),
		CODEX_MARKER_END,
	];
	const managedBlock = blockLines.join("\n");

	if (!existingContent || !existingContent.trim()) {
		return `# AGENTS.md\n\n${managedBlock}\n`;
	}

	const startIdx = existingContent.indexOf(CODEX_MARKER_START);
	const endIdx = existingContent.indexOf(CODEX_MARKER_END);
	if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
		const before = existingContent.slice(0, startIdx).trimEnd();
		const after = existingContent
			.slice(endIdx + CODEX_MARKER_END.length)
			.trimStart();
		return [before, managedBlock, after].filter(Boolean).join("\n\n") + "\n";
	}

	return `${existingContent.trimEnd()}\n\n${managedBlock}\n`;
}

function loadExistingLockfile(lockfilePath: string): SyncLockfile | null {
	if (!fs.existsSync(lockfilePath) || !fs.statSync(lockfilePath).isFile()) {
		return null;
	}
	try {
		const raw = JSON.parse(fs.readFileSync(lockfilePath, "utf-8")) as unknown;
		return SyncLockfileSchema.parse(raw);
	} catch {
		return null;
	}
}

function applyPlannedFiles(
	resolvedRepo: string,
	resolvedCatalog: string,
	targets: readonly RuntimeTarget[],
	routedBundle: RoutedBundle,
	plannedFiles: readonly PlannedFile[],
	options: {
		dryRun: boolean;
		force: boolean;
		preserveUnlistedLockEntries: boolean;
	},
): SyncReport {
	const lockfilePath = path.join(resolvedRepo, ".skillops-lock.json");
	const existingLock = loadExistingLockfile(lockfilePath);
	const newLockArtifacts: Record<string, SyncLockEntry> =
		options.preserveUnlistedLockEntries
			? { ...(existingLock?.artifacts ?? {}) }
			: {};

	const artifacts: SyncedArtifact[] = [];
	const driftConflicts: string[] = [];

	for (const pf of plannedFiles) {
		const fullPath = path.join(resolvedRepo, pf.relativePath);
		const desiredSha = computeSha256(pf.content);
		const previousEntry = existingLock?.artifacts[pf.relativePath];
		const fileExists =
			fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();

		if (fileExists) {
			const currentDiskText = fs.readFileSync(fullPath, "utf-8");
			const currentDiskSha = computeSha256(currentDiskText);

			// Drift check: if file was previously managed by SkillOps and disk SHA differs from lockfile SHA
			if (
				previousEntry &&
				currentDiskSha !== previousEntry.sha256 &&
				currentDiskSha !== desiredSha &&
				!options.force
			) {
				driftConflicts.push(pf.relativePath);
				artifacts.push({
					target: pf.target,
					skill_name: pf.itemName,
					relative_path: pf.relativePath,
					sha256: currentDiskSha,
					action: "conflict",
				});
				newLockArtifacts[pf.relativePath] = previousEntry;
				continue;
			}

			if (currentDiskSha === desiredSha) {
				artifacts.push({
					target: pf.target,
					skill_name: pf.itemName,
					relative_path: pf.relativePath,
					sha256: desiredSha,
					action: "unchanged",
				});
				newLockArtifacts[pf.relativePath] = {
					target: pf.target,
					skill_name: pf.itemName,
					relative_path: pf.relativePath,
					sha256: desiredSha,
				};
				continue;
			}

			if (!options.dryRun) {
				fs.mkdirSync(path.dirname(fullPath), { recursive: true });
				fs.writeFileSync(fullPath, pf.content, "utf-8");
			}
			artifacts.push({
				target: pf.target,
				skill_name: pf.itemName,
				relative_path: pf.relativePath,
				sha256: desiredSha,
				action: options.dryRun ? "planned" : "updated",
			});
			newLockArtifacts[pf.relativePath] = {
				target: pf.target,
				skill_name: pf.itemName,
				relative_path: pf.relativePath,
				sha256: desiredSha,
			};
		} else {
			if (!options.dryRun) {
				fs.mkdirSync(path.dirname(fullPath), { recursive: true });
				fs.writeFileSync(fullPath, pf.content, "utf-8");
			}
			artifacts.push({
				target: pf.target,
				skill_name: pf.itemName,
				relative_path: pf.relativePath,
				sha256: desiredSha,
				action: options.dryRun ? "planned" : "created",
			});
			newLockArtifacts[pf.relativePath] = {
				target: pf.target,
				skill_name: pf.itemName,
				relative_path: pf.relativePath,
				sha256: desiredSha,
			};
		}
	}

	// Write updated lockfile if not dry-run and no drift conflicts
	if (!options.dryRun && driftConflicts.length === 0) {
		const lockData: SyncLockfile = SyncLockfileSchema.parse({
			schema_version: "1.0",
			skillops_version: SKILLOPS_VERSION,
			targets: [...targets],
			selected_skills: routedBundle.selected_skills.map((s) => s.name),
			selected_subagents: routedBundle.recommended_subagents,
			total_l1_tokens: routedBundle.total_l1_tokens,
			artifacts: newLockArtifacts,
		});
		fs.writeFileSync(
			lockfilePath,
			`${JSON.stringify(lockData, null, 2)}\n`,
			"utf-8",
		);
	}

	return SyncReportSchema.parse({
		repo_path: resolvedRepo.replace(/\\/g, "/"),
		catalog_path: resolvedCatalog.replace(/\\/g, "/"),
		targets: [...targets],
		dry_run: options.dryRun,
		force: options.force,
		routed_bundle: routedBundle,
		artifacts,
		drift_conflicts: driftConflicts,
		lockfile_path: lockfilePath.replace(/\\/g, "/"),
		passed: driftConflicts.length === 0 && routedBundle.passed_invariants,
	});
}

export function syncRepository(
	repoPath: string,
	catalogDir: string,
	options: SyncOptions = {},
): SyncReport {
	const resolvedRepo = path.resolve(repoPath);
	const resolvedCatalog = path.resolve(catalogDir);
	const targets = options.targets?.length
		? options.targets
		: CORE_RUNTIME_TARGETS;
	const dryRun = options.dryRun ?? false;
	const force = options.force ?? false;

	const routedBundle = routeRepository(resolvedRepo, resolvedCatalog, options);

	// Load selected skills
	const selectedSkills: ParsedSkillDirectory[] =
		routedBundle.selected_skills.map((s) =>
			parseSkillDirectory(s.skill_dir, { requireLayout: false }),
		);

	// Load catalog subagents (deduplicated by manifest.name)
	const subagentMap = new Map<string, ParsedSubagentFile>();
	for (const saPath of discoverSubagentFiles(resolvedCatalog)) {
		try {
			const parsedSa = parseSubagentFile(saPath);
			if (!subagentMap.has(parsedSa.manifest.name)) {
				subagentMap.set(parsedSa.manifest.name, parsedSa);
			}
		} catch {
			// Skip invalid
		}
	}
	const selectedSubagents = [...subagentMap.values()];

	const plannedFiles: PlannedFile[] = [];
	for (const target of targets) {
		for (const skill of selectedSkills) {
			plannedFiles.push(...renderSkillFilesForRuntime(skill, target));
		}
		for (const sa of selectedSubagents) {
			plannedFiles.push(...renderSubagentFilesForRuntime(sa, target));
		}
		if (target === "codex") {
			const agentsMdPath = path.join(resolvedRepo, "AGENTS.md");
			const existingAgentsMd =
				fs.existsSync(agentsMdPath) && fs.statSync(agentsMdPath).isFile()
					? fs.readFileSync(agentsMdPath, "utf-8")
					: null;
			plannedFiles.push({
				target: "codex",
				itemName: "codex-agents-index",
				relativePath: "AGENTS.md",
				content: renderCodexAgentsIndex(
					existingAgentsMd,
					selectedSkills,
					selectedSubagents,
				),
			});
		}
	}

	return applyPlannedFiles(
		resolvedRepo,
		resolvedCatalog,
		targets,
		routedBundle,
		plannedFiles,
		{
			dryRun,
			force,
			preserveUnlistedLockEntries: false,
		},
	);
}

/**
 * Surgically install a single Skill or Subagent by name across active runtime targets.
 */
export function addSkillOrSubagent(
	repoPath: string,
	catalogDir: string,
	itemName: string,
	options: AddOptions = {},
): SyncReport {
	const resolvedRepo = path.resolve(repoPath);
	const resolvedCatalog = path.resolve(catalogDir);
	const targets = options.targets?.length
		? options.targets
		: CORE_RUNTIME_TARGETS;
	const dryRun = options.dryRun ?? false;
	const force = options.force ?? false;

	const skillDirs = discoverSkillDirectories(resolvedCatalog);
	let matchedSkill: ParsedSkillDirectory | null = null;
	for (const dir of skillDirs) {
		try {
			const p = parseSkillDirectory(dir, { requireLayout: false });
			if (p.manifest.name === itemName) {
				matchedSkill = p;
				break;
			}
		} catch {
			// Ignore
		}
	}

	let matchedSubagent: ParsedSubagentFile | null = null;
	if (!matchedSkill) {
		for (const saPath of discoverSubagentFiles(resolvedCatalog)) {
			try {
				const sa = parseSubagentFile(saPath);
				if (sa.manifest.name === itemName) {
					matchedSubagent = sa;
					break;
				}
			} catch {
				// Ignore
			}
		}
	}

	if (!matchedSkill && !matchedSubagent) {
		throw new Error(
			`No Skill or Subagent named '${itemName}' found in catalog '${resolvedCatalog.replace(/\\/g, "/")}'.`,
		);
	}

	const plannedFiles: PlannedFile[] = [];
	for (const target of targets) {
		if (matchedSkill) {
			plannedFiles.push(...renderSkillFilesForRuntime(matchedSkill, target));
		}
		if (matchedSubagent) {
			plannedFiles.push(
				...renderSubagentFilesForRuntime(matchedSubagent, target),
			);
		}
	}

	const routedBundle = routeRepository(resolvedRepo, resolvedCatalog);
	return applyPlannedFiles(
		resolvedRepo,
		resolvedCatalog,
		targets,
		routedBundle,
		plannedFiles,
		{
			dryRun,
			force,
			preserveUnlistedLockEntries: true,
		},
	);
}

function pruneEmptyParentDirs(filePath: string, stopAtRepoRoot: string): void {
	const normalizedStop = path.resolve(stopAtRepoRoot);
	let currentDir = path.dirname(path.resolve(filePath));
	while (
		currentDir.startsWith(normalizedStop) &&
		currentDir !== normalizedStop &&
		fs.existsSync(currentDir)
	) {
		try {
			const entries = fs.readdirSync(currentDir);
			if (entries.length > 0) {
				break;
			}
			fs.rmdirSync(currentDir);
			currentDir = path.dirname(currentDir);
		} catch {
			break;
		}
	}
}

export function stripCodexAgentsBlock(existingContent: string): string {
	const startIdx = existingContent.indexOf(CODEX_MARKER_START);
	const endIdx = existingContent.indexOf(CODEX_MARKER_END);
	if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
		return existingContent;
	}
	const before = existingContent.slice(0, startIdx).trimEnd();
	const after = existingContent
		.slice(endIdx + CODEX_MARKER_END.length)
		.trimStart();
	const combined = [before, after].filter(Boolean).join("\n\n").trim();
	if (!combined || combined === "# AGENTS.md") {
		return "";
	}
	return `${combined}\n`;
}

/**
 * Surgically remove a single synced Skill or Subagent by name across target runtimes.
 */
export function removeSkillOrSubagent(
	repoPath: string,
	catalogDir: string,
	itemName: string,
	options: RemoveOptions = {},
): SyncReport {
	const resolvedRepo = path.resolve(repoPath);
	const resolvedCatalog = path.resolve(catalogDir);
	const targetFilter = options.targets?.length
		? new Set(options.targets)
		: null;
	const dryRun = options.dryRun ?? false;
	const force = options.force ?? false;

	const lockfilePath = path.join(resolvedRepo, ".skillops-lock.json");
	const existingLock = loadExistingLockfile(lockfilePath);
	if (!existingLock) {
		throw new Error(
			`No .skillops-lock.json found in '${resolvedRepo.replace(/\\/g, "/")}'. Run 'sync' or 'add' first.`,
		);
	}

	const matchingEntries = Object.entries(existingLock.artifacts).filter(
		([, entry]) =>
			entry.skill_name === itemName &&
			(!targetFilter || targetFilter.has(entry.target)),
	);

	if (matchingEntries.length === 0) {
		throw new Error(
			`No synced artifacts found for '${itemName}' in .skillops-lock.json.`,
		);
	}

	const newLockArtifacts: Record<string, SyncLockEntry> = {
		...existingLock.artifacts,
	};
	const artifacts: SyncedArtifact[] = [];
	const driftConflicts: string[] = [];

	for (const [relPath, entry] of matchingEntries) {
		const fullPath = path.join(resolvedRepo, relPath);
		const fileExists =
			fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();

		if (fileExists) {
			const currentDiskSha = computeSha256(fs.readFileSync(fullPath, "utf-8"));
			if (currentDiskSha !== entry.sha256 && !force) {
				driftConflicts.push(relPath);
				artifacts.push({
					target: entry.target,
					skill_name: entry.skill_name,
					relative_path: relPath,
					sha256: currentDiskSha,
					action: "conflict",
				});
				continue;
			}

			if (!dryRun) {
				fs.unlinkSync(fullPath);
				pruneEmptyParentDirs(fullPath, resolvedRepo);
			}
		}

		artifacts.push({
			target: entry.target,
			skill_name: entry.skill_name,
			relative_path: relPath,
			sha256: entry.sha256,
			action: dryRun ? "planned" : "removed",
		});
		delete newLockArtifacts[relPath];
	}

	const remainingForSkill = Object.values(newLockArtifacts).some(
		(e) => e.skill_name === itemName,
	);

	if (!dryRun && driftConflicts.length === 0) {
		const updatedSkills = remainingForSkill
			? existingLock.selected_skills
			: existingLock.selected_skills.filter((s) => s !== itemName);
		const updatedSubagents = remainingForSkill
			? existingLock.selected_subagents
			: existingLock.selected_subagents.filter((sa) => sa !== itemName);

		const lockData: SyncLockfile = SyncLockfileSchema.parse({
			...existingLock,
			skillops_version: SKILLOPS_VERSION,
			selected_skills: updatedSkills,
			selected_subagents: updatedSubagents,
			artifacts: newLockArtifacts,
		});
		fs.writeFileSync(
			lockfilePath,
			`${JSON.stringify(lockData, null, 2)}\n`,
			"utf-8",
		);
	}

	const routedBundle = routeRepository(resolvedRepo, resolvedCatalog);
	return SyncReportSchema.parse({
		repo_path: resolvedRepo.replace(/\\/g, "/"),
		catalog_path: resolvedCatalog.replace(/\\/g, "/"),
		targets: targetFilter ? [...targetFilter] : existingLock.targets,
		dry_run: dryRun,
		force,
		routed_bundle: routedBundle,
		artifacts,
		drift_conflicts: driftConflicts,
		lockfile_path: lockfilePath.replace(/\\/g, "/"),
		passed: driftConflicts.length === 0,
	});
}

/**
 * Clean all SkillOps-managed runtime artifacts tracked in `.skillops-lock.json`.
 */
export function cleanSyncedArtifacts(
	repoPath: string,
	catalogDir: string,
	options: CleanOptions = {},
): SyncReport {
	const resolvedRepo = path.resolve(repoPath);
	const resolvedCatalog = path.resolve(catalogDir);
	const dryRun = options.dryRun ?? false;
	const force = options.force ?? false;

	const lockfilePath = path.join(resolvedRepo, ".skillops-lock.json");
	const existingLock = loadExistingLockfile(lockfilePath);
	const routedBundle = routeRepository(resolvedRepo, resolvedCatalog);

	if (!existingLock) {
		return SyncReportSchema.parse({
			repo_path: resolvedRepo.replace(/\\/g, "/"),
			catalog_path: resolvedCatalog.replace(/\\/g, "/"),
			targets: [...ALL_RUNTIME_TARGETS],
			dry_run: dryRun,
			force,
			routed_bundle: routedBundle,
			artifacts: [],
			drift_conflicts: [],
			lockfile_path: lockfilePath.replace(/\\/g, "/"),
			passed: true,
		});
	}

	const artifacts: SyncedArtifact[] = [];
	const driftConflicts: string[] = [];

	for (const [relPath, entry] of Object.entries(existingLock.artifacts)) {
		const fullPath = path.join(resolvedRepo, relPath);
		const fileExists =
			fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();

		if (fileExists) {
			const diskText = fs.readFileSync(fullPath, "utf-8");
			const currentDiskSha = computeSha256(diskText);
			if (currentDiskSha !== entry.sha256 && !force) {
				driftConflicts.push(relPath);
				artifacts.push({
					target: entry.target,
					skill_name: entry.skill_name,
					relative_path: relPath,
					sha256: currentDiskSha,
					action: "conflict",
				});
				continue;
			}

			if (!dryRun) {
				if (
					relPath === "AGENTS.md" &&
					entry.skill_name === "codex-agents-index"
				) {
					const stripped = stripCodexAgentsBlock(diskText);
					if (stripped) {
						fs.writeFileSync(fullPath, stripped, "utf-8");
					} else {
						fs.unlinkSync(fullPath);
					}
				} else {
					fs.unlinkSync(fullPath);
					pruneEmptyParentDirs(fullPath, resolvedRepo);
				}
			}
		}

		artifacts.push({
			target: entry.target,
			skill_name: entry.skill_name,
			relative_path: relPath,
			sha256: entry.sha256,
			action: dryRun ? "planned" : "removed",
		});
	}

	if (!dryRun && driftConflicts.length === 0 && fs.existsSync(lockfilePath)) {
		fs.unlinkSync(lockfilePath);
	}

	return SyncReportSchema.parse({
		repo_path: resolvedRepo.replace(/\\/g, "/"),
		catalog_path: resolvedCatalog.replace(/\\/g, "/"),
		targets: existingLock.targets,
		dry_run: dryRun,
		force,
		routed_bundle: routedBundle,
		artifacts,
		drift_conflicts: driftConflicts,
		lockfile_path: lockfilePath.replace(/\\/g, "/"),
		passed: driftConflicts.length === 0,
	});
}

export function formatSyncReport(
	report: SyncReport,
	format: "table" | "json" | "markdown" = "table",
	colorEnabled?: boolean,
): string {
	if (format === "json") {
		return `${JSON.stringify(report, null, 2)}\n`;
	}
	if (format === "markdown") {
		return [
			"## SkillOps Multi-Runtime Sync Report",
			"",
			`- **Targets**: ${report.targets.map((t) => `\`${t}\``).join(", ")}`,
			`- **Artifacts Synced**: \`${report.artifacts.length}\``,
			`- **Drift Conflicts**: \`${report.drift_conflicts.length}\``,
			`- **Status**: **${report.passed ? "PASS" : "CONFLICT"}**`,
			"",
			"| Target | Skill / Subagent | Relative Path | Action |",
			"| :--- | :--- | :--- | :---: |",
			...report.artifacts.map(
				(a) =>
					`| \`${a.target}\` | \`${a.skill_name}\` | \`${a.relative_path}\` | \`${a.action}\` |`,
			),
			"",
		].join("\n");
	}

	const c = colorEnabled;
	const activeArtifacts = report.artifacts.filter(
		(a) =>
			a.action === "created" ||
			a.action === "updated" ||
			a.action === "unchanged",
	);
	const firstSkill =
		activeArtifacts.find((a) => a.skill_name !== "codex-agents-index")
			?.skill_name ??
		report.routed_bundle.selected_skills[0]?.name ??
		"security-sast-gate";

	const usageBox =
		activeArtifacts.length > 0
			? renderBox(
					[
						`${style.bold("How to use your installed Skills & Subagents inside your AI:", c)}`,
						`  • ${style.cyan("Claude Code / Antigravity:", c)} Ask naturally (auto-routed via SKILL.md) or delegate to a Subagent`,
						`  • ${style.cyan("Cursor / Windsurf / Cline / Copilot:", c)} Reference ${style.green(`@${firstSkill}`, c)} in Chat or let rules auto-attach`,
						`  • ${style.cyan("Deep-Inspect:", c)} Run ${style.green(`npx skillops-cli info ${firstSkill}`, c)} to view triggers & Level 3 scripts`,
					],
					{
						title: "🚀 Using Your Skills & Subagents",
						borderColor: style.cyan,
						minWidth: 74,
						colorEnabled: c,
					},
				)
			: "";

	const nextSteps = renderNextSteps(
		[
			{
				command: `npx skillops-cli info ${firstSkill}`,
				description: "Inspect triggers, token budget & Level 3 scripts",
			},
			{
				command: "npx skillops-cli doctor",
				description: "Verify lockfile SHA-256 integrity & Startup Token Tax",
			},
		],
		c,
	);

	return [
		"=== SkillOps Multi-Runtime Transpiler & Sync Engine ===",
		`Repo       : ${report.repo_path}`,
		`Targets    : ${report.targets.join(", ")}`,
		`Artifacts  : ${report.artifacts.length} file(s) [${report.passed ? "PASS" : "DRIFT CONFLICT"}]`,
		...report.artifacts.map(
			(a) => `  [${a.action.toUpperCase()}] (${a.target}) ${a.relative_path}`,
		),
		...report.drift_conflicts.map(
			(cItem) =>
				`  [DRIFT CONFLICT] ${cItem} modified locally. Re-run with --force to overwrite.`,
		),
		usageBox,
		nextSteps,
	]
		.filter(Boolean)
		.join("\n");
}
