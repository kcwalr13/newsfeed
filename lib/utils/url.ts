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

/**
 * Multi-label public suffixes so subdomains of common country-code domains
 * (theguardian.co.uk) collapse to the registrable domain (theguardian.co.uk)
 * rather than the bare suffix (co.uk). Not a full Public Suffix List — it covers
 * the realistic cases for source-novelty matching; everything else is eTLD+1 =
 * the last two labels.
 */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'co.jp', 'or.jp', 'ne.jp', 'co.za', 'com.br', 'co.in', 'co.kr',
]);

/**
 * Returns the registrable domain (≈ eTLD+1) of a URL or bare hostname,
 * lowercased and with a leading "www." stripped. Two URLs share a *source* iff
 * their registrable domains match — this is what the discovery novelty filter
 * (P3-A3) uses to recognise "a source we already know / have shown recently".
 * Falls back to the lowercased input when it can't be parsed.
 */
export function registrableDomain(urlOrHost: string): string {
  let host = urlOrHost.trim().toLowerCase();
  try {
    host = /^[a-z][a-z0-9+.-]*:\/\//.test(host)
      ? new URL(host).hostname
      : new URL(`https://${host}`).hostname;
  } catch {
    // Unparseable — fall through with the raw lowercased input.
  }
  host = host.replace(/^www\./, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

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
