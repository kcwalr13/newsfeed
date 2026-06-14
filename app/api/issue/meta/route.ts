/**
 * GET /api/issue/meta
 *
 * Returns the DailyIssue metadata object for today's batch.
 * Generates and persists it on first access (lazy, cached in DB).
 *
 * Query param: ?date=YYYY-MM-DD (defaults to today)
 */

import { NextRequest, NextResponse } from 'next/server';
import { readBatch, readLatestBatch } from '@/lib/pipeline/storage';
import { getIssueMetadata, saveIssueMetadata, getBatchCount } from '@/lib/db/issueMeta';
import { buildIssueMetadata, ISSUE_META_VERSION } from '@/lib/pipeline/themeGenerator';
import { resolveDisplayedFeed } from '@/lib/pipeline/displayedFeed';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date');
    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json(
        { error: 'invalid_date' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    const today = new Date().toISOString().slice(0, 10);
    const targetDate = dateParam ?? today;

    const batch = targetDate === today
      ? ((await readBatch(today)) ?? (await readLatestBatch()))
      : await readBatch(targetDate);

    if (!batch) {
      return NextResponse.json(
        { error: 'no_batch' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Return cached metadata if already generated for the CURRENT derivation
    // version. Metadata cached before R4-01 (raw batch order, metaVersion unset
    // or < current) is treated as a miss and regenerated once so the colophon
    // credits + theme match the displayed seven.
    const cached = await getIssueMetadata(batch.batchDate);
    if (cached && (cached.metaVersion ?? 0) >= ISSUE_META_VERSION) {
      return NextResponse.json(cached, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    // Generate from the SAME displayed order the feed route serves (R4-01):
    // rank + display-diversity reorder, resolved via the shared helper.
    const issueNumber = await getBatchCount();
    const { articles: displayed, setCookieHeader } = await resolveDisplayedFeed(req, batch);
    const meta = await buildIssueMetadata(
      displayed,
      batch.batchDate,
      issueNumber,
      batch.generatedAt
    );

    // Persist so subsequent requests are instant
    await saveIssueMetadata(batch.batchDate, meta);

    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    if (setCookieHeader) headers['Set-Cookie'] = setCookieHeader;
    return NextResponse.json(meta, { headers });
  } catch (err) {
    console.error('[GET /api/issue/meta]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
