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

export const SKILLOPS_VERSION = "1.3.10";

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
	const punctBonus = Math.floor(
		(stripped.match(PUNCT_CODE_REGEX)?.length ?? 0) / 4,
	);
	return Math.max(1, Math.ceil(words * 1.33) + punctBonus);
}

/**
 * Split a Markdown document into [frontmatterDict, markdownBody].
 */
export function splitFrontmatter(
	rawText: string,
	sourceLabel: string,
): [Record<string, unknown>, string] {
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
		throw new Error(
			`YAML frontmatter in '${sourceLabel}' must evaluate to a key-value mapping.`,
		);
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

export const RuntimeTargetSchema = z.enum([
	"claude",
	"antigravity",
	"cursor",
	"codex",
	"copilot",
	"windsurf",
	"cline",
	"roocode",
	"kilocode",
	"zed",
	"continue",
	"aider",
	"openhands",
	"amp",
	"goose",
	"opencode",
	"kiro",
	"trae",
	"amazonq",
	"junie",
	"gemini",
	"factory",
	"qwen",
	"augment",
	"vibe",
	"warp",
	"crush",
	"idx",
]);
export type RuntimeTarget = z.infer<typeof RuntimeTargetSchema>;

export const CORE_RUNTIME_TARGETS: readonly RuntimeTarget[] = [
	"claude",
	"antigravity",
	"cursor",
	"codex",
	"copilot",
];

export const ALL_RUNTIME_TARGETS: readonly RuntimeTarget[] = [
	"claude",
	"antigravity",
	"cursor",
	"codex",
	"copilot",
	"windsurf",
	"cline",
	"roocode",
	"kilocode",
	"zed",
	"continue",
	"aider",
	"openhands",
	"amp",
	"goose",
	"opencode",
	"kiro",
	"trae",
	"amazonq",
	"junie",
	"gemini",
	"factory",
	"qwen",
	"augment",
	"vibe",
	"warp",
	"crush",
	"idx",
];

export type HarnessCategory =
	| "cli-agent"
	| "ai-ide"
	| "ide-extension"
	| "autonomous-swe";
export type HarnessSkillFormat =
	| "progressive-skill-dir"
	| "mdc-rule"
	| "copilot-instructions"
	| "markdown-rule"
	| "openhands-microagent"
	| "kiro-steering";

export interface RuntimeHarnessSpec {
	readonly id: RuntimeTarget;
	readonly displayName: string;
	readonly vendor: string;
	readonly category: HarnessCategory;
	readonly skillFormat: HarnessSkillFormat;
	readonly skillsDir: string;
	readonly subagentsDir: string;
	readonly detectionPaths: readonly string[];
	readonly alwaysOnFiles: readonly string[];
	readonly mcpConfigPath: string | null;
	readonly supportsMcp: boolean;
}

export const RUNTIME_HARNESS_SPECS: Readonly<
	Record<RuntimeTarget, RuntimeHarnessSpec>
> = {
	claude: {
		id: "claude",
		displayName: "Anthropic Claude Code",
		vendor: "Anthropic",
		category: "cli-agent",
		skillFormat: "progressive-skill-dir",
		skillsDir: ".claude/skills",
		subagentsDir: ".claude/agents",
		detectionPaths: [".claude", "CLAUDE.md", ".mcp.json"],
		alwaysOnFiles: ["CLAUDE.md", ".claude/CLAUDE.md"],
		mcpConfigPath: ".mcp.json",
		supportsMcp: true,
	},
	antigravity: {
		id: "antigravity",
		displayName: "Google Antigravity IDE",
		vendor: "Google DeepMind",
		category: "ai-ide",
		skillFormat: "progressive-skill-dir",
		skillsDir: ".agent/skills",
		subagentsDir: ".agent/agents",
		detectionPaths: [".agent", "GEMINI.md"],
		alwaysOnFiles: ["GEMINI.md"],
		mcpConfigPath: ".agent/mcp_config.json",
		supportsMcp: true,
	},
	cursor: {
		id: "cursor",
		displayName: "Cursor AI IDE",
		vendor: "Anysphere",
		category: "ai-ide",
		skillFormat: "mdc-rule",
		skillsDir: ".cursor/rules",
		subagentsDir: ".cursor/rules",
		detectionPaths: [".cursor", ".cursorrules"],
		alwaysOnFiles: [".cursorrules"],
		mcpConfigPath: ".cursor/mcp.json",
		supportsMcp: true,
	},
	codex: {
		id: "codex",
		displayName: "OpenAI Codex CLI",
		vendor: "OpenAI",
		category: "cli-agent",
		skillFormat: "progressive-skill-dir",
		skillsDir: ".codex/skills",
		subagentsDir: ".codex/agents",
		detectionPaths: [".codex", "AGENTS.md"],
		alwaysOnFiles: ["AGENTS.md"],
		mcpConfigPath: ".codex/config.toml",
		supportsMcp: true,
	},
	copilot: {
		id: "copilot",
		displayName: "GitHub Copilot",
		vendor: "GitHub / Microsoft",
		category: "ide-extension",
		skillFormat: "copilot-instructions",
		skillsDir: ".github/instructions",
		subagentsDir: ".github/agents",
		detectionPaths: [
			".github/copilot-instructions.md",
			".github/instructions",
			".github/prompts",
			".github/agents",
		],
		alwaysOnFiles: [".github/copilot-instructions.md"],
		mcpConfigPath: ".vscode/mcp.json",
		supportsMcp: true,
	},
	windsurf: {
		id: "windsurf",
		displayName: "Windsurf AI IDE",
		vendor: "Codeium / Windsurf",
		category: "ai-ide",
		skillFormat: "markdown-rule",
		skillsDir: ".windsurf/rules",
		subagentsDir: ".windsurf/workflows",
		detectionPaths: [".windsurf", ".windsurfrules"],
		alwaysOnFiles: [".windsurfrules"],
		mcpConfigPath: null,
		supportsMcp: false,
	},
	cline: {
		id: "cline",
		displayName: "Cline Autonomous Coding Agent",
		vendor: "Cline",
		category: "ide-extension",
		skillFormat: "markdown-rule",
		skillsDir: ".clinerules",
		subagentsDir: ".clinerules/workflows",
		detectionPaths: [".clinerules", ".cline"],
		alwaysOnFiles: [".clinerules"],
		mcpConfigPath: null,
		supportsMcp: false,
	},
	roocode: {
		id: "roocode",
		displayName: "Roo Code",
		vendor: "Roo Veterinary",
		category: "ide-extension",
		skillFormat: "markdown-rule",
		skillsDir: ".roo/rules",
		subagentsDir: ".roo/rules-architect",
		detectionPaths: [".roo", ".roorules", ".roomodes"],
		alwaysOnFiles: [".roorules"],
		mcpConfigPath: ".roo/mcp.json",
		supportsMcp: true,
	},
	kilocode: {
		id: "kilocode",
		displayName: "Kilo Code",
		vendor: "Kilo Org",
		category: "ide-extension",
		skillFormat: "markdown-rule",
		skillsDir: ".kilocode/rules",
		subagentsDir: ".kilocode/workflows",
		detectionPaths: [".kilocode", ".kilocoderules", ".kilocodemodes"],
		alwaysOnFiles: [".kilocoderules"],
		mcpConfigPath: ".kilocode/mcp.json",
		supportsMcp: true,
	},
	zed: {
		id: "zed",
		displayName: "Zed AI",
		vendor: "Zed Industries",
		category: "ai-ide",
		skillFormat: "markdown-rule",
		skillsDir: ".zed/rules",
		subagentsDir: ".zed/rules",
		detectionPaths: [".zed", ".rules"],
		alwaysOnFiles: [".rules"],
		mcpConfigPath: ".zed/settings.json",
		supportsMcp: true,
	},
	continue: {
		id: "continue",
		displayName: "Continue.dev",
		vendor: "Continue",
		category: "ide-extension",
		skillFormat: "markdown-rule",
		skillsDir: ".continue/rules",
		subagentsDir: ".continue/prompts",
		detectionPaths: [".continue", ".continuerules"],
		alwaysOnFiles: [".continuerules"],
		mcpConfigPath: ".continue/mcpServers/skillops.yaml",
		supportsMcp: true,
	},
	aider: {
		id: "aider",
		displayName: "Aider AI Pair Programmer",
		vendor: "Aider",
		category: "cli-agent",
		skillFormat: "markdown-rule",
		skillsDir: ".aider/conventions",
		subagentsDir: ".aider/conventions",
		detectionPaths: [".aider", ".aider.conf.yml", "CONVENTIONS.md"],
		alwaysOnFiles: ["CONVENTIONS.md"],
		mcpConfigPath: null,
		supportsMcp: false,
	},
	openhands: {
		id: "openhands",
		displayName: "OpenHands (All Hands AI)",
		vendor: "All Hands AI",
		category: "autonomous-swe",
		skillFormat: "openhands-microagent",
		skillsDir: ".openhands/microagents",
		subagentsDir: ".openhands/microagents",
		detectionPaths: [".openhands"],
		alwaysOnFiles: [".openhands/microagents/repo.md"],
		mcpConfigPath: null,
		supportsMcp: false,
	},
	amp: {
		id: "amp",
		displayName: "Sourcegraph Amp",
		vendor: "Sourcegraph",
		category: "cli-agent",
		skillFormat: "progressive-skill-dir",
		skillsDir: ".amp/skills",
		subagentsDir: ".amp/agents",
		detectionPaths: [".amp", "AGENT.md"],
		alwaysOnFiles: ["AGENT.md"],
		mcpConfigPath: ".amp/settings.json",
		supportsMcp: true,
	},
	goose: {
		id: "goose",
		displayName: "Block Goose",
		vendor: "Block",
		category: "cli-agent",
		skillFormat: "progressive-skill-dir",
		skillsDir: ".goose/skills",
		subagentsDir: ".goose/agents",
		detectionPaths: [".goose", ".goosehints"],
		alwaysOnFiles: [".goosehints"],
		mcpConfigPath: null,
		supportsMcp: false,
	},
	opencode: {
		id: "opencode",
		displayName: "OpenCode CLI",
		vendor: "SST / OpenCode",
		category: "cli-agent",
		skillFormat: "progressive-skill-dir",
		skillsDir: ".opencode/skills",
		subagentsDir: ".opencode/agent",
		detectionPaths: [".opencode", "opencode.json"],
		alwaysOnFiles: [],
		mcpConfigPath: "opencode.json",
		supportsMcp: true,
	},
	kiro: {
		id: "kiro",
		displayName: "AWS Kiro IDE",
		vendor: "Amazon Web Services",
		category: "ai-ide",
		skillFormat: "kiro-steering",
		skillsDir: ".kiro/steering",
		subagentsDir: ".kiro/agents",
		detectionPaths: [".kiro"],
		alwaysOnFiles: [
			".kiro/steering/product.md",
			".kiro/steering/tech.md",
			".kiro/steering/structure.md",
		],
		mcpConfigPath: ".kiro/settings/mcp.json",
		supportsMcp: true,
	},
	trae: {
		id: "trae",
		displayName: "Trae AI IDE",
		vendor: "ByteDance / Trae",
		category: "ai-ide",
		skillFormat: "markdown-rule",
		skillsDir: ".trae/rules",
		subagentsDir: ".trae/agents",
		detectionPaths: [".trae"],
		alwaysOnFiles: [".trae/rules/project_rules.md"],
		mcpConfigPath: null,
		supportsMcp: false,
	},
	amazonq: {
		id: "amazonq",
		displayName: "Amazon Q Developer",
		vendor: "Amazon Web Services",
		category: "ide-extension",
		skillFormat: "markdown-rule",
		skillsDir: ".amazonq/rules",
		subagentsDir: ".amazonq/cli-agents",
		detectionPaths: [".amazonq"],
		alwaysOnFiles: [],
		mcpConfigPath: ".amazonq/mcp.json",
		supportsMcp: true,
	},
	junie: {
		id: "junie",
		displayName: "JetBrains Junie / AI Assistant",
		vendor: "JetBrains",
		category: "ide-extension",
		skillFormat: "markdown-rule",
		skillsDir: ".junie/skills",
		subagentsDir: ".junie/agents",
		detectionPaths: [".junie", ".aiassistant"],
		alwaysOnFiles: [".junie/guidelines.md"],
		mcpConfigPath: null,
		supportsMcp: false,
	},
	gemini: {
		id: "gemini",
		displayName: "Google Gemini CLI",
		vendor: "Google",
		category: "cli-agent",
		skillFormat: "progressive-skill-dir",
		skillsDir: ".gemini/skills",
		subagentsDir: ".gemini/agents",
		detectionPaths: [".gemini", "GEMINI.md"],
		alwaysOnFiles: ["GEMINI.md", ".gemini/GEMINI.md", ".gemini/STYLEGUIDE.md"],
		mcpConfigPath: ".gemini/settings.json",
		supportsMcp: true,
	},
	factory: {
		id: "factory",
		displayName: "Factory AI Droid",
		vendor: "Factory AI",
		category: "cli-agent",
		skillFormat: "progressive-skill-dir",
		skillsDir: ".factory/skills",
		subagentsDir: ".factory/droids",
		detectionPaths: [".factory"],
		alwaysOnFiles: ["AGENTS.md", ".factory/instructions.md"],
		mcpConfigPath: ".factory/mcp.json",
		supportsMcp: true,
	},
	qwen: {
		id: "qwen",
		displayName: "Qwen Code CLI",
		vendor: "Alibaba Cloud / Qwen",
		category: "cli-agent",
		skillFormat: "progressive-skill-dir",
		skillsDir: ".qwen/skills",
		subagentsDir: ".qwen/agents",
		detectionPaths: [".qwen", "QWEN.md"],
		alwaysOnFiles: ["QWEN.md", "AGENTS.md"],
		mcpConfigPath: ".qwen/settings.json",
		supportsMcp: true,
	},
	augment: {
		id: "augment",
		displayName: "Augment Code",
		vendor: "Augment",
		category: "ide-extension",
		skillFormat: "markdown-rule",
		skillsDir: ".augment/rules",
		subagentsDir: ".augment/agents",
		detectionPaths: [".augment", ".augment-guidelines"],
		alwaysOnFiles: [".augment-guidelines", "AGENTS.md"],
		mcpConfigPath: ".augment/settings.json",
		supportsMcp: true,
	},
	vibe: {
		id: "vibe",
		displayName: "Mistral Vibe CLI",
		vendor: "Mistral AI",
		category: "cli-agent",
		skillFormat: "progressive-skill-dir",
		skillsDir: ".vibe/skills",
		subagentsDir: ".vibe/agents",
		detectionPaths: [".vibe"],
		alwaysOnFiles: [".vibe/config.toml", "AGENTS.md"],
		mcpConfigPath: ".vibe/config.toml",
		supportsMcp: true,
	},
	warp: {
		id: "warp",
		displayName: "Warp AI Terminal",
		vendor: "Warp",
		category: "cli-agent",
		skillFormat: "progressive-skill-dir",
		skillsDir: ".warp/skills",
		subagentsDir: ".warp/agents",
		detectionPaths: [".warp", "WARP.md"],
		alwaysOnFiles: ["WARP.md", "AGENTS.md"],
		mcpConfigPath: null,
		supportsMcp: false,
	},
	crush: {
		id: "crush",
		displayName: "Charmbracelet Crush",
		vendor: "Charmbracelet",
		category: "cli-agent",
		skillFormat: "progressive-skill-dir",
		skillsDir: ".crush/skills",
		subagentsDir: ".crush/agents",
		detectionPaths: [".crush", ".crush.json", "CRUSH.md"],
		alwaysOnFiles: ["CRUSH.md", "AGENTS.md"],
		mcpConfigPath: ".crush.json",
		supportsMcp: true,
	},
	idx: {
		id: "idx",
		displayName: "Firebase Studio (Project IDX)",
		vendor: "Google",
		category: "ai-ide",
		skillFormat: "markdown-rule",
		skillsDir: ".idx/rules",
		subagentsDir: ".idx/agents",
		detectionPaths: [".idx"],
		alwaysOnFiles: [".idx/airules.md", "GEMINI.md"],
		mcpConfigPath: ".idx/mcp.json",
		supportsMcp: true,
	},
};

/**
 * Deterministically detect which of the 20 AI coding agent harnesses have configuration
 * directories or instruction files present in `repoPath`.
 */
export function detectInstalledHarnesses(repoPath: string): RuntimeTarget[] {
	const normalizedRoot = repoPath.replace(/\\/g, "/").replace(/\/+$/, "");
	const detected: RuntimeTarget[] = [];

	for (const target of ALL_RUNTIME_TARGETS) {
		const spec = RUNTIME_HARNESS_SPECS[target];
		const hasMatch = spec.detectionPaths.some((relPath) =>
			fs.existsSync(`${normalizedRoot}/${relPath}`),
		);
		if (hasMatch) {
			detected.push(target);
		}
	}

	return detected;
}

/**
 * Resolve runtime target specifications (`"all"`, `"auto"`, `"core"`, or comma-separated target names)
 * into a deduplicated, validated list of `RuntimeTarget` values.
 */
export function resolveRuntimeTargets(
	rawSpec?: string | readonly string[],
	repoPath?: string,
	fallbackTargets: readonly RuntimeTarget[] = CORE_RUNTIME_TARGETS,
): RuntimeTarget[] {
	if (!rawSpec) {
		return [...fallbackTargets];
	}
	const tokens = (Array.isArray(rawSpec) ? rawSpec : [rawSpec])
		.flatMap((item) => String(item).split(","))
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);

	if (tokens.length === 0) {
		return [...fallbackTargets];
	}

	const resolved: RuntimeTarget[] = [];
	const pushUnique = (target: RuntimeTarget): void => {
		if (!resolved.includes(target)) {
			resolved.push(target);
		}
	};

	for (const token of tokens) {
		if (
			token === "all" ||
			token === "*" ||
			token === "top20" ||
			token === "top28"
		) {
			for (const t of ALL_RUNTIME_TARGETS) {
				pushUnique(t);
			}
		} else if (token === "core" || token === "default") {
			for (const t of CORE_RUNTIME_TARGETS) {
				pushUnique(t);
			}
		} else if (token === "auto") {
			const detected = repoPath ? detectInstalledHarnesses(repoPath) : [];
			const autoList = detected.length > 0 ? detected : fallbackTargets;
			for (const t of autoList) {
				pushUnique(t);
			}
		} else {
			pushUnique(RuntimeTargetSchema.parse(token));
		}
	}

	return resolved;
}

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
					(val.endsWith(".py") ||
						val.endsWith(".mjs") ||
						val.endsWith(".js") ||
						val.endsWith(".ts")),
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
			message:
				"Skill name must be lowercase kebab-case (e.g., 'mcp-architect').",
		}),
		description: z
			.string()
			.transform((val) => val.trim().replace(/\s+/g, " "))
			.superRefine((cleaned, ctx) => {
				if (!cleaned.startsWith("Use when")) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message:
							"Skill description must start with 'Use when' per SKILL_CONTRACT.md §4.2.",
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
	const effectiveTotalLines = rawText.endsWith("\n")
		? totalLines - 1
		: totalLines;
	if (effectiveTotalLines > 250) {
		throw new Error(
			`SKILL.md at '${normalizedPath}' has ${effectiveTotalLines} lines, exceeding INV-SKILL-01 maximum of 250 lines.`,
		);
	}
	const [frontmatter, body] = splitFrontmatter(rawText, normalizedPath);
	const bodyLines = body
		? body.endsWith("\n")
			? body.split(/\r?\n/).length - 1
			: body.split(/\r?\n/).length
		: 0;
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
			message:
				"Subagent name must be lowercase kebab-case (e.g., 'context-scout').",
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
			.min(1, {
				message:
					"Subagent must declare an explicit non-empty tool allowlist per INV-SKILL-04.",
			})
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
		max_output_tokens: z.number().int().min(50).max(400).default(400),
		model_tier: z.enum(["inherit", "fast", "reasoning"]).default("inherit"),
		tags: z.array(z.string().min(1)).default([]),
		system_prompt_lines: z.number().int().min(1).max(180).default(1),
		system_prompt_tokens: z.number().int().min(1).max(1000).default(1),
	})
	.strict();

export type SubagentManifest = z.output<typeof SubagentManifestSchema> & {
	readonly description_tokens: number;
};

export function createSubagentManifest(
	input: Record<string, unknown>,
): SubagentManifest {
	const normalized: Record<string, unknown> = { ...input };
	if ("user-invocable" in normalized && !("user_invocable" in normalized)) {
		normalized.user_invocable = normalized["user-invocable"];
		delete normalized["user-invocable"];
	}
	if (
		"context-isolation" in normalized &&
		!("context_isolation" in normalized)
	) {
		normalized.context_isolation = normalized["context-isolation"];
		delete normalized["context-isolation"];
	}
	if (
		"max-output-tokens" in normalized &&
		!("max_output_tokens" in normalized)
	) {
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
// 3. Multi-Runtime Sync & Lockfile Models
// ---------------------------------------------------------------------------

export const SyncedArtifactSchema = z
	.object({
		target: RuntimeTargetSchema,
		skill_name: z.string().min(1),
		relative_path: z.string().min(1),
		sha256: z.string().regex(/^[0-9a-f]{64}$/),
		action: z.enum([
			"created",
			"updated",
			"unchanged",
			"removed",
			"planned",
			"conflict",
		]),
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
		artifacts: z.array(SyncedArtifactSchema).default([]),
		drift_conflicts: z.array(z.string()).default([]),
		lockfile_path: z.string().min(1),
		passed: z.boolean().default(true),
	})
	.strict();
export type SyncReport = z.infer<typeof SyncReportSchema>;

// ---------------------------------------------------------------------------
// 4. Declarative Workspace Configuration (.skillops.yml)
// ---------------------------------------------------------------------------

export const SkillOpsTokenEconomyConfigSchema = z
	.object({
		startup_tax_budget: z.number().int().min(100).default(2500),
		max_active_skills: z.number().int().min(1).max(12).default(12),
		max_l1_tokens: z.number().int().min(40).default(1500),
		max_similarity: z.number().min(0.1).max(0.99).default(0.78),
	})
	.strict();
export type SkillOpsTokenEconomyConfig = z.infer<
	typeof SkillOpsTokenEconomyConfigSchema
>;

export const SkillOpsDetectedStackConfigSchema = z
	.object({
		languages: z.array(z.string()).default([]),
		frameworks: z.array(z.string()).default([]),
	})
	.strict();
export type SkillOpsDetectedStackConfig = z.infer<
	typeof SkillOpsDetectedStackConfigSchema
>;

export const SkillOpsConfigSchema = z
	.object({
		version: z.string().min(1).default("1.0"),
		catalog_dir: z.string().min(1).default("catalog"),
		token_economy: SkillOpsTokenEconomyConfigSchema.default({
			startup_tax_budget: 2500,
			max_active_skills: 12,
			max_l1_tokens: 1500,
			max_similarity: 0.78,
		}),
		detected_stack: SkillOpsDetectedStackConfigSchema.default({
			languages: [],
			frameworks: [],
		}),
		targets: z
			.array(RuntimeTargetSchema)
			.min(1)
			.default([...CORE_RUNTIME_TARGETS]),
	})
	.strict();
export type SkillOpsConfig = z.infer<typeof SkillOpsConfigSchema>;

export interface LoadedSkillOpsConfigResult {
	readonly config: SkillOpsConfig | null;
	readonly configPath: string;
	readonly exists: boolean;
	readonly error: string | null;
}

/**
 * Load and validate `.skillops.yml` from a repository root if present.
 */
export function loadSkillOpsConfig(
	repoPath: string,
): LoadedSkillOpsConfigResult {
	const configPath = `${repoPath.replace(/\\/g, "/").replace(/\/+$/, "")}/.skillops.yml`;
	if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) {
		return {
			config: null,
			configPath,
			exists: false,
			error: null,
		};
	}

	try {
		const rawYaml = fs.readFileSync(configPath, "utf-8");
		const parsedYaml: unknown = YAML.parse(rawYaml);
		const validated = SkillOpsConfigSchema.parse(parsedYaml);
		return {
			config: validated,
			configPath,
			exists: true,
			error: null,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			config: null,
			configPath,
			exists: true,
			error: message,
		};
	}
}
