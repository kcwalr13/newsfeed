import { REFRESH_COOLDOWN_MINUTES } from './config';
import { sql } from '@/lib/db/client';

// Postgres-backed refresh cooldown + pipeline run lock (DAT-H5).
//
// Reuses the rate_limits table (migration 019) so no new schema is needed.
// The previous in-memory Map reset on every cold start, so on Vercel the
// cooldown effectively never applied and concurrent refreshes could each run
// the full pipeline. Like lib/rateLimit.ts, everything here FAILS OPEN on DB
// errors: an infra hiccup degrades to the old (unenforced) behavior rather
// than locking the owner out.

export interface CooldownStatus {
  allowed: boolean;
  secondsRemaining: number;
}

const COOLDOWN_KEY_PREFIX = 'cooldown:refresh:';
const RUN_LOCK_KEY = 'lock:pipeline-run';
/**
 * Lock TTL safety net for a crashed run that never releases. Set ABOVE the
 * pipeline routes' maxDuration (300s) so a still-alive run never has its lock
 * expire out from under it (which would let a second run steal it and write a
 * concurrent batch); a crashed run's lock is still reclaimed shortly after the
 * function would have been killed (R2-03 / R2-19).
 */
const RUN_LOCK_TTL_SECONDS = 360;

/**
 * Random per-acquire owner token, stored in the lock row's `count` column
 * (unused by the lock otherwise, so no schema migration is needed — consistent
 * with DAT-H5's "reuse rate_limits" decision). Release is scoped to this token
 * so a run can only delete the lock it actually holds — a run that crashed,
 * had its lock expire and re-claimed by another run, can no longer delete the
 * new holder's lock (the "stolen then deleted → concurrent writes" cascade).
 * Range [1, 2147483647] fits Postgres INTEGER.
 */
function newRunLockToken(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] % 2147483647) + 1;
}

/** Rolling per-user cooldown check. Allowed when no unexpired cooldown row exists. */
export async function checkCooldown(userId: string): Promise<CooldownStatus> {
  try {
    const rows = await sql`
      SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - NOW()))))::int AS seconds_remaining
      FROM rate_limits
      WHERE bucket_key = ${COOLDOWN_KEY_PREFIX + userId}
        AND expires_at > NOW()
    `;
    if (rows.length === 0) return { allowed: true, secondsRemaining: 0 };
    return {
      allowed: false,
      secondsRemaining: (rows[0] as { seconds_remaining: number }).seconds_remaining,
    };
  } catch {
    return { allowed: true, secondsRemaining: 0 };
  }
}

/** Starts the rolling cooldown window. Call only after a successful refresh. */
export async function recordRefresh(userId: string): Promise<void> {
  try {
    await sql`
      INSERT INTO rate_limits (bucket_key, count, expires_at)
      VALUES (
        ${COOLDOWN_KEY_PREFIX + userId},
        1,
        NOW() + make_interval(mins => ${REFRESH_COOLDOWN_MINUTES})
      )
      ON CONFLICT (bucket_key) DO UPDATE SET expires_at = EXCLUDED.expires_at
    `;
  } catch {
    // fail open
  }
}

/**
 * Atomically claims the global pipeline-run lock. Returns `{ acquired: false }`
 * when another run currently holds it. The conditional ON CONFLICT update only
 * steals the row once its TTL has lapsed, so two concurrent claims can't both
 * succeed, and a crashed holder is reclaimed after RUN_LOCK_TTL_SECONDS. On
 * acquire the row's `count` is set to a fresh random `token`; pass that token
 * to `releasePipelineRunLock` so only the true holder can release the lock.
 */
export async function acquirePipelineRunLock(): Promise<{ acquired: boolean; token: number }> {
  const token = newRunLockToken();
  try {
    const rows = await sql`
      INSERT INTO rate_limits (bucket_key, count, expires_at)
      VALUES (${RUN_LOCK_KEY}, ${token}, NOW() + make_interval(secs => ${RUN_LOCK_TTL_SECONDS}))
      ON CONFLICT (bucket_key) DO UPDATE
        SET expires_at = EXCLUDED.expires_at, count = EXCLUDED.count
        WHERE rate_limits.expires_at <= NOW()
      RETURNING bucket_key
    `;
    return { acquired: rows.length > 0, token };
  } catch {
    return { acquired: true, token }; // fail open
  }
}

/**
 * Releases the pipeline-run lock — but only if `token` matches the one stored
 * at acquire. A run whose lock already expired and was re-claimed by another
 * run will not match, so it can't delete the new holder's lock.
 */
export async function releasePipelineRunLock(token: number): Promise<void> {
  try {
    await sql`DELETE FROM rate_limits WHERE bucket_key = ${RUN_LOCK_KEY} AND count = ${token}`;
  } catch {
    // fail open — the TTL reclaims it
  }
}
