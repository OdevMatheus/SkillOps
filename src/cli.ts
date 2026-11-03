/**
 * SkillOps NPX CLI Entrypoint (`npx skillops@latest <command>`).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import {
  analyzeRepoTokenEconomy,
  auditCatalog,
  auditCatalogTokenBudgets,
  diagnoseRepository,
  formatDoctorReport,
  formatTokenEconomyReport,
} from "./auditor/index.js";
import { evaluateCatalog, formatEvalSummary } from "./eval/index.js";
import { startMcpStdioServer } from "./mcp/index.js";
import {
  ALL_RUNTIME_TARGETS,
  ExitCode,
  type RuntimeTarget,
  SKILLOPS_VERSION,
  type SkillOpsConfig,
  SkillOpsConfigSchema,
  loadSkillOpsConfig,
} from "./models.js";
import {
  fingerprintRepository,
  formatRoutedBundle,
  routeRepository,
} from "./router/index.js";
import {
  addSkillOrSubagent,
  cleanSyncedArtifacts,
  formatSyncReport,
  removeSkillOrSubagent,
  syncRepository,
} from "./sync/index.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveCatalogDir(
  args: readonly string[],
  repoPath?: string,
  loadedConfig?: SkillOpsConfig | null,
): string {
  const catalogIdx = args.indexOf("--catalog");
  if (catalogIdx !== -1 && args[catalogIdx + 1]) {
    return path.resolve(args[catalogIdx + 1]!);
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

export function runCli(argv: readonly string[]): number {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      [
        `SkillOps v${SKILLOPS_VERSION} — The Zero-API NPX Engine for High-End AI Skills & Subagents`,
        "",
        "Usage: npx skillops@latest <command> [options]",
        "",
        "Commands:",
        "  init      Scaffold .skillops.yml and detect repository agent harnesses",
        "  list      Browse bundled high-end Skills & Subagents with token budgets",
        "  add       Install a specific high-end Skill or Subagent into active runtimes",
        "  remove    Surgically uninstall a synced Skill or Subagent from active runtimes",
        "  clean     Remove all SkillOps-managed runtime artifacts tracked in .skillops-lock.json",
        "  doctor    Diagnose Node/Python environment, .skillops.yml config & lockfile SHA-256 drift",
        "  status    Alias for 'doctor' — inspect repository lockfile drift and token tax status",
        "  tokens    Analyze repository Startup Token Tax and Progressive Disclosure savings",
        "  audit     Run L1/L2/L3 token budget linter, Subagent check & collision matrix",
        "  route     Fingerprint repository stack and compile optimal <=12 skill bundle",
        "  sync      Transpile Skills & Subagents across Claude, Antigravity, Cursor, Codex & Copilot",
        "  eval      Execute zero-API deterministic TDD benchmarks (with_skill vs without_skill)",
        "  mcp       Start native JSON-RPC 2.0 stdio Model Context Protocol server",
        "",
      ].join("\n"),
    );
    return ExitCode.SUCCESS;
  }

  if (args.includes("--version") || args.includes("-V") || args[0] === "version") {
    process.stdout.write(`skillops ${SKILLOPS_VERSION}\n`);
    return ExitCode.SUCCESS;
  }

  const command = args[0];

  if (command === "init") {
    const repoIdx = args.indexOf("--repo");
    const repoPath = path.resolve(
      repoIdx !== -1 && args[repoIdx + 1] ? args[repoIdx + 1]! : process.cwd(),
    );
    const catalogDir = resolveCatalogDir(args, repoPath);
    const profile = fingerprintRepository(repoPath);

    const configPayload = SkillOpsConfigSchema.parse({
      version: "1.0",
      catalog_dir: path.relative(repoPath, catalogDir).replace(/\\/g, "/") || "catalog",
      token_economy: {
        startup_tax_budget: 2500,
        max_active_skills: 12,
        max_l1_tokens: 1500,
        max_similarity: 0.78,
      },
      detected_stack: {
        languages: profile.languages,
        frameworks: profile.frameworks,
      },
      targets: [...ALL_RUNTIME_TARGETS],
    });

    const configPath = path.join(repoPath, ".skillops.yml");
    fs.mkdirSync(repoPath, { recursive: true });
    fs.writeFileSync(configPath, YAML.stringify(configPayload), "utf-8");
    process.stdout.write(
      `Initialized SkillOps configuration at ${configPath.replace(/\\/g, "/")}\n`,
    );
    return ExitCode.SUCCESS;
  }

  if (command === "list") {
    const repoIdx = args.indexOf("--repo");
    const repoPath =
      repoIdx !== -1 && args[repoIdx + 1] ? args[repoIdx + 1]! : process.cwd();
    const cfgRes = loadSkillOpsConfig(repoPath);
    if (cfgRes.error) {
      process.stderr.write(`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`);
      return ExitCode.BUDGET_OR_CONTRACT_ERROR;
    }
    const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
    const formatIdx = args.indexOf("--format");
    const rawFormat = formatIdx !== -1 && args[formatIdx + 1] ? args[formatIdx + 1]! : "table";
    const summary = auditCatalogTokenBudgets(catalogDir, { requireLayout: false });

    if (rawFormat === "json") {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return ExitCode.SUCCESS;
    }

    if (rawFormat === "markdown") {
      const lines = [
        "## SkillOps Catalog — High-End Skills & Context-Isolated Subagents",
        "",
        "### Hybrid Executable Skills (`INV-SKILL-01` .. `03`)",
        "",
        "| Skill | L1 Tokens | L2 Lines | L2 Tokens | Scripts |Savings |",
        "| :--- | ---: | ---: | ---: | ---: | ---: |",
        ...summary.skills.map((s) => {
          const totalRaw = s.l1Tokens + s.l2Tokens;
          const savingsPct =
            totalRaw > 0
              ? (((totalRaw - s.l1Tokens) / totalRaw) * 100).toFixed(1)
              : "0.0";
          return `| \`${s.skillName}\` | ${s.l1Tokens} | ${s.l2Lines} | ${s.l2Tokens} | ${s.scriptsCount} | ${savingsPct}% |`;
        }),
        "",
        "### Context-Isolated Subagents (`INV-SKILL-04`)",
        "",
        "| Subagent | Prompt Tokens | Max Output Tokens | Tools |",
        "| :--- | ---: | ---: | ---: |",
        ...summary.subagents.map(
          (a) =>
            `| \`${a.subagentName}\` | ${a.systemPromptTokens} | <= ${a.maxOutputTokens} | ${a.tools.length} |`,
        ),
        "",
      ];
      process.stdout.write(lines.join("\n"));
      return ExitCode.SUCCESS;
    }

    const lines = [
      `=== SkillOps Catalog (v${SKILLOPS_VERSION}) ===`,
      `Skills (${summary.skills.length}) — Total L1 Routing Tax: ${summary.totalL1Tokens} tokens`,
      ...summary.skills.map(
        (s) =>
          `  [SKILL] ${s.skillName} — L1: ${s.l1Tokens}t | L2: ${s.l2Lines} lines (${s.l2Tokens}t) | L3 Scripts: ${s.scriptsCount}`,
      ),
      `Subagents (${summary.subagents.length}) — Context-Isolated Specialist Agents:`,
      ...summary.subagents.map(
        (a) =>
          `  [SUBAGENT] ${a.subagentName} (prompt=${a.systemPromptTokens}t, max_out<=${a.maxOutputTokens}t, tools=${a.tools.length})`,
      ),
      "",
    ];
    process.stdout.write(lines.join("\n"));
    return ExitCode.SUCCESS;
  }

  if (command === "audit") {
    const repoIdx = args.indexOf("--repo");
    const repoPath =
      repoIdx !== -1 && args[repoIdx + 1] ? args[repoIdx + 1]! : process.cwd();
    const cfgRes = loadSkillOpsConfig(repoPath);
    if (cfgRes.error) {
      process.stderr.write(`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`);
      return ExitCode.BUDGET_OR_CONTRACT_ERROR;
    }
    const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
    const strict = args.includes("--strict");
    const requireLayout = args.includes("--require-layout");
    const formatIdx = args.indexOf("--format");
    const format = formatIdx !== -1 && args[formatIdx + 1] ? args[formatIdx + 1]! : "table";

    const report = auditCatalog(catalogDir, { requireLayout });
    if (format === "json") {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else if (format === "github") {
      const ghLines: string[] = [];
      for (const err of report.budget_errors) {
        ghLines.push(`::error title=SkillOps Budget/Contract Error::${err}`);
      }
      for (const col of report.blocking_collisions) {
        ghLines.push(
          `::error title=SkillOps Blocking Collision::${col.skill_a} <-> ${col.skill_b} cosine=${col.similarity.toFixed(4)} (shared: ${col.shared_terms.join(", ")})`,
        );
      }
      for (const col of report.high_risk_collisions) {
        ghLines.push(
          `::warning title=SkillOps High-Risk Collision::${col.skill_a} <-> ${col.skill_b} cosine=${col.similarity.toFixed(4)} (shared: ${col.shared_terms.join(", ")})`,
        );
      }
      ghLines.push(
        `::notice title=SkillOps Catalog Audit::Audited ${report.skills_audited} skills and ${report.subagents_audited} subagents (L1=${report.total_l1_tokens}t, max_cosine=${report.max_similarity.toFixed(4)}).`,
      );
      process.stdout.write(`${ghLines.join("\n")}\n`);
    } else {
      process.stdout.write(
        [
          `=== SkillOps Zero-API Catalog & Subagent Auditor (v${SKILLOPS_VERSION}) ===`,
          `Catalog: ${report.catalog_path}`,
          `Skills Audited: ${report.skills_audited} | Subagents Audited: ${report.subagents_audited}`,
          `Total L1 Tokens: ${report.total_l1_tokens} | Max Pairwise Cosine: ${report.max_similarity.toFixed(4)}`,
          `Budget/Contract Errors: ${report.budget_errors.length}`,
          ...report.pairs.map(
            (p) =>
              `  [${p.severity}] ${p.skill_a} <-> ${p.skill_b}: cosine=${p.similarity.toFixed(4)} (shared: ${p.shared_terms.join(", ")})`,
          ),
          ...report.budget_errors.map((e) => `  [ERROR] ${e}`),
          "",
        ].join("\n"),
      );
    }

    if (report.budget_errors.length > 0) {
      return ExitCode.BUDGET_OR_CONTRACT_ERROR;
    }
    if (
      report.blocking_collisions.length > 0 ||
      (strict && report.high_risk_collisions.length > 0)
    ) {
      return ExitCode.COLLISION_ERROR;
    }
    return ExitCode.SUCCESS;
  }

  if (command === "tokens") {
    const repoIdx = args.indexOf("--repo");
    const repoPath =
      repoIdx !== -1 && args[repoIdx + 1] ? args[repoIdx + 1]! : process.cwd();
    const cfgRes = loadSkillOpsConfig(repoPath);
    if (cfgRes.error) {
      process.stderr.write(`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`);
      return ExitCode.BUDGET_OR_CONTRACT_ERROR;
    }
    const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
    const budgetIdx = args.indexOf("--budget");
    const startupTaxBudget =
      budgetIdx !== -1 && args[budgetIdx + 1]
        ? Number.parseInt(args[budgetIdx + 1]!, 10)
        : (cfgRes.config?.token_economy.startup_tax_budget ?? 2500);
    const formatIdx = args.indexOf("--format");
    const rawFormat = formatIdx !== -1 && args[formatIdx + 1] ? args[formatIdx + 1]! : "table";
    const format: "table" | "json" | "markdown" | "github" =
      rawFormat === "json" || rawFormat === "markdown" || rawFormat === "github"
        ? rawFormat
        : "table";
    const strict = args.includes("--strict");

    const report = analyzeRepoTokenEconomy(repoPath, {
      catalogDir,
      startupTaxBudget,
    });
    process.stdout.write(formatTokenEconomyReport(report, format));

    if (strict && !report.passed_budget) {
      return ExitCode.BUDGET_OR_CONTRACT_ERROR;
    }
    return ExitCode.SUCCESS;
  }

  if (command === "route") {
    const repoIdx = args.indexOf("--repo");
    const repoPath =
      repoIdx !== -1 && args[repoIdx + 1] ? args[repoIdx + 1]! : process.cwd();
    const cfgRes = loadSkillOpsConfig(repoPath);
    if (cfgRes.error) {
      process.stderr.write(`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`);
      return ExitCode.BUDGET_OR_CONTRACT_ERROR;
    }
    const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
    const taskIdx = args.indexOf("--task");
    const taskPrompt = taskIdx !== -1 && args[taskIdx + 1] ? args[taskIdx + 1]! : "";
    const maxSkillsIdx = args.indexOf("--max-skills");
    const maxSkills =
      maxSkillsIdx !== -1 && args[maxSkillsIdx + 1]
        ? Number.parseInt(args[maxSkillsIdx + 1]!, 10)
        : (cfgRes.config?.token_economy.max_active_skills ?? 12);
    const maxL1Idx = args.indexOf("--max-l1-tokens");
    const maxL1Tokens =
      maxL1Idx !== -1 && args[maxL1Idx + 1]
        ? Number.parseInt(args[maxL1Idx + 1]!, 10)
        : (cfgRes.config?.token_economy.max_l1_tokens ?? 1500);
    const maxSimIdx = args.indexOf("--max-similarity");
    const maxSimilarity =
      maxSimIdx !== -1 && args[maxSimIdx + 1]
        ? Number.parseFloat(args[maxSimIdx + 1]!)
        : (cfgRes.config?.token_economy.max_similarity ?? 0.78);
    const formatIdx = args.indexOf("--format");
    const rawFormat = formatIdx !== -1 && args[formatIdx + 1] ? args[formatIdx + 1]! : "table";
    const format: "table" | "json" | "markdown" =
      rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

    const bundle = routeRepository(repoPath, catalogDir, {
      taskPrompt,
      maxSkills,
      maxL1Tokens,
      maxSimilarity,
    });
    process.stdout.write(formatRoutedBundle(bundle, format));
    return bundle.passed_invariants ? ExitCode.SUCCESS : ExitCode.ERROR;
  }

  if (command === "sync") {
    const repoIdx = args.indexOf("--repo");
    const repoPath =
      repoIdx !== -1 && args[repoIdx + 1] ? args[repoIdx + 1]! : process.cwd();
    const cfgRes = loadSkillOpsConfig(repoPath);
    if (cfgRes.error) {
      process.stderr.write(`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`);
      return ExitCode.BUDGET_OR_CONTRACT_ERROR;
    }
    const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
    const targetsIdx = args.indexOf("--targets");
    const rawTargets =
      targetsIdx !== -1 && args[targetsIdx + 1]
        ? args[targetsIdx + 1]!
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : (cfgRes.config?.targets ?? [...ALL_RUNTIME_TARGETS]);
    const targets = rawTargets as RuntimeTarget[];
    const dryRun = args.includes("--dry-run");
    const force = args.includes("--force");
    const formatIdx = args.indexOf("--format");
    const rawFormat = formatIdx !== -1 && args[formatIdx + 1] ? args[formatIdx + 1]! : "table";
    const format: "table" | "json" | "markdown" =
      rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

    const report = syncRepository(repoPath, catalogDir, {
      targets,
      dryRun,
      force,
      maxSkills: cfgRes.config?.token_economy.max_active_skills,
      maxL1Tokens: cfgRes.config?.token_economy.max_l1_tokens,
      maxSimilarity: cfgRes.config?.token_economy.max_similarity,
    });
    process.stdout.write(formatSyncReport(report, format));
    return report.passed ? ExitCode.SUCCESS : ExitCode.ERROR;
  }

  if (command === "add") {
    const itemName = args[1];
    if (!itemName || itemName.startsWith("-")) {
      process.stderr.write("Usage: npx skillops@latest add <skill-or-subagent-name> [options]\n");
      return ExitCode.ERROR;
    }
    const repoIdx = args.indexOf("--repo");
    const repoPath =
      repoIdx !== -1 && args[repoIdx + 1] ? args[repoIdx + 1]! : process.cwd();
    const cfgRes = loadSkillOpsConfig(repoPath);
    if (cfgRes.error) {
      process.stderr.write(`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`);
      return ExitCode.BUDGET_OR_CONTRACT_ERROR;
    }
    const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
    const targetsIdx = args.indexOf("--targets");
    const rawTargets =
      targetsIdx !== -1 && args[targetsIdx + 1]
        ? args[targetsIdx + 1]!
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : (cfgRes.config?.targets ?? [...ALL_RUNTIME_TARGETS]);
    const targets = rawTargets as RuntimeTarget[];
    const dryRun = args.includes("--dry-run");
    const force = args.includes("--force");

    try {
      const report = addSkillOrSubagent(repoPath, catalogDir, itemName, {
        targets,
        dryRun,
        force,
      });
      process.stdout.write(formatSyncReport(report, "table"));
      return report.passed ? ExitCode.SUCCESS : ExitCode.ERROR;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${msg}\n`);
      return ExitCode.ERROR;
    }
  }

  if (command === "remove") {
    const itemName = args[1];
    if (!itemName || itemName.startsWith("-")) {
      process.stderr.write("Usage: npx skillops@latest remove <skill-or-subagent-name> [options]\n");
      return ExitCode.ERROR;
    }
    const repoIdx = args.indexOf("--repo");
    const repoPath =
      repoIdx !== -1 && args[repoIdx + 1] ? args[repoIdx + 1]! : process.cwd();
    const cfgRes = loadSkillOpsConfig(repoPath);
    if (cfgRes.error) {
      process.stderr.write(`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`);
      return ExitCode.BUDGET_OR_CONTRACT_ERROR;
    }
    const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
    const targetsIdx = args.indexOf("--targets");
    const rawTargets =
      targetsIdx !== -1 && args[targetsIdx + 1]
        ? args[targetsIdx + 1]!
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined;
    const targets = rawTargets as RuntimeTarget[] | undefined;
    const dryRun = args.includes("--dry-run");
    const force = args.includes("--force");
    const formatIdx = args.indexOf("--format");
    const rawFormat = formatIdx !== -1 && args[formatIdx + 1] ? args[formatIdx + 1]! : "table";
    const format: "table" | "json" | "markdown" =
      rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

    try {
      const report = removeSkillOrSubagent(repoPath, catalogDir, itemName, {
        targets,
        dryRun,
        force,
      });
      process.stdout.write(formatSyncReport(report, format));
      return report.passed ? ExitCode.SUCCESS : ExitCode.ERROR;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${msg}\n`);
      return ExitCode.ERROR;
    }
  }

  if (command === "clean") {
    const repoIdx = args.indexOf("--repo");
    const repoPath =
      repoIdx !== -1 && args[repoIdx + 1] ? args[repoIdx + 1]! : process.cwd();
    const cfgRes = loadSkillOpsConfig(repoPath);
    if (cfgRes.error) {
      process.stderr.write(`Invalid .skillops.yml at ${cfgRes.configPath}: ${cfgRes.error}\n`);
      return ExitCode.BUDGET_OR_CONTRACT_ERROR;
    }
    const catalogDir = resolveCatalogDir(args, repoPath, cfgRes.config);
    const dryRun = args.includes("--dry-run");
    const force = args.includes("--force");
    const formatIdx = args.indexOf("--format");
    const rawFormat = formatIdx !== -1 && args[formatIdx + 1] ? args[formatIdx + 1]! : "table";
    const format: "table" | "json" | "markdown" =
      rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

    const report = cleanSyncedArtifacts(repoPath, catalogDir, { dryRun, force });
    process.stdout.write(formatSyncReport(report, format));
    return report.passed ? ExitCode.SUCCESS : ExitCode.ERROR;
  }

  if (command === "eval") {
    const catalogDir = resolveCatalogDir(args);
    const skillIdx = args.indexOf("--skill");
    const skillFilter = skillIdx !== -1 && args[skillIdx + 1] ? args[skillIdx + 1] : undefined;
    const formatIdx = args.indexOf("--format");
    const rawFormat = formatIdx !== -1 && args[formatIdx + 1] ? args[formatIdx + 1]! : "table";
    const format: "table" | "json" | "markdown" | "html" | "github" =
      rawFormat === "json" ||
      rawFormat === "markdown" ||
      rawFormat === "html" ||
      rawFormat === "github"
        ? rawFormat
        : "table";
    const outIdx = args.indexOf("--out");
    const outPath = outIdx !== -1 && args[outIdx + 1] ? path.resolve(args[outIdx + 1]!) : null;
    const strict = args.includes("--strict");

    const summary = evaluateCatalog(catalogDir, { skillFilter });
    const rendered = formatEvalSummary(summary, format);

    if (outPath) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, rendered, "utf-8");
    }
    process.stdout.write(rendered);

    if (strict && !summary.passed) {
      return ExitCode.EVAL_REGRESSION_ERROR;
    }
    return ExitCode.SUCCESS;
  }

  if (command === "doctor" || command === "status") {
    const repoIdx = args.indexOf("--repo");
    const repoPath = path.resolve(
      repoIdx !== -1 && args[repoIdx + 1] ? args[repoIdx + 1]! : process.cwd(),
    );
    const loadedConfigRes = loadSkillOpsConfig(repoPath);
    const catalogDir = resolveCatalogDir(args, repoPath, loadedConfigRes.config);
    const formatIdx = args.indexOf("--format");
    const rawFormat = formatIdx !== -1 && args[formatIdx + 1] ? args[formatIdx + 1]! : "table";
    const format: "table" | "json" | "markdown" | "github" =
      rawFormat === "json" || rawFormat === "markdown" || rawFormat === "github"
        ? rawFormat
        : "table";
    const strict = args.includes("--strict");

    const report = diagnoseRepository(repoPath, { catalogDir });
    process.stdout.write(`${formatDoctorReport(report, format)}\n`);

    if (!report.config_valid) {
      return ExitCode.BUDGET_OR_CONTRACT_ERROR;
    }
    if (
      !report.lockfile_valid ||
      report.drifted_artifacts_count > 0 ||
      report.missing_artifacts_count > 0
    ) {
      return ExitCode.ERROR;
    }
    if (strict && report.status !== "pass") {
      return ExitCode.BUDGET_OR_CONTRACT_ERROR;
    }
    return ExitCode.SUCCESS;
  }

  if (command === "mcp") {
    const repoIdx = args.indexOf("--repo");
    const repoPath = path.resolve(
      repoIdx !== -1 && args[repoIdx + 1] ? args[repoIdx + 1]! : process.cwd(),
    );
    const catalogDir = resolveCatalogDir(args, repoPath);
    startMcpStdioServer({ repoPath, catalogDir });
    return ExitCode.SUCCESS;
  }

  process.stderr.write(`Unknown command '${command}'. Run 'npx skillops@latest --help'.\n`);
  return ExitCode.ERROR;
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
    const resolvedSelf = fs.existsSync(selfPath) ? fs.realpathSync(selfPath) : selfPath;
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
  const code = runCli(process.argv);
  process.exit(code);
}
