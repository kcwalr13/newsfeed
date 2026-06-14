import fs from 'fs';
import { SOURCES_PATH } from './config';
import type { Source, SourceCategory } from '../types/article';

/**
 * Resolves the editorial category of an article from its source identity.
 *
 * Rather than persisting `category` onto every Article (which would require a
 * pipeline re-run to backfill existing batches), we resolve it on demand from
 * `data/sources.json`. This works uniformly for in-memory candidates, articles
 * read back from stored batches (metrics — P3-D1), and historical batches whose
 * source was later deactivated. Discovered (non-fixed) articles are not in the
 * sources list, so they correctly resolve to `undefined`.
 *
 * Keyed primarily on the source display name (stored verbatim as
 * `Article.sourceName`) and secondarily on the homepage host, so it is robust to
 * either field drifting.
 */

let cache: Map<string, SourceCategory> | null = null;

/** Normalizes a homepage URL to a bare host without protocol or leading "www.". */
function hostKey(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).host.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

function buildMap(): Map<string, SourceCategory> {
  const map = new Map<string, SourceCategory>();
  let all: Source[] = [];
  try {
    all = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf-8')) as Source[];
  } catch {
    return map; // No sources file → every lookup is undefined (non-fatal).
  }
  for (const s of all) {
    if (!s.category) continue;
    if (s.name) map.set(`name:${s.name.trim().toLowerCase()}`, s.category);
    if (s.slug) map.set(`slug:${s.slug.trim().toLowerCase()}`, s.category);
    const h = hostKey(s.url);
    if (h) map.set(`host:${h}`, s.category);
  }
  return map;
}

function getMap(): Map<string, SourceCategory> {
  if (cache === null) cache = buildMap();
  return cache;
}

/** Article fields needed to resolve a category. */
export interface Categorizable {
  sourceName?: string;
  sourceUrl?: string;
}

/**
 * Returns the editorial category for an article, or `undefined` for discovered
 * / unknown sources. Tries source name, then homepage host.
 */
export function categoryForArticle(article: Categorizable): SourceCategory | undefined {
  const map = getMap();
  const name = article.sourceName?.trim().toLowerCase();
  if (name) {
    const byName = map.get(`name:${name}`);
    if (byName) return byName;
  }
  const h = hostKey(article.sourceUrl);
  if (h) {
    const byHost = map.get(`host:${h}`);
    if (byHost) return byHost;
  }
  return undefined;
}

/** Test/diagnostic hook: clears the memoized lookup so the next call re-reads disk. */
export function resetSourceCategoryCache(): void {
  cache = null;
}
