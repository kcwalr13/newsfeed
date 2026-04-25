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
import { buildIssueMetadata } from '@/lib/pipeline/themeGenerator';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const dateParam = url.searchParams.get('date');
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

  // Return cached metadata if already generated
  const cached = await getIssueMetadata(batch.batchDate);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // Generate on first access
  const issueNumber = await getBatchCount();
  const meta = await buildIssueMetadata(
    batch.articles,
    batch.batchDate,
    issueNumber,
    batch.generatedAt
  );

  // Persist so subsequent requests are instant
  await saveIssueMetadata(batch.batchDate, meta);

  return NextResponse.json(meta, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
