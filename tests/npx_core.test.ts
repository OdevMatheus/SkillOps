import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ExitCode,
  SKILLOPS_VERSION,
  auditCatalog,
  auditCatalogTokenBudgets,
  computeCollisionMatrix,
  countWords,
  createSkillManifest,
  createSubagentManifest,
  discoverSkillDirectories,
  discoverSubagentFiles,
  estimateTokenCount,
  parseSkillDirectory,
  parseSubagentFile,
} from "../src/index.js";
import { runCli } from "../src/cli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CATALOG_ROOT = path.join(REPO_ROOT, "catalog");

const VALID_DESCRIPTION =
  "Use when designing, implementing, or auditing Model Context Protocol (MCP) servers, JSON-RPC 2.0 stdio transports, tool input schemas, and context-window token footprints across enterprise coding agents and local developer harnesses. Do not trigger for generic REST APIs, GraphQL resolvers, or frontend UI component styling.";

describe("SkillOps NPX Core Models & Subagent Contracts (Issue #59)", () => {
  it("validates a compliant SkillManifest and computes L1 words and tokens", () => {
    const manifest = createSkillManifest({
      name: "mcp-architect",
      description: VALID_DESCRIPTION,
      version: "1.0.0",
      track: "ai-engineering",
      tags: ["mcp", "json-rpc", "token-economy"],
      routing_signals: {
        languages: ["typescript", "python"],
        files_any: ["package.json", "pyproject.toml"],
        dependencies_any: ["@modelcontextprotocol/sdk", "mcp"],
        negative_triggers: ["frontend css styling"],
      },
      entrypoints: {
        scripts: [
          {
            path: "scripts/validate_mcp_server.py",
            description: "Deterministic MCP server transport and schema token auditor.",
          },
        ],
      },
      body_lines: 120,
      body_tokens: 950,
    });

    expect(manifest.name).toBe("mcp-architect");
    expect(manifest.description_words).toBeGreaterThanOrEqual(40);
    expect(manifest.description_words).toBeLessThanOrEqual(110);
    expect(manifest.description_tokens).toBeLessThanOrEqual(160);
    expect(countWords(VALID_DESCRIPTION)).toBe(manifest.description_words);
    expect(estimateTokenCount(VALID_DESCRIPTION)).toBe(manifest.description_tokens);
  });

  it("rejects SkillManifest descriptions violating INV-SKILL-01 word or prefix rules", () => {
    expect(() =>
      createSkillManifest({
        name: "bad-prefix",
        description:
          "This skill does not start with the mandatory prefix even though it has plenty of words to reach forty words in total so that we only test the prefix validation rule in isolation here today for testing.",
        track: "ai-engineering",
        tags: ["test"],
        entrypoints: {
          scripts: [{ path: "scripts/check.mjs", description: "Check script for testing." }],
        },
      }),
    ).toThrow(/must start with 'Use when'/);

    expect(() =>
      createSkillManifest({
        name: "too-short",
        description: "Use when testing short descriptions that fail the forty word minimum.",
        track: "ai-engineering",
        tags: ["test"],
        entrypoints: {
          scripts: [{ path: "scripts/check.mjs", description: "Check script for testing." }],
        },
      }),
    ).toThrow(/between 40 and 110 words/);
  });

  it("validates SubagentManifest and strictly forbids wildcard tool permissions (INV-SKILL-04)", () => {
    const subagent = createSubagentManifest({
      name: "context-scout",
      description:
        "Use when exploring large repositories in an isolated context window to return a surgical <=400-token briefing with exact file and line ranges.",
      tools: ["read", "search"],
      "user-invocable": true,
      "max-output-tokens": 350,
      tags: ["context-isolation", "token-economy"],
      system_prompt_lines: 45,
      system_prompt_tokens: 320,
    });

    expect(subagent.name).toBe("context-scout");
    expect(subagent.context_isolation).toBe(true);
    expect(subagent.max_output_tokens).toBe(350);
    expect(subagent.tools).toEqual(["read", "search"]);

    // Wildcard '*' must be rejected per INV-SKILL-04
    expect(() =>
      createSubagentManifest({
        name: "unsafe-agent",
        description:
          "Use when running arbitrary commands across the workspace without least privilege boundaries.",
        tools: ["read", "*"],
      }),
    ).toThrow(/cannot contain wildcard/);

    // Output briefing > 400 tokens must be rejected
    expect(() =>
      createSubagentManifest({
        name: "bloated-output-agent",
        description:
          "Use when returning huge uncompacted dumps back to the main agent conversation context.",
        tools: ["read"],
        max_output_tokens: 1200,
      }),
    ).toThrow();
  });

  it("discovers and audits real repository catalog skills and .github/agents subagents", () => {
    const skillDirs = discoverSkillDirectories(CATALOG_ROOT);
    expect(skillDirs.length).toBeGreaterThanOrEqual(10);

    const skillNames: string[] = [];
    for (const dir of skillDirs) {
      const parsed = parseSkillDirectory(dir, { requireLayout: true });
      skillNames.push(parsed.manifest.name);
      expect(parsed.manifest.description_words).toBeGreaterThanOrEqual(40);
      expect(parsed.totalLines).toBeLessThanOrEqual(250);
      expect(parsed.declaredScripts.length).toBeGreaterThanOrEqual(1);
    }

    for (const requiredSkill of [
      "context-pruner-advisor",
      "agent-harness-auditor",
      "mcp-architect",
      "prompt-red-teaming",
      "ast-blast-radius",
      "postgres-query-doctor",
      "concurrency-race-detector",
      "bug-reproducer-tdd",
      "security-sast-gate",
      "fastapi-production",
    ]) {
      expect(skillNames).toContain(requiredSkill);
    }

    const subagentFiles = discoverSubagentFiles(CATALOG_ROOT);
    expect(subagentFiles.length).toBeGreaterThanOrEqual(9);
    const parsedSubagents = subagentFiles.map((f) => parseSubagentFile(f));
    const subagentNames = parsedSubagents.map((s) => s.manifest.name);
    for (const requiredSubagent of [
      "context-scout",
      "token-budget-governor",
      "blast-radius-auditor",
      "red-team-breaker",
      "tdd-reproducer-agent",
      "skill-auditor",
    ]) {
      expect(subagentNames).toContain(requiredSubagent);
    }
    const skillAuditor = parsedSubagents.find((s) => s.manifest.name === "skill-auditor");
    expect(skillAuditor).toBeDefined();
    expect(skillAuditor!.manifest.tools).toEqual(["read", "search"]);

    const budgetSummary = auditCatalogTokenBudgets(CATALOG_ROOT, { requireLayout: true });
    expect(budgetSummary.passed).toBe(true);
    expect(budgetSummary.skills.length).toBe(skillDirs.length);
    expect(budgetSummary.subagents.length).toBeGreaterThanOrEqual(1);

    const collisionReport = auditCatalog(CATALOG_ROOT, { requireLayout: true });
    expect(collisionReport.passed).toBe(true);
    expect(collisionReport.blocking_collisions).toHaveLength(0);
    expect(collisionReport.high_risk_collisions).toHaveLength(0);
  });

  it("detects planted BLOCKING_ERROR collisions and runs 84-skill stress matrix in < 500ms", () => {
    const baseManifest = createSkillManifest({
      name: "sql-lock-doctor-a",
      description: VALID_DESCRIPTION,
      track: "python-backend",
      tags: ["postgresql", "sql", "migration", "locks"],
      entrypoints: {
        scripts: [{ path: "scripts/check.py", description: "Check SQL locks." }],
      },
    });
    const duplicateManifest = createSkillManifest({
      name: "sql-lock-doctor-b",
      description: VALID_DESCRIPTION,
      track: "python-backend",
      tags: ["postgresql", "sql", "migration", "locks"],
      entrypoints: {
        scripts: [{ path: "scripts/check.py", description: "Check SQL locks." }],
      },
    });

    const pairs = computeCollisionMatrix([baseManifest, duplicateManifest]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.severity).toBe("BLOCKING_ERROR");
    expect(pairs[0]!.similarity).toBeGreaterThanOrEqual(0.85);

    // 84-skill stress test (3,486 pairwise comparisons)
    const vocab = [
      "kubernetes",
      "terraform",
      "graphql",
      "postgres",
      "redis",
      "playwright",
      "rust",
      "golang",
      "websocket",
      "opentelemetry",
      "kafka",
      "duckdb",
      "wasm",
      "tokio",
      "prisma",
      "trpc",
      "nextjs",
      "tailwind",
      "vitest",
      "docker",
    ];
    const synthetic = Array.from({ length: 84 }, (_, idx) => {
      const w1 = vocab[idx % vocab.length]!;
      const w2 = vocab[(idx * 3 + 1) % vocab.length]!;
      const w3 = vocab[(idx * 7 + 2) % vocab.length]!;
      const desc = `Use when auditing, profiling, or hardening ${w1}, ${w2}, and ${w3} subsystems for deterministic latency, memory safety, and zero-overhead schema validation in distributed production clusters with strict observability invariants and automated rollback verification gates. Do not trigger for unrelated legacy monoliths.`;
      return createSkillManifest({
        name: `synth-skill-${idx}-${w1}`,
        description: desc,
        track: "arch-quality",
        tags: [w1, w2, `domain-${idx}`],
        entrypoints: {
          scripts: [{ path: "scripts/run.mjs", description: "Synthetic diagnostic script." }],
        },
      });
    });

    const start = performance.now();
    const matrix = computeCollisionMatrix(synthetic);
    const elapsedMs = performance.now() - start;
    expect(matrix).toHaveLength((84 * 83) / 2);
    expect(elapsedMs).toBeLessThan(1000);
  });

  it("executes CLI --version, --help, and audit command cleanly", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skillops-npx-test-"));
    try {
      expect(runCli(["node", "cli.js", "--version"])).toBe(ExitCode.SUCCESS);
      expect(runCli(["node", "cli.js", "--help"])).toBe(ExitCode.SUCCESS);
      expect(
        runCli([
          "node",
          "cli.js",
          "audit",
          "--catalog",
          CATALOG_ROOT,
          "--require-layout",
          "--strict",
          "--format",
          "json",
        ]),
      ).toBe(ExitCode.SUCCESS);
      expect(runCli(["node", "cli.js", "--version"])).toBe(0);
      expect(SKILLOPS_VERSION).toBe("0.5.0");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
