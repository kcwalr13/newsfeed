import crypto from 'crypto';
import {
  MAX_ARTICLES_PER_SOURCE,
  MAX_ARTICLES_PER_CATEGORY,
  MIN_SOURCES_PER_BATCH,
  loadSources,
} from './config';
import { categoryForArticle } from './sourceCategory';
import { selectPlaceForBatch } from './places';
import {
  ARTICLES_PER_DAY,
  PIPELINE_WALL_CLOCK_BUDGET_MS,
  PIPELINE_POST_DISCOVERY_RESERVE_MS,
  PIPELINE_LLM_CONCURRENCY,
  MAX_LLM_EVALS_PER_RUN,
} from '@/lib/config/feed';
import { runDiscovery } from '@/lib/discovery/run';
import { canonicalizeUrlForDedup } from '@/lib/utils/url';
import { forEachWithConcurrency } from '@/lib/utils/concurrency';
import { writeBatch, readBatch, readLatestBatchBefore, appendLog } from './storage';
import {
  identifyBlindSpotClusters,
  selectProbeArticle,
  processPriorDayProbeIgnores,
} from './blindSpotProber';
import { getEligibleClusters, upsertCluster } from '@/lib/db/blindSpots';
import { getAllConceptLabels, getAllConceptEdges } from '@/lib/db/concepts';
import {
  getFeedbackForUser,
  getFeedbackForDevice,
  getMostRecentFeedbackIdentity,
} from '@/lib/db/feedback';
import {
  classifyConceptDistance,
  computeRawSurprise,
  normalizeQualityWeight,
  computeSerendipityScore,
} from './serendipityScorer';
import { fetchRssArticles } from './adapters/rssAdapter';
import { fetchNewsApiArticles } from './adapters/newsApiAdapter';
import { validateAndTrim } from './validator';
import { classifyLowValuePost } from '@/lib/discovery/qualityGate';
import { scoreAesthetic, AestheticScoringError } from '@/lib/discovery/aestheticScorer';
import { upsertArticleAestheticScore, getArticleAestheticScores } from '@/lib/db/aesthetics';
import { AESTHETIC_BODY_MIN_CHARS, AESTHETIC_BODY_MAX_CHARS } from '@/lib/config/aesthetic';
import { extractConcepts } from '@/lib/discovery/conceptExtractor';
import { extractBodyText } from '@/lib/discovery/bodyExtractor';
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
  /** True when LLM enrichment failed for every article (batch written unranked). */
  degraded?: boolean;
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
 * Returns undefined when the text is absent or excerpt-length (below
 * AESTHETIC_BODY_MIN_CHARS) — a "1 min" estimate computed from an RSS
 * excerpt is misleading, and the UI hides the label when undefined.
 */
function estimateReadTime(text?: string): number | undefined {
  if (!text || text.trim().length < AESTHETIC_BODY_MIN_CHARS) return undefined;
  const wordCount = text.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(wordCount / 238));
}

/**
 * Fetches full body text for articles that don't already have it (or only have a short
 * excerpt below AESTHETIC_BODY_MIN_CHARS). Runs after article assembly so we only fetch
 * for articles that made the final batch, and before aesthetic scoring so the scorer
 * gets full text rather than falling back to title+description.
 *
 * Uses a concurrency of 3 to avoid hammering multiple sources simultaneously.
 * Failures are isolated per-article — a fetch failure never drops the article.
 * readTime is recalculated after a successful fetch.
 */
const BODY_FETCH_CONCURRENCY = 3;

async function fetchMissingBodyText(articles: Article[]): Promise<Set<string>> {
  // Article ids whose full page was confirmed paywalled/teaser-only (R5-B1).
  // The caller excludes these from the batch.
  const paywalledIds = new Set<string>();
  const missing = articles.filter(
    (a) => !a.bodyText || a.bodyText.trim().length < AESTHETIC_BODY_MIN_CHARS
  );
  if (missing.length === 0) return paywalledIds;

  appendLog(`[pipeline] Fetching body text for ${missing.length}/${articles.length} articles...`);
  let fetched = 0;
  let failed = 0;

  for (let i = 0; i < missing.length; i += BODY_FETCH_CONCURRENCY) {
    const chunk = missing.slice(i, i + BODY_FETCH_CONCURRENCY);
    await Promise.allSettled(
      chunk.map(async (article) => {
        try {
          const result = await extractBodyText(article.articleUrl);
          if (result.success) {
            article.bodyText = result.bodyText;
            article.readTime = estimateReadTime(result.bodyText);
            fetched++;
          } else {
            if (result.reason === 'paywalled') paywalledIds.add(article.id);
            appendLog(
              `[pipeline] [body] SKIP id=${article.id} reason=${result.reason}`
            );
            failed++;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          appendLog(`[pipeline] [body] ERROR id=${article.id} error=${msg}`);
          failed++;
        }
      })
    );
  }

  appendLog(
    `[pipeline] Body text fetch complete: fetched=${fetched} failed=${failed} total=${missing.length}`
  );
  return paywalledIds;
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
 * Reorders capped candidates so the front of the list — which becomes the fixed
 * portion of the batch after the trim — spans many sources and categories
 * rather than being dominated by the first few prolific feeds (P3-B3).
 *
 * Source-grouped input (`results.flat()`) meant `slice(0, fixedTarget)` took
 * ~MAX_ARTICLES_PER_SOURCE from each of only the first few sources. This instead
 * round-robins one article per source per pass (front-loading source variety,
 * keeping each source's newest-first order), and softly defers a category once
 * it reaches `perCategoryCap` in the diverse core, pushing the overflow to the
 * tail. Nothing is dropped — purely a reordering — so the downstream trim always
 * has the same candidates available even when few sources or categories yield.
 */
function diversifyForSelection(
  articles: PartialArticle[],
  perCategoryCap: number
): PartialArticle[] {
  // Group by source, preserving each source's newest-first order.
  const bySource = new Map<string, PartialArticle[]>();
  for (const a of articles) {
    const queue = bySource.get(a.sourceName);
    if (queue) queue.push(a);
    else bySource.set(a.sourceName, [a]);
  }
  const queues = [...bySource.values()];

  const core: PartialArticle[] = [];
  const deferred: PartialArticle[] = [];
  const categoryCount = new Map<string, number>();

  // Round-robin passes: one article per source per pass.
  let advanced = true;
  while (advanced) {
    advanced = false;
    for (const queue of queues) {
      const a = queue.shift();
      if (!a) continue;
      advanced = true;
      const cat = categoryForArticle(a) ?? 'uncategorized';
      const count = categoryCount.get(cat) ?? 0;
      if (count >= perCategoryCap) {
        deferred.push(a); // soft cap: overflow to the tail, only fills if needed
      } else {
        core.push(a);
        categoryCount.set(cat, count + 1);
      }
    }
  }
  return [...core, ...deferred];
}

/**
 * Scores every article aesthetically using Claude Haiku.
 * Runs after the combined article list is assembled, before writeBatch().
 * Failures are isolated per-article: an error for article N does not affect N+1.
 * A scoring failure never removes the article from the batch.
 */
/** Per-run LLM call budget (PIPE-M5) + wall-clock deadline (R6-5). */
interface LlmBudget {
  used: number;
  exhaustedLogged: boolean;
  /**
   * Absolute time (ms epoch) past which the per-article enrichment phase stops
   * issuing new LLM calls so the batch is still written before the platform
   * kills the function (R6-5). Under Gemini's ~15 RPM the shared limiter spaces
   * calls ~4s apart, so a full scoring + concept pass can exceed the wall-clock
   * budget; this guard caps it. Effectively never reached under Anthropic
   * (fast, effectively-unthrottled calls), so the Anthropic path is unchanged.
   */
  deadlineMs: number;
  deadlineLogged: boolean;
}

function tryConsumeLlm(budget: LlmBudget): boolean {
  if (Date.now() >= budget.deadlineMs) {
    if (!budget.deadlineLogged) {
      appendLog(
        `[pipeline] LLM wall-clock deadline reached — remaining articles skip ` +
          `enrichment this run (batch still writes; unscored items rank by source score)`
      );
      budget.deadlineLogged = true;
    }
    return false;
  }
  if (budget.used >= MAX_LLM_EVALS_PER_RUN) {
    if (!budget.exhaustedLogged) {
      appendLog(
        `[pipeline] LLM budget exhausted (${MAX_LLM_EVALS_PER_RUN} calls) — ` +
          `remaining articles skip enrichment this run`
      );
      budget.exhaustedLogged = true;
    }
    return false;
  }
  budget.used++;
  return true;
}

async function scoreArticlesAesthetic(
  articles: Article[],
  budget: LlmBudget
): Promise<{ scored: number; skipped: number; alreadyScored: number }> {
  const startMs = Date.now();
  let scored = 0;
  let skipped = 0;
  let alreadyScored = 0;

  // Skip articles that already have a score row — forceOverwrite refreshes
  // previously re-scored (and re-billed) every article for identical text.
  let existingScores: Map<string, unknown>;
  try {
    existingScores = await getArticleAestheticScores(articles.map((a) => a.id));
  } catch {
    existingScores = new Map();
  }

  await forEachWithConcurrency(articles, PIPELINE_LLM_CONCURRENCY, async (article) => {
    if (existingScores.has(article.id)) {
      alreadyScored++;
      return;
    }
    if (!tryConsumeLlm(budget)) {
      skipped++;
      return;
    }
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
  });

  const totalMs = Date.now() - startMs;
  appendLog(
    `[aesthetic] Run complete: scored=${scored} alreadyScored=${alreadyScored} skipped=${skipped} totalMs=${totalMs}`
  );
  return { scored, skipped, alreadyScored };
}

/**
 * Phase 4: blind-spot probe selection. Classifies today's article concepts
 * against the user's concept graph, identifies blind-spot clusters via the
 * LLM, and marks one article with probeInfo (in-memory, so it lands in the
 * batch JSON; the ranker and feedback route consume it from there). Also
 * processes ignores for probes shown in the most recent prior batch.
 * Never throws — failures are logged and the pipeline continues.
 */
async function runBlindSpotProbe(
  articles: Article[],
  userIdOpt: string | null,
  deviceIdOpt: string | null,
  today: string
): Promise<void> {
  try {
    // Resolve identity. Cron runs carry no session; fall back to the most
    // recently active feedback identity (single-user app).
    let userId = userIdOpt;
    let deviceId = deviceIdOpt;
    if (!deviceId) {
      const recent = await getMostRecentFeedbackIdentity();
      if (!recent) {
        appendLog('[blindspot] No feedback identity yet; skipping probe selection.');
        return;
      }
      userId = recent.userId;
      deviceId = recent.deviceId;
    }

    // Probes shown in the most recent prior batch with no like/dislike count
    // as ignored (two consecutive ignores suppress the cluster for 14 days).
    const priorBatch = await readLatestBatchBefore(today);
    if (priorBatch) {
      const fbRows = userId
        ? await getFeedbackForUser(userId)
        : await getFeedbackForDevice(deviceId);
      await processPriorDayProbeIgnores(userId, deviceId, priorBatch.articles, fbRows);
    }

    const [labels, edges, eligibleClusters] = await Promise.all([
      getAllConceptLabels(userId, deviceId),
      getAllConceptEdges(userId, deviceId),
      getEligibleClusters(userId, deviceId),
    ]);
    if (labels.size === 0) {
      appendLog('[blindspot] Concept graph empty; skipping probe selection.');
      return;
    }

    const unknownByArticle = new Map<string, string[]>();
    const serendipityScores = new Map<string, number>();
    for (const article of articles) {
      const classifications = classifyConceptDistance(
        article.extractedConcepts ?? [],
        labels,
        edges
      );
      unknownByArticle.set(
        article.id,
        classifications.filter((c) => c.distance === 'unknown').map((c) => c.label)
      );
      serendipityScores.set(
        article.id,
        computeSerendipityScore(
          computeRawSurprise(classifications),
          normalizeQualityWeight(article.llmScore)
        )
      );
    }

    const clusters = await identifyBlindSpotClusters(unknownByArticle, serendipityScores);
    if (clusters.length === 0) {
      appendLog('[blindspot] No blind-spot clusters identified this run.');
      return;
    }

    const selection = selectProbeArticle(clusters, eligibleClusters, serendipityScores, articles);
    if (selection) {
      await upsertCluster(userId, deviceId, selection.clusterLabel);
      appendLog(
        `[blindspot] Probe selected: cluster "${selection.clusterLabel}" → article ${selection.article.id}`
      );
    } else {
      appendLog('[blindspot] All candidate clusters suppressed; no probe today.');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`[blindspot] Probe selection failed (non-fatal): ${msg}`);
  }
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
  const runStartMs = Date.now();

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

    // Cross-source URL deduplication (first occurrence wins), canonicalized
    // so tracking params / trailing slashes can't smuggle in duplicates.
    const seenUrls = new Set<string>();
    const deduped = candidates.filter((a) => {
      if (!a.articleUrl) return false;
      const canonical = canonicalizeUrlForDedup(a.articleUrl);
      if (seenUrls.has(canonical)) return false;
      seenUrls.add(canonical);
      return true;
    });

    // Screen out housekeeping/announcement posts and pure-video items.
    // Fixed sources bypass the LLM eval, so this is their only content gate.
    const editorial = deduped.filter((a) => {
      const lowValue = classifyLowValuePost(a.title, a.articleUrl);
      if (lowValue) {
        appendLog(`[pipeline] FILTERED ${lowValue}: "${a.title.slice(0, 70)}" (${a.sourceName})`);
      }
      return !lowValue;
    });

    // Per-source article cap (applied after dedup, per PM requirement)
    const capped = applySourceCap(editorial, MAX_ARTICLES_PER_SOURCE);

    // Reorder so the fixed portion spans many sources/categories rather than
    // the first few prolific feeds (P3-B3). Round-robin by source + soft
    // per-category cap; purely a reordering (nothing dropped).
    const diversified = diversifyForSelection(capped, MAX_ARTICLES_PER_CATEGORY);

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
    // Fed the diversified order so the kept front spans many sources/categories.
    const validated = validateAndTrim(diversified, ARTICLES_PER_DAY);

    // Build URL set for discovery-vs-fixed deduplication (shared canonicalizer).
    const fixedArticleUrls = new Set(validated.map((a) => canonicalizeUrlForDedup(a.articleUrl)));

    // Wall-clock budget: discovery only gets what's left after reserving time
    // for body fetch, scoring, concept extraction, and the batch write. A slow
    // or hung discovery must never prevent the batch from being written.
    let discoveryArticles: Article[] = [];
    const elapsedMs = Date.now() - runStartMs;
    const discoveryBudgetMs =
      PIPELINE_WALL_CLOCK_BUDGET_MS - PIPELINE_POST_DISCOVERY_RESERVE_MS - elapsedMs;

    if (discoveryBudgetMs <= 0) {
      appendLog(
        `[discovery] Skipped: wall-clock budget exhausted (${elapsedMs}ms elapsed). ` +
          `Continuing with fixed-only batch.`
      );
    } else {
      appendLog(`[discovery] Starting discovery run (budget ${discoveryBudgetMs}ms)...`);
      try {
        const discoveryPromise = runDiscovery(
          fixedArticleUrls,
          options.userId ?? null,
          options.deviceId ?? null
        );
        // Absorb a rejection that lands after the timeout wins the race below,
        // so it can't surface as an unhandled rejection.
        discoveryPromise.catch(() => {});

        let timer: ReturnType<typeof setTimeout> | undefined;
        const raced = await Promise.race([
          discoveryPromise,
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), discoveryBudgetMs);
          }),
        ]);
        if (timer) clearTimeout(timer);

        if (raced === null) {
          appendLog(
            `[discovery] Cut short after ${discoveryBudgetMs}ms budget. ` +
              `Continuing with fixed-only batch.`
          );
        } else {
          discoveryArticles = raced;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(`[discovery] Discovery run failed entirely: ${msg}. Falling back to fixed-only batch.`);
        discoveryArticles = [];
      }
    }

    const discoveryCount = discoveryArticles.length;
    const fixedTarget = ARTICLES_PER_DAY - discoveryCount;
    const finalFixedCandidates = validated.slice(0, fixedTarget);

    let articles: Article[] = [
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

    // Fetch full body text for articles that only have a short excerpt (or none).
    // Must run before aesthetic scoring so the scorer gets the full text.
    // Returns ids whose full page is paywalled/teaser-only (R5-B1).
    const paywalledIds = await fetchMissingBodyText(articles);

    // Exclude items whose full text isn't actually available — a paywalled
    // Substack/member post would otherwise render as a misleading stub. The
    // batch holds ARTICLES_PER_DAY (20) but only ISSUE_DISPLAY_SIZE (7) show,
    // so dropping a few confirmed-paywalled items never starves the issue.
    if (paywalledIds.size > 0) {
      const before = articles.length;
      articles = articles.filter((a) => !paywalledIds.has(a.id));
      appendLog(
        `[pipeline] PAYWALL excluded ${before - articles.length} item(s) (full text unavailable); ` +
          `batch now ${articles.length}.`
      );
    }

    // Score all articles aesthetically before writing the batch.
    // One shared LLM budget covers scoring + concept extraction (PIPE-M5), plus a
    // wall-clock deadline so a slow (rate-limited) provider can't run the
    // enrichment phase past the budget and lose the batch write (R6-5 / DAT-H2).
    const llmBudget: LlmBudget = {
      used: 0,
      exhaustedLogged: false,
      deadlineMs: runStartMs + PIPELINE_WALL_CLOCK_BUDGET_MS,
      deadlineLogged: false,
    };
    const { scored, alreadyScored } = await scoreArticlesAesthetic(articles, llmBudget);

    // Phase 4: Extract concepts for all articles before writing the batch.
    // Bounded concurrency to respect Anthropic API rate limits.
    let conceptsExtracted = 0;
    await forEachWithConcurrency(articles, PIPELINE_LLM_CONCURRENCY, async (article) => {
      if (!tryConsumeLlm(llmBudget)) {
        article.extractedConcepts = [];
        return;
      }
      try {
        const text = article.bodyText?.trim()
          ? article.bodyText
          : `${article.title} ${article.description ?? ''}`;
        const concepts = await extractConcepts(text);
        article.extractedConcepts = concepts;
        conceptsExtracted++;
      } catch (err) {
        console.error(`[pipeline] concept extraction failed for ${article.id}:`, err);
        article.extractedConcepts = [];
      }
    });

    // Phase 4: blind-spot probe selection (wires lib/pipeline/blindSpotProber.ts;
    // sets probeInfo on at most one article before the batch is written).
    await runBlindSpotProbe(
      articles,
      options.userId ?? null,
      options.deviceId ?? null,
      today
    );

    // Total LLM failure must not masquerade as a healthy run: flag the batch
    // degraded (it is ranked by source score only) so the route can surface it.
    const degraded =
      articles.length > 0 && scored + alreadyScored === 0 && conceptsExtracted === 0;
    if (degraded) {
      console.error(
        `[pipeline] DEGRADED RUN: LLM enrichment failed for all ${articles.length} articles ` +
          `(aesthetic scored=0, concepts=0). Check ANTHROPIC_API_KEY / API status.`
      );
      appendLog(
        `[pipeline] DEGRADED RUN: writing unranked batch for ${today}; all LLM calls failed.`
      );
    }

    // Inject a "place to explore" item on a deterministic cadence (R5-D3): a
    // whole site to wander, not an article. Added here — after body fetch,
    // scoring, concepts, and the probe — so it skips every per-article LLM/fetch
    // loop (it has no body). It's surfaced into the displayed issue by
    // ensureFormatSpread and links straight out (never the in-app reader).
    const place = selectPlaceForBatch(today);
    if (place) {
      const nowIso = new Date().toISOString();
      articles.push({
        id: makeId(place.name, place.url),
        title: place.name,
        sourceName: place.name,
        sourceUrl: place.url,
        articleUrl: place.url,
        publishedAt: nowIso,
        fetchedAt: nowIso,
        batchDate: today,
        feedbackSlot: null,
        format: 'place',
        curatorNote: place.note,
        extractedConcepts: [],
      });
      appendLog(`[pipeline] PLACE injected: ${place.name} (${place.url})`);
    }

    const batch: ArticleBatch = {
      batchDate: today,
      generatedAt: new Date().toISOString(),
      articles,
      ...(degraded ? { degraded: true } : {}),
    };

    await writeBatch(batch, options.forceOverwrite ?? false);
    appendLog(`[pipeline] Run complete. batchDate=${today} count=${articles.length}`);

    return { batchDate: today, count: articles.length, alreadyExists: false, degraded };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendLog(`[pipeline] Run failed: ${message}`);
    throw err;
  }
}
