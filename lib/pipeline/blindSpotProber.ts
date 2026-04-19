// Phase 4: LLM-based blind spot cluster identification, probe article selection, and ignore processing.

import Anthropic from '@anthropic-ai/sdk';
import type { Article } from '@/lib/types/article';
import type { BlindSpotCluster } from '@/lib/db/blindSpots';
import { recordProbeClusterIgnore } from '@/lib/db/blindSpots';

const anthropic = new Anthropic();

interface BlindSpotClusterResult {
  clusterLabel:       string;
  memberConcepts:     string[];
  backingArticleIds:  string[];
  avgRawSurprise:     number;
}

/**
 * Identifies thematic blind spot clusters from unknown concept labels across articles.
 *
 * @param unknownConceptsByArticle  Map of articleId -> unknown concept labels for that article
 * @param serendipityScores         Map of articleId -> serendipity score for avg computation
 * @returns Array of clusters with >= 3 distinct backing articles; [] on insufficient data or LLM failure
 */
export async function identifyBlindSpotClusters(
  unknownConceptsByArticle: Map<string, string[]>,
  serendipityScores: Map<string, number>
): Promise<BlindSpotClusterResult[]> {
  // Flatten and deduplicate all unknown concept labels
  const allUnknown = new Map<string, Set<string>>();  // label -> set of article IDs
  for (const [articleId, concepts] of unknownConceptsByArticle) {
    for (const concept of concepts) {
      if (!allUnknown.has(concept)) {
        allUnknown.set(concept, new Set());
      }
      allUnknown.get(concept)!.add(articleId);
    }
  }

  const uniqueLabels = Array.from(allUnknown.keys());
  if (uniqueLabels.length < 3) {
    return [];
  }

  const GROUP_CONCEPTS_TOOL: Anthropic.Tool = {
    name: 'group_concepts',
    description: 'Group concept labels into broad thematic clusters.',
    input_schema: {
      type: 'object',
      properties: {
        clusters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cluster_label:   { type: 'string' },
              member_concepts: { type: 'array', items: { type: 'string' } },
            },
            required: ['cluster_label', 'member_concepts'],
          },
        },
      },
      required: ['clusters'],
    },
  };

  let rawClusters: Array<{ cluster_label: string; member_concepts: string[] }>;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system:
        'You are a concept taxonomy assistant. Group the following concept labels into ' +
        'broad thematic clusters of 2-8 words each. Assign each label to exactly one cluster. ' +
        "Use a cluster labeled 'other' for labels that do not fit any clear theme.",
      tools: [GROUP_CONCEPTS_TOOL],
      tool_choice: { type: 'any' },
      messages: [
        {
          role: 'user',
          content: uniqueLabels.join('\n'),
        },
      ],
    });

    const toolUse = response.content.find(b => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      console.error('[blindSpotProber] LLM did not return a tool_use block');
      return [];
    }

    const input = toolUse.input as { clusters?: unknown };
    if (!Array.isArray(input.clusters)) {
      console.error('[blindSpotProber] tool input.clusters is not an array');
      return [];
    }

    rawClusters = (input.clusters as Array<{ cluster_label?: unknown; member_concepts?: unknown }>)
      .filter(c =>
        typeof c.cluster_label === 'string' &&
        c.cluster_label.trim().length > 0 &&
        Array.isArray(c.member_concepts) &&
        (c.member_concepts as unknown[]).length > 0
      )
      .map(c => ({
        cluster_label:   (c.cluster_label as string).trim(),
        member_concepts: (c.member_concepts as unknown[]).filter(
          (m): m is string => typeof m === 'string'
        ),
      }));
  } catch (err) {
    console.error('[blindSpotProber] LLM cluster identification failed:', err);
    return [];
  }

  // For each cluster, find backing article IDs and filter to >= 3 distinct articles
  const results: BlindSpotClusterResult[] = [];

  for (const cluster of rawClusters) {
    const backingIds = new Set<string>();

    for (const memberConcept of cluster.member_concepts) {
      const articleIds = allUnknown.get(memberConcept);
      if (articleIds) {
        for (const id of articleIds) {
          backingIds.add(id);
        }
      }
    }

    if (backingIds.size < 3) continue;

    const backingArticleIds = Array.from(backingIds);

    // Compute avgRawSurprise across backing articles
    let scoreSum = 0;
    let scoreCount = 0;
    for (const id of backingArticleIds) {
      const score = serendipityScores.get(id);
      if (score !== undefined) {
        scoreSum += score;
        scoreCount++;
      }
    }
    const avgRawSurprise = scoreCount > 0 ? scoreSum / scoreCount : 0;

    results.push({
      clusterLabel:      cluster.cluster_label,
      memberConcepts:    cluster.member_concepts,
      backingArticleIds,
      avgRawSurprise,
    });
  }

  return results;
}

/**
 * Selects the best probe article from available clusters, respecting suppression state.
 *
 * Priority:
 *   1. Promoted clusters first
 *   2. Never-suppressed clusters (dislike_count === 0 in DB, or no DB row)
 *   3. Previously-suppressed clusters last (ordered by avgRawSurprise DESC)
 *
 * Sets probeInfo on the selected article object in-memory.
 *
 * @returns { article, clusterLabel } or null if all clusters are suppressed
 */
export function selectProbeArticle(
  clusters: BlindSpotClusterResult[],
  eligibleDbClusters: BlindSpotCluster[],
  serendipityScores: Map<string, number>,
  articles: Article[]
): { article: Article; clusterLabel: string } | null {
  // Build a lookup for DB cluster state by label
  const dbClusterByLabel = new Map<string, BlindSpotCluster>();
  for (const dbCluster of eligibleDbClusters) {
    dbClusterByLabel.set(dbCluster.cluster_label, dbCluster);
  }

  // Build the set of suppressed cluster labels (those NOT in eligibleDbClusters but in DB)
  // eligibleDbClusters already excludes currently-suppressed clusters from getEligibleClusters()
  const eligibleLabels = new Set(eligibleDbClusters.map(c => c.cluster_label));

  // Filter to clusters that are either not tracked in DB (new) or are eligible
  const candidateClusters = clusters.filter(c => {
    const dbRow = dbClusterByLabel.get(c.clusterLabel);
    // If no DB row, it has never been suppressed — eligible
    // If DB row is in eligibleClusters, it's active or promoted — eligible
    if (!dbRow) return true;
    return eligibleLabels.has(c.clusterLabel);
  });

  if (candidateClusters.length === 0) return null;

  // Sort by priority
  const sorted = [...candidateClusters].sort((a, b) => {
    const aDb = dbClusterByLabel.get(a.clusterLabel);
    const bDb = dbClusterByLabel.get(b.clusterLabel);

    const aPromoted  = aDb?.status === 'promoted';
    const bPromoted  = bDb?.status === 'promoted';
    const aNeverDisliked = !aDb || aDb.dislike_count === 0;
    const bNeverDisliked = !bDb || bDb.dislike_count === 0;

    if (aPromoted && !bPromoted) return -1;
    if (!aPromoted && bPromoted) return 1;
    if (aNeverDisliked && !bNeverDisliked) return -1;
    if (!aNeverDisliked && bNeverDisliked) return 1;
    // Both in same tier: sort by avgRawSurprise DESC
    return b.avgRawSurprise - a.avgRawSurprise;
  });

  // Select the top cluster and find the highest-serendipity backing article
  for (const cluster of sorted) {
    // Build article id map for lookup
    const articleById = new Map<string, Article>();
    for (const article of articles) {
      articleById.set(article.id, article);
    }

    let bestArticle: Article | null = null;
    let bestScore = -1;

    for (const articleId of cluster.backingArticleIds) {
      const article = articleById.get(articleId);
      if (!article) continue;
      const score = serendipityScores.get(articleId) ?? 0;
      if (score > bestScore) {
        bestScore = score;
        bestArticle = article;
      }
    }

    if (bestArticle) {
      // Set probe info on the article object in-memory
      bestArticle.probeInfo = { probeType: 'blind_spot', clusterLabel: cluster.clusterLabel };
      return { article: bestArticle, clusterLabel: cluster.clusterLabel };
    }
  }

  return null;
}

/**
 * Processes ignore events for probe articles from the previous day's batch.
 * Called at pipeline time. Articles with probeInfo and no like/dislike feedback
 * are treated as ignored.
 *
 * Errors are caught, logged, and swallowed — they must not abort the pipeline.
 */
export async function processPriorDayProbeIgnores(
  userId: string | null,
  deviceId: string,
  yesterdayBatch: Article[],
  feedbackRows: Array<{ article_id: string; value: string }>
): Promise<void> {
  // Build a set of article IDs with explicit like/dislike feedback
  const feedbackIds = new Set<string>();
  for (const row of feedbackRows) {
    if (row.value === 'like' || row.value === 'dislike') {
      feedbackIds.add(row.article_id);
    }
  }

  // Find all probe articles from yesterday's batch
  const probeArticles = yesterdayBatch.filter(a => a.probeInfo?.probeType === 'blind_spot');

  for (const article of probeArticles) {
    if (!article.probeInfo) continue;
    // If no feedback row exists, this probe was ignored
    if (!feedbackIds.has(article.id)) {
      try {
        await recordProbeClusterIgnore(userId, deviceId, article.probeInfo.clusterLabel);
      } catch (err) {
        console.error(
          `[blindSpotProber] Failed to record ignore for cluster "${article.probeInfo.clusterLabel}":`,
          err
        );
        // swallow — must not abort pipeline
      }
    }
  }
}
