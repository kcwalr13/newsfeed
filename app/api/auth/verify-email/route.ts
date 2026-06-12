import { NextRequest, NextResponse } from 'next/server';
import { getToken, setEmailVerified, deleteToken } from '@/lib/db/auth';
import { enforceRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limited = await enforceRateLimit(req, { name: 'auth:verify-email', limit: 30, windowSeconds: 300 });
  if (limited) return limited;

  const token = req.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Verification token is required.' }, { status: 400 });
  }

  try {
    const dbToken = await getToken(token, 'email_verification');
    if (!dbToken) {
      return NextResponse.json(
        {
          error: 'Verification link is invalid or has expired.',
          resendPath: '/api/auth/resend-verification',
        },
        { status: 400 }
      );
    }

    await setEmailVerified(dbToken.user_id);
    await deleteToken(token);

    return NextResponse.redirect(new URL('/auth?verified=1', req.url));
  } catch (err) {
    console.error('[GET /api/auth/verify-email]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
