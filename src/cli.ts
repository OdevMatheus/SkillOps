/**
 * SkillOps NPX CLI Entrypoint (`npx skillops@latest <command>`).
 */

import path from "node:path";
import {
  analyzeRepoTokenEconomy,
  auditCatalog,
  formatTokenEconomyReport,
} from "./auditor/index.js";
import {
  ALL_RUNTIME_TARGETS,
  ExitCode,
  type RuntimeTarget,
  SKILLOPS_VERSION,
} from "./models.js";
import { formatRoutedBundle, routeRepository } from "./router/index.js";
import { addSkillOrSubagent, formatSyncReport, syncRepository } from "./sync/index.js";

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
  if (command === "audit") {
    const catalogIdx = args.indexOf("--catalog");
    const catalogDir =
      catalogIdx !== -1 && args[catalogIdx + 1]
        ? args[catalogIdx + 1]!
        : path.resolve(process.cwd(), "catalog");
    const strict = args.includes("--strict");
    const requireLayout = args.includes("--require-layout");
    const formatIdx = args.indexOf("--format");
    const format = formatIdx !== -1 && args[formatIdx + 1] ? args[formatIdx + 1]! : "table";

    const report = auditCatalog(catalogDir, { requireLayout });
    if (format === "json") {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
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
    const catalogIdx = args.indexOf("--catalog");
    const catalogDir =
      catalogIdx !== -1 && args[catalogIdx + 1]
        ? args[catalogIdx + 1]!
        : path.join(path.resolve(repoPath), "catalog");
    const budgetIdx = args.indexOf("--budget");
    const startupTaxBudget =
      budgetIdx !== -1 && args[budgetIdx + 1]
        ? Number.parseInt(args[budgetIdx + 1]!, 10)
        : 2500;
    const formatIdx = args.indexOf("--format");
    const rawFormat = formatIdx !== -1 && args[formatIdx + 1] ? args[formatIdx + 1]! : "table";
    const format: "table" | "json" | "markdown" =
      rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";
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
    const catalogIdx = args.indexOf("--catalog");
    const catalogDir =
      catalogIdx !== -1 && args[catalogIdx + 1]
        ? args[catalogIdx + 1]!
        : path.join(path.resolve(repoPath), "catalog");
    const taskIdx = args.indexOf("--task");
    const taskPrompt = taskIdx !== -1 && args[taskIdx + 1] ? args[taskIdx + 1]! : "";
    const formatIdx = args.indexOf("--format");
    const rawFormat = formatIdx !== -1 && args[formatIdx + 1] ? args[formatIdx + 1]! : "table";
    const format: "table" | "json" | "markdown" =
      rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

    const bundle = routeRepository(repoPath, catalogDir, { taskPrompt });
    process.stdout.write(formatRoutedBundle(bundle, format));
    return bundle.passed_invariants ? ExitCode.SUCCESS : ExitCode.ERROR;
  }

  if (command === "sync") {
    const repoIdx = args.indexOf("--repo");
    const repoPath =
      repoIdx !== -1 && args[repoIdx + 1] ? args[repoIdx + 1]! : process.cwd();
    const catalogIdx = args.indexOf("--catalog");
    const catalogDir =
      catalogIdx !== -1 && args[catalogIdx + 1]
        ? args[catalogIdx + 1]!
        : path.join(path.resolve(repoPath), "catalog");
    const targetsIdx = args.indexOf("--targets");
    const rawTargets =
      targetsIdx !== -1 && args[targetsIdx + 1]
        ? args[targetsIdx + 1]!
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [...ALL_RUNTIME_TARGETS];
    const targets = rawTargets as RuntimeTarget[];
    const dryRun = args.includes("--dry-run");
    const force = args.includes("--force");
    const formatIdx = args.indexOf("--format");
    const rawFormat = formatIdx !== -1 && args[formatIdx + 1] ? args[formatIdx + 1]! : "table";
    const format: "table" | "json" | "markdown" =
      rawFormat === "json" || rawFormat === "markdown" ? rawFormat : "table";

    const report = syncRepository(repoPath, catalogDir, { targets, dryRun, force });
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
    const catalogIdx = args.indexOf("--catalog");
    const catalogDir =
      catalogIdx !== -1 && args[catalogIdx + 1]
        ? args[catalogIdx + 1]!
        : path.join(path.resolve(repoPath), "catalog");
    const targetsIdx = args.indexOf("--targets");
    const rawTargets =
      targetsIdx !== -1 && args[targetsIdx + 1]
        ? args[targetsIdx + 1]!
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [...ALL_RUNTIME_TARGETS];
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

  process.stderr.write(`Unknown command '${command}'. Run 'npx skillops@latest --help'.\n`);
  return ExitCode.ERROR;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const code = runCli(process.argv);
  process.exit(code);
}
