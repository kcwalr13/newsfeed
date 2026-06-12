// Postgres-backed fixed-window rate limiter (SEC-H2).
//
// Reuses the Neon database rather than adding an external dependency (e.g.
// Upstash) so there are no new credentials to provision for a single-user app.
// FAILS OPEN: any DB error — including the rate_limits table not yet existing
// (migration 019 not applied) — allows the request, so this is deploy-safe
// before the migration lands. It never blocks legitimate traffic on infra error.

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db/client';

export interface RateLimitRule {
  /** Stable name for this limiter (e.g. 'auth:login'). */
  name: string;
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window resets (only meaningful when blocked). */
  retryAfter: number;
}

/**
 * Records a hit against `name:identity` and reports whether it is within the
 * limit. Fails open on any error.
 */
export async function checkRateLimit(
  rule: RateLimitRule,
  identity: string
): Promise<RateLimitResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSec / rule.windowSeconds);
  const bucketKey = `${rule.name}:${identity}:${bucket}`;
  const resetSec = (bucket + 1) * rule.windowSeconds;
  const expiresAt = new Date(resetSec * 1000).toISOString();

  try {
    const rows = await sql`
      INSERT INTO rate_limits (bucket_key, count, expires_at)
      VALUES (${bucketKey}, 1, ${expiresAt})
      ON CONFLICT (bucket_key)
      DO UPDATE SET count = rate_limits.count + 1
      RETURNING count
    `;
    const count = (rows[0] as { count: number }).count;
    if (count <= rule.limit) {
      return { allowed: true, retryAfter: 0 };
    }
    return { allowed: false, retryAfter: Math.max(1, resetSec - nowSec) };
  } catch {
    // Fail open — never block on infra error or a missing table (pre-migration).
    return { allowed: true, retryAfter: 0 };
  }
}

/**
 * Convenience wrapper for route handlers: enforces `rule` keyed by client IP
 * (optionally namespaced by an extra identity such as a device id). Returns a
 * 429 NextResponse when blocked, or null when the request may proceed.
 */
export async function enforceRateLimit(
  req: NextRequest,
  rule: RateLimitRule,
  extraIdentity?: string
): Promise<NextResponse | null> {
  const identity = extraIdentity ? `${clientIp(req)}:${extraIdentity}` : clientIp(req);
  const result = await checkRateLimit(rule, identity);
  if (result.allowed) return null;
  return NextResponse.json(
    { error: 'Too many requests. Please slow down.' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfter) } }
  );
}
