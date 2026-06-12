import { NextRequest, NextResponse } from 'next/server';
import { resolveSession } from '@/lib/auth/session';
import { runPipeline } from '@/lib/pipeline/run';
import { checkCooldown, recordRefresh } from '@/lib/pipeline/cooldown';
import { appendLog } from '@/lib/pipeline/storage';

export const dynamic = 'force-dynamic';
// Manual refresh runs the full pipeline; same timeout needs as /api/pipeline/run.
export const maxDuration = 300;

// Auth is disabled — use session userId if somehow present, otherwise fall back to solo user.
const SOLO_USER_ID = 'solo';

export async function POST(req: NextRequest) {
  const tempRes = new NextResponse();
  const session = await resolveSession(req, tempRes);
  const userId = session?.userId ?? SOLO_USER_ID;

  // Cooldown check — enforce per-user window
  const cooldown = checkCooldown(userId);
  if (!cooldown.allowed) {
    return NextResponse.json(
      {
        error: 'Refresh cooldown active',
        secondsRemaining: cooldown.secondsRemaining,
      },
      { status: 429 }
    );
  }

  // Read device ID for correct topic weight upsert keying
  const deviceId = req.cookies.get('dd_device_id')?.value ?? null;

  appendLog(`[refresh] Manual refresh triggered. userId=${userId}`);

  try {
    const result = await runPipeline({ forceOverwrite: true, userId, deviceId });

    // Record cooldown ONLY after success — failed refresh does not consume cooldown
    recordRefresh(userId);

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
    const message = err instanceof Error ? err.message : 'Unknown error';
    appendLog(`[refresh] Manual refresh failed. userId=${userId} error=${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
