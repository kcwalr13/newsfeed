import { sql } from './client';

export interface DbFeedbackRow {
  article_id: string;
  value: 'like' | 'dislike' | 'save';
  updated_at: string;
}

/** Returns all feedback rows for a device. */
export async function getFeedbackForDevice(deviceId: string): Promise<DbFeedbackRow[]> {
  const rows = await sql`
    SELECT article_id, value, updated_at::text AS updated_at
    FROM feedback
    WHERE device_id = ${deviceId}
  `;
  return rows as DbFeedbackRow[];
}

/**
 * Returns the identity of the most recent feedback row, or null when no
 * feedback exists. Used by pipeline-time personalization (e.g. blind-spot
 * probing) on cron runs, which carry no session (single-user app).
 */
export async function getMostRecentFeedbackIdentity(): Promise<
  { userId: string | null; deviceId: string } | null
> {
  const rows = await sql`
    SELECT user_id, device_id
    FROM feedback
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0] as { user_id: string | null; device_id: string };
  return { userId: r.user_id, deviceId: r.device_id };
}

/** Returns deduplicated feedback for an authenticated user (most-recent per article). */
export async function getFeedbackForUser(userId: string): Promise<DbFeedbackRow[]> {
  const rows = await sql`
    SELECT DISTINCT ON (article_id) article_id, value, updated_at::text AS updated_at
    FROM feedback
    WHERE user_id = ${userId}
    ORDER BY article_id, updated_at DESC
  `;
  return rows as DbFeedbackRow[];
}

/** Upserts a single feedback record. Returns the saved row. */
export async function upsertFeedback(
  deviceId: string,
  articleId: string,
  value: 'like' | 'dislike' | 'save',
  userId?: string | null,
  dwellSeconds?: number | null
): Promise<DbFeedbackRow> {
  const dwell = dwellSeconds ?? null;
  const rows = await sql`
    INSERT INTO feedback (device_id, article_id, value, updated_at, user_id, dwell_seconds)
    VALUES (${deviceId}, ${articleId}, ${value}, NOW(), ${userId ?? null}, ${dwell})
    ON CONFLICT (device_id, article_id)
    DO UPDATE SET
      value         = EXCLUDED.value,
      updated_at    = NOW(),
      user_id       = COALESCE(EXCLUDED.user_id, feedback.user_id),
      dwell_seconds = COALESCE(EXCLUDED.dwell_seconds, feedback.dwell_seconds)
    RETURNING article_id, value, updated_at::text AS updated_at
  `;
  return rows[0] as DbFeedbackRow;
}

/**
 * Returns a single feedback row for the given identity and article, or null if not found.
 * Used by the Phase 3 engagement weight computation to check prior save status.
 */
export async function getFeedbackRow(
  deviceId: string,
  articleId: string,
  userId: string | null
): Promise<DbFeedbackRow | null> {
  const rows = userId
    ? await sql`SELECT article_id, value, updated_at::text AS updated_at FROM feedback WHERE user_id = ${userId} AND article_id = ${articleId} LIMIT 1`
    : await sql`SELECT article_id, value, updated_at::text AS updated_at FROM feedback WHERE device_id = ${deviceId} AND user_id IS NULL AND article_id = ${articleId} LIMIT 1`;
  return rows.length > 0 ? (rows[0] as DbFeedbackRow) : null;
}

/** Deletes a feedback record. No-op if not found. */
export async function deleteFeedback(deviceId: string, articleId: string): Promise<void> {
  await sql`
    DELETE FROM feedback
    WHERE device_id = ${deviceId} AND article_id = ${articleId}
  `;
}

/**
 * Associates all unclaimed device feedback rows to a user on login.
 * Step A: most-recent-wins on conflict with existing user records.
 * Step B: claims all remaining unclaimed device rows.
 * Must run sequentially (Step A before Step B).
 */
export async function associateFeedbackToUser(
  deviceId: string,
  userId: string
): Promise<void> {
  // Step A: update existing user records where the device record is newer
  await sql`
    UPDATE feedback AS existing
    SET
      value      = device.value,
      updated_at = device.updated_at
    FROM feedback AS device
    WHERE device.device_id = ${deviceId}
      AND device.user_id IS NULL
      AND existing.user_id = ${userId}
      AND existing.article_id = device.article_id
      AND device.updated_at > existing.updated_at
  `;

  // Step B: claim all remaining unclaimed device rows
  await sql`
    UPDATE feedback
    SET user_id = ${userId}
    WHERE device_id = ${deviceId}
      AND user_id IS NULL
  `;
}

/** Max records accepted by a single localStorage-migration call (DAT-M7). */
export const MAX_MIGRATE_RECORDS = 500;

/**
 * Bulk upsert for one-time migration from localStorage.
 * Server record wins if its updated_at is newer than the incoming record.
 * Runs as a single non-interactive transaction (one HTTP round trip, atomic —
 * no unbounded parallel writes). Returns the count of rows written.
 */
export async function migrateFeedbackRecords(
  deviceId: string,
  records: Array<{ articleId: string; value: 'like' | 'dislike' | 'save'; updatedAt: string }>
): Promise<number> {
  if (records.length === 0) return 0;
  const capped = records.slice(0, MAX_MIGRATE_RECORDS);
  const results = await sql.transaction(
    capped.map(
      (r) => sql`
        INSERT INTO feedback (device_id, article_id, value, updated_at)
        VALUES (${deviceId}, ${r.articleId}, ${r.value}, ${r.updatedAt}::timestamptz)
        ON CONFLICT (device_id, article_id)
        DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at
        WHERE feedback.updated_at < EXCLUDED.updated_at
        RETURNING article_id
      `
    )
  );
  return results.reduce((written, rows) => written + (rows.length > 0 ? 1 : 0), 0);
}
