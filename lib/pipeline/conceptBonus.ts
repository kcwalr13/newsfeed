// Pure function: applies concept resonance bonus to non-top-30% ranked articles.

import type { Article } from '@/lib/types/article';

export interface ScoredArticle {
  article: Article;
  rawScore: number;
}

/**
 * Normalizes a string for concept label matching:
 * - Lowercases
 * - Replaces non-alphanumeric characters (except spaces) with spaces
 * - Collapses multiple spaces to one
 * - Trims
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Applies a concept resonance bonus to articles outside the top 30% of the feed.
 *
 * For each article not in the top 30% (by rawScore):
 *   - 0 label matches:   +0.00
 *   - 1 label match:     +0.05
 *   - 2+ label matches:  +0.10 (cap)
 *
 * Articles already in the top 30% are returned unchanged to prevent the concept
 * graph from creating a reinforcing feedback loop on already-highly-ranked content.
 *
 * @param scores  Articles pre-sorted by rawScore descending
 * @param userConcepts  Top-N concept labels from the user's graph (raw strings)
 * @returns Same array with rawScore modified in-place for eligible articles
 */
export function applyConceptBonus(
  scores: ScoredArticle[],
  userConcepts: string[]
): ScoredArticle[] {
  if (scores.length === 0 || userConcepts.length === 0) return scores;

  // Normalize all concept labels once
  const normalizedConcepts = userConcepts.map(normalize);

  // Top 30% floor: articles at indices < floorIdx are already in the top 30%
  const floorIdx = Math.floor(scores.length * 0.3);

  for (let i = floorIdx; i < scores.length; i++) {
    const article = scores[i].article;
    const haystack = normalize(
      (article.title ?? '') + ' ' + (article.description ?? '')
    );

    let matches = 0;
    for (const concept of normalizedConcepts) {
      if (concept.length > 0 && haystack.includes(concept)) {
        matches += 1;
        if (matches >= 2) break; // cap reached, no need to continue
      }
    }

    const bonus = matches >= 2 ? 0.10 : matches === 1 ? 0.05 : 0.0;
    scores[i].rawScore += bonus;
  }

  return scores;
}
