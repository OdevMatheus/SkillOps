/**
 * Dynamic Skill & Subagent Router (`src/router/bundle_compiler.ts`).
 *
 * Enforces INV-SKILL-03:
 * - Compiles a deterministic, collision-free bundle of <= 12 skills (<= 1,500 L1 tokens,
 *   < 0.78 pairwise cosine similarity) tailored to the repository fingerprint and task prompt.
 * - Selects matching Context-Isolated Subagents (`recommended_subagents`).
 */

import path from "node:path";
import {
  computeFeatureCosine,
  computeIdfWeights,
  extractSkillFeatures,
  tokenizeRoutingText,
} from "../auditor/collision.js";
import {
  type ParsedSkillDirectory,
  discoverSkillDirectories,
  discoverSubagentFiles,
  parseSkillDirectory,
  parseSubagentFile,
} from "../auditor/parser.js";
import {
  type RepoProfile,
  type RoutedBundle,
  RoutedBundleSchema,
  type ScoredSkill,
  type SkippedSkill,
} from "../models.js";
import { fingerprintRepository } from "./fingerprinter.js";

export interface RouteOptions {
  readonly maxSkills?: number;
  readonly maxL1Tokens?: number;
  readonly maxSimilarity?: number;
  readonly taskPrompt?: string;
}

export function scoreSkillAgainstProfile(
  parsedSkill: ParsedSkillDirectory,
  profile: RepoProfile,
  taskPrompt = "",
): { score: number; matchedSignals: string[]; negativeMatch: string | null } {
  const manifest = parsedSkill.manifest;
  const repoSignalSet = new Set(
    [
      ...profile.languages,
      ...profile.frameworks,
      ...profile.databases,
      ...profile.dependencies,
      ...profile.ci_systems,
      ...profile.signals,
    ].map((s) => s.toLowerCase()),
  );
  const taskTokens = new Set(tokenizeRoutingText(taskPrompt));

  // Check negative triggers against task prompt if provided
  if (taskPrompt.trim()) {
    const lowerPrompt = taskPrompt.toLowerCase();
    for (const neg of manifest.routing_signals.negative_triggers) {
      if (neg.trim() && lowerPrompt.includes(neg.toLowerCase())) {
        return {
          score: 0,
          matchedSignals: [],
          negativeMatch: `Excluded by negative trigger '${neg}'.`,
        };
      }
    }
  }

  let rawScore = 10; // Baseline score for valid catalog skill
  const matchedSignals: string[] = [];

  for (const lang of manifest.routing_signals.languages) {
    const lowerLang = lang.toLowerCase();
    if (repoSignalSet.has(lowerLang)) {
      rawScore += 18;
      matchedSignals.push(`lang:${lang}`);
    }
  }

  for (const dep of [...manifest.routing_signals.dependencies_any, ...manifest.tags]) {
    const lowerDep = dep.toLowerCase();
    const depTokens = tokenizeRoutingText(lowerDep);
    if (repoSignalSet.has(lowerDep) || depTokens.some((t) => repoSignalSet.has(t))) {
      rawScore += 16;
      matchedSignals.push(`repo:${dep}`);
    }
    if (taskTokens.size > 0 && depTokens.some((t) => taskTokens.has(t))) {
      rawScore += 22;
      matchedSignals.push(`task:${dep}`);
    }
  }

  for (const pat of manifest.routing_signals.files_any) {
    const cleanPat = pat.replace(/\*/g, "").toLowerCase();
    if (
      cleanPat &&
      profile.detected_files.some((f) => f.toLowerCase().includes(cleanPat))
    ) {
      rawScore += 15;
      matchedSignals.push(`file:${pat}`);
    }
  }

  // Track bonus for universal engineering / token economy tracks
  if (manifest.track === "arch-quality" || manifest.track === "token-economy") {
    rawScore += 12;
    matchedSignals.push(`track:${manifest.track}`);
  }

  const clampedScore = Math.min(100, Number(rawScore.toFixed(2)));
  return {
    score: clampedScore,
    matchedSignals: [...new Set(matchedSignals)],
    negativeMatch: null,
  };
}

export function compileSkillBundle(
  profile: RepoProfile,
  catalogDir: string,
  options: RouteOptions = {},
): RoutedBundle {
  const maxSkills = options.maxSkills ?? 12;
  const maxL1Tokens = options.maxL1Tokens ?? 1500;
  const maxSimilarity = options.maxSimilarity ?? 0.78;
  const taskPrompt = options.taskPrompt ?? "";

  const resolvedCatalog = path.resolve(catalogDir);
  const skillDirs = discoverSkillDirectories(resolvedCatalog);
  const parsedSkills = skillDirs.map((dir) => parseSkillDirectory(dir, { requireLayout: false }));
  const featureVectors = new Map<string, Map<string, number>>();
  for (const p of parsedSkills) {
    featureVectors.set(p.manifest.name, extractSkillFeatures(p.manifest));
  }
  const idfWeights = computeIdfWeights([...featureVectors.values()]);

  const candidates: Array<{
    parsed: ParsedSkillDirectory;
    score: number;
    matchedSignals: string[];
  }> = [];
  const skippedSkills: SkippedSkill[] = [];

  for (const parsed of parsedSkills) {
    const { score, matchedSignals, negativeMatch } = scoreSkillAgainstProfile(
      parsed,
      profile,
      taskPrompt,
    );
    if (negativeMatch) {
      skippedSkills.push({
        name: parsed.manifest.name,
        track: parsed.manifest.track,
        relevance_score: 0,
        reason: negativeMatch,
      });
      continue;
    }
    candidates.push({ parsed, score, matchedSignals });
  }

  // Sort by score descending, then name ascending
  candidates.sort((a, b) =>
    b.score !== a.score
      ? b.score - a.score
      : a.parsed.manifest.name.localeCompare(b.parsed.manifest.name),
  );

  const selectedSkills: ScoredSkill[] = [];
  let totalL1Tokens = 0;
  let maxPairwiseSimilarity = 0;

  for (const cand of candidates) {
    const manifest = cand.parsed.manifest;
    if (selectedSkills.length >= maxSkills) {
      skippedSkills.push({
        name: manifest.name,
        track: manifest.track,
        relevance_score: cand.score,
        reason: `Bundle cap reached (max_skills=${maxSkills}).`,
      });
      continue;
    }

    if (totalL1Tokens + manifest.description_tokens > maxL1Tokens) {
      skippedSkills.push({
        name: manifest.name,
        track: manifest.track,
        relevance_score: cand.score,
        reason: `Would exceed Level 1 token budget (${totalL1Tokens + manifest.description_tokens} > ${maxL1Tokens}).`,
      });
      continue;
    }

    // Check pairwise cosine against already-selected skills
    const candVec = featureVectors.get(manifest.name)!;
    let collidingPeer: string | null = null;
    let highestSimWithSelected = 0;

    for (const sel of selectedSkills) {
      const selVec = featureVectors.get(sel.name)!;
      const { similarity } = computeFeatureCosine(candVec, selVec, idfWeights);
      if (similarity >= maxSimilarity) {
        collidingPeer = `${sel.name} (cosine=${similarity.toFixed(4)})`;
        break;
      }
      if (similarity > highestSimWithSelected) {
        highestSimWithSelected = similarity;
      }
    }

    if (collidingPeer) {
      skippedSkills.push({
        name: manifest.name,
        track: manifest.track,
        relevance_score: cand.score,
        reason: `Semantic collision with selected skill ${collidingPeer}.`,
      });
      continue;
    }

    if (highestSimWithSelected > maxPairwiseSimilarity) {
      maxPairwiseSimilarity = highestSimWithSelected;
    }

    selectedSkills.push({
      name: manifest.name,
      track: manifest.track,
      skill_dir: cand.parsed.skillDir.replace(/\\/g, "/"),
      relevance_score: cand.score,
      l1_tokens: manifest.description_tokens,
      matched_signals: cand.matchedSignals,
    });
    totalL1Tokens += manifest.description_tokens;
  }

  // Discover recommended Subagents in catalog
  const subagentFiles = discoverSubagentFiles(resolvedCatalog);
  const recommendedSubagents: string[] = [];
  for (const saFile of subagentFiles) {
    try {
      const parsedSa = parseSubagentFile(saFile);
      if (!recommendedSubagents.includes(parsedSa.manifest.name)) {
        recommendedSubagents.push(parsedSa.manifest.name);
      }
    } catch {
      // Skip invalid subagent
    }
  }

  return RoutedBundleSchema.parse({
    repo_profile: profile,
    catalog_path: resolvedCatalog.replace(/\\/g, "/"),
    max_skills: maxSkills,
    max_l1_tokens: maxL1Tokens,
    max_similarity: maxSimilarity,
    selected_skills: selectedSkills,
    recommended_subagents: recommendedSubagents.sort(),
    skipped_skills: skippedSkills,
    total_l1_tokens: totalL1Tokens,
    max_pairwise_similarity: Number(maxPairwiseSimilarity.toFixed(4)),
    passed_invariants:
      selectedSkills.length <= maxSkills &&
      totalL1Tokens <= maxL1Tokens &&
      maxPairwiseSimilarity < maxSimilarity,
  });
}

export function routeRepository(
  repoPath: string,
  catalogDir: string,
  options: RouteOptions = {},
): RoutedBundle {
  const profile = fingerprintRepository(repoPath);
  return compileSkillBundle(profile, catalogDir, options);
}

export function formatRoutedBundle(
  bundle: RoutedBundle,
  format: "table" | "json" | "markdown" = "table",
): string {
  if (format === "json") {
    return `${JSON.stringify(bundle, null, 2)}\n`;
  }
  if (format === "markdown") {
    return [
      "## SkillOps Context-Aware Routed Bundle",
      "",
      `- **Languages**: ${bundle.repo_profile.languages.join(", ") || "none"}`,
      `- **Frameworks**: ${bundle.repo_profile.frameworks.join(", ") || "none"}`,
      `- **Selected Skills**: \`${bundle.selected_skills.length}\` / \`${bundle.max_skills}\``,
      `- **Total L1 Tokens**: \`${bundle.total_l1_tokens}\` / \`${bundle.max_l1_tokens}\``,
      `- **Recommended Subagents**: ${bundle.recommended_subagents.map((s) => `\`${s}\``).join(", ") || "none"}`,
      "",
      "| Skill | Track | Score | L1 Tokens | Matched Signals |",
      "| :--- | :--- | ---: | ---: | :--- |",
      ...bundle.selected_skills.map(
        (s) =>
          `| \`${s.name}\` | \`${s.track}\` | ${s.relevance_score} | ${s.l1_tokens} | ${s.matched_signals.join(", ")} |`,
      ),
      "",
    ].join("\n");
  }

  return [
    "=== SkillOps Context-Aware Router ===",
    `Repo       : ${bundle.repo_profile.repo_path}`,
    `Stack      : languages=[${bundle.repo_profile.languages.join(", ")}] frameworks=[${bundle.repo_profile.frameworks.join(", ")}] db=[${bundle.repo_profile.databases.join(", ")}]`,
    `Selected   : ${bundle.selected_skills.length}/${bundle.max_skills} skills (${bundle.total_l1_tokens}/${bundle.max_l1_tokens} L1 tokens, max cosine=${bundle.max_pairwise_similarity.toFixed(4)})`,
    `Subagents  : ${bundle.recommended_subagents.join(", ") || "none"}`,
    ...bundle.selected_skills.map(
      (s) =>
        `  + ${s.name} [${s.track}] score=${s.relevance_score} (${s.l1_tokens} L1 tokens) signals=[${s.matched_signals.join(", ")}]`,
    ),
    "",
  ].join("\n");
}
