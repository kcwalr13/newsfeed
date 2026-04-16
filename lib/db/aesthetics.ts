// DB helper functions for aesthetic scoring and user aesthetic profiles (Phase 2).

import { sql } from './client';
import type { AestheticScoreVector, AestheticProfile } from '@/lib/types/aesthetic';
import { arrayToVector, vectorToArray } from '@/lib/config/aesthetic';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parses a pgvector string representation like "[1.5,3.0,2.5,4.0,2.0,3.5]"
 * into a number[]. Neon returns vector columns as strings.
 */
function parseVectorString(s: string): number[] {
  return s.replace(/^\[|\]$/g, '').split(',').map(Number);
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
             updated_at::text AS updated_at
      FROM user_aesthetic_profiles
      WHERE user_id = ${userId} AND device_id = ${deviceId}
      LIMIT 1
    `;
  } else {
    rows = await sql`
      SELECT user_id, device_id, centroid::text AS centroid, feedback_count,
             updated_at::text AS updated_at
      FROM user_aesthetic_profiles
      WHERE user_id IS NULL AND device_id = ${deviceId}
      LIMIT 1
    `;
  }
  if (rows.length === 0) return null;

  const row = rows[0] as {
    user_id: string | null;
    device_id: string;
    centroid: string | null;
    feedback_count: number;
    updated_at: string;
  };

  if (!row.centroid) return null; // centroid column is null (should not happen after init, but be safe)

  return {
    user_id:        row.user_id,
    device_id:      row.device_id,
    centroid:       arrayToVector(parseVectorString(row.centroid)),
    feedback_count: row.feedback_count,
    updated_at:     row.updated_at,
  };
}

/**
 * Upserts the aesthetic profile for the given identity.
 * Creates a new row on first call; updates centroid, feedback_count, and
 * updated_at on subsequent calls.
 * Throws on DB error.
 */
export async function upsertAestheticProfile(
  userId: string | null,
  deviceId: string,
  centroid: AestheticScoreVector,
  feedbackCount: number
): Promise<void> {
  const vecStr = formatVectorString(vectorToArray(centroid));
  await sql`
    INSERT INTO user_aesthetic_profiles
      (user_id, device_id, centroid, feedback_count, updated_at)
    VALUES
      (${userId ?? null}, ${deviceId}, ${vecStr}::vector, ${feedbackCount}, NOW())
    ON CONFLICT (user_id, device_id)
    DO UPDATE SET
      centroid       = EXCLUDED.centroid,
      feedback_count = EXCLUDED.feedback_count,
      updated_at     = NOW()
  `;
}
