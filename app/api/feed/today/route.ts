import { NextRequest, NextResponse, after } from 'next/server';
import { readBatch, readLatestBatch, patchBatchArticleFields } from '@/lib/pipeline/storage';
import { generateMissingRationales } from '@/lib/pipeline/rationaleGenerator';
import { generateMissingCuratorNotes } from '@/lib/pipeline/curatorNoteGenerator';
import { computeDiscoveryYield } from '@/lib/pipeline/discoveryMeta';
import { resolveDisplayedFeed } from '@/lib/pipeline/displayedFeed';
import { ISSUE_DISPLAY_SIZE } from '@/lib/config/feed';
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
  const { articles: displayArticles, setCookieHeader, ranked, taste } = await resolveDisplayedFeed(req, batch);

  // The displayed issue is the first ISSUE_DISPLAY_SIZE pieces; bound the
  // per-issue LLM work (rationales + curator notes) to those.
  const shown = displayArticles.slice(0, ISSUE_DISPLAY_SIZE);

  // Personalized curator note for every displayed piece (R5-C): replaces the raw
  // RSS summary as the blurb. No-op for pieces already noted (cache hit), so
  // subsequent loads don't re-call the LLM. Generated from the taste model
  // resolveDisplayedFeed already returned (no re-query). The note doesn't affect
  // display order, so this runs regardless of `ranked` (cold-start → general
  // invitation). Persisted below alongside any rationales.
  const notesGenerated = await generateMissingCuratorNotes(shown, taste);

  // Generate rationales for newly-slotted exploration articles (no-op if all
  // already set). Exploration slots are assigned by the ranker, so this is only
  // meaningful on a ranked feed; rationale text doesn't affect display order.
  let rationalesGenerated = 0;
  if (ranked) {
    rationalesGenerated = await generateMissingRationales(shown);
  }

  // Persist any newly-generated note / rationale fields back to the batch after
  // the response is sent. after() keeps the serverless function alive for this
  // work; a bare floating promise would be frozen once the response went out.
  if (notesGenerated > 0 || rationalesGenerated > 0) {
    const batchDate = batch.batchDate;
    const patches = new Map<string, Partial<Article>>();
    for (const a of shown) {
      const patch: Partial<Article> = {};
      if (a.curatorNote) patch.curatorNote = a.curatorNote;
      if (a.explorationSlotType != null && a.rationale) {
        patch.rationale = a.rationale;
        patch.explorationSlotType = a.explorationSlotType;
      }
      if (Object.keys(patch).length > 0) patches.set(a.id, patch);
    }
    if (patches.size > 0) {
      after(() =>
        patchBatchArticleFields(batchDate, patches).catch((err: unknown) => {
          console.error('[feed/today] curator-note/rationale patch failed:', err);
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
