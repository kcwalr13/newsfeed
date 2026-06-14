/**
 * POST /api/onboarding/tone
 *
 * Applies the optional tone preference from the first-run calibration flow
 * (P3-E3) as a single EMA nudge of the aesthetic centroid toward the chosen
 * tonal poles. Reads the current centroid and overrides ONLY the selected
 * dimensions — every other dimension's target equals its current value, so the
 * nudge can't dilute the like/pass-derived centroid and is order-independent
 * with respect to the calibration feedback writes. Reuses the feedback table /
 * profile (no migration). Body: { tones: string[] }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveSession, extractDeviceId } from '@/lib/auth/session';
import { getAestheticProfile, applyAestheticEmaUpdate } from '@/lib/db/aesthetics';
import { AESTHETIC_ALPHA } from '@/lib/config/aesthetic';
import type { AestheticScoreVector } from '@/lib/types/aesthetic';

/** Each selectable tone maps to one aesthetic dimension and a pole (1 or 5). */
const TONE_DIM: Record<string, { dim: keyof AestheticScoreVector; pole: number }> = {
  Contemplative: { dim: 'contemplative', pole: 5 },
  Propulsive: { dim: 'contemplative', pole: 1 },
  Serious: { dim: 'playful', pole: 5 },
  Playful: { dim: 'playful', pole: 1 },
  Specialist: { dim: 'specialist', pole: 5 },
  Generalist: { dim: 'specialist', pole: 1 },
};

const NEUTRAL: AestheticScoreVector = {
  contemplative: 3, concrete: 3, personal: 3, playful: 3, specialist: 3, emotional: 3,
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cookieRes = new NextResponse();
  try {
    const session = await resolveSession(req, cookieRes);
    const userId = session?.userId ?? null;
    const deviceId = extractDeviceId(req);
    if (!deviceId) return NextResponse.json({ ok: true, skipped: 'no-device' });

    const body = (await req.json().catch(() => ({}))) as { tones?: unknown };
    const tones = Array.isArray(body.tones)
      ? body.tones.filter((t): t is string => typeof t === 'string')
      : [];
    if (tones.length === 0) return NextResponse.json({ ok: true, skipped: 'no-tones' });

    // Collect requested poles per dimension; a dimension with conflicting poles
    // (e.g. both Playful and Serious) is left untouched.
    const polesByDim = new Map<keyof AestheticScoreVector, Set<number>>();
    for (const t of tones) {
      const m = TONE_DIM[t];
      if (!m) continue;
      const set = polesByDim.get(m.dim) ?? new Set<number>();
      set.add(m.pole);
      polesByDim.set(m.dim, set);
    }

    const profile = await getAestheticProfile(userId, deviceId);
    const base: AestheticScoreVector = profile?.centroid ?? { ...NEUTRAL };

    // Target = current centroid, with only unambiguous selected dims pushed to
    // their pole. Untouched dims keep their current value → EMA leaves them be.
    const target: AestheticScoreVector = { ...base };
    let changed = false;
    for (const [dim, poles] of polesByDim) {
      if (poles.size === 1) {
        target[dim] = [...poles][0];
        changed = true;
      }
    }
    if (!changed) return NextResponse.json({ ok: true, skipped: 'conflicting-tones' });

    await applyAestheticEmaUpdate(userId, deviceId, target, AESTHETIC_ALPHA);

    const res = NextResponse.json({ ok: true });
    const setCookie = cookieRes.headers.get('Set-Cookie');
    if (setCookie) res.headers.set('Set-Cookie', setCookie);
    return res;
  } catch (err) {
    console.error('[POST /api/onboarding/tone]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
