// Discovery-yield metadata for a batch (P3-A4). Derived from the per-article
// `discoveryTopic` marker that the pipeline already persists in the batch JSON
// (discovery articles carry a topic id; fixed-source articles don't), so no new
// column or migration is needed. Powers the feed API exposure and Workstream D.

import type { ArticleBatch } from '@/lib/types/article';
import { registrableDomain } from '@/lib/utils/url';

export interface DiscoveryYield {
  /** Articles in this issue sourced from proactive discovery. */
  discoveryCount: number;
  /** Articles from the fixed source palette. */
  fixedCount: number;
  /** Unique registrable domains of the discovery-sourced articles, sorted. */
  discoverySources: string[];
}

/**
 * Computes the discovery vs fixed split and the set of discovered source
 * domains for a batch's articles. A discovery article is any article carrying a
 * `discoveryTopic` (set by the discovery orchestrator; absent on fixed-source
 * articles). Safe to call on stored batches (discoveryTopic survives in the
 * JSONB — it is only stripped at the client response layer).
 */
export function computeDiscoveryYield(articles: ArticleBatch['articles']): DiscoveryYield {
  const discoveryDomains = new Set<string>();
  let discoveryCount = 0;
  for (const a of articles) {
    if (a.discoveryTopic) {
      discoveryCount++;
      if (a.sourceUrl) discoveryDomains.add(registrableDomain(a.sourceUrl));
    }
  }
  return {
    discoveryCount,
    fixedCount: articles.length - discoveryCount,
    discoverySources: [...discoveryDomains].sort(),
  };
}
