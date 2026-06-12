import path from 'path';
import fs from 'fs';
import type { Source } from '../types/article';

export { ARTICLES_PER_DAY } from '@/lib/config/feed';

/** Absolute path to the sources configuration file. */
export const SOURCES_PATH: string = path.resolve(process.cwd(), 'data', 'sources.json');

/** Maximum number of articles any single source may contribute to one batch.
 *  Enforced after cross-source deduplication. Excess articles are discarded;
 *  the order returned by each adapter (newest-first) determines which are kept.
 */
export const MAX_ARTICLES_PER_SOURCE: number = process.env.MAX_ARTICLES_PER_SOURCE
  ? parseInt(process.env.MAX_ARTICLES_PER_SOURCE, 10)
  : 5;

/** Minimum number of distinct active sources that must each contribute at least
 *  one article to a batch. If fewer contribute, the batch is still written but
 *  a DIVERSITY WARNING is logged.
 */
export const MIN_SOURCES_PER_BATCH: number = process.env.MIN_SOURCES_PER_BATCH
  ? parseInt(process.env.MIN_SOURCES_PER_BATCH, 10)
  : 3;

/** Cooldown between manual refresh requests per authenticated user, in minutes. */
export const REFRESH_COOLDOWN_MINUTES: number = process.env.REFRESH_COOLDOWN_MINUTES
  ? parseInt(process.env.REFRESH_COOLDOWN_MINUTES, 10)
  : 15;

/** Reads data/sources.json and returns only sources where active === true. */
export function loadSources(): Source[] {
  const raw = fs.readFileSync(SOURCES_PATH, 'utf-8');
  const all: Source[] = JSON.parse(raw);
  return all.filter((s) => s.active === true);
}
