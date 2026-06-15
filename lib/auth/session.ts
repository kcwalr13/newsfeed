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

// Device IDs are crypto.randomUUID() (UUID v4) generated client-side.
const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the device ID from the dd_device_id cookie, falling back to the
 * X-Device-ID request header. Returns null if neither is present or the value
 * is not a well-formed UUID.
 *
 * SECURITY (SEC-H1): the device ID is CLIENT-SUPPLIED and is NOT an
 * authentication/authorization boundary — a caller can present any value.
 * It is used only to namespace anonymous (logged-out) data. When a real
 * session exists, callers must prefer `resolveSession().userId` as the
 * authoritative identity and treat the device ID as a secondary key only.
 * Validating the UUID shape here bounds the key space so arbitrary strings
 * can't be used to fabricate or probe identities.
 */
export function extractDeviceId(req: NextRequest): string | null {
  const raw = req.cookies.get('dd_device_id')?.value ?? req.headers.get('X-Device-ID') ?? null;
  return isValidDeviceId(raw) ? raw : null;
}

/**
 * True when `raw` is a well-formed device id (UUID shape). Exported so surfaces
 * that read the cookie directly (e.g. the /dashboard server component) validate
 * it with the SAME check `extractDeviceId` uses, instead of a divergent local
 * regex (R4-11). Same caveat as above: this is a namespacing key, not auth.
 */
export function isValidDeviceId(raw: string | null | undefined): raw is string {
  return !!raw && DEVICE_ID_RE.test(raw);
}
