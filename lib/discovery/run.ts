// Discovery orchestrator: topic selection, Brave Search, quality gate, dedup, quota enforcement.

import crypto from 'crypto';
import type { Article } from '@/lib/types/article';
import { DISCOVERY_TOPICS_PER_RUN, DISCOVERY_CANDIDATES_PER_TOPIC, DISCOVERY_ARTICLES_PER_DAY, TOPIC_WEIGHT_STEP, TOPIC_WEIGHT_FLOOR, TOPIC_WEIGHT_CEILING } from '@/lib/config/feed';
import { DISCOVERY_TOPICS } from './topics';
import type { DiscoveryTopic } from './topics';
import { searchBrave } from './braveSearch';
import type { BraveSearchResult } from './braveSearch';
import { evaluateCandidate } from './qualityGate';
import { appendLog, readLatestBatch } from '@/lib/pipeline/storage';
import {
  getTopicWeightsForUser,
  getAllTopicWeightsAveraged,
  upsertTopicWeight,
} from '@/lib/db/discovery';
import type { TopicWeightRow } from '@/lib/db/discovery';
import { getFeedbackForUser } from '@/lib/db/feedback';

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function makeId(sourceName: string, articleUrl: string): string {
  const slug = slugify(sourceName);
  const hash = crypto.createHash('sha256').update(articleUrl).digest('hex').slice(0, 8);
  return `${slug}-${hash}`;
}

function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

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
 * selects topics, searches Brave, filters through quality gate, deduplicates,
 * enforces quota, and returns Article[] ready to merge with the fixed pipeline.
 *
 * @param fixedArticleUrls - Canonical URLs of articles already in the fixed pipeline.
 * @param userId - Optional user ID for user-specific topic weights (used in P1).
 */
export async function runDiscovery(
  fixedArticleUrls: Set<string>,
  userId?: string | null
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
      const feedbackRows = await getFeedbackForUser(userId);
      const latestBatch = readLatestBatch();
      if (latestBatch) {
        const articleTopicMap = new Map<string, string>();  // article_id -> topic_id
        for (const article of latestBatch.articles) {
          if (article.discoveryTopic) {
            articleTopicMap.set(article.id, article.discoveryTopic);
          }
        }
        for (const row of feedbackRows) {
          const topicId = articleTopicMap.get(row.article_id);
          if (!topicId || topicId === 'uncategorized') continue;
          const current = topicWeightMap.get(topicId) ?? 1.0;
          const delta = row.value === 'like' ? TOPIC_WEIGHT_STEP : -TOPIC_WEIGHT_STEP;
          const updated = Math.max(TOPIC_WEIGHT_FLOOR, Math.min(TOPIC_WEIGHT_CEILING, current + delta));
          topicWeightMap.set(topicId, updated);
          // userId is used as device_id for user-triggered runs (pragmatic simplification:
          // device_id NOT NULL constraint met; UNIQUE on (user_id, device_id, topic_id) still works).
          await upsertTopicWeight(userId, topicId, updated, userId);
        }
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

  const searchResults = await Promise.allSettled(
    topicsToProbe.map((topic) =>
      searchBrave(topic.searchQueries[0], DISCOVERY_CANDIDATES_PER_TOPIC)
        .then((results) => ({ topic, results }))
    )
  );

  // Quality gate pass + within-discovery dedup
  const seenCanonical = new Set<string>();

  interface ScoredCandidate {
    result: BraveSearchResult;
    topic: DiscoveryTopic;
    specificityScore: number;
  }

  const qualified: ScoredCandidate[] = [];

  for (const settled of searchResults) {
    if (settled.status === 'rejected') {
      const reason = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
      appendLog(`[discovery] Topic search failed: ${reason}`);
      continue;
    }

    const { topic, results } = settled.value;

    for (const result of results) {
      const gateResult = evaluateCandidate(result);

      if (!gateResult.pass) {
        appendLog(`[discovery] DISCARD [${topic.id}] ${result.url} -- ${gateResult.reason}`);
        continue;
      }

      const canonical = canonicalizeUrl(result.url);

      // Pass 2: dedup against fixed pipeline
      if (fixedArticleUrls.has(canonical)) {
        appendLog(`[discovery] DISCARD [${topic.id}] ${result.url} -- DUPLICATE_FIXED`);
        continue;
      }

      // Pass 1: within-discovery dedup
      if (seenCanonical.has(canonical)) {
        appendLog(`[discovery] DISCARD [${topic.id}] ${result.url} -- DUPLICATE_DISCOVERY`);
        continue;
      }

      seenCanonical.add(canonical);
      qualified.push({ result, topic, specificityScore: gateResult.specificityScore });
    }
  }

  // Sort by specificity score descending, enforce quota
  qualified.sort((a, b) => b.specificityScore - a.specificityScore);
  const top = qualified.slice(0, DISCOVERY_ARTICLES_PER_DAY);

  // Map to Article objects
  const now = new Date().toISOString();
  const discoveryArticles: Article[] = top.map(({ result, topic }) => ({
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
    bodyText: undefined,
    feedbackSlot: null,
    discoveryTopic: topic.id,            // internal metadata
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
