/**
 * DB helpers for issue metadata (column: article_batches.issue_metadata).
 */

import { sql } from '@/lib/db/client';
import type { DailyIssue } from '@/lib/types/article';

/**
 * Returns the total number of batches in the table (used to derive issue number).
 */
export async function getBatchCount(): Promise<number> {
  const rows = await sql`SELECT COUNT(*)::int AS n FROM article_batches`;
  const row = rows[0] as { n: number };
  return row?.n ?? 1;
}

/**
 * Returns the stored issue_metadata for a given batch date.
 * Returns null if not yet generated or the batch doesn't exist.
 */
export async function getIssueMetadata(batchDate: string): Promise<DailyIssue | null> {
  const rows = await sql`
    SELECT issue_metadata
    FROM article_batches
    WHERE batch_date = ${batchDate}
  `;
  if (rows.length === 0) return null;
  const row = rows[0] as { issue_metadata: unknown };
  return row.issue_metadata ? (row.issue_metadata as DailyIssue) : null;
}

/**
 * Writes (or overwrites) the issue_metadata for a given batch date.
 */
export async function saveIssueMetadata(
  batchDate: string,
  meta: DailyIssue
): Promise<void> {
  await sql`
    UPDATE article_batches
    SET issue_metadata = ${JSON.stringify(meta)}::jsonb
    WHERE batch_date = ${batchDate}
  `;
}
