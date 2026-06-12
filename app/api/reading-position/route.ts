/**
 * POST /api/reading-position
 *
 * Body: { articleId: string; paragraphIndex: number; dwellSeconds: number; finishedAt?: string }
 *
 * Upserts the reading position for the requesting device.
 * Requires dd_device_id cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { upsertReadingPosition } from '@/lib/db/readingPositions';
import { extractDeviceId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

interface PositionBody {
  articleId:      string;
  paragraphIndex: number;
  dwellSeconds?:  number;
  finishedAt?:    string | null;
}

export async function POST(req: NextRequest) {
  const deviceId = extractDeviceId(req);
  if (!deviceId) {
    return NextResponse.json({ error: 'no_device' }, { status: 400 });
  }

  let body: PositionBody;
  try {
    body = (await req.json()) as PositionBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { articleId, paragraphIndex, dwellSeconds = 0, finishedAt } = body;

  if (!articleId || typeof paragraphIndex !== 'number') {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }

  try {
    await upsertReadingPosition(deviceId, articleId, paragraphIndex, dwellSeconds, finishedAt);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[reading-position] upsert failed:', err);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
}
