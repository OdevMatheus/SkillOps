/**
 * Deterministic, zero-execution Repository Stack Fingerprinter (`src/router/fingerprinter.ts`).
 *
 * Inspects manifest files (`pyproject.toml`, `requirements*.txt`, `uv.lock`, `package.json`,
 * `tsconfig.json`, `Cargo.toml`, `go.mod`, `Dockerfile`, `docker-compose*.yml`, `.github/workflows`),
 * SQL files, and source files without executing untrusted repository code.
 */

import fs from "node:fs";
import path from "node:path";
import { type RepoProfile, RepoProfileSchema } from "../models.js";

const PACKAGE_NAME_PREFIX_REGEX = /^(@[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+|[a-zA-Z0-9._-]+)/;

const FRAMEWORK_MAP: Readonly<Record<string, string>> = {
  fastapi: "fastapi",
  pydantic: "pydantic",
  "pydantic-settings": "pydantic",
  sqlalchemy: "sqlalchemy",
  alembic: "sqlalchemy",
  pytest: "pytest",
  django: "django",
  flask: "flask",
  celery: "celery",
  mcp: "mcp",
  "@modelcontextprotocol/sdk": "mcp",
  typer: "typer",
  rich: "rich",
  next: "nextjs",
  react: "react",
  vue: "vue",
  express: "express",
  fastify: "fastify",
  nestjs: "nestjs",
  "@nestjs/core": "nestjs",
  zod: "zod",
  vitest: "vitest",
  tsup: "tsup",
};

const DATABASE_MAP: Readonly<Record<string, string>> = {
  psycopg: "postgresql",
  psycopg2: "postgresql",
  "psycopg2-binary": "postgresql",
  asyncpg: "postgresql",
  pg: "postgresql",
  postgres: "postgresql",
  pgvector: "postgresql",
  prisma: "postgresql",
  redis: "redis",
  ioredis: "redis",
  pymongo: "mongodb",
  mongoose: "mongodb",
  aiosqlite: "sqlite",
  "better-sqlite3": "sqlite",
};

export function normalizePackageName(rawSpec: string): string {
  const cleaned = rawSpec.trim().replace(/^["']|["']$/g, "");
  if (!cleaned || cleaned.startsWith("#") || cleaned.startsWith("-")) {
    return "";
  }
  const match = PACKAGE_NAME_PREFIX_REGEX.exec(cleaned);
  if (!match?.[1]) {
    return "";
  }
  return match[1].toLowerCase().replace(/_/g, "-");
}

export class RepoFingerprinter {
  public readonly repoPath: string;

  public constructor(repoPath: string) {
    this.repoPath = path.resolve(repoPath);
  }

  public fingerprint(): RepoProfile {
    const languages = new Set<string>();
    const frameworks = new Set<string>();
    const databases = new Set<string>();
    const dependencies = new Set<string>();
    const ciSystems = new Set<string>();
    const detectedFiles = new Set<string>();
    const signals = new Set<string>();
    let python312Plus = false;

    const recordDep = (rawDep: string): void => {
      const pkg = normalizePackageName(rawDep);
      if (!pkg) {
        return;
      }
      dependencies.add(pkg);
      signals.add(pkg);
      const fw = FRAMEWORK_MAP[pkg];
      if (fw) {
        frameworks.add(fw);
        signals.add(fw);
      }
      const db = DATABASE_MAP[pkg];
      if (db) {
        databases.add(db);
        signals.add(db);
      }
    };

    // 1. Check pyproject.toml
    const pyprojectPath = path.join(this.repoPath, "pyproject.toml");
    if (fs.existsSync(pyprojectPath) && fs.statSync(pyprojectPath).isFile()) {
      detectedFiles.add("pyproject.toml");
      languages.add("python");
      signals.add("python");
      signals.add("pyproject.toml");

      const content = fs.readFileSync(pyprojectPath, "utf-8");
      if (/requires-python\s*=\s*["'][^"']*3\.(1[2-9]|[2-9]\d)/.test(content)) {
        python312Plus = true;
        signals.add("python3.12");
      }

      const quotedSpecs = content.match(/["']([a-zA-Z0-9._-]+(?:\[[a-zA-Z0-9,_-]+\])?\s*(?:[><=~!][^"']+)?)["']/g) ?? [];
      for (const spec of quotedSpecs) {
        recordDep(spec);
      }
    }

    // 2. Check requirements*.txt
    if (fs.existsSync(this.repoPath)) {
      for (const entry of fs.readdirSync(this.repoPath, { withFileTypes: true })) {
        if (entry.isFile() && /^requirements.*\.txt$/i.test(entry.name)) {
          detectedFiles.add(entry.name);
          languages.add("python");
          signals.add("python");
          const lines = fs.readFileSync(path.join(this.repoPath, entry.name), "utf-8").split(/\r?\n/);
          for (const line of lines) {
            recordDep(line);
          }
        }
      }
    }

    // 3. Check package.json & tsconfig.json
    const pkgJsonPath = path.join(this.repoPath, "package.json");
    if (fs.existsSync(pkgJsonPath) && fs.statSync(pkgJsonPath).isFile()) {
      detectedFiles.add("package.json");
      languages.add("javascript");
      signals.add("javascript");
      signals.add("nodejs");
      signals.add("package.json");

      try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as Record<string, unknown>;
        const depSections = ["dependencies", "devDependencies", "peerDependencies"] as const;
        for (const section of depSections) {
          const obj = pkgJson[section];
          if (obj && typeof obj === "object") {
            for (const depName of Object.keys(obj as Record<string, unknown>)) {
              recordDep(depName);
              if (depName === "typescript" || depName.startsWith("@types/")) {
                languages.add("typescript");
                signals.add("typescript");
              }
            }
          }
        }
      } catch {
        // Ignore malformed package.json
      }
    }

    const tsconfigPath = path.join(this.repoPath, "tsconfig.json");
    if (fs.existsSync(tsconfigPath) && fs.statSync(tsconfigPath).isFile()) {
      detectedFiles.add("tsconfig.json");
      languages.add("typescript");
      signals.add("typescript");
      signals.add("tsconfig.json");
    }

    // 4. Check Cargo.toml & go.mod
    if (fs.existsSync(path.join(this.repoPath, "Cargo.toml"))) {
      detectedFiles.add("Cargo.toml");
      languages.add("rust");
      signals.add("rust");
    }
    if (fs.existsSync(path.join(this.repoPath, "go.mod"))) {
      detectedFiles.add("go.mod");
      languages.add("go");
      signals.add("go");
    }

    // 5. Check Docker & CI workflows
    if (fs.existsSync(path.join(this.repoPath, "Dockerfile"))) {
      detectedFiles.add("Dockerfile");
      signals.add("docker");
    }
    const ghWorkflowsDir = path.join(this.repoPath, ".github", "workflows");
    if (fs.existsSync(ghWorkflowsDir) && fs.statSync(ghWorkflowsDir).isDirectory()) {
      const wfFiles = fs
        .readdirSync(ghWorkflowsDir)
        .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
      if (wfFiles.length > 0) {
        ciSystems.add("github-actions");
        signals.add("github-actions");
        for (const wf of wfFiles) {
          detectedFiles.add(`.github/workflows/${wf}`);
        }
      }
    }

    // 6. Shallow source scan (max depth 3) for .py / .ts / .sql files
    const scanDir = (dir: string, depth: number): void => {
      if (depth > 3 || !fs.existsSync(dir)) {
        return;
      }
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (
          entry.name.startsWith(".") ||
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === ".venv" ||
          entry.name === "__pycache__"
        ) {
          continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(full, depth + 1);
        } else if (entry.isFile()) {
          const rel = path.relative(this.repoPath, full).replace(/\\/g, "/");
          if (entry.name.endsWith(".py")) {
            languages.add("python");
            signals.add("python");
            detectedFiles.add(rel);
            const pyText = fs.readFileSync(full, "utf-8");
            if (/^\s*type\s+[A-Za-z_][A-Za-z0-9_]*\s*=/m.test(pyText)) {
              python312Plus = true;
              signals.add("python3.12");
            }
          } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
            languages.add("typescript");
            signals.add("typescript");
            detectedFiles.add(rel);
          } else if (entry.name.endsWith(".sql")) {
            databases.add("postgresql");
            signals.add("sql");
            signals.add("postgresql");
            detectedFiles.add(rel);
          }
        }
      }
    };
    scanDir(this.repoPath, 0);

    return RepoProfileSchema.parse({
      repo_path: this.repoPath.replace(/\\/g, "/"),
      languages: [...languages].sort(),
      frameworks: [...frameworks].sort(),
      databases: [...databases].sort(),
      dependencies: [...dependencies].sort(),
      ci_systems: [...ciSystems].sort(),
      detected_files: [...detectedFiles].sort(),
      signals: [...signals].sort(),
      python_312_plus: python312Plus,
    });
  }
}

export function fingerprintRepository(repoPath: string): RepoProfile {
  return new RepoFingerprinter(repoPath).fingerprint();
}
