// Aesthetic dimension constants, vector conversion utilities, and blend weights for Phase 2.

import type { AestheticScoreVector } from '@/lib/types/aesthetic';

// ── EMA and blending constants ────────────────────────────────────────────────

/** EMA adaptation rate for the user aesthetic centroid. Each new feedback event
 *  contributes 20% weight; the accumulated prior contributes 80%. */
export const AESTHETIC_ALPHA = 0.2;

/** Weight of aesthetic proximity signal in the blended rank score (0–1). */
export const AESTHETIC_WEIGHT = 0.3;

/** Weight of source Wilson-score signal in the blended rank score (0–1). */
export const SOURCE_SCORE_WEIGHT = 0.7;

// Invariant: must sum to 1.0. Asserted at module load time.
if (Math.abs(AESTHETIC_WEIGHT + SOURCE_SCORE_WEIGHT - 1.0) > 1e-10) {
  throw new Error(
    `[config/aesthetic] Blend weight mismatch: AESTHETIC_WEIGHT (${AESTHETIC_WEIGHT}) ` +
    `+ SOURCE_SCORE_WEIGHT (${SOURCE_SCORE_WEIGHT}) must equal 1.0`
  );
}

// ── Scale bounds ──────────────────────────────────────────────────────────────

/** Minimum valid score per aesthetic dimension (inclusive). */
export const AESTHETIC_SCALE_MIN = 1.0;

/** Maximum valid score per aesthetic dimension (inclusive). */
export const AESTHETIC_SCALE_MAX = 5.0;

// ── Text input limits ─────────────────────────────────────────────────────────

/** Minimum bodyText length (characters) to use bodyText as scorer input.
 *  Below this threshold, title + description are used instead. */
export const AESTHETIC_BODY_MIN_CHARS = 300;

/** Maximum characters of article text sent to the aesthetic scorer LLM per call
 *  (cost control; sufficient for aesthetic quality assessment). */
export const AESTHETIC_BODY_MAX_CHARS = 3000;

// ── Dimension key ordering ────────────────────────────────────────────────────

/** Canonical key order for the six aesthetic dimensions.
 *  This order determines the positional mapping in vector(6) DB storage.
 *  Do not change without a corresponding database migration. */
export const DIMENSION_KEYS: Array<keyof AestheticScoreVector> = [
  'contemplative',  // index 0
  'concrete',       // index 1
  'personal',       // index 2
  'playful',        // index 3
  'specialist',     // index 4
  'emotional',      // index 5
];

// ── Vector conversion utilities ───────────────────────────────────────────────

/**
 * Converts a named-field AestheticScoreVector to a positional number[].
 * The array order is fixed by DIMENSION_KEYS.
 */
export function vectorToArray(v: AestheticScoreVector): number[] {
  return DIMENSION_KEYS.map(k => v[k]);
}

/**
 * Converts a positional number[] (from pgvector storage) back to a named-field
 * AestheticScoreVector. The array must have exactly 6 elements in DIMENSION_KEYS order.
 */
export function arrayToVector(arr: number[]): AestheticScoreVector {
  if (arr.length !== 6) {
    throw new Error(`[aesthetic] arrayToVector: expected 6 elements, got ${arr.length}`);
  }
  return {
    contemplative: arr[0],
    concrete:      arr[1],
    personal:      arr[2],
    playful:       arr[3],
    specialist:    arr[4],
    emotional:     arr[5],
  };
}
