// Best-effort display-diversity reorders applied to the ranked feed before the
// issue is sliced to its top ISSUE_DISPLAY_SIZE pieces. These are SAFETY NETS:
// they only act when the top of the issue doesn't already satisfy a constraint,
// they only ever reorder (never drop), and they degrade to a no-op when the pool
// can't satisfy the constraint. Kept out of the pure ranker so the historical
// data they need (shown-source history) stays in the route's DB layer.

import type { Article, SourceCategory } from '@/lib/types/article';
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
