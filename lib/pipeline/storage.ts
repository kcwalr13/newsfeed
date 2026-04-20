import { sql } from '@/lib/db/client';
import type { ArticleBatch } from '../types/article';

/**
 * Writes a batch to the article_batches table.
 * When force is false (default), does NOT overwrite an existing row.
 * Returns true if the batch was written.
 */
export async function writeBatch(batch: ArticleBatch, force = false): Promise<boolean> {
  if (!force) {
    const existing = await readBatch(batch.batchDate);
    if (existing) return false;
  }
  await sql`
    INSERT INTO article_batches (batch_date, generated_at, articles)
    VALUES (
      ${batch.batchDate},
      ${batch.generatedAt}::timestamptz,
      ${JSON.stringify(batch.articles)}::jsonb
    )
    ON CONFLICT (batch_date) DO UPDATE
      SET generated_at = EXCLUDED.generated_at,
          articles     = EXCLUDED.articles
  `;
  return true;
}

/**
 * Reads and returns the batch for the given date.
 * Returns null if no batch exists for that date.
 */
export async function readBatch(date: string): Promise<ArticleBatch | null> {
  const rows = await sql`
    SELECT batch_date, generated_at::text AS generated_at, articles
    FROM article_batches
    WHERE batch_date = ${date}
  `;
  if (rows.length === 0) return null;
  const row = rows[0] as { batch_date: string; generated_at: string; articles: unknown };
  return {
    batchDate: row.batch_date,
    generatedAt: row.generated_at,
    articles: row.articles as ArticleBatch['articles'],
  };
}

/**
 * Returns the most recent batch across all dates.
 * Returns null if the table is empty.
 */
export async function readLatestBatch(): Promise<ArticleBatch | null> {
  const rows = await sql`
    SELECT batch_date, generated_at::text AS generated_at, articles
    FROM article_batches
    ORDER BY batch_date DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0] as { batch_date: string; generated_at: string; articles: unknown };
  return {
    batchDate: row.batch_date,
    generatedAt: row.generated_at,
    articles: row.articles as ArticleBatch['articles'],
  };
}

/** Logs a pipeline message to the console (visible in Vercel function logs). */
export function appendLog(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}
