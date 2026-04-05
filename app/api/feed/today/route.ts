import { NextRequest, NextResponse } from 'next/server';
import { readBatch, readLatestBatch } from '@/lib/pipeline/storage';
import { resolveSession } from '@/lib/auth/session';
import { getFeedbackForUser, getFeedbackForDevice } from '@/lib/db/feedback';
import type { DbFeedbackRow } from '@/lib/db/feedback';
import { rankFeed } from '@/lib/pipeline/ranker';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const today = new Date().toISOString().slice(0, 10);
  const batch = readBatch(today) ?? readLatestBatch();

  if (!batch) {
    return NextResponse.json(
      { batchDate: '', articles: [] },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // Create a temporary response object so resolveSession can attach a
  // refreshed Set-Cookie header to it. We will copy that header to the
  // final response.
  const tempRes = new NextResponse();
  let feedbackRows: DbFeedbackRow[] = [];
  let setCookieHeader: string | null = null;

  try {
    const session = await resolveSession(req, tempRes);
    setCookieHeader = tempRes.headers.get('Set-Cookie');

    if (session) {
      feedbackRows = await getFeedbackForUser(session.userId);
    } else {
      const deviceId = req.cookies.get('dd_device_id')?.value;
      if (deviceId) {
        feedbackRows = await getFeedbackForDevice(deviceId);
      }
    }
  } catch (err) {
    console.error('[feed/today] identity/feedback fetch failed, returning unranked:', err);
    const publicBatchArticles = batch.articles.map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ({ discoveryTopic: _dt, ...rest }) => rest
    );
    return NextResponse.json(
      { batchDate: batch.batchDate, articles: publicBatchArticles, generatedAt: batch.generatedAt },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const rankedArticles = rankFeed(batch.articles, feedbackRows);

  const publicArticles = rankedArticles.map(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ({ discoveryTopic: _dt, ...rest }) => rest
  );

  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (setCookieHeader) headers['Set-Cookie'] = setCookieHeader;

  return NextResponse.json(
    { batchDate: batch.batchDate, articles: publicArticles, generatedAt: batch.generatedAt },
    { headers }
  );
}
