// Quota and discovery tuning constants shared across the pipeline and discovery subsystems.

/** Total articles in every daily batch. */
export const ARTICLES_PER_DAY = 20;

/** Number of articles returned to the client per feed request. */
export const FEED_CLIENT_SIZE = 7;

/** Fixed-source pipeline (RSS + NewsAPI) nominal contribution per day. */
export const PIPELINE_ARTICLES_PER_DAY = 14;

/** Discovery layer nominal contribution per day. */
export const DISCOVERY_ARTICLES_PER_DAY = 6;

// Invariant: PIPELINE_ARTICLES_PER_DAY + DISCOVERY_ARTICLES_PER_DAY must equal ARTICLES_PER_DAY.
// This assertion fails at module load time if the constants drift.
if (PIPELINE_ARTICLES_PER_DAY + DISCOVERY_ARTICLES_PER_DAY !== ARTICLES_PER_DAY) {
  throw new Error(
    `[config/feed] Quota mismatch: PIPELINE_ARTICLES_PER_DAY (${PIPELINE_ARTICLES_PER_DAY}) ` +
      `+ DISCOVERY_ARTICLES_PER_DAY (${DISCOVERY_ARTICLES_PER_DAY}) ` +
      `must equal ARTICLES_PER_DAY (${ARTICLES_PER_DAY})`
  );
}

/** Maximum age in hours for a discovery candidate article. Default: 72 (3 days). */
export const DISCOVERY_MAX_AGE_HOURS = 72;

/** Number of distinct topics probed per pipeline run via Brave Search. */
export const DISCOVERY_TOPICS_PER_RUN = 6;

/** Number of raw search results requested per topic query (Brave count param). */
export const DISCOVERY_CANDIDATES_PER_TOPIC = 10;

/** Magnitude of topic weight adjustment per feedback event (like or dislike). */
export const TOPIC_WEIGHT_STEP = 0.1;

/** Floor on topic weights. Topics cannot be fully eliminated by negative feedback. */
export const TOPIC_WEIGHT_FLOOR = 0.1;

/** Ceiling on topic weights. No single topic can dominate the rotation. */
export const TOPIC_WEIGHT_CEILING = 2.0;

/** LLM composite score threshold (0–5) for a discovery candidate to pass the quality gate. */
export const LLM_EVAL_THRESHOLD = 3.5;

/** Maximum characters of body text sent to the LLM evaluator per call (cost control). */
export const LLM_EVAL_BODY_CHAR_LIMIT = 3000;

/** Maximum new sources added to the Small Web pool per crawl run (blogroll expansion cap). */
export const SMALL_WEB_MAX_NEW_SOURCES_PER_RUN = 20;
