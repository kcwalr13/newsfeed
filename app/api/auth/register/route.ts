import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getUserByEmail, createUser } from '@/lib/db/auth';
import { createToken } from '@/lib/db/auth';
import { sendVerificationEmail } from '@/lib/email/send';
import { enforceRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const limited = await enforceRateLimit(req, { name: 'auth:register', limit: 5, windowSeconds: 900 });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { email, password } = body as Record<string, unknown>;

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }
  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Password is required.' }, { status: 400 });
  }
  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const existing = await getUserByEmail(normalizedEmail);
    if (existing) {
      // Anti-enumeration: same response whether address exists or not
      return NextResponse.json(
        { message: 'If this address is new, a verification email has been sent.' },
        { status: 201 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = crypto.randomUUID();
    await createUser(userId, normalizedEmail, hashedPassword);

    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await createToken(token, userId, 'email_verification', expiresAt);

    sendVerificationEmail(normalizedEmail, token).catch(console.error);

    return NextResponse.json(
      { message: 'Verification email sent. Please check your inbox.' },
      { status: 201 }
    );
  } catch (err) {
    console.error('[POST /api/auth/register]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
