// Source-novelty support for discovery (P3-A3): the set of domains the user
// already knows (fixed sources) or has seen recently (last K issues), so the
// discovery layer can drop non-novel candidates before the expensive eval.

import fs from 'fs';
import { sql } from '@/lib/db/client';
import { registrableDomain } from '@/lib/utils/url';
import { SOURCES_PATH } from '@/lib/pipeline/config';
import { appendLog } from '@/lib/pipeline/storage';
import type { Source } from '@/lib/types/article';

/** Registrable domains of every fixed source (active or not) in data/sources.json. */
function fixedSourceDomains(): Set<string> {
  const set = new Set<string>();
  try {
    const all = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf-8')) as Source[];
    for (const s of all) {
      if (s.url) set.add(registrableDomain(s.url));
      // Feed URLs often sit on a sibling host (api.quantamagazine.org) — fold it
      // in so a Brave hit on the feed host still counts as a known source.
      if (s.feedUrl) set.add(registrableDomain(s.feedUrl));
    }
  } catch {
    // No sources file → fixed set is empty (recent-issue domains still apply).
  }
  return set;
}

/**
 * Builds the set of registrable domains that are NOT novel for the user:
 * every fixed source, plus every source domain that appeared in any of the last
 * `recentIssueCount` issues. Computed on the fly from `article_batches` (no new
 * table — P3-A3) via a lean SQL projection that pulls only the source/article
 * URL strings, never bodyText. Degrades to the fixed-source set on any DB error.
 */
export async function loadSeenSourceDomains(recentIssueCount: number): Promise<Set<string>> {
  const seen = fixedSourceDomains();
  try {
    const rows = await sql`
      SELECT DISTINCT elem->>'sourceUrl' AS source_url, elem->>'articleUrl' AS article_url
      FROM (
        SELECT articles
        FROM article_batches
        ORDER BY batch_date DESC
        LIMIT ${recentIssueCount}
      ) recent
      CROSS JOIN LATERAL jsonb_array_elements(recent.articles) AS elem
    `;
    for (const r of rows as Array<{ source_url: string | null; article_url: string | null }>) {
      const u = r.source_url || r.article_url;
      if (u) seen.add(registrableDomain(u));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`[discovery] seen-domain load failed (using fixed sources only): ${msg}`);
  }
  return seen;
}
