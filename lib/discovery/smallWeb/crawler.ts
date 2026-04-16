// Small Web crawl orchestrator: seeds sources, fetches feeds, and returns article candidates.

import type { BraveSearchResult } from '@/lib/discovery/braveSearch';
import { seedSourcesIfEmpty, getEligibleSources, upsertSource, markCrawled } from '@/lib/db/smallWeb';
import { SMALL_WEB_SEED_URLS } from './seeds';
import { parseBlogrollLinks, parseOpmlLinks, discoverFeedUrl } from './blogroll';
import { appendLog } from '@/lib/pipeline/storage';
import { DISCOVERY_MAX_AGE_HOURS, SMALL_WEB_MAX_NEW_SOURCES_PER_RUN } from '@/lib/config/feed';

// rss-parser does not ship ES module types compatible with strict TS;
// use require() to avoid type conflicts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Parser = require('rss-parser');

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

/**
 * Runs the Small Web crawl: seeds sources, fetches feeds, discovers new sources
 * via blogrolls, and returns article candidates in BraveSearchResult shape.
 */
export async function runSmallWebCrawl(): Promise<BraveSearchResult[]> {
  await seedSourcesIfEmpty(SMALL_WEB_SEED_URLS);

  const sources = await getEligibleSources();

  const stats = {
    attempted: 0,
    failed: 0,
    candidates: 0,
    newSources: 0,
  };

  const allCandidates: BraveSearchResult[] = [];
  let newSourcesAddedThisRun = 0;
  const cutoffMs = Date.now() - DISCOVERY_MAX_AGE_HOURS * 60 * 60 * 1000;

  for (const source of sources) {
    stats.attempted++;

    let feedUrl = source.feed_url;

    // If no feed URL is known, attempt discovery
    if (!feedUrl) {
      try {
        const discovered = await discoverFeedUrl(source.url);
        if (discovered) {
          feedUrl = discovered;
          await upsertSource(source.url, feedUrl, source.discovered_via);
        } else {
          await markCrawled(source.url, 0);
          continue;
        }
      } catch {
        await markCrawled(source.url, 0);
        continue;
      }
    }

    // Parse the feed
    let feed: { title?: string; items: {
      title?: string;
      link?: string;
      isoDate?: string;
      pubDate?: string;
      contentSnippet?: string;
      content?: string;
    }[] };
    try {
      const parser = new Parser();
      feed = await parser.parseURL(feedUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLog(`[small-web] FAIL ${source.url}: ${msg}`);
      await markCrawled(source.url, 0);
      stats.failed++;
      continue;
    }

    // Filter to items within DISCOVERY_MAX_AGE_HOURS
    const qualifyingItems: BraveSearchResult[] = [];
    for (const item of feed.items ?? []) {
      // Parse date
      let pubMs: number | null = null;
      if (item.isoDate) {
        const d = new Date(item.isoDate);
        if (!isNaN(d.getTime())) pubMs = d.getTime();
      } else if (item.pubDate) {
        const d = new Date(item.pubDate);
        if (!isNaN(d.getTime())) pubMs = d.getTime();
      }
      if (pubMs === null || pubMs < cutoffMs) continue;

      const title = item.title ?? '';
      const url = item.link ?? '';
      if (!title || !url) continue;

      const description = item.contentSnippet?.slice(0, 300)
        ?? item.content?.replace(/<[^>]*>/g, '').slice(0, 300)
        ?? '';
      if (!description) continue;

      const publishedAt = item.isoDate
        ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null);
      const domain = extractDomain(source.url);

      qualifyingItems.push({
        title,
        url,
        description,
        publishedAt,
        sourceName: feed.title ?? domain,
        sourceUrl: `https://${domain}`,
      });
    }

    await markCrawled(source.url, qualifyingItems.length);
    allCandidates.push(...qualifyingItems);
    stats.candidates += qualifyingItems.length;

    // Blogroll discovery
    if (newSourcesAddedThisRun < SMALL_WEB_MAX_NEW_SOURCES_PER_RUN) {
      try {
        const res = await fetch(source.url, {
          signal: AbortSignal.timeout(5000),
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscoveryBot/1.0)' },
        });
        if (res.ok) {
          const html = await res.text();
          const candidateUrls = parseBlogrollLinks(html, source.url);

          // Also check for OPML links in the HTML
          const opmlRe = /<a[^>]+href=["']([^"']*\.opml[^"']*)["'][^>]*>/gi;
          let om: RegExpExecArray | null;
          while ((om = opmlRe.exec(html)) !== null) {
            try {
              const opmlUrl = new URL(om[1], source.url).toString();
              const opmlRes = await fetch(opmlUrl, {
                signal: AbortSignal.timeout(5000),
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscoveryBot/1.0)' },
              });
              if (opmlRes.ok) {
                const opmlText = await opmlRes.text();
                const opmlUrls = parseOpmlLinks(opmlText);
                candidateUrls.push(...opmlUrls);
              }
            } catch {
              // ignore OPML fetch failures
            }
          }

          for (const candidateUrl of candidateUrls) {
            if (newSourcesAddedThisRun >= SMALL_WEB_MAX_NEW_SOURCES_PER_RUN) break;
            // Filter out OPML URLs (they end in .opml and aren't site homepages)
            if (candidateUrl.endsWith('.opml')) continue;

            try {
              const discoveredFeed = await discoverFeedUrl(candidateUrl);
              if (discoveredFeed) {
                await upsertSource(candidateUrl, discoveredFeed, 'blogroll');
                stats.newSources++;
                newSourcesAddedThisRun++;
              }
            } catch {
              // ignore individual discovery failures
            }
          }
        }
      } catch {
        // ignore blogroll fetch failures — non-blocking
      }
    }

    // 1-second throttle between sources
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  appendLog(
    `[small-web] Crawl complete: ${stats.attempted} attempted, ${stats.failed} failed, ` +
    `${stats.candidates} candidates yielded, ${stats.newSources} new sources discovered`
  );

  return allCandidates;
}
