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
import { CHARM_PALETTE, fgHex } from "../ui/lipgloss.js";
import {
	formatActionBadge,
	formatBadge,
	padVisible,
	renderAiUsageGuide,
	renderHeaderBanner,
	renderNextSteps,
	renderSectionHeader,
	style,
} from "../ui/terminal.js";

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

interface SkippedTargetItem {
	readonly target: RuntimeTarget;
	readonly itemName: string;
	readonly relativePath: string;
	readonly sha256: string;
}

/**
 * Check whether a Skill or Subagent already exists on disk in a given target AI CLI / IDE directory.
 * Returns the relative path of the existing artifact if found, or `null` if not yet present.
 */
export function findExistingItemPathInTarget(
	resolvedRepo: string,
	itemName: string,
	kind: "skill" | "subagent",
	target: RuntimeTarget,
	plannedForTarget: readonly PlannedFile[] = [],
): string | null {
	for (const pf of plannedForTarget) {
		const fullPlanned = path.join(resolvedRepo, pf.relativePath);
		if (fs.existsSync(fullPlanned) && fs.statSync(fullPlanned).isFile()) {
			return pf.relativePath;
		}
	}

	const spec = RUNTIME_HARNESS_SPECS[target];
	const candidates: string[] =
		kind === "skill"
			? [
					`${spec.skillsDir}/${itemName}/SKILL.md`,
					`${spec.skillsDir}/${itemName}/RULE.md`,
					`${spec.skillsDir}/skillops-${itemName}.mdc`,
					`${spec.skillsDir}/${itemName}.mdc`,
					`${spec.skillsDir}/skillops-${itemName}.md`,
					`${spec.skillsDir}/${itemName}.md`,
					`${spec.skillsDir}/skillops-${itemName}.instructions.md`,
					`${spec.skillsDir}/${itemName}.instructions.md`,
				]
			: [
					`${spec.subagentsDir}/${itemName}.md`,
					`${spec.subagentsDir}/skillops-agent-${itemName}.md`,
					`${spec.subagentsDir}/${itemName}.agent.md`,
					`${spec.subagentsDir}/skillops-agent-${itemName}.mdc`,
					`${spec.subagentsDir}/${itemName}.mdc`,
					`${spec.subagentsDir}/skillops-agent-${itemName}.prompt`,
					`${spec.subagentsDir}/${itemName}.prompt`,
					`${spec.subagentsDir}/skillops-agent-${itemName}.toml`,
					`${spec.subagentsDir}/${itemName}.toml`,
					`${spec.subagentsDir}/skillops-agent-${itemName}.json`,
					`${spec.subagentsDir}/${itemName}.json`,
				];

	for (const relCandidate of candidates) {
		const fullCandidate = path.join(resolvedRepo, relCandidate);
		if (fs.existsSync(fullCandidate) && fs.statSync(fullCandidate).isFile()) {
			return relCandidate;
		}
	}

	if (kind === "skill") {
		const skillFolderRel = `${spec.skillsDir}/${itemName}`;
		const skillFolderFull = path.join(resolvedRepo, skillFolderRel);
		if (
			fs.existsSync(skillFolderFull) &&
			fs.statSync(skillFolderFull).isDirectory()
		) {
			const entries = fs.readdirSync(skillFolderFull);
			const firstFile = entries.find((entry) =>
				fs.statSync(path.join(skillFolderFull, entry)).isFile(),
			);
			if (firstFile) {
				return `${skillFolderRel}/${firstFile}`;
			}
		}
	}

	return null;
}

/**
 * Check which of the candidate target AI IDEs/CLIs already have a given Skill or Subagent present on disk.
 */
export function detectExistingTargetsForItem(
	repoPath: string,
	itemName: string,
	kind: "skill" | "subagent",
	candidateTargets: readonly RuntimeTarget[],
): RuntimeTarget[] {
	const resolvedRepo = path.resolve(repoPath);
	const existing: RuntimeTarget[] = [];
	for (const target of candidateTargets) {
		if (
			findExistingItemPathInTarget(resolvedRepo, itemName, kind, target) !==
			null
		) {
			existing.push(target);
		}
	}
	return existing;
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

	if (target === "augment") {
		const augFrontmatter = YAML.stringify({
			type: "agent_requested",
			description: parsed.manifest.description,
		}).trim();
		files.push({
			target,
			itemName: name,
			relativePath: `.augment/rules/skillops-${name}.md`,
			content: `---\n${augFrontmatter}\n---\n\n${body}\n`,
		});
		return files;
	}

	// Remaining markdown-rule harnesses: cline, roocode, kilocode, zed, continue, aider, trae, amazonq, junie, idx
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
		model: "inherit",
		model_tier: subagent.manifest.model_tier,
		tools: subagent.manifest.tools,
		max_output_tokens: subagent.manifest.max_output_tokens,
	}).trim();
	const normalizedDoc = `---\n${fm}\n---\n\n${promptBody}\n`;

	if (
		target === "claude" ||
		target === "antigravity" ||
		target === "gemini" ||
		target === "codex" ||
		target === "amp" ||
		target === "goose" ||
		target === "opencode" ||
		target === "qwen" ||
		target === "warp" ||
		target === "crush"
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

	if (target === "factory") {
		const droidFm = YAML.stringify({
			name,
			description: subagent.manifest.description,
			model: "inherit",
		}).trim();
		return [
			{
				target,
				itemName: name,
				relativePath: `.factory/droids/skillops-agent-${name}.md`,
				content: `---\n${droidFm}\n---\n\n${promptBody}\n`,
			},
		];
	}

	if (target === "vibe") {
		const escapedDesc = JSON.stringify(subagent.manifest.description);
		const escapedPrompt = JSON.stringify(promptBody);
		const tomlDoc = [
			`name = "${name}"`,
			`description = ${escapedDesc}`,
			`system_prompt = ${escapedPrompt}`,
			"",
		].join("\n");
		return [
			{
				target,
				itemName: name,
				relativePath: `.vibe/agents/skillops-agent-${name}.toml`,
				content: tomlDoc,
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
	plannedFiles: readonly PlannedFile[],
	options: {
		dryRun: boolean;
		force: boolean;
		preserveUnlistedLockEntries: boolean;
		skippedTargetItems?: readonly SkippedTargetItem[];
		addedSkillName?: string;
		addedSubagentName?: string;
	},
): SyncReport {
	const lockfilePath = path.join(resolvedRepo, ".skillops-lock.json");
	const existingLock = loadExistingLockfile(lockfilePath);
	const newLockArtifacts: Record<string, SyncLockEntry> =
		options.preserveUnlistedLockEntries
			? { ...(existingLock?.artifacts ?? {}) }
			: {};

	const artifacts: SyncedArtifact[] = [];
	const skippedExisting: string[] = [];
	const driftConflicts: string[] = [];

	for (const skipped of options.skippedTargetItems ?? []) {
		skippedExisting.push(skipped.relativePath);
		artifacts.push({
			target: skipped.target,
			skill_name: skipped.itemName,
			relative_path: skipped.relativePath,
			sha256: skipped.sha256,
			action: "skipped",
		});
		const previousEntry = existingLock?.artifacts[skipped.relativePath];
		if (previousEntry) {
			newLockArtifacts[skipped.relativePath] = previousEntry;
		}
	}

	for (const pf of plannedFiles) {
		const fullPath = path.join(resolvedRepo, pf.relativePath);
		const desiredSha = computeSha256(pf.content);
		const fileExists =
			fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();

		if (fileExists) {
			if (!options.force) {
				const currentDiskText = fs.readFileSync(fullPath, "utf-8");
				const currentDiskSha = computeSha256(currentDiskText);
				skippedExisting.push(pf.relativePath);
				artifacts.push({
					target: pf.target,
					skill_name: pf.itemName,
					relative_path: pf.relativePath,
					sha256: currentDiskSha,
					action: "skipped",
				});
				const previousEntry = existingLock?.artifacts[pf.relativePath];
				if (previousEntry) {
					newLockArtifacts[pf.relativePath] = previousEntry;
				}
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

	const hasWrittenArtifacts = artifacts.some(
		(a) => a.action === "created" || a.action === "updated",
	);

	// Write updated lockfile if not dry-run, no drift conflicts, and at least one file was created/updated (or lockfile already exists)
	if (
		!options.dryRun &&
		driftConflicts.length === 0 &&
		(hasWrittenArtifacts || existingLock !== null)
	) {
		const activeTargetsForItem = artifacts
			.filter((a) => a.action === "created" || a.action === "updated")
			.map((a) => a.target);
		const mergedTargets = [
			...new Set<RuntimeTarget>([
				...(existingLock?.targets ?? []),
				...activeTargetsForItem,
			]),
		];
		const mergedSkills = [
			...new Set<string>([
				...(existingLock?.selected_skills ?? []),
				...(hasWrittenArtifacts && options.addedSkillName
					? [options.addedSkillName]
					: []),
			]),
		];
		const mergedSubagents = [
			...new Set<string>([
				...(existingLock?.selected_subagents ?? []),
				...(hasWrittenArtifacts && options.addedSubagentName
					? [options.addedSubagentName]
					: []),
			]),
		];

		const lockData: SyncLockfile = SyncLockfileSchema.parse({
			schema_version: "1.0",
			skillops_version: SKILLOPS_VERSION,
			targets: mergedTargets,
			selected_skills: mergedSkills,
			selected_subagents: mergedSubagents,
			total_l1_tokens: existingLock?.total_l1_tokens ?? 0,
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
		artifacts,
		skipped_existing: skippedExisting,
		drift_conflicts: driftConflicts,
		lockfile_path: lockfilePath.replace(/\\/g, "/"),
		passed: driftConflicts.length === 0,
	});
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
	const skippedTargetItems: SkippedTargetItem[] = [];
	const itemKind: "skill" | "subagent" = matchedSkill ? "skill" : "subagent";

	for (const target of targets) {
		const targetPlanned = matchedSkill
			? renderSkillFilesForRuntime(matchedSkill, target)
			: renderSubagentFilesForRuntime(matchedSubagent!, target);

		if (!force) {
			const existingRelPath = findExistingItemPathInTarget(
				resolvedRepo,
				itemName,
				itemKind,
				target,
				targetPlanned,
			);
			if (existingRelPath !== null) {
				const existingFull = path.join(resolvedRepo, existingRelPath);
				const diskSha =
					fs.existsSync(existingFull) && fs.statSync(existingFull).isFile()
						? computeSha256(fs.readFileSync(existingFull, "utf-8"))
						: computeSha256("");
				skippedTargetItems.push({
					target,
					itemName,
					relativePath: existingRelPath,
					sha256: diskSha,
				});
				continue;
			}
		}

		plannedFiles.push(...targetPlanned);
	}

	return applyPlannedFiles(
		resolvedRepo,
		resolvedCatalog,
		targets,
		plannedFiles,
		{
			dryRun,
			force,
			preserveUnlistedLockEntries: true,
			skippedTargetItems,
			addedSkillName: matchedSkill?.manifest.name,
			addedSubagentName: matchedSubagent?.manifest.name,
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
			`No .skillops-lock.json found in '${resolvedRepo.replace(/\\/g, "/")}'. Run 'add' first.`,
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

	return SyncReportSchema.parse({
		repo_path: resolvedRepo.replace(/\\/g, "/"),
		catalog_path: resolvedCatalog.replace(/\\/g, "/"),
		targets: targetFilter ? [...targetFilter] : existingLock.targets,
		dry_run: dryRun,
		force,
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

	if (!existingLock) {
		return SyncReportSchema.parse({
			repo_path: resolvedRepo.replace(/\\/g, "/"),
			catalog_path: resolvedCatalog.replace(/\\/g, "/"),
			targets: [...ALL_RUNTIME_TARGETS],
			dry_run: dryRun,
			force,
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
			`- **Skipped (Already Exists)**: \`${report.skipped_existing.length}\``,
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
	const bar = style.dim("│", c);
	const activeArtifacts = report.artifacts.filter(
		(a) =>
			a.action === "created" ||
			a.action === "updated" ||
			a.action === "unchanged",
	);
	const isRemoval =
		report.artifacts.length > 0 &&
		report.artifacts.every((a) => a.action === "removed");
	const isAllSkipped =
		report.artifacts.length > 0 &&
		report.artifacts.every((a) => a.action === "skipped");
	const subtitle = !report.passed
		? "Drift Conflict Detected"
		: report.dry_run
			? "Dry-Run Sync Preview"
			: isRemoval
				? "Skills & Subagents Removed"
				: isAllSkipped
					? "Skills & Subagents Skipped (Already Installed)"
					: "Skills & Subagents Installed";

	const banner = renderHeaderBanner(subtitle, { colorEnabled: c });

	const counts = {
		created: 0,
		updated: 0,
		removed: 0,
		unchanged: 0,
		skipped: 0,
		planned: 0,
		conflict: 0,
	};
	for (const a of report.artifacts) {
		counts[a.action] += 1;
	}
	const countParts: string[] = [];
	if (counts.created > 0) countParts.push(`${counts.created} created`);
	if (counts.updated > 0) countParts.push(`${counts.updated} updated`);
	if (counts.skipped > 0) countParts.push(`${counts.skipped} skipped`);
	if (counts.removed > 0) countParts.push(`${counts.removed} removed`);
	if (counts.planned > 0) countParts.push(`${counts.planned} planned`);
	if (counts.unchanged > 0) countParts.push(`${counts.unchanged} kept`);
	if (counts.conflict > 0) countParts.push(`${counts.conflict} conflict`);
	const breakdown =
		countParts.length > 0 ? style.dim(` (${countParts.join(", ")})`, c) : "";

	const statusBadge = report.passed
		? formatBadge("pass", report.dry_run ? "DRY-RUN" : "PASS", c)
		: formatBadge("fail", "DRIFT CONFLICT", c);
	const statusLine = `${bar}  ${padVisible(fgHex(CHARM_PALETTE.lavender, style.bold("Status:", c), c), 10, "left")}${statusBadge} ${style.dim("·", c)} ${fgHex(CHARM_PALETTE.white, `${report.artifacts.length} file(s)`, c)}${breakdown}`;

	const visibleTargets =
		report.targets.length <= 5
			? report.targets
					.map((t) => style.bold(style.cyan(t, c), c))
					.join(style.dim(", ", c))
			: `${report.targets
					.slice(0, 4)
					.map((t) => style.bold(style.cyan(t, c), c))
					.join(
						style.dim(", ", c),
					)} ${fgHex(CHARM_PALETTE.lavender, `+${report.targets.length - 4} more (${report.targets.length} IDEs)`, c)}`;
	const targetsLine = `${bar}  ${padVisible(fgHex(CHARM_PALETTE.lavender, style.bold("Targets:", c), c), 10, "left")}${visibleTargets}`;

	const maxDisplayed = 12;
	const shownArtifacts = report.artifacts.slice(0, maxDisplayed);
	const hiddenCount = Math.max(0, report.artifacts.length - maxDisplayed);

	const artifactLines: string[] = [
		renderSectionHeader(`Runtime Artifacts (${report.artifacts.length})`, c),
	];
	if (report.artifacts.length === 0) {
		artifactLines.push(`${bar}  ${style.dim("No runtime files matched.", c)}`);
	} else {
		for (const a of shownArtifacts) {
			const badge = formatActionBadge(a.action, c);
			const targetCol = padVisible(
				fgHex(CHARM_PALETTE.cyan, style.bold(`(${a.target})`, c), c),
				13,
				"left",
			);
			const maxPathCols = 47;
			const shortPath =
				a.relative_path.length > maxPathCols
					? `…${a.relative_path.slice(-(maxPathCols - 1))}`
					: a.relative_path;
			const styledPath =
				a.action === "conflict"
					? fgHex(CHARM_PALETTE.coral, shortPath, c)
					: a.action === "removed" || a.action === "skipped"
						? fgHex(CHARM_PALETTE.lavender, shortPath, c)
						: fgHex(CHARM_PALETTE.white, shortPath, c);
			artifactLines.push(`${bar}  ${badge} ${targetCol} ${styledPath}`);
		}
		if (hiddenCount > 0) {
			artifactLines.push(
				`${bar}  ${fgHex(CHARM_PALETTE.lavender, `… and ${hiddenCount} more runtime file(s) across ${report.targets.length} AI IDEs`, c)}`,
			);
		}
	}

	const skippedArtifacts = report.artifacts.filter(
		(a) => a.action === "skipped",
	);
	const skippedLines: string[] = [];
	if (skippedArtifacts.length > 0) {
		skippedLines.push(
			renderSectionHeader(
				`Skipped — Already Exists (${skippedArtifacts.length})`,
				c,
			),
		);
		for (const sItem of skippedArtifacts) {
			const shortRel =
				sItem.relative_path.length > 48
					? `…${sItem.relative_path.slice(-47)}`
					: sItem.relative_path;
			skippedLines.push(
				`${bar}  ${formatBadge("warn", "SKIPPED", c)} ${fgHex(CHARM_PALETTE.cyan, style.bold(`(${sItem.target})`, c), c)} ${fgHex(CHARM_PALETTE.white, sItem.skill_name, c)} ${style.dim(`already exists at ${shortRel}`, c)}`,
			);
		}
		skippedLines.push(
			`${bar}  ${fgHex(CHARM_PALETTE.lavender, "Existing files were preserved and not overwritten. Pass --force to replace them.", c)}`,
		);
	}

	const conflictLines: string[] = [];
	if (report.drift_conflicts.length > 0) {
		conflictLines.push(renderSectionHeader("Drift Conflicts", c));
		for (const cItem of report.drift_conflicts) {
			const shortItem =
				cItem.length > 52 ? `…${cItem.slice(-51)}` : cItem;
			conflictLines.push(
				`${bar}  ${formatBadge("fail", "DRIFT", c)} ${fgHex(CHARM_PALETTE.coral, shortItem, c)}`,
			);
		}
		conflictLines.push(
			`${bar}  ${fgHex(CHARM_PALETTE.amber, "Local changes detected. Re-run with --force to overwrite.", c)}`,
		);
	}

	const isSubagentArtifact = (relPath: string): boolean =>
		relPath.includes("/agents/") ||
		relPath.includes("skillops-agent-") ||
		relPath.endsWith(".agent.md");

	const firstSkill =
		activeArtifacts.find(
			(a) =>
				a.skill_name !== "codex-agents-index" &&
				!isSubagentArtifact(a.relative_path),
		)?.skill_name ?? "mcp-architect";
	const firstAgent =
		activeArtifacts.find((a) => isSubagentArtifact(a.relative_path))
			?.skill_name ?? "context-scout";

	const usageBox =
		activeArtifacts.length > 0
			? renderAiUsageGuide(report.targets, [firstSkill], [firstAgent], c)
			: "";

	const nextSteps = renderNextSteps(
		[
			{
				command: "npx skillops-cli add",
				description: "Install more Skills or Subagents",
			},
			{
				command: "npx skillops-cli remove",
				description: "Remove installed Skills or Subagents",
			},
		],
		c,
	);

	return [
		banner,
		statusLine,
		targetsLine,
		...artifactLines,
		...skippedLines,
		...conflictLines,
		usageBox,
		nextSteps,
	]
		.filter(Boolean)
		.join("\n");
}
