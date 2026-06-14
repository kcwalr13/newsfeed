import { NextRequest, NextResponse, after } from 'next/server';
import { readBatch, readLatestBatch, patchBatchArticleFields, getShownSourceDomains } from '@/lib/pipeline/storage';
import { resolveSession } from '@/lib/auth/session';
import { getFeedbackForUser, getFeedbackForDevice } from '@/lib/db/feedback';
import type { DbFeedbackRow } from '@/lib/db/feedback';
import { rankFeed } from '@/lib/pipeline/ranker';
import { getAestheticProfile, getArticleAestheticScores } from '@/lib/db/aesthetics';
import type { AestheticProfile, AestheticScoreVector } from '@/lib/types/aesthetic';
import { getTopConceptNodes, getAllConceptLabels, getAllConceptEdges } from '@/lib/db/concepts';
import type { UserConcept } from '@/lib/types/concepts';
import { EXPLORATION_BASELINE } from '@/lib/config/serendipity';
import { ISSUE_DISPLAY_SIZE, MIN_UNFAMILIAR_IN_ISSUE, MIN_CATEGORIES_IN_ISSUE } from '@/lib/config/feed';
import { generateMissingRationales } from '@/lib/pipeline/rationaleGenerator';
import { computeDiscoveryYield } from '@/lib/pipeline/discoveryMeta';
import { promoteUnfamiliarSources, ensureCategorySpread, isNeverShown } from '@/lib/pipeline/displayDiversity';
import { categoryForArticle } from '@/lib/pipeline/sourceCategory';

export const dynamic = 'force-dynamic';

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

  // Create a temporary response object so resolveSession can attach a
  // refreshed Set-Cookie header to it. We will copy that header to the
  // final response.
  const tempRes = new NextResponse();
  let feedbackRows: DbFeedbackRow[] = [];
  let aestheticProfile: AestheticProfile | null = null;
  let aestheticScoreMap: Map<string, AestheticScoreVector> = new Map();
  let topConceptNodes: UserConcept[] = [];
  let allConceptLabels: Set<string> = new Set();
  let allConceptEdgesResult: Array<[string, string]> = [];
  let setCookieHeader: string | null = null;

  try {
    const session = await resolveSession(req, tempRes);
    setCookieHeader = tempRes.headers.get('Set-Cookie');

    const userId   = session?.userId ?? null;
    const deviceId = req.cookies.get('dd_device_id')?.value ?? null;

    const articleIds = batch.articles.map(a => a.id);

    // Resolve identity-dependent reads in parallel
    const [fbRows, profile, scoreMap, topConceptResult, conceptLabels, conceptEdges] = await Promise.all([
      userId
        ? getFeedbackForUser(userId)
        : deviceId ? getFeedbackForDevice(deviceId) : Promise.resolve([]),
      deviceId
        ? getAestheticProfile(userId, deviceId)
        : Promise.resolve(null),
      getArticleAestheticScores(articleIds),
      deviceId
        ? getTopConceptNodes(userId, deviceId, 20).catch((err: unknown) => {
            console.error('[feed] concept nodes fetch failed:', err);
            return [] as UserConcept[];
          })
        : Promise.resolve([] as UserConcept[]),
      deviceId
        ? getAllConceptLabels(userId, deviceId).catch((err: unknown) => {
            console.error('[feed] concept labels fetch failed:', err);
            return new Set<string>();
          })
        : Promise.resolve(new Set<string>()),
      deviceId
        ? getAllConceptEdges(userId, deviceId).catch((err: unknown) => {
            console.error('[feed] concept edges fetch failed:', err);
            return [] as Array<[string, string]>;
          })
        : Promise.resolve([] as Array<[string, string]>),
    ]);

    feedbackRows            = fbRows;
    aestheticProfile        = profile;
    aestheticScoreMap       = scoreMap;
    topConceptNodes         = topConceptResult;
    allConceptLabels        = conceptLabels;
    allConceptEdgesResult   = conceptEdges;
  } catch (err) {
    console.error('[feed/today] identity/feedback/aesthetic fetch failed, returning unranked:', err);
    const publicBatchArticles = batch.articles.map(article => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { discoveryTopic: _dt, llmScore: _ls, extractedConcepts: _ec, serendipityScore: _ss, probeInfo: _pi, bodyText: _bt, ...rest } = article;
      return rest;
    });
    return NextResponse.json(
      { batchDate: batch.batchDate, articles: publicBatchArticles, generatedAt: batch.generatedAt, discoveryCount, discoverySources },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const topConceptLabels = topConceptNodes.map(n => n.label);

  // Use stored exploration_budget from aesthetic profile; fall back to EXPLORATION_BASELINE
  const explorationBudget = aestheticProfile?.exploration_budget ?? EXPLORATION_BASELINE;

  const rankedArticles = rankFeed(
    batch.articles,
    feedbackRows,
    aestheticProfile,
    aestheticScoreMap,
    topConceptLabels,
    allConceptLabels,
    allConceptEdgesResult,
    explorationBudget
  );

  // Generate rationales for newly-slotted exploration articles (no-op if all already set).
  const rationalesGenerated = await generateMissingRationales(rankedArticles);
  if (rationalesGenerated > 0) {
    // Persist rationale + explorationSlotType back to the batch after the
    // response is sent. after() keeps the serverless function alive for this
    // work; a bare floating promise would be frozen once the response went out.
    const batchDate = batch.batchDate;
    const patches = new Map(
      rankedArticles
        .filter((a) => a.explorationSlotType != null && a.rationale)
        .map((a) => [a.id, { rationale: a.rationale, explorationSlotType: a.explorationSlotType }])
    );
    after(() =>
      patchBatchArticleFields(batchDate, patches).catch((err: unknown) => {
        console.error('[feed/today] rationale patch failed:', err);
      })
    );
  }

  // Display-diversity safety nets: make the issue's top pieces include sources
  // the user has never been shown (P3-C2) and span several editorial categories
  // (P3-C3). Best-effort reorders — degrade to a no-op on any DB error (the
  // ranked order still stands). C3 runs after C2 and is told not to demote C2's
  // unfamiliar pieces, so the two guarantees compose.
  let displayArticles = rankedArticles;
  try {
    const shownDomains = await getShownSourceDomains(batch.batchDate);
    displayArticles = promoteUnfamiliarSources(
      rankedArticles,
      shownDomains,
      ISSUE_DISPLAY_SIZE,
      MIN_UNFAMILIAR_IN_ISSUE
    );
    displayArticles = ensureCategorySpread(
      displayArticles,
      categoryForArticle,
      ISSUE_DISPLAY_SIZE,
      MIN_CATEGORIES_IN_ISSUE,
      (a) => isNeverShown(a, shownDomains)
    );
  } catch (err) {
    console.error('[feed/today] display-diversity reorder skipped:', err);
  }

  // Strip internal fields before sending to client; keep explorationSlotType + rationale for
  // display. bodyText is stripped too — the feed renders cards only; the reader page loads the
  // body server-side via findArticleAcrossBatches.
  const publicArticles = displayArticles.map(article => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { discoveryTopic: _dt, llmScore: _ls, extractedConcepts: _ec, serendipityScore: _ss, probeInfo: _pi, bodyText: _bt, ...rest } = article;
    return rest;
  });

  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (setCookieHeader) headers['Set-Cookie'] = setCookieHeader;

  return NextResponse.json(
    { batchDate: batch.batchDate, articles: publicArticles, generatedAt: batch.generatedAt, discoveryCount, discoverySources },
    { headers }
  );
}
