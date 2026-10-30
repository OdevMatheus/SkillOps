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
  type ParsedSkillDirectory,
  type ParsedSubagentFile,
  discoverSkillDirectories,
  discoverSubagentFiles,
  parseSkillDirectory,
  parseSubagentFile,
} from "../auditor/parser.js";
import {
  ALL_RUNTIME_TARGETS,
  type RoutedBundle,
  type RuntimeTarget,
  SKILLOPS_VERSION,
  type SyncLockEntry,
  type SyncLockfile,
  SyncLockfileSchema,
  type SyncReport,
  SyncReportSchema,
  type SyncedArtifact,
} from "../models.js";
import { type RouteOptions, routeRepository } from "../router/index.js";

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

function renderSkillFilesForRuntime(
  parsed: ParsedSkillDirectory,
  target: RuntimeTarget,
): PlannedFile[] {
  const name = parsed.manifest.name;
  const files: PlannedFile[] = [];

  if (target === "claude" || target === "antigravity" || target === "codex") {
    const baseDir =
      target === "claude"
        ? `.claude/skills/${name}`
        : target === "antigravity"
          ? `.agent/skills/${name}`
          : `.codex/skills/${name}`;

    files.push({
      target,
      itemName: name,
      relativePath: `${baseDir}/SKILL.md`,
      content: parsed.rawText,
    });

    for (const scriptFull of parsed.declaredScripts) {
      const scriptRel = path.relative(parsed.skillDir, scriptFull).replace(/\\/g, "/");
      files.push({
        target,
        itemName: name,
        relativePath: `${baseDir}/${scriptRel}`,
        content: fs.readFileSync(scriptFull, "utf-8"),
      });
    }

    for (const refFull of parsed.referenceFiles) {
      const refRel = path.relative(parsed.skillDir, refFull).replace(/\\/g, "/");
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
    const globs =
      parsed.manifest.routing_signals.files_any.length > 0
        ? parsed.manifest.routing_signals.files_any
        : ["**/*"];
    const mdcFrontmatter = YAML.stringify({
      description: parsed.manifest.description,
      globs,
      alwaysApply: false,
    }).trim();
    const mdcContent = `---\n${mdcFrontmatter}\n---\n\n${parsed.markdownBody.trim()}\n`;
    files.push({
      target,
      itemName: name,
      relativePath: `.cursor/rules/skillops-${name}.mdc`,
      content: mdcContent,
    });
    return files;
  }

  // target === "copilot"
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
    content: `---\n${instrFrontmatter}\n---\n\n${parsed.markdownBody.trim()}\n`,
  });

  const promptFrontmatter = YAML.stringify({
    mode: "agent",
    description: parsed.manifest.description,
  }).trim();
  files.push({
    target,
    itemName: name,
    relativePath: `.github/prompts/skillops-${name}.prompt.md`,
    content: `---\n${promptFrontmatter}\n---\n\n${parsed.markdownBody.trim()}\n`,
  });

  return files;
}

function renderSubagentFilesForRuntime(
  subagent: ParsedSubagentFile,
  target: RuntimeTarget,
): PlannedFile[] {
  const name = subagent.manifest.name;
  const fm = YAML.stringify({
    name: subagent.manifest.name,
    description: subagent.manifest.description,
    model_tier: subagent.manifest.model_tier,
    tools: subagent.manifest.tools,
    max_output_tokens: subagent.manifest.max_output_tokens,
  }).trim();
  const normalizedDoc = `---\n${fm}\n---\n\n${subagent.systemPromptBody.trim()}\n`;

  if (target === "claude") {
    return [
      {
        target,
        itemName: name,
        relativePath: `.claude/agents/${name}.md`,
        content: normalizedDoc,
      },
    ];
  }
  if (target === "antigravity") {
    return [
      {
        target,
        itemName: name,
        relativePath: `.agent/agents/${name}.md`,
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
        content: `---\n${mdcFm}\n---\n\n${subagent.systemPromptBody.trim()}\n`,
      },
    ];
  }
  if (target === "codex") {
    return [
      {
        target,
        itemName: name,
        relativePath: `.codex/agents/${name}.md`,
        content: normalizedDoc,
      },
    ];
  }

  // target === "copilot"
  return [
    {
      target,
      itemName: name,
      relativePath: `.github/agents/${name}.agent.md`,
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
    const after = existingContent.slice(endIdx + CODEX_MARKER_END.length).trimStart();
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
  options: { dryRun: boolean; force: boolean; preserveUnlistedLockEntries: boolean },
): SyncReport {
  const lockfilePath = path.join(resolvedRepo, ".skillops-lock.json");
  const existingLock = loadExistingLockfile(lockfilePath);
  const newLockArtifacts: Record<string, SyncLockEntry> = options.preserveUnlistedLockEntries
    ? { ...(existingLock?.artifacts ?? {}) }
    : {};

  const artifacts: SyncedArtifact[] = [];
  const driftConflicts: string[] = [];

  for (const pf of plannedFiles) {
    const fullPath = path.join(resolvedRepo, pf.relativePath);
    const desiredSha = computeSha256(pf.content);
    const previousEntry = existingLock?.artifacts[pf.relativePath];
    const fileExists = fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();

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
    fs.writeFileSync(lockfilePath, `${JSON.stringify(lockData, null, 2)}\n`, "utf-8");
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
  const targets = options.targets?.length ? options.targets : ALL_RUNTIME_TARGETS;
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;

  const routedBundle = routeRepository(resolvedRepo, resolvedCatalog, options);

  // Load selected skills
  const selectedSkills: ParsedSkillDirectory[] = routedBundle.selected_skills.map((s) =>
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
        content: renderCodexAgentsIndex(existingAgentsMd, selectedSkills, selectedSubagents),
      });
    }
  }

  return applyPlannedFiles(resolvedRepo, resolvedCatalog, targets, routedBundle, plannedFiles, {
    dryRun,
    force,
    preserveUnlistedLockEntries: false,
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
  const targets = options.targets?.length ? options.targets : ALL_RUNTIME_TARGETS;
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
      plannedFiles.push(...renderSubagentFilesForRuntime(matchedSubagent, target));
    }
  }

  const routedBundle = routeRepository(resolvedRepo, resolvedCatalog);
  return applyPlannedFiles(resolvedRepo, resolvedCatalog, targets, routedBundle, plannedFiles, {
    dryRun,
    force,
    preserveUnlistedLockEntries: true,
  });
}

export function formatSyncReport(
  report: SyncReport,
  format: "table" | "json" | "markdown" = "table",
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
        (a) => `| \`${a.target}\` | \`${a.skill_name}\` | \`${a.relative_path}\` | \`${a.action}\` |`,
      ),
      "",
    ].join("\n");
  }

  return [
    "=== SkillOps Multi-Runtime Transpiler & Sync Engine ===",
    `Repo       : ${report.repo_path}`,
    `Targets    : ${report.targets.join(", ")}`,
    `Artifacts  : ${report.artifacts.length} file(s) [${report.passed ? "PASS" : "DRIFT CONFLICT"}]`,
    ...report.artifacts.map(
      (a) => `  [${a.action.toUpperCase()}] (${a.target}) ${a.relative_path}`,
    ),
    ...report.drift_conflicts.map(
      (c) => `  [DRIFT CONFLICT] ${c} modified locally. Re-run with --force to overwrite.`,
    ),
    "",
  ].join("\n");
}
