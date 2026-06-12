import type { Article } from '../types/article';

type PartialArticle = Omit<Article, 'id' | 'batchDate' | 'feedbackSlot'>;

/**
 * Validates and deduplicates a pool of article candidates, trimming to the given limit.
 * Rules applied in order:
 * 1. Discard articles with empty/falsy title.
 * 2. Discard articles with empty/falsy articleUrl.
 * 3. Discard articles whose URL is not http(s) — scraped feeds could otherwise
 *    inject javascript:/data: URLs that the UI renders as links (FE-L6).
 * 4. Deduplicate by articleUrl (first occurrence wins).
 * 5. Trim to limit items.
 */
export function validateAndTrim(
  candidates: PartialArticle[],
  limit: number
): PartialArticle[] {
  const seen = new Set<string>();
  const valid: PartialArticle[] = [];

  for (const article of candidates) {
    if (!article.title || article.title.trim() === '') continue;
    if (!article.articleUrl || article.articleUrl.trim() === '') continue;
    if (!/^https?:\/\//i.test(article.articleUrl.trim())) continue;
    if (seen.has(article.articleUrl)) continue;

    seen.add(article.articleUrl);
    valid.push(article);

    if (valid.length >= limit) break;
  }

  return valid;
}
