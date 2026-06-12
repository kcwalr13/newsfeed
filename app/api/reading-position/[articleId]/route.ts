/**
 * GET /api/reading-position/[articleId]
 *
 * Returns the stored reading position for the requesting device + article.
 * Returns 404 if no position has been saved.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getReadingPosition } from '@/lib/db/readingPositions';
import { extractDeviceId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ articleId: string }> }
) {
  const deviceId = extractDeviceId(req);
  if (!deviceId) {
    return NextResponse.json({ error: 'no_device' }, { status: 400 });
  }

  const { articleId } = await params;

  try {
    const pos = await getReadingPosition(deviceId, articleId);
    if (!pos) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json(pos);
  } catch (err) {
    console.error('[reading-position/get] failed:', err);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
}
