import { NextRequest, NextResponse } from 'next/server';
import { migrateFeedbackRecords } from '@/lib/db/feedback';
import { extractDeviceId } from '@/lib/auth/session';
import { enforceRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const deviceId = extractDeviceId(req);
  if (!deviceId) {
    return NextResponse.json({ error: 'Device ID required' }, { status: 400 });
  }

  // No session gate is possible while auth is off; the route is device-scoped
  // (it can only write to the caller's own device id). Rate-limit per IP+device
  // to bound abuse (SEC-H3). The one-time localStorage→DB migration runs at most
  // a handful of times per device.
  const limited = await enforceRateLimit(
    req,
    { name: 'feedback:migrate', limit: 10, windowSeconds: 3600 },
    deviceId
  );
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { records } = body as Record<string, unknown>;

  if (!Array.isArray(records)) {
    return NextResponse.json({ error: 'records must be an array' }, { status: 400 });
  }

  for (let i = 0; i < records.length; i++) {
    const r = records[i] as Record<string, unknown>;
    if (
      !r.articleId ||
      typeof r.articleId !== 'string' ||
      (r.value !== 'like' && r.value !== 'dislike' && r.value !== 'save') ||
      !r.updatedAt ||
      typeof r.updatedAt !== 'string'
    ) {
      return NextResponse.json({ error: `Invalid record at index ${i}` }, { status: 400 });
    }
  }

  try {
    const written = await migrateFeedbackRecords(
      deviceId,
      records as Array<{ articleId: string; value: 'like' | 'dislike' | 'save'; updatedAt: string }>
    );
    return NextResponse.json({ ok: true, written });
  } catch (err) {
    console.error('[POST /api/feedback/migrate]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
