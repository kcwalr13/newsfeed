/**
 * GET /api/metrics
 *
 * Returns the Tangent product-metrics snapshot (P3-D2): discovery share,
 * distinct sources/week, category distribution, exploration acceptance, and
 * taste-model maturity. Computed on the fly (P3-D1) — cheap projected SQL, no
 * snapshot table. Scoped to the resolved single-user identity (session userId
 * if present, else the device id) — the same "solo gate" the feed uses.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveSession, extractDeviceId } from '@/lib/auth/session';
import { computeMetrics } from '@/lib/db/metrics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Temp response so resolveSession can attach a refreshed Set-Cookie header.
  const tempRes = new NextResponse();
  try {
    const session = await resolveSession(req, tempRes);
    const userId = session?.userId ?? null;
    const deviceId = extractDeviceId(req);

    const metrics = await computeMetrics(userId, deviceId);

    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    const setCookie = tempRes.headers.get('Set-Cookie');
    if (setCookie) headers['Set-Cookie'] = setCookie;

    return NextResponse.json(
      { ...metrics, generatedAt: new Date().toISOString() },
      { headers }
    );
  } catch (err) {
    console.error('[GET /api/metrics]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
