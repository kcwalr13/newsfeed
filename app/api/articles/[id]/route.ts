import { NextRequest, NextResponse } from 'next/server';
import { findArticleAcrossBatches } from '@/lib/pipeline/storage';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const found = await findArticleAcrossBatches(id);

  if (!found) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  }
  const article = found.article;

  // Denylist: strip internal-only fields before sending to the client. Unlike
  // toPublicArticle in /api/feed/today this route KEEPS bodyText (the reader
  // loads the body here). discoverySource is stripped (R7-1): @internal
  // provenance telemetry, never sent to the client.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { discoveryTopic: _dt, llmScore: _ls, extractedConcepts: _ec, serendipityScore: _ss, probeInfo: _pi, discoverySource: _ds, ...publicArticle } = article;
  return NextResponse.json(publicArticle);
}
