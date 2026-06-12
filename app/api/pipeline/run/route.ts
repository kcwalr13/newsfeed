import { NextRequest, NextResponse } from 'next/server';
import { runPipeline } from '@/lib/pipeline/run';

export const dynamic = 'force-dynamic';
// Full pipeline run (fetch + discovery + LLM scoring) needs far more than the
// default 10-15s function timeout; without this the function is killed mid-run
// and no batch is written.
export const maxDuration = 300;

function authorize(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  return !!cronSecret && authHeader === `Bearer ${cronSecret}`;
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

    return NextResponse.json({ ok: true, batchDate: result.batchDate, count: result.count });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
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
