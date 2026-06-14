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

/**
 * Best-effort client IP from proxy headers, hardened against X-Forwarded-For
 * spoofing (R2-08). The LEFT-most XFF token is whatever the client sent and is
 * trivially forgeable (`X-Forwarded-For: 1.2.3.4, <real ip>`), so a limiter
 * keyed off it can be bypassed by rotating that value. We therefore:
 *   1. Prefer `x-vercel-forwarded-for` — set by Vercel's edge from the real TCP
 *      peer and not overridable by the client.
 *   2. Else take the RIGHT-most `x-forwarded-for` entry — the one appended by
 *      the trusted proxy nearest us, which the client cannot control.
 *   3. Else `x-real-ip`, else null (no identifiable client IP).
 */
export function clientIp(req: NextRequest): string | null {
  const vercel = req.headers.get('x-vercel-forwarded-for');
  if (vercel) {
    const first = vercel.split(',')[0]?.trim();
    if (first) return first;
  }
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return req.headers.get('x-real-ip') ?? null;
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
  const ip = clientIp(req);
  // No identifiable client IP (local dev, or a proxy that strips forwarding
  // headers): without an extra identity every caller would collapse into one
  // shared bucket and limit each other. Fail open there instead, consistent
  // with the limiter's fail-open stance (R2-22). When an extraIdentity (e.g. a
  // device id) is present it still differentiates callers, so keep limiting.
  if (ip === null && !extraIdentity) return null;
  const base = ip ?? 'unknown';
  const identity = extraIdentity ? `${base}:${extraIdentity}` : base;
  const result = await checkRateLimit(rule, identity);
  if (result.allowed) return null;
  return NextResponse.json(
    { error: 'Too many requests. Please slow down.' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfter) } }
  );
}
