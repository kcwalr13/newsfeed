/**
 * POST /api/onboarding/seed
 *
 * Seeds the aesthetic centroid from the FALLBACK calibration set (R4-08). The
 * fallback pieces are committed fixtures, not real DB-scored articles, so they
 * must NOT go through the normal feedback path: that would (a) write phantom
 * feedback rows for non-existent article ids (FK-less `feedback.article_id`,
 * permanently inflating metrics) and (b) skip the EMA because
 * getArticleAestheticScore('seed-…') returns null — the headline P3-E centroid
 * seeding would silently no-op. Instead we apply the EMA directly from each
 * piece's hand-authored aesthetic vector and write NO feedback rows.
 *
 * Body: { responses: Record<seedId, 'like' | 'dislike'> }. Unknown ids are
 * ignored (never seeded), so a client can't seed against arbitrary input.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveSession, extractDeviceId } from '@/lib/auth/session';
import { applyAestheticEmaUpdate } from '@/lib/db/aesthetics';
import { AESTHETIC_ALPHA } from '@/lib/config/aesthetic';
import { getSeedAesthetic } from '@/lib/onboarding/seedSet';
import type { AestheticScoreVector } from '@/lib/types/aesthetic';

export const dynamic = 'force-dynamic';

/** Mirrors a vector across the 1–5 scale — a dislike moves the centroid away
 *  from that aesthetic position, matching the feedback route's `6 - score`. */
function mirror(v: AestheticScoreVector): AestheticScoreVector {
  return {
    contemplative: 6 - v.contemplative,
    concrete:      6 - v.concrete,
    personal:      6 - v.personal,
    playful:       6 - v.playful,
    specialist:    6 - v.specialist,
    emotional:     6 - v.emotional,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cookieRes = new NextResponse();
  try {
    const session = await resolveSession(req, cookieRes);
    const userId = session?.userId ?? null;
    const deviceId = extractDeviceId(req);
    if (!deviceId) return NextResponse.json({ ok: true, skipped: 'no-device' });

    const body = (await req.json().catch(() => ({}))) as { responses?: unknown };
    const responses =
      body.responses && typeof body.responses === 'object'
        ? (body.responses as Record<string, unknown>)
        : {};

    // Apply sequentially: applyAestheticEmaUpdate blends against the profile row
    // at update time, so concurrent writes to one profile would interleave.
    let seeded = 0;
    for (const [id, value] of Object.entries(responses)) {
      if (value !== 'like' && value !== 'dislike') continue;
      const vec = getSeedAesthetic(id);
      if (!vec) continue; // unknown id — never seed for it
      const target = value === 'like' ? vec : mirror(vec);
      await applyAestheticEmaUpdate(userId, deviceId, target, AESTHETIC_ALPHA);
      seeded++;
    }

    const res = NextResponse.json({ ok: true, seeded });
    const setCookie = cookieRes.headers.get('Set-Cookie');
    if (setCookie) res.headers.set('Set-Cookie', setCookie);
    return res;
  } catch (err) {
    console.error('[POST /api/onboarding/seed]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
