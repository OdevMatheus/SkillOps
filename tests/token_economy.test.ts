import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ExitCode,
  analyzeRepoTokenEconomy,
  formatTokenEconomyReport,
} from "../src/index.js";
import { runCli } from "../src/cli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CATALOG_ROOT = path.join(REPO_ROOT, "catalog");

describe("SkillOps NPX Token Economy & Startup Context Tax Analyzer (Issue #60)", () => {
  it("calculates Progressive Disclosure and Subagent compression savings (>= 75%) on the real catalog", () => {
    const report = analyzeRepoTokenEconomy(REPO_ROOT, {
      catalogDir: CATALOG_ROOT,
      startupTaxBudget: 4000,
    });

    expect(report.zero_token_l3_scripts_count).toBeGreaterThanOrEqual(4);
    expect(report.context_isolated_subagents_count).toBeGreaterThanOrEqual(4);
    expect(report.progressive_disclosure_l1_tokens).toBeGreaterThan(0);
    expect(report.monolithic_equivalent_tokens).toBeGreaterThan(
      report.progressive_disclosure_l1_tokens * 4,
    );
    expect(report.estimated_tokens_saved).toBe(
      report.monolithic_equivalent_tokens - report.progressive_disclosure_l1_tokens,
    );
    expect(report.token_savings_pct).toBeGreaterThanOrEqual(75);
    expect(report.inspected_files.length).toBeGreaterThanOrEqual(10);
  });

  it("detects Always-On Startup Token Tax hotspots in a bloated repository", () => {
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "skillops-tokens-bloated-"));
    try {
      // 1. Oversized CLAUDE.md (> 1,800 words -> > 2,400 tokens)
      const bloatedClaudeMd = Array.from(
        { length: 220 },
        (_, idx) =>
          `Rule ${idx + 1}: Always verify database transaction boundaries, HTTP idempotency keys, and authentication middleware before modifying endpoint handlers.`,
      ).join("\n");
      fs.writeFileSync(path.join(tmpRepo, "CLAUDE.md"), bloatedClaudeMd, "utf-8");

      // 2. Duplicate AGENTS.md without @AGENTS.md pointer in CLAUDE.md
      fs.writeFileSync(path.join(tmpRepo, "AGENTS.md"), bloatedClaudeMd, "utf-8");

      // 3. Always-On Cursor Rule (.cursor/rules/monolith.mdc with alwaysApply: true)
      const cursorRulesDir = path.join(tmpRepo, ".cursor", "rules");
      fs.mkdirSync(cursorRulesDir, { recursive: true });
      const bloatedMdc = [
        "---",
        "description: Monolithic cursor rule dumped into every prompt turn",
        "alwaysApply: true",
        "---",
        ...Array.from(
          { length: 75 },
          (_, i) =>
            `Section ${i}: Never use raw SQL strings; always enforce strict schema validation and structured JSON logging across all services.`,
        ),
      ].join("\n");
      fs.writeFileSync(path.join(cursorRulesDir, "monolith.mdc"), bloatedMdc, "utf-8");

      // 4. Bloated .mcp.json with many servers/schemas
      const bloatedMcp = {
        mcpServers: Object.fromEntries(
          Array.from({ length: 14 }, (_, idx) => [
            `heavy-mcp-server-${idx}`,
            {
              command: "npx",
              args: ["-y", `@example/heavy-mcp-server-${idx}`, "--verbose-schemas"],
              env: {
                DESCRIPTION:
                  "Exposes 45 verbose JSON-Schema tool definitions into every prompt turn regardless of whether the user needs them.",
              },
            },
          ]),
        ),
      };
      fs.writeFileSync(
        path.join(tmpRepo, ".mcp.json"),
        JSON.stringify(bloatedMcp, null, 2),
        "utf-8",
      );

      const report = analyzeRepoTokenEconomy(tmpRepo, {
        catalogDir: CATALOG_ROOT,
        startupTaxBudget: 1500,
      });

      expect(report.startup_token_tax).toBeGreaterThan(1500);
      expect(report.passed_budget).toBe(false);
      expect(report.hotspots.length).toBeGreaterThanOrEqual(3);

      const severities = new Set(report.hotspots.map((h) => h.severity));
      expect(severities.has("CRITICAL") || severities.has("HIGH")).toBe(true);

      const cursorHotspot = report.hotspots.find((h) => h.path.includes("monolith.mdc"));
      expect(cursorHotspot).toBeDefined();
      expect(cursorHotspot!.wasted_tokens).toBeGreaterThan(0);

      const mcpHotspot = report.hotspots.find((h) => h.path.includes(".mcp.json"));
      expect(mcpHotspot).toBeDefined();
    } finally {
      fs.rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it("formats TokenEconomyReport in table, json, and markdown and wires 'npx skillops tokens' CLI", () => {
    const report = analyzeRepoTokenEconomy(REPO_ROOT, {
      catalogDir: CATALOG_ROOT,
      startupTaxBudget: 5000,
    });

    const tableOut = formatTokenEconomyReport(report, "table");
    expect(tableOut).toContain("Startup Token Tax");
    expect(tableOut).toContain("Token Savings");

    const mdOut = formatTokenEconomyReport(report, "markdown");
    expect(mdOut).toContain("## SkillOps Token Economy & Startup Context Tax Report");
    expect(mdOut).toContain("| Category |");

    const jsonOut = formatTokenEconomyReport(report, "json");
    const parsedJson = JSON.parse(jsonOut) as { token_savings_pct: number };
    expect(parsedJson.token_savings_pct).toBe(report.token_savings_pct);

    // CLI execution
    expect(
      runCli([
        "node",
        "cli.js",
        "tokens",
        "--repo",
        REPO_ROOT,
        "--catalog",
        CATALOG_ROOT,
        "--budget",
        "10000",
        "--format",
        "table",
      ]),
    ).toBe(ExitCode.SUCCESS);

    // Strict mode with tight budget must return ExitCode.BUDGET_OR_CONTRACT_ERROR (3)
    expect(
      runCli([
        "node",
        "cli.js",
        "tokens",
        "--repo",
        REPO_ROOT,
        "--catalog",
        CATALOG_ROOT,
        "--budget",
        "100",
        "--strict",
      ]),
    ).toBe(ExitCode.BUDGET_OR_CONTRACT_ERROR);
  });
});
