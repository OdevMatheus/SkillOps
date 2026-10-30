import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ExitCode,
  evaluateCatalog,
  formatEvalSummary,
  handleMcpJsonRpcRequest,
} from "../src/index.js";
import { runCli } from "../src/cli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CATALOG_ROOT = path.join(REPO_ROOT, "catalog");

describe("SkillOps NPX Complete CLI, Deterministic Eval Runner & Stdio MCP Server (Issue #62)", () => {
  it("evaluates all catalog skills (with_skill vs without_skill) and exports table, markdown, json, and html", () => {
    const summary = evaluateCatalog(CATALOG_ROOT);
    expect(summary.passed).toBe(true);
    expect(summary.skills_evaluated).toBeGreaterThanOrEqual(4);
    expect(summary.mean_pass_rate_gain).toBeGreaterThanOrEqual(0.2);

    const tableOut = formatEvalSummary(summary, "table");
    expect(tableOut).toContain("CERTIFIED_IMPROVEMENT");

    const mdOut = formatEvalSummary(summary, "markdown");
    expect(mdOut).toContain("## SkillOps Deterministic Benchmark Report");
    expect(mdOut).toContain("| Skill |");

    const htmlOut = formatEvalSummary(summary, "html");
    expect(htmlOut).toContain("<!DOCTYPE html>");
    expect(htmlOut).toContain("SkillOps Benchmark Dashboard");

    const jsonOut = formatEvalSummary(summary, "json");
    const parsed = JSON.parse(jsonOut) as { passed: boolean };
    expect(parsed.passed).toBe(true);
  });

  it("handles JSON-RPC 2.0 MCP requests (initialize, tools/list, tools/call) without stdout pollution", () => {
    const initRes = handleMcpJsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05" },
      },
      { repoPath: REPO_ROOT, catalogDir: CATALOG_ROOT },
    );
    expect(initRes).not.toBeNull();
    expect((initRes!.result as { serverInfo: { name: string } }).serverInfo.name).toBe(
      "skillops-mcp",
    );

    const listRes = handleMcpJsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      },
      { repoPath: REPO_ROOT, catalogDir: CATALOG_ROOT },
    );
    const tools = (listRes!.result as { tools: Array<{ name: string }> }).tools;
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("audit_catalog");
    expect(toolNames).toContain("analyze_repo_tokens");
    expect(toolNames).toContain("route_repo_skills");
    expect(toolNames).toContain("run_skill_script");
    expect(toolNames).toContain("get_skill_benchmark");
    expect(toolNames).toContain("list_catalog_items");

    const callScriptRes = handleMcpJsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 25,
        method: "tools/call",
        params: {
          name: "run_skill_script",
          arguments: { skill_name: "mcp-architect" },
        },
      },
      { repoPath: REPO_ROOT, catalogDir: CATALOG_ROOT },
    );
    const scriptText = (
      callScriptRes!.result as { content: Array<{ type: string; text: string }> }
    ).content[0]!.text;
    const scriptPayload = JSON.parse(scriptText) as { status: string };
    expect(scriptPayload.status).toBe("pass");

    const callTokensRes = handleMcpJsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "analyze_repo_tokens",
          arguments: { repo_path: REPO_ROOT },
        },
      },
      { repoPath: REPO_ROOT, catalogDir: CATALOG_ROOT },
    );
    const contentText = (
      callTokensRes!.result as { content: Array<{ type: string; text: string }> }
    ).content[0]!.text;
    const tokenPayload = JSON.parse(contentText) as {
      token_savings_pct: number;
      passed_budget: boolean;
      hotspots: unknown[];
    };
    expect(tokenPayload.token_savings_pct).toBeGreaterThanOrEqual(75);
    expect(tokenPayload.passed_budget).toBe(true);
    expect(tokenPayload.hotspots).toHaveLength(0);
  });

  it("executes CLI init, list, and eval commands cleanly", () => {
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "skillops-cli-init-"));
    try {
      expect(
        runCli([
          "node",
          "cli.js",
          "init",
          "--repo",
          tmpRepo,
          "--catalog",
          CATALOG_ROOT,
        ]),
      ).toBe(ExitCode.SUCCESS);
      expect(fs.existsSync(path.join(tmpRepo, ".skillops.yml"))).toBe(true);

      expect(
        runCli([
          "node",
          "cli.js",
          "list",
          "--catalog",
          CATALOG_ROOT,
          "--format",
          "table",
        ]),
      ).toBe(ExitCode.SUCCESS);

      const htmlReportPath = path.join(tmpRepo, "benchmark.html");
      expect(
        runCli([
          "node",
          "cli.js",
          "eval",
          "--catalog",
          CATALOG_ROOT,
          "--format",
          "html",
          "--out",
          htmlReportPath,
          "--strict",
        ]),
      ).toBe(ExitCode.SUCCESS);
      expect(fs.existsSync(htmlReportPath)).toBe(true);
    } finally {
      fs.rmSync(tmpRepo, { recursive: true, force: true });
    }
  });
});
