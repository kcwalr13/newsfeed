import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getToken, updatePassword, deleteToken, deleteAllSessionsForUser } from '@/lib/db/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { token, new_password } = body as Record<string, unknown>;

  if (!token || typeof token !== 'string' || !new_password || typeof new_password !== 'string') {
    return NextResponse.json({ error: 'Token and new password are required.' }, { status: 400 });
  }
  if (new_password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  try {
    const dbToken = await getToken(token, 'password_reset');
    if (!dbToken) {
      return NextResponse.json(
        { error: 'Reset link is invalid or has expired.' },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(new_password, 12);
    await updatePassword(dbToken.user_id, hashedPassword);
    await deleteToken(token);
    await deleteAllSessionsForUser(dbToken.user_id);

    return NextResponse.json({ message: 'Password updated. Please log in with your new password.' });
  } catch (err) {
    console.error('[POST /api/auth/reset-password]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
