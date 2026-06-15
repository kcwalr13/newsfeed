// Feed ranking: Phase 3 exploitation formula + Phase 4 serendipity exploration.
// Source scoring uses ALL historical feedback (cross-session) by extracting
// the source slug from each article ID (<source-slug>-<8-hex-hash> format).

import type { Article } from '@/lib/types/article';
import type { DbFeedbackRow } from '@/lib/db/feedback';
import type { AestheticProfile, AestheticScoreVector } from '@/lib/types/aesthetic';
import {
  vectorToArray,
  centerAestheticArray,
  aestheticWeightForFeedback,
  SHORT_TERM_WEIGHT,
  LONG_TERM_WEIGHT,
  DRIFT_SHORT_TERM_WEIGHT,
  DRIFT_LONG_TERM_WEIGHT,
  SHORT_TERM_MIN_EVENTS,
} from '@/lib/config/aesthetic';
import { ARTICLES_PER_DAY } from '@/lib/config/feed';
import {
  EXPLORATION_BASELINE,
  EXPLORATION_FLOOR,
  EXPLORATION_CEILING,
} from '@/lib/config/serendipity';
import { cosineSimilarity } from '@/lib/utils/cosineSimilarity';
import { applyConceptBonus } from '@/lib/pipeline/conceptBonus';
import {
  classifyConceptDistance,
  computeRawSurprise,
  normalizeQualityWeight,
  computeSerendipityScore,
} from '@/lib/pipeline/serendipityScorer';
import type { ConceptClassification } from '@/lib/pipeline/serendipityScorer';
import {
  buildSlotPools,
  assembleExplorationSlots,
  deduplicateExploitPool,
  tagExplorationSlotTypes,
  computeExplorationPositions,
} from '@/lib/pipeline/explorationAssembler';

export const SUPPRESSION_MIN_EVENTS    = 5;
export const SUPPRESSION_DISLIKE_RATIO = 0.80;
export const SOURCE_CONSECUTIVE_CAP    = 3;
export const MIN_FEED_ARTICLES         = 5;

/**
 * Extracts the source slug from an article ID.
 *
 * Article IDs are constructed as `<source-slug>-<8-char-hex-hash>` by makeId()
 * in lib/pipeline/run.ts. Both fixed-source and discovery articles follow this
 * convention, so the slug is always the string before the final 9 characters
 * (`-` + 8 hex chars).
 *
 * Examples:
 *   "quanta-magazine-a1b2c3d4" → "quanta-magazine"
 *   "astral-codex-ten-deadbeef" → "astral-codex-ten"
 *   "mit-technology-review-cafebabe" → "mit-technology-review"
 *
 * This lets us compute cross-session source scores from ALL historical feedback
 * rows without needing an in-batch article lookup.
 */
function extractSourceSlugFromId(articleId: string): string {
  // Guard: ID must be longer than the 9-char suffix to be valid
  if (articleId.length <= 9) return articleId;
  return articleId.slice(0, -9);
}

interface SourceStats {
  slug: string;
  likes: number;
  dislikes: number;
  total: number;
  score: number;       // Wilson lower bound, or 0.5 if total === 0
  suppressed: boolean;
}

// Wilson score lower bound for a binomial proportion.
// Returns 0.5 when total === 0 (neutral, no feedback).
function wilsonLowerBound(likes: number, total: number): number {
  if (total === 0) return 0.5;
  const z = 1.96;
  const zz = z * z;
  const phat = likes / total;
  const numerator =
    phat + zz / (2 * total) -
    z * Math.sqrt((phat * (1 - phat) + zz / (4 * total)) / total);
  const denominator = 1 + zz / total;
  return numerator / denominator;
}

// Derives the source slug from a sourceName string, matching the makeId() logic in run.ts.
function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// Post-processing pass: enforces no more than `cap` consecutive articles from the same source.
// Does not drop articles. When the cap is reached, pulls the next article from a different
// source forward in the list; if none exists, accepts the violation rather than dropping.
// Exported so the display-diversity reorders (which run AFTER the ranker) can re-apply it and
// not reintroduce a >cap same-source run near the fold (R4-05). A no-op when no run exceeds cap.
export function applyDiversityCap(articles: Article[], cap: number): Article[] {
  const pending = [...articles];
  const result: Article[] = [];
  let runSource: string | null = null;
  let runLength = 0;

  while (pending.length > 0) {
    let picked = 0;

    if (runLength >= cap) {
      // Must pick from a different source to break the run
      const altIdx = pending.findIndex(a => slugify(a.sourceName) !== runSource);
      if (altIdx !== -1) picked = altIdx;
      // If no alternative exists, fall through and pick index 0 (accept violation)
    }

    const article = pending.splice(picked, 1)[0];
    const slug = slugify(article.sourceName);
    if (slug === runSource) {
      runLength += 1;
    } else {
      runSource = slug;
      runLength = 1;
    }
    result.push(article);
  }

  return result;
}

/**
 * Returns the blended centroid to use for aesthetic proximity scoring.
 *
 * - If no long-term centroid exists (new user): returns null
 *   → rankFeed degrades to source-score-only
 * - If no reliable short-term centroid (< SHORT_TERM_MIN_EVENTS or null):
 *   returns the long-term centroid unchanged → Phase 2 behavior
 * - If profile.is_drifting: uses 65% short-term / 35% long-term
 * - Normal: uses 35% short-term / 65% long-term
 */
export function blendCentroids(profile: AestheticProfile): AestheticScoreVector | null {
  if (!profile.centroid) return null;

  if (
    !profile.short_term_centroid ||
    profile.short_term_feedback_count < SHORT_TERM_MIN_EVENTS
  ) {
    return profile.centroid;
  }

  const stWeight = profile.is_drifting ? DRIFT_SHORT_TERM_WEIGHT : SHORT_TERM_WEIGHT;
  const ltWeight = profile.is_drifting ? DRIFT_LONG_TERM_WEIGHT  : LONG_TERM_WEIGHT;

  const st = profile.short_term_centroid;
  const lt = profile.centroid;

  return {
    contemplative: stWeight * st.contemplative + ltWeight * lt.contemplative,
    concrete:      stWeight * st.concrete      + ltWeight * lt.concrete,
    personal:      stWeight * st.personal      + ltWeight * lt.personal,
    playful:       stWeight * st.playful       + ltWeight * lt.playful,
    specialist:    stWeight * st.specialist    + ltWeight * lt.specialist,
    emotional:     stWeight * st.emotional     + ltWeight * lt.emotional,
  };
}

export function rankFeed(
  articles: Article[],
  feedbackRows: DbFeedbackRow[],
  aestheticProfile?: AestheticProfile | null,
  aestheticScoreMap?: Map<string, AestheticScoreVector>,
  topConceptLabels?: string[],
  // Phase 4 additions (all optional for graceful degradation):
  allConceptLabels?: Set<string>,
  allConceptEdges?: Array<[string, string]>,
  explorationBudget?: number
): Article[] {
  // Step 1: Aggregate ALL historical feedback rows into per-source stats.
  // Source slug is extracted directly from the article ID (format: <slug>-<8hex>),
  // so every feedback event across all batches — not just today's — contributes
  // to the Wilson score. This is the cross-session taste signal.
  // Both 'like' and 'save' count as positive signals; 'dislike' as negative.
  const sourceStatsRaw = new Map<string, { likes: number; dislikes: number; total: number }>();
  for (const row of feedbackRows) {
    const slug = extractSourceSlugFromId(row.article_id);
    if (!sourceStatsRaw.has(slug)) {
      sourceStatsRaw.set(slug, { likes: 0, dislikes: 0, total: 0 });
    }
    const stats = sourceStatsRaw.get(slug)!;
    if (row.value === 'like' || row.value === 'save') {
      // 'save' is a strong positive signal: the user wants to read it later
      stats.likes += 1;
    } else if (row.value === 'dislike') {
      stats.dislikes += 1;
    }
    stats.total += 1;
  }

  // Step 2: Compute sourceScores for every unique source slug in the batch
  const allSlugs = new Set<string>();
  for (const article of articles) {
    allSlugs.add(slugify(article.sourceName));
  }

  const sourceScores = new Map<string, SourceStats>();
  for (const slug of allSlugs) {
    const raw = sourceStatsRaw.get(slug) ?? { likes: 0, dislikes: 0, total: 0 };
    const score = wilsonLowerBound(raw.likes, raw.total);
    const suppressed =
      raw.total >= SUPPRESSION_MIN_EVENTS &&
      raw.dislikes / raw.total >= SUPPRESSION_DISLIKE_RATIO;
    sourceScores.set(slug, { slug, ...raw, score, suppressed });
  }

  // Precompute the blended centroid as a CENTERED number[] for cosine calls.
  // Raw 1–5 vectors are all in the positive orthant, which made cosine nearly
  // constant; centering to [-1,1] lets opposite tastes actually score low.
  // null when no profile exists — collapses the aesthetic term to 0.0.
  const blendedCentroid = aestheticProfile ? blendCentroids(aestheticProfile) : null;
  const centroidArray: number[] | null = blendedCentroid
    ? centerAestheticArray(vectorToArray(blendedCentroid))
    : null;

  // Adaptive blend weight (P3-C1): trust source reputation when feedback is
  // sparse, the learned taste as the model matures. Ramps the aesthetic weight
  // up with the total feedback-event count; the source weight is its complement,
  // so the blend always sums to 1. Computed once — constant across the batch.
  const aestheticWeight = aestheticWeightForFeedback(feedbackRows.length);
  const sourceWeight = 1 - aestheticWeight;

  // Returns the blended rank score for an article.
  // When aestheticProfile is absent, collapses to source score only.
  function blendedScore(article: Article): number {
    const ss = sourceScores.get(slugify(article.sourceName))!.score;
    if (!centroidArray) return ss;

    // Centered cosine ∈ [-1, 1]: matched taste → +1, orthogonal/neutral → 0,
    // opposite → -1. Unscored articles get 0 (no signal, not a penalty).
    const scoreVec = aestheticScoreMap?.get(article.id);
    const aestheticProximity = scoreVec
      ? cosineSimilarity(centroidArray, centerAestheticArray(vectorToArray(scoreVec)))
      : 0.0;

    return sourceWeight * ss + aestheticWeight * aestheticProximity;
  }

  // Step 3: Sort non-suppressed articles by (blendedScore DESC, publishedAt DESC)
  // Apply concept resonance bonus to mid-ranked articles before final sort.
  // Must be sorted rawScore DESC first: applyConceptBonus protects the "top
  // 30%" BY INDEX, which is meaningless on an unsorted array (PIPE-M1).
  const allScores = articles
    .filter(a => !sourceScores.get(slugify(a.sourceName))!.suppressed)
    .map(a => ({ article: a, rawScore: blendedScore(a) }))
    .sort((a, b) => b.rawScore - a.rawScore);

  const withBonus = topConceptLabels && topConceptLabels.length > 0
    ? applyConceptBonus(allScores, topConceptLabels)
    : allScores;

  // Phase 4: serendipity scoring pre-pass
  const serendipityScores = new Map<string, number>();
  const conceptClassMap   = new Map<string, ConceptClassification[]>();

  if (allConceptLabels || allConceptEdges) {
    const labels = allConceptLabels ?? new Set<string>();
    const edges  = allConceptEdges  ?? [];

    for (const article of articles) {
      const concepts = article.extractedConcepts ?? [];
      const classifications = classifyConceptDistance(concepts, labels, edges);
      conceptClassMap.set(article.id, classifications);
      const rawSurprise  = computeRawSurprise(classifications);
      const qualityWt    = normalizeQualityWeight(article.llmScore);
      const sScore       = computeSerendipityScore(rawSurprise, qualityWt);
      serendipityScores.set(article.id, sScore);
      article.serendipityScore = sScore;  // transient; not in batch JSON
    }
  }

  // Step 4 (Phase 3 suppressed-source fallback): append least-disliked suppressed articles
  // if ranked candidates fall below minimum.
  const rankedNonSuppressed = withBonus
    .sort((a, b) => {
      if (b.rawScore !== a.rawScore) return b.rawScore - a.rawScore;
      return b.article.publishedAt.localeCompare(a.article.publishedAt);
    })
    .map(s => s.article);

  let ranked = [...rankedNonSuppressed];
  if (ranked.length < MIN_FEED_ARTICLES) {
    const suppressedArticles = articles
      .filter(a => sourceScores.get(slugify(a.sourceName))!.suppressed)
      .sort((a, b) =>
        sourceScores.get(slugify(b.sourceName))!.score -
        sourceScores.get(slugify(a.sourceName))!.score
      );
    const needed = MIN_FEED_ARTICLES - ranked.length;
    ranked = [...ranked, ...suppressedArticles.slice(0, needed)];
  }

  // Phase 4: two-pool exploration assembly
  const probeArticle = articles.find(a => a.probeInfo?.probeType === 'blind_spot') ?? null;

  const budget = Math.min(
    Math.max(explorationBudget ?? EXPLORATION_BASELINE, EXPLORATION_FLOOR),
    EXPLORATION_CEILING
  );

  const nonSuppressedCandidates = articles.filter(
    a => !sourceScores.get(slugify(a.sourceName))!.suppressed
  );

  const pools = buildSlotPools(
    nonSuppressedCandidates,
    serendipityScores,
    conceptClassMap,
    probeArticle
  );
  const explorationSlots = assembleExplorationSlots(pools, budget);
  tagExplorationSlotTypes(explorationSlots, pools);

  // Exploitation pool: Phase 3 ranked candidates minus exploration articles
  const exploitCandidates = deduplicateExploitPool(explorationSlots, ranked);
  const exploitTop = exploitCandidates.slice(0, ARTICLES_PER_DAY - explorationSlots.length);

  // Interleave at computed positions
  const positions = computeExplorationPositions(explorationSlots.length);
  const output = [...exploitTop];
  for (let i = 0; i < positions.length && i < explorationSlots.length; i++) {
    const insertAt = Math.min(positions[i], output.length);
    output.splice(insertAt, 0, explorationSlots[i]);
  }

  // Step 9: Apply source diversity cap
  return applyDiversityCap(output, SOURCE_CONSECUTIVE_CAP);
}
