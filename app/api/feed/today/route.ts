import { NextRequest, NextResponse, after } from 'next/server';
import { readBatch, readLatestBatch, patchBatchArticleFields } from '@/lib/pipeline/storage';
import { generateMissingCuratorNotes } from '@/lib/pipeline/curatorNoteGenerator';
import { computeDiscoveryYield } from '@/lib/pipeline/discoveryMeta';
import { resolveDisplayedFeed } from '@/lib/pipeline/displayedFeed';
import { formatForArticle } from '@/lib/pipeline/contentFormat';
import { recordSeenUrls } from '@/lib/db/discoverySeen';
import { ISSUE_DISPLAY_SIZE } from '@/lib/config/feed';
import { isLinkOutItem, type Article } from '@/lib/types/article';

export const dynamic = 'force-dynamic';

/** Strips internal-only fields before sending an article to the client. Keeps
 *  explorationSlotType (the exploration-slot badge) + curatorNote + format +
 *  contentType + media (R7-1, for the per-type card) for display; drops bodyText
 *  (the reader page loads the body server-side via findArticleAcrossBatches) and
 *  discoverySource (R7-1 provenance telemetry — the unit is the find, not the
 *  source, so the stream that found it is never shown). */
function toPublicArticle(article: Article) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { discoveryTopic: _dt, llmScore: _ls, extractedConcepts: _ec, serendipityScore: _ss, probeInfo: _pi, bodyText: _bt, discoverySource: _ds, ...rest } = article;
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
  const { articles: displayArticles, setCookieHeader, taste } = await resolveDisplayedFeed(req, batch);

  // The displayed issue is the first ISSUE_DISPLAY_SIZE pieces; bound the
  // per-issue curator-note work to those.
  const shown = displayArticles.slice(0, ISSUE_DISPLAY_SIZE);

  // R7-2: permanently retire every DISPLAYED agent-discovered item — the
  // index-funnel link-out gems + curated places (discoverySource) AND the Brave
  // discovery essays (discoveryTopic) — from the durable novelty memory the moment
  // they're actually shown, so a shown find never resurfaces while an undisplayed
  // candidate stays eligible another day (retire-on-display; R7-2e moved the essay
  // write here from generation time so the MAX_ARTICLES_IN_ISSUE-capped + below-fold
  // essays aren't burned unseen). Best-effort, post-response, idempotent
  // (ON CONFLICT DO NOTHING); a no-op before migration 020 is applied.
  const shownDiscovered = shown.filter(
    (a) => isLinkOutItem(a) || a.discoveryTopic
  );
  if (shownDiscovered.length > 0) {
    after(() =>
      recordSeenUrls(
        shownDiscovered.map((a) => ({
          url: a.articleUrl,
          discoverySource: a.discoverySource ?? a.discoveryTopic ?? null,
        }))
      ).catch((err: unknown) => console.error('[feed/today] durable novelty record failed:', err))
    );
  }

  // Resolve each displayed piece's content-format (R5-D) for the client's card
  // variant (D2). Set BEFORE toPublicArticle strips bodyText (the `short`
  // derivation needs it); `place` items keep their explicit format.
  for (const a of shown) a.format = formatForArticle(a);

  // Personalized curator note for every displayed piece (R5-C): replaces the raw
  // RSS summary as the blurb. No-op for pieces already noted (cache hit), so
  // subsequent loads don't re-call the LLM. Generated from the taste model
  // resolveDisplayedFeed already returned (no re-query).
  const notesGenerated = await generateMissingCuratorNotes(shown, taste);

  // Persist any newly-generated curator notes back to the batch after the
  // response is sent. after() keeps the serverless function alive for this work;
  // a bare floating promise would be frozen once the response went out.
  if (notesGenerated > 0) {
    const batchDate = batch.batchDate;
    const patches = new Map<string, Partial<Article>>();
    for (const a of shown) {
      if (a.curatorNote) patches.set(a.id, { curatorNote: a.curatorNote });
    }
    if (patches.size > 0) {
      after(() =>
        patchBatchArticleFields(batchDate, patches).catch((err: unknown) => {
          console.error('[feed/today] curator-note patch failed:', err);
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
