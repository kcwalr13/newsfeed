import { NextRequest, NextResponse } from 'next/server';
import { getSessionById, refreshSession } from '@/lib/db/auth';

export const SESSION_COOKIE = 'dd_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  sessionId: string;
  userId: string;
}

/**
 * Reads the dd_session cookie, validates the session in the database,
 * and refreshes its expiry (sliding window). Returns null if no valid session.
 *
 * Side effect: mutates the response to set a refreshed cookie if a valid
 * session is found. Caller must return the response for the cookie to persist.
 */
export async function resolveSession(
  req: NextRequest,
  res: NextResponse
): Promise<SessionPayload | null> {
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const session = await getSessionById(sessionId);
  if (!session) return null;

  const newExpiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  void refreshSession(sessionId, newExpiresAt).catch(console.error);

  res.headers.set('Set-Cookie', buildSessionCookie(sessionId, SESSION_MAX_AGE_SECONDS));

  return { sessionId, userId: session.user_id };
}

/**
 * Builds a Set-Cookie header string for dd_session.
 * Used by login (create) and logout (clear).
 */
export function buildSessionCookie(sessionId: string, maxAge: number): string {
  const base = `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
  return process.env.NODE_ENV === 'production' ? `${base}; Secure` : base;
}

/**
 * Returns a cookie string that clears dd_session.
 */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * Reads the device ID from the dd_device_id cookie, falling back to the
 * X-Device-ID request header. Returns null if neither is present.
 */
export function extractDeviceId(req: NextRequest): string | null {
  return req.cookies.get('dd_device_id')?.value ?? req.headers.get('X-Device-ID') ?? null;
}
