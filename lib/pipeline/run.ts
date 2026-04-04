import crypto from 'crypto';
import { ARTICLES_PER_DAY, loadSources } from './config';
import { writeBatch, readBatch, appendLog } from './storage';
import { fetchRssArticles } from './adapters/rssAdapter';
import { fetchNewsApiArticles } from './adapters/newsApiAdapter';
import { validateAndTrim } from './validator';
import type { Article, ArticleBatch, Source } from '../types/article';

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

/**
 * Runs the full content pipeline: fetches from all active sources, validates,
 * deduplicates, and writes the daily batch to disk.
 */
export async function runPipeline(): Promise<RunResult> {
  const today = todayUTC();

  try {
    if (readBatch(today) !== null) {
      return { batchDate: today, count: 0, alreadyExists: true };
    }

    const sources = loadSources();
    const results = await Promise.all(sources.map(fetchFromSource));
    const candidates = results.flat();

    const validated = validateAndTrim(candidates, ARTICLES_PER_DAY);

    const articles: Article[] = validated.map((a) => ({
      ...a,
      id: makeId(a.sourceName, a.articleUrl),
      batchDate: today,
      feedbackSlot: null,
    }));

    const batch: ArticleBatch = {
      batchDate: today,
      generatedAt: new Date().toISOString(),
      articles,
    };

    writeBatch(batch);
    appendLog(`Pipeline run complete. batchDate=${today} count=${articles.length}`);

    return { batchDate: today, count: articles.length, alreadyExists: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendLog(`Pipeline run failed: ${message}`);
    throw err;
  }
}
