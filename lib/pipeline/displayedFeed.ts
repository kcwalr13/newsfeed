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
import { rankFeed, applyDiversityCap, trailingSourceRun, SOURCE_CONSECUTIVE_CAP } from '@/lib/pipeline/ranker';
import { getAestheticProfile, getArticleAestheticScores } from '@/lib/db/aesthetics';
import type { AestheticProfile, AestheticScoreVector } from '@/lib/types/aesthetic';
import { getTopConceptNodes, getAllConceptLabels, getAllConceptEdges } from '@/lib/db/concepts';
import type { UserConcept } from '@/lib/types/concepts';
import { EXPLORATION_BASELINE } from '@/lib/config/serendipity';
import { ISSUE_DISPLAY_SIZE, MIN_UNFAMILIAR_IN_ISSUE, MIN_CATEGORIES_IN_ISSUE } from '@/lib/config/feed';
import { promoteUnfamiliarSources, ensureCategorySpread, isNeverShown } from '@/lib/pipeline/displayDiversity';
import { categoryForArticle } from '@/lib/pipeline/sourceCategory';
import type { Article, ArticleBatch } from '@/lib/types/article';

/** Distinct editorial categories present in `articles` (discovered/unknown
 *  sources resolve to undefined and don't count) — the quantity C3 guarantees. */
function distinctCategoryCount(articles: Article[]): number {
  const set = new Set<string>();
  for (const a of articles) {
    const c = categoryForArticle(a);
    if (c) set.add(c);
  }
  return set.size;
}

/** Count of never-before-shown sources in `articles` — the quantity C2 guarantees. */
function unfamiliarCount(articles: Article[], shownDomains: Map<string, string>): number {
  return articles.filter((a) => isNeverShown(a, shownDomains)).length;
}

/**
 * The reader's taste model, resolved once here and returned so callers (the
 * curator-note generator, R5-C) don't re-query it.
 */
export interface ResolvedTaste {
  /** Top concept labels, strongest first (getTopConceptNodes). */
  topConcepts: string[];
  /** Long-term aesthetic centroid, or null when none exists yet. */
  centroid: AestheticScoreVector | null;
  /** Per-article aesthetic vectors, keyed by article id. */
  articleScores: Map<string, AestheticScoreVector>;
}

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
  /** The reader's resolved taste model (R5-C); empty on the raw-order fallback. */
  taste: ResolvedTaste;
}

const EMPTY_TASTE: ResolvedTaste = {
  topConcepts: [],
  centroid: null,
  articleScores: new Map(),
};

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
    return { articles: batch.articles, setCookieHeader, ranked: false, taste: EMPTY_TASTE };
  }

  const topConceptLabels = topConceptNodes.map(n => n.label);
  const explorationBudget = aestheticProfile?.exploration_budget ?? EXPLORATION_BASELINE;

  // Taste digest returned for the curator-note generator (R5-C) — already
  // resolved above, so the feed route doesn't re-query it.
  const taste: ResolvedTaste = {
    topConcepts: topConceptLabels,
    centroid: aestheticProfile?.centroid ?? null,
    articleScores: aestheticScoreMap,
  };

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
    // Re-apply the consecutive-source cap after the C2/C3 reorders (R4-05): they
    // run after the ranker's own cap and could otherwise leave a >cap same-source
    // run near the fold. The whole-list cap is source-aware but NOT category/
    // unfamiliar-aware, so in principle breaking a run could demote the sole
    // top-span representative of a category (or an unfamiliar source) below the
    // fold and drop the displayed issue beneath the C2/C3 floors (R4-14).
    //
    // (In practice that demotion is unreachable: the cap only ever defers
    // *same-source* run members, and a floor-critical sole representative is a
    // unique source in the top span — never a run member. Exhaustive search —
    // 1.5M+ inputs meeting the ≥MIN_CATEGORIES floor, biased toward the dangerous
    // shape, plus 400k random — never produced a break. This guard makes R4-05's
    // "preserves C3" claim hold *by construction* rather than by that argument,
    // and protects the floors if a future rank/C2/C3 change shifts the
    // distribution.)
    //
    // So: take the whole-list cap unless it would push the displayed span below a
    // floor the pre-cap span actually MET (identical to R4-05 in every observed
    // case). Otherwise re-cap each side of the fold separately — preserving the
    // EXACT top-ISSUE_DISPLAY_SIZE membership C2/C3 established (a top span that
    // met the ≥MIN_CATEGORIES floor has ≥MIN distinct sources, so it still caps to
    // no >cap run), and continuing the run-state across the fold so a straddling
    // run is still broken below it. Both branches leave the displayed issue with
    // no >cap run and at/above the floors it met.
    const preTop = displayArticles.slice(0, ISSUE_DISPLAY_SIZE);
    const preCategories = distinctCategoryCount(preTop);
    const preUnfamiliar = unfamiliarCount(preTop, shownDomains);

    const wholeCapped = applyDiversityCap(displayArticles, SOURCE_CONSECUTIVE_CAP);
    const wholeCappedTop = wholeCapped.slice(0, ISSUE_DISPLAY_SIZE);

    const categoryFloorHeld =
      preCategories < MIN_CATEGORIES_IN_ISSUE ||
      distinctCategoryCount(wholeCappedTop) >= MIN_CATEGORIES_IN_ISSUE;
    const unfamiliarFloorHeld =
      preUnfamiliar < MIN_UNFAMILIAR_IN_ISSUE ||
      unfamiliarCount(wholeCappedTop, shownDomains) >= MIN_UNFAMILIAR_IN_ISSUE;

    if (categoryFloorHeld && unfamiliarFloorHeld) {
      displayArticles = wholeCapped;
    } else {
      const segTop = applyDiversityCap(preTop, SOURCE_CONSECUTIVE_CAP);
      const segBelow = applyDiversityCap(
        displayArticles.slice(ISSUE_DISPLAY_SIZE),
        SOURCE_CONSECUTIVE_CAP,
        trailingSourceRun(segTop)
      );
      displayArticles = [...segTop, ...segBelow];
    }
  } catch (err) {
    console.error('[displayedFeed] display-diversity reorder skipped:', err);
  }

  return { articles: displayArticles, setCookieHeader, ranked: true, taste };
}
