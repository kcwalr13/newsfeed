// DB helper functions for aesthetic scoring and user aesthetic profiles (Phase 2 + Phase 3).

import { sql } from './client';
import type { AestheticScoreVector, AestheticProfile } from '@/lib/types/aesthetic';
import {
  arrayToVector,
  vectorToArray,
  SHORT_TERM_WINDOW_DAYS,
  SHORT_TERM_MIN_EVENTS,
  DRIFT_THRESHOLD,
} from '@/lib/config/aesthetic';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parses a pgvector string representation like "[1.5,3.0,2.5,4.0,2.0,3.5]"
 * into a number[]. Neon returns vector columns as strings.
 */
function parseVectorString(s: string): number[] {
  // Non-finite entries (malformed DB strings → NaN) are dropped so downstream
  // math can't silently propagate NaN; a short vector then fails the
  // cosineSimilarity length guard instead (PIPE-L1).
  return s.replace(/^\[|\]$/g, '').split(',').map(Number).filter(Number.isFinite);
}

/**
 * Formats a number[] as the pgvector literal string "[1.5,3.0,...]".
 */
function formatVectorString(arr: number[]): string {
  return `[${arr.join(',')}]`;
}

// ── Article aesthetic scores ──────────────────────────────────────────────────

/**
 * Upserts the aesthetic score for an article. A second call for the same
 * article_id updates the existing row (scored_at is refreshed).
 * Throws on DB error.
 */
export async function upsertArticleAestheticScore(
  articleId: string,
  scores: AestheticScoreVector
): Promise<void> {
  const vecStr = formatVectorString(vectorToArray(scores));
  await sql`
    INSERT INTO article_aesthetic_scores (article_id, scores, scored_at)
    VALUES (${articleId}, ${vecStr}::vector, NOW())
    ON CONFLICT (article_id)
    DO UPDATE SET
      scores    = EXCLUDED.scores,
      scored_at = NOW()
  `;
}

/**
 * Returns the aesthetic score vector for a single article, or null if no
 * row exists for the given articleId.
 * Throws on DB error (null is NOT returned on error).
 */
export async function getArticleAestheticScore(
  articleId: string
): Promise<AestheticScoreVector | null> {
  const rows = await sql`
    SELECT scores::text AS scores
    FROM article_aesthetic_scores
    WHERE article_id = ${articleId}
  `;
  if (rows.length === 0) return null;
  return arrayToVector(parseVectorString((rows[0] as { scores: string }).scores));
}

/**
 * Returns a Map of articleId -> AestheticScoreVector for all provided IDs
 * that have scores in the DB. IDs with no score are absent from the map.
 * Uses a single bulk query. Safe to call with an empty array (returns empty Map).
 * Throws on DB error.
 */
export async function getArticleAestheticScores(
  articleIds: string[]
): Promise<Map<string, AestheticScoreVector>> {
  const result = new Map<string, AestheticScoreVector>();
  if (articleIds.length === 0) return result;

  const rows = await sql`
    SELECT article_id, scores::text AS scores
    FROM article_aesthetic_scores
    WHERE article_id = ANY(${articleIds})
  `;
  for (const row of rows as Array<{ article_id: string; scores: string }>) {
    result.set(row.article_id, arrayToVector(parseVectorString(row.scores)));
  }
  return result;
}

// ── User aesthetic profiles ───────────────────────────────────────────────────

/**
 * Returns the aesthetic profile for the given identity, or null if no profile
 * exists yet (user has not given any qualifying feedback).
 * Throws on DB error (null is NOT returned on error).
 *
 * Identity resolution: if userId is provided, look up by userId AND deviceId.
 * If userId is null, look up by deviceId alone (anonymous session).
 */
export async function getAestheticProfile(
  userId: string | null,
  deviceId: string
): Promise<AestheticProfile | null> {
  let rows;
  if (userId) {
    rows = await sql`
      SELECT user_id, device_id, centroid::text AS centroid, feedback_count,
             updated_at::text AS updated_at,
             short_term_centroid::text AS short_term_centroid,
             short_term_feedback_count,
             short_term_window_start::text AS short_term_window_start,
             is_drifting,
             drift_detected_at::text AS drift_detected_at,
             CAST(receptivity_score AS FLOAT) AS receptivity_score,
             exploration_budget
      FROM user_aesthetic_profiles
      WHERE user_id = ${userId} AND device_id = ${deviceId}
      LIMIT 1
    `;
  } else {
    rows = await sql`
      SELECT user_id, device_id, centroid::text AS centroid, feedback_count,
             updated_at::text AS updated_at,
             short_term_centroid::text AS short_term_centroid,
             short_term_feedback_count,
             short_term_window_start::text AS short_term_window_start,
             is_drifting,
             drift_detected_at::text AS drift_detected_at,
             CAST(receptivity_score AS FLOAT) AS receptivity_score,
             exploration_budget
      FROM user_aesthetic_profiles
      WHERE user_id IS NULL AND device_id = ${deviceId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
  }
  if (rows.length === 0) return null;

  const row = rows[0] as {
    user_id:                     string | null;
    device_id:                   string;
    centroid:                    string | null;
    feedback_count:              number;
    updated_at:                  string;
    short_term_centroid:         string | null;
    short_term_feedback_count:   number;
    short_term_window_start:     string | null;
    is_drifting:                 boolean;
    drift_detected_at:           string | null;
    receptivity_score:           number | null;
    exploration_budget:          number;
  };

  if (!row.centroid) return null; // centroid column is null (should not happen after init, but be safe)

  return {
    user_id:                     row.user_id,
    device_id:                   row.device_id,
    centroid:                    arrayToVector(parseVectorString(row.centroid)),
    feedback_count:              row.feedback_count,
    updated_at:                  row.updated_at,
    short_term_centroid:         row.short_term_centroid
                                   ? arrayToVector(parseVectorString(row.short_term_centroid))
                                   : null,
    short_term_feedback_count:   row.short_term_feedback_count,
    short_term_window_start:     row.short_term_window_start,
    is_drifting:                 row.is_drifting,
    drift_detected_at:           row.drift_detected_at,
    receptivity_score:           row.receptivity_score,
    exploration_budget:          row.exploration_budget ?? 4,
  };
}

/**
 * Atomically applies one EMA feedback step to the profile centroid in a single
 * statement (DAT-L3). The blend reads the row's centroid AT UPDATE TIME inside
 * the upsert, so two concurrent feedback POSTs can no longer both blend
 * against the same stale read and silently drop one update (the previous flow
 * was select → JS EMA → overwrite).
 *
 * `target` is the article's score vector, pre-mirrored by the caller for
 * dislikes. On first feedback (no row, or a NULL centroid created by another
 * writer) the centroid initializes to the target directly.
 * Throws on DB error.
 */
export async function applyAestheticEmaUpdate(
  userId: string | null,
  deviceId: string,
  target: AestheticScoreVector,
  alpha: number
): Promise<void> {
  const targetStr = formatVectorString(vectorToArray(target));
  // pgvector (0.7+) has element-wise vector * vector but no scalar multiply,
  // so the scalars become constant vectors.
  const alphaStr = formatVectorString(Array(6).fill(alpha));
  const keepStr = formatVectorString(Array(6).fill(1 - alpha));
  await sql`
    INSERT INTO user_aesthetic_profiles
      (user_id, device_id, centroid, feedback_count, updated_at)
    VALUES
      (${userId ?? null}, ${deviceId}, ${targetStr}::vector, 1, NOW())
    ON CONFLICT (user_id, device_id)
    DO UPDATE SET
      centroid = CASE
        WHEN user_aesthetic_profiles.centroid IS NULL THEN EXCLUDED.centroid
        ELSE user_aesthetic_profiles.centroid * ${keepStr}::vector
           + EXCLUDED.centroid * ${alphaStr}::vector
      END,
      feedback_count = COALESCE(user_aesthetic_profiles.feedback_count, 0) + 1,
      updated_at     = NOW()
  `;
}

/**
 * Recomputes the 21-day rolling short-term centroid for the given identity
 * by averaging all qualifying feedback events in the window.
 * 'save' events are excluded from centroid computation.
 * Exits silently if no profile row exists yet.
 * Throws on DB error.
 */
export async function recomputeShortTermCentroid(
  userId: string | null,
  deviceId: string
): Promise<void> {
  // Check profile exists first — if not, exit without creating a row.
  // Row creation is the Phase 2 EMA path's responsibility.
  const profileRows = await sql`
    SELECT id FROM user_aesthetic_profiles
    WHERE (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
      AND device_id = ${deviceId}
    LIMIT 1
  `;
  if (profileRows.length === 0) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SHORT_TERM_WINDOW_DAYS);

  // Fetch all feedback events within the 21-day window that have aesthetic scores.
  // 'save' events are excluded from centroid computation.
  const rows = await sql`
    SELECT f.article_id, f.value, f.updated_at::text AS created_at,
           s.scores::text AS scores
    FROM feedback f
    JOIN article_aesthetic_scores s ON s.article_id = f.article_id
    WHERE f.device_id = ${deviceId}
      AND (f.user_id = ${userId} OR (f.user_id IS NULL AND ${userId}::text IS NULL))
      AND f.value IN ('like', 'dislike')
      AND f.updated_at >= ${cutoff.toISOString()}
    ORDER BY f.updated_at ASC
  `;

  const count = rows.length;

  if (count < SHORT_TERM_MIN_EVENTS) {
    // Not enough events — write null centroid.
    await sql`
      UPDATE user_aesthetic_profiles
      SET short_term_centroid       = NULL,
          short_term_feedback_count = ${count},
          short_term_window_start   = NULL
      WHERE (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
        AND device_id = ${deviceId}
    `;
    return;
  }

  // Compute unweighted average.
  const acc = [0, 0, 0, 0, 0, 0];
  let oldestTs: string | null = null;
  for (const row of rows as Array<{ value: string; scores: string; created_at: string }>) {
    const vec = parseVectorString(row.scores);
    for (let i = 0; i < 6; i++) {
      acc[i] += row.value === 'like' ? vec[i] : (6 - vec[i]);
    }
    if (!oldestTs) oldestTs = row.created_at;
  }
  const averaged = acc.map(v => v / count);
  const vecStr2 = formatVectorString(averaged);

  await sql`
    UPDATE user_aesthetic_profiles
    SET short_term_centroid       = ${vecStr2}::vector,
        short_term_feedback_count = ${count},
        short_term_window_start   = ${oldestTs}
    WHERE (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
      AND device_id = ${deviceId}
  `;
}

/**
 * Persists the computed receptivity score and exploration budget to the user's aesthetic profile.
 * No-op if no profile row exists yet (UPDATE affects 0 rows silently).
 * Throws on DB error.
 */
export async function updateReceptivity(
  userId: string | null,
  deviceId: string,
  receptivityScore: number,
  explorationBudget: number
): Promise<void> {
  await sql`
    UPDATE user_aesthetic_profiles
    SET receptivity_score  = ${receptivityScore},
        exploration_budget = ${explorationBudget}
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
  `;
}

/**
 * Updates the drift state columns on the user's aesthetic profile.
 * Uses a single UPDATE with CASE logic to avoid a round-trip fetch.
 * Clears drift state when driftScore is null or below threshold.
 * Throws on DB error.
 */
export async function updateDriftState(
  userId: string | null,
  deviceId: string,
  driftScore: number | null
): Promise<void> {
  await sql`
    UPDATE user_aesthetic_profiles
    SET
      is_drifting = CASE
        WHEN ${driftScore} IS NULL OR ${driftScore} < ${DRIFT_THRESHOLD} THEN FALSE
        ELSE TRUE
      END,
      drift_detected_at = CASE
        WHEN ${driftScore} IS NULL OR ${driftScore} < ${DRIFT_THRESHOLD} THEN NULL
        WHEN is_drifting = FALSE AND ${driftScore} >= ${DRIFT_THRESHOLD} THEN NOW()
        ELSE drift_detected_at
      END
    WHERE (user_id = ${userId} OR (user_id IS NULL AND ${userId}::text IS NULL))
      AND device_id = ${deviceId}
  `;
}
