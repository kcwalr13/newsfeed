import Parser from 'rss-parser';
import type { Article, Source } from '../../types/article';
import { cleanBodyParagraphs } from '@/lib/utils/bodyClean';
import { decodeHtmlEntities } from '@/lib/utils/htmlEntities';
import { detectPaywall } from '@/lib/utils/paywall';

type PartialArticle = Omit<Article, 'id' | 'batchDate' | 'feedbackSlot'>;

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TangentBot/1.0)' },
  customFields: {
    item: [['content:encoded', 'contentEncoded']],
  },
});

/** Decodes numeric and named HTML entities (e.g. &#8217; → ', &amp; → &). */
const decodeEntities = decodeHtmlEntities;

/**
 * Converts RSS HTML body text (content:encoded) to plain text, preserving
 * paragraph structure. Block-level closing tags become newlines so the article
 * reader can split on '\n' to render individual paragraphs.
 */
function htmlToPlainText(html: string, title?: string): string {
  const text = decodeEntities(
    html
      // Block-level closing tags → paragraph break
      .replace(/<\/(?:p|li|blockquote|pre|div|section|article|h[1-6]|td|th)>/gi, '\n')
      // Self-closing br → paragraph break
      .replace(/<br\s*\/?>/gi, '\n')
      // Strip all remaining tags
      .replace(/<[^>]*>/g, '')
      // Collapse horizontal whitespace within each line
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      // Drop lines that are too short to be real content (nav fragments, etc.)
      .filter((line) => line.split(/\s+/).filter(Boolean).length >= 2)
      .join('\n')
      .trim()
  );
  // Strip share bars, repeated title/byline, and trailing related-post blocks
  return cleanBodyParagraphs(text.split('\n'), title).join('\n');
}

/**
 * Cleans a description/excerpt string:
 * - Strips RSS boilerplate like "The post X appeared first on Y."
 * - Strips trailing "Continue reading…" patterns
 * - Collapses whitespace
 */
function cleanDescription(text: string): string {
  return text
    // "The post {title} appeared first on {site}." — Nautilus, many WordPress sites
    .replace(/\s*The post .+? appeared first on .+?\.\s*$/i, '')
    // "Continue reading →" / "Read more…" / "[…]" / "(…)"
    .replace(/\s*(Continue reading|Read more|Read the rest)[^.]*[\.\u2026]?\s*$/i, '')
    .replace(/\s*\[[\u2026\.]+\]\s*$/, '')
    .replace(/\s*\([\u2026\.]+\)\s*$/, '')
    .trim();
}

/**
 * Fetches and parses a single RSS source.
 * Returns an array of partial Article objects ready for the validator.
 * On error, logs a warning and returns an empty array (does not throw).
 */
export async function fetchRssArticles(source: Source): Promise<PartialArticle[]> {
  if (!source.feedUrl) {
    console.warn(`[rssAdapter] Source "${source.slug}" has no feedUrl — skipping.`);
    return [];
  }

  try {
    const feed = await parser.parseURL(source.feedUrl);
    const now = new Date().toISOString();

    return feed.items.map((item): PartialArticle => {
      const anyItem = item as unknown as Record<string, unknown>;
      const contentEncoded = anyItem['contentEncoded'] as string | undefined;
      const bodyCandidate = contentEncoded || item.content;
      const rawBody = bodyCandidate && bodyCandidate.length > 200 ? bodyCandidate : undefined;
      const decodedTitle = decodeEntities((item.title ?? '').trim());
      const parsedBody = rawBody ? htmlToPlainText(rawBody, decodedTitle) : undefined;
      // Drop a paywall-flagged teaser so fetchMissingBodyText retries the full
      // page (R5-B1). A genuinely free-but-truncated excerpt carries no paywall
      // phrase, so it survives here and gets backfilled normally; only the full
      // page being paywalled too leads to exclusion in assembly.
      const bodyText = parsedBody && detectPaywall(parsedBody) ? undefined : parsedBody;
      const summary = anyItem['summary'] as string | undefined;
      const rawDescription = item.contentSnippet || summary;

      // Guard malformed pubDate: new Date(bad).toISOString() throws, which
      // would drop every article from this source, not just the bad item.
      const pubMs = item.pubDate ? new Date(item.pubDate).getTime() : NaN;

      return {
        title: decodedTitle,
        articleUrl: item.link ?? '',
        publishedAt: Number.isNaN(pubMs) ? now : new Date(pubMs).toISOString(),
        fetchedAt: now,
        sourceName: source.name,
        sourceUrl: source.url,
        ...(rawDescription ? { description: cleanDescription(decodeEntities(rawDescription)) } : {}),
        ...(item.enclosure?.url ? { imageUrl: item.enclosure.url } : {}),
        ...(bodyText ? { bodyText } : {}),
      };
    });
  } catch (err) {
    console.warn(`[rssAdapter] Failed to fetch "${source.feedUrl}":`, err);
    return [];
  }
}
