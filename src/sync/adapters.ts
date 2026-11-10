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
import os from "node:os";
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
import { CHARM_PALETTE, fgHex, renderPill } from "../ui/lipgloss.js";
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

export type ArtifactHealthState =
	| "up_to_date"
	| "update_available"
	| "drift_modified"
	| "missing_on_disk"
	| "untracked_on_disk";

export interface StatusOptions {
	readonly targets?: readonly RuntimeTarget[];
}

export interface UpdateOptions {
	readonly targets?: readonly RuntimeTarget[];
	readonly names?: readonly string[];
	readonly dryRun?: boolean;
	readonly force?: boolean;
}

export interface InstalledArtifactStatus {
	readonly target: RuntimeTarget;
	readonly itemName: string;
	readonly kind: "skill" | "subagent";
	readonly relativePath: string;
	readonly state: ArtifactHealthState;
	readonly lockfileSha256: string | null;
	readonly diskSha256: string | null;
	readonly catalogSha256: string | null;
}

export interface ProjectStatusReport {
	readonly repo_path: string;
	readonly catalog_path: string;
	readonly lockfile_path: string;
	readonly lockfile_present: boolean;
	readonly targets: RuntimeTarget[];
	readonly installed_skills: string[];
	readonly installed_subagents: string[];
	readonly artifacts: InstalledArtifactStatus[];
	readonly counts: {
		readonly up_to_date: number;
		readonly update_available: number;
		readonly drift_modified: number;
		readonly missing_on_disk: number;
		readonly untracked_on_disk: number;
	};
	readonly passed: boolean;
}

export interface DiscoveredInstalledArtifact {
	readonly target: RuntimeTarget;
	readonly itemName: string;
	readonly kind: "skill" | "subagent";
	readonly relativePath: string;
	readonly sha256: string;
	readonly fromLockfile: boolean;
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

function rewriteBundledSkillPaths(
	text: string,
	parsed: ParsedSkillDirectory,
	baseDir: string,
): string {
	const name = parsed.manifest.name;
	const track = parsed.manifest.track;
	const catalogPrefix = `catalog/${track}/${name}/`;
	return text.split(catalogPrefix).join(`${baseDir}/`);
}

function appendCompanionSkillFiles(
	files: PlannedFile[],
	parsed: ParsedSkillDirectory,
	target: RuntimeTarget,
	baseDir: string,
): void {
	const name = parsed.manifest.name;
	for (const relFile of parsed.allFiles) {
		if (relFile === "SKILL.md") {
			continue;
		}
		const fullFile = path.join(parsed.skillDir, relFile);
		if (!fs.existsSync(fullFile) || !fs.statSync(fullFile).isFile()) {
			continue;
		}
		files.push({
			target,
			itemName: name,
			relativePath: `${baseDir}/${relFile}`,
			content: fs.readFileSync(fullFile, "utf-8"),
		});
	}
}

export function renderSkillFilesForRuntime(
	parsed: ParsedSkillDirectory,
	target: RuntimeTarget,
): PlannedFile[] {
	const name = parsed.manifest.name;
	const spec = RUNTIME_HARNESS_SPECS[target];
	const baseDir = `${spec.skillsDir}/${name}`;
	const files: PlannedFile[] = [];
	const globs =
		parsed.manifest.routing_signals.files_any.length > 0
			? parsed.manifest.routing_signals.files_any
			: ["**/*"];
	const body = rewriteBundledSkillPaths(
		parsed.markdownBody.trim(),
		parsed,
		baseDir,
	);

	if (spec.skillFormat === "progressive-skill-dir") {
		files.push({
			target,
			itemName: name,
			relativePath: `${baseDir}/SKILL.md`,
			content: rewriteBundledSkillPaths(parsed.rawText, parsed, baseDir),
		});
		appendCompanionSkillFiles(files, parsed, target, baseDir);
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
		appendCompanionSkillFiles(files, parsed, target, baseDir);
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
		appendCompanionSkillFiles(files, parsed, target, baseDir);
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
		appendCompanionSkillFiles(files, parsed, target, baseDir);
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
		appendCompanionSkillFiles(files, parsed, target, baseDir);
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
		appendCompanionSkillFiles(files, parsed, target, baseDir);
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
		appendCompanionSkillFiles(files, parsed, target, baseDir);
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
	appendCompanionSkillFiles(files, parsed, target, baseDir);

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

function collectFilesRecursively(
	dirFullPath: string,
	resolvedRepo: string,
): string[] {
	if (!fs.existsSync(dirFullPath) || !fs.statSync(dirFullPath).isDirectory()) {
		return [];
	}
	const results: string[] = [];
	const entries = fs.readdirSync(dirFullPath, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.isFile()) {
			const fullEntry = path.join(dirFullPath, entry.name);
			results.push(path.relative(resolvedRepo, fullEntry).replace(/\\/g, "/"));
		}
	}
	for (const entry of entries) {
		if (entry.isDirectory()) {
			const fullEntry = path.join(dirFullPath, entry.name);
			results.push(...collectFilesRecursively(fullEntry, resolvedRepo));
		}
	}
	return results;
}

function removeEmptyDirsRecursively(dirFullPath: string): void {
	if (!fs.existsSync(dirFullPath) || !fs.statSync(dirFullPath).isDirectory()) {
		return;
	}
	for (const entry of fs.readdirSync(dirFullPath, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			removeEmptyDirsRecursively(path.join(dirFullPath, entry.name));
		}
	}
	try {
		if (fs.readdirSync(dirFullPath).length === 0) {
			fs.rmdirSync(dirFullPath);
		}
	} catch {
		// Ignore
	}
}

/**
 * Inspect the 28 supported `RUNTIME_HARNESS_SPECS` directories on disk in `repoPath`
 * and merge discovered Skills and Subagents with any entries tracked in `.skillops-lock.json`.
 */
export function discoverInstalledArtifactsOnDisk(
	repoPath: string,
	catalogDir: string,
	targetFilter?: readonly RuntimeTarget[],
): DiscoveredInstalledArtifact[] {
	const resolvedRepo = path.resolve(repoPath);
	const resolvedCatalog = path.resolve(catalogDir);
	const candidateTargets: readonly RuntimeTarget[] =
		targetFilter && targetFilter.length > 0
			? targetFilter
			: ALL_RUNTIME_TARGETS;
	const targetSet = new Set<RuntimeTarget>(candidateTargets);

	const knownSkills = new Set<string>();
	const knownSubagents = new Set<string>();

	if (fs.existsSync(resolvedCatalog)) {
		for (const skillDir of discoverSkillDirectories(resolvedCatalog)) {
			try {
				const parsed = parseSkillDirectory(skillDir, { requireLayout: false });
				knownSkills.add(parsed.manifest.name);
			} catch {
				// Ignore
			}
		}
		for (const saPath of discoverSubagentFiles(resolvedCatalog)) {
			try {
				const parsed = parseSubagentFile(saPath);
				knownSubagents.add(parsed.manifest.name);
			} catch {
				// Ignore
			}
		}
	}

	const lockfilePath = path.join(resolvedRepo, ".skillops-lock.json");
	const existingLock = loadExistingLockfile(lockfilePath);
	for (const s of existingLock?.selected_skills ?? []) {
		knownSkills.add(s);
	}
	for (const sa of existingLock?.selected_subagents ?? []) {
		knownSubagents.add(sa);
	}

	const byRelPath = new Map<string, DiscoveredInstalledArtifact>();

	const inferLockKind = (
		itemName: string,
		relPath: string,
	): "skill" | "subagent" => {
		if (knownSubagents.has(itemName)) {
			return "subagent";
		}
		if (knownSkills.has(itemName)) {
			return "skill";
		}
		if (
			relPath.includes("/agents/") ||
			relPath.includes("/droids/") ||
			relPath.includes("/cli-agents/") ||
			relPath.includes("skillops-agent-") ||
			relPath.endsWith(".agent.md") ||
			relPath.endsWith(".prompt")
		) {
			return "subagent";
		}
		return "skill";
	};

	if (existingLock) {
		for (const [relPath, entry] of Object.entries(existingLock.artifacts)) {
			if (entry.skill_name === "codex-agents-index") {
				continue;
			}
			if (!targetSet.has(entry.target)) {
				continue;
			}
			const normalizedRel = relPath.replace(/\\/g, "/");
			byRelPath.set(normalizedRel, {
				target: entry.target,
				itemName: entry.skill_name,
				kind: inferLockKind(entry.skill_name, normalizedRel),
				relativePath: normalizedRel,
				sha256: entry.sha256,
				fromLockfile: true,
			});
		}
	}

	const addDiskFile = (
		target: RuntimeTarget,
		itemName: string,
		kind: "skill" | "subagent",
		relPath: string,
	): void => {
		const normalizedRel = relPath.replace(/\\/g, "/");
		if (byRelPath.has(normalizedRel)) {
			return;
		}
		const fullPath = path.join(resolvedRepo, normalizedRel);
		if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
			return;
		}
		const sha256 = computeSha256(fs.readFileSync(fullPath, "utf-8"));
		byRelPath.set(normalizedRel, {
			target,
			itemName,
			kind,
			relativePath: normalizedRel,
			sha256,
			fromLockfile: false,
		});
	};

	for (const target of candidateTargets) {
		const spec = RUNTIME_HARNESS_SPECS[target];

		// 1. Scan skills directory for this target
		const skillsDirFull = path.join(resolvedRepo, spec.skillsDir);
		if (
			fs.existsSync(skillsDirFull) &&
			fs.statSync(skillsDirFull).isDirectory()
		) {
			const entries = fs.readdirSync(skillsDirFull, { withFileTypes: true });
			for (const entry of entries) {
				const entryFull = path.join(skillsDirFull, entry.name);
				if (entry.isDirectory()) {
					// Ignore subagent subdirectories when skillsDir is a parent of subagentsDir (e.g. .clinerules/workflows)
					const relDir = path
						.relative(resolvedRepo, entryFull)
						.replace(/\\/g, "/");
					if (relDir === spec.subagentsDir) {
						continue;
					}
					const nestedFiles = collectFilesRecursively(entryFull, resolvedRepo);
					for (const nf of nestedFiles) {
						addDiskFile(target, entry.name, "skill", nf);
					}
					continue;
				}
				if (!entry.isFile()) {
					continue;
				}
				const fileName = entry.name;
				const relFile = path
					.relative(resolvedRepo, entryFull)
					.replace(/\\/g, "/");

				if (target === "copilot") {
					const copilotMatch =
						/^skillops-(.+)\.instructions\.md$/.exec(fileName) ??
						/^(.+)\.instructions\.md$/.exec(fileName);
					if (copilotMatch?.[1]) {
						const itemName = copilotMatch[1];
						if (
							fileName.startsWith("skillops-") ||
							knownSkills.has(itemName)
						) {
							addDiskFile(target, itemName, "skill", relFile);
						}
					}
					continue;
				}

				if (target === "cursor") {
					const cursorAgentMatch = /^skillops-agent-(.+)\.mdc$/.exec(fileName);
					if (cursorAgentMatch?.[1]) {
						addDiskFile(target, cursorAgentMatch[1], "subagent", relFile);
						continue;
					}
					const cursorSkillMatch = /^skillops-(.+)\.mdc$/.exec(fileName);
					if (cursorSkillMatch?.[1]) {
						addDiskFile(target, cursorSkillMatch[1], "skill", relFile);
						continue;
					}
					const plainMdc = /^(.+)\.mdc$/.exec(fileName);
					if (plainMdc?.[1]) {
						if (knownSkills.has(plainMdc[1])) {
							addDiskFile(target, plainMdc[1], "skill", relFile);
						} else if (knownSubagents.has(plainMdc[1])) {
							addDiskFile(target, plainMdc[1], "subagent", relFile);
						}
					}
					continue;
				}

				const mdAgentMatch = /^skillops-agent-(.+)\.md$/.exec(fileName);
				if (mdAgentMatch?.[1]) {
					addDiskFile(target, mdAgentMatch[1], "subagent", relFile);
					continue;
				}
				const mdSkillMatch = /^skillops-(.+)\.md$/.exec(fileName);
				if (mdSkillMatch?.[1]) {
					addDiskFile(target, mdSkillMatch[1], "skill", relFile);
					continue;
				}
				const plainMd = /^(.+)\.md$/.exec(fileName);
				if (plainMd?.[1]) {
					if (knownSkills.has(plainMd[1])) {
						addDiskFile(target, plainMd[1], "skill", relFile);
					} else if (
						spec.subagentsDir === spec.skillsDir &&
						knownSubagents.has(plainMd[1])
					) {
						addDiskFile(target, plainMd[1], "subagent", relFile);
					}
				}
			}
		}

		// Copilot also writes .github/prompts/skillops-<name>.prompt.md for skills
		if (target === "copilot") {
			const copilotPromptsDir = path.join(resolvedRepo, ".github", "prompts");
			if (
				fs.existsSync(copilotPromptsDir) &&
				fs.statSync(copilotPromptsDir).isDirectory()
			) {
				for (const entry of fs.readdirSync(copilotPromptsDir, {
					withFileTypes: true,
				})) {
					if (!entry.isFile()) continue;
					const m =
						/^skillops-(.+)\.prompt\.md$/.exec(entry.name) ??
						/^(.+)\.prompt\.md$/.exec(entry.name);
					if (
						m?.[1] &&
						(entry.name.startsWith("skillops-") || knownSkills.has(m[1]))
					) {
						const relFile = `.github/prompts/${entry.name}`;
						addDiskFile(target, m[1], "skill", relFile);
					}
				}
			}
		}

		// 2. Scan subagents directory for this target
		const subagentsDirFull = path.join(resolvedRepo, spec.subagentsDir);
		if (
			fs.existsSync(subagentsDirFull) &&
			fs.statSync(subagentsDirFull).isDirectory()
		) {
			const entries = fs.readdirSync(subagentsDirFull, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isFile()) {
					continue;
				}
				const fileName = entry.name;
				const relFile = path
					.relative(resolvedRepo, path.join(subagentsDirFull, fileName))
					.replace(/\\/g, "/");

				const prefixedMatch =
					/^skillops-agent-(.+)\.(md|mdc|prompt|toml|json)$/.exec(fileName);
				if (prefixedMatch?.[1]) {
					addDiskFile(target, prefixedMatch[1], "subagent", relFile);
					continue;
				}

				const copilotAgentMatch = /^(.+)\.agent\.md$/.exec(fileName);
				if (copilotAgentMatch?.[1]) {
					addDiskFile(target, copilotAgentMatch[1], "subagent", relFile);
					continue;
				}

				if (spec.subagentsDir !== spec.skillsDir) {
					const directMatch = /^(.+)\.(md|mdc|prompt|toml|json)$/.exec(
						fileName,
					);
					if (
						directMatch?.[1] &&
						!fileName.startsWith("skillops-") &&
						fileName.toLowerCase() !== "readme.md"
					) {
						addDiskFile(target, directMatch[1], "subagent", relFile);
					}
				}
			}
		}
	}

	return [...byRelPath.values()];
}

/**
 * Resolve a repository-relative path and enforce strict containment inside `resolvedRepo`,
 * rejecting null bytes, absolute paths, `..` traversal, and symbolic link targets.
 */
export function resolveSafeRepoTargetPath(
	resolvedRepo: string,
	relativePath: string,
): string {
	const cleanRoot = path.resolve(resolvedRepo);
	if (
		!relativePath ||
		relativePath.includes("\0") ||
		path.isAbsolute(relativePath)
	) {
		throw new Error(
			`Security violation: Planned artifact path '${relativePath}' escapes target repository boundary '${cleanRoot.replace(/\\/g, "/")}'.`,
		);
	}
	const fullPath = path.resolve(cleanRoot, relativePath);
	const relToRepo = path.relative(cleanRoot, fullPath);
	if (!relToRepo || relToRepo.startsWith("..") || path.isAbsolute(relToRepo)) {
		throw new Error(
			`Security violation: Planned artifact path '${relativePath}' escapes target repository boundary '${cleanRoot.replace(/\\/g, "/")}'.`,
		);
	}
	if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isSymbolicLink()) {
		throw new Error(
			`Security violation: Refusing to write or remove symbolic link at '${relativePath}'.`,
		);
	}
	return fullPath;
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
		const fullPath = resolveSafeRepoTargetPath(resolvedRepo, pf.relativePath);
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
		currentDir !== normalizedStop
	) {
		if (!fs.existsSync(currentDir)) {
			currentDir = path.dirname(currentDir);
			continue;
		}
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
 * Works both with `.skillops-lock.json` and by scanning AI IDE/CLI folders on disk directly.
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

	const discovered = discoverInstalledArtifactsOnDisk(
		resolvedRepo,
		resolvedCatalog,
		options.targets,
	);
	const matchingMap = new Map<string, DiscoveredInstalledArtifact>();
	for (const d of discovered) {
		if (d.itemName === itemName) {
			matchingMap.set(d.relativePath, d);
		}
	}

	// Fallback check via findExistingItemPathInTarget for custom/unindexed file names matching itemName
	const candidateTargets: readonly RuntimeTarget[] = options.targets?.length
		? options.targets
		: ALL_RUNTIME_TARGETS;
	for (const target of candidateTargets) {
		for (const kind of ["skill", "subagent"] as const) {
			const foundRel = findExistingItemPathInTarget(
				resolvedRepo,
				itemName,
				kind,
				target,
			);
			if (foundRel) {
				const normalizedRel = foundRel.replace(/\\/g, "/");
				if (!matchingMap.has(normalizedRel)) {
					const fullFound = path.join(resolvedRepo, normalizedRel);
					if (fs.existsSync(fullFound) && fs.statSync(fullFound).isFile()) {
						const sha256 = computeSha256(fs.readFileSync(fullFound, "utf-8"));
						matchingMap.set(normalizedRel, {
							target,
							itemName,
							kind,
							relativePath: normalizedRel,
							sha256,
							fromLockfile: false,
						});
					}
				}
			}
		}
	}

	const matchingEntries = [...matchingMap.values()];

	if (matchingEntries.length === 0) {
		throw new Error(
			`No installed artifacts found for '${itemName}' in '${resolvedRepo.replace(/\\/g, "/")}'.`,
		);
	}

	const newLockArtifacts: Record<string, SyncLockEntry> = {
		...(existingLock?.artifacts ?? {}),
	};
	const artifacts: SyncedArtifact[] = [];
	const driftConflicts: string[] = [];

	for (const entry of matchingEntries) {
		const relPath = entry.relativePath;
		const fullPath = resolveSafeRepoTargetPath(resolvedRepo, relPath);
		const fileExists =
			fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();

		if (fileExists) {
			const currentDiskSha = computeSha256(fs.readFileSync(fullPath, "utf-8"));
			if (entry.fromLockfile && currentDiskSha !== entry.sha256 && !force) {
				driftConflicts.push(relPath);
				artifacts.push({
					target: entry.target,
					skill_name: entry.itemName,
					relative_path: relPath,
					sha256: currentDiskSha,
					action: "conflict",
				});
				continue;
			}

			if (!dryRun) {
				fs.unlinkSync(fullPath);
				const spec = RUNTIME_HARNESS_SPECS[entry.target];
				const skillFolderFull = path.join(
					resolvedRepo,
					spec.skillsDir,
					entry.itemName,
				);
				removeEmptyDirsRecursively(skillFolderFull);
				pruneEmptyParentDirs(fullPath, resolvedRepo);
			}
		}

		artifacts.push({
			target: entry.target,
			skill_name: entry.itemName,
			relative_path: relPath,
			sha256: entry.sha256,
			action: dryRun ? "planned" : "removed",
		});
		delete newLockArtifacts[relPath];
	}

	if (existingLock && !dryRun && driftConflicts.length === 0) {
		const remainingForSkill = Object.values(newLockArtifacts).some(
			(e) => e.skill_name === itemName,
		);
		const remainingTargetSet = new Set<RuntimeTarget>(
			Object.values(newLockArtifacts).map((e) => e.target),
		);
		const updatedTargets = existingLock.targets.filter((t) =>
			remainingTargetSet.has(t),
		);
		const updatedSkills = remainingForSkill
			? existingLock.selected_skills
			: existingLock.selected_skills.filter((s) => s !== itemName);
		const updatedSubagents = remainingForSkill
			? existingLock.selected_subagents
			: existingLock.selected_subagents.filter((sa) => sa !== itemName);

		const lockData: SyncLockfile = SyncLockfileSchema.parse({
			...existingLock,
			skillops_version: SKILLOPS_VERSION,
			targets: updatedTargets,
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

	const affectedTargets = [
		...new Set<RuntimeTarget>(matchingEntries.map((e) => e.target)),
	];
	const reportTargets = targetFilter
		? [...targetFilter]
		: existingLock
			? [
					...new Set<RuntimeTarget>([
						...existingLock.targets,
						...affectedTargets,
					]),
				]
			: affectedTargets;

	return SyncReportSchema.parse({
		repo_path: resolvedRepo.replace(/\\/g, "/"),
		catalog_path: resolvedCatalog.replace(/\\/g, "/"),
		targets: reportTargets,
		dry_run: dryRun,
		force,
		artifacts,
		drift_conflicts: driftConflicts,
		lockfile_path: lockfilePath.replace(/\\/g, "/"),
		passed: driftConflicts.length === 0,
	});
}

/**
 * Clean all SkillOps-managed runtime artifacts tracked in `.skillops-lock.json` or present on disk.
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
	const discovered = discoverInstalledArtifactsOnDisk(
		resolvedRepo,
		resolvedCatalog,
	);

	if (!existingLock && discovered.length === 0) {
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

	// Handle codex AGENTS.md block if tracked in lockfile
	const codexIndexEntry = existingLock?.artifacts["AGENTS.md"];
	if (codexIndexEntry && codexIndexEntry.skill_name === "codex-agents-index") {
		const fullAgentsMd = path.join(resolvedRepo, "AGENTS.md");
		if (fs.existsSync(fullAgentsMd) && fs.statSync(fullAgentsMd).isFile()) {
			const diskText = fs.readFileSync(fullAgentsMd, "utf-8");
			const currentDiskSha = computeSha256(diskText);
			if (currentDiskSha !== codexIndexEntry.sha256 && !force) {
				driftConflicts.push("AGENTS.md");
				artifacts.push({
					target: codexIndexEntry.target,
					skill_name: codexIndexEntry.skill_name,
					relative_path: "AGENTS.md",
					sha256: currentDiskSha,
					action: "conflict",
				});
			} else {
				if (!dryRun) {
					const stripped = stripCodexAgentsBlock(diskText);
					if (stripped) {
						fs.writeFileSync(fullAgentsMd, stripped, "utf-8");
					} else {
						fs.unlinkSync(fullAgentsMd);
					}
				}
				artifacts.push({
					target: codexIndexEntry.target,
					skill_name: codexIndexEntry.skill_name,
					relative_path: "AGENTS.md",
					sha256: codexIndexEntry.sha256,
					action: dryRun ? "planned" : "removed",
				});
			}
		}
	}

	for (const entry of discovered) {
		const relPath = entry.relativePath;
		const fullPath = resolveSafeRepoTargetPath(resolvedRepo, relPath);
		const fileExists =
			fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();

		if (fileExists) {
			const diskText = fs.readFileSync(fullPath, "utf-8");
			const currentDiskSha = computeSha256(diskText);
			if (entry.fromLockfile && currentDiskSha !== entry.sha256 && !force) {
				driftConflicts.push(relPath);
				artifacts.push({
					target: entry.target,
					skill_name: entry.itemName,
					relative_path: relPath,
					sha256: currentDiskSha,
					action: "conflict",
				});
				continue;
			}

			if (!dryRun) {
				fs.unlinkSync(fullPath);
				const spec = RUNTIME_HARNESS_SPECS[entry.target];
				const skillFolderFull = path.join(
					resolvedRepo,
					spec.skillsDir,
					entry.itemName,
				);
				removeEmptyDirsRecursively(skillFolderFull);
				pruneEmptyParentDirs(fullPath, resolvedRepo);
			}
		}

		artifacts.push({
			target: entry.target,
			skill_name: entry.itemName,
			relative_path: relPath,
			sha256: entry.sha256,
			action: dryRun ? "planned" : "removed",
		});
	}

	if (!dryRun && driftConflicts.length === 0 && fs.existsSync(lockfilePath)) {
		fs.unlinkSync(lockfilePath);
	}

	const affectedTargets = [
		...new Set<RuntimeTarget>(discovered.map((d) => d.target)),
	];
	const reportTargets = existingLock
		? [...new Set<RuntimeTarget>([...existingLock.targets, ...affectedTargets])]
		: affectedTargets.length > 0
			? affectedTargets
			: [...ALL_RUNTIME_TARGETS];

	return SyncReportSchema.parse({
		repo_path: resolvedRepo.replace(/\\/g, "/"),
		catalog_path: resolvedCatalog.replace(/\\/g, "/"),
		targets: reportTargets,
		dry_run: dryRun,
		force,
		artifacts,
		drift_conflicts: driftConflicts,
		lockfile_path: lockfilePath.replace(/\\/g, "/"),
		passed: driftConflicts.length === 0,
	});
}

function loadCatalogMaps(resolvedCatalog: string): {
	skills: Map<string, ParsedSkillDirectory>;
	subagents: Map<string, ParsedSubagentFile>;
} {
	const skills = new Map<string, ParsedSkillDirectory>();
	const subagents = new Map<string, ParsedSubagentFile>();
	if (!fs.existsSync(resolvedCatalog)) {
		return { skills, subagents };
	}
	for (const skillDir of discoverSkillDirectories(resolvedCatalog)) {
		try {
			const parsed = parseSkillDirectory(skillDir, { requireLayout: false });
			skills.set(parsed.manifest.name, parsed);
		} catch {
			// Ignore invalid catalog skill during status/update scan
		}
	}
	for (const saPath of discoverSubagentFiles(resolvedCatalog)) {
		try {
			const parsed = parseSubagentFile(saPath);
			subagents.set(parsed.manifest.name, parsed);
		} catch {
			// Ignore invalid catalog subagent during status/update scan
		}
	}
	return { skills, subagents };
}

/**
 * Inspect installed Skills and Subagents in a repository (or global `~` scope),
 * combining `.skillops-lock.json` and on-disk runtime directories to classify
 * each artifact's health and SHA-256 drift state (Issue #200).
 */
export function inspectProjectStatus(
	repoPath: string,
	catalogDir: string,
	options: StatusOptions = {},
): ProjectStatusReport {
	const resolvedRepo = path.resolve(repoPath);
	const resolvedCatalog = path.resolve(catalogDir);
	const lockfilePath = path.join(resolvedRepo, ".skillops-lock.json");
	const existingLock = loadExistingLockfile(lockfilePath);

	const discovered = discoverInstalledArtifactsOnDisk(
		resolvedRepo,
		resolvedCatalog,
		options.targets,
	);
	const catalogMaps = loadCatalogMaps(resolvedCatalog);

	const plannedShaCache = new Map<string, Map<string, string>>();
	const getCatalogShaForFile = (
		itemName: string,
		kind: "skill" | "subagent",
		target: RuntimeTarget,
		relativePath: string,
	): string | null => {
		const cacheKey = `${kind}:${itemName}:${target}`;
		let fileMap = plannedShaCache.get(cacheKey);
		if (!fileMap) {
			fileMap = new Map<string, string>();
			if (kind === "skill") {
				const parsedSkill = catalogMaps.skills.get(itemName);
				if (parsedSkill) {
					for (const pf of renderSkillFilesForRuntime(parsedSkill, target)) {
						fileMap.set(
							pf.relativePath.replace(/\\/g, "/"),
							computeSha256(pf.content),
						);
					}
				}
			} else {
				const parsedSubagent = catalogMaps.subagents.get(itemName);
				if (parsedSubagent) {
					for (const pf of renderSubagentFilesForRuntime(
						parsedSubagent,
						target,
					)) {
						fileMap.set(
							pf.relativePath.replace(/\\/g, "/"),
							computeSha256(pf.content),
						);
					}
				}
			}
			plannedShaCache.set(cacheKey, fileMap);
		}
		return fileMap.get(relativePath.replace(/\\/g, "/")) ?? null;
	};

	const counts = {
		up_to_date: 0,
		update_available: 0,
		drift_modified: 0,
		missing_on_disk: 0,
		untracked_on_disk: 0,
	};
	const installedSkills = new Set<string>();
	const installedSubagents = new Set<string>();
	const activeTargets = new Set<RuntimeTarget>();
	const artifacts: InstalledArtifactStatus[] = [];

	for (const d of discovered) {
		const relPath = d.relativePath.replace(/\\/g, "/");
		const fullPath = resolveSafeRepoTargetPath(resolvedRepo, relPath);
		const fileExists =
			fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
		const diskSha256 = fileExists
			? computeSha256(fs.readFileSync(fullPath, "utf-8"))
			: null;
		const lockfileSha256 = d.fromLockfile ? d.sha256 : null;
		const catalogSha256 = getCatalogShaForFile(
			d.itemName,
			d.kind,
			d.target,
			relPath,
		);

		let state: ArtifactHealthState;
		if (!fileExists) {
			state = "missing_on_disk";
		} else if (!d.fromLockfile) {
			state = "untracked_on_disk";
		} else if (diskSha256 !== lockfileSha256) {
			state = "drift_modified";
		} else if (catalogSha256 !== null && catalogSha256 !== diskSha256) {
			state = "update_available";
		} else {
			state = "up_to_date";
		}

		counts[state] += 1;
		activeTargets.add(d.target);
		if (d.kind === "subagent") {
			installedSubagents.add(d.itemName);
		} else {
			installedSkills.add(d.itemName);
		}

		artifacts.push({
			target: d.target,
			itemName: d.itemName,
			kind: d.kind,
			relativePath: relPath,
			state,
			lockfileSha256,
			diskSha256,
			catalogSha256,
		});
	}

	return {
		repo_path: resolvedRepo.replace(/\\/g, "/"),
		catalog_path: resolvedCatalog.replace(/\\/g, "/"),
		lockfile_path: lockfilePath.replace(/\\/g, "/"),
		lockfile_present: existingLock !== null,
		targets: [...activeTargets],
		installed_skills: [...installedSkills],
		installed_subagents: [...installedSubagents],
		artifacts,
		counts,
		passed: counts.drift_modified === 0 && counts.missing_on_disk === 0,
	};
}

/**
 * Deterministically update all (or specified) installed Skills and Subagents in a repository
 * (or global `~` scope) to match the latest catalog versions across their active AI harnesses,
 * while preserving locally edited files via SHA-256 drift detection unless `--force` is passed (Issue #202).
 */
export function updateInstalledSkills(
	repoPath: string,
	catalogDir: string,
	options: UpdateOptions = {},
): SyncReport {
	const resolvedRepo = path.resolve(repoPath);
	const resolvedCatalog = path.resolve(catalogDir);
	const dryRun = options.dryRun ?? false;
	const force = options.force ?? false;

	const lockfilePath = path.join(resolvedRepo, ".skillops-lock.json");
	const existingLock = loadExistingLockfile(lockfilePath);

	const discovered = discoverInstalledArtifactsOnDisk(
		resolvedRepo,
		resolvedCatalog,
		options.targets,
	);

	const requestedNames =
		options.names && options.names.length > 0
			? [...new Set(options.names)]
			: null;

	if (requestedNames) {
		for (const reqName of requestedNames) {
			const hasMatch = discovered.some((d) => d.itemName === reqName);
			if (!hasMatch) {
				throw new Error(
					`No installed artifacts found for '${reqName}' in '${resolvedRepo.replace(/\\/g, "/")}'.`,
				);
			}
		}
	}

	const filteredDiscovered = requestedNames
		? discovered.filter((d) => requestedNames.includes(d.itemName))
		: discovered;

	if (filteredDiscovered.length === 0) {
		const fallbackTargets: RuntimeTarget[] = options.targets?.length
			? [...options.targets]
			: existingLock?.targets.length
				? [...existingLock.targets]
				: [...CORE_RUNTIME_TARGETS];
		return SyncReportSchema.parse({
			repo_path: resolvedRepo.replace(/\\/g, "/"),
			catalog_path: resolvedCatalog.replace(/\\/g, "/"),
			targets: fallbackTargets,
			dry_run: dryRun,
			force,
			artifacts: [],
			skipped_existing: [],
			drift_conflicts: [],
			lockfile_path: lockfilePath.replace(/\\/g, "/"),
			passed: true,
		});
	}

	const installedTuples = new Map<
		string,
		{ itemName: string; kind: "skill" | "subagent"; target: RuntimeTarget }
	>();
	for (const d of filteredDiscovered) {
		const key = `${d.kind}:${d.itemName}:${d.target}`;
		if (!installedTuples.has(key)) {
			installedTuples.set(key, {
				itemName: d.itemName,
				kind: d.kind,
				target: d.target,
			});
		}
	}

	const catalogMaps = loadCatalogMaps(resolvedCatalog);
	const newLockArtifacts: Record<string, SyncLockEntry> = {
		...(existingLock?.artifacts ?? {}),
	};
	const artifacts: SyncedArtifact[] = [];
	const driftConflicts: string[] = [];
	const activeTargets = new Set<RuntimeTarget>();
	const updatedSkills = new Set<string>(existingLock?.selected_skills ?? []);
	const updatedSubagents = new Set<string>(
		existingLock?.selected_subagents ?? [],
	);

	for (const tuple of installedTuples.values()) {
		activeTargets.add(tuple.target);
		let plannedFiles: PlannedFile[] = [];
		if (tuple.kind === "skill") {
			const parsedSkill = catalogMaps.skills.get(tuple.itemName);
			if (!parsedSkill) {
				continue;
			}
			updatedSkills.add(tuple.itemName);
			plannedFiles = renderSkillFilesForRuntime(parsedSkill, tuple.target);
		} else {
			const parsedSubagent = catalogMaps.subagents.get(tuple.itemName);
			if (!parsedSubagent) {
				continue;
			}
			updatedSubagents.add(tuple.itemName);
			plannedFiles = renderSubagentFilesForRuntime(
				parsedSubagent,
				tuple.target,
			);
		}

		for (const pf of plannedFiles) {
			const relPath = pf.relativePath.replace(/\\/g, "/");
			const fullPath = resolveSafeRepoTargetPath(resolvedRepo, relPath);
			const desiredSha = computeSha256(pf.content);
			const fileExists =
				fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
			const lockEntry = existingLock?.artifacts[relPath];

			if (fileExists) {
				const currentDiskSha = computeSha256(fs.readFileSync(fullPath, "utf-8"));
				if (lockEntry && currentDiskSha !== lockEntry.sha256 && !force) {
					driftConflicts.push(relPath);
					artifacts.push({
						target: pf.target,
						skill_name: pf.itemName,
						relative_path: relPath,
						sha256: currentDiskSha,
						action: "conflict",
					});
					continue;
				}

				if (currentDiskSha === desiredSha && !force) {
					artifacts.push({
						target: pf.target,
						skill_name: pf.itemName,
						relative_path: relPath,
						sha256: desiredSha,
						action: "unchanged",
					});
					newLockArtifacts[relPath] = {
						target: pf.target,
						skill_name: pf.itemName,
						relative_path: relPath,
						sha256: desiredSha,
					};
					continue;
				}

				if (!dryRun) {
					fs.mkdirSync(path.dirname(fullPath), { recursive: true });
					fs.writeFileSync(fullPath, pf.content, "utf-8");
				}
				artifacts.push({
					target: pf.target,
					skill_name: pf.itemName,
					relative_path: relPath,
					sha256: desiredSha,
					action: dryRun ? "planned" : "updated",
				});
				newLockArtifacts[relPath] = {
					target: pf.target,
					skill_name: pf.itemName,
					relative_path: relPath,
					sha256: desiredSha,
				};
			} else {
				if (!dryRun) {
					fs.mkdirSync(path.dirname(fullPath), { recursive: true });
					fs.writeFileSync(fullPath, pf.content, "utf-8");
				}
				artifacts.push({
					target: pf.target,
					skill_name: pf.itemName,
					relative_path: relPath,
					sha256: desiredSha,
					action: dryRun ? "planned" : "created",
				});
				newLockArtifacts[relPath] = {
					target: pf.target,
					skill_name: pf.itemName,
					relative_path: relPath,
					sha256: desiredSha,
				};
			}
		}
	}

	if (!dryRun && driftConflicts.length === 0 && artifacts.length > 0) {
		const mergedTargets = [
			...new Set<RuntimeTarget>([
				...(existingLock?.targets ?? []),
				...activeTargets,
			]),
		];
		const lockData: SyncLockfile = SyncLockfileSchema.parse({
			schema_version: "1.0",
			skillops_version: SKILLOPS_VERSION,
			targets: mergedTargets,
			selected_skills: [...updatedSkills],
			selected_subagents: [...updatedSubagents],
			total_l1_tokens: existingLock?.total_l1_tokens ?? 0,
			artifacts: newLockArtifacts,
		});
		fs.writeFileSync(
			lockfilePath,
			`${JSON.stringify(lockData, null, 2)}\n`,
			"utf-8",
		);
	}

	const reportTargets =
		activeTargets.size > 0
			? [...activeTargets]
			: options.targets?.length
				? [...options.targets]
				: [...CORE_RUNTIME_TARGETS];

	return SyncReportSchema.parse({
		repo_path: resolvedRepo.replace(/\\/g, "/"),
		catalog_path: resolvedCatalog.replace(/\\/g, "/"),
		targets: reportTargets,
		dry_run: dryRun,
		force,
		artifacts,
		skipped_existing: [],
		drift_conflicts: driftConflicts,
		lockfile_path: lockfilePath.replace(/\\/g, "/"),
		passed: driftConflicts.length === 0,
	});
}

function formatHealthPill(
	state: ArtifactHealthState,
	colorEnabled?: boolean,
): string {
	switch (state) {
		case "up_to_date":
			return renderPill(" = HEALTHY ", {
				fg: CHARM_PALETTE.inkDark,
				bg: CHARM_PALETTE.mint,
				bold: true,
				colorEnabled,
			});
		case "update_available":
			return renderPill(" ~ OUTDATED", {
				fg: CHARM_PALETTE.inkDark,
				bg: CHARM_PALETTE.amber,
				bold: true,
				colorEnabled,
			});
		case "drift_modified":
			return renderPill(" ! DRIFT   ", {
				fg: CHARM_PALETTE.white,
				bg: CHARM_PALETTE.coral,
				bold: true,
				colorEnabled,
			});
		case "missing_on_disk":
			return renderPill(" ? MISSING ", {
				fg: CHARM_PALETTE.white,
				bg: CHARM_PALETTE.coral,
				bold: true,
				colorEnabled,
			});
		case "untracked_on_disk":
			return renderPill(" + UNTRACK ", {
				fg: CHARM_PALETTE.indigo,
				bg: CHARM_PALETTE.keycapBg,
				bold: true,
				colorEnabled,
			});
	}
}

/**
 * Format a `ProjectStatusReport` into a compact `<= 78 cols` tree, JSON, or Markdown (Issue #201).
 */
export function formatProjectStatusReport(
	report: ProjectStatusReport,
	format: "table" | "json" | "markdown" = "table",
	colorEnabled?: boolean,
): string {
	const isGlobal = isGlobalHomePath(report.repo_path);
	const globalBadge = isGlobal ? " [Global: ~]" : "";

	if (format === "json") {
		return `${JSON.stringify(report, null, 2)}\n`;
	}

	if (format === "markdown") {
		return [
			`## SkillOps Project Status Report${globalBadge}`,
			"",
			`- **Targets**: ${report.targets.length > 0 ? report.targets.map((t) => `\`${t}\``).join(", ") : "none"}`,
			`- **Installed Skills**: \`${report.installed_skills.length}\``,
			`- **Installed Subagents**: \`${report.installed_subagents.length}\``,
			`- **Lockfile Present**: \`${report.lockfile_present}\``,
			`- **Status**: **${report.passed ? "PASS" : "DRIFT DETECTED"}**`,
			"",
			"| Target | Kind | Module | Relative Path | State |",
			"| :--- | :--- | :--- | :--- | :---: |",
			...report.artifacts.map(
				(a) =>
					`| \`${a.target}\` | \`${a.kind}\` | \`${a.itemName}\` | \`${a.relativePath}\` | \`${a.state}\` |`,
			),
			"",
		].join("\n");
	}

	const c = colorEnabled;
	const bar = style.dim("│", c);
	const subtitle = `Project Status & Installed Modules${globalBadge}`;
	const banner = renderHeaderBanner(subtitle, { colorEnabled: c });

	const statusBadge = !report.passed
		? formatBadge("fail", "DRIFT DETECTED", c)
		: report.counts.update_available > 0
			? formatBadge("warn", "UPDATE AVAILABLE", c)
			: formatBadge("pass", "HEALTHY", c);

	const breakdownParts: string[] = [];
	if (report.counts.up_to_date > 0)
		breakdownParts.push(`${report.counts.up_to_date} healthy`);
	if (report.counts.update_available > 0)
		breakdownParts.push(`${report.counts.update_available} outdated`);
	if (report.counts.drift_modified > 0)
		breakdownParts.push(`${report.counts.drift_modified} drift`);
	if (report.counts.missing_on_disk > 0)
		breakdownParts.push(`${report.counts.missing_on_disk} missing`);
	if (report.counts.untracked_on_disk > 0)
		breakdownParts.push(`${report.counts.untracked_on_disk} untracked`);
	const breakdown =
		breakdownParts.length > 0
			? style.dim(` (${breakdownParts.join(", ")})`, c)
			: "";

	const statusLine = `${bar}  ${padVisible(fgHex(CHARM_PALETTE.lavender, style.bold("Status:", c), c), 10, "left")}${statusBadge} ${style.dim("·", c)} ${fgHex(CHARM_PALETTE.white, `${report.artifacts.length} file(s)`, c)}`;
	const healthLine =
		breakdownParts.length > 0
			? `${bar}  ${padVisible(fgHex(CHARM_PALETTE.lavender, style.bold("Health:", c), c), 10, "left")}${style.dim(breakdownParts.join(", "), c)}`
			: "";

	const visibleTargets =
		report.targets.length === 0
			? style.dim("none", c)
			: report.targets.length <= 4
				? report.targets
						.map((t) => style.bold(style.cyan(t, c), c))
						.join(style.dim(", ", c))
				: `${report.targets
						.slice(0, 3)
						.map((t) => style.bold(style.cyan(t, c), c))
						.join(
							style.dim(", ", c),
						)} ${fgHex(CHARM_PALETTE.lavender, `+${report.targets.length - 3} more (${report.targets.length} IDEs)`, c)}`;
	const targetsLine = `${bar}  ${padVisible(fgHex(CHARM_PALETTE.lavender, style.bold("Targets:", c), c), 10, "left")}${visibleTargets}`;

	const totalModules =
		report.installed_skills.length + report.installed_subagents.length;
	const moduleLines: string[] = [
		renderSectionHeader(`Installed Modules (${totalModules})`, c),
	];

	if (totalModules === 0) {
		moduleLines.push(
			`${bar}  ${style.dim("No Skills or Subagents installed in this workspace.", c)}`,
		);
	} else {
		const byItem = new Map<
			string,
			{ kind: "skill" | "subagent"; targets: Set<RuntimeTarget> }
		>();
		for (const a of report.artifacts) {
			let entry = byItem.get(a.itemName);
			if (!entry) {
				entry = { kind: a.kind, targets: new Set<RuntimeTarget>() };
				byItem.set(a.itemName, entry);
			}
			entry.targets.add(a.target);
		}
		for (const [itemName, info] of byItem.entries()) {
			const kindBadge = formatBadge(
				info.kind === "subagent" ? "subagent" : "skill",
				info.kind === "subagent" ? "AGENT" : "SKILL",
				c,
			);
			const targetList = [...info.targets];
			const targetSummary =
				targetList.length <= 3
					? targetList.join(", ")
					: `${targetList.slice(0, 2).join(", ")}, +${targetList.length - 2}`;
			const truncatedItemName =
				itemName.length > 22 ? `${itemName.slice(0, 21)}…` : itemName;
			const paddedName = padVisible(
				fgHex(CHARM_PALETTE.white, style.bold(truncatedItemName, c), c),
				22,
				"left",
			);
			moduleLines.push(
				`${bar}  ${kindBadge} ${paddedName} ${fgHex(CHARM_PALETTE.cyan, targetSummary, c)}`,
			);
		}
	}

	const maxDisplayed = 12;
	const shownArtifacts = report.artifacts.slice(0, maxDisplayed);
	const hiddenCount = Math.max(0, report.artifacts.length - maxDisplayed);

	const artifactLines: string[] = [
		renderSectionHeader(`Runtime Artifacts (${report.artifacts.length})`, c),
	];
	if (report.artifacts.length === 0) {
		artifactLines.push(`${bar}  ${style.dim("No runtime files found.", c)}`);
	} else {
		for (const a of shownArtifacts) {
			const pill = formatHealthPill(a.state, c);
			const targetCol = padVisible(
				fgHex(CHARM_PALETTE.cyan, style.bold(`(${a.target})`, c), c),
				16,
				"left",
			);
			const maxPathCols = 44;
			const shortPath =
				a.relativePath.length > maxPathCols
					? `…${a.relativePath.slice(-(maxPathCols - 1))}`
					: a.relativePath;
			const styledPath =
				a.state === "drift_modified" || a.state === "missing_on_disk"
					? fgHex(CHARM_PALETTE.coral, shortPath, c)
					: a.state === "update_available"
						? fgHex(CHARM_PALETTE.amber, shortPath, c)
						: fgHex(CHARM_PALETTE.white, shortPath, c);
			artifactLines.push(`${bar}  ${pill} ${targetCol} ${styledPath}`);
		}
		if (hiddenCount > 0) {
			artifactLines.push(
				`${bar}  ${fgHex(CHARM_PALETTE.lavender, `… and ${hiddenCount} more runtime file(s) across ${report.targets.length} AI IDEs`, c)}`,
			);
		}
	}

	const nextSteps = renderNextSteps(
		[
			{
				command: "npx skillops-cli add",
				description: "Install Skills or Subagents",
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
		healthLine,
		targetsLine,
		...moduleLines,
		...artifactLines,
		nextSteps,
	]
		.filter(Boolean)
		.join("\n");
}

function isGlobalHomePath(repoPath: string): boolean {
	try {
		const normalizedRepo = path
			.resolve(repoPath)
			.replace(/\\/g, "/")
			.replace(/\/+$/, "");
		const envHome = process.env.SKILLOPS_GLOBAL_HOME?.trim();
		const homeDir = envHome ? path.resolve(envHome) : os.homedir();
		const normalizedHome = path
			.resolve(homeDir)
			.replace(/\\/g, "/")
			.replace(/\/+$/, "");
		return normalizedRepo === normalizedHome;
	} catch {
		return false;
	}
}

export function formatSyncReport(
	report: SyncReport,
	format: "table" | "json" | "markdown" = "table",
	colorEnabled?: boolean,
): string {
	const isGlobal = isGlobalHomePath(report.repo_path);
	const globalBadge = isGlobal ? " [Global: ~]" : "";
	if (format === "json") {
		return `${JSON.stringify(report, null, 2)}\n`;
	}
	if (format === "markdown") {
		return [
			`## SkillOps Multi-Runtime Sync Report${globalBadge}`,
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
	const baseSubtitle = !report.passed
		? "Drift Conflict Detected"
		: report.dry_run
			? "Dry-Run Sync Preview"
			: isRemoval
				? "Skills & Subagents Removed"
				: isAllSkipped
					? "Skills & Subagents Skipped (Already Installed)"
					: "Skills & Subagents Installed";
	const subtitle = `${baseSubtitle}${globalBadge}`;

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
