// Best-effort display-diversity reorders applied to the ranked feed before the
// issue is sliced to its top ISSUE_DISPLAY_SIZE pieces. These are SAFETY NETS:
// they only act when the top of the issue doesn't already satisfy a constraint,
// they only ever reorder (never drop), and they degrade to a no-op when the pool
// can't satisfy the constraint. Kept out of the pure ranker so the historical
// data they need (shown-source history) stays in the route's DB layer.

import type { Article, ContentFormat, SourceCategory } from '@/lib/types/article';
import { registrableDomain } from '@/lib/utils/url';

function domainOf(a: Article): string {
  return registrableDomain(a.sourceUrl || a.articleUrl || '');
}

/** True when the article's source domain is absent from the shown-before map. */
export function isNeverShown(a: Article, shownDomains: Map<string, string>): boolean {
  return !shownDomains.has(domainOf(a));
}

/**
 * Guarantees that the displayed issue (top `displaySize`) includes at least
 * `minUnfamiliar` pieces from a source the user has never been shown (P3-C2).
 *
 * `shownDomains` maps each previously-shown registrable domain → its last-shown
 * date. A current article is "never-before-shown" when its domain is absent.
 * If the top is short of the target, promotes candidates from below the fold —
 * never-before-shown first (discovery/novel preferred), then least-recently-
 * shown familiar sources as a fallback — each displacing the lowest-ranked
 * familiar, non-exploration piece currently in the top. Pure reorder; returns
 * the input unchanged when already satisfied or when the pool can't help.
 */
export function promoteUnfamiliarSources(
  ranked: Article[],
  shownDomains: Map<string, string>,
  displaySize: number,
  minUnfamiliar: number
): Article[] {
  const neverShown = (a: Article) => !shownDomains.has(domainOf(a));
  const top = ranked.slice(0, displaySize);
  const unfamiliarInTop = top.filter(neverShown).length;
  const slots = minUnfamiliar - unfamiliarInTop;
  if (slots <= 0) return ranked;

  const below = ranked.slice(displaySize);
  // Promotion order: never-before-shown first (discovery preferred), then the
  // least-recently-shown familiar sources (oldest last-shown date) as fallback.
  const neverShownBelow = below
    .filter(neverShown)
    .sort((a, b) => (b.discoveryTopic ? 1 : 0) - (a.discoveryTopic ? 1 : 0));
  const fallbackBelow = below
    .filter((a) => !neverShown(a))
    .sort((a, b) => (shownDomains.get(domainOf(a)) ?? '').localeCompare(shownDomains.get(domainOf(b)) ?? ''));
  const candidates = [...neverShownBelow, ...fallbackBelow];
  if (candidates.length === 0) return ranked;

  // Demote the lowest-ranked familiar, non-exploration pieces in the top.
  const demotable = top.filter((a) => !neverShown(a) && a.explorationSlotType == null);
  const topSet = new Set(top);
  let filled = 0;
  for (let i = 0; filled < slots && i < candidates.length && demotable.length > 0; i++) {
    const demote = demotable.pop(); // worst-ranked familiar in top
    if (!demote) break;
    topSet.delete(demote);
    topSet.add(candidates[i]);
    filled++;
  }

  // Stable reorder: chosen top set first (original rank order), rest after.
  const topArr = ranked.filter((a) => topSet.has(a));
  const restArr = ranked.filter((a) => !topSet.has(a));
  return [...topArr, ...restArr];
}

/**
 * Guarantees that the displayed issue (top `displaySize`) spans at least
 * `minCategories` distinct editorial categories (P3-C3), when the pool allows.
 *
 * `categoryOf` resolves an article's category (undefined for discovered/unknown
 * sources — these don't count toward distinct categories). If the top is short
 * of the target, promotes pieces of a missing category from below, each
 * displacing the lowest-ranked top piece whose category is over-represented
 * (count > 1, so no category the issue already has is lost) — never an
 * exploration slot, and never a `protect`-ed piece (the route passes C2's
 * never-shown predicate so this can't undo the unfamiliar-source guarantee).
 * Pure reorder; no-op when already satisfied or the pool can't help.
 */
export function ensureCategorySpread(
  ranked: Article[],
  categoryOf: (a: Article) => SourceCategory | undefined,
  displaySize: number,
  minCategories: number,
  protect: (a: Article) => boolean = () => false
): Article[] {
  const topSet = new Set(ranked.slice(0, displaySize));
  const categoryCounts = (): Map<SourceCategory, number> => {
    const counts = new Map<SourceCategory, number>();
    for (const a of topSet) {
      const c = categoryOf(a);
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return counts;
  };

  let counts = categoryCounts();
  if (counts.size >= minCategories) return ranked;

  for (const cand of ranked.slice(displaySize)) {
    if (counts.size >= minCategories) break;
    const cat = categoryOf(cand);
    if (!cat || counts.has(cat)) continue; // only a category the top lacks helps

    // Free a slot by demoting the lowest-ranked top piece of an over-represented
    // category (so we never drop a category the issue already covers).
    const demote = ranked
      .filter((a) => topSet.has(a))
      .reverse()
      .find((a) => {
        const c = categoryOf(a);
        return c != null && (counts.get(c) ?? 0) > 1 && a.explorationSlotType == null && !protect(a);
      });
    if (!demote) continue;

    topSet.delete(demote);
    topSet.add(cand);
    counts = categoryCounts();
  }

  const topArr = ranked.filter((a) => topSet.has(a));
  const restArr = ranked.filter((a) => !topSet.has(a));
  return [...topArr, ...restArr];
}

/** Options for the content-format mix guarantee (R5-D). */
export interface FormatSpreadOptions {
  /** Minimum `short` pieces required in the displayed top span. */
  minShort: number;
  /** Minimum `visual`-or-`potpourri` pieces required in the top span. */
  minVisualOrPotpourri: number;
  /** Maximum `longread` pieces allowed in the top span. */
  maxLongreads: number;
  /** C3 floor to preserve while reordering (distinct categories in the top). */
  minCategories: number;
  /** C2 floor to preserve while reordering (never-shown sources in the top). */
  minUnfamiliar: number;
  /** C2 membership test (a never-before-shown source). */
  isUnfamiliar: (a: Article) => boolean;
}

/**
 * Guarantees a content-format mix in the displayed issue (R5-D): at least
 * `minShort` short pieces and `minVisualOrPotpourri` visual/potpourri pieces,
 * and at most `maxLongreads` long-reads in the top span — so an issue isn't a
 * wall of 4,000-word essays. A pure reorder that promotes the needed format from
 * below the fold, each promotion demoting a top *longread* (the format we trade
 * away — a guaranteed short/visual/potpourri/place is never displaced).
 *
 * Composes with C2/C3 explicitly rather than over-protectively: a candidate swap
 * is accepted only if the resulting top still holds the C2 (unfamiliar) and C3
 * (distinct-category) floors — or, when a floor wasn't met to begin with (thin
 * pool), doesn't worsen it. A blanket "never demote an unfamiliar / sole-category
 * piece" would no-op exactly when the issue is mostly unfamiliar or all-distinct-
 * category (cold-start / discovery-heavy) — the opposite of what we want.
 * Degrades to a no-op when the pool genuinely can't satisfy a floor.
 */
export function ensureFormatSpread(
  ranked: Article[],
  formatOf: (a: Article) => ContentFormat | undefined,
  categoryOf: (a: Article) => SourceCategory | undefined,
  displaySize: number,
  opts: FormatSpreadOptions
): Article[] {
  const topSet = new Set(ranked.slice(0, displaySize));

  const isShort = (a: Article) => formatOf(a) === 'short';
  const isVisualOrPotpourri = (a: Article) => {
    const f = formatOf(a);
    return f === 'visual' || f === 'potpourri';
  };
  const isLongread = (a: Article) => formatOf(a) === 'longread';
  const countTop = (pred: (a: Article) => boolean) =>
    [...topSet].filter(pred).length;

  const distinctCategories = (set: Set<Article>): number => {
    const s = new Set<SourceCategory>();
    for (const a of set) { const c = categoryOf(a); if (c) s.add(c); }
    return s.size;
  };
  const unfamiliarCount = (set: Set<Article>): number =>
    [...set].filter(opts.isUnfamiliar).length;

  // Promote the highest-ranked below-fold piece matching `want`, demoting the
  // lowest-ranked top longread whose swap keeps the C2/C3 floors (or doesn't
  // worsen an already-unmet one). Returns false when no valid swap exists.
  const promote = (want: (a: Article) => boolean): boolean => {
    const cand = ranked
      .slice(displaySize)
      .find((a) => !topSet.has(a) && want(a));
    if (!cand) return false;

    // The binding floor is min(current, nominal): never drop below the nominal
    // floor when it's met, never below the current level when it isn't.
    const catFloor = Math.min(distinctCategories(topSet), opts.minCategories);
    const unfFloor = Math.min(unfamiliarCount(topSet), opts.minUnfamiliar);

    const demotables = ranked
      .filter((a) => topSet.has(a) && isLongread(a) && a.explorationSlotType == null)
      .reverse(); // lowest-ranked first
    for (const demote of demotables) {
      const next = new Set(topSet);
      next.delete(demote);
      next.add(cand);
      if (distinctCategories(next) >= catFloor && unfamiliarCount(next) >= unfFloor) {
        topSet.delete(demote);
        topSet.add(cand);
        return true;
      }
    }
    return false;
  };

  // 1. Short floor.
  while (countTop(isShort) < opts.minShort) {
    if (!promote(isShort)) break;
  }
  // 2. Visual/potpourri floor.
  while (countTop(isVisualOrPotpourri) < opts.minVisualOrPotpourri) {
    if (!promote(isVisualOrPotpourri)) break;
  }
  // 3. Longread ceiling — trade remaining excess longreads for any non-longread
  //    piece with a known format (short/visual/potpourri/place).
  while (countTop(isLongread) > opts.maxLongreads) {
    if (!promote((a) => !isLongread(a) && formatOf(a) != null)) break;
  }

  const topArr = ranked.filter((a) => topSet.has(a));
  const restArr = ranked.filter((a) => !topSet.has(a));
  return [...topArr, ...restArr];
}
