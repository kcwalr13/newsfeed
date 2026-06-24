import { NextResponse } from 'next/server';
import { sql } from '@/lib/db/client';
import type { ContentType, ContentFormat } from '@/lib/types/article';

export const dynamic = 'force-dynamic';

interface BatchSummaryArticle {
  id: string;
  title: string;
  sourceName: string;
  description?: string;
  imageUrl?: string;
  publishedAt: string;
  readTime?: number;
  /** Destination URL — the shelf links a saved LINK-OUT gem straight out (R7-2). */
  articleUrl?: string;
  /** R7-2 item type + R5 format, so the shelf can detect a link-out item. */
  contentType?: ContentType;
  format?: ContentFormat;
}

export interface BatchSummary {
  batchDate: string;
  generatedAt: string;
  articles: BatchSummaryArticle[];
}

/**
 * Returns a list of all stored batch summaries (newest first).
 * Articles contain only the fields needed for archive display.
 */
export async function GET() {
  try {
    const rows = await sql`
      SELECT batch_date, generated_at::text AS generated_at, articles
      FROM article_batches
      ORDER BY batch_date DESC
      LIMIT 30
    ` as Array<{ batch_date: string; generated_at: string; articles: unknown }>;

    const summaries: BatchSummary[] = rows.map((row) => {
      const articles = (row.articles as Array<Record<string, unknown>>).map((a) => ({
        id:          String(a.id ?? ''),
        title:       String(a.title ?? ''),
        sourceName:  String(a.sourceName ?? ''),
        description: a.description ? String(a.description) : undefined,
        imageUrl:    a.imageUrl    ? String(a.imageUrl)    : undefined,
        publishedAt: String(a.publishedAt ?? ''),
        readTime:    typeof a.readTime === 'number' ? a.readTime : undefined,
        articleUrl:  a.articleUrl  ? String(a.articleUrl)  : undefined,
        contentType: typeof a.contentType === 'string' ? (a.contentType as ContentType) : undefined,
        format:      typeof a.format === 'string' ? (a.format as ContentFormat) : undefined,
      }));

      return {
        batchDate:   row.batch_date,
        generatedAt: row.generated_at,
        articles,
      };
    });

    return NextResponse.json(summaries, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[archive] failed to load batches:', err);
    return NextResponse.json([], { status: 500 });
  }
}
