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

/**
 * Returns the most recent batch with batch_date strictly before the given
 * date, or null if none exists. Used for prior-day probe-ignore processing.
 */
export async function readLatestBatchBefore(date: string): Promise<ArticleBatch | null> {
  const rows = await sql`
    SELECT batch_date, generated_at::text AS generated_at, articles
    FROM article_batches
    WHERE batch_date < ${date}
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

/**
 * Finds an article by id across all stored batches, newest batch first.
 * Returns the article plus its position in the containing batch, or null.
 * Uses JSONB containment (@>) so older shelf/archive links keep resolving
 * after the article leaves the latest batch. Migration 017 adds a GIN index
 * for this query; it works without the index at current batch volumes.
 */
export async function findArticleAcrossBatches(id: string): Promise<{
  article: ArticleBatch['articles'][number];
  batchDate: string;
  index: number;
  total: number;
} | null> {
  const rows = await sql`
    SELECT batch_date, articles
    FROM article_batches
    WHERE articles @> ${JSON.stringify([{ id }])}::jsonb
    ORDER BY batch_date DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0] as { batch_date: string; articles: ArticleBatch['articles'] };
  const index = row.articles.findIndex((a) => a.id === id);
  if (index === -1) return null;
  return {
    article: row.articles[index],
    batchDate: row.batch_date,
    index,
    total: row.articles.length,
  };
}

/**
 * Patches a subset of article fields (rationale, explorationSlotType) back into a
 * stored batch without touching generatedAt or any other metadata.
 *
 * Takes a Map of articleId → partial Article fields to merge.
 * No-op if the batch doesn't exist.
 *
 * The UPDATE is guarded on the generated_at value seen at read time, so a
 * batch regenerated concurrently (e.g. by a refresh) is never clobbered with
 * the stale merged copy — the patch is simply dropped (it's best-effort and
 * regenerated batches recompute these fields on the next feed load).
 */
export async function patchBatchArticleFields(
  batchDate: string,
  patches: Map<string, Partial<import('../types/article').Article>>
): Promise<void> {
  if (patches.size === 0) return;

  const existing = await readBatch(batchDate);
  if (!existing) return;

  let changed = false;
  const updated = existing.articles.map((a) => {
    const patch = patches.get(a.id);
    if (!patch) return a;
    changed = true;
    return { ...a, ...patch };
  });

  if (!changed) return;

  await sql`
    UPDATE article_batches
    SET articles = ${JSON.stringify(updated)}::jsonb
    WHERE batch_date = ${batchDate}
      AND generated_at = ${existing.generatedAt}::timestamptz
  `;
}

/** Logs a pipeline message to the console (visible in Vercel function logs). */
export function appendLog(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}
