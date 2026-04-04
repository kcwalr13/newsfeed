import Parser from 'rss-parser';
import type { Article, Source } from '../../types/article';

type PartialArticle = Omit<Article, 'id' | 'batchDate' | 'feedbackSlot'>;

const parser = new Parser({
  customFields: {
    item: [['content:encoded', 'contentEncoded']],
  },
});

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
      const bodyText =
        bodyCandidate && bodyCandidate.length > 200 ? bodyCandidate : undefined;
      const summary = anyItem['summary'] as string | undefined;

      return {
        title: (item.title ?? '').trim(),
        articleUrl: item.link ?? '',
        publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : now,
        fetchedAt: now,
        sourceName: source.name,
        sourceUrl: source.url,
        ...(item.contentSnippet || summary
          ? { description: item.contentSnippet || summary }
          : {}),
        ...(item.enclosure?.url ? { imageUrl: item.enclosure.url } : {}),
        ...(bodyText ? { bodyText } : {}),
      };
    });
  } catch (err) {
    console.warn(`[rssAdapter] Failed to fetch "${source.feedUrl}":`, err);
    return [];
  }
}
