import { NextRequest, NextResponse } from 'next/server';
import { resolveSession, extractDeviceId } from '@/lib/auth/session';
import { runPipeline } from '@/lib/pipeline/run';
import {
  checkCooldown,
  recordRefresh,
  acquirePipelineRunLock,
  releasePipelineRunLock,
} from '@/lib/pipeline/cooldown';
import { appendLog } from '@/lib/pipeline/storage';
import { enforceRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';
// Manual refresh runs the full pipeline; same timeout needs as /api/pipeline/run.
export const maxDuration = 300;

// Auth is disabled — use session userId if somehow present, otherwise fall back to solo user.
const SOLO_USER_ID = 'solo';

// SECURITY (DAT-H5): this route is deliberately unauthenticated — the in-app
// refresh button calls it and the app is single-user with auth off (a secret
// here would have to ship to the client). Cost/abuse is bounded by the per-IP
// rate limit below, the persistent per-user cooldown, and the global run lock;
// the cron entry point (/api/pipeline/run) is separately CRON_SECRET-gated.
// Revisit if Tangent goes multi-user (see tracker: Future state).
export async function POST(req: NextRequest) {
  // Defense in depth on top of the per-user cooldown: cap refreshes per IP
  // (each runs the full, expensive pipeline).
  const limited = await enforceRateLimit(req, { name: 'feed:refresh', limit: 10, windowSeconds: 3600 });
  if (limited) return limited;

  const tempRes = new NextResponse();
  const session = await resolveSession(req, tempRes);
  const userId = session?.userId ?? SOLO_USER_ID;

  // Cooldown check — persistent (Postgres) per-user rolling window
  const cooldown = await checkCooldown(userId);
  if (!cooldown.allowed) {
    return NextResponse.json(
      {
        error: 'Refresh cooldown active',
        secondsRemaining: cooldown.secondsRemaining,
      },
      { status: 429 }
    );
  }

  // Global run lock: never let two pipeline runs (refresh × refresh, or
  // refresh × cron) execute concurrently and clobber each other's batch.
  const lock = await acquirePipelineRunLock();
  if (!lock.acquired) {
    return NextResponse.json(
      { error: 'A pipeline run is already in progress' },
      { status: 409 }
    );
  }

  // Read device ID for correct topic weight upsert keying. Use the validating
  // extractDeviceId (UUID-shape check) rather than the raw cookie so a malformed
  // or injected value can't fabricate/probe an identity (SEC-H1 / R2-07).
  const deviceId = extractDeviceId(req);

  appendLog(`[refresh] Manual refresh triggered. userId=${userId}`);

  try {
    const result = await runPipeline({ forceOverwrite: true, userId, deviceId });

    if (result.degraded) {
      // Batch written but every LLM call failed. Don't consume the cooldown so
      // the user can retry once the cause (e.g. API key) is fixed.
      appendLog(
        `[refresh] Degraded refresh. userId=${userId} batchDate=${result.batchDate}`
      );
      return NextResponse.json(
        {
          ok: false,
          degraded: true,
          error: 'LLM enrichment failed for all articles; batch written unranked',
          batchDate: result.batchDate,
          count: result.count,
        },
        { status: 500 }
      );
    }

    // Record cooldown ONLY after success — failed refresh does not consume cooldown
    await recordRefresh(userId);

    appendLog(
      `[refresh] Manual refresh complete. userId=${userId} ` +
        `batchDate=${result.batchDate} count=${result.count}`
    );

    return NextResponse.json({
      ok: true,
      batchDate: result.batchDate,
      count: result.count,
    });
  } catch (err) {
    // Log the detail server-side; don't echo internal error text to the
    // (unauthenticated) caller — matches pipeline/run (SEC-H3 / R2-06).
    const message = err instanceof Error ? err.message : 'Unknown error';
    appendLog(`[refresh] Manual refresh failed. userId=${userId} error=${message}`);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  } finally {
    await releasePipelineRunLock(lock.token);
  }
}
