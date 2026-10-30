/**
 * Normative Zod v3 schemas and TypeScript domain contracts for the SkillOps NPX Engine.
 *
 * Enforces INV-SKILL-01 through INV-SKILL-05 for both Hybrid Executable Skills (SKILL.md)
 * and Context-Isolated Subagents (SUBAGENT.md / *.agent.md), as well as Token Economy
 * telemetry and Multi-Runtime Transpilation lockfiles.
 */

import fs from "node:fs";
import YAML from "yaml";
import { z } from "zod";

export const SKILLOPS_VERSION = "1.0.0";

const SKILL_NAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const WORD_REGEX = /\S+/g;
const PUNCT_CODE_REGEX = /[{}[\]()<>:;,.=`~@#$%^&*|\\/]/g;

/**
 * Count whitespace-delimited words in text.
 */
export function countWords(text: string): number {
  const matches = text.match(WORD_REGEX);
  return matches ? matches.length : 0;
}

/**
 * Deterministic zero-API token count estimator matching SKILL_CONTRACT.md.
 */
export function estimateTokenCount(text: string): number {
  const stripped = text.trim();
  if (!stripped) {
    return 0;
  }
  const words = countWords(stripped);
  const punctBonus = Math.floor((stripped.match(PUNCT_CODE_REGEX)?.length ?? 0) / 4);
  return Math.max(1, Math.ceil(words * 1.33) + punctBonus);
}

/**
 * Split a Markdown document into [frontmatterDict, markdownBody].
 */
export function splitFrontmatter(rawText: string, sourceLabel: string): [Record<string, unknown>, string] {
  const match = FRONTMATTER_REGEX.exec(rawText);
  if (!match) {
    throw new Error(
      `Document at '${sourceLabel}' is missing valid YAML frontmatter delimited by '---'.`,
    );
  }
  const yamlText = match[1] ?? "";
  const body = match[2] ?? "";
  const parsed: unknown = YAML.parse(yamlText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`YAML frontmatter in '${sourceLabel}' must evaluate to a key-value mapping.`);
  }
  return [parsed as Record<string, unknown>, body];
}

export const ExitCode = {
  SUCCESS: 0,
  ERROR: 1,
  COLLISION_ERROR: 2,
  BUDGET_OR_CONTRACT_ERROR: 3,
  EVAL_REGRESSION_ERROR: 4,
} as const;
export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export const CatalogTrackSchema = z.enum([
  "ai-engineering",
  "python-backend",
  "arch-quality",
  "token-economy",
]);
export type CatalogTrack = z.infer<typeof CatalogTrackSchema>;

export const CollisionSeveritySchema = z.enum([
  "SAFE",
  "WARNING",
  "HIGH_RISK",
  "BLOCKING_ERROR",
]);
export type CollisionSeverity = z.infer<typeof CollisionSeveritySchema>;

export const RuntimeTargetSchema = z.enum([
  "claude",
  "antigravity",
  "cursor",
  "codex",
  "copilot",
]);
export type RuntimeTarget = z.infer<typeof RuntimeTargetSchema>;

export const ALL_RUNTIME_TARGETS: readonly RuntimeTarget[] = [
  "claude",
  "antigravity",
  "cursor",
  "codex",
  "copilot",
];

// ---------------------------------------------------------------------------
// 1. Skill Manifest Contract (INV-SKILL-01 .. INV-SKILL-03)
// ---------------------------------------------------------------------------

export const RoutingSignalsSchema = z
  .object({
    languages: z.array(z.string()).default([]),
    files_any: z.array(z.string()).default([]),
    dependencies_any: z.array(z.string()).default([]),
    negative_triggers: z.array(z.string()).default([]),
  })
  .strict();
export type RoutingSignals = z.infer<typeof RoutingSignalsSchema>;

export const ScriptEntrypointSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .transform((val) => val.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
      .refine(
        (val) =>
          val.startsWith("scripts/") &&
          (val.endsWith(".py") || val.endsWith(".mjs") || val.endsWith(".js") || val.endsWith(".ts")),
        {
          message:
            "Script entrypoint path must reside under 'scripts/' (.py, .mjs, .js, or .ts).",
        },
      ),
    description: z.string().min(10),
  })
  .strict();
export type ScriptEntrypoint = z.infer<typeof ScriptEntrypointSchema>;

export const SkillEntrypointsSchema = z
  .object({
    scripts: z.array(ScriptEntrypointSchema).min(1),
  })
  .strict();
export type SkillEntrypoints = z.infer<typeof SkillEntrypointsSchema>;

export const SkillManifestSchema = z
  .object({
    name: z.string().regex(SKILL_NAME_REGEX, {
      message: "Skill name must be lowercase kebab-case (e.g., 'mcp-architect').",
    }),
    description: z
      .string()
      .transform((val) => val.trim().replace(/\s+/g, " "))
      .superRefine((cleaned, ctx) => {
        if (!cleaned.startsWith("Use when")) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Skill description must start with 'Use when' per SKILL_CONTRACT.md §4.2.",
          });
        }
        const words = countWords(cleaned);
        if (words < 40 || words > 110) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Skill description must contain between 40 and 110 words per INV-SKILL-01 (got ${words} words).`,
          });
        }
        const tokens = estimateTokenCount(cleaned);
        if (tokens > 160) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Skill description exceeds Level 1 budget of 160 tokens per INV-SKILL-01 (estimated ${tokens} tokens).`,
          });
        }
      }),
    version: z.string().regex(SEMVER_REGEX).default("1.0.0"),
    track: CatalogTrackSchema,
    tags: z.array(z.string().min(1)).min(1),
    routing_signals: RoutingSignalsSchema.default({
      languages: [],
      files_any: [],
      dependencies_any: [],
      negative_triggers: [],
    }),
    entrypoints: SkillEntrypointsSchema,
    body_lines: z.number().int().min(0).max(250).default(0),
    body_tokens: z.number().int().min(0).max(1800).default(0),
  })
  .strict();

export type SkillManifestInput = z.input<typeof SkillManifestSchema>;
export type SkillManifest = z.output<typeof SkillManifestSchema> & {
  readonly description_words: number;
  readonly description_tokens: number;
};

export function createSkillManifest(input: unknown): SkillManifest {
  const parsed = SkillManifestSchema.parse(input);
  return {
    ...parsed,
    description_words: countWords(parsed.description),
    description_tokens: estimateTokenCount(parsed.description),
  };
}

export function parseSkillMdFile(filePath: string): SkillManifest {
  const rawText = fs.readFileSync(filePath, "utf-8");
  const normalizedPath = filePath.replace(/\\/g, "/");
  const totalLines = rawText.split(/\r?\n/).length;
  // Drop trailing empty line from split if file ends with newline
  const effectiveTotalLines = rawText.endsWith("\n") ? totalLines - 1 : totalLines;
  if (effectiveTotalLines > 250) {
    throw new Error(
      `SKILL.md at '${normalizedPath}' has ${effectiveTotalLines} lines, exceeding INV-SKILL-01 maximum of 250 lines.`,
    );
  }
  const [frontmatter, body] = splitFrontmatter(rawText, normalizedPath);
  const bodyLines = body ? (body.endsWith("\n") ? body.split(/\r?\n/).length - 1 : body.split(/\r?\n/).length) : 0;
  const bodyTokens = estimateTokenCount(body);
  return createSkillManifest({
    ...frontmatter,
    body_lines: bodyLines,
    body_tokens: bodyTokens,
  });
}

// ---------------------------------------------------------------------------
// 2. Subagent Manifest Contract (First-Class High-End Subagents — INV-SKILL-04)
// ---------------------------------------------------------------------------

const FORBIDDEN_WILDCARD_TOOLS = new Set(["*", "all", "any", "**"]);

export const SubagentManifestSchema = z
  .object({
    name: z.string().regex(SKILL_NAME_REGEX, {
      message: "Subagent name must be lowercase kebab-case (e.g., 'context-scout').",
    }),
    description: z
      .string()
      .transform((val) => val.trim().replace(/\s+/g, " "))
      .superRefine((cleaned, ctx) => {
        const words = countWords(cleaned);
        if (words < 10 || words > 110) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Subagent description must contain between 10 and 110 words (got ${words} words).`,
          });
        }
        const tokens = estimateTokenCount(cleaned);
        if (tokens > 160) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Subagent description exceeds Level 1 budget of 160 tokens (estimated ${tokens} tokens).`,
          });
        }
      }),
    tools: z
      .array(z.string().min(1))
      .min(1, { message: "Subagent must declare an explicit non-empty tool allowlist per INV-SKILL-04." })
      .superRefine((tools, ctx) => {
        for (const tool of tools) {
          if (FORBIDDEN_WILDCARD_TOOLS.has(tool.trim().toLowerCase())) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Subagent tool allowlist cannot contain wildcard '${tool}' per INV-SKILL-04 least-privilege guarantee.`,
            });
          }
        }
      }),
    user_invocable: z.boolean().default(true),
    context_isolation: z.boolean().default(true),
    max_output_tokens: z
      .number()
      .int()
      .min(50)
      .max(400)
      .default(400),
    model_tier: z.enum(["inherit", "fast", "reasoning"]).default("inherit"),
    tags: z.array(z.string().min(1)).default([]),
    system_prompt_lines: z.number().int().min(1).max(180).default(1),
    system_prompt_tokens: z.number().int().min(1).max(1000).default(1),
  })
  .strict();

export type SubagentManifest = z.output<typeof SubagentManifestSchema> & {
  readonly description_tokens: number;
};

export function createSubagentManifest(input: Record<string, unknown>): SubagentManifest {
  const normalized: Record<string, unknown> = { ...input };
  if ("user-invocable" in normalized && !("user_invocable" in normalized)) {
    normalized.user_invocable = normalized["user-invocable"];
    delete normalized["user-invocable"];
  }
  if ("context-isolation" in normalized && !("context_isolation" in normalized)) {
    normalized.context_isolation = normalized["context-isolation"];
    delete normalized["context-isolation"];
  }
  if ("max-output-tokens" in normalized && !("max_output_tokens" in normalized)) {
    normalized.max_output_tokens = normalized["max-output-tokens"];
    delete normalized["max-output-tokens"];
  }
  if ("model-tier" in normalized && !("model_tier" in normalized)) {
    normalized.model_tier = normalized["model-tier"];
    delete normalized["model-tier"];
  }
  const parsed = SubagentManifestSchema.parse(normalized);
  return {
    ...parsed,
    description_tokens: estimateTokenCount(parsed.description),
  };
}

export function parseSubagentMdFile(filePath: string): {
  manifest: SubagentManifest;
  systemPromptBody: string;
} {
  const rawText = fs.readFileSync(filePath, "utf-8");
  const normalizedPath = filePath.replace(/\\/g, "/");
  const [frontmatter, body] = splitFrontmatter(rawText, normalizedPath);
  const trimmedBody = body.trim();
  const promptLines = trimmedBody ? trimmedBody.split(/\r?\n/).length : 1;
  const promptTokens = Math.max(1, estimateTokenCount(trimmedBody));
  const manifest = createSubagentManifest({
    ...frontmatter,
    system_prompt_lines: promptLines,
    system_prompt_tokens: promptTokens,
  });
  return { manifest, systemPromptBody: trimmedBody };
}

// ---------------------------------------------------------------------------
// 3. Semantic Collision & Token Budget Models (ADR-0002)
// ---------------------------------------------------------------------------

export function classifyCollisionSeverity(similarity: number): CollisionSeverity {
  if (similarity >= 0.85) {
    return "BLOCKING_ERROR";
  }
  if (similarity >= 0.72) {
    return "HIGH_RISK";
  }
  if (similarity >= 0.58) {
    return "WARNING";
  }
  return "SAFE";
}

export const CollisionPairSchema = z
  .object({
    skill_a: z.string().min(1),
    skill_b: z.string().min(1),
    similarity: z.number().min(0).max(1),
    severity: CollisionSeveritySchema,
    shared_terms: z.array(z.string()).default([]),
  })
  .strict();
export type CollisionPair = z.infer<typeof CollisionPairSchema>;

export function createCollisionPair(
  skillA: string,
  skillB: string,
  similarity: number,
  sharedTerms: string[] = [],
): CollisionPair {
  const [orderedA, orderedB] = skillA <= skillB ? [skillA, skillB] : [skillB, skillA];
  const clamped = Math.min(1, Math.max(0, Number(similarity.toFixed(4))));
  return CollisionPairSchema.parse({
    skill_a: orderedA,
    skill_b: orderedB,
    similarity: clamped,
    severity: classifyCollisionSeverity(clamped),
    shared_terms: [...new Set(sharedTerms)].sort(),
  });
}

export const CollisionReportSchema = z
  .object({
    catalog_path: z.string(),
    skills_audited: z.number().int().min(0),
    subagents_audited: z.number().int().min(0).default(0),
    total_l1_tokens: z.number().int().min(0),
    max_similarity: z.number().min(0).max(1).default(0),
    pairs: z.array(CollisionPairSchema).default([]),
    budget_errors: z.array(z.string()).default([]),
  })
  .strict();

export type CollisionReport = z.infer<typeof CollisionReportSchema> & {
  readonly blocking_collisions: CollisionPair[];
  readonly high_risk_collisions: CollisionPair[];
  readonly warning_collisions: CollisionPair[];
  readonly passed: boolean;
};

export function createCollisionReport(
  input: z.input<typeof CollisionReportSchema>,
): CollisionReport {
  const parsed = CollisionReportSchema.parse(input);
  const blocking = parsed.pairs.filter((p) => p.severity === "BLOCKING_ERROR");
  const highRisk = parsed.pairs.filter((p) => p.severity === "HIGH_RISK");
  const warnings = parsed.pairs.filter((p) => p.severity === "WARNING");
  return {
    ...parsed,
    blocking_collisions: blocking,
    high_risk_collisions: highRisk,
    warning_collisions: warnings,
    passed: parsed.budget_errors.length === 0 && blocking.length === 0,
  };
}

// ---------------------------------------------------------------------------
// 4. Token Economy & Startup Context Tax Models (Issue #60)
// ---------------------------------------------------------------------------

export const TokenFileCategorySchema = z.enum([
  "always_on_instructions",
  "always_on_cursor_rule",
  "mcp_schema_tax",
  "skill_l1_metadata",
  "skill_l2_body",
  "skill_l3_script",
  "subagent_definition",
]);
export type TokenFileCategory = z.infer<typeof TokenFileCategorySchema>;

export const TokenFileEntrySchema = z
  .object({
    path: z.string().min(1),
    category: TokenFileCategorySchema,
    always_loaded_on_startup: z.boolean(),
    lines: z.number().int().min(0),
    estimated_tokens: z.number().int().min(0),
    notes: z.string().default(""),
  })
  .strict();
export type TokenFileEntry = z.infer<typeof TokenFileEntrySchema>;

export const TokenWasteHotspotSchema = z
  .object({
    path: z.string().min(1),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    wasted_tokens: z.number().int().min(0),
    issue: z.string().min(1),
    recommendation: z.string().min(1),
  })
  .strict();
export type TokenWasteHotspot = z.infer<typeof TokenWasteHotspotSchema>;

export const TokenEconomyReportSchema = z
  .object({
    repo_path: z.string().min(1),
    catalog_path: z.string().min(1),
    startup_token_tax: z.number().int().min(0),
    startup_tax_budget: z.number().int().min(100).default(2500),
    monolithic_equivalent_tokens: z.number().int().min(0),
    progressive_disclosure_l1_tokens: z.number().int().min(0),
    zero_token_l3_scripts_count: z.number().int().min(0),
    context_isolated_subagents_count: z.number().int().min(0),
    estimated_tokens_saved: z.number().int().min(0),
    token_savings_pct: z.number().min(0).max(100),
    inspected_files: z.array(TokenFileEntrySchema).default([]),
    hotspots: z.array(TokenWasteHotspotSchema).default([]),
    passed_budget: z.boolean(),
  })
  .strict();
export type TokenEconomyReport = z.infer<typeof TokenEconomyReportSchema>;

// ---------------------------------------------------------------------------
// 5. Router & Multi-Runtime Sync Models (Issue #61)
// ---------------------------------------------------------------------------

export const RepoProfileSchema = z
  .object({
    repo_path: z.string().min(1),
    languages: z.array(z.string()).default([]),
    frameworks: z.array(z.string()).default([]),
    databases: z.array(z.string()).default([]),
    dependencies: z.array(z.string()).default([]),
    ci_systems: z.array(z.string()).default([]),
    detected_files: z.array(z.string()).default([]),
    signals: z.array(z.string()).default([]),
    python_312_plus: z.boolean().default(false),
  })
  .strict();
export type RepoProfile = z.infer<typeof RepoProfileSchema>;

export const ScoredSkillSchema = z
  .object({
    name: z.string().min(1),
    track: CatalogTrackSchema,
    skill_dir: z.string().min(1),
    relevance_score: z.number().min(0).max(100),
    l1_tokens: z.number().int().min(0),
    matched_signals: z.array(z.string()).default([]),
  })
  .strict();
export type ScoredSkill = z.infer<typeof ScoredSkillSchema>;

export const SkippedSkillSchema = z
  .object({
    name: z.string().min(1),
    track: CatalogTrackSchema,
    relevance_score: z.number().min(0).max(100),
    reason: z.string().min(1),
  })
  .strict();
export type SkippedSkill = z.infer<typeof SkippedSkillSchema>;

export const RoutedBundleSchema = z
  .object({
    repo_profile: RepoProfileSchema,
    catalog_path: z.string().min(1),
    max_skills: z.number().int().min(1).max(12).default(12),
    max_l1_tokens: z.number().int().min(40).default(1500),
    max_similarity: z.number().min(0.1).max(0.99).default(0.78),
    selected_skills: z.array(ScoredSkillSchema).default([]),
    recommended_subagents: z.array(z.string()).default([]),
    skipped_skills: z.array(SkippedSkillSchema).default([]),
    total_l1_tokens: z.number().int().min(0).default(0),
    max_pairwise_similarity: z.number().min(0).max(1).default(0),
    passed_invariants: z.boolean().default(true),
  })
  .strict();
export type RoutedBundle = z.infer<typeof RoutedBundleSchema>;

export const SyncedArtifactSchema = z
  .object({
    target: RuntimeTargetSchema,
    skill_name: z.string().min(1),
    relative_path: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    action: z.enum(["created", "updated", "unchanged", "removed", "planned", "conflict"]),
  })
  .strict();
export type SyncedArtifact = z.infer<typeof SyncedArtifactSchema>;

export const SyncLockEntrySchema = z
  .object({
    target: RuntimeTargetSchema,
    skill_name: z.string().min(1),
    relative_path: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type SyncLockEntry = z.infer<typeof SyncLockEntrySchema>;

export const SyncLockfileSchema = z
  .object({
    schema_version: z.string().default("1.0"),
    skillops_version: z.string().min(1),
    targets: z.array(RuntimeTargetSchema).default([]),
    selected_skills: z.array(z.string()).default([]),
    selected_subagents: z.array(z.string()).default([]),
    total_l1_tokens: z.number().int().min(0).default(0),
    artifacts: z.record(z.string(), SyncLockEntrySchema).default({}),
  })
  .strict();
export type SyncLockfile = z.infer<typeof SyncLockfileSchema>;

export const SyncReportSchema = z
  .object({
    repo_path: z.string().min(1),
    catalog_path: z.string().min(1),
    targets: z.array(RuntimeTargetSchema).default([]),
    dry_run: z.boolean().default(false),
    force: z.boolean().default(false),
    routed_bundle: RoutedBundleSchema,
    artifacts: z.array(SyncedArtifactSchema).default([]),
    drift_conflicts: z.array(z.string()).default([]),
    lockfile_path: z.string().min(1),
    passed: z.boolean().default(true),
  })
  .strict();
export type SyncReport = z.infer<typeof SyncReportSchema>;
