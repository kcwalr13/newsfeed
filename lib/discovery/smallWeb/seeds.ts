/**
 * Initial seed URLs for the Small Web source pool.
 * These are human-curated directories of personal blogs and independent sites.
 * The crawler fetches these pages and parses them for blogroll links to
 * discover actual content sources.
 *
 * To add a seed: append to this array and redeploy. The seedSourcesIfEmpty()
 * DB helper will insert new URLs on the next pipeline run.
 */
export const SMALL_WEB_SEED_URLS: string[] = [
  'https://ooh.directory',
  'https://blogroll.org',
  'https://indieweb.org/people',
];
