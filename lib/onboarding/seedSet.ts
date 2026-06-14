/**
 * Committed fallback calibration set (R4-08).
 *
 * When no assembled batch exists yet (or a DB read hiccups), the first-run
 * calibration flow falls back to these hand-authored fixtures. They are NOT real
 * DB-scored articles, so feedback on them cannot go through the normal feedback
 * path — that would write phantom feedback rows for non-existent article ids and
 * skip the aesthetic EMA (getArticleAestheticScore returns null). Instead each
 * piece carries a hand-authored aesthetic vector so the centroid can be seeded
 * directly (via POST /api/onboarding/seed) with no feedback-row writes.
 */

import type { AestheticScoreVector } from '@/lib/types/aesthetic';
import type { CalibrationPiece } from '@/lib/onboarding/calibration';
import seedJson from '@/data/calibration_seed.json';

/** A committed seed card: a calibration card plus its hand-authored aesthetic. */
export interface SeedPiece extends CalibrationPiece {
  aesthetic: AestheticScoreVector;
}

const SEED_PIECES = seedJson as SeedPiece[];

/**
 * Client-facing calibration cards for the fallback — the same fields a batch
 * piece exposes, WITHOUT the internal aesthetic vector (kept server-side).
 */
export const SEED_CALIBRATION_PIECES: CalibrationPiece[] = SEED_PIECES.map(
  ({ id, title, dek, source, category }) => ({ id, title, dek, source, category })
);

const SEED_AESTHETIC_BY_ID = new Map<string, AestheticScoreVector>(
  SEED_PIECES.map((p) => [p.id, p.aesthetic])
);

/**
 * Returns the hand-authored aesthetic vector for a fallback seed id, or
 * undefined when `id` is not one of the committed seed pieces (so callers never
 * seed or write anything for an unknown id).
 */
export function getSeedAesthetic(id: string): AestheticScoreVector | undefined {
  return SEED_AESTHETIC_BY_ID.get(id);
}
