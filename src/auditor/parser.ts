/**
 * Directory and file discovery/parsing engine for Hybrid Executable Skills (SKILL.md)
 * and Context-Isolated Subagents (SUBAGENT.md / *.agent.md).
 */

import fs from "node:fs";
import path from "node:path";
import {
  type SkillManifest,
  type SubagentManifest,
  parseSkillMdFile,
  parseSubagentMdFile,
  splitFrontmatter,
} from "../models.js";

export interface ParsedSkillDirectory {
  readonly skillDir: string;
  readonly skillMdPath: string;
  readonly manifest: SkillManifest;
  readonly rawText: string;
  readonly markdownBody: string;
  readonly totalLines: number;
  readonly declaredScripts: string[];
  readonly missingDeclaredScripts: string[];
  readonly extraScripts: string[];
  readonly referenceFiles: string[];
  readonly evalsPath: string | null;
}

export interface ParsedSubagentFile {
  readonly filePath: string;
  readonly manifest: SubagentManifest;
  readonly systemPromptBody: string;
  readonly rawText: string;
}

export interface ParseSkillOptions {
  readonly requireLayout?: boolean;
}

function walkForFilesNamed(rootDir: string, targetFilename: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const results: string[] = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      results.push(...walkForFilesNamed(fullPath, targetFilename));
    } else if (entry.isFile() && entry.name === targetFilename) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

/**
 * Recursively discover all skill directories under catalogDir containing SKILL.md.
 */
export function discoverSkillDirectories(catalogDir: string): string[] {
  const skillMdFiles = walkForFilesNamed(catalogDir, "SKILL.md");
  return skillMdFiles.map((file) => path.dirname(file)).sort();
}

/**
 * Parse a single skill directory and validate its SKILL.md manifest and Level 3 layout.
 */
export function parseSkillDirectory(
  skillDir: string,
  options: ParseSkillOptions = {},
): ParsedSkillDirectory {
  const requireLayout = options.requireLayout ?? true;
  const skillMdPath = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(skillMdPath)) {
    throw new Error(`Missing SKILL.md in '${skillDir.replace(/\\/g, "/")}'.`);
  }

  const rawText = fs.readFileSync(skillMdPath, "utf-8");
  const lines = rawText.split(/\r?\n/);
  const totalLines = rawText.endsWith("\n") ? lines.length - 1 : lines.length;
  const [, markdownBody] = splitFrontmatter(rawText, skillMdPath.replace(/\\/g, "/"));
  const manifest = parseSkillMdFile(skillMdPath);

  const declaredScripts: string[] = [];
  const missingDeclaredScripts: string[] = [];
  const declaredRelSet = new Set<string>();

  for (const scriptEntry of manifest.entrypoints.scripts) {
    declaredRelSet.add(scriptEntry.path);
    const fullScriptPath = path.join(skillDir, scriptEntry.path);
    if (fs.existsSync(fullScriptPath) && fs.statSync(fullScriptPath).isFile()) {
      declaredScripts.push(fullScriptPath);
    } else {
      missingDeclaredScripts.push(scriptEntry.path);
    }
  }

  if (requireLayout && missingDeclaredScripts.length > 0) {
    throw new Error(
      `Skill '${manifest.name}' declares missing Level 3 script(s): ${missingDeclaredScripts.join(", ")}`,
    );
  }

  const scriptsDir = path.join(skillDir, "scripts");
  const extraScripts: string[] = [];
  if (fs.existsSync(scriptsDir) && fs.statSync(scriptsDir).isDirectory()) {
    for (const entry of fs.readdirSync(scriptsDir, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        (entry.name.endsWith(".py") ||
          entry.name.endsWith(".mjs") ||
          entry.name.endsWith(".js") ||
          entry.name.endsWith(".ts"))
      ) {
        const rel = `scripts/${entry.name}`;
        if (!declaredRelSet.has(rel)) {
          extraScripts.push(path.join(scriptsDir, entry.name));
        }
      }
    }
  }

  const referencesDir = path.join(skillDir, "references");
  const referenceFiles: string[] = [];
  if (fs.existsSync(referencesDir) && fs.statSync(referencesDir).isDirectory()) {
    for (const entry of fs.readdirSync(referencesDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        referenceFiles.push(path.join(referencesDir, entry.name));
      }
    }
  }

  const candidateEvalsPath = path.join(skillDir, "evals", "evals.json");
  const evalsPath =
    fs.existsSync(candidateEvalsPath) && fs.statSync(candidateEvalsPath).isFile()
      ? candidateEvalsPath
      : null;

  if (requireLayout && !evalsPath) {
    throw new Error(
      `Skill '${manifest.name}' is missing required 'evals/evals.json' suite per SKILL_CONTRACT.md.`,
    );
  }

  return {
    skillDir,
    skillMdPath,
    manifest,
    rawText,
    markdownBody,
    totalLines,
    declaredScripts: declaredScripts.sort(),
    missingDeclaredScripts: missingDeclaredScripts.sort(),
    extraScripts: extraScripts.sort(),
    referenceFiles: referenceFiles.sort(),
    evalsPath,
  };
}

/**
 * Discover all Subagent Markdown definitions in catalog/subagents/ and .github/agents/*.agent.md.
 */
export function discoverSubagentFiles(repoOrCatalogRoot: string): string[] {
  const results = new Set<string>();

  const candidates = [
    path.join(repoOrCatalogRoot, "subagents"),
    path.join(repoOrCatalogRoot, "catalog", "subagents"),
    path.join(repoOrCatalogRoot, ".github", "agents"),
    path.join(path.dirname(repoOrCatalogRoot), ".github", "agents"),
  ];

  for (const dir of candidates) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      continue;
    }
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (
          entry.isFile() &&
          (entry.name === "SUBAGENT.md" ||
            entry.name === "AGENT.md" ||
            entry.name.endsWith(".agent.md"))
        ) {
          results.add(path.resolve(full));
        }
      }
    }
  }

  return [...results].sort();
}

/**
 * Parse and validate a Subagent definition file.
 */
export function parseSubagentFile(filePath: string): ParsedSubagentFile {
  const rawText = fs.readFileSync(filePath, "utf-8");
  const { manifest, systemPromptBody } = parseSubagentMdFile(filePath);
  return {
    filePath,
    manifest,
    systemPromptBody,
    rawText,
  };
}
