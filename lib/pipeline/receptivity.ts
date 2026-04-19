// Phase 4: Receptivity signal computation — diversity, probe acceptance, dwell ratio, and budget.

import { sql } from '@/lib/db/client';
import { readBatch } from '@/lib/pipeline/storage';
import {
  RECEPTIVITY_WEIGHT_DIVERSITY,
  RECEPTIVITY_WEIGHT_PROBE_ACCEPTANCE,
  RECEPTIVITY_WEIGHT_DWELL_RATIO,
  DWELL_RATIO_CAP,
  RECEPTIVITY_DIVERSITY_MIN_LIKES,
  RECEPTIVITY_PROBE_MIN_SHOWN,
  RECEPTIVITY_DWELL_MIN_POINTS,
  RECEPTIVITY_THRESHOLDS,
  EXPLORATION_BASELINE,
  EXPLORATION_CEILING,
} from '@/lib/config/serendipity';

/**
 * Computes the topic diversity score from recent liked articles.
 *
 * Queries the trailing 7-day liked articles, reads their extractedConcepts from batch
 * JSON, and returns: Math.min(distinct_concepts / liked_count, 1.0).
 * Returns 0.5 if fewer than RECEPTIVITY_DIVERSITY_MIN_LIKES liked articles exist.
 */
export async function computeDiversityScore(
  userId: string | null,
  deviceId: string
): Promise<number> {
  const rows = await sql`
    SELECT article_id, updated_at::text AS updated_at
    FROM feedback
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId} IS NULL))
      AND value = 'like'
      AND updated_at >= NOW() - INTERVAL '7 days'
  `;

  const likedRows = rows as Array<{ article_id: string; updated_at: string }>;

  if (likedRows.length < RECEPTIVITY_DIVERSITY_MIN_LIKES) {
    return 0.5;
  }

  // Load batch JSON files to find extractedConcepts for each liked article.
  // Group by batchDate for efficient batch loading.
  const batchCache = new Map<string, ReturnType<typeof readBatch>>();
  const distinctConcepts = new Set<string>();

  for (const row of likedRows) {
    // Derive batchDate from updated_at (YYYY-MM-DD prefix)
    const batchDate = row.updated_at.slice(0, 10);
    if (!batchCache.has(batchDate)) {
      batchCache.set(batchDate, readBatch(batchDate));
    }
    const batch = batchCache.get(batchDate);
    const article = batch?.articles.find(a => a.id === row.article_id);
    for (const concept of article?.extractedConcepts ?? []) {
      distinctConcepts.add(concept);
    }
  }

  return Math.min(distinctConcepts.size / likedRows.length, 1.0);
}

/**
 * Computes the probe acceptance rate over the trailing 14 days.
 *
 * Reads feedback rows, checks batch JSON for probeInfo, and returns:
 * Math.min(probe_likes / probes_shown, 1.0).
 * Returns 0.5 if fewer than RECEPTIVITY_PROBE_MIN_SHOWN probe articles exist.
 */
export async function computeProbeAcceptanceRate(
  userId: string | null,
  deviceId: string
): Promise<number> {
  const rows = await sql`
    SELECT article_id, value, updated_at::text AS updated_at
    FROM feedback
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId} IS NULL))
      AND updated_at >= NOW() - INTERVAL '14 days'
  `;

  const feedbackRows = rows as Array<{ article_id: string; value: string; updated_at: string }>;

  // Group by batchDate for efficient batch loading
  const batchCache = new Map<string, ReturnType<typeof readBatch>>();
  let probesShown = 0;
  let probeLikes  = 0;

  for (const row of feedbackRows) {
    const batchDate = row.updated_at.slice(0, 10);
    if (!batchCache.has(batchDate)) {
      batchCache.set(batchDate, readBatch(batchDate));
    }
    const batch = batchCache.get(batchDate);
    const article = batch?.articles.find(a => a.id === row.article_id);
    if (article?.probeInfo?.probeType === 'blind_spot') {
      probesShown++;
      if (row.value === 'like') probeLikes++;
    }
  }

  if (probesShown < RECEPTIVITY_PROBE_MIN_SHOWN) {
    return 0.5;
  }

  return Math.min(probeLikes / probesShown, 1.0);
}

/**
 * Computes the exploration vs. exploitation dwell ratio over the trailing 14 days.
 *
 * Queries feedback rows with non-null dwell_seconds, classifies each as exploration
 * (explorationSlotType != null) or exploitation (null or absent), and returns:
 * avg_dwell_exploration / avg_dwell_exploitation.
 * Returns 0.75 if either pool has fewer than RECEPTIVITY_DWELL_MIN_POINTS data points.
 * Note: not capped here; capping happens in computeReceptivity().
 */
export async function computeDwellRatio(
  userId: string | null,
  deviceId: string
): Promise<number> {
  const rows = await sql`
    SELECT article_id, CAST(dwell_seconds AS FLOAT) AS dwell_seconds,
           updated_at::text AS updated_at
    FROM feedback
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId} IS NULL))
      AND dwell_seconds IS NOT NULL
      AND updated_at >= NOW() - INTERVAL '14 days'
  `;

  const dwellRows = rows as Array<{
    article_id:    string;
    dwell_seconds: number;
    updated_at:    string;
  }>;

  // Group by batchDate for efficient batch loading
  const batchCache = new Map<string, ReturnType<typeof readBatch>>();
  const explorationDwells: number[] = [];
  const exploitationDwells: number[] = [];

  for (const row of dwellRows) {
    const batchDate = row.updated_at.slice(0, 10);
    if (!batchCache.has(batchDate)) {
      batchCache.set(batchDate, readBatch(batchDate));
    }
    const batch = batchCache.get(batchDate);
    const article = batch?.articles.find(a => a.id === row.article_id);
    const slotType = article?.explorationSlotType;

    if (slotType != null) {
      explorationDwells.push(row.dwell_seconds);
    } else {
      exploitationDwells.push(row.dwell_seconds);
    }
  }

  if (
    explorationDwells.length < RECEPTIVITY_DWELL_MIN_POINTS ||
    exploitationDwells.length < RECEPTIVITY_DWELL_MIN_POINTS
  ) {
    return 0.75;
  }

  const avgExploration  = explorationDwells.reduce((s, v) => s + v, 0)  / explorationDwells.length;
  const avgExploitation = exploitationDwells.reduce((s, v) => s + v, 0) / exploitationDwells.length;

  if (avgExploitation === 0) return 0.75;

  return avgExploration / avgExploitation;
}

/**
 * Combines the three receptivity signals into a single score in [0.0, 1.0].
 * Pure function — no I/O.
 */
export function computeReceptivity(
  diversityScore:      number,
  probeAcceptanceRate: number,
  dwellRatio:          number
): number {
  const raw =
    RECEPTIVITY_WEIGHT_DIVERSITY        * diversityScore +
    RECEPTIVITY_WEIGHT_PROBE_ACCEPTANCE * probeAcceptanceRate +
    RECEPTIVITY_WEIGHT_DWELL_RATIO      * Math.min(dwellRatio, DWELL_RATIO_CAP) / DWELL_RATIO_CAP;
  return Math.min(Math.max(raw, 0.0), 1.0);
}

/**
 * Maps a receptivity score to an exploration budget in [EXPLORATION_FLOOR, EXPLORATION_CEILING].
 * Returns EXPLORATION_BASELINE when receptivityScore is null. Pure function — no I/O.
 */
export function receptivityToBudget(receptivityScore: number | null): number {
  if (receptivityScore === null || receptivityScore === undefined) {
    return EXPLORATION_BASELINE;
  }
  for (const threshold of RECEPTIVITY_THRESHOLDS) {
    if (receptivityScore <= threshold.max) return threshold.budget;
  }
  return EXPLORATION_CEILING;
}
