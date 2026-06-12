// Phase 4: Exploration slot pool construction, assembly, deduplication, and slot-type tagging.

import type { Article } from '@/lib/types/article';
import type { ConceptClassification } from '@/lib/pipeline/serendipityScorer';
import {
  SLOT_ALLOCATION,
  EXPLORATION_FLOOR,
  EXPLORATION_CEILING,
} from '@/lib/config/serendipity';
import { ARTICLES_PER_DAY } from '@/lib/config/feed';

export interface ExplorationPools {
  semanticStretch: Article[];  // sorted serendipityScore DESC
  blindSpotProbe:  Article[];  // 0 or 1 article
  wildcard:        Article[];  // sorted llmScore DESC (fallback: serendipityScore DESC)
}

/**
 * Builds the three exploration sub-pools from the candidate article list.
 *
 * Semantic stretch: articles with at least one 'adjacent' concept classification.
 *   Fallback: if empty, articles with at least one 'unknown' classification.
 *   Sorted by serendipityScore DESC.
 *
 * Blind spot probe: [probeArticle] if non-null, else [].
 *
 * Wildcard: all candidates sorted by llmScore DESC (fallback: serendipityScore DESC).
 *   Not filtered by concept proximity — any quality-passing article is eligible.
 */
export function buildSlotPools(
  candidates: Article[],
  serendipityScores: Map<string, number>,
  conceptClassifications: Map<string, ConceptClassification[]>,
  probeArticle: Article | null
): ExplorationPools {
  const getSerendipity = (a: Article) => serendipityScores.get(a.id) ?? 0;

  // Semantic stretch: at least one adjacent classification
  let semanticStretch = candidates.filter(a => {
    const classifications = conceptClassifications.get(a.id) ?? [];
    return classifications.some(c => c.distance === 'adjacent');
  });

  // Fallback: include articles with at least one unknown classification
  if (semanticStretch.length === 0) {
    semanticStretch = candidates.filter(a => {
      const classifications = conceptClassifications.get(a.id) ?? [];
      return classifications.some(c => c.distance === 'unknown');
    });
  }

  semanticStretch = [...semanticStretch].sort((a, b) => getSerendipity(b) - getSerendipity(a));

  // Blind spot probe: 0 or 1 article
  const blindSpotProbe: Article[] = probeArticle ? [probeArticle] : [];

  // Wildcard: all candidates sorted by llmScore DESC, then serendipityScore DESC
  const wildcard = [...candidates].sort((a, b) => {
    const llmDiff = (b.llmScore ?? 0) - (a.llmScore ?? 0);
    if (llmDiff !== 0) return llmDiff;
    return getSerendipity(b) - getSerendipity(a);
  });

  return { semanticStretch, blindSpotProbe, wildcard };
}

/**
 * Assembles exploration slots from the three sub-pools according to the budget allocation.
 *
 * Budget is clamped to [EXPLORATION_FLOOR, EXPLORATION_CEILING].
 * If a pool is exhausted before its allocation is met, fills remaining slots from
 * the union of all three pools sorted by serendipityScore DESC.
 */
export function assembleExplorationSlots(
  pools: ExplorationPools,
  budget: number
): Article[] {
  const clampedBudget = Math.min(Math.max(budget, EXPLORATION_FLOOR), EXPLORATION_CEILING);
  const allocation = SLOT_ALLOCATION[clampedBudget];

  const selected: Article[] = [];
  const selectedIds = new Set<string>();

  function pickFrom(pool: Article[], count: number): void {
    let taken = 0;
    for (const article of pool) {
      if (taken >= count) break;
      if (selectedIds.has(article.id)) continue;
      selected.push(article);
      selectedIds.add(article.id);
      taken++;
    }
  }

  pickFrom(pools.semanticStretch, allocation.semanticStretch);
  pickFrom(pools.blindSpotProbe,  allocation.blindSpotProbe);
  pickFrom(pools.wildcard,        allocation.wildcard);

  // If any shortfall, fill from the union of all pools sorted by serendipityScore DESC
  const shortfall = clampedBudget - selected.length;
  if (shortfall > 0) {
    const unionMap = new Map<string, Article>();
    for (const a of [...pools.semanticStretch, ...pools.blindSpotProbe, ...pools.wildcard]) {
      if (!unionMap.has(a.id)) unionMap.set(a.id, a);
    }
    const union = Array.from(unionMap.values()).sort(
      (a, b) => (b.serendipityScore ?? 0) - (a.serendipityScore ?? 0)
    );
    pickFrom(union, shortfall);
  }

  return selected;
}

/**
 * Returns a deduplicated exploitation pool with all exploration articles removed.
 */
export function deduplicateExploitPool(
  explorationSlots: Article[],
  exploitCandidates: Article[]
): Article[] {
  const explorationIds = new Set(explorationSlots.map(a => a.id));
  return exploitCandidates.filter(a => !explorationIds.has(a.id));
}

/**
 * Mutates explorationSlotType on each article based on which pool it came from.
 * Priority: blind_spot_probe > semantic_stretch > wildcard.
 */
export function tagExplorationSlotTypes(
  explorationSlots: Article[],
  pools: ExplorationPools
): void {
  const probeIds = new Set(pools.blindSpotProbe.map(a => a.id));
  const stretchIds = new Set(pools.semanticStretch.map(a => a.id));

  for (const article of explorationSlots) {
    if (probeIds.has(article.id)) {
      article.explorationSlotType = 'blind_spot_probe';
    } else if (stretchIds.has(article.id)) {
      article.explorationSlotType = 'semantic_stretch';
    } else {
      article.explorationSlotType = 'wildcard';
    }
  }
}

/**
 * Computes interleave positions for exploration slots in the final feed.
 * Formula: Math.round(2 + i * (ARTICLES_PER_DAY / budget)) for i in [0, budget-1].
 * The +2 offset avoids position 0.
 */
export function computeExplorationPositions(budget: number): number[] {
  const positions: number[] = [];
  for (let i = 0; i < budget; i++) {
    positions.push(Math.round(2 + i * (ARTICLES_PER_DAY / budget)));
  }
  return positions;
}
