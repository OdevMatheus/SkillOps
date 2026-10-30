/**
 * Zero-API Hybrid Lexical & Structural Semantic Collision Detector (ADR-0002).
 *
 * Prevents Implicit Routing Collapse (arXiv:2610.18522) across large skill & subagent
 * libraries using weighted TF-IDF word unigrams, bigrams, and character 3-grams with
 * O(N) vector pre-normalization.
 */

import {
  type CollisionPair,
  type CollisionReport,
  type SkillManifest,
  createCollisionPair,
  createCollisionReport,
} from "../models.js";
import {
  discoverSkillDirectories,
  discoverSubagentFiles,
  parseSkillDirectory,
  parseSubagentFile,
} from "./parser.js";

const ROUTING_STOPWORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "dont",
  "down",
  "during",
  "each",
  "either",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "here",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "more",
  "most",
  "must",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "out",
  "over",
  "own",
  "same",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "trigger",
  "triggers",
  "under",
  "until",
  "up",
  "use",
  "used",
  "using",
  "very",
  "via",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "without",
  "would",
  "you",
  "your",
]);

const NEGATIVE_CLAUSE_PATTERNS = [
  /do\s+not\s+trigger\b[\s\S]*$/i,
  /never\s+trigger\b[\s\S]*$/i,
  /do\s+not\s+use\b[\s\S]*$/i,
];

export function stripNegativeTriggerClauses(description: string): string {
  let cleaned = description;
  for (const pattern of NEGATIVE_CLAUSE_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }
  return cleaned.trim();
}

export function tokenizeRoutingText(text: string): string[] {
  const lowered = text.toLowerCase();
  const matches = lowered.match(/[a-z0-9]{2,}/g) ?? [];
  return matches.filter((tok) => !ROUTING_STOPWORDS.has(tok));
}

function addWeightedFeature(
  features: Map<string, number>,
  key: string,
  weight: number,
): void {
  features.set(key, (features.get(key) ?? 0) + weight);
}

/**
 * Extract weighted lexical, bigram, character 3-gram, and structural routing features.
 */
export function extractSkillFeatures(manifest: SkillManifest): Map<string, number> {
  const features = new Map<string, number>();

  // 1. Skill name tokens (weight 3.0)
  for (const tok of tokenizeRoutingText(manifest.name.replace(/-/g, " "))) {
    addWeightedFeature(features, `word:${tok}`, 3.0);
  }

  // 2. Domain tags (weight 2.5)
  for (const tag of manifest.tags) {
    for (const tok of tokenizeRoutingText(tag.replace(/-/g, " "))) {
      addWeightedFeature(features, `word:${tok}`, 2.5);
      addWeightedFeature(features, `tag:${tok}`, 2.0);
    }
  }

  // 3. Positive trigger description words, bigrams & char 3-grams (weight 2.0)
  const positiveDesc = stripNegativeTriggerClauses(manifest.description);
  const descTokens = tokenizeRoutingText(positiveDesc);
  for (let i = 0; i < descTokens.length; i++) {
    const tok = descTokens[i]!;
    addWeightedFeature(features, `word:${tok}`, 2.0);
    if (i + 1 < descTokens.length) {
      addWeightedFeature(features, `bi:${tok}_${descTokens[i + 1]!}`, 1.2);
    }
    if (tok.length >= 4) {
      for (let c = 0; c <= tok.length - 3; c++) {
        addWeightedFeature(features, `c3:${tok.slice(c, c + 3)}`, 0.35);
      }
    }
  }

  // 4. Routing signals (weight 1.5)
  for (const dep of manifest.routing_signals.dependencies_any) {
    for (const tok of tokenizeRoutingText(dep.replace(/-/g, " "))) {
      addWeightedFeature(features, `dep:${tok}`, 1.5);
      addWeightedFeature(features, `word:${tok}`, 1.5);
    }
  }
  for (const filePat of manifest.routing_signals.files_any) {
    for (const tok of tokenizeRoutingText(filePat.replace(/[.*\\/_-]/g, " "))) {
      addWeightedFeature(features, `file:${tok}`, 1.2);
    }
  }

  return features;
}

/**
 * Compute smooth corpus IDF weights: idf(t) = 1 + ln((N + 1) / (df(t) + 1)).
 */
export function computeIdfWeights(featureMaps: readonly Map<string, number>[]): Map<string, number> {
  const nDocs = featureMaps.length;
  const docFreq = new Map<string, number>();
  for (const fmap of featureMaps) {
    for (const key of fmap.keys()) {
      docFreq.set(key, (docFreq.get(key) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [key, df] of docFreq.entries()) {
    idf.set(key, 1.0 + Math.log((nDocs + 1.0) / (df + 1.0)));
  }
  return idf;
}

/**
 * Compute weighted cosine similarity and top shared terms between two feature maps.
 */
export function computeFeatureCosine(
  featuresA: Map<string, number>,
  featuresB: Map<string, number>,
  idfWeights?: Map<string, number>,
): { similarity: number; sharedTerms: string[] } {
  let dot = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  const sharedContribs: Array<[string, number]> = [];

  for (const [k, vA] of featuresA.entries()) {
    const w = idfWeights?.get(k) ?? 1.0;
    const weightedA = vA * w;
    normA += weightedA * weightedA;
    const vB = featuresB.get(k);
    if (vB !== undefined) {
      const weightedB = vB * w;
      const contrib = weightedA * weightedB;
      dot += contrib;
      if (k.startsWith("word:") || k.startsWith("tag:") || k.startsWith("dep:")) {
        sharedContribs.push([k.slice(k.indexOf(":") + 1), contrib]);
      }
    }
  }

  for (const [k, vB] of featuresB.entries()) {
    const w = idfWeights?.get(k) ?? 1.0;
    const weightedB = vB * w;
    normB += weightedB * weightedB;
  }

  if (normA <= 0 || normB <= 0) {
    return { similarity: 0.0, sharedTerms: [] };
  }

  const rawCos = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  const similarity = Math.min(1.0, Math.max(0.0, Number(rawCos.toFixed(4))));

  sharedContribs.sort((a, b) => b[1] - a[1]);
  const topTerms: string[] = [];
  for (const [term] of sharedContribs) {
    if (!topTerms.includes(term)) {
      topTerms.push(term);
      if (topTerms.length >= 6) {
        break;
      }
    }
  }

  return { similarity, sharedTerms: topTerms };
}

/**
 * Compute all pairwise semantic similarities with O(N) vector pre-normalization.
 */
export function computeCollisionMatrix(manifests: readonly SkillManifest[]): CollisionPair[] {
  const sorted = [...manifests].sort((a, b) => a.name.localeCompare(b.name));
  const rawFeatures = sorted.map((m) => extractSkillFeatures(m));
  const idfWeights = computeIdfWeights(rawFeatures);

  // Pre-normalize each skill vector in O(N)
  const unitVectors: Array<Map<string, number>> = rawFeatures.map((fmap) => {
    let sumSq = 0.0;
    const weighted = new Map<string, number>();
    for (const [k, val] of fmap.entries()) {
      const wVal = val * (idfWeights.get(k) ?? 1.0);
      weighted.set(k, wVal);
      sumSq += wVal * wVal;
    }
    const norm = Math.sqrt(sumSq);
    if (norm <= 0) {
      return new Map<string, number>();
    }
    const unit = new Map<string, number>();
    for (const [k, wVal] of weighted.entries()) {
      unit.set(k, wVal / norm);
    }
    return unit;
  });

  const pairs: CollisionPair[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const vecA = unitVectors[i]!;
    const nameA = sorted[i]!.name;
    for (let j = i + 1; j < sorted.length; j++) {
      const vecB = unitVectors[j]!;
      const nameB = sorted[j]!.name;
      let dot = 0.0;
      const sharedContribs: Array<[string, number]> = [];
      for (const [k, uA] of vecA.entries()) {
        const uB = vecB.get(k);
        if (uB !== undefined) {
          const contrib = uA * uB;
          dot += contrib;
          if (k.startsWith("word:") || k.startsWith("tag:") || k.startsWith("dep:")) {
            sharedContribs.push([k.slice(k.indexOf(":") + 1), contrib]);
          }
        }
      }
      sharedContribs.sort((a, b) => b[1] - a[1]);
      const sharedTerms: string[] = [];
      for (const [term] of sharedContribs) {
        if (!sharedTerms.includes(term)) {
          sharedTerms.push(term);
          if (sharedTerms.length >= 6) {
            break;
          }
        }
      }
      pairs.push(createCollisionPair(nameA, nameB, dot, sharedTerms));
    }
  }

  return pairs.sort(
    (a, b) =>
      b.similarity - a.similarity ||
      a.skill_a.localeCompare(b.skill_a) ||
      a.skill_b.localeCompare(b.skill_b),
  );
}

export interface AuditCatalogOptions {
  readonly requireLayout?: boolean;
}

/**
 * Audit a catalog directory for L1/L2/L3 token budgets, subagent contracts, and semantic collisions.
 */
export function auditCatalog(
  catalogDir: string,
  options: AuditCatalogOptions = {},
): CollisionReport {
  const requireLayout = options.requireLayout ?? false;
  const skillDirs = discoverSkillDirectories(catalogDir);
  const subagentFiles = discoverSubagentFiles(catalogDir);

  const manifests: SkillManifest[] = [];
  const budgetErrors: string[] = [];
  let totalL1Tokens = 0;

  for (const dir of skillDirs) {
    try {
      const parsed = parseSkillDirectory(dir, { requireLayout });
      manifests.push(parsed.manifest);
      totalL1Tokens += parsed.manifest.description_tokens;
    } catch (err) {
      budgetErrors.push(err instanceof Error ? err.message : String(err));
    }
  }

  let subagentsAudited = 0;
  for (const subFile of subagentFiles) {
    try {
      parseSubagentFile(subFile);
      subagentsAudited += 1;
    } catch (err) {
      budgetErrors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const pairs = computeCollisionMatrix(manifests);
  const maxSimilarity = pairs.length > 0 ? Math.max(...pairs.map((p) => p.similarity)) : 0.0;

  return createCollisionReport({
    catalog_path: catalogDir.replace(/\\/g, "/"),
    skills_audited: manifests.length,
    subagents_audited: subagentsAudited,
    total_l1_tokens: totalL1Tokens,
    max_similarity: maxSimilarity,
    pairs,
    budget_errors: budgetErrors,
  });
}
