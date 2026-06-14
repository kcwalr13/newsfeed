// Tangent product metrics (P3-D1). Computed on the fly from article_batches +
// feedback + user_aesthetic_profiles — no snapshot table, no migration. Powers
// GET /api/metrics (P3-D2) and the /dashboard page (P3-D3): is the feed broad,
// novel, surfacing unfamiliar sources, and is the taste model maturing?

import { sql } from '@/lib/db/client';
import { registrableDomain } from '@/lib/utils/url';
import { categoryForArticle } from '@/lib/pipeline/sourceCategory';
import { getAestheticProfile } from '@/lib/db/aesthetics';
import { getFeedbackForUser, getFeedbackForDevice } from '@/lib/db/feedback';
import { EXPLORATION_BASELINE } from '@/lib/config/serendipity';

/** Discovery-vs-fixed split for one time window. */
export interface DiscoveryShare {
  discovery: number;
  fixed: number;
  total: number;
  /** Discovery as a fraction of total, [0,1]. */
  discoveryPct: number;
}

export interface TangentMetrics {
  /** Most recent batch date present (YYYY-MM-DD), or null if none. */
  latestBatchDate: string | null;
  /** Discovery share for the latest issue and trailing 7/30 days. */
  discoveryShare: { today: DiscoveryShare; last7d: DiscoveryShare; last30d: DiscoveryShare };
  /** Distinct source domains shown in the last 7 days. */
  distinctSourcesThisWeek: number;
  /** Article counts per editorial category over the last 30 days (desc). */
  categoryDistribution: Array<{ category: string; count: number }>;
  /** Exploration-slot acceptance over the last 30 days. */
  explorationAcceptance: { shown: number; accepted: number; rate: number };
  /** Taste-model maturity snapshot. */
  tasteMaturity: {
    feedbackCount: number;
    isDrifting: boolean;
    shortTermEventCount: number;
    receptivityScore: number | null;
    explorationBudget: number;
  };
}

interface ArticleProjection {
  batch_date: string;
  id: string;
  source_url: string | null;
  source_name: string | null;
  discovery_topic: string | null;
  exploration_slot_type: string | null;
}

/** YYYY-MM-DD for `n` days before now (UTC). */
function daysAgoUTC(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const isDiscovery = (r: ArticleProjection): boolean =>
  !!(r.discovery_topic && r.discovery_topic !== '');

function share(rows: ArticleProjection[]): DiscoveryShare {
  const total = rows.length;
  const discovery = rows.filter(isDiscovery).length;
  return { discovery, fixed: total - discovery, total, discoveryPct: total ? discovery / total : 0 };
}

/**
 * Computes the full metrics snapshot for the given identity. All reads are
 * lean projections (no bodyText) and the aesthetic/feedback reads reuse the
 * existing helpers. Identity-scoped pieces (acceptance, maturity) degrade to
 * neutral defaults when no profile/feedback exists.
 */
export async function computeMetrics(
  userId: string | null,
  deviceId: string | null
): Promise<TangentMetrics> {
  const cutoff30 = daysAgoUTC(30);
  const cutoff7 = daysAgoUTC(7);

  const projection = (await sql`
    SELECT ab.batch_date AS batch_date,
           elem->>'id' AS id,
           elem->>'sourceUrl' AS source_url,
           elem->>'sourceName' AS source_name,
           elem->>'discoveryTopic' AS discovery_topic,
           elem->>'explorationSlotType' AS exploration_slot_type
    FROM article_batches ab
    CROSS JOIN LATERAL jsonb_array_elements(ab.articles) AS elem
    WHERE ab.batch_date >= ${cutoff30}
  `) as ArticleProjection[];

  const latestBatchDate = projection.reduce<string | null>(
    (max, r) => (max === null || r.batch_date > max ? r.batch_date : max),
    null
  );

  const todayRows = latestBatchDate
    ? projection.filter((r) => r.batch_date === latestBatchDate)
    : [];
  const last7 = projection.filter((r) => r.batch_date >= cutoff7);
  const last30 = projection;

  // Distinct source domains shown in the last 7 days.
  const sources7 = new Set<string>();
  for (const r of last7) {
    if (r.source_url) sources7.add(registrableDomain(r.source_url));
  }

  // Category distribution over the last 30 days (uncategorized discovery folds
  // into a "discovery" bucket so the chart accounts for every article).
  const catCounts = new Map<string, number>();
  for (const r of last30) {
    const cat =
      categoryForArticle({
        sourceName: r.source_name ?? undefined,
        sourceUrl: r.source_url ?? undefined,
      }) ?? (isDiscovery(r) ? 'discovery' : 'uncategorized');
    catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
  }
  const categoryDistribution = [...catCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // Feedback (reused for both acceptance and the maturity fallback).
  const feedbackRows = userId
    ? await getFeedbackForUser(userId)
    : deviceId
      ? await getFeedbackForDevice(deviceId)
      : [];
  const acceptedIds = new Set<string>();
  for (const f of feedbackRows) {
    if (f.value === 'like' || f.value === 'save') acceptedIds.add(f.article_id);
  }

  // Exploration acceptance over the last 30 days.
  const explShown = last30.filter(
    (r) => r.exploration_slot_type && r.exploration_slot_type !== ''
  );
  const explAccepted = explShown.filter((r) => acceptedIds.has(r.id)).length;

  // Taste-model maturity from the aesthetic profile (neutral defaults if none).
  const profile = deviceId ? await getAestheticProfile(userId, deviceId) : null;

  return {
    latestBatchDate,
    discoveryShare: {
      today: share(todayRows),
      last7d: share(last7),
      last30d: share(last30),
    },
    distinctSourcesThisWeek: sources7.size,
    categoryDistribution,
    explorationAcceptance: {
      shown: explShown.length,
      accepted: explAccepted,
      rate: explShown.length ? explAccepted / explShown.length : 0,
    },
    tasteMaturity: {
      feedbackCount: profile?.feedback_count ?? feedbackRows.length,
      isDrifting: profile?.is_drifting ?? false,
      shortTermEventCount: profile?.short_term_feedback_count ?? 0,
      receptivityScore: profile?.receptivity_score ?? null,
      explorationBudget: profile?.exploration_budget ?? EXPLORATION_BASELINE,
    },
  };
}
