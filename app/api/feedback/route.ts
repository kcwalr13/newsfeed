import { NextRequest, NextResponse } from 'next/server';
import { getFeedbackForDevice, getFeedbackForUser, upsertFeedback } from '@/lib/db/feedback';
import { resolveSession, buildSessionCookie, extractDeviceId } from '@/lib/auth/session';
import {
  getArticleAestheticScore,
  getAestheticProfile,
  upsertAestheticProfile,
} from '@/lib/db/aesthetics';
import type { AestheticScoreVector } from '@/lib/types/aesthetic';
import { AESTHETIC_ALPHA } from '@/lib/config/aesthetic';

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { articleId, value } = body as Record<string, unknown>;

  if (!articleId || typeof articleId !== 'string') {
    return NextResponse.json({ error: 'articleId is required' }, { status: 400 });
  }
  if (value !== 'like' && value !== 'dislike') {
    return NextResponse.json({ error: "value must be 'like' or 'dislike'" }, { status: 400 });
  }

  const cookieRes = new NextResponse();
  const session = await resolveSession(req, cookieRes);
  const userId = session?.userId ?? null;

  try {
    const row = await upsertFeedback(deviceId, articleId, value, userId);

    // Update aesthetic profile via EMA (synchronous, failure swallowed).
    await updateAestheticProfile(userId, deviceId, articleId, value);

    const finalRes = NextResponse.json({
      articleId: row.article_id,
      value: row.value,
      updatedAt: row.updated_at,
    });
    const setCookie = cookieRes.headers.get('Set-Cookie');
    if (setCookie) finalRes.headers.set('Set-Cookie', setCookie);
    return finalRes;
  } catch (err) {
    console.error('[POST /api/feedback]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
