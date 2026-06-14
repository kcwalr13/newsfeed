// Discovery-yield metadata for a batch (P3-A4). Derived from the per-article
// `discoveryTopic` marker that the pipeline already persists in the batch JSON
// (discovery articles carry a topic id; fixed-source articles don't), so no new
// column or migration is needed. Powers the feed API exposure and Workstream D.

import type { ArticleBatch } from '@/lib/types/article';
import { registrableDomain } from '@/lib/utils/url';

/** A discovered source: registrable domain + its human-readable name. */
export interface DiscoverySource {
  /** Registrable domain, e.g. "artwalkway.com". */
  domain: string;
  /** Human-readable source name, e.g. "Art Walkway" (falls back to the domain). */
  name: string;
}

export interface DiscoveryYield {
  /** Articles in this issue sourced from proactive discovery. */
  discoveryCount: number;
  /** Articles from the fixed source palette. */
  fixedCount: number;
  /** Unique discovered sources (domain + display name), sorted by name (R4-02). */
  discoverySources: DiscoverySource[];
}

/**
 * Computes the discovery vs fixed split and the set of discovered sources for a
 * batch's articles. A discovery article is any article carrying a
 * `discoveryTopic` (set by the discovery orchestrator; absent on fixed-source
 * articles). Safe to call on stored batches (discoveryTopic survives in the
 * JSONB — it is only stripped at the client response layer).
 *
 * Sources are deduped by registrable domain and carry the article's `sourceName`
 * so the UI can show "Art Walkway" instead of "artwalkway.com" (R4-02); the
 * domain is the fallback name when `sourceName` is missing.
 */
export function computeDiscoveryYield(articles: ArticleBatch['articles']): DiscoveryYield {
  const nameByDomain = new Map<string, string>();
  let discoveryCount = 0;
  for (const a of articles) {
    if (a.discoveryTopic) {
      discoveryCount++;
      if (a.sourceUrl) {
        const domain = registrableDomain(a.sourceUrl);
        // First sighting wins; upgrade a domain-only placeholder if a later
        // article for the same domain carries a real source name.
        const name = a.sourceName?.trim();
        if (!nameByDomain.has(domain) || (name && nameByDomain.get(domain) === domain)) {
          nameByDomain.set(domain, name || domain);
        }
      }
    }
  }
  const discoverySources: DiscoverySource[] = [...nameByDomain.entries()]
    .map(([domain, name]) => ({ domain, name }))
    .sort((x, y) => x.name.localeCompare(y.name));
  return {
    discoveryCount,
    fixedCount: articles.length - discoveryCount,
    discoverySources,
  };
}
