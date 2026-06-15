// Quota and discovery tuning constants shared across the pipeline and discovery subsystems.

/** Total articles in every daily batch. */
export const ARTICLES_PER_DAY = 20;

/** Number of pieces shown in a daily issue (the "displayed 7"). The feed page
 *  renders the top this-many ranked articles. */
export const ISSUE_DISPLAY_SIZE = 7;

/** Minimum articles in the displayed issue that must come from a source the user
 *  has never been shown (P3-C2) — enforced as a best-effort display reorder. */
export const MIN_UNFAMILIAR_IN_ISSUE = 2;

/** Minimum distinct editorial categories the displayed issue should span
 *  (P3-C3) — enforced as a best-effort display reorder when the pool allows. */
export const MIN_CATEGORIES_IN_ISSUE = 4;

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

/**
 * How many recent issues the discovery novelty filter looks back over (P3-A3).
 * A discovered candidate is dropped if its registrable domain is a fixed source
 * or appeared in any of the last this-many issues — this is what makes discovery
 * surface *unfamiliar* sources rather than re-finding Aeon or yesterday's blog.
 */
export const NOVELTY_LOOKBACK_ISSUES = 14;

/**
 * Number of distinct topics probed per pipeline run via Brave Search.
 * Raised 6 → 12 (the full topic bank) so every run spans all editorial domains
 * rather than a weighted subset (P3-A2). Paired with DISCOVERY_QUERIES_PER_TOPIC
 * = 1 so the Brave query count stays at 12 — budget-neutral on the serialized
 * Brave latency that dominates the discovery wall clock (DAT-H2).
 */
export const DISCOVERY_TOPICS_PER_RUN = 12;

/**
 * Brave queries issued per topic per run. 1 keeps the per-run Brave query count
 * equal to DISCOVERY_TOPICS_PER_RUN (the rotation cursor still cycles each
 * topic's multi-query bank across runs, so query variety accrues over days
 * without inflating any single run's wall clock). (P3-A2)
 */
export const DISCOVERY_QUERIES_PER_TOPIC = 1;

/**
 * Number of raw search results requested per topic query (Brave count param).
 * Raised 10 → 20 to thicken the candidate pool (one Brave call returns more
 * results at no extra latency), giving the quality gate real choice (P3-A2).
 */
export const DISCOVERY_CANDIDATES_PER_TOPIC = 20;

/**
 * Hard cap on how many gate-passed candidates proceed to the expensive
 * body-extraction + LLM-evaluation phase in a single run (P3-A2). Bounds the
 * discovery wall clock deterministically (≈ cap / DISCOVERY_LLM_CONCURRENCY
 * sequential body+LLM round-trips) so a widened raw pool can never push a run
 * past the DAT-H2 budget. The gate chooses these from the full (now ~240+) raw
 * pool, interleaved by topic so Small-Web candidates are represented.
 */
export const DISCOVERY_MAX_EVAL_CANDIDATES = 40;

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
 * score from candidates at or above this floor. As a last resort the quota may
 * dip below the floor, but only up to DISCOVERY_BELOW_FLOOR_MAX slots (R4-04).
 */
export const LLM_EVAL_FLOOR = 3.0;

/**
 * Maximum number of discovery slots that the last-resort backfill may fill with
 * BELOW-floor candidates (R4-04). Bounds a thin day: rather than packing all
 * DISCOVERY_ARTICLES_PER_DAY slots with sub-floor content, discovery ships at
 * most this many sub-floor pieces and leaves the rest of the quota unfilled (the
 * issue is topped up from the fixed palette).
 */
export const DISCOVERY_BELOW_FLOOR_MAX = 2;

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
