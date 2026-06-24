// Quota and discovery tuning constants shared across the pipeline and discovery subsystems.

import { LLM_PROVIDER } from '@/lib/config/llm';

/** Size of the ranking/candidate pool a daily batch holds (the displayed issue
 *  is the top ISSUE_DISPLAY_SIZE). Since the R7-2e supply flip this is filled by
 *  the index-funnel link-out gems + ≤MAX_ARTICLES_IN_ISSUE essays + the curated
 *  place — no longer a "fixed RSS + discovery" split. */
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

/** Reading time (minutes) at or above which a piece counts as a `longread`
 *  (R5-D). Below this, a piece with a body is a `short`; source overrides it to
 *  `visual`/`potpourri`. */
export const LONGREAD_MIN_MINUTES = 10;

/** Minimum `short` pieces the displayed issue should include (R5-D mix guarantee). */
export const MIN_SHORT_IN_ISSUE = 1;

/** Minimum `visual`-or-`potpourri` pieces the displayed issue should include
 *  (R5-D mix guarantee) — so an issue isn't a wall of prose. */
export const MIN_VISUAL_OR_POTPOURRI_IN_ISSUE = 1;

/** Maximum `longread` pieces in the displayed issue (R5-D) — caps the wall of
 *  4,000-word essays so oddments and curiosities get shelf space. 7 − this ≥ the
 *  two non-longread floors above, so the guarantees are jointly satisfiable. */
export const MAX_LONGREADS_IN_ISSUE = 5;

/**
 * Maximum `article`-type (essay) pieces in a daily issue (R7-2e / design §6).
 * Kyle's core complaint was "still just long articles in a similar pattern" — so
 * the discovery agent caps the essay stream hard and lets one-off link-out gems
 * (websites, web-toys, threads, …) dominate. R7-2e applies this as a SUPPLY cap
 * on the Brave essay stream; R7-5 moves it into the display assembler
 * (`ensureTypeSpread`) with type floors + the R5-D1 simulation re-proof. */
export const MAX_ARTICLES_IN_ISSUE = 3;

/**
 * How many essays the Brave discovery stream may surface per run (its internal
 * quota). Since the R7-2e supply flip the digest caps the ARTICLE-type pieces at
 * MAX_ARTICLES_IN_ISSUE before assembly, so this is just the candidate budget the
 * essay stream draws from — not a "fixed + discovery = 20" split (the
 * fixed-RSS half, formerly PIPELINE_ARTICLES_PER_DAY=14, is retired).
 */
export const DISCOVERY_ARTICLES_PER_DAY = 6;

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
 *
 * Provider-aware (R6-5): under Gemini's ~15 RPM free tier the shared limiter
 * meters every LLM call to ~4s apart, so 40 discovery evals (alone ~160s) plus
 * the per-article scoring phase would overrun the wall-clock budget. Lowering
 * the cap to 15 keeps a full Gemini run inside `PIPELINE_WALL_CLOCK_BUDGET_MS`
 * (the per-article scoring phase is additionally deadline-guarded — see run.ts).
 * Anthropic (effectively unlimited rate) keeps the full 40.
 */
export const DISCOVERY_MAX_EVAL_CANDIDATES = LLM_PROVIDER === 'gemini' ? 15 : 40;

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
 * Index-mining funnel (R7-2): how many verified link-out items the funnel
 * contributes to a daily batch. As of R7-2e the funnel is the digest's PRIMARY
 * supply (data/sources.json is retired), so this fills most of the
 * ARTICLES_PER_DAY batch alongside ≤MAX_ARTICLES_IN_ISSUE essays + the curated
 * place. Only the ~7 that actually DISPLAY are recorded into durable novelty
 * memory (retire-on-display), so a generous batch buffer wastes no gems. These
 * items are link-out (no body / no in-app reader) and rule-filtered only — the
 * interestingness LLM judge is R7-3. */
export const INDEX_FUNNEL_ITEMS_PER_DAY = 16;

/**
 * Max index candidates the funnel fetch-verifies per run (wall-clock budget).
 * Each survivor costs one HTTP fetch (≤8s); at INDEX_FUNNEL_CONCURRENCY in
 * flight this bounds the funnel's added latency. The verify pool is interleaved
 * by index first, so the cap stays source-diverse.
 */
export const INDEX_FUNNEL_MAX_VERIFY = 40;

/**
 * Max concurrent liveness fetches in the funnel. HTTP-only (no LLM), so this is
 * provider-agnostic — bounded modestly to avoid a burst of outbound requests.
 */
export const INDEX_FUNNEL_CONCURRENCY = 6;

/**
 * Wall-clock budget (ms) for the index-mining funnel. The funnel runs HTTP-only
 * liveness fetches (≈ ceil(INDEX_FUNNEL_MAX_VERIFY / INDEX_FUNNEL_CONCURRENCY)
 * rounds × the 8s per-fetch timeout in the worst case), and it runs BEFORE the
 * per-article LLM loops — so it must leave the post-discovery reserve intact for
 * body-fetch + scoring + concept extraction + the batch write. The pipeline
 * skips the funnel when less than this remains, and cuts it short via a race so
 * the batch always writes (graceful degradation — a shorter digest of real gems
 * beats a missed write).
 */
export const INDEX_FUNNEL_BUDGET_MS = 45_000;

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

/**
 * Max concurrent LLM calls in the per-article scoring/concept loops. Subordinate
 * to the shared rate limiter (R6-3), which sets the actual rate; this only caps
 * how many requests are in flight at once. Provider-aware (R6-5): 2 under Gemini
 * (gentler on the free tier's per-minute/concurrency ceilings), 4 for Anthropic
 * (unchanged).
 */
export const PIPELINE_LLM_CONCURRENCY = LLM_PROVIDER === 'gemini' ? 2 : 4;

/**
 * Max concurrent discovery candidates in body-extraction + LLM evaluation.
 * The loop was fully sequential, so one slow fetch/LLM call stalled the rest and
 * risked the pipeline wall-clock budget (R2-18). Kept modest to bound
 * simultaneous LLM calls and outbound fetches. Provider-aware (R6-5): 2 under
 * Gemini, 4 for Anthropic (unchanged).
 */
export const DISCOVERY_LLM_CONCURRENCY = LLM_PROVIDER === 'gemini' ? 2 : 4;

/**
 * Hard cap on per-article LLM calls (aesthetic scoring + concept extraction)
 * in a single pipeline run — a cost backstop if a feed explosion or retry
 * loop ever inflates the article pool (PIPE-M5). A normal run uses well
 * under half of this.
 */
export const MAX_LLM_EVALS_PER_RUN = 120;
