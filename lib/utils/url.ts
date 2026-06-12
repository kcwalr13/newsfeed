/**
 * URL canonicalization for DEDUPLICATION ONLY (PIPE-M6).
 *
 * Drops the fragment and tracking params (utm_*, at_*, fbclid, …), keeps
 * meaningful query params (sorted, so param order doesn't defeat dedup), and
 * trims the trailing slash. The same article shared via a utm-tagged link no
 * longer enters a batch twice.
 *
 * Deliberately NOT used for the article id hash (makeId): ids key feedback
 * and reading-position rows, so changing how they're derived would orphan all
 * existing user data. See the tracker's Decisions Log.
 */

const TRACKING_PARAM = /^(utm_|at_|mc_|fbclid$|gclid$|igshid$|ref$|source$)/i;

export function canonicalizeUrlForDedup(url: string): string {
  try {
    const u = new URL(url);
    const kept = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAM.test(k));
    kept.sort(([a], [b]) => a.localeCompare(b));
    const qs = kept.length
      ? '?' + kept.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
      : '';
    const path = u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : u.pathname;
    return u.origin + path + qs;
  } catch {
    return url;
  }
}
