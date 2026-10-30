/**
 * 3-Level Progressive Disclosure & Subagent Token Budget Linter (INV-SKILL-01 & INV-SKILL-04).
 */

import {
  discoverSkillDirectories,
  discoverSubagentFiles,
  parseSkillDirectory,
  parseSubagentFile,
} from "./parser.js";

export interface SkillTokenBudgetAudit {
  readonly skillName: string;
  readonly skillDir: string;
  readonly l1Words: number;
  readonly l1Tokens: number;
  readonly l2Lines: number;
  readonly l2Tokens: number;
  readonly totalLines: number;
  readonly scriptsCount: number;
  readonly passed: boolean;
  readonly errors: string[];
  readonly warnings: string[];
}

export interface SubagentTokenBudgetAudit {
  readonly subagentName: string;
  readonly filePath: string;
  readonly descriptionTokens: number;
  readonly systemPromptLines: number;
  readonly systemPromptTokens: number;
  readonly maxOutputTokens: number;
  readonly tools: string[];
  readonly passed: boolean;
  readonly errors: string[];
}

export interface CatalogTokenBudgetSummary {
  readonly catalogPath: string;
  readonly skills: SkillTokenBudgetAudit[];
  readonly subagents: SubagentTokenBudgetAudit[];
  readonly totalL1Tokens: number;
  readonly totalSubagentPromptTokens: number;
  readonly errors: string[];
  readonly warnings: string[];
  readonly passed: boolean;
}

export function auditSkillTokenBudget(
  skillDir: string,
  options: { requireLayout?: boolean } = {},
): SkillTokenBudgetAudit {
  const requireLayout = options.requireLayout ?? false;
  try {
    const parsed = parseSkillDirectory(skillDir, { requireLayout });
    const warnings: string[] = [];
    const errors: string[] = [];

    if (
      parsed.manifest.routing_signals.negative_triggers.length === 0 &&
      !parsed.manifest.description.toLowerCase().includes("do not trigger")
    ) {
      warnings.push(
        `Skill '${parsed.manifest.name}' has no explicit negative triggers ('Do not trigger for...' or routing_signals.negative_triggers).`,
      );
    }

    if (requireLayout && parsed.missingDeclaredScripts.length > 0) {
      errors.push(
        `Skill '${parsed.manifest.name}' is missing declared script(s): ${parsed.missingDeclaredScripts.join(", ")}`,
      );
    }

    return {
      skillName: parsed.manifest.name,
      skillDir: skillDir.replace(/\\/g, "/"),
      l1Words: parsed.manifest.description_words,
      l1Tokens: parsed.manifest.description_tokens,
      l2Lines: parsed.manifest.body_lines,
      l2Tokens: parsed.manifest.body_tokens,
      totalLines: parsed.totalLines,
      scriptsCount: parsed.declaredScripts.length,
      passed: errors.length === 0,
      errors,
      warnings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      skillName: skillDir.split(/[\\/]/).pop() ?? "unknown",
      skillDir: skillDir.replace(/\\/g, "/"),
      l1Words: 0,
      l1Tokens: 0,
      l2Lines: 0,
      l2Tokens: 0,
      totalLines: 0,
      scriptsCount: 0,
      passed: false,
      errors: [message],
      warnings: [],
    };
  }
}

export function auditSubagentTokenBudget(filePath: string): SubagentTokenBudgetAudit {
  try {
    const parsed = parseSubagentFile(filePath);
    return {
      subagentName: parsed.manifest.name,
      filePath: filePath.replace(/\\/g, "/"),
      descriptionTokens: parsed.manifest.description_tokens,
      systemPromptLines: parsed.manifest.system_prompt_lines,
      systemPromptTokens: parsed.manifest.system_prompt_tokens,
      maxOutputTokens: parsed.manifest.max_output_tokens,
      tools: parsed.manifest.tools,
      passed: true,
      errors: [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      subagentName: filePath.split(/[\\/]/).pop() ?? "unknown",
      filePath: filePath.replace(/\\/g, "/"),
      descriptionTokens: 0,
      systemPromptLines: 0,
      systemPromptTokens: 0,
      maxOutputTokens: 0,
      tools: [],
      passed: false,
      errors: [message],
    };
  }
}

export function auditCatalogTokenBudgets(
  catalogDir: string,
  options: { requireLayout?: boolean } = {},
): CatalogTokenBudgetSummary {
  const skillDirs = discoverSkillDirectories(catalogDir);
  const subagentFiles = discoverSubagentFiles(catalogDir);

  const skills = skillDirs.map((dir) => auditSkillTokenBudget(dir, options));
  const subagents = subagentFiles.map((file) => auditSubagentTokenBudget(file));

  const errors: string[] = [];
  const warnings: string[] = [];
  let totalL1Tokens = 0;
  let totalSubagentPromptTokens = 0;

  for (const s of skills) {
    totalL1Tokens += s.l1Tokens;
    errors.push(...s.errors);
    warnings.push(...s.warnings);
  }
  for (const sa of subagents) {
    totalSubagentPromptTokens += sa.systemPromptTokens;
    errors.push(...sa.errors);
  }

  return {
    catalogPath: catalogDir.replace(/\\/g, "/"),
    skills,
    subagents,
    totalL1Tokens,
    totalSubagentPromptTokens,
    errors,
    warnings,
    passed: errors.length === 0,
  };
}
