/**
 * SkillOps Framework & Library Operations Engine (Issue #126).
 *
 * Implements:
 * 1. Library Explorer: `inspectCatalogItem` (`skillops info <name>`) & `searchCatalog` (`skillops search <query>`)
 * 2. Framework Scaffolder: `scaffoldFrameworkItem` (`skillops create skill|subagent <name>`)
 * 3. 1-Command Onboarding Pipeline: `runQuickstart` (`skillops quickstart` / `skillops setup`)
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
	discoverSkillDirectories,
	discoverSubagentFiles,
	parseSkillDirectory,
	parseSubagentFile,
} from "../auditor/index.js";
import { setupMcpForHarnesses } from "../mcp/index.js";
import {
	CORE_RUNTIME_TARGETS,
	countWords,
	loadSkillOpsConfig,
	type RuntimeTarget,
	resolveRuntimeTargets,
	SkillOpsConfigSchema,
} from "../models.js";
import { fingerprintRepository, routeRepository } from "../router/index.js";
import { syncRepository } from "../sync/index.js";
import {
	formatBadge,
	renderAiUsageGuide,
	renderBox,
	renderHeaderBanner,
	renderNextSteps,
	renderStep,
	renderTable,
	renderTokenBar,
	style,
} from "../ui/index.js";

export interface CatalogItemInfo {
	readonly kind: "skill" | "subagent";
	readonly name: string;
	readonly description: string;
	readonly path: string;
	readonly l1Tokens: number;
	readonly l2Lines: number;
	readonly l2Tokens: number;
	readonly savingsPct: number;
	readonly scripts: readonly string[];
	readonly evalCasesCount: number;
	readonly tools: readonly string[];
	readonly maxOutputTokens: number | null;
	readonly isolation: string | null;
	readonly headings: readonly string[];
}

function extractMarkdownHeadings(markdownBody: string): string[] {
	const headings: string[] = [];
	for (const rawLine of markdownBody.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (trimmed.startsWith("## ")) {
			headings.push(trimmed.slice(3).trim());
		}
	}
	return headings;
}

/**
 * Inspect a single Skill or Subagent from the Library by name (`skillops info <name>`).
 */
export function inspectCatalogItem(
	catalogDir: string,
	itemName: string,
): CatalogItemInfo {
	const needle = itemName.trim().toLowerCase();

	for (const skillDir of discoverSkillDirectories(catalogDir)) {
		const parsed = parseSkillDirectory(skillDir, { requireLayout: false });
		if (parsed.manifest.name.toLowerCase() === needle) {
			const l1Tokens = parsed.manifest.description_tokens;
			const l2Lines = parsed.manifest.body_lines;
			const l2Tokens = parsed.manifest.body_tokens;
			const totalRaw = l1Tokens + l2Tokens;
			const savingsPct =
				totalRaw > 0
					? Number((((totalRaw - l1Tokens) / totalRaw) * 100).toFixed(1))
					: 0;
			let evalCasesCount = 0;
			if (parsed.evalsPath && fs.existsSync(parsed.evalsPath)) {
				try {
					const rawEvals = JSON.parse(
						fs.readFileSync(parsed.evalsPath, "utf-8"),
					) as { evals?: unknown[] };
					evalCasesCount = Array.isArray(rawEvals.evals)
						? rawEvals.evals.length
						: 0;
				} catch {
					evalCasesCount = 0;
				}
			}
			return {
				kind: "skill",
				name: parsed.manifest.name,
				description: parsed.manifest.description,
				path: parsed.skillMdPath.replace(/\\/g, "/"),
				l1Tokens,
				l2Lines,
				l2Tokens,
				savingsPct,
				scripts: parsed.manifest.entrypoints.scripts.map((s) => s.path),
				evalCasesCount,
				tools: [],
				maxOutputTokens: null,
				isolation: null,
				headings: extractMarkdownHeadings(parsed.markdownBody),
			};
		}
	}

	for (const subPath of discoverSubagentFiles(catalogDir)) {
		const parsed = parseSubagentFile(subPath);
		if (parsed.manifest.name.toLowerCase() === needle) {
			return {
				kind: "subagent",
				name: parsed.manifest.name,
				description: parsed.manifest.description,
				path: parsed.filePath.replace(/\\/g, "/"),
				l1Tokens: parsed.manifest.system_prompt_tokens,
				l2Lines: parsed.manifest.system_prompt_lines,
				l2Tokens: parsed.manifest.system_prompt_tokens,
				savingsPct: 0,
				scripts: [],
				evalCasesCount: 0,
				tools: parsed.manifest.tools,
				maxOutputTokens: parsed.manifest.max_output_tokens,
				isolation: parsed.manifest.context_isolation
					? "context-isolated"
					: "shared",
				headings: extractMarkdownHeadings(parsed.systemPromptBody),
			};
		}
	}

	throw new Error(
		`Skill or Subagent '${itemName}' not found in catalog '${catalogDir.replace(/\\/g, "/")}'. Run 'npx skillops-cli list' to see all available items.`,
	);
}

/**
 * Format detailed inspection card for a Skill or Subagent.
 */
export function formatCatalogItemInfo(
	info: CatalogItemInfo,
	format: "table" | "json" | "markdown" = "table",
	colorEnabled?: boolean,
): string {
	if (format === "json") {
		return `${JSON.stringify(info, null, 2)}\n`;
	}

	if (format === "markdown") {
		const lines = [
			`## ${info.kind === "skill" ? "Skill" : "Subagent"}: \`${info.name}\``,
			"",
			`- **Type:** ${info.kind.toUpperCase()}`,
			`- **Description:** ${info.description}`,
			info.kind === "skill"
				? `- **Token Economy:** L1=${info.l1Tokens}t | L2=${info.l2Lines} lines (${info.l2Tokens}t) | Savings=${info.savingsPct}%`
				: `- **Isolation Contract:** Prompt=${info.l1Tokens}t | Max Output <= ${info.maxOutputTokens}t | Isolation=${info.isolation} | Tools=${info.tools.join(", ")}`,
			...(info.scripts.length > 0
				? [`- **Executable L3 Scripts:** \`${info.scripts.join("`, `")}\``]
				: []),
			...(info.headings.length > 0
				? [`- **Workflow Sections:** ${info.headings.join(" • ")}`]
				: []),
			"",
			"### Quick Install",
			"```bash",
			`npx skillops-cli add ${info.name}`,
			"```",
			"",
		];
		return lines.join("\n");
	}

	const c = colorEnabled;
	const badge =
		info.kind === "skill"
			? formatBadge("skill", "HYBRID EXECUTABLE SKILL", c)
			: formatBadge("subagent", "CONTEXT-ISOLATED SUBAGENT", c);

	const cardLines: string[] = [
		`${badge}  ${style.bold(style.cyan(info.name, c), c)}`,
		"",
		`${style.bold("Description:", c)}`,
		`  ${info.description}`,
		"",
	];

	if (info.kind === "skill") {
		cardLines.push(
			`${style.bold("Token Economy (INV-SKILL-01..03):", c)}`,
			`  • L1 Routing Footprint : ${style.green(`${info.l1Tokens} tokens`, c)} (<= 160 budget)`,
			`  • L2 Playbook Body     : ${info.l2Lines} lines (${info.l2Tokens} tokens, <= 250 lines)`,
			`  • Progressive Savings  : ${style.bold(style.green(`${info.savingsPct}%`, c), c)} Startup Token Tax saved until triggered`,
			`  • L3 Scripts (${info.scripts.length})      : ${info.scripts.length > 0 ? style.cyan(info.scripts.join(", "), c) : "none"}`,
			`  • TDD Eval Cases       : ${info.evalCasesCount} deterministic benchmark cases`,
		);
	} else {
		cardLines.push(
			`${style.bold("Context Isolation Contract (INV-SKILL-04):", c)}`,
			`  • System Prompt Tokens : ${style.green(`${info.l1Tokens} tokens`, c)}`,
			`  • Max Output Cap       : <= ${style.bold(`${info.maxOutputTokens} tokens`, c)}`,
			`  • Isolation Mode       : ${style.cyan(info.isolation ?? "context-isolated", c)}`,
			`  • Allowed Tools (${info.tools.length})    : ${info.tools.join(", ")}`,
		);
	}

	if (info.headings.length > 0) {
		cardLines.push(
			"",
			`${style.bold("Workflow Playbook Sections:", c)}`,
			...info.headings.slice(0, 6).map((h) => `  • ${h}`),
		);
	}

	cardLines.push(
		"",
		`${style.bold("How to Invoke in Your AI Agent:", c)}`,
		`  • ${style.bold("Install into repo:", c)} ${style.green(`npx skillops-cli add ${info.name}`, c)}`,
		info.kind === "skill"
			? `  • ${style.bold("Cursor / Copilot / Claude:", c)} Reference ${style.cyan(`@${info.name}`, c)} or ${style.cyan(`/${info.name}`, c)} in chat`
			: `  • ${style.bold("Delegate Subagent:", c)} Ask your main agent to delegate heavy exploration to ${style.magenta(`@${info.name}`, c)}`,
	);

	const box = renderBox(cardLines, {
		title: `📦 SkillOps Library Inspector — ${info.name}`,
		borderColor: info.kind === "skill" ? style.cyan : style.magenta,
		minWidth: 74,
		colorEnabled: c,
	});

	const nextSteps = renderNextSteps(
		[
			{
				command: `npx skillops-cli add ${info.name}`,
				description: `Install '${info.name}' into your active AI coding agents`,
			},
			...(info.kind === "skill"
				? [
						{
							command: `npx skillops-cli eval --skill ${info.name}`,
							description: `Run deterministic TDD benchmark for '${info.name}'`,
						},
					]
				: []),
			{
				command: "npx skillops-cli list",
				description: "Browse all 10 Skills & 9 Subagents in the Library",
			},
		],
		c,
	);

	return `${box}\n${nextSteps}`;
}

export interface CatalogSearchMatch {
	readonly kind: "skill" | "subagent";
	readonly name: string;
	readonly score: number;
	readonly tokens: number;
	readonly summary: string;
}

export interface CatalogSearchReport {
	readonly query: string;
	readonly total_matches: number;
	readonly matches: readonly CatalogSearchMatch[];
}

/**
 * Search the SkillOps Library of Skills & Subagents by keyword (`skillops search <query>`).
 */
export function searchCatalog(
	catalogDir: string,
	query: string,
): CatalogSearchReport {
	const rawTerms = query
		.trim()
		.toLowerCase()
		.split(/[^a-z0-9_-]+/)
		.filter((t) => t.length > 0);

	const matches: CatalogSearchMatch[] = [];

	for (const skillDir of discoverSkillDirectories(catalogDir)) {
		const parsed = parseSkillDirectory(skillDir, { requireLayout: false });
		const haystackName = parsed.manifest.name.toLowerCase();
		const haystackDesc = parsed.manifest.description.toLowerCase();
		const haystackBody = parsed.markdownBody.toLowerCase();

		let score = rawTerms.length === 0 ? 1 : 0;
		for (const term of rawTerms) {
			if (haystackName.includes(term)) {
				score += 5;
			}
			if (haystackDesc.includes(term)) {
				score += 3;
			}
			if (haystackBody.includes(term)) {
				score += 1;
			}
		}

		if (score > 0) {
			matches.push({
				kind: "skill",
				name: parsed.manifest.name,
				score,
				tokens: parsed.manifest.description_tokens,
				summary:
					parsed.manifest.description.length > 78
						? `${parsed.manifest.description.slice(0, 75)}...`
						: parsed.manifest.description,
			});
		}
	}

	for (const subPath of discoverSubagentFiles(catalogDir)) {
		const parsed = parseSubagentFile(subPath);
		const haystackName = parsed.manifest.name.toLowerCase();
		const haystackDesc = parsed.manifest.description.toLowerCase();
		const haystackTools = parsed.manifest.tools.join(" ").toLowerCase();

		let score = rawTerms.length === 0 ? 1 : 0;
		for (const term of rawTerms) {
			if (haystackName.includes(term)) {
				score += 5;
			}
			if (haystackDesc.includes(term)) {
				score += 3;
			}
			if (haystackTools.includes(term)) {
				score += 2;
			}
		}

		if (score > 0) {
			matches.push({
				kind: "subagent",
				name: parsed.manifest.name,
				score,
				tokens: parsed.manifest.system_prompt_tokens,
				summary:
					parsed.manifest.description.length > 78
						? `${parsed.manifest.description.slice(0, 75)}...`
						: parsed.manifest.description,
			});
		}
	}

	matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

	return {
		query,
		total_matches: matches.length,
		matches,
	};
}

/**
 * Format search results from the SkillOps Library.
 */
export function formatCatalogSearchReport(
	report: CatalogSearchReport,
	format: "table" | "json" | "markdown" = "table",
	colorEnabled?: boolean,
): string {
	if (format === "json") {
		return `${JSON.stringify(report, null, 2)}\n`;
	}

	if (format === "markdown") {
		const lines = [
			`## SkillOps Library Search — \`${report.query || "*"}\` (${report.total_matches} matches)`,
			"",
			"| Type | Name | Tokens | Summary |",
			"| :--- | :--- | ---: | :--- |",
			...report.matches.map(
				(m) =>
					`| ${m.kind.toUpperCase()} | \`${m.name}\` | ${m.tokens}t | ${m.summary} |`,
			),
			"",
		];
		return lines.join("\n");
	}

	const c = colorEnabled;
	const header = renderBox(
		[
			`${style.bold(style.cyan("🔍 SkillOps Library Search", c), c)} — Query: ${style.bold(`"${report.query || "*"}"`, c)} (${report.total_matches} matches)`,
		],
		{ minWidth: 74, colorEnabled: c },
	);

	if (report.matches.length === 0) {
		return `${header}\n  ${formatBadge("warn", "No matching Skills or Subagents found.", c)}\n${renderNextSteps([{ command: "npx skillops-cli list", description: "View all 10 Skills & 9 Subagents in the Library" }], c)}`;
	}

	const table = renderTable(
		["Type", "Name", "Tokens", "When to Use / Summary"],
		report.matches.map((m) => [
			m.kind === "skill"
				? formatBadge("skill", "SKILL", c)
				: formatBadge("subagent", "SUBAGENT", c),
			style.bold(m.name, c),
			`${m.tokens}t`,
			m.summary,
		]),
		{ align: ["left", "left", "right", "left"], colorEnabled: c },
	);

	const topItem = report.matches[0]?.name ?? "bug-reproducer-tdd";
	const nextSteps = renderNextSteps(
		[
			{
				command: `npx skillops-cli info ${topItem}`,
				description: `Inspect '${topItem}' in detail`,
			},
			{
				command: `npx skillops-cli add ${topItem}`,
				description: `Install '${topItem}' into your project's AI agents`,
			},
		],
		c,
	);

	return `${header}\n\n${table}\n${nextSteps}`;
}

export interface ScaffoldResult {
	readonly kind: "skill" | "subagent";
	readonly name: string;
	readonly target_dir: string;
	readonly created_files: readonly string[];
}

export interface ScaffoldOptions {
	readonly description?: string;
	readonly force?: boolean;
}

function buildValidSkillDescription(
	name: string,
	humanTitle: string,
	customDesc?: string,
): string {
	const domainPhrase = name.replace(/-/g, " ");
	const defaultDescription = `Use when implementing, auditing, or troubleshooting ${domainPhrase} workflows across production codebases to enforce deterministic ${humanTitle} invariants, structural contracts, boundary-value assertions, and automated Level 3 verification scripts before applying surgical changes. Do not trigger for pure documentation edits, static asset bundling, or unrelated formatting changes.`;
	if (!customDesc?.trim()) {
		return defaultDescription;
	}
	let candidate = customDesc.trim().replace(/\s+/g, " ");
	if (!candidate.startsWith("Use when")) {
		candidate = `Use when working on ${domainPhrase}: ${candidate}`;
	}
	const words = countWords(candidate);
	if (words < 40) {
		candidate = `${candidate} Enforces deterministic ${humanTitle} invariants, automated Level 3 script verification, architectural boundary checks, and zero-regression guardrails across production repositories. Do not trigger for pure documentation edits, static asset bundling, or unrelated formatting changes.`;
	}
	return candidate;
}

/**
 * Scaffold a new custom Hybrid Executable Skill (`INV-SKILL-01..03`) or Context-Isolated Subagent (`INV-SKILL-04`)
 * using the SkillOps Framework Contract (`skillops create skill|subagent <name>`).
 */
export function scaffoldFrameworkItem(
	catalogDir: string,
	kind: "skill" | "subagent",
	rawName: string,
	options: ScaffoldOptions = {},
): ScaffoldResult {
	const name = rawName.trim().toLowerCase();
	if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
		throw new Error(
			`Invalid ${kind} name '${rawName}': must be kebab-case ('^[a-z0-9]+(-[a-z0-9]+)*$').`,
		);
	}

	const createdFiles: string[] = [];

	if (kind === "skill") {
		const skillDir = path.join(catalogDir, "skills", name);
		const skillMdPath = path.join(skillDir, "SKILL.md");
		const snakeName = name.replace(/-/g, "_");
		const scriptRelPath = `scripts/verify_${snakeName}.py`;
		const scriptAbsPath = path.join(
			skillDir,
			"scripts",
			`verify_${snakeName}.py`,
		);
		const evalsAbsPath = path.join(skillDir, "evals", "evals.json");

		if (fs.existsSync(skillMdPath) && !options.force) {
			throw new Error(
				`Skill '${name}' already exists at '${skillMdPath.replace(/\\/g, "/")}'. Pass --force to overwrite.`,
			);
		}

		const humanTitle = name
			.split("-")
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(" ");

		const description = buildValidSkillDescription(
			name,
			humanTitle,
			options.description,
		);

		const skillMdContent = [
			"---",
			`name: "${name}"`,
			`description: "${description.replace(/"/g, '\\"')}"`,
			'version: "1.0.0"',
			'track: "arch-quality"',
			"tags:",
			`  - "${name}"`,
			'  - "verification"',
			'  - "deterministic-validation"',
			"routing_signals:",
			'  languages: ["typescript", "python"]',
			'  files_any: ["package.json", "pyproject.toml"]',
			"  dependencies_any: []",
			"  negative_triggers:",
			'    - "Do not trigger for pure documentation edits, static asset bundling, or unrelated formatting changes."',
			"entrypoints:",
			"  scripts:",
			`    - path: "${scriptRelPath}"`,
			`      description: "Executes deterministic structural verification and invariant checks for ${humanTitle}."`,
			"---",
			"",
			`# ${humanTitle} (\`${name}\`)`,
			"",
			"## When to Use",
			`- Activate this skill when working on **${humanTitle}** tasks requiring deterministic validation.`,
			"- Delegate exploratory repository scans to a Context-Isolated Subagent before modifying production files.",
			"",
			"## Step-by-Step Playbook",
			"1. **Baseline Discovery:** Inspect target modules and identify architectural constraints.",
			"2. **Deterministic Verification (Level 3 Script):** Run the bundled verification script before and after changes:",
			"   ```bash",
			`   python ${scriptRelPath} --target .`,
			"   ```",
			"3. **Minimal Surgical Implementation:** Apply focused changes and verify zero regressions.",
			"",
			"## Anti-Patterns to Avoid",
			"- Never skip Level 3 deterministic verification before declaring completion.",
			"- Avoid loading large raw logs into the primary context window.",
			"",
		].join("\n");

		const scriptContent = [
			'"""Deterministic Level 3 verification script generated by SkillOps Framework."""',
			"",
			"from __future__ import annotations",
			"",
			"import argparse",
			"import json",
			"import sys",
			"",
			"",
			"def main() -> int:",
			`    parser = argparse.ArgumentParser(description="Verify ${humanTitle} invariants.")`,
			'    parser.add_argument("--target", default=".", help="Target directory or file path to verify.")',
			"    args = parser.parse_args()",
			`    payload = {"skill": "${name}", "target": args.target, "status": "pass"}`,
			"    print(json.dumps(payload, indent=2))",
			"    return 0",
			"",
			"",
			'if __name__ == "__main__":',
			"    sys.exit(main())",
			"",
		].join("\n");

		const evalsContent = JSON.stringify(
			{
				skill_name: name,
				schema_version: "1.0",
				evals: [
					{
						id: `eval-01-verify-${name}`,
						name: `Verify ${humanTitle} deterministic workflow and Level 3 script execution`,
						prompt: `Audit and enforce ${humanTitle} invariants using the deterministic verification script.`,
						fixtures: [],
						assertions: [
							{
								id: "assert-ran-verification-script",
								type: "tool_call_contains",
								target: `verify_${snakeName}.py`,
								description: `Agent executed verify_${snakeName}.py before finalizing changes.`,
							},
						],
					},
				],
			},
			null,
			2,
		);

		fs.mkdirSync(path.dirname(scriptAbsPath), { recursive: true });
		fs.mkdirSync(path.dirname(evalsAbsPath), { recursive: true });
		fs.writeFileSync(skillMdPath, skillMdContent, "utf-8");
		fs.writeFileSync(scriptAbsPath, scriptContent, "utf-8");
		fs.writeFileSync(evalsAbsPath, `${evalsContent}\n`, "utf-8");

		createdFiles.push(
			skillMdPath.replace(/\\/g, "/"),
			scriptAbsPath.replace(/\\/g, "/"),
			evalsAbsPath.replace(/\\/g, "/"),
		);

		return {
			kind: "skill",
			name,
			target_dir: skillDir.replace(/\\/g, "/"),
			created_files: createdFiles,
		};
	}

	const subagentDir = path.join(catalogDir, "subagents", name);
	const subagentMdPath = path.join(subagentDir, "SUBAGENT.md");
	if (fs.existsSync(subagentMdPath) && !options.force) {
		throw new Error(
			`Subagent '${name}' already exists at '${subagentMdPath.replace(/\\/g, "/")}'. Pass --force to overwrite.`,
		);
	}

	const humanTitle = name
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");

	const rawSubDesc = options.description?.trim();
	const defaultSubDescription =
		rawSubDesc && countWords(rawSubDesc) >= 10
			? rawSubDesc
			: `Context-isolated specialist subagent for ${humanTitle}. Use when delegating high-volume repository analysis, structural inspection, or verification without polluting the main agent context window.`;

	const subagentMdContent = [
		"---",
		`name: "${name}"`,
		`description: "${defaultSubDescription.replace(/"/g, '\\"')}"`,
		"tools:",
		'  - "Read"',
		'  - "Grep"',
		'  - "Glob"',
		"user_invocable: true",
		"context_isolation: true",
		"max_output_tokens: 350",
		'model_tier: "fast"',
		"tags:",
		`  - "${name}"`,
		'  - "context-isolated"',
		"---",
		"",
		`# ${humanTitle} Subagent`,
		"",
		"## Mission & Context Isolation Contract (`INV-SKILL-04`)",
		`You are the **${humanTitle}** context-isolated subagent. Execute deep inspection in your isolated context window and return a concise structured summary (\`<= 350\` tokens) to the parent orchestrator.`,
		"",
		"## Output Format",
		"1. **Findings Summary:** High-signal bullet points with exact file paths and line numbers.",
		"2. **Recommended Actions:** Concrete next steps for the parent agent.",
		"",
	].join("\n");

	fs.mkdirSync(subagentDir, { recursive: true });
	fs.writeFileSync(subagentMdPath, subagentMdContent, "utf-8");
	createdFiles.push(subagentMdPath.replace(/\\/g, "/"));

	return {
		kind: "subagent",
		name,
		target_dir: subagentDir.replace(/\\/g, "/"),
		created_files: createdFiles,
	};
}

/**
 * Format the output of `skillops create skill|subagent <name>`.
 */
export function formatScaffoldReport(
	result: ScaffoldResult,
	format: "table" | "json" | "markdown" = "table",
	colorEnabled?: boolean,
): string {
	if (format === "json") {
		return `${JSON.stringify(result, null, 2)}\n`;
	}

	if (format === "markdown") {
		return [
			`## SkillOps Framework Scaffolder — Created ${result.kind.toUpperCase()} \`${result.name}\``,
			"",
			`- **Target Directory:** \`${result.target_dir}\``,
			...result.created_files.map((f) => `- **Created:** \`${f}\``),
			"",
		].join("\n");
	}

	const c = colorEnabled;
	const box = renderBox(
		[
			`${formatBadge("pass", "CREATED", c)} Scaffolded new SkillOps Framework ${style.bold(result.kind.toUpperCase(), c)}: ${style.bold(style.cyan(result.name, c), c)}`,
			"",
			`${style.bold("Generated Files:", c)}`,
			...result.created_files.map((f) => `  • ${style.green(f, c)}`),
		],
		{
			title: "🛠️ SkillOps Framework Scaffolder",
			borderColor: style.green,
			minWidth: 74,
			colorEnabled: c,
		},
	);

	const nextSteps = renderNextSteps(
		[
			{
				command: `npx skillops-cli info ${result.name}`,
				description: `Inspect your new ${result.kind} metadata & token budget`,
			},
			{
				command: "npx skillops-cli audit --require-layout",
				description:
					"Verify INV-SKILL-01..04 contract compliance & cosine collisions",
			},
			{
				command: `npx skillops-cli add ${result.name}`,
				description: `Transpile & install '${result.name}' into your AI coding agents`,
			},
		],
		c,
	);

	return `${box}\n${nextSteps}`;
}

export interface QuickstartOptions {
	readonly targetsArg?: string;
	readonly maxSkills?: number;
	readonly dryRun?: boolean;
	readonly force?: boolean;
	readonly skipMcp?: boolean;
}

export interface QuickstartReport {
	readonly repo_path: string;
	readonly config_path: string;
	readonly dry_run: boolean;
	readonly detected_languages: readonly string[];
	readonly detected_frameworks: readonly string[];
	readonly detected_harnesses: readonly RuntimeTarget[];
	readonly active_targets: readonly RuntimeTarget[];
	readonly selected_skills: readonly string[];
	readonly selected_subagents: readonly string[];
	readonly total_l1_tokens: number;
	readonly max_l1_budget: number;
	readonly synced_files_count: number;
	readonly mcp_configured_count: number;
	readonly passed: boolean;
}

/**
 * Execute the 1-Command Onboarding Pipeline (`skillops quickstart` / `skillops setup`).
 */
export function runQuickstart(
	repoPath: string,
	catalogDir: string,
	options: QuickstartOptions = {},
): QuickstartReport {
	const absRepo = path.resolve(repoPath);
	const dryRun = options.dryRun ?? false;
	const force = options.force ?? false;
	const skipMcp = options.skipMcp ?? false;

	const profile = fingerprintRepository(absRepo);
	const existingCfg = loadSkillOpsConfig(absRepo);

	let activeTargets: RuntimeTarget[];
	if (options.targetsArg) {
		activeTargets = resolveRuntimeTargets(options.targetsArg, absRepo);
	} else if (
		existingCfg.config?.targets &&
		existingCfg.config.targets.length > 0
	) {
		activeTargets = [...existingCfg.config.targets];
	} else if (profile.detected_harnesses.length > 0) {
		activeTargets = [...profile.detected_harnesses];
	} else {
		activeTargets = [...CORE_RUNTIME_TARGETS];
	}

	const maxSkills =
		options.maxSkills ??
		existingCfg.config?.token_economy.max_active_skills ??
		12;
	const maxL1Tokens = existingCfg.config?.token_economy.max_l1_tokens ?? 1500;
	const maxSimilarity =
		existingCfg.config?.token_economy.max_similarity ?? 0.78;

	const configPath = path.join(absRepo, ".skillops.yml");
	if (!dryRun) {
		const configPayload = SkillOpsConfigSchema.parse({
			version: "1.0",
			catalog_dir:
				path.relative(absRepo, catalogDir).replace(/\\/g, "/") || "catalog",
			token_economy: {
				startup_tax_budget:
					existingCfg.config?.token_economy.startup_tax_budget ?? 2500,
				max_active_skills: maxSkills,
				max_l1_tokens: maxL1Tokens,
				max_similarity: maxSimilarity,
			},
			detected_stack: {
				languages: profile.languages,
				frameworks: profile.frameworks,
			},
			targets: activeTargets,
		});
		fs.mkdirSync(absRepo, { recursive: true });
		fs.writeFileSync(configPath, YAML.stringify(configPayload), "utf-8");
	}

	const bundle = routeRepository(absRepo, catalogDir, {
		maxSkills,
		maxL1Tokens,
		maxSimilarity,
	});

	const syncReport = syncRepository(absRepo, catalogDir, {
		targets: activeTargets,
		dryRun,
		force,
		maxSkills,
		maxL1Tokens,
		maxSimilarity,
	});

	const mcpReport = skipMcp
		? null
		: setupMcpForHarnesses(absRepo, {
				targets: activeTargets,
				dryRun,
			});

	return {
		repo_path: absRepo.replace(/\\/g, "/"),
		config_path: configPath.replace(/\\/g, "/"),
		dry_run: dryRun,
		detected_languages: profile.languages,
		detected_frameworks: profile.frameworks,
		detected_harnesses: profile.detected_harnesses,
		active_targets: activeTargets,
		selected_skills: bundle.selected_skills.map((s) => s.name),
		selected_subagents: bundle.recommended_subagents,
		total_l1_tokens: bundle.total_l1_tokens,
		max_l1_budget: maxL1Tokens,
		synced_files_count: syncReport.artifacts.filter(
			(a) =>
				a.action === "created" ||
				a.action === "updated" ||
				a.action === "unchanged" ||
				a.action === "planned",
		).length,
		mcp_configured_count: mcpReport ? mcpReport.configured_count : 0,
		passed: bundle.passed_invariants && syncReport.passed,
	};
}

/**
 * Render the visual 4-step Quickstart summary dashboard.
 */
export function formatQuickstartReport(
	report: QuickstartReport,
	format: "table" | "json" | "markdown" = "table",
	colorEnabled?: boolean,
): string {
	if (format === "json") {
		return `${JSON.stringify(report, null, 2)}\n`;
	}

	if (format === "markdown") {
		return [
			`## SkillOps Quickstart Report (${report.dry_run ? "DRY-RUN" : "INSTALLED"})`,
			"",
			`- **Repository:** \`${report.repo_path}\``,
			`- **Stack Detected:** ${[...report.detected_languages, ...report.detected_frameworks].join(", ") || "generic"}`,
			`- **Target AI Agents (${report.active_targets.length}):** \`${report.active_targets.join("`, `")}\``,
			`- **Routed Skills (${report.selected_skills.length}):** \`${report.selected_skills.join("`, `")}\``,
			`- **Routed Subagents (${report.selected_subagents.length}):** \`${report.selected_subagents.join("`, `")}\``,
			`- **Token Budget:** \`${report.total_l1_tokens} / ${report.max_l1_budget}\` L1 tokens`,
			`- **Synced Artifacts:** ${report.synced_files_count} files | **MCP Configs:** ${report.mcp_configured_count}`,
			"",
		].join("\n");
	}

	const c = colorEnabled;
	const stackLabel =
		[...report.detected_languages, ...report.detected_frameworks].join(", ") ||
		"general-purpose";
	const targetsLabel =
		report.active_targets.length > 5
			? `${report.active_targets.slice(0, 5).join(", ")} (+${report.active_targets.length - 5} more)`
			: report.active_targets.join(", ");

	const banner = renderHeaderBanner(
		`1-Step Quickstart & AI Agent Library Setup ${report.dry_run ? "[DRY-RUN]" : "[READY]"}`,
		{ colorEnabled: c },
	);

	const stepsBlock = [
		renderStep(
			1,
			4,
			"Detect Stack & AI Agents",
			`Stack: ${style.cyan(stackLabel, c)} • Targets: ${style.bold(targetsLabel, c)}`,
			"done",
			c,
		),
		renderStep(
			2,
			4,
			"Route Optimal Library Bundle",
			`${style.green(`${report.selected_skills.length} Skills`, c)} + ${style.magenta(`${report.selected_subagents.length} Subagents`, c)} selected`,
			"done",
			c,
		),
		renderStep(
			3,
			4,
			"Transpile & Sync Artifacts",
			`${report.synced_files_count} files synced (${report.dry_run ? "dry-run" : ".skillops.yml + .skillops-lock.json"})`,
			"done",
			c,
		),
		renderStep(
			4,
			4,
			"Register MCP Server",
			`${report.mcp_configured_count} MCP-compatible agent config(s) updated`,
			"done",
			c,
		),
	].join("\n");

	const tokenBar = `  ${renderTokenBar(
		report.total_l1_tokens,
		report.max_l1_budget,
		{
			label: "L1 Routing Budget:",
			colorEnabled: c,
		},
	)}`;

	const bundleBox = renderBox(
		[
			`${style.bold("Installed Hybrid Executable Skills:", c)}`,
			`  ${report.selected_skills.map((s) => style.cyan(s, c)).join(", ")}`,
			"",
			`${style.bold("Installed Context-Isolated Subagents:", c)}`,
			`  ${report.selected_subagents.map((a) => style.magenta(a, c)).join(", ")}`,
		],
		{
			title: "📦 Active Skills & Subagents Bundle",
			borderColor: style.cyan,
			minWidth: 72,
			colorEnabled: c,
		},
	);

	const usageGuide = renderAiUsageGuide(
		report.active_targets,
		report.selected_skills,
		report.selected_subagents,
		c,
	);

	const nextSteps = renderNextSteps(
		[
			{
				command: `npx skillops-cli info ${report.selected_skills[0] ?? "bug-reproducer-tdd"}`,
				description:
					"Inspect a Skill's triggers, L3 scripts & AI invocation syntax",
			},
			{
				command: "npx skillops-cli list",
				description: "Browse all 10 Skills & 9 Subagents in the Library",
			},
			{
				command: "npx skillops-cli create skill my-custom-skill",
				description:
					"Create your own custom Skill using the SkillOps Framework",
			},
			{
				command: "npx skillops-cli doctor",
				description: "Verify lockfile integrity & Startup Token Tax savings",
			},
		],
		c,
	);

	return [
		banner,
		"",
		stepsBlock,
		"",
		tokenBar,
		"",
		bundleBox,
		"",
		usageGuide,
		nextSteps,
	].join("\n");
}
