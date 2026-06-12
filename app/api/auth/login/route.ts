import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getUserByEmail, createSession } from '@/lib/db/auth';
import { buildSessionCookie, extractDeviceId, SESSION_MAX_AGE_SECONDS } from '@/lib/auth/session';
import { associateFeedbackToUser } from '@/lib/db/feedback';
import { enforceRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const limited = await enforceRateLimit(req, { name: 'auth:login', limit: 20, windowSeconds: 300 });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { email, password } = body as Record<string, unknown>;
  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const user = await getUserByEmail(normalizedEmail);
    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    const passwordMatch = await bcrypt.compare(password, user.hashed_password);
    if (!passwordMatch) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    if (!user.email_verified_at) {
      return NextResponse.json(
        { error: 'Please verify your email address before logging in. Check your inbox.' },
        { status: 403 }
      );
    }

    const sessionId = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
    await createSession(sessionId, user.user_id, expiresAt);

    // Migrate device feedback to user account
    const deviceId = extractDeviceId(req);
    if (deviceId) {
      await associateFeedbackToUser(deviceId, user.user_id);
    }

    const res = NextResponse.json({ userId: user.user_id, email: user.email });
    res.headers.set('Set-Cookie', buildSessionCookie(sessionId, SESSION_MAX_AGE_SECONDS));
    return res;
  } catch (err) {
    console.error('[POST /api/auth/login]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
