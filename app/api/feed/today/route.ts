import { NextRequest, NextResponse, after } from 'next/server';
import { readBatch, readLatestBatch, patchBatchArticleFields } from '@/lib/pipeline/storage';
import { generateMissingRationales } from '@/lib/pipeline/rationaleGenerator';
import { computeDiscoveryYield } from '@/lib/pipeline/discoveryMeta';
import { resolveDisplayedFeed } from '@/lib/pipeline/displayedFeed';
import type { Article } from '@/lib/types/article';

export const dynamic = 'force-dynamic';

/** Strips internal-only fields before sending an article to the client. Keeps
 *  explorationSlotType + rationale for display; drops bodyText (the reader page
 *  loads the body server-side via findArticleAcrossBatches). */
function toPublicArticle(article: Article) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { discoveryTopic: _dt, llmScore: _ls, extractedConcepts: _ec, serendipityScore: _ss, probeInfo: _pi, bodyText: _bt, ...rest } = article;
  return rest;
}

export async function GET(req: NextRequest) {
  const today = new Date().toISOString().slice(0, 10);
  const batch = (await readBatch(today)) ?? (await readLatestBatch());

  if (!batch) {
    return NextResponse.json(
      { batchDate: '', articles: [] },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // Discovery-yield metadata for the issue (P3-A4) — derived from the persisted
  // per-article discoveryTopic marker; exposed for the dashboard (Workstream D).
  const { discoveryCount, discoverySources } = computeDiscoveryYield(batch.articles);

  // Resolve the displayed order (rank + display-diversity reorder). Shared with
  // /api/issue/meta so the colophon credits + theme reflect the SAME seven (R4-01).
  const { articles: displayArticles, setCookieHeader, ranked } = await resolveDisplayedFeed(req, batch);

  // Generate rationales for newly-slotted exploration articles (no-op if all
  // already set). Exploration slots are assigned by the ranker, so this is only
  // meaningful on a ranked feed; rationale text doesn't affect display order.
  if (ranked) {
    const rationalesGenerated = await generateMissingRationales(displayArticles);
    if (rationalesGenerated > 0) {
      // Persist rationale + explorationSlotType back to the batch after the
      // response is sent. after() keeps the serverless function alive for this
      // work; a bare floating promise would be frozen once the response went out.
      const batchDate = batch.batchDate;
      const patches = new Map(
        displayArticles
          .filter((a) => a.explorationSlotType != null && a.rationale)
          .map((a) => [a.id, { rationale: a.rationale, explorationSlotType: a.explorationSlotType }])
      );
      after(() =>
        patchBatchArticleFields(batchDate, patches).catch((err: unknown) => {
          console.error('[feed/today] rationale patch failed:', err);
        })
      );
    }
  }

  const publicArticles = displayArticles.map(toPublicArticle);

  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (setCookieHeader) headers['Set-Cookie'] = setCookieHeader;

  return NextResponse.json(
    { batchDate: batch.batchDate, articles: publicArticles, generatedAt: batch.generatedAt, discoveryCount, discoverySources },
    { headers }
  );
}
