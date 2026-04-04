import { NextRequest, NextResponse } from 'next/server';
import { resolveSession } from '@/lib/auth/session';
import { runPipeline } from '@/lib/pipeline/run';
import { checkCooldown, recordRefresh } from '@/lib/pipeline/cooldown';
import { appendLog } from '@/lib/pipeline/storage';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Auth check — must have a valid session
  const tempRes = new NextResponse();
  const session = await resolveSession(req, tempRes);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Cooldown check — enforce per-user window
  const cooldown = checkCooldown(session.userId);
  if (!cooldown.allowed) {
    return NextResponse.json(
      {
        error: 'Refresh cooldown active',
        secondsRemaining: cooldown.secondsRemaining,
      },
      { status: 429 }
    );
  }

  // Log the manual refresh attempt
  appendLog(`[refresh] Manual refresh triggered. userId=${session.userId}`);

  // Run the full pipeline with overwrite enabled
  try {
    const result = await runPipeline({ forceOverwrite: true });

    // Record cooldown ONLY after success — failed refresh does not consume cooldown
    recordRefresh(session.userId);

    appendLog(
      `[refresh] Manual refresh complete. userId=${session.userId} ` +
        `batchDate=${result.batchDate} count=${result.count}`
    );

    return NextResponse.json({
      ok: true,
      batchDate: result.batchDate,
      count: result.count,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    appendLog(
      `[refresh] Manual refresh failed. userId=${session.userId} error=${message}`
    );
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
