import { NextRequest, NextResponse } from 'next/server';
import { getUserByEmail, deleteTokensForUser, createToken } from '@/lib/db/auth';
import { sendVerificationEmail } from '@/lib/email/send';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { email } = body as Record<string, unknown>;
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Always return the same response (anti-enumeration)
  const ok = NextResponse.json(
    { message: 'If that email is unverified, a new link has been sent.' },
    { status: 200 }
  );

  try {
    const user = await getUserByEmail(normalizedEmail);
    if (!user || user.email_verified_at !== null) return ok;

    await deleteTokensForUser(user.user_id, 'email_verification');

    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await createToken(token, user.user_id, 'email_verification', expiresAt);

    sendVerificationEmail(normalizedEmail, token).catch(console.error);
  } catch (err) {
    console.error('[POST /api/auth/resend-verification]', err);
  }

  return ok;
}
