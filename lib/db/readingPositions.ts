/**
 * DB helpers for the reading_positions table.
 *
 * Tracks paragraph-level "I stopped here" state per device+article.
 */

import { sql } from '@/lib/db/client';

export interface ReadingPositionRow {
  device_id:       string;
  article_id:      string;
  paragraph_index: number;
  dwell_seconds:   number;
  paused_at:       string;   // ISO string
  finished_at:     string | null;
}

/**
 * Upserts the reading position for a device + article pair.
 * Only advances forward (ignores updates with a lower paragraph_index
 * than what is already stored) unless finished_at is being set.
 */
export async function upsertReadingPosition(
  deviceId: string,
  articleId: string,
  paragraphIndex: number,
  dwellSeconds: number,
  finishedAt?: string | null
): Promise<void> {
  await sql`
    INSERT INTO reading_positions
      (device_id, article_id, paragraph_index, dwell_seconds, paused_at, finished_at)
    VALUES (
      ${deviceId},
      ${articleId},
      ${paragraphIndex},
      ${dwellSeconds},
      NOW(),
      ${finishedAt ?? null}
    )
    ON CONFLICT (device_id, article_id) DO UPDATE
      SET paragraph_index = GREATEST(EXCLUDED.paragraph_index, reading_positions.paragraph_index),
          dwell_seconds   = EXCLUDED.dwell_seconds,
          paused_at       = NOW(),
          finished_at     = COALESCE(EXCLUDED.finished_at, reading_positions.finished_at)
  `;
}

/**
 * Returns the stored reading position for a device + article, or null.
 */
export async function getReadingPosition(
  deviceId: string,
  articleId: string
): Promise<ReadingPositionRow | null> {
  const rows = await sql`
    SELECT device_id, article_id, paragraph_index, dwell_seconds,
           paused_at::text AS paused_at, finished_at::text AS finished_at
    FROM reading_positions
    WHERE device_id = ${deviceId} AND article_id = ${articleId}
  `;
  if (rows.length === 0) return null;
  return rows[0] as ReadingPositionRow;
}
