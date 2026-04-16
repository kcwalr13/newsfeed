// Database helper module for the small_web_sources table.
// This module is the only place in the codebase that issues SQL against this table.

import { sql } from '@/lib/db/client';
import type { SmallWebSource } from '@/lib/types/smallWeb';

/**
 * Inserts seed URLs into the source pool if they are not already present.
 * Idempotent: calling with the same URLs multiple times inserts only once.
 */
export async function seedSourcesIfEmpty(seeds: string[]): Promise<void> {
  for (const url of seeds) {
    await sql`
      INSERT INTO small_web_sources (url, discovered_via)
      VALUES (${url}, 'seed')
      ON CONFLICT (url) DO NOTHING
    `;
  }
}

/**
 * Returns sources that are past their cooldown and eligible for crawling.
 * Active sources are eligible after 7 days; deprioritized after 30 days.
 */
export async function getEligibleSources(): Promise<SmallWebSource[]> {
  const rows = await sql`
    SELECT * FROM small_web_sources
    WHERE
      (status = 'active' AND (last_crawled_at IS NULL OR last_crawled_at < NOW() - INTERVAL '7 days'))
      OR
      (status = 'deprioritized' AND (last_crawled_at IS NULL OR last_crawled_at < NOW() - INTERVAL '30 days'))
    ORDER BY last_crawled_at ASC NULLS FIRST
  `;
  return rows as SmallWebSource[];
}

/**
 * Inserts a new source if not already present; does nothing if URL already exists.
 */
export async function upsertSource(
  url: string,
  feedUrl: string | null,
  discoveredVia: 'seed' | 'blogroll'
): Promise<void> {
  await sql`
    INSERT INTO small_web_sources (url, feed_url, discovered_via)
    VALUES (${url}, ${feedUrl}, ${discoveredVia})
    ON CONFLICT (url) DO NOTHING
  `;
}

/**
 * Atomically updates crawl statistics after a crawl attempt.
 * Deprioritizes the source if it has 4+ consecutive zero-yield runs.
 */
export async function markCrawled(url: string, yieldedCount: number): Promise<void> {
  await sql`
    UPDATE small_web_sources SET
      last_crawled_at = NOW(),
      cooldown_until = NOW() + INTERVAL '7 days',
      yield_count = yield_count + ${yieldedCount},
      last_yielded_at = CASE WHEN ${yieldedCount} > 0 THEN NOW() ELSE last_yielded_at END,
      consecutive_zero_yields = CASE WHEN ${yieldedCount} > 0 THEN 0 ELSE consecutive_zero_yields + 1 END,
      status = CASE
        WHEN ${yieldedCount} = 0 AND (consecutive_zero_yields + 1) >= 4 THEN 'deprioritized'
        ELSE status
      END
    WHERE url = ${url}
  `;
}

/**
 * Returns the total count of sources in the pool.
 * Used in the crawler summary log.
 */
export async function getSourceCount(): Promise<number> {
  const rows = await sql`SELECT COUNT(*)::int AS count FROM small_web_sources`;
  return (rows[0] as { count: number }).count;
}
