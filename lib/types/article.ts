/** A single article fetched and stored in a daily batch. */
export interface Article {
  /** Unique identifier: <source-slug>-<8-char-hash-of-articleUrl> */
  id: string;
  /** Headline of the article. */
  title: string;
  /** Human-readable name of the publication or site (e.g. "BBC News"). */
  sourceName: string;
  /** Homepage URL of the source (e.g. "https://www.bbc.com/news"). */
  sourceUrl: string;
  /** Full URL to the original article. */
  articleUrl: string;
  /** ISO-8601 datetime the article was originally published. */
  publishedAt: string;
  /** ISO-8601 datetime the article was fetched into the pipeline. */
  fetchedAt: string;
  /** YYYY-MM-DD date string identifying which daily batch this article belongs to. */
  batchDate: string;
  /** Short summary or excerpt, if available from the source. */
  description?: string;
  /** URL to a representative image for the article, if available. */
  imageUrl?: string;
  /** Full body text of the article, if available via RSS content:encoded. */
  bodyText?: string;
  /** Reserved for the like/dislike/save feedback system. null = no feedback given. */
  feedbackSlot?: 'like' | 'dislike' | 'save' | null;
  /**
   * For discovery-sourced articles only: the topic ID from DISCOVERY_TOPICS that
   * produced this article. Used by the topic weight feedback loop.
   * Null for fixed-pipeline articles. Never sent to the client.
   * @internal
   */
  discoveryTopic?: string | null;

  /**
   * LLM composite quality score (1.0–5.0, arithmetic mean of five 1–5 dimensions).
   * Set by llmEvaluator.ts at pipeline time. Absent for fixed-source articles.
   * Never sent to the client. @internal
   */
  llmScore?: number;

  /**
   * Concepts extracted from this article at pipeline time.
   * Populated for all candidates that pass the quality gate.
   * Absent for fixed-source articles that bypass LLM extraction.
   * Never sent to the client. @internal
   */
  extractedConcepts?: string[];

  /**
   * Serendipity score computed at rankFeed() time. Range [0.0, 1.0].
   * Transient on the Article object — never written to batch JSON.
   * @internal
   */
  serendipityScore?: number;

  /**
   * Slot type assigned at feed assembly time.
   * null for exploitation articles. Sent to the client for display as exploration badges.
   */
  explorationSlotType?: 'semantic_stretch' | 'blind_spot_probe' | 'wildcard' | null;

  /**
   * Set only when this article was selected as a blind spot probe.
   * Written to batch JSON. Never sent to the client.
   * Non-probe articles omit this field entirely (absent, not null). @internal
   */
  probeInfo?: { probeType: 'blind_spot'; clusterLabel: string };

  /**
   * Issue folio position: "01"–"07" within the daily issue.
   * Assigned at feed-assembly time. Sent to the client.
   */
  folio?: string;

  /**
   * Approximate reading time in minutes, if known.
   * Derived from bodyText word count at pipeline time.
   */
  readTime?: number;

  /**
   * Personalized, second-person curator note (R5-C) — an editorial invitation
   * ("why you'll want this") that replaces the raw RSS summary as the card
   * blurb. Generated at request time from the reader's taste digest and cached
   * back to the batch, so subsequent loads are free. Sent to the client.
   */
  curatorNote?: string;

  /**
   * Content-format of the piece (R5-D). Mostly resolved on read from readTime +
   * source (see `formatForArticle`), so it's absent on stored batch articles
   * except `place` items, which are explicit (set at assembly, D3) because a
   * whole-site "place to explore" has no derivable signal. Sent to the client
   * for the card variant (D2).
   */
  format?: ContentFormat;

  /**
   * Item type for the Round-7 discovery engine. `'article'` (the default when
   * absent, for back-compat) is the only type that has prose / a body / the
   * in-app reader; every other type is a link-out item (the `place` pattern —
   * no `bodyText`/`readTime`/reader, `curatorNote` is the blurb, card links
   * straight out). Sent to the client (picks the card variant). The R5-D
   * `format` taxonomy is parallel and still drives the existing display mix;
   * `contentType` is the item-type dimension the R7 mix (R7-5) keys on.
   */
  contentType?: ContentType;

  /**
   * Media metadata for non-article (link-out) items — thumbnail, embed, runtime,
   * creator, platform, popularity score. Absent for plain `article`s. Sent to
   * the client for the per-type card (R7-4).
   */
  media?: ItemMedia;

  /**
   * Provenance: which candidate stream / index discovered this item (R7-2),
   * e.g. "hacker-news" or "llm-hunt". Telemetry only — NEVER shown to the user
   * as a "source" (the unit is the find, not the source) and never sent to the
   * client. @internal
   */
  discoverySource?: string;
}

/** Content-format taxonomy for the issue mix guarantee (R5-D). */
export type ContentFormat = 'longread' | 'short' | 'visual' | 'potpourri' | 'place';

/**
 * Item-type taxonomy for the Round-7 discovery engine. `article` is the only
 * type with prose / a body / the in-app reader; the rest are link-out items.
 */
export type ContentType = 'article' | 'music' | 'video' | 'website' | 'thread' | 'find';

/** The non-article content types — every one is a link-out item (R7-2). */
export const LINK_OUT_CONTENT_TYPES: ReadonlySet<ContentType> = new Set([
  'music', 'video', 'website', 'thread', 'find',
]);

/**
 * True when an article is a link-out item — a one-off find the card links
 * STRAIGHT OUT to (no in-app reader, no body): any non-`article` `contentType`,
 * or the R5 curated `place` (kept for back-compat). Link-out items carry the
 * feedback row (R7-2d) but stay out of the seven-dot read-count (rateable, not
 * "read").
 */
export function isLinkOutItem(a: Pick<Article, 'contentType' | 'format'>): boolean {
  if (a.contentType && a.contentType !== 'article') return true;
  return a.format === 'place';
}

/**
 * Media metadata attached to a non-article (link-out) item. Every field is
 * optional — a given type populates only what's relevant (a video has a
 * `durationSec`, a thread a `score`, music a `creator`, etc.).
 */
export interface ItemMedia {
  /** Representative image (cover art, video thumbnail, screenshot). */
  thumbnailUrl?: string;
  /** Embeddable player URL where available (Bandcamp/YouTube — R7-7). */
  embedUrl?: string;
  /** Runtime in seconds, for video/audio. */
  durationSec?: number;
  /** Artist / author / channel / maker. */
  creator?: string;
  /** Hosting platform (e.g. "youtube", "bandcamp", "hacker-news"). */
  platform?: string;
  /** Popularity signal where the platform exposes one (HN points, etc.). */
  score?: number;
}

/** The response shape returned by GET /api/feed/today. */
export interface FeedResponse {
  /** YYYY-MM-DD date of the batch being returned. Empty string if no batch exists. */
  batchDate: string;
  /** Ordered list of articles for the day. */
  articles: Article[];
  /**
   * ISO-8601 UTC timestamp of when the most recent successful pipeline run completed.
   * Absent when no batch exists (initial state before any pipeline run).
   * Clients should format this to local time for display.
   */
  generatedAt?: string;
  /**
   * Number of articles in this issue sourced from proactive discovery (P3-A4).
   * Derived from the per-article discoveryTopic marker. Absent if no batch.
   */
  discoveryCount?: number;
  /**
   * Unique discovered sources — domain + human-readable name (P3-A4 / R4-02).
   * Powers the discovery-share / sources metrics (Workstream D) and lets the UI
   * show "Art Walkway" rather than "artwalkway.com".
   */
  discoverySources?: Array<{ domain: string; name: string }>;
}

/** The on-disk representation of a daily article batch. */
export interface ArticleBatch {
  /** YYYY-MM-DD date this batch was generated for. */
  batchDate: string;
  /** ISO-8601 datetime the batch was written to disk. */
  generatedAt: string;
  /** The articles in this batch. */
  articles: Article[];
  /**
   * True when LLM enrichment (aesthetic scoring / concept extraction) failed
   * for every article, so the batch is ranked by source score only.
   */
  degraded?: boolean;
}

/**
 * Editorial domain a fixed source belongs to. Used for per-category diversity
 * caps (P3-B3), display diversity (P3-C3), and the metrics category breakdown
 * (P3-D1). Discovered (non-fixed) articles have no category.
 */
export type SourceCategory =
  | 'science'
  | 'philosophy'
  | 'ideas'
  | 'economics'
  | 'psychology'
  | 'culture'
  | 'music'
  | 'art'
  | 'design'
  | 'film'
  | 'literature';

/** A content source entry from data/sources.json. */
export interface Source {
  /** URL-safe unique identifier for this source (e.g. "bbc-news"). */
  slug: string;
  /** Human-readable display name (e.g. "BBC News"). */
  name: string;
  /** Homepage URL of the publication. */
  url: string;
  /** Determines which adapter to use for this source. */
  type: 'rss' | 'newsapi';
  /** Whether this source is active in the pipeline. Inactive sources are skipped. */
  active: boolean;
  /** RSS feed URL. Required when type is "rss". */
  feedUrl?: string;
  /** Search query or endpoint hint. Used by the newsapi adapter. */
  query?: string;
  /** Editorial domain of this source. Absent on legacy entries until backfilled. */
  category?: SourceCategory;
}

/** A single feedback record stored per article in localStorage. */
export interface FeedbackRecord {
  /** The feedback value. 'save' marks an article for later reading without aesthetic endorsement. */
  value: 'like' | 'dislike' | 'save';
  /** ISO-8601 timestamp of the last set or change operation. */
  updatedAt: string;
}

/**
 * The full shape of the localStorage value stored under FEEDBACK_STORE_KEY.
 * Keys are article IDs.
 */
export type FeedbackStore = Record<string, FeedbackRecord>;

/** Source credit entry used in the issue colophon. */
export interface SourceCredit {
  /** Matches Article.folio (e.g. "01"). */
  number: string;
  source: string;
  author: string;
  /** Bare domain, no protocol (e.g. "aeon.co"). */
  domain: string;
  /** Full URL to the article. */
  url: string;
}

/**
 * Metadata about a daily issue.
 * Extended to support the Quiet Library cover + colophon design.
 */
export interface DailyIssue {
  number: number;
  date: string;           // long form, e.g. "Saturday, April twenty-fourth"
  dateShort: string;      // e.g. "Apr 19, 2026"
  volume: string;         // e.g. "Vol. I"
  theme: string;          // e.g. "quiet systems"
  themeNote?: string;     // one-sentence editor's note for the cover
  count: number;          // always 7 for v1
  arrivedAt?: string;     // ISO time of delivery, used on cover
  sources?: SourceCredit[];
  tomorrowTheme?: string;
  tomorrowArrivesAt?: string;
  /**
   * Schema/derivation version of this cached metadata. Bumped when the way the
   * displayed seven are resolved changes, so already-cached batches regenerate
   * once on next access instead of serving a stale colophon (R4-01).
   */
  metaVersion?: number;
}

/** Reading position bookmark for "I stopped here" feature. */
export interface ReadingPosition {
  userId: string;
  articleId: string;
  paragraphIndex: number;
  dwellSeconds: number;
  pausedAt: string;       // ISO
  finishedAt?: string;    // set when user finishes after pausing → triggers "small victory" UI
}

/** Slot type labels and glyphs for exploration badges. */
export const SLOT_LABELS = {
  semantic_stretch: { glyph: '✦', label: 'A stretch', caption: 'why this' },
  blind_spot_probe: { glyph: '◐', label: 'Blind spot', caption: 'outside your usual' },
  wildcard:         { glyph: '∅', label: 'Wildcard',   caption: 'pure surprise' },
} as const;
