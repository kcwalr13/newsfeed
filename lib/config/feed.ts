// Quota and discovery tuning constants shared across the pipeline and discovery subsystems.

/** Total articles in every daily batch. */
export const ARTICLES_PER_DAY = 20;

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

/**
 * Adaptive-threshold floor: when fewer than DISCOVERY_ARTICLES_PER_DAY
 * candidates clear LLM_EVAL_THRESHOLD, slots are filled top-down by composite
 * score from candidates at or above this floor (never below it).
 */
export const LLM_EVAL_FLOOR = 3.0;

/** Maximum characters of body text sent to the LLM evaluator per call (cost control). */
export const LLM_EVAL_BODY_CHAR_LIMIT = 3000;

/** Maximum new sources added to the Small Web pool per crawl run (blogroll expansion cap). */
export const SMALL_WEB_MAX_NEW_SOURCES_PER_RUN = 20;

/**
 * Wall-clock budget for a full pipeline run (ms). Kept below the route
 * maxDuration (300s) so the assembled batch is always written before the
 * platform kills the function.
 */
export const PIPELINE_WALL_CLOCK_BUDGET_MS = 270_000;

/**
 * Time reserved after discovery for body fetch, aesthetic scoring, concept
 * extraction, and the batch write (ms). Discovery is skipped or cut short to
 * protect this reserve.
 */
export const PIPELINE_POST_DISCOVERY_RESERVE_MS = 120_000;

/** Max concurrent Anthropic calls in the per-article scoring/concept loops. */
export const PIPELINE_LLM_CONCURRENCY = 4;

/**
 * Max concurrent discovery candidates in body-extraction + LLM evaluation.
 * The loop was fully sequential, so one slow fetch/LLM call stalled the rest and
 * risked the pipeline wall-clock budget (R2-18). Kept modest (4) to bound
 * simultaneous Anthropic calls and outbound fetches.
 */
export const DISCOVERY_LLM_CONCURRENCY = 4;

/**
 * Hard cap on per-article LLM calls (aesthetic scoring + concept extraction)
 * in a single pipeline run — a cost backstop if a feed explosion or retry
 * loop ever inflates the article pool (PIPE-M5). A normal run uses well
 * under half of this.
 */
export const MAX_LLM_EVALS_PER_RUN = 120;
