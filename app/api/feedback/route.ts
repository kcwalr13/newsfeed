import { NextRequest, NextResponse } from 'next/server';
import { getFeedbackForDevice, getFeedbackForUser, upsertFeedback, getFeedbackRow } from '@/lib/db/feedback';
import { resolveSession, extractDeviceId } from '@/lib/auth/session';
import {
  getArticleAestheticScore,
  getAestheticProfile,
  upsertAestheticProfile,
  recomputeShortTermCentroid,
  updateDriftState,
  updateReceptivity,
} from '@/lib/db/aesthetics';
import { upsertConceptGraph } from '@/lib/db/concepts';
import { extractConcepts } from '@/lib/discovery/conceptExtractor';
import { computeDriftScore } from '@/lib/utils/driftScore';
import { recordProbeClusterPromotion, recordProbeClusterSuppression } from '@/lib/db/blindSpots';
import {
  computeDiversityScore,
  computeProbeAcceptanceRate,
  computeDwellRatio,
  computeReceptivity,
  receptivityToBudget,
} from '@/lib/pipeline/receptivity';
import type { AestheticScoreVector } from '@/lib/types/aesthetic';
import {
  AESTHETIC_ALPHA,
  DWELL_MEDIUM_THRESHOLD,
  DWELL_LONG_THRESHOLD,
  WEIGHT_LIKE_DEFAULT,
  WEIGHT_LIKE_MEDIUM,
  WEIGHT_LIKE_LONG,
  WEIGHT_SAVE_WITH_LIKE,
  WEIGHT_SAVE_NO_LIKE,
} from '@/lib/config/aesthetic';
import { enforceRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * Attempts to update the user's aesthetic profile via EMA after a feedback event.
 * If the article has no aesthetic score, silently skips (expected for pre-Phase-2 articles).
 * If the update fails for any reason, logs and swallows — never throws.
 */
async function updateAestheticProfile(
  userId: string | null,
  deviceId: string,
  articleId: string,
  value: 'like' | 'dislike'
): Promise<void> {
  try {
    const articleScore = await getArticleAestheticScore(articleId);
    if (!articleScore) {
      // Article pre-dates Phase 2 or scoring failed at ingest — expected, not an error.
      console.debug(`[aesthetic] no score for article ${articleId}, skipping EMA update`);
      return;
    }

    const profile = await getAestheticProfile(userId, deviceId);

    let newCentroid: AestheticScoreVector;
    let feedbackCount: number;

    if (!profile) {
      // First qualifying feedback event — initialize centroid directly from article score.
      if (value === 'like') {
        newCentroid = { ...articleScore };
      } else {
        // Mirror the score across the 1–5 scale to move away from this aesthetic position.
        newCentroid = {
          contemplative: 6.0 - articleScore.contemplative,
          concrete:      6.0 - articleScore.concrete,
          personal:      6.0 - articleScore.personal,
          playful:       6.0 - articleScore.playful,
          specialist:    6.0 - articleScore.specialist,
          emotional:     6.0 - articleScore.emotional,
        };
      }
      feedbackCount = 1;
    } else {
      // Apply EMA update.
      const alpha = AESTHETIC_ALPHA;
      const c = profile.centroid;
      const v = articleScore;

      if (value === 'like') {
        newCentroid = {
          contemplative: (1 - alpha) * c.contemplative + alpha * v.contemplative,
          concrete:      (1 - alpha) * c.concrete      + alpha * v.concrete,
          personal:      (1 - alpha) * c.personal      + alpha * v.personal,
          playful:       (1 - alpha) * c.playful       + alpha * v.playful,
          specialist:    (1 - alpha) * c.specialist    + alpha * v.specialist,
          emotional:     (1 - alpha) * c.emotional     + alpha * v.emotional,
        };
      } else {
        newCentroid = {
          contemplative: (1 - alpha) * c.contemplative + alpha * (6.0 - v.contemplative),
          concrete:      (1 - alpha) * c.concrete      + alpha * (6.0 - v.concrete),
          personal:      (1 - alpha) * c.personal      + alpha * (6.0 - v.personal),
          playful:       (1 - alpha) * c.playful       + alpha * (6.0 - v.playful),
          specialist:    (1 - alpha) * c.specialist    + alpha * (6.0 - v.specialist),
          emotional:     (1 - alpha) * c.emotional     + alpha * (6.0 - v.emotional),
        };
      }
      feedbackCount = profile.feedback_count + 1;
    }

    await upsertAestheticProfile(userId, deviceId, newCentroid, feedbackCount);
  } catch (err) {
    console.error(
      `[aesthetic] Profile update failed for deviceId=${deviceId} articleId=${articleId}:`,
      err
    );
    // Swallow — never cause the feedback POST to fail.
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const deviceId = extractDeviceId(req);

  const cookieRes = new NextResponse();
  const session = await resolveSession(req, cookieRes);
  const userId = session?.userId ?? null;

  try {
    let rows;
    if (userId) {
      rows = await getFeedbackForUser(userId);
    } else if (deviceId) {
      rows = await getFeedbackForDevice(deviceId);
    } else {
      return NextResponse.json({});
    }

    const result: Record<string, { value: string; updatedAt: string }> = {};
    for (const row of rows) {
      result[row.article_id] = {
        value: row.value,
        updatedAt: row.updated_at,
      };
    }

    const finalRes = NextResponse.json(result);
    const setCookie = cookieRes.headers.get('Set-Cookie');
    if (setCookie) finalRes.headers.set('Set-Cookie', setCookie);
    return finalRes;
  } catch (err) {
    console.error('[GET /api/feedback]', err);
    return NextResponse.json({});
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const deviceId = extractDeviceId(req);
  if (!deviceId) {
    return NextResponse.json({ error: 'Device ID required' }, { status: 400 });
  }

  // Feedback POSTs can trigger LLM calls (concept extraction); rate-limit per
  // device + IP.
  const limited = await enforceRateLimit(
    req,
    { name: 'feedback', limit: 60, windowSeconds: 60 },
    deviceId
  );
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { articleId, value, dwellSeconds } = body as Record<string, unknown>;

  if (!articleId || typeof articleId !== 'string') {
    return NextResponse.json({ error: 'articleId is required' }, { status: 400 });
  }
  if (value !== 'like' && value !== 'dislike' && value !== 'save' && value !== null) {
    return NextResponse.json(
      { error: "value must be 'like', 'dislike', 'save', or null" },
      { status: 400 }
    );
  }

  const parsedDwell = typeof dwellSeconds === 'number' && dwellSeconds >= 0
    ? Math.floor(dwellSeconds) : 0;

  const cookieRes = new NextResponse();
  const session = await resolveSession(req, cookieRes);
  const userId = session?.userId ?? null;

  try {
    // null value = dwell beacon only; do not write a feedback record
    let row: { article_id: string; value: string; updated_at: string } | null = null;
    if (value !== null) {
      row = await upsertFeedback(deviceId, articleId, value, userId, parsedDwell > 0 ? parsedDwell : null);
    }

    // Phase 4: probe response routing
    // Read batch to check for probeInfo on the article
    const probeInfo = await (async () => {
      try {
        const { readBatch: rb, readLatestBatch: rlb } = await import('@/lib/pipeline/storage');
        const today = new Date().toISOString().slice(0, 10);
        const batch = (await rb(today)) ?? (await rlb());
        const article = batch?.articles.find(a => a.id === articleId);
        return article?.probeInfo ?? null;
      } catch {
        return null;
      }
    })();

    if (probeInfo?.probeType === 'blind_spot') {
      try {
        if (value === 'like') {
          await recordProbeClusterPromotion(userId, deviceId, probeInfo.clusterLabel);
        } else if (value === 'dislike') {
          await recordProbeClusterSuppression(userId, deviceId, probeInfo.clusterLabel);
        }
        // ignore ('value: null' dwell beacon): no cluster state change here;
        // handled at next pipeline run by processPriorDayProbeIgnores()
      } catch (err) {
        console.error('[feedback] probe cluster state update failed:', err);
        // swallow — must not fail the feedback POST
      }
    }

    // Update aesthetic profile via EMA — for like/dislike/save (not null beacons).
    // save is treated as 'like' for EMA purposes: it's the strongest positive signal.
    if (value === 'like' || value === 'dislike' || value === 'save') {
      await updateAestheticProfile(
        userId,
        deviceId,
        articleId,
        value === 'save' ? 'like' : value
      );
    }

    // Phase 3: short-term recompute + drift update (failure swallowed)
    try {
      await recomputeShortTermCentroid(userId, deviceId);
      const updatedProfile = await getAestheticProfile(userId, deviceId);
      if (updatedProfile) {
        const driftScore = computeDriftScore(updatedProfile);
        await updateDriftState(userId, deviceId, driftScore);
      }
    } catch (err) {
      console.error('[Phase3] short-term recompute/drift update failed:', err);
      // swallow — never fail the feedback POST
    }

    // Phase 4: receptivity update (failure swallowed)
    try {
      const [diversity, probeAcceptance, dwellRatio] = await Promise.all([
        computeDiversityScore(userId, deviceId),
        computeProbeAcceptanceRate(userId, deviceId),
        computeDwellRatio(userId, deviceId),
      ]);
      const rScore  = computeReceptivity(diversity, probeAcceptance, dwellRatio);
      const rBudget = receptivityToBudget(rScore);
      await updateReceptivity(userId, deviceId, rScore, rBudget);
    } catch (err) {
      console.error('[feedback] receptivity update failed:', err);
      // swallow — must not fail the feedback POST
    }

    // Phase 3: concept extraction + graph upsert (only on like and save)
    if ((value === 'like' || value === 'save') && articleId) {
      // Run fire-and-forget to not delay the response
      (async () => {
        try {
          const { readBatch, readLatestBatch } = await import('@/lib/pipeline/storage');
          const today = new Date().toISOString().slice(0, 10);
          const batch = (await readBatch(today)) ?? (await readLatestBatch());
          const article = batch?.articles.find(a => a.id === articleId);
          if (!article?.bodyText) return;

          // Compute engagement weight
          let engagementWeight = WEIGHT_LIKE_DEFAULT;
          if (value === 'save') {
            engagementWeight = WEIGHT_SAVE_NO_LIKE;
          } else {
            // value === 'like': check if article is already saved
            const existingRow = await getFeedbackRow(deviceId, articleId, userId);
            const alreadySaved = existingRow?.value === 'save';
            if (alreadySaved) {
              engagementWeight = WEIGHT_SAVE_WITH_LIKE;
            } else if (parsedDwell >= DWELL_LONG_THRESHOLD) {
              engagementWeight = WEIGHT_LIKE_LONG;
            } else if (parsedDwell >= DWELL_MEDIUM_THRESHOLD) {
              engagementWeight = WEIGHT_LIKE_MEDIUM;
            } else {
              engagementWeight = WEIGHT_LIKE_DEFAULT;
            }
          }

          const concepts = await extractConcepts(article.bodyText);
          await upsertConceptGraph(userId, deviceId, concepts, engagementWeight);
        } catch (err) {
          console.error('[Phase3] concept extraction/graph upsert failed:', err);
          // swallow — never fail the feedback POST
        }
      })();
    }

    // Return consistent shape; for beacon (value === null), synthesize a minimal response
    const responseRow = row ?? { article_id: articleId, value: null, updated_at: new Date().toISOString() };

    const finalRes = NextResponse.json({
      articleId: responseRow.article_id,
      value: responseRow.value,
      updatedAt: responseRow.updated_at,
    });
    const setCookie = cookieRes.headers.get('Set-Cookie');
    if (setCookie) finalRes.headers.set('Set-Cookie', setCookie);
    return finalRes;
  } catch (err) {
    console.error('[POST /api/feedback]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
