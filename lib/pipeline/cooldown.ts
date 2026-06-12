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
/** Mirrors the pipeline routes' maxDuration so a crashed run can't hold the lock forever. */
const RUN_LOCK_TTL_SECONDS = 300;

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
 * Atomically claims the global pipeline-run lock; returns false when another
 * run currently holds it. The conditional ON CONFLICT update only steals the
 * row once its TTL has lapsed, so two concurrent claims can't both succeed,
 * and a crashed holder is reclaimed after RUN_LOCK_TTL_SECONDS.
 */
export async function acquirePipelineRunLock(): Promise<boolean> {
  try {
    const rows = await sql`
      INSERT INTO rate_limits (bucket_key, count, expires_at)
      VALUES (${RUN_LOCK_KEY}, 1, NOW() + make_interval(secs => ${RUN_LOCK_TTL_SECONDS}))
      ON CONFLICT (bucket_key) DO UPDATE
        SET expires_at = EXCLUDED.expires_at
        WHERE rate_limits.expires_at <= NOW()
      RETURNING bucket_key
    `;
    return rows.length > 0;
  } catch {
    return true; // fail open
  }
}

/** Releases the pipeline-run lock. Only call from the holder that acquired it. */
export async function releasePipelineRunLock(): Promise<void> {
  try {
    await sql`DELETE FROM rate_limits WHERE bucket_key = ${RUN_LOCK_KEY}`;
  } catch {
    // fail open — the TTL reclaims it
  }
}
