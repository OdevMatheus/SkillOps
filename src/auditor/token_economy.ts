/**
 * Repository Token Economy & Startup Context Tax Analyzer (`npx skillops@latest tokens`).
 *
 * Implements Issue #60:
 * - Scans always-on repository instruction files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
 *   `.github/copilot-instructions.md`), `.cursor/rules/*.mdc`, and `.mcp.json` / `.cursor/mcp.json`.
 * - Scans catalog/repository Skills (L1 frontmatter vs L2 Markdown body vs L3 zero-token scripts)
 *   and Context-Isolated Subagents (`SUBAGENT.md` / `*.agent.md`).
 * - Quantifies Startup Token Tax, Monolithic Equivalent Tokens, Progressive Disclosure L1 Tokens,
 *   Estimated Tokens Saved, Token Savings %, and actionable TokenWasteHotspot items.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  type TokenEconomyReport,
  TokenEconomyReportSchema,
  type TokenFileEntry,
  type TokenWasteHotspot,
  estimateTokenCount,
  splitFrontmatter,
} from "../models.js";
import {
  discoverSkillDirectories,
  discoverSubagentFiles,
  parseSkillDirectory,
  parseSubagentFile,
} from "./parser.js";

export interface AnalyzeTokenEconomyOptions {
  readonly catalogDir?: string;
  readonly startupTaxBudget?: number;
}

const ALWAYS_ON_INSTRUCTION_CANDIDATES = [
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  ".github/copilot-instructions.md",
] as const;

const MCP_CONFIG_CANDIDATES = [".mcp.json", ".cursor/mcp.json"] as const;

/**
 * Unisolated exploration token baseline per subagent delegation when an agent lacks
 * context-isolated subagents (grep + file reads + intermediate reasoning in parent window).
 */
const UNISOLATED_SUBAGENT_EXPLORATION_TOKENS = 1200;

/**
 * Average tool schema overhead per active MCP server injected into every startup turn.
 */
const MCP_SERVER_SCHEMA_OVERHEAD_TOKENS = 180;

function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  const lines = text.split(/\r?\n/);
  return text.endsWith("\n") ? lines.length - 1 : lines.length;
}

function toPosixRelative(baseDir: string, targetPath: string): string {
  const rel = path.relative(baseDir, targetPath).replace(/\\/g, "/");
  return rel && !rel.startsWith("..") ? rel : path.basename(targetPath);
}

/**
 * Analyze a repository's Startup Token Tax and Progressive Disclosure savings.
 */
export function analyzeRepoTokenEconomy(
  repoPath: string,
  options: AnalyzeTokenEconomyOptions = {},
): TokenEconomyReport {
  const resolvedRepo = path.resolve(repoPath);
  const resolvedCatalog = options.catalogDir
    ? path.resolve(options.catalogDir)
    : path.join(resolvedRepo, "catalog");
  const startupTaxBudget = options.startupTaxBudget ?? 2500;

  const inspectedFiles: TokenFileEntry[] = [];
  const hotspots: TokenWasteHotspot[] = [];

  let startupTokenTax = 0;

  // 1. Scan Always-On Root Instruction Files (CLAUDE.md, AGENTS.md, GEMINI.md, etc.)
  const foundAlwaysOnDocs: { relPath: string; tokens: number; rawText: string }[] = [];
  for (const relCandidate of ALWAYS_ON_INSTRUCTION_CANDIDATES) {
    const fullPath = path.join(resolvedRepo, relCandidate);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const rawText = fs.readFileSync(fullPath, "utf-8");
      const lines = countLines(rawText);
      const tokens = estimateTokenCount(rawText);
      startupTokenTax += tokens;
      foundAlwaysOnDocs.push({ relPath: relCandidate, tokens, rawText });

      inspectedFiles.push({
        path: relCandidate,
        category: "always_on_instructions",
        always_loaded_on_startup: true,
        lines,
        estimated_tokens: tokens,
        notes: "Always-on root instruction file loaded into every session startup.",
      });

      if (tokens > 1500) {
        hotspots.push({
          path: relCandidate,
          severity: "CRITICAL",
          wasted_tokens: tokens - 600,
          issue: `Oversized always-on instruction file (${tokens} tokens across ${lines} lines) inflates every turn.`,
          recommendation:
            "Keep root instruction files <= 600 tokens and extract domain playbooks into on-demand Level 2/3 Skills.",
        });
      } else if (tokens > 700) {
        hotspots.push({
          path: relCandidate,
          severity: "HIGH",
          wasted_tokens: tokens - 500,
          issue: `Large always-on instruction file (${tokens} tokens) increases baseline Startup Token Tax.`,
          recommendation:
            "Move specialized architectural checklists and long examples into progressive-disclosure Skills.",
        });
      }
    }
  }

  // Detect duplicate CLAUDE.md + AGENTS.md without @AGENTS.md pointer
  const claudeDoc = foundAlwaysOnDocs.find((d) => d.relPath === "CLAUDE.md");
  const agentsDoc = foundAlwaysOnDocs.find((d) => d.relPath === "AGENTS.md");
  if (
    claudeDoc &&
    agentsDoc &&
    claudeDoc.tokens > 200 &&
    agentsDoc.tokens > 200 &&
    !claudeDoc.rawText.includes("@AGENTS.md")
  ) {
    hotspots.push({
      path: "CLAUDE.md + AGENTS.md",
      severity: "HIGH",
      wasted_tokens: Math.min(claudeDoc.tokens, agentsDoc.tokens),
      issue:
        "Duplicate root instruction files ('CLAUDE.md' and 'AGENTS.md') both contain full prose without '@AGENTS.md' delegation.",
      recommendation:
        "Keep canonical repo instructions in AGENTS.md and make CLAUDE.md a lightweight pointer or run 'npx skillops sync'.",
    });
  }

  // 2. Scan .cursor/rules/*.mdc for Always-On rules (`alwaysApply: true` or missing globs)
  const cursorRulesDir = path.join(resolvedRepo, ".cursor", "rules");
  if (fs.existsSync(cursorRulesDir) && fs.statSync(cursorRulesDir).isDirectory()) {
    const entries = fs
      .readdirSync(cursorRulesDir, { withFileTypes: true })
      .filter((e) => e.isFile() && (e.name.endsWith(".mdc") || e.name.endsWith(".md")))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(cursorRulesDir, entry.name);
      const relPath = `.cursor/rules/${entry.name}`;
      const rawText = fs.readFileSync(fullPath, "utf-8");
      const lines = countLines(rawText);
      const tokens = estimateTokenCount(rawText);

      let alwaysApply = false;
      try {
        const [fm] = splitFrontmatter(rawText, relPath);
        alwaysApply = fm.alwaysApply === true;
      } catch {
        // If frontmatter is missing in an .mdc file, treat as un-scoped rule
        alwaysApply = true;
      }

      if (alwaysApply) {
        startupTokenTax += tokens;
      }

      inspectedFiles.push({
        path: relPath,
        category: "always_on_cursor_rule",
        always_loaded_on_startup: alwaysApply,
        lines,
        estimated_tokens: tokens,
        notes: alwaysApply
          ? "Cursor rule with alwaysApply: true (loaded into every turn)."
          : "Scoped Cursor rule (loaded on demand).",
      });

      if (alwaysApply && tokens > 250) {
        hotspots.push({
          path: relPath,
          severity: tokens > 600 ? "CRITICAL" : "HIGH",
          wasted_tokens: Math.max(1, tokens - 80),
          issue: `Unscoped Cursor rule '${relPath}' sets 'alwaysApply: true' (${tokens} tokens).`,
          recommendation:
            "Set 'alwaysApply: false' and add explicit 'globs' or convert into a Progressive Disclosure Skill.",
        });
      }
    }
  }

  // 3. Scan MCP Server Configurations (.mcp.json, .cursor/mcp.json)
  for (const relMcp of MCP_CONFIG_CANDIDATES) {
    const fullMcp = path.join(resolvedRepo, relMcp);
    if (fs.existsSync(fullMcp) && fs.statSync(fullMcp).isFile()) {
      const rawText = fs.readFileSync(fullMcp, "utf-8");
      const lines = countLines(rawText);
      let serverCount = 0;
      try {
        const parsed = YAML.parse(rawText) as Record<string, unknown> | null;
        if (parsed && typeof parsed === "object") {
          const serversObj =
            (parsed.mcpServers as Record<string, unknown> | undefined) ??
            (parsed.servers as Record<string, unknown> | undefined);
          if (serversObj && typeof serversObj === "object") {
            serverCount = Object.keys(serversObj).length;
          }
        }
      } catch {
        serverCount = 1;
      }

      const rawTokens = estimateTokenCount(rawText);
      const estimatedMcpTax = rawTokens + serverCount * MCP_SERVER_SCHEMA_OVERHEAD_TOKENS;
      startupTokenTax += estimatedMcpTax;

      inspectedFiles.push({
        path: relMcp,
        category: "mcp_schema_tax",
        always_loaded_on_startup: true,
        lines,
        estimated_tokens: estimatedMcpTax,
        notes: `MCP configuration (${serverCount} server(s)) injecting tool JSON schemas at startup.`,
      });

      if (serverCount > 3 || estimatedMcpTax > 400) {
        hotspots.push({
          path: relMcp,
          severity: serverCount >= 8 || estimatedMcpTax > 1500 ? "CRITICAL" : "HIGH",
          wasted_tokens: Math.max(1, estimatedMcpTax - 300),
          issue: `MCP config '${relMcp}' registers ${serverCount} always-on server(s) (~${estimatedMcpTax} startup schema tokens).`,
          recommendation:
            "Replace heavy always-on MCP tool schemas with zero-token Level 3 CLI scripts or disable unused MCP servers.",
        });
      }
    }
  }

  // 4. Scan Catalog Skills (L1 Frontmatter vs L2 Markdown Body vs L3 Scripts)
  const skillDirs = discoverSkillDirectories(resolvedCatalog);
  let progressiveDisclosureL1Tokens = 0;
  let monolithicEquivalentTokens = 0;
  let zeroTokenL3ScriptsCount = 0;

  for (const skillDir of skillDirs) {
    try {
      const parsed = parseSkillDirectory(skillDir, { requireLayout: false });
      const relSkillMd = toPosixRelative(resolvedRepo, parsed.skillMdPath);
      const l1Tokens = parsed.manifest.description_tokens;
      const l2Tokens = parsed.manifest.body_tokens;

      progressiveDisclosureL1Tokens += l1Tokens;
      startupTokenTax += l1Tokens;
      monolithicEquivalentTokens += l1Tokens + l2Tokens;

      inspectedFiles.push({
        path: `${relSkillMd}#L1-frontmatter`,
        category: "skill_l1_metadata",
        always_loaded_on_startup: true,
        lines: Math.max(1, parsed.totalLines - parsed.manifest.body_lines),
        estimated_tokens: l1Tokens,
        notes: `Skill '${parsed.manifest.name}' Level 1 routing description (<=120 tokens).`,
      });

      inspectedFiles.push({
        path: `${relSkillMd}#L2-body`,
        category: "skill_l2_body",
        always_loaded_on_startup: false,
        lines: parsed.manifest.body_lines,
        estimated_tokens: l2Tokens,
        notes: `Skill '${parsed.manifest.name}' Level 2 playbook loaded only when triggered.`,
      });

      for (const scriptPath of parsed.declaredScripts) {
        const scriptRaw = fs.readFileSync(scriptPath, "utf-8");
        const scriptLines = countLines(scriptRaw);
        const scriptTokens = estimateTokenCount(scriptRaw);
        zeroTokenL3ScriptsCount += 1;
        monolithicEquivalentTokens += scriptTokens;

        inspectedFiles.push({
          path: toPosixRelative(resolvedRepo, scriptPath),
          category: "skill_l3_script",
          always_loaded_on_startup: false,
          lines: scriptLines,
          estimated_tokens: scriptTokens,
          notes: `Zero-token Level 3 executable script (${scriptTokens} source tokens kept out of prompt context).`,
        });
      }
    } catch {
      // Skip malformed skill directories during token economy scan
    }
  }

  // 5. Scan Context-Isolated Subagents (SUBAGENT.md / *.agent.md)
  const subagentFiles = discoverSubagentFiles(resolvedCatalog);
  let contextIsolatedSubagentsCount = 0;

  for (const saFile of subagentFiles) {
    try {
      const parsedSa = parseSubagentFile(saFile);
      contextIsolatedSubagentsCount += 1;
      const descTokens = parsedSa.manifest.description_tokens;
      const promptTokens = parsedSa.manifest.system_prompt_tokens;

      progressiveDisclosureL1Tokens += descTokens;
      monolithicEquivalentTokens +=
        descTokens + promptTokens + UNISOLATED_SUBAGENT_EXPLORATION_TOKENS;

      inspectedFiles.push({
        path: toPosixRelative(resolvedRepo, saFile),
        category: "subagent_definition",
        always_loaded_on_startup: false,
        lines: countLines(parsedSa.rawText),
        estimated_tokens: promptTokens,
        notes: `Context-isolated subagent '${parsedSa.manifest.name}' (caps output to <=${parsedSa.manifest.max_output_tokens} tokens).`,
      });
    } catch {
      // Skip malformed subagent files during token economy scan
    }
  }

  const estimatedTokensSaved = Math.max(
    0,
    monolithicEquivalentTokens - progressiveDisclosureL1Tokens,
  );
  const tokenSavingsPct =
    monolithicEquivalentTokens > 0
      ? Number(((estimatedTokensSaved / monolithicEquivalentTokens) * 100).toFixed(2))
      : 0;

  return TokenEconomyReportSchema.parse({
    repo_path: resolvedRepo.replace(/\\/g, "/"),
    catalog_path: resolvedCatalog.replace(/\\/g, "/"),
    startup_token_tax: startupTokenTax,
    startup_tax_budget: startupTaxBudget,
    monolithic_equivalent_tokens: monolithicEquivalentTokens,
    progressive_disclosure_l1_tokens: progressiveDisclosureL1Tokens,
    zero_token_l3_scripts_count: zeroTokenL3ScriptsCount,
    context_isolated_subagents_count: contextIsolatedSubagentsCount,
    estimated_tokens_saved: estimatedTokensSaved,
    token_savings_pct: tokenSavingsPct,
    inspected_files: inspectedFiles,
    hotspots,
    passed_budget: startupTokenTax <= startupTaxBudget,
  });
}

/**
 * Render a TokenEconomyReport as a human-readable ASCII table, Markdown report, or JSON string.
 */
export function formatTokenEconomyReport(
  report: TokenEconomyReport,
  format: "table" | "json" | "markdown" = "table",
): string {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  if (format === "markdown") {
    const lines: string[] = [
      "## SkillOps Token Economy & Startup Context Tax Report",
      "",
      `- **Startup Token Tax**: \`${report.startup_token_tax}\` / \`${report.startup_tax_budget}\` tokens (${report.passed_budget ? "PASS" : "OVER BUDGET"})`,
      `- **Monolithic Equivalent Tokens**: \`${report.monolithic_equivalent_tokens}\` tokens`,
      `- **Progressive Disclosure L1 Tokens**: \`${report.progressive_disclosure_l1_tokens}\` tokens`,
      `- **Estimated Tokens Saved**: \`${report.estimated_tokens_saved}\` tokens (**${report.token_savings_pct.toFixed(2)}%** reduction)`,
      `- **Zero-Token Level 3 Scripts**: \`${report.zero_token_l3_scripts_count}\``,
      `- **Context-Isolated Subagents**: \`${report.context_isolated_subagents_count}\``,
      "",
      "| Category | File Path | Startup Loaded | Lines | Est. Tokens |",
      "| :--- | :--- | :---: | ---: | ---: |",
      ...report.inspected_files.map(
        (f) =>
          `| \`${f.category}\` | \`${f.path}\` | ${f.always_loaded_on_startup ? "YES" : "NO"} | ${f.lines} | ${f.estimated_tokens} |`,
      ),
    ];

    if (report.hotspots.length > 0) {
      lines.push(
        "",
        "### Detected Token Waste Hotspots",
        "",
        "| Severity | Path | Wasted Tokens | Issue | Recommendation |",
        "| :---: | :--- | ---: | :--- | :--- |",
        ...report.hotspots.map(
          (h) =>
            `| **${h.severity}** | \`${h.path}\` | ${h.wasted_tokens} | ${h.issue} | ${h.recommendation} |`,
        ),
      );
    }

    return `${lines.join("\n")}\n`;
  }

  const lines: string[] = [
    "=== SkillOps Token Economy & Startup Context Tax Analyzer ===",
    `Startup Token Tax        : ${report.startup_token_tax} / ${report.startup_tax_budget} tokens [${report.passed_budget ? "PASS" : "OVER BUDGET"}]`,
    `Monolithic Equivalent    : ${report.monolithic_equivalent_tokens} tokens`,
    `Progressive L1 Footprint : ${report.progressive_disclosure_l1_tokens} tokens`,
    `Token Savings            : ${report.estimated_tokens_saved} tokens (${report.token_savings_pct.toFixed(2)}% saved)`,
    `Level 3 Zero-Token Tools : ${report.zero_token_l3_scripts_count} scripts`,
    `Context-Isolated Agents  : ${report.context_isolated_subagents_count} subagents`,
  ];

  if (report.hotspots.length > 0) {
    lines.push("", "Token Waste Hotspots:");
    for (const h of report.hotspots) {
      lines.push(
        `  [${h.severity}] ${h.path} (~${h.wasted_tokens} wasted tokens): ${h.issue}`,
        `    -> Fix: ${h.recommendation}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
