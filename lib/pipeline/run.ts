import crypto from 'crypto';
import { MAX_ARTICLES_PER_SOURCE, MIN_SOURCES_PER_BATCH, loadSources } from './config';
import { ARTICLES_PER_DAY } from '@/lib/config/feed';
import { runDiscovery } from '@/lib/discovery/run';
import { writeBatch, readBatch, appendLog } from './storage';
import { fetchRssArticles } from './adapters/rssAdapter';
import { fetchNewsApiArticles } from './adapters/newsApiAdapter';
import { validateAndTrim } from './validator';
import { scoreAesthetic, AestheticScoringError } from '@/lib/discovery/aestheticScorer';
import { upsertArticleAestheticScore } from '@/lib/db/aesthetics';
import { AESTHETIC_BODY_MIN_CHARS, AESTHETIC_BODY_MAX_CHARS } from '@/lib/config/aesthetic';
import { extractConcepts } from '@/lib/discovery/conceptExtractor';
import type { Article, ArticleBatch, Source } from '../types/article';

export interface RunOptions {
  /** When true, overwrites an existing same-day batch. Default: false. */
  forceOverwrite?: boolean;
  /** When set, the discovery topic selection uses this user's topic weights. */
  userId?: string | null;
  /** When set, topic weight upserts use this device ID (required for correct upsert keying). */
  deviceId?: string | null;
}

export interface RunResult {
  batchDate: string;
  count: number;
  alreadyExists: boolean;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Estimates reading time in minutes from plain text.
 * Uses 238 WPM (average adult reading speed for non-fiction).
 * Minimum of 1 minute; falls back to 2 minutes if text is absent.
 */
function estimateReadTime(text?: string): number {
  if (!text || text.trim().length === 0) return 2;
  const wordCount = text.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(wordCount / 238));
}

function makeId(sourceName: string, articleUrl: string): string {
  const sourceSlug = slugify(sourceName);
  const hash = crypto.createHash('sha256').update(articleUrl).digest('hex').slice(0, 8);
  return `${sourceSlug}-${hash}`;
}

async function fetchFromSource(source: Source) {
  if (source.type === 'rss') return fetchRssArticles(source);
  if (source.type === 'newsapi') return fetchNewsApiArticles(source);
  return [];
}

type PartialArticle = Omit<Article, 'id' | 'batchDate' | 'feedbackSlot'>;

function applySourceCap(articles: PartialArticle[], cap: number): PartialArticle[] {
  const countBySource = new Map<string, number>();
  return articles.filter((a) => {
    const count = countBySource.get(a.sourceName) ?? 0;
    if (count >= cap) return false;
    countBySource.set(a.sourceName, count + 1);
    return true;
  });
}

/**
 * Scores every article aesthetically using Claude Haiku.
 * Runs after the combined article list is assembled, before writeBatch().
 * Failures are isolated per-article: an error for article N does not affect N+1.
 * A scoring failure never removes the article from the batch.
 */
async function scoreArticlesAesthetic(articles: Article[]): Promise<void> {
  const startMs = Date.now();
  let scored = 0;
  let skipped = 0;

  for (const article of articles) {
    // Prepare input text: prefer bodyText if long enough, else title + description
    let inputText: string;
    if (article.bodyText && article.bodyText.length >= AESTHETIC_BODY_MIN_CHARS) {
      inputText = article.bodyText.slice(0, AESTHETIC_BODY_MAX_CHARS);
    } else {
      inputText = [article.title, article.description].filter(Boolean).join('. ');
    }

    try {
      const scores = await scoreAesthetic(inputText);
      await upsertArticleAestheticScore(article.id, scores);
      scored++;
    } catch (err) {
      const msg = err instanceof AestheticScoringError
        ? err.message
        : err instanceof Error ? err.message : String(err);
      appendLog(
        `[aesthetic] SCORE_FAIL articleId=${article.id} url=${article.articleUrl} error=${msg}`
      );
      skipped++;
      // Do not write a null row — absent row = no score. Article is not dropped.
    }
  }

  const totalMs = Date.now() - startMs;
  appendLog(
    `[aesthetic] Run complete: scored=${scored} skipped=${skipped} totalMs=${totalMs}`
  );
}

/**
 * Runs the full content pipeline: fetches from all active sources, validates,
 * deduplicates, applies per-source cap, checks diversity, and writes the batch.
 *
 * @param options.forceOverwrite - If true, overwrites an existing same-day batch.
 *   Use for manual refresh. Default: false (scheduled pipeline behavior).
 */
export async function runPipeline(options: RunOptions = {}): Promise<RunResult> {
  const today = todayUTC();

  try {
    // Guard: skip if batch already exists (unless explicitly overwriting)
    if (!options.forceOverwrite && (await readBatch(today)) !== null) {
      return { batchDate: today, count: 0, alreadyExists: true };
    }

    const sources = loadSources();

    // Fetch from all sources with per-source failure isolation
    const settled = await Promise.allSettled(sources.map(fetchFromSource));
    const results: PartialArticle[][] = settled.map((outcome, i) => {
      if (outcome.status === 'rejected') {
        const reason =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
        appendLog(`[pipeline] Source "${sources[i].slug}" failed: ${reason}`);
        return [];
      }
      return outcome.value;
    });

    const candidates = results.flat();

    // Cross-source URL deduplication (first occurrence wins)
    const seenUrls = new Set<string>();
    const deduped = candidates.filter((a) => {
      if (!a.articleUrl || seenUrls.has(a.articleUrl)) return false;
      seenUrls.add(a.articleUrl);
      return true;
    });

    // Per-source article cap (applied after dedup, per PM requirement)
    const capped = applySourceCap(deduped, MAX_ARTICLES_PER_SOURCE);

    // Diversity check — log warning if below minimum (do not abort)
    const contributingSourceNames = new Set(capped.map((a) => a.sourceName));
    const contributingCount = contributingSourceNames.size;
    if (contributingCount < MIN_SOURCES_PER_BATCH) {
      const failedSources = sources
        .filter((s) => !contributingSourceNames.has(s.name))
        .map((s) => s.slug);
      appendLog(
        `[pipeline] DIVERSITY WARNING: Only ${contributingCount}/${MIN_SOURCES_PER_BATCH} ` +
          `required sources contributed. ` +
          `Contributing: [${[...contributingSourceNames].join(', ')}]. ` +
          `Failed/empty: [${failedSources.join(', ')}].`
      );
    }

    // Validate (titles/URLs) and trim to target batch size.
    // We keep up to ARTICLES_PER_DAY so that if discovery yields 0, fixed sources can fill all 20 slots.
    const validated = validateAndTrim(capped, ARTICLES_PER_DAY);

    // Build URL set for deduplication (canonical: origin + pathname).
    const fixedArticleUrls = new Set(
      validated.map((a) => {
        try { const u = new URL(a.articleUrl); return u.origin + u.pathname; }
        catch { return a.articleUrl; }
      })
    );

    appendLog('[discovery] Starting discovery run...');
    let discoveryArticles: Article[] = [];
    try {
      discoveryArticles = await runDiscovery(
        fixedArticleUrls,
        options.userId ?? null,
        options.deviceId ?? null
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLog(`[discovery] Discovery run failed entirely: ${msg}. Falling back to fixed-only batch.`);
      discoveryArticles = [];
    }

    const discoveryCount = discoveryArticles.length;
    const fixedTarget = ARTICLES_PER_DAY - discoveryCount;
    const finalFixedCandidates = validated.slice(0, fixedTarget);

    const articles: Article[] = [
      ...finalFixedCandidates.map((a) => ({
        ...a,
        id: makeId(a.sourceName, a.articleUrl),
        batchDate: today,
        feedbackSlot: null as null,
        readTime: estimateReadTime(a.bodyText),
      })),
      ...discoveryArticles.map((a) => ({
        ...a,
        batchDate: today,
        // Only set readTime if not already set by the discovery pipeline
        readTime: a.readTime ?? estimateReadTime(a.bodyText),
      })),
    ];

    appendLog(
      `[pipeline] Batch: ${finalFixedCandidates.length} fixed-source, ${discoveryCount} discovery`
    );

    // NEW: Score all articles aesthetically before writing the batch
    await scoreArticlesAesthetic(articles);

    // Phase 4: Extract concepts for all articles before writing the batch.
    // Sequential to respect Anthropic API rate limits (same reason as aesthetic scoring).
    for (const article of articles) {
      try {
        const text = article.bodyText?.trim()
          ? article.bodyText
          : `${article.title} ${article.description ?? ''}`;
        const concepts = await extractConcepts(text);
        article.extractedConcepts = concepts;
      } catch (err) {
        console.error(`[pipeline] concept extraction failed for ${article.id}:`, err);
        article.extractedConcepts = [];
      }
    }

    const batch: ArticleBatch = {
      batchDate: today,
      generatedAt: new Date().toISOString(),
      articles,
    };

    await writeBatch(batch, options.forceOverwrite ?? false);
    appendLog(`[pipeline] Run complete. batchDate=${today} count=${articles.length}`);

    return { batchDate: today, count: articles.length, alreadyExists: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendLog(`[pipeline] Run failed: ${message}`);
    throw err;
  }
}
