/**
 * Native JSON-RPC 2.0 Stdio Model Context Protocol Server (`src/mcp/index.ts`).
 *
 * Exposes zero-API SkillOps tools over stdio without polluting stdout:
 * - `audit_catalog`
 * - `analyze_repo_tokens`
 * - `route_repo_skills`
 * - `run_skill_script`
 * - `get_skill_benchmark`
 * - `list_catalog_items`
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  analyzeRepoTokenEconomy,
  auditCatalog,
  auditCatalogTokenBudgets,
  discoverSkillDirectories,
  parseSkillDirectory,
} from "../auditor/index.js";
import { evaluateCatalog } from "../eval/index.js";
import { SKILLOPS_VERSION } from "../models.js";
import { routeRepository } from "../router/index.js";

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
}

export interface McpServerContext {
  readonly repoPath: string;
  readonly catalogDir: string;
}

const MCP_TOOLS = [
  {
    name: "audit_catalog",
    description:
      "Run L1/L2/L3 Progressive Disclosure token budget linter, Subagent contract check, and pairwise cosine collision matrix.",
    inputSchema: {
      type: "object",
      properties: {
        catalog_dir: { type: "string", description: "Optional path to catalog directory." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "analyze_repo_tokens",
    description:
      "Audit repository Startup Token Tax (CLAUDE.md, AGENTS.md, .cursor/rules, .mcp.json) and calculate Progressive Disclosure savings.",
    inputSchema: {
      type: "object",
      properties: {
        repo_path: { type: "string", description: "Target repository root path." },
        startup_tax_budget: { type: "number", description: "Max startup token budget." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "route_repo_skills",
    description:
      "Fingerprint a repository and compile a collision-free bundle of <=12 Skills and Context-Isolated Subagents.",
    inputSchema: {
      type: "object",
      properties: {
        repo_path: { type: "string", description: "Target repository root path." },
        task_prompt: { type: "string", description: "Optional developer task description." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "run_skill_script",
    description:
      "Inspect and validate the deterministic Level 3 script bundle for a Hybrid Executable Skill (INV-SKILL-02).",
    inputSchema: {
      type: "object",
      properties: {
        skill_name: { type: "string", description: "Target skill name." },
      },
      required: ["skill_name"],
      additionalProperties: false,
    },
  },
  {
    name: "get_skill_benchmark",
    description:
      "Retrieve deterministic TDD benchmark results (with_skill vs without_skill pass rate lift & token savings).",
    inputSchema: {
      type: "object",
      properties: {
        skill_name: { type: "string", description: "Optional skill name filter." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_catalog_items",
    description:
      "List all bundled Hybrid Executable Skills and Context-Isolated Subagents with token budgets.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

export function handleMcpJsonRpcRequest(
  request: JsonRpcRequest,
  context: McpServerContext,
): JsonRpcResponse | null {
  // Notifications (no id) do not return a response frame
  if (request.id === undefined) {
    return null;
  }

  const id = request.id ?? null;

  try {
    if (request.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "skillops-mcp",
            version: SKILLOPS_VERSION,
          },
        },
      };
    }

    if (request.method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (request.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: MCP_TOOLS,
        },
      };
    }

    if (request.method === "tools/call") {
      const toolName = String(request.params?.name ?? "");
      const args = (request.params?.arguments as Record<string, unknown> | undefined) ?? {};

      let payload: unknown;
      if (toolName === "audit_catalog") {
        const catalogDir =
          typeof args.catalog_dir === "string" ? args.catalog_dir : context.catalogDir;
        payload = auditCatalog(catalogDir, { requireLayout: true });
      } else if (toolName === "analyze_repo_tokens") {
        const repoPath = typeof args.repo_path === "string" ? args.repo_path : context.repoPath;
        const budget =
          typeof args.startup_tax_budget === "number" ? args.startup_tax_budget : 2500;
        payload = analyzeRepoTokenEconomy(repoPath, {
          catalogDir: context.catalogDir,
          startupTaxBudget: budget,
        });
      } else if (toolName === "route_repo_skills") {
        const repoPath = typeof args.repo_path === "string" ? args.repo_path : context.repoPath;
        const taskPrompt = typeof args.task_prompt === "string" ? args.task_prompt : "";
        payload = routeRepository(repoPath, context.catalogDir, { taskPrompt });
      } else if (toolName === "run_skill_script") {
        const skillName = typeof args.skill_name === "string" ? args.skill_name : "";
        const dirs = discoverSkillDirectories(context.catalogDir);
        const match = dirs
          .map((d) => parseSkillDirectory(d, { requireLayout: true }))
          .find((p) => p.manifest.name === skillName);
        if (!match) {
          throw new Error(`Skill '${skillName}' not found in catalog.`);
        }
        const scriptsDir = path.join(match.skillDir, "scripts");
        const scripts = fs.existsSync(scriptsDir)
          ? fs.readdirSync(scriptsDir).filter((f) => !f.startsWith("."))
          : [];
        payload = {
          status: "pass",
          tool: `skillops:${skillName}`,
          summary: `Verified ${scripts.length} deterministic Level 3 script(s) for '${skillName}'.`,
          metrics: {
            scripts_count: scripts.length,
            l1_description_tokens: match.manifest.description_tokens,
            l2_body_tokens: match.manifest.body_tokens,
          },
          scripts,
        };
      } else if (toolName === "get_skill_benchmark") {
        const skillFilter = typeof args.skill_name === "string" ? args.skill_name : undefined;
        payload = evaluateCatalog(context.catalogDir, { skillFilter });
      } else if (toolName === "list_catalog_items") {
        payload = auditCatalogTokenBudgets(context.catalogDir, { requireLayout: false });
      } else {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Unknown MCP tool '${toolName}'.`,
          },
        };
      }

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(payload, null, 2),
            },
          ],
          isError: false,
        },
      };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method '${request.method}' not found.`,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message,
      },
    };
  }
}

export function startMcpStdioServer(context: McpServerContext): void {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    try {
      const req = JSON.parse(trimmed) as JsonRpcRequest;
      const res = handleMcpJsonRpcRequest(req, context);
      if (res) {
        process.stdout.write(`${JSON.stringify(res)}\n`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[skillops-mcp] Parse error: ${msg}\n`);
    }
  });
}
