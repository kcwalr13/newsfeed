import { NextRequest, NextResponse } from 'next/server';
import { getFeedbackForDevice, getFeedbackForUser, upsertFeedback } from '@/lib/db/feedback';
import { resolveSession, buildSessionCookie, extractDeviceId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

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
