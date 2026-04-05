import { NextRequest, NextResponse } from 'next/server';
import { getUserById } from '@/lib/db/auth';
import { resolveSession, buildSessionCookie, SESSION_MAX_AGE_SECONDS } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cookieRes = new NextResponse();
  const session = await resolveSession(req, cookieRes);
  if (!session) return NextResponse.json({}, { status: 401 });

  try {
    const user = await getUserById(session.userId);
    if (!user) return NextResponse.json({}, { status: 401 });

    const finalRes = NextResponse.json({ userId: user.user_id, email: user.email });
    finalRes.headers.set(
      'Set-Cookie',
      buildSessionCookie(session.sessionId, SESSION_MAX_AGE_SECONDS)
    );
    return finalRes;
  } catch (err) {
    console.error('[GET /api/auth/me]', err);
    return NextResponse.json({}, { status: 401 });
  }
}
