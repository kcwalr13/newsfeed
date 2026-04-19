import type { Article, Source } from '../../types/article';

type PartialArticle = Omit<Article, 'id' | 'batchDate' | 'feedbackSlot'>;

interface NewsApiArticle {
  title: string;
  url: string;
  publishedAt: string;
  source: { name: string };
  description?: string;
  urlToImage?: string;
}

interface NewsApiResponse {
  status: string;
  articles: NewsApiArticle[];
}

/**
 * Fetches top headlines from NewsAPI.org.
 * Returns an array of partial Article objects ready for the validator.
 * On error or missing API key, logs a warning and returns an empty array (does not throw).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function fetchNewsApiArticles(_source: Source): Promise<PartialArticle[]> {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
    console.warn('[newsApiAdapter] NEWSAPI_KEY is not set — skipping NewsAPI source.');
    return [];
  }

  try {
    const url = `https://newsapi.org/v2/top-headlines?language=en&pageSize=40&apiKey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[newsApiAdapter] NewsAPI returned HTTP ${res.status} — skipping.`);
      return [];
    }

    const data: NewsApiResponse = await res.json();
    const now = new Date().toISOString();

    return data.articles
      .filter((a) => a.title !== '[Removed]')
      .map((a): PartialArticle => {
        let sourceUrl = '';
        try {
          sourceUrl = new URL(a.url).origin;
        } catch {
          sourceUrl = '';
        }

        return {
          title: a.title,
          articleUrl: a.url,
          publishedAt: a.publishedAt,
          fetchedAt: now,
          sourceName: a.source.name,
          sourceUrl,
          ...(a.description ? { description: a.description } : {}),
          ...(a.urlToImage ? { imageUrl: a.urlToImage } : {}),
        };
      });
  } catch (err) {
    console.warn('[newsApiAdapter] Unexpected error:', err);
    return [];
  }
}
