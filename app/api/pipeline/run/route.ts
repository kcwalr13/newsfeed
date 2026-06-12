import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { runPipeline } from '@/lib/pipeline/run';

export const dynamic = 'force-dynamic';
// Full pipeline run (fetch + discovery + LLM scoring) needs far more than the
// default 10-15s function timeout; without this the function is killed mid-run
// and no batch is written.
export const maxDuration = 300;

function authorize(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const provided = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${cronSecret}`;
  // Constant-time comparison to avoid leaking the secret via response timing.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function handleRun() {
  try {
    const result = await runPipeline();

    if (result.alreadyExists) {
      return NextResponse.json(
        { ok: false, error: 'Batch already exists for today', batchDate: result.batchDate },
        { status: 409 }
      );
    }

    if (result.degraded) {
      // Batch was written but every LLM call failed — fail the response so the
      // cron's failure alerting surfaces it instead of reporting success.
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

    return NextResponse.json({ ok: true, batchDate: result.batchDate, count: result.count });
  } catch (err) {
    // Log the detail server-side; don't echo internal error text to callers.
    console.error('[pipeline/run] run failed:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return handleRun();
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return handleRun();
}
