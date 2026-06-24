// Durable novelty/dedup memory for discovery (R7-2).
//
// A permanent, URL-granular record of every one-off the engine has surfaced, so
// a find never repeats and the digest stays fresh — beyond the batch-window-only
// novelty that lib/discovery/novelty.ts derives from recent issues.
//
// Backward-compatible by design: EVERY function swallows errors — including the
// `discovery_seen_urls` table not existing before migration 020 is applied — and
// degrades to "no durable memory" (i.e. today's batch-window-only behavior). So
// the code is safe to deploy before the migration is applied to Neon.

import { sql } from './client';
import { canonicalizeUrlForDedup } from '@/lib/utils/url';
import { noveltyKey } from '@/lib/discovery/novelty';
import { appendLog } from '@/lib/pipeline/storage';

export interface SeenUrlInput {
  /** The destination URL of a surfaced one-off item. */
  url: string;
  /** Optional provenance — which stream/index surfaced it (telemetry only). */
  discoverySource?: string | null;
}

/**
 * Loads the set of novelty keys (registrable domain, or full host for shared
 * blogging hosts) ever recorded as seen. Unioned into the discovery seen-set so
 * the novelty filter permanently drops already-surfaced domains. Empty Set on
 * any error (incl. the table not yet existing) — deploy-safe before migration 020.
 */
export async function loadSeenNoveltyKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const rows = await sql`SELECT DISTINCT novelty_key FROM discovery_seen_urls`;
    for (const r of rows as Array<{ novelty_key: string | null }>) {
      if (r.novelty_key) keys.add(r.novelty_key);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`[discovery] durable novelty-key load skipped (${msg})`);
  }
  return keys;
}

/**
 * Loads the set of canonical URLs ever recorded as seen (URL-granular dedup,
 * stronger than domain-level novelty — used by the index-miner funnel to drop
 * an exact-URL repeat even on a domain that's otherwise still novel). Empty Set
 * on any error — deploy-safe before migration 020.
 */
export async function loadSeenCanonicalUrls(): Promise<Set<string>> {
  const urls = new Set<string>();
  try {
    const rows = await sql`SELECT url_canonical FROM discovery_seen_urls`;
    for (const r of rows as Array<{ url_canonical: string }>) {
      if (r.url_canonical) urls.add(r.url_canonical);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`[discovery] durable seen-url load skipped (${msg})`);
  }
  return urls;
}

/**
 * Permanently records surfaced item URLs (canonicalized + novelty-keyed) so a
 * find is never resurfaced. First-seen wins (`ON CONFLICT DO NOTHING`). Dedups
 * input by canonical URL in JS so the SQL payload is clean. Returns the number
 * of distinct URLs sent. Swallows all errors (incl. missing table) — recording
 * is best-effort and must never break a run.
 */
export async function recordSeenUrls(items: SeenUrlInput[]): Promise<number> {
  if (items.length === 0) return 0;

  const byCanonical = new Map<string, { key: string; source: string | null }>();
  for (const it of items) {
    if (!it.url) continue;
    const canonical = canonicalizeUrlForDedup(it.url);
    if (!canonical || byCanonical.has(canonical)) continue;
    byCanonical.set(canonical, {
      key: noveltyKey(it.url),
      source: it.discoverySource ?? null,
    });
  }
  if (byCanonical.size === 0) return 0;

  const urls = [...byCanonical.keys()];
  const keys = urls.map((u) => byCanonical.get(u)!.key);
  const sources = urls.map((u) => byCanonical.get(u)!.source);

  try {
    // Single round-trip bulk upsert via UNNEST of parallel arrays.
    await sql`
      INSERT INTO discovery_seen_urls (url_canonical, novelty_key, discovery_source)
      SELECT * FROM UNNEST(${urls}::text[], ${keys}::text[], ${sources}::text[])
      ON CONFLICT (url_canonical) DO NOTHING
    `;
    return byCanonical.size;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`[discovery] durable seen-url record skipped (${msg})`);
    return 0;
  }
}
