import { NextRequest, NextResponse } from 'next/server';
import { migrateFeedbackRecords } from '@/lib/db/feedback';
import { extractDeviceId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

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

  const { records } = body as Record<string, unknown>;

  if (!Array.isArray(records)) {
    return NextResponse.json({ error: 'records must be an array' }, { status: 400 });
  }

  for (let i = 0; i < records.length; i++) {
    const r = records[i] as Record<string, unknown>;
    if (
      !r.articleId ||
      typeof r.articleId !== 'string' ||
      (r.value !== 'like' && r.value !== 'dislike') ||
      !r.updatedAt ||
      typeof r.updatedAt !== 'string'
    ) {
      return NextResponse.json({ error: `Invalid record at index ${i}` }, { status: 400 });
    }
  }

  try {
    const written = await migrateFeedbackRecords(
      deviceId,
      records as Array<{ articleId: string; value: 'like' | 'dislike'; updatedAt: string }>
    );
    return NextResponse.json({ ok: true, written });
  } catch (err) {
    console.error('[POST /api/feedback/migrate]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
