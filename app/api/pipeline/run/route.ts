import { NextRequest, NextResponse } from 'next/server';
import { runPipeline } from '@/lib/pipeline/run';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
