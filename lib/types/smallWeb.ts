/** A row in the small_web_sources database table. */
export interface SmallWebSource {
  id: number;
  /** Normalized homepage URL (e.g. "https://example.com"). */
  url: string;
  /** RSS or Atom feed URL. Null if not yet discovered or not available. */
  feed_url: string | null;
  /** ISO-8601 timestamp of the last crawl attempt. Null if never crawled. */
  last_crawled_at: string | null;
  /** ISO-8601 timestamp of the last run that yielded at least one qualifying article. */
  last_yielded_at: string | null;
  /** Total qualifying articles yielded across all crawl runs lifetime. */
  yield_count: number;
  /** Number of consecutive crawl runs that produced zero qualifying articles. */
  consecutive_zero_yields: number;
  /**
   * 'active' — crawled on 7-day interval.
   * 'deprioritized' — crawled on 30-day interval (4+ consecutive zero-yield runs).
   */
  status: 'active' | 'deprioritized';
  /** ISO-8601 timestamp before which this source is not eligible for crawling. */
  cooldown_until: string | null;
  /** How this source was added to the pool. */
  discovered_via: 'seed' | 'blogroll';
  /** ISO-8601 timestamp of row creation. */
  created_at: string;
}
