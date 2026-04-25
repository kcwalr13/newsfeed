import Parser from 'rss-parser';
import type { Article, Source } from '../../types/article';

type PartialArticle = Omit<Article, 'id' | 'batchDate' | 'feedbackSlot'>;

const parser = new Parser({
  customFields: {
    item: [['content:encoded', 'contentEncoded']],
  },
});

/** Decodes numeric and named HTML entities (e.g. &#8217; → ', &amp; → &). */
function decodeEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Strips HTML tags and decodes entities, collapsing whitespace. */
function htmlToPlainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
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
      const bodyText = rawBody ? htmlToPlainText(rawBody) : undefined;
      const summary = anyItem['summary'] as string | undefined;
      const rawDescription = item.contentSnippet || summary;

      return {
        title: decodeEntities((item.title ?? '').trim()),
        articleUrl: item.link ?? '',
        publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : now,
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
