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
   * null for exploitation articles. Written to batch JSON for analytics.
   * Never sent to the client. @internal
   */
  explorationSlotType?: 'semantic_stretch' | 'blind_spot_probe' | 'wildcard' | null;

  /**
   * Set only when this article was selected as a blind spot probe.
   * Written to batch JSON. Never sent to the client.
   * Non-probe articles omit this field entirely (absent, not null). @internal
   */
  probeInfo?: { probeType: 'blind_spot'; clusterLabel: string };
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
}

/** The on-disk representation of a daily article batch. */
export interface ArticleBatch {
  /** YYYY-MM-DD date this batch was generated for. */
  batchDate: string;
  /** ISO-8601 datetime the batch was written to disk. */
  generatedAt: string;
  /** The articles in this batch. */
  articles: Article[];
}

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
