import { NextResponse } from 'next/server';
import { readBatch, readLatestBatch } from '@/lib/pipeline/storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);

  const batch = readBatch(today) ?? readLatestBatch();

  if (!batch) {
    return NextResponse.json(
      { batchDate: '', articles: [] },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json(
    { batchDate: batch.batchDate, articles: batch.articles },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
