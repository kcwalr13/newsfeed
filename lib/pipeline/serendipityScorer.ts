// Pure functions for serendipity scoring: concept distance classification, surprise, and quality weight.

export type ConceptDistance = 'known' | 'adjacent' | 'unknown';

export interface ConceptClassification {
  label:    string;
  distance: ConceptDistance;
}

/**
 * Normalizes a string for concept label matching:
 * - Lowercases
 * - Replaces non-alphanumeric characters (except spaces) with spaces
 * - Collapses multiple spaces to one
 * - Trims
 * (Same logic as conceptBonus.ts normalize().)
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Minimum length for fuzzy (non-exact) label matching (PIPE-L5). */
const MIN_FUZZY_MATCH_LEN = 4;

/**
 * True when `needle` appears in `haystack` as a whole-token sequence.
 * Very short needles never fuzzy-match (exact equality handles them).
 */
function tokenBoundaryIncludes(haystack: string, needle: string): boolean {
  if (needle.length < MIN_FUZZY_MATCH_LEN) return false;
  const hTokens = haystack.split(' ');
  const nTokens = needle.split(' ');
  for (let i = 0; i + nTokens.length <= hTokens.length; i++) {
    let match = true;
    for (let j = 0; j < nTokens.length; j++) {
      if (hTokens[i + j] !== nTokens[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Classifies each concept label against the user's concept graph.
 * All data passed in — no DB calls.
 *
 * "known":    a node label in knownLabels matches (substring after normalization)
 * "adjacent": no known match, but at least one other concept in articleConcepts
 *             is known AND shares an edge with this concept in edgePairs
 * "unknown":  neither condition met
 */
export function classifyConceptDistance(
  articleConcepts: string[],
  knownLabels: Set<string>,
  edgePairs: Array<[string, string]>
): ConceptClassification[] {
  if (articleConcepts.length === 0) return [];

  // Normalize known labels once for matching
  const normalizedKnown = new Set<string>();
  for (const label of knownLabels) {
    normalizedKnown.add(normalize(label));
  }

  // Build a set of known normalized article concepts for edge adjacency check
  const knownInArticle = new Set<string>();
  for (const concept of articleConcepts) {
    const norm = normalize(concept);
    if (normalizedKnown.has(norm)) {
      knownInArticle.add(norm);
    }
  }

  // Normalize edge pairs once
  const normalizedEdges: Array<[string, string]> = edgePairs.map(
    ([a, b]) => [normalize(a), normalize(b)]
  );

  return articleConcepts.map((concept): ConceptClassification => {
    const norm = normalize(concept);

    // Check "known": exact match, else token-boundary containment. Raw
    // bidirectional substring matching over-matched short labels — e.g. a
    // 2-3 char label hiding inside an unrelated word (PIPE-L5).
    let isKnown = normalizedKnown.has(norm);
    if (!isKnown) {
      for (const kn of normalizedKnown) {
        if (tokenBoundaryIncludes(norm, kn) || tokenBoundaryIncludes(kn, norm)) {
          isKnown = true;
          break;
        }
      }
    }
    if (isKnown) {
      return { label: concept, distance: 'known' };
    }

    // Check "adjacent": at least one other known article concept shares an edge with this one
    for (const [ea, eb] of normalizedEdges) {
      const thisIsA = ea === norm;
      const thisIsB = eb === norm;
      if (thisIsA && knownInArticle.has(eb)) {
        return { label: concept, distance: 'adjacent' };
      }
      if (thisIsB && knownInArticle.has(ea)) {
        return { label: concept, distance: 'adjacent' };
      }
    }

    return { label: concept, distance: 'unknown' };
  });
}

/**
 * Computes raw surprise score from distance classifications.
 * Formula: (unknown_count * 1.0 + adjacent_count * 0.5) / total_count
 * Returns 0.0 for empty input.
 */
export function computeRawSurprise(
  classifications: ConceptClassification[]
): number {
  if (classifications.length === 0) return 0.0;
  let unknownCount  = 0;
  let adjacentCount = 0;
  for (const c of classifications) {
    if (c.distance === 'unknown')  unknownCount++;
    if (c.distance === 'adjacent') adjacentCount++;
  }
  return (unknownCount * 1.0 + adjacentCount * 0.5) / classifications.length;
}

/**
 * Maps LLM composite score (1.0–5.0) to quality weight [0.5, 1.0].
 * Formula: 0.5 + (llm_score - 1.0) * 0.125
 * Clamps: below 1.0 returns 0.5; above 5.0 returns 1.0.
 * undefined input returns 0.75 (neutral midpoint for fixed-source articles).
 */
export function normalizeQualityWeight(
  llmScore: number | undefined
): number {
  if (llmScore === undefined) return 0.75;
  const raw = 0.5 + (llmScore - 1.0) * 0.125;
  return Math.min(1.0, Math.max(0.5, raw));
}

/**
 * Final serendipity score.
 * Formula: raw_surprise * quality_weight
 */
export function computeSerendipityScore(
  rawSurprise: number,
  qualityWeight: number
): number {
  return rawSurprise * qualityWeight;
}
