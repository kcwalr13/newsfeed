// Pure utility: computes cosine distance between short-term and long-term aesthetic centroids.

import type { AestheticProfile } from '@/lib/types/aesthetic';
import { vectorToArray, SHORT_TERM_MIN_EVENTS } from '@/lib/config/aesthetic';
import { cosineSimilarity } from '@/lib/utils/cosineSimilarity';

/**
 * Computes the cosine distance between the short-term and long-term aesthetic
 * centroids. Returns null when the short-term window is unreliable (fewer than
 * SHORT_TERM_MIN_EVENTS qualifying events, or no short-term centroid computed yet).
 *
 * Returns a value in [0, 1] where:
 *   0 = perfect alignment (short-term taste matches long-term)
 *   1 = complete orthogonality (short-term taste unrelated to long-term)
 */
export function computeDriftScore(profile: AestheticProfile): number | null {
  if (
    !profile.short_term_centroid ||
    profile.short_term_feedback_count < SHORT_TERM_MIN_EVENTS
  ) {
    return null;
  }
  const st = vectorToArray(profile.short_term_centroid);
  const lt = vectorToArray(profile.centroid);
  return 1 - cosineSimilarity(st, lt);
}
