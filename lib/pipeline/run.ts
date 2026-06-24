import crypto from 'crypto';
import { selectPlaceForBatch } from './places';
import {
  PIPELINE_WALL_CLOCK_BUDGET_MS,
  PIPELINE_POST_DISCOVERY_RESERVE_MS,
  PIPELINE_LLM_CONCURRENCY,
  MAX_LLM_EVALS_PER_RUN,
  INDEX_FUNNEL_BUDGET_MS,
} from '@/lib/config/feed';
import { runDiscovery } from '@/lib/discovery/run';
import { runIndexFunnel, type FunnelItem } from '@/lib/discovery/indexFunnel';
import { canonicalizeUrlForDedup, registrableDomain } from '@/lib/utils/url';
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
import { scoreAesthetic, AestheticScoringError } from '@/lib/discovery/aestheticScorer';
import { upsertArticleAestheticScore, getArticleAestheticScores } from '@/lib/db/aesthetics';
import { AESTHETIC_BODY_MIN_CHARS, AESTHETIC_BODY_MAX_CHARS } from '@/lib/config/aesthetic';
import { extractConcepts } from '@/lib/discovery/conceptExtractor';
import { extractBodyText } from '@/lib/discovery/bodyExtractor';
import type { Article, ArticleBatch } from '../types/article';

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

/** Homepage origin of a destination URL (the "source" for novelty/shown-domain
 *  tracking), falling back to the URL itself when unparseable. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * Maps a verified funnel candidate (R7-2) into a link-out Article: no bodyText /
 * readTime / in-app reader — the card links straight out (the `place` pattern,
 * generalized to the discovered `contentType`). `discoverySource` carries the
 * index provenance (@internal telemetry, stripped at the client layer); the
 * destination's own domain/site name is the displayed label. The card blurb is
 * the page description until the request-time curator-note generator (which
 * fences the text with wrapUntrusted) replaces it.
 */
function toLinkOutArticle(item: FunnelItem, batchDate: string, nowIso: string): Article {
  const sourceName = item.siteName?.trim() || registrableDomain(item.url);
  return {
    id: makeId(sourceName, item.url),
    title: item.title,
    description: item.description,
    sourceName,
    sourceUrl: originOf(item.url),
    articleUrl: item.url,
    publishedAt: nowIso,
    fetchedAt: nowIso,
    batchDate,
    feedbackSlot: null,
    contentType: item.contentType,
    // NOTE: never put `discoverySource` (the INDEX that surfaced this, e.g.
    // "Hacker News") into `media` — `media` is sent to the client, and the index
    // provenance must stay @internal (the unit is the find, not the source).
    // `media.platform` (the DESTINATION's platform: youtube/bandcamp/…) is set by
    // R7-4's per-type enrichment; R7-2 only carries thumbnail + popularity score.
    media:
      item.thumbnailUrl || item.score != null
        ? { thumbnailUrl: item.thumbnailUrl, score: item.score }
        : undefined,
    discoverySource: item.discoverySource,
    extractedConcepts: [], // link-out items skip concept extraction (no body)
  };
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
 * Runs the full discovery pipeline (R7-2e/R7-3): the digest supply is
 * agent-discovered ONE-OFF finds — the index-mining funnel's link-out gems
 * (primary) + the Brave discovery essay supply (display shows exactly
 * ARTICLES_PER_ISSUE) + the curated place — NOT an RSS feed aggregation
 * (data/sources.json is retired as supply). Enriches
 * the article-type pieces (body fetch / aesthetic scoring / concept extraction /
 * blind-spot probe), assembles, and writes the batch. Always writes a non-empty
 * batch; degrades to a shorter digest (or skips the write to keep the prior issue)
 * rather than failing.
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

    // R7-2e SUPPLY FLIP: data/sources.json is RETIRED as the digest supply. The
    // digest is no longer an aggregator of RSS feeds-of-items — it is built from
    // agent-discovered ONE-OFF finds: the index-mining funnel's link-out gems
    // (the primary supply, appended after the per-article loops below) + the
    // Brave discovery ESSAY stream (the article-type content, capped so gems
    // dominate). `sources.json` + its loader survive only as the discovery
    // novelty filter's "sources Kyle already knows" set (lib/discovery/novelty.ts),
    // never as content. Tangent is now a discovery agent, not a feed reader.
    //
    // Discovery dedups against an empty fixed-URL set (there is no fixed supply);
    // the funnel dedups against the assembled essays at its own call site below.
    const fixedArticleUrls = new Set<string>();

    // Wall-clock budget: the Brave essay stream only gets what's left after
    // reserving time for body fetch, scoring, concept extraction, the index
    // funnel, and the batch write. A slow/hung run must never prevent the write.
    let discoveryArticles: Article[] = [];
    const elapsedMs = Date.now() - runStartMs;
    const discoveryBudgetMs =
      PIPELINE_WALL_CLOCK_BUDGET_MS - PIPELINE_POST_DISCOVERY_RESERVE_MS - elapsedMs;

    if (discoveryBudgetMs <= 0) {
      appendLog(
        `[discovery] Skipped: wall-clock budget exhausted (${elapsedMs}ms elapsed). ` +
          `Continuing without the essay stream (funnel gems only).`
      );
    } else {
      appendLog(`[discovery] Starting discovery run (budget ${discoveryBudgetMs}ms)...`);
      try {
        // Internal deadline a touch before the outer race fires, so a slow run
        // returns the essays scored so far (≥1 for the exactly-1-essay rule)
        // instead of being hard-cut to [] (R7-3 review). 10s margin covers the
        // post-eval selection + mapping + return.
        const discoveryDeadlineMs = Date.now() + Math.max(0, discoveryBudgetMs - 10_000);
        const discoveryPromise = runDiscovery(
          fixedArticleUrls,
          options.userId ?? null,
          options.deviceId ?? null,
          discoveryDeadlineMs
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
              `Continuing without the essay stream (funnel gems only).`
          );
        } else {
          discoveryArticles = raced;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(`[discovery] Discovery run failed entirely: ${msg}. Continuing with funnel gems only.`);
        discoveryArticles = [];
      }
    }

    // R7-3 SUPPLY-KEEP: the Brave stream supplies the ARTICLE-type essays. Keep
    // ALL of them in the batch (no ≤N supply cap — the former R7-2e
    // MAX_ARTICLES_IN_ISSUE=3 cap is removed). The EXACTLY-ONE-ESSAY hard rule
    // (Kyle 2026-06-24) is enforced at the DISPLAY layer (ensureExactlyOneArticle
    // in resolveDisplayedFeed), which shows precisely one essay no matter how many
    // are in the batch — so capping the supply can no longer cause an essay-wall,
    // and only risked dropping the last good essay. Keeping every scored essay
    // here maximizes the chance ≥1 survives paywall/dedup ("the supply keeps ≥1
    // essay candidate so one can always be placed" — the 2026-06-24 live run
    // showed 0 essays) and gives the display a good one to anchor the issue with.
    // The candidate count is naturally bounded by DISCOVERY_ARTICLES_PER_DAY.
    let articles: Article[] = discoveryArticles.map((a) => ({
      ...a,
      batchDate: today,
      // Only set readTime if not already set by the discovery pipeline
      readTime: a.readTime ?? estimateReadTime(a.bodyText),
    }));

    appendLog(
      `[pipeline] Supply (R7-3): kept ${articles.length} discovered essay(s) ` +
        `(display shows exactly 1 via ensureExactlyOneArticle); funnel gems appended below`
    );

    // R7-2c: index-mining funnel — the agent-discovered one-off stream. Crawls
    // curated gem-indexes for their OUTBOUND links and rule-filters them (durable
    // novelty dedup · liveness/realness verify · type classify) into verified
    // link-out candidates. Computed HERE (before the per-article LLM loops) so it
    // has wall-clock budget, but the resulting items are link-out (no body / no
    // reader / no LLM enrichment), so they're appended AFTER those loops below —
    // bypassing body-fetch, aesthetic scoring, and concept extraction (like the
    // `place` item). ADDITIVE in R7-2c (runs alongside the fixed/Brave supply);
    // R7-2e flips the supply so these become the digest's primary content.
    // Best-effort: a funnel failure never blocks the batch write. Bounded by the
    // remaining wall-clock (it runs HTTP fetches before the per-article loops, so
    // it must leave the post-discovery reserve intact) and cut short by a race so
    // the batch always writes — a shorter digest of real gems beats a missed run.
    let funnelItems: FunnelItem[] = [];
    const funnelElapsedMs = Date.now() - runStartMs;
    const funnelBudgetMs = Math.min(
      INDEX_FUNNEL_BUDGET_MS,
      PIPELINE_WALL_CLOCK_BUDGET_MS - PIPELINE_POST_DISCOVERY_RESERVE_MS - funnelElapsedMs
    );
    if (funnelBudgetMs <= 0) {
      appendLog(
        `[pipeline] Index funnel skipped: wall-clock budget exhausted (${funnelElapsedMs}ms elapsed).`
      );
    } else {
      try {
        const existingCanonical = new Set(articles.map((a) => canonicalizeUrlForDedup(a.articleUrl)));
        // Give the funnel's R7-3 judge an internal deadline a touch before the
        // outer Promise.race fires, so it returns the gems it judged so far
        // instead of being hard-cut (graceful partial degradation). The 8s margin
        // leaves room for in-flight liveness fetches + the final assembly.
        const funnelDeadlineMs = Date.now() + Math.max(0, funnelBudgetMs - 8000);
        const funnelPromise = runIndexFunnel({
          excludeCanonical: existingCanonical,
          deadlineMs: funnelDeadlineMs,
        });
        funnelPromise.catch(() => {}); // absorb a late rejection if the race times out first
        let timer: ReturnType<typeof setTimeout> | undefined;
        const raced = await Promise.race([
          funnelPromise,
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), funnelBudgetMs);
          }),
        ]);
        if (timer) clearTimeout(timer);
        if (raced === null) {
          appendLog(`[pipeline] Index funnel cut short after ${funnelBudgetMs}ms budget.`);
        } else {
          funnelItems = raced;
          appendLog(`[pipeline] Index funnel yielded ${funnelItems.length} link-out candidate(s)`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(`[pipeline] Index funnel failed (non-blocking): ${msg}`);
        funnelItems = [];
      }
    }

    // Fetch full body text for articles that only have a short excerpt (or none).
    // Must run before aesthetic scoring so the scorer gets the full text.
    // Returns ids whose full page is paywalled/teaser-only (R5-B1).
    const paywalledIds = await fetchMissingBodyText(articles);

    // Exclude items whose full text isn't actually available — a paywalled
    // Substack/member post would otherwise render as a misleading stub. At this
    // point `articles` is only the kept discovered essays (the funnel gems +
    // place are appended below and never hit this path); the displayed issue is
    // backfilled by those link-out gems, so dropping a paywalled essay still never
    // starves the issue (and keeping the full essay supply leaves others when one
    // is dropped — the exactly-1-essay rule still finds an essay to place).
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
        // R7-1: a place is a whole-site link-out item — the `website` content
        // type. `format:'place'` (R5-D) still drives the existing display mix +
        // card; `contentType` is the parallel R7 item-type dimension.
        contentType: 'website',
        curatorNote: place.note,
        extractedConcepts: [],
      });
      appendLog(`[pipeline] PLACE injected: ${place.name} (${place.url})`);
    }

    // R7-2c: append the verified index-funnel link-out items. Like `place`, they
    // land AFTER the per-article LLM/fetch loops so they bypass body-fetch,
    // aesthetic scoring, and concept extraction (they have no body and link
    // straight out). The card variant + feedback row come in R7-2d; the durable
    // novelty memory records each only once it is actually DISPLAYED (the feed
    // route), so an undisplayed gem can resurface another day.
    if (funnelItems.length > 0) {
      const nowIso = new Date().toISOString();
      // Guard against an id/URL collision with anything already assembled.
      const existingIds = new Set(articles.map((a) => a.id));
      const existingCanonical = new Set(articles.map((a) => canonicalizeUrlForDedup(a.articleUrl)));
      let added = 0;
      for (const item of funnelItems) {
        const linkOut = toLinkOutArticle(item, today, nowIso);
        if (existingIds.has(linkOut.id) || existingCanonical.has(canonicalizeUrlForDedup(linkOut.articleUrl))) {
          continue;
        }
        existingIds.add(linkOut.id);
        existingCanonical.add(canonicalizeUrlForDedup(linkOut.articleUrl));
        articles.push(linkOut);
        added++;
      }
      appendLog(`[pipeline] Index funnel appended ${added} link-out item(s) to the batch`);
    }

    // R7-2e: never write an EMPTY batch. With the fixed-RSS floor retired, a
    // thin day (discovery cut short + funnel empty + no place this issue) can now
    // genuinely produce zero items. Writing an empty batch would SHADOW the prior
    // issue — the feed's `readBatch(today) ?? readLatestBatch()` only falls back
    // when today's batch is *absent*, so an empty-but-present one renders the
    // "Nothing yet" empty state instead of yesterday's still-good gems. Skip the
    // write so the reader keeps the last real issue (graceful degradation: a stale
    // good issue beats an empty one). The next run/cron retries.
    if (articles.length === 0) {
      appendLog(
        `[pipeline] Empty supply for ${today} (no gems, essays, or place) — skipping the write so ` +
          `the prior issue stays visible. Next run will retry.`
      );
      return { batchDate: today, count: 0, alreadyExists: false };
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
