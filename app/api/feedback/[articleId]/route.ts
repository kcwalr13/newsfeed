import { NextRequest, NextResponse } from 'next/server';
import { deleteFeedback } from '@/lib/db/feedback';
import { resolveSession, extractDeviceId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ articleId: string }> }
): Promise<NextResponse> {
  const { articleId } = await params;
  const deviceId = extractDeviceId(req);

  if (!deviceId) {
    return NextResponse.json({ error: 'Device ID required' }, { status: 400 });
  }

  // Resolve session to refresh sliding window (userId not used for delete)
  const cookieRes = new NextResponse();
  await resolveSession(req, cookieRes);

  try {
    await deleteFeedback(deviceId, articleId);
    const finalRes = NextResponse.json({ ok: true });
    const setCookie = cookieRes.headers.get('Set-Cookie');
    if (setCookie) finalRes.headers.set('Set-Cookie', setCookie);
    return finalRes;
  } catch (err) {
    console.error('[DELETE /api/feedback]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
