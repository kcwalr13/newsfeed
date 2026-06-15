/**
 * Shared "resolve the displayed issue" helper (R4-01).
 *
 * Both `GET /api/feed/today` (the reader's feed) and `GET /api/issue/meta` (the
 * colophon credits + editor theme) must reflect the SAME seven pieces. Before
 * this helper they diverged: the feed applied personalized ranking + the
 * display-diversity reorders (P3-C2/C3) while the issue metadata was built from
 * the raw stored batch order — so the colophon could credit "Quanta ×5, Aeon ×2"
 * while the reader saw a diverse seven.
 *
 * This module is the single source of truth for that order: it resolves the
 * caller's identity, ranks the batch, and applies the C2/C3 reorders exactly as
 * the feed route does, returning the full reordered list (the displayed issue is
 * its first `ISSUE_DISPLAY_SIZE` elements). It deliberately does NOT slice,
 * strip internal fields, or generate rationales — those are response-shaping
 * concerns each route owns.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getShownSourceDomains } from '@/lib/pipeline/storage';
import { resolveSession } from '@/lib/auth/session';
import { getFeedbackForUser, getFeedbackForDevice } from '@/lib/db/feedback';
import type { DbFeedbackRow } from '@/lib/db/feedback';
import { rankFeed, applyDiversityCap, SOURCE_CONSECUTIVE_CAP } from '@/lib/pipeline/ranker';
import { getAestheticProfile, getArticleAestheticScores } from '@/lib/db/aesthetics';
import type { AestheticProfile, AestheticScoreVector } from '@/lib/types/aesthetic';
import { getTopConceptNodes, getAllConceptLabels, getAllConceptEdges } from '@/lib/db/concepts';
import type { UserConcept } from '@/lib/types/concepts';
import { EXPLORATION_BASELINE } from '@/lib/config/serendipity';
import { ISSUE_DISPLAY_SIZE, MIN_UNFAMILIAR_IN_ISSUE, MIN_CATEGORIES_IN_ISSUE } from '@/lib/config/feed';
import { promoteUnfamiliarSources, ensureCategorySpread, isNeverShown } from '@/lib/pipeline/displayDiversity';
import { categoryForArticle } from '@/lib/pipeline/sourceCategory';
import type { Article, ArticleBatch } from '@/lib/types/article';

export interface DisplayedFeed {
  /**
   * The batch's articles in final display order: personalized rank + the C2/C3
   * display-diversity reorders. NOT sliced — the displayed issue is the first
   * `ISSUE_DISPLAY_SIZE` elements. Internal fields are intact (each route strips
   * what it doesn't expose).
   */
  articles: Article[];
  /** Set-Cookie header emitted by the session refresh, if any (callers forward it). */
  setCookieHeader: string | null;
  /**
   * False when identity/feedback reads failed and `articles` is therefore the
   * raw batch order (the ranker never ran). Callers that only do work meaningful
   * for a ranked feed (e.g. exploration-slot rationale generation) gate on this.
   */
  ranked: boolean;
}

/**
 * Resolves the final displayed order of a batch for the requesting identity.
 *
 * Degrades to the raw batch order (`ranked: false`) if the identity/feedback
 * reads throw, mirroring the feed route's prior catch-fallback. The
 * display-diversity reorders are best-effort and individually degrade to a
 * no-op on a DB error (the ranked order still stands).
 */
export async function resolveDisplayedFeed(
  req: NextRequest,
  batch: ArticleBatch
): Promise<DisplayedFeed> {
  const tempRes = new NextResponse();
  let setCookieHeader: string | null = null;

  let feedbackRows: DbFeedbackRow[] = [];
  let aestheticProfile: AestheticProfile | null = null;
  let aestheticScoreMap: Map<string, AestheticScoreVector> = new Map();
  let topConceptNodes: UserConcept[] = [];
  let allConceptLabels: Set<string> = new Set();
  let allConceptEdgesResult: Array<[string, string]> = [];

  try {
    const session = await resolveSession(req, tempRes);
    setCookieHeader = tempRes.headers.get('Set-Cookie');

    const userId   = session?.userId ?? null;
    const deviceId = req.cookies.get('dd_device_id')?.value ?? null;

    const articleIds = batch.articles.map(a => a.id);

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
            console.error('[displayedFeed] concept nodes fetch failed:', err);
            return [] as UserConcept[];
          })
        : Promise.resolve([] as UserConcept[]),
      deviceId
        ? getAllConceptLabels(userId, deviceId).catch((err: unknown) => {
            console.error('[displayedFeed] concept labels fetch failed:', err);
            return new Set<string>();
          })
        : Promise.resolve(new Set<string>()),
      deviceId
        ? getAllConceptEdges(userId, deviceId).catch((err: unknown) => {
            console.error('[displayedFeed] concept edges fetch failed:', err);
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
    console.error('[displayedFeed] identity/feedback/aesthetic fetch failed, returning raw order:', err);
    return { articles: batch.articles, setCookieHeader, ranked: false };
  }

  const topConceptLabels = topConceptNodes.map(n => n.label);
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

  // Display-diversity safety nets: ≥MIN_UNFAMILIAR_IN_ISSUE never-shown sources
  // (C2) and ≥MIN_CATEGORIES_IN_ISSUE categories (C3) in the top span. C3 runs
  // after C2 and is told not to demote C2's unfamiliar pieces, so they compose.
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
    // Re-apply the consecutive-source cap (R4-05): the C2/C3 reorders run after
    // the ranker's own cap and could otherwise leave a >cap same-source run near
    // the fold. No-op unless such a run exists.
    displayArticles = applyDiversityCap(displayArticles, SOURCE_CONSECUTIVE_CAP);
  } catch (err) {
    console.error('[displayedFeed] display-diversity reorder skipped:', err);
  }

  return { articles: displayArticles, setCookieHeader, ranked: true };
}
