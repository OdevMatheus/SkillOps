import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ExitCode,
  addSkillOrSubagent,
  fingerprintRepository,
  routeRepository,
  syncRepository,
} from "../src/index.js";
import { runCli } from "../src/cli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CATALOG_ROOT = path.join(REPO_ROOT, "catalog");

describe("SkillOps NPX Router & Multi-Runtime Subagent/Skill Transpiler (Issue #61)", () => {
  it("fingerprints a polyglot Python + FastAPI + PostgreSQL + TypeScript repository", () => {
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "skillops-fp-test-"));
    try {
      fs.writeFileSync(
        path.join(tmpRepo, "pyproject.toml"),
        [
          "[project]",
          'name = "demo-api"',
          'requires-python = ">=3.12"',
          'dependencies = ["fastapi>=0.115.0", "pydantic>=2.10.0", "sqlalchemy>=2.0.0", "asyncpg>=0.30.0"]',
        ].join("\n"),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpRepo, "package.json"),
        JSON.stringify(
          {
            name: "demo-web",
            dependencies: { zod: "^3.24.0" },
            devDependencies: { typescript: "^5.8.0", vitest: "^3.0.0" },
          },
          null,
          2,
        ),
        "utf-8",
      );
      const wfDir = path.join(tmpRepo, ".github", "workflows");
      fs.mkdirSync(wfDir, { recursive: true });
      fs.writeFileSync(path.join(wfDir, "ci.yml"), "name: CI\non: [push]\n", "utf-8");

      const profile = fingerprintRepository(tmpRepo);
      expect(profile.languages).toContain("python");
      expect(profile.languages).toContain("typescript");
      expect(profile.frameworks).toContain("fastapi");
      expect(profile.frameworks).toContain("pydantic");
      expect(profile.databases).toContain("postgresql");
      expect(profile.ci_systems).toContain("github-actions");
      expect(profile.python_312_plus).toBe(true);
    } finally {
      fs.rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it("compiles a collision-free RoutedBundle with matched Skills and Subagents", () => {
    const bundle = routeRepository(REPO_ROOT, CATALOG_ROOT, {
      maxSkills: 12,
      maxL1Tokens: 1500,
      maxSimilarity: 0.78,
      taskPrompt: "audit MCP server and FastAPI postgres query performance",
    });

    expect(bundle.passed_invariants).toBe(true);
    expect(bundle.selected_skills.length).toBeGreaterThanOrEqual(2);
    expect(bundle.selected_skills.length).toBeLessThanOrEqual(12);
    expect(bundle.total_l1_tokens).toBeLessThanOrEqual(1500);
    expect(bundle.max_pairwise_similarity).toBeLessThan(0.78);
    expect(bundle.recommended_subagents.length).toBeGreaterThanOrEqual(1);
  });

  it("transpiles Skills and Subagents across all 5 runtimes and enforces .skillops-lock.json drift protection", () => {
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "skillops-sync-test-"));
    try {
      fs.writeFileSync(
        path.join(tmpRepo, "pyproject.toml"),
        [
          "[project]",
          'name = "sync-demo"',
          'requires-python = ">=3.12"',
          'dependencies = ["fastapi>=0.115.0", "pydantic>=2.10.0", "psycopg>=3.2.0"]',
        ].join("\n"),
        "utf-8",
      );

      const report = syncRepository(tmpRepo, CATALOG_ROOT, {
        targets: ["claude", "antigravity", "cursor", "codex", "copilot"],
      });

      expect(report.passed).toBe(true);
      expect(report.drift_conflicts).toEqual([]);
      expect(report.artifacts.length).toBeGreaterThan(5);
      expect(fs.existsSync(path.join(tmpRepo, ".skillops-lock.json"))).toBe(true);

      // Verify runtime-specific Skill + Subagent outputs exist
      expect(fs.existsSync(path.join(tmpRepo, ".claude", "skills"))).toBe(true);
      expect(fs.existsSync(path.join(tmpRepo, ".claude", "agents"))).toBe(true);
      expect(fs.existsSync(path.join(tmpRepo, ".agent", "skills"))).toBe(true);
      expect(fs.existsSync(path.join(tmpRepo, ".agent", "agents"))).toBe(true);
      expect(fs.existsSync(path.join(tmpRepo, ".cursor", "rules"))).toBe(true);
      expect(fs.existsSync(path.join(tmpRepo, ".codex", "skills"))).toBe(true);
      expect(fs.existsSync(path.join(tmpRepo, "AGENTS.md"))).toBe(true);
      expect(fs.existsSync(path.join(tmpRepo, ".github", "instructions"))).toBe(true);
      expect(fs.existsSync(path.join(tmpRepo, ".github", "agents"))).toBe(true);

      // Simulate local drift on one synced file
      const firstArtifact = report.artifacts[0]!;
      const driftedFullPath = path.join(tmpRepo, firstArtifact.relative_path);
      fs.appendFileSync(driftedFullPath, "\n<!-- manual local edit -->\n", "utf-8");

      const conflictReport = syncRepository(tmpRepo, CATALOG_ROOT, {
        targets: ["claude", "antigravity", "cursor", "codex", "copilot"],
        force: false,
      });
      expect(conflictReport.passed).toBe(false);
      expect(conflictReport.drift_conflicts).toContain(firstArtifact.relative_path);

      // Force overwrite resolves drift
      const forcedReport = syncRepository(tmpRepo, CATALOG_ROOT, {
        targets: ["claude", "antigravity", "cursor", "codex", "copilot"],
        force: true,
      });
      expect(forcedReport.passed).toBe(true);
      expect(forcedReport.drift_conflicts).toEqual([]);
    } finally {
      fs.rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it("supports surgical single-item 'addSkillOrSubagent' and CLI route/sync/add commands", () => {
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "skillops-add-test-"));
    try {
      const skillReport = addSkillOrSubagent(tmpRepo, CATALOG_ROOT, "mcp-architect", {
        targets: ["claude", "cursor"],
      });
      expect(skillReport.passed).toBe(true);
      expect(
        fs.existsSync(path.join(tmpRepo, ".claude", "skills", "mcp-architect", "SKILL.md")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tmpRepo, ".cursor", "rules", "skillops-mcp-architect.mdc")),
      ).toBe(true);

      const subagentReport = addSkillOrSubagent(tmpRepo, CATALOG_ROOT, "skill-auditor", {
        targets: ["claude", "copilot"],
      });
      expect(subagentReport.passed).toBe(true);
      expect(
        fs.existsSync(path.join(tmpRepo, ".claude", "agents", "skill-auditor.md")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tmpRepo, ".github", "agents", "skill-auditor.agent.md")),
      ).toBe(true);

      // Verify CLI route and add commands
      expect(
        runCli([
          "node",
          "cli.js",
          "route",
          "--repo",
          REPO_ROOT,
          "--catalog",
          CATALOG_ROOT,
          "--format",
          "json",
        ]),
      ).toBe(ExitCode.SUCCESS);

      expect(
        runCli([
          "node",
          "cli.js",
          "add",
          "ast-blast-radius",
          "--repo",
          tmpRepo,
          "--catalog",
          CATALOG_ROOT,
          "--targets",
          "claude",
        ]),
      ).toBe(ExitCode.SUCCESS);
    } finally {
      fs.rmSync(tmpRepo, { recursive: true, force: true });
    }
  });
});
