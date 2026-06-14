// Discovery orchestrator: topic selection, Brave Search, quality gate, dedup, quota enforcement.

import crypto from 'crypto';
import type { Article } from '@/lib/types/article';
import { DISCOVERY_TOPICS_PER_RUN, DISCOVERY_CANDIDATES_PER_TOPIC, DISCOVERY_ARTICLES_PER_DAY, TOPIC_WEIGHT_STEP, TOPIC_WEIGHT_FLOOR, TOPIC_WEIGHT_CEILING, LLM_EVAL_THRESHOLD, LLM_EVAL_FLOOR, DISCOVERY_LLM_CONCURRENCY } from '@/lib/config/feed';
import { forEachWithConcurrency } from '@/lib/utils/concurrency';
import { DISCOVERY_TOPICS } from './topics';
import type { DiscoveryTopic } from './topics';
import { searchBrave } from './braveSearch';
import type { BraveSearchResult } from './braveSearch';
import { evaluateCandidate } from './qualityGate';
import { extractBodyText } from './bodyExtractor';
import type { ExtractionFailureReason } from './bodyExtractor';
import { evaluateWithLLM } from './llmEvaluator';
import type { LLMScores } from './llmEvaluator';
import { loadQueryBanks, loadRotationState, saveRotationState, selectNextTwoQueries } from './queryBank';
import { runSmallWebCrawl } from './smallWeb/crawler';
import { appendLog, readLatestBatch } from '@/lib/pipeline/storage';
import { canonicalizeUrlForDedup } from '@/lib/utils/url';
import {
  getTopicWeightsForUser,
  getAllTopicWeightsAveraged,
  upsertTopicWeight,
  setLastProcessedAt,
} from '@/lib/db/discovery';
import type { TopicWeightRow } from '@/lib/db/discovery';
import { getFeedbackForUser } from '@/lib/db/feedback';

interface EvalStats {
  candidatesAttempted: number;
  extractionFailed: Partial<Record<ExtractionFailureReason, number>>;
  llmFailed: Partial<Record<'parse_error' | 'api_error', number>>;
  llmThresholdFailed: number;
  llmCallCount: number;
  llmPassCount: number;
  llmWallTimeMs: number;
  qualified: number;
}

interface ScoredCandidate {
  result: BraveSearchResult;
  topic: DiscoveryTopic;
  llmScores: LLMScores;
  bodyText: string;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function makeId(sourceName: string, articleUrl: string): string {
  const slug = slugify(sourceName);
  const hash = crypto.createHash('sha256').update(articleUrl).digest('hex').slice(0, 8);
  return `${slug}-${hash}`;
}

// Shared canonicalizer (PIPE-M6) — must match the fixed-source side so the
// discovery-vs-fixed dedup compares like with like.
const canonicalizeUrl = canonicalizeUrlForDedup;

function selectTopics(
  topics: DiscoveryTopic[],
  count: number,
  weights: Map<string, number>
): DiscoveryTopic[] {
  const pool = topics.map((t) => ({ topic: t, weight: weights.get(t.id) ?? t.defaultWeight }));
  const selected: DiscoveryTopic[] = [];

  for (let i = 0; i < count && pool.length > 0; i++) {
    const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0);
    const rand = Math.random() * totalWeight;
    let cumulative = 0;
    let chosenIdx = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      cumulative += pool[j].weight;
      if (rand < cumulative) { chosenIdx = j; break; }
    }
    selected.push(pool[chosenIdx].topic);
    pool.splice(chosenIdx, 1);  // remove from pool (no replacement)
  }
  return selected;
}

/**
 * Runs the proactive content discovery pipeline:
 * selects topics, searches Brave (2 queries per topic), filters through quality gate
 * (Gates 1-3, body extraction, LLM evaluation), deduplicates, enforces quota,
 * and returns Article[] ready to merge with the fixed pipeline.
 *
 * @param fixedArticleUrls - Canonical URLs of articles already in the fixed pipeline.
 * @param userId - Optional user ID for user-specific topic weights.
 * @param deviceId - Optional device ID for anonymous topic weights.
 */
export async function runDiscovery(
  fixedArticleUrls: Set<string>,
  userId?: string | null,
  deviceId?: string | null
): Promise<Article[]> {
  appendLog(`[discovery] Starting discovery run. Topics available: ${DISCOVERY_TOPICS.length}`);

  // Step 0: Load topic weights and process recent feedback
  const topicWeightMap = new Map<string, number>();

  try {
    let weightRows: TopicWeightRow[];
    if (userId) {
      weightRows = await getTopicWeightsForUser(userId);
    } else {
      // Scheduled run: use averaged weights across all users
      const averaged = await getAllTopicWeightsAveraged();
      for (const topic of DISCOVERY_TOPICS) {
        topicWeightMap.set(topic.id, averaged.get(topic.id) ?? topic.defaultWeight);
      }
      weightRows = [];  // averaged weights already in map
    }
    for (const row of weightRows) {
      topicWeightMap.set(row.topic_id, row.weight);
    }

    // Fill in any missing topics with their defaultWeight
    for (const topic of DISCOVERY_TOPICS) {
      if (!topicWeightMap.has(topic.id)) {
        topicWeightMap.set(topic.id, topic.defaultWeight);
      }
    }

    // Process feedback for weight updates (only for user-specific runs)
    if (userId) {
      // Determine the earliest last_processed_at across all loaded weight rows.
      // If there are no rows, or any row has null (never processed), fall back to null (process all).
      const cutoffIso: string | null =
        weightRows.length > 0 && weightRows.every((r) => r.last_processed_at !== null)
          ? weightRows.reduce((earliest, r) =>
              r.last_processed_at! < earliest ? r.last_processed_at! : earliest,
              weightRows[0].last_processed_at!
            )
          : null;

      const allFeedbackRows = await getFeedbackForUser(userId);
      const feedbackRows = cutoffIso === null
        ? allFeedbackRows
        : allFeedbackRows.filter((r) => r.updated_at > cutoffIso);

      const latestBatch = await readLatestBatch();
      if (latestBatch) {
        const articleTopicMap = new Map<string, string>();  // article_id -> topic_id
        for (const article of latestBatch.articles) {
          if (article.discoveryTopic) {
            articleTopicMap.set(article.id, article.discoveryTopic);
          }
        }
        for (const row of feedbackRows) {
          const topicId = articleTopicMap.get(row.article_id);
          if (!topicId || topicId === 'uncategorized' || topicId === 'small-web') continue;
          const current = topicWeightMap.get(topicId) ?? 1.0;
          const delta = row.value === 'like' ? TOPIC_WEIGHT_STEP : -TOPIC_WEIGHT_STEP;
          const updated = Math.max(TOPIC_WEIGHT_FLOOR, Math.min(TOPIC_WEIGHT_CEILING, current + delta));
          topicWeightMap.set(topicId, updated);
          await upsertTopicWeight(deviceId ?? userId ?? 'unknown', topicId, updated, userId);
        }
      }

      if (feedbackRows.length > 0) {
        await setLastProcessedAt(userId, deviceId ?? userId ?? 'unknown');
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`[discovery] Topic weight load/update failed, using defaults: ${msg}`);
    for (const topic of DISCOVERY_TOPICS) {
      if (!topicWeightMap.has(topic.id)) {
        topicWeightMap.set(topic.id, topic.defaultWeight);
      }
    }
  }

  const topicsToProbe = selectTopics(DISCOVERY_TOPICS, DISCOVERY_TOPICS_PER_RUN, topicWeightMap);

  // Load query banks and rotation state (Group D)
  const queryBanks = loadQueryBanks();
  const rotationState = await loadRotationState();
  const updatedRotationState = new Map<string, number>(rotationState);

  // Issue two queries per selected topic, serialized ~1.1s apart so the
  // Brave free tier (1 req/s) never sees a concurrent burst.
  const BRAVE_QUERY_SPACING_MS = 1100;
  const searchResults: { topic: DiscoveryTopic; results: BraveSearchResult[] }[] = [];
  const plannedQueries: { topic: DiscoveryTopic; query: string }[] = [];
  for (const topic of topicsToProbe) {
    const queries = queryBanks.get(topic.id) ?? topic.searchQueries;
    const cursor = rotationState.get(topic.id) ?? -1;
    const { selected, newCursor } = selectNextTwoQueries(queries, cursor);
    updatedRotationState.set(topic.id, newCursor);
    for (const query of selected) {
      plannedQueries.push({ topic, query });
    }
  }
  for (let i = 0; i < plannedQueries.length; i++) {
    const { topic, query } = plannedQueries[i];
    const results = await searchBrave(query, DISCOVERY_CANDIDATES_PER_TOPIC);
    searchResults.push({ topic, results });
    if (i < plannedQueries.length - 1) {
      await new Promise((r) => setTimeout(r, BRAVE_QUERY_SPACING_MS));
    }
  }

  // Group A: Small Web crawl
  let smallWebCandidates: BraveSearchResult[] = [];
  try {
    smallWebCandidates = await runSmallWebCrawl();
    appendLog(`[discovery] Small Web crawl yielded ${smallWebCandidates.length} candidates`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(`[discovery] Small Web crawl failed (non-blocking): ${msg}`);
  }

  // Flatten all candidates into (topic, result) pairs for evaluation.
  // Small Web candidates use a synthetic 'small-web' topic.
  const syntheticSmallWebTopic: DiscoveryTopic = {
    id: 'small-web',
    label: 'Small Web',
    searchQueries: [],
    defaultWeight: 1.0,
  };

  type CandidatePair = { topic: DiscoveryTopic; result: BraveSearchResult };
  const allCandidatePairs: CandidatePair[] = [];

  for (const { topic, results } of searchResults) {
    for (const result of results) {
      allCandidatePairs.push({ topic, result });
    }
  }

  for (const result of smallWebCandidates) {
    allCandidatePairs.push({ topic: syntheticSmallWebTopic, result });
  }

  // Quality gate pass + within-discovery dedup + body extraction + LLM evaluation
  const seenCanonical = new Set<string>();
  const qualified: ScoredCandidate[] = [];

  const stats: EvalStats = {
    candidatesAttempted: 0,
    extractionFailed: {},
    llmFailed: {},
    llmThresholdFailed: 0,
    llmCallCount: 0,
    llmPassCount: 0,
    llmWallTimeMs: 0,
    qualified: 0,
  };

  // Phase 1 (sequential, cheap): synchronous gates + dedup. Resolving dedup
  // up-front — adding each canonical URL to seenCanonical on first sight, before
  // any I/O — keeps it deterministic and race-free so the expensive body+LLM
  // work below can run concurrently (R2-18). (Previously a URL was only marked
  // seen after a successful score, so a duplicate could be re-fetched if the
  // first attempt failed; deduping here also avoids that wasted work.)
  const toProcess: CandidatePair[] = [];
  for (const pair of allCandidatePairs) {
    const { topic, result } = pair;
    const gateResult = evaluateCandidate(result);
    if (!gateResult.pass) {
      appendLog(`[discovery] DISCARD [${topic.id}] ${result.url} -- ${gateResult.reason}`);
      continue;
    }
    const canonical = canonicalizeUrl(result.url);
    if (fixedArticleUrls.has(canonical)) {
      appendLog(`[discovery] DISCARD [${topic.id}] ${result.url} -- DUPLICATE_FIXED`);
      continue;
    }
    if (seenCanonical.has(canonical)) {
      appendLog(`[discovery] DISCARD [${topic.id}] ${result.url} -- DUPLICATE_DISCOVERY`);
      continue;
    }
    seenCanonical.add(canonical);
    toProcess.push(pair);
  }

  // Phase 2 (bounded concurrency): body extraction + LLM evaluation. JS is
  // single-threaded, so the shared `stats` increments and `qualified.push` are
  // atomic between awaits; `qualified` is sorted by composite below, so its
  // completion-order here doesn't matter. (`llmWallTimeMs` now sums per-call
  // durations across overlapping calls — a cumulative figure, not wall time.)
  await forEachWithConcurrency(toProcess, DISCOVERY_LLM_CONCURRENCY, async ({ topic, result }) => {
    stats.candidatesAttempted++;

    // Group B: body text extraction
    const extractResult = await extractBodyText(result.url);
    if (!extractResult.success) {
      appendLog(`[discovery] DISCARD [${topic.id}] ${result.url} -- extraction:${extractResult.reason}`);
      stats.extractionFailed[extractResult.reason] = (stats.extractionFailed[extractResult.reason] ?? 0) + 1;
      return;
    }

    // Group C: LLM evaluation
    const llmStart = Date.now();
    stats.llmCallCount++;
    const llmResult = await evaluateWithLLM(result.title, result.description ?? '', extractResult.bodyText);
    stats.llmWallTimeMs += Date.now() - llmStart;

    if (!llmResult.success) {
      appendLog(`[discovery] DISCARD [${topic.id}] ${result.url} -- llm:${llmResult.reason}`);
      stats.llmFailed[llmResult.reason] = (stats.llmFailed[llmResult.reason] ?? 0) + 1;
      return;
    }

    if (llmResult.scores.composite < LLM_EVAL_THRESHOLD) {
      appendLog(
        `[discovery] BELOW_THRESHOLD [${topic.id}] ${result.url} ` +
        `(composite:${llmResult.scores.composite}, ` +
        `sub:${llmResult.scores.intellectual_substance} ` +
        `orig:${llmResult.scores.originality} ` +
        `cross:${llmResult.scores.cross_disciplinary_appeal} ` +
        `ever:${llmResult.scores.evergreen_durability} ` +
        `write:${llmResult.scores.writing_quality})`
      );
      stats.llmThresholdFailed++;
    } else {
      stats.llmPassCount++;
    }

    // Keep every successfully scored candidate; the adaptive threshold below
    // decides what actually ships.
    qualified.push({ result, topic, llmScores: llmResult.scores, bodyText: extractResult.bodyText });
  });

  // Adaptive threshold: prefer candidates at/above LLM_EVAL_THRESHOLD; if they
  // don't fill the quota, top up by composite score from those at/above
  // LLM_EVAL_FLOOR. A hard threshold previously rejected 100% of candidates on
  // some runs, silently zeroing discovery.
  qualified.sort((a, b) => b.llmScores.composite - a.llmScores.composite);
  const aboveThreshold = qualified.filter((c) => c.llmScores.composite >= LLM_EVAL_THRESHOLD);
  if (qualified.length > 0 && aboveThreshold.length === 0) {
    const msg =
      `[discovery] 0% LLM pass rate: 0/${qualified.length} candidates met ` +
      `LLM_EVAL_THRESHOLD=${LLM_EVAL_THRESHOLD}. Falling back to top-N >= ${LLM_EVAL_FLOOR}.`;
    console.error(msg);
    appendLog(msg);
  }
  const pool = aboveThreshold.length >= DISCOVERY_ARTICLES_PER_DAY
    ? aboveThreshold
    : qualified.filter((c) => c.llmScores.composite >= LLM_EVAL_FLOOR);
  const top = pool.slice(0, DISCOVERY_ARTICLES_PER_DAY);

  stats.qualified = top.length;

  const extractFailSummary = Object.entries(stats.extractionFailed)
    .map(([k, v]) => `${v} ${k}`).join(', ') || '0';
  const llmFailSummary = Object.entries(stats.llmFailed)
    .map(([k, v]) => `${v} ${k}`).join(', ') || '0';

  appendLog(
    `[discovery] Run summary: ${stats.candidatesAttempted} candidates attempted, ` +
    `extraction failures: ${extractFailSummary}, ` +
    `LLM failures: ${llmFailSummary}, ` +
    `${stats.llmThresholdFailed} below threshold, ` +
    `${stats.llmPassCount} LLM pass, ` +
    `${stats.qualified} qualified after dedup+quota. ` +
    `LLM: ${stats.llmCallCount} calls, ${stats.llmWallTimeMs}ms total`
  );

  // Save updated rotation state
  await saveRotationState(updatedRotationState);

  // Map to Article objects
  const now = new Date().toISOString();
  const discoveryArticles: Article[] = top.map(({ result, topic, bodyText, llmScores }) => ({
    id: makeId(result.sourceName, result.url),
    title: result.title,
    description: result.description,
    sourceName: result.sourceName,
    sourceUrl: result.sourceUrl,
    articleUrl: result.url,
    publishedAt: result.publishedAt!,   // guaranteed non-null after Gate 2
    fetchedAt: now,
    batchDate: '',                       // will be set by runPipeline during assembly
    imageUrl: undefined,
    bodyText: bodyText,
    feedbackSlot: null,
    discoveryTopic: topic.id,            // internal metadata
    llmScore: llmScores.composite,       // Phase 4: composite quality score @internal
  }));

  appendLog(
    `[discovery] Run complete. Topics probed: ${topicsToProbe.length}. ` +
    `Candidates qualified: ${discoveryArticles.length}`
  );

  if (discoveryArticles.length === 0) {
    appendLog('[discovery] Zero candidates qualified after quality gate and dedup.');
  }

  return discoveryArticles;
}
