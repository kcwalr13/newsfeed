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
import { MAX_DWELL_SECONDS, MAX_PARAGRAPH_INDEX } from '@/lib/config/aesthetic';

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

  if (!articleId || typeof articleId !== 'string' || typeof paragraphIndex !== 'number') {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }
  // NaN/Infinity/floats/negatives would otherwise reach the DB cast and 500
  if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0) {
    return NextResponse.json({ error: 'invalid_paragraph_index' }, { status: 400 });
  }
  if (typeof dwellSeconds !== 'number' || !Number.isFinite(dwellSeconds) || dwellSeconds < 0) {
    return NextResponse.json({ error: 'invalid_dwell_seconds' }, { status: 400 });
  }
  if (
    finishedAt != null &&
    (typeof finishedAt !== 'string' || Number.isNaN(Date.parse(finishedAt)))
  ) {
    return NextResponse.json({ error: 'invalid_finished_at' }, { status: 400 });
  }

  // Clamp to column ceilings so an extreme (stuck-timer or forged) value can't
  // overflow the INTEGER columns → 500 (R2-09). Lower bounds already validated.
  const clampedParagraphIndex = Math.min(paragraphIndex, MAX_PARAGRAPH_INDEX);
  const clampedDwell = Math.min(Math.floor(dwellSeconds), MAX_DWELL_SECONDS);

  try {
    await upsertReadingPosition(
      deviceId,
      articleId,
      clampedParagraphIndex,
      clampedDwell,
      finishedAt
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[reading-position] upsert failed:', err);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
}
