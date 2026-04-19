import { NextRequest, NextResponse } from 'next/server';
import { readBatch, readLatestBatch } from '@/lib/pipeline/storage';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const today = new Date().toISOString().slice(0, 10);
  const batch = readBatch(today) ?? readLatestBatch();

  if (!batch) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  }

  const article = batch.articles.find((a) => a.id === id);
  if (!article) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { discoveryTopic: _dt, llmScore: _ls, extractedConcepts: _ec,
          serendipityScore: _ss, explorationSlotType: _est, probeInfo: _pi, ...publicArticle } = article;
  return NextResponse.json(publicArticle);
}
