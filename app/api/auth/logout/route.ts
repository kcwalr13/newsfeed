import { NextRequest, NextResponse } from 'next/server';
import { deleteSession } from '@/lib/db/auth';
import { SESSION_COOKIE, clearSessionCookie } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    deleteSession(sessionId).catch(console.error);
  }

  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', clearSessionCookie());
  return res;
}
