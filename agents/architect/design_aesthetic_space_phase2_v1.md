# Technical Design — Latent Aesthetic Space, Phase 2

**ID**: ARCH-DESIGN-AESTH-001
**Stories Reference**: `agents/pm/stories_aesthetic_space_phase2.md` (AESTH-001 through AESTH-015)
**BRD Reference**: `agents/ba/brd_aesthetic_space_phase2.md` (BRD-008)
**Date**: 2026-04-04
**Status**: Final
**Author**: Architect Agent

---

## Table of Contents

1. Architecture Overview
2. Group A — Aesthetic Dimension Schema
3. Group B — LLM Aesthetic Scoring
4. Group C — User Aesthetic Profile
5. Group D — Aesthetic-Aware Ranking
6. Group E — Cold-Start and Graceful Degradation
7. Key Decisions Table
8. External Dependencies and Environment Variables
9. Deferred Items
10. Directory Map

---

## 1. Architecture Overview

Phase 2 adds a new layer of understanding beneath source-level personalization.
Every article that completes the pipeline is scored along six aesthetic dimensions
by Claude Haiku using structured output. Scores are stored as `vector(6)` in
Postgres via pgvector. As the user gives feedback, a per-user centroid vector is
maintained via EMA. Feed ranking blends cosine similarity between the centroid and
each article's score (30%) with the existing source Wilson-score (70%).

No existing behavior changes for new users or for articles that arrive without
scores. The entire Phase 2 contribution degrades gracefully to zero, leaving the
pre-Phase-2 ranking intact in all fallback cases.

```
POST /api/pipeline/run
  |
  |-- runPipeline()
  |     |-- fixed-source fetch (RSS + NewsAPI)  [unchanged]
  |     |-- runDiscovery()                       [unchanged]
  |     |-- assemble combined article list       [unchanged]
  |     |-- scoreArticlesAesthetic()             [NEW — Phase 2]
  |     |     |-- for each article:
  |     |     |     |-- prepareInputText(article)
  |     |     |     |-- scoreAesthetic(text)     [calls Claude Haiku]
  |     |     |     |-- upsertArticleAestheticScore(article.id, scores)
  |     |     |     |-- on error: log + continue (article not dropped)
  |     |     |-- log scored/skipped counts + total ms
  |     |-- writeBatch()                         [unchanged]

POST /api/feedback
  |-- upsertFeedback()  [unchanged — primary operation]
  |-- updateAestheticProfile()  [NEW — Phase 2, synchronous]
  |     |-- getArticleAestheticScore(articleId)
  |     |-- if null: silent no-op (article pre-dates Phase 2)
  |     |-- if present: getAestheticProfile(identity)
  |     |-- compute new centroid via EMA formula
  |     |-- upsertAestheticProfile(identity, centroid, count)
  |     |-- on error: log + swallow (never fails the feedback POST)

GET /api/feed/today
  |-- readBatch()  [unchanged]
  |-- resolveSession()  [unchanged]
  |-- getFeedbackRows()  [unchanged]
  |-- getAestheticProfile(identity)   [NEW — Phase 2]
  |-- getArticleAestheticScores(ids)  [NEW — Phase 2, bulk query]
  |-- Promise.all([feedback, profile, scores])  [parallelized]
  |-- rankFeed(articles, feedbackRows, profile, scoreMap)  [extended]
  |-- strip discoveryTopic  [unchanged]
  |-- return FeedResponse  [shape unchanged]
```

The three new pieces — scorer, profile store, and ranker extension — are
independently testable and fail independently. No piece failing causes user-visible
breakage.

---

## 2. Group A — Aesthetic Dimension Schema

### Canonical Dimension Definitions

The six dimensions are defined in a single source-of-truth file:
`lib/config/aesthetic.ts`. This file is the only place where dimension keys,
labels, pole descriptions, and the canonical array index order are defined.

**Canonical index order (indices 0–5):**

| Index | Key | Label | Pole 1 (score=1) | Pole 5 (score=5) | Neutral (score=3) |
|-------|-----|-------|-----------------|-----------------|-------------------|
| 0 | `contemplative` | Contemplative / Propulsive | Highly propulsive — urgency, fast pacing, drives forward | Deeply contemplative — meditative, reflective, lingering | Neither particularly driven nor reflective |
| 1 | `concrete` | Concrete / Abstract | Highly concrete — examples, cases, sensory detail, people | Highly abstract — ideas, systems, principles, few anchors | Mix of concrete grounding and abstract reasoning |
| 2 | `personal` | Personal / Universal | Highly personal — first-person, author's experience at center | Highly universal — removed authority, journalism, research posture | Author present but not dominant |
| 3 | `playful` | Playful / Serious | Highly playful — humor, irony, wit, lightness | Highly serious — gravity, earnestness, no levity | Occasional wit without losing gravity |
| 4 | `specialist` | Specialist / Generalist | Highly generalist — accessible to curious non-experts | Highly specialist — assumes domain fluency, unexplained vocabulary | Technical vocabulary explained accessibly |
| 5 | `emotional` | Emotionally Resonant / Neutral | Emotionally neutral — information or argument without feeling | Emotionally resonant — beauty, wonder, melancholy, unease | Mild emotional texture without being felt strongly |

This canonical order must not change without a corresponding database migration
(the `vector(6)` columns store values positionally by this index order).

### TypeScript Types

**`AestheticScoreVector`** — named-field representation (used in application logic):

```typescript
// lib/types/aesthetic.ts
export interface AestheticScoreVector {
  contemplative: number;  // index 0
  concrete:      number;  // index 1
  personal:      number;  // index 2
  playful:       number;  // index 3
  specialist:    number;  // index 4
  emotional:     number;  // index 5
}

export interface AestheticProfile {
  user_id:        string | null;
  device_id:      string;
  centroid:       AestheticScoreVector;
  feedback_count: number;
  updated_at:     string;  // ISO-8601
}
```

**`vectorToArray(v: AestheticScoreVector): number[]`** — utility exported from
`lib/config/aesthetic.ts`. Returns `[v.contemplative, v.concrete, v.personal,
v.playful, v.specialist, v.emotional]`. This is the only place where the
index-to-key mapping is encoded.

**`arrayToVector(arr: number[]): AestheticScoreVector`** — inverse utility,
also in `lib/config/aesthetic.ts`. Used when reading from the database.

### Constants — `lib/config/aesthetic.ts`

All aesthetic tuning constants live in this new file (not in `lib/config/feed.ts`,
which is already large and covers unrelated concerns):

```typescript
export const AESTHETIC_ALPHA              = 0.2;   // EMA adaptation rate: 20% new, 80% prior
export const AESTHETIC_WEIGHT            = 0.3;   // Aesthetic proximity share of final rank score
export const SOURCE_SCORE_WEIGHT         = 0.7;   // Source Wilson-score share of final rank score
export const AESTHETIC_SCALE_MIN         = 1.0;   // Minimum valid score per dimension
export const AESTHETIC_SCALE_MAX         = 5.0;   // Maximum valid score per dimension
export const AESTHETIC_BODY_MIN_CHARS    = 300;   // Minimum bodyText length to use body as scorer input
export const AESTHETIC_BODY_MAX_CHARS    = 3000;  // Maximum characters sent to scorer LLM
```

A startup assertion checks that `SOURCE_SCORE_WEIGHT + AESTHETIC_WEIGHT === 1.0`.
This mirrors the existing assertion pattern in `lib/config/feed.ts`.

---

## 3. Group B — LLM Aesthetic Scoring

### Scorer Module

**File**: `lib/discovery/aestheticScorer.ts`

**Exported function**:

```typescript
export async function scoreAesthetic(input: string): Promise<AestheticScoreVector>
```

- `input` is a pre-prepared text string (truncated, caller's responsibility).
- Uses `claude-haiku-4-5-20251001` (same model as the Phase 1 LLM evaluator).
- Calls the Anthropic SDK with tool use (structured output), tool name: `score_aesthetic`.
- Throws a typed `AestheticScoringError` on any failure (network, API, malformed
  response, out-of-range values). The caller is responsible for catching and logging.
- Does not truncate or select text internally — the caller passes in the prepared string.

**Tool schema** (JSON Schema for the `score_aesthetic` tool input):

```json
{
  "name": "score_aesthetic",
  "description": "Score the supplied text on six aesthetic dimensions.",
  "input_schema": {
    "type": "object",
    "properties": {
      "contemplative": { "type": "number", "minimum": 1.0, "maximum": 5.0 },
      "concrete":      { "type": "number", "minimum": 1.0, "maximum": 5.0 },
      "personal":      { "type": "number", "minimum": 1.0, "maximum": 5.0 },
      "playful":       { "type": "number", "minimum": 1.0, "maximum": 5.0 },
      "specialist":    { "type": "number", "minimum": 1.0, "maximum": 5.0 },
      "emotional":     { "type": "number", "minimum": 1.0, "maximum": 5.0 }
    },
    "required": ["contemplative", "concrete", "personal", "playful", "specialist", "emotional"]
  }
}
```

**System prompt** (exact text to use):

```
You are a thoughtful literary editor with wide reading experience across all
genres and disciplines. Your task is to score a piece of writing on six
aesthetic dimensions that describe how the writing *feels* to read — not what
it is about or whether it is good.

Score each dimension on a continuous scale from 1.0 to 5.0:
- Use 3.0 for writing that is genuinely neutral on a dimension.
- Reserve 1.0 and 5.0 for writing that is clearly at an extreme.
- Decimal values (e.g., 2.5, 3.5, 4.0) are appropriate and encouraged.

The six dimensions:

1. contemplative (1=highly propulsive, 5=deeply contemplative)
   Propulsive: the piece moves quickly, builds urgency, drives the reader forward.
   Contemplative: the piece lingers, reflects, circles back, invites slowing down.

2. concrete (1=highly concrete, 5=highly abstract)
   Concrete: grounded in examples, cases, objects, people, sensory detail.
   Abstract: deals in ideas, systems, principles, frameworks with few anchors.

3. personal (1=highly personal, 5=highly universal)
   Personal: author's own experience, perspective, or memory is at the center.
   Universal: removed authoritative stance — research, journalism, argument.

4. playful (1=highly playful, 5=highly serious)
   Playful: humor, irony, wit, unexpected juxtaposition, lightness of touch.
   Serious: gravity, earnestness, weight — not somber, but without levity.

5. specialist (1=highly generalist, 5=highly specialist)
   Generalist: accessible to a curious non-expert; explains its terms.
   Specialist: assumes domain fluency; does not explain foundational vocabulary.

6. emotional (1=emotionally neutral, 5=emotionally resonant)
   Neutral: communicates information or argument with little emotional texture.
   Resonant: actively invites emotional engagement — wonder, melancholy, warmth.

Score the piece as it actually reads, not as the genre or subject would suggest.
A technical tutorial can be warmly personal. A political essay can be playfully
written. Judge the text, not the category.
```

**Error handling**: The module defines and exports a typed `AestheticScoringError`
class. On any failure, the scorer throws this error with a `cause` field containing
the original error. The caller in `lib/pipeline/run.ts` catches it.

**Out-of-range response handling**: After receiving the tool call response, the
scorer validates that each field is between 1.0 and 5.0 inclusive. If any field
is out of range, it throws `AestheticScoringError` with message
`"LLM returned out-of-range score for dimension: <name>"`.

**Estimated cost**: Claude Haiku at ~$0.25/MTok input, ~$1.25/MTok output.
Each call: ~600 tokens input (system prompt + article text) + ~50 tokens output
(six numbers). At 20 articles/day: ~650 × 20 = ~13,000 tokens/day =
~$0.003/day (~$1/year). Negligible.

### Pipeline Integration — `lib/pipeline/run.ts`

**New private function** added to `run.ts`:

```typescript
async function scoreArticlesAesthetic(articles: Article[]): Promise<void>
```

This function runs after the combined article list (`articles`) is assembled and
before `writeBatch()` is called. It:

1. Iterates articles sequentially (not in parallel — Anthropic rate limits).
2. Prepares input text: if `article.bodyText` exists and has ≥ 300 chars,
   uses first 3,000 chars of `bodyText`. Otherwise, uses
   `[article.title, article.description].filter(Boolean).join('. ')`.
3. Calls `scoreAesthetic(inputText)`.
4. On success: calls `upsertArticleAestheticScore(article.id, scores)`.
   Note: `article.id` is used as the key, consistent with how the rest of the
   system identifies articles. The `article.articleUrl` is NOT used as the PK
   in the DB despite the Architect prompt suggestion — see Key Decisions below.
5. On `AestheticScoringError`: logs
   `[aesthetic] SCORE_FAIL articleId=<id> url=<articleUrl> error=<message>`.
   Continues to next article. Does NOT write a null row — absent row = no score.
6. At end of loop: logs
   `[aesthetic] Run complete: scored=<N> skipped=<M> totalMs=<T>`.

The `articles` array is not mutated. The batch JSON on disk does not change.

### Database Schema

**Migration file**: `lib/db/migrations/009_aesthetic_scores.sql`

(Migration 008 is `008_seed_starter_sources.sql`. The next sequential number is 009.)

```sql
-- Migration 009: Aesthetic scoring tables for Phase 2 (Latent Aesthetic Space)
-- Requires: pgvector extension enabled in Neon (run: CREATE EXTENSION IF NOT EXISTS vector;)
-- Safe to re-run: all CREATE TABLE / CREATE INDEX use IF NOT EXISTS.

-- Confirm pgvector is available before proceeding.
-- If this statement fails, run: CREATE EXTENSION IF NOT EXISTS vector;
DO $$ BEGIN
  PERFORM 1 FROM pg_extension WHERE extname = 'vector';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pgvector extension is not installed. Run: CREATE EXTENSION IF NOT EXISTS vector;';
  END IF;
END $$;

-- Article aesthetic scores: one row per article, keyed by article ID.
CREATE TABLE IF NOT EXISTS article_aesthetic_scores (
  article_id   TEXT        NOT NULL PRIMARY KEY,  -- matches Article.id (<source-slug>-<8-char-hash>)
  scores       vector(6)   NOT NULL,              -- [contemplative, concrete, personal, playful, specialist, emotional]
  scored_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IVFFlat index for cosine similarity lookups.
-- NOTE: IVFFlat requires at least 100 rows to be useful. The index is created here
-- but will have no effect until the table has sufficient data. HNSW would also work
-- but is not needed at Phase 2 scale (O(20) articles/query, not O(millions)).
-- Remove or replace with HNSW in Phase 3+ if the corpus grows significantly.
CREATE INDEX IF NOT EXISTS idx_article_aesthetic_scores_cosine
  ON article_aesthetic_scores USING ivfflat (scores vector_cosine_ops);

-- User aesthetic profiles: one row per (user_id, device_id) identity pair.
CREATE TABLE IF NOT EXISTS user_aesthetic_profiles (
  id             SERIAL      PRIMARY KEY,
  user_id        TEXT,                            -- null for anonymous sessions
  device_id      TEXT        NOT NULL,            -- always present (matches dd_device_id cookie)
  centroid       vector(6),                       -- null until first qualifying feedback event
  feedback_count INTEGER     NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device_id)
);
```

**Key design decisions baked into the DDL:**

- Article scores are keyed by `article.id` (the `<source-slug>-<8-char-hash-of-url>`
  identifier), not by `article.articleUrl`. All other DB tables (feedback, topic
  weights) use this same ID. Using a different key would require a join with no
  benefit.
- The `user_aesthetic_profiles` identity design matches `discovery_topic_weights`:
  `user_id` nullable, `device_id` always present, UNIQUE on the pair.
- Null `centroid` is allowed and means "no profile yet" — this is distinct from an
  all-zeros vector and simplifies initialization logic.

### DB Helper Module

**File**: `lib/db/aesthetics.ts`

Exports:

```typescript
// Article aesthetic scores
export async function upsertArticleAestheticScore(
  articleId: string,
  scores: AestheticScoreVector
): Promise<void>

export async function getArticleAestheticScore(
  articleId: string
): Promise<AestheticScoreVector | null>

export async function getArticleAestheticScores(
  articleIds: string[]
): Promise<Map<string, AestheticScoreVector>>

// User aesthetic profiles
export async function getAestheticProfile(
  userId: string | null,
  deviceId: string
): Promise<AestheticProfile | null>

export async function upsertAestheticProfile(
  userId: string | null,
  deviceId: string,
  centroid: AestheticScoreVector,
  feedbackCount: number
): Promise<void>
```

**`getArticleAestheticScores`** is the bulk read path: it executes a single
`WHERE article_id = ANY(...)` query and returns a Map keyed by `articleId`.
Missing IDs are simply absent from the map (not null entries).

**Vector serialization**: The `scores vector(6)` column is read back from Neon
as a string like `"[1.5,3.0,2.5,4.0,2.0,3.5]"`. The helper parses this string
and constructs the `AestheticScoreVector` using `arrayToVector()` from
`lib/config/aesthetic.ts`.

**Vector write**: When inserting, the helper passes the array as a string literal
`"[1.5,3.0,...]"` using a tagged template literal compatible with the Neon driver.

---

## 4. Group C — User Aesthetic Profile

### Profile Update Logic — `app/api/feedback/route.ts`

After the existing `upsertFeedback()` call succeeds, the `POST /api/feedback`
handler calls a new private async function `updateAestheticProfile()` with the
identity, `articleId`, and feedback `value`. This call is `await`ed synchronously
before the response is returned. If it throws, the error is caught, logged, and
swallowed. The 200 response is returned regardless.

**`updateAestheticProfile` algorithm**:

```
1. score = await getArticleAestheticScore(articleId)
   If null: debug-log "no aesthetic score for article <id>, skipping EMA" and return.

2. profile = await getAestheticProfile(userId, deviceId)

3. If profile is null (first qualifying feedback event):
   If value === 'like':
     newCentroid = score (the article's score IS the initial centroid)
   If value === 'dislike':
     newCentroid = { each dimension: 6.0 - score[dimension] }
   feedbackCount = 1

4. If profile exists:
   alpha = AESTHETIC_ALPHA  (0.2)
   For each dimension d in [contemplative, concrete, personal, playful, specialist, emotional]:
     If value === 'like':
       newCentroid[d] = (1 - alpha) * profile.centroid[d] + alpha * score[d]
     If value === 'dislike':
       newCentroid[d] = (1 - alpha) * profile.centroid[d] + alpha * (6.0 - score[d])
   feedbackCount = profile.feedback_count + 1

5. await upsertAestheticProfile(userId, deviceId, newCentroid, feedbackCount)
```

**Atomicity**: Fetch-then-update in application code. Concurrent writes from two
devices are unlikely for a single-user app. If a race does occur, the later write
wins on the EMA — an acceptable outcome at Phase 2 scale.

### Profile Read Path — `app/api/feed/today/route.ts`

The handler parallelizes three DB reads using `Promise.all`:

```typescript
const [feedbackRows, aestheticProfile, aestheticScoreMap] = await Promise.all([
  fetchFeedback(session, deviceId),
  getAestheticProfile(userId, deviceId),
  getArticleAestheticScores(batch.articles.map(a => a.id)),
]);
```

On any failure in any of the three reads, the entire block is caught, and the feed
is served with null profile and empty score map (identical to pre-Phase-2 behavior).

`rankFeed` is updated to accept the profile and score map:

```typescript
export function rankFeed(
  articles: Article[],
  feedbackRows: DbFeedbackRow[],
  aestheticProfile: AestheticProfile | null,
  aestheticScoreMap: Map<string, AestheticScoreVector>
): Article[]
```

---

## 5. Group D — Aesthetic-Aware Ranking

### Cosine Similarity Utility

**File**: `lib/utils/cosineSimilarity.ts`

```typescript
export function cosineSimilarity(a: number[], b: number[]): number
```

- Takes two `number[]` arrays of equal length.
- Returns a value in [-1, 1].
- Zero-vector edge case: if either vector has magnitude 0, returns 0.0 (not NaN).
- Implementation: dot product divided by (magnitude_a × magnitude_b).

This is in-code, not via pgvector's `<=>` operator. Rationale: ranking operates
over O(20) articles per request — a SQL operator buys nothing and adds round-trip
complexity. The in-code utility is independently testable.

### Ranker Extension — `lib/pipeline/ranker.ts`

**Updated function signature**:

```typescript
export function rankFeed(
  articles: Article[],
  feedbackRows: DbFeedbackRow[],
  aestheticProfile?: AestheticProfile | null,
  aestheticScoreMap?: Map<string, AestheticScoreVector>
): Article[]
```

Both new parameters are optional. If absent or null, the function returns the
same result as before Phase 2.

**Blended score computation** (applied in Step 4 where articles are currently
sorted by source score):

```typescript
const centroidArray = aestheticProfile
  ? vectorToArray(aestheticProfile.centroid)
  : null;

function blendedScore(article: Article): number {
  const sourceScore = sourceScores.get(slugify(article.sourceName))!.score;
  if (!centroidArray) return sourceScore;

  const scoreVec = aestheticScoreMap?.get(article.id);
  const aestheticProximity = scoreVec
    ? cosineSimilarity(centroidArray, vectorToArray(scoreVec))
    : 0.0;

  return SOURCE_SCORE_WEIGHT * sourceScore + AESTHETIC_WEIGHT * aestheticProximity;
}
```

The sort in Step 4 uses `blendedScore(b) - blendedScore(a)` as the comparator.
All other steps (suppression check, exploration pool, diversity cap) are unchanged.

**Passing article scores into the ranker**: via the `Map<string, AestheticScoreVector>`
parameter keyed by `article.id`. The ranker never performs I/O. Missing keys in
the map return `undefined`, which is handled as 0.0 aesthetic proximity.

---

## 6. Group E — Cold-Start and Graceful Degradation

There is no special cold-start code path. The behavior emerges naturally:

- `getAestheticProfile()` returns `null` for a new user.
- `rankFeed()` receives `null` for `aestheticProfile`.
- `blendedScore()` sees `centroidArray = null` and returns `sourceScore` only.
- The formula collapses: `0.7 * sourceScore + 0.3 * 0.0 = 0.7 * sourceScore`.
- Ranking order is identical to pre-Phase-2 for any given set of source scores.

For unscored articles in a partially-scored batch:
- `aestheticScoreMap.get(article.id)` returns `undefined`.
- `aestheticProximity` is treated as `0.0`.
- The article competes on source score only — no grouping, no penalty beyond
  the missing aesthetic term.

A batch with zero scored articles sorts identically to the pre-Phase-2 output.

---

## 7. Key Decisions Table

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Aesthetic constants file | New `lib/config/aesthetic.ts` | `lib/config/feed.ts` covers pipeline quota and discovery tuning — adding aesthetic constants would mix unrelated concerns and make the file hard to reason about. A separate file matches the principle of one concern per config module. |
| Article score DB key | `article.id` (`<source-slug>-<8-char-hash>`) | All other tables (feedback, topic weights) use this same ID. Using `articleUrl` as PK would introduce a different key convention with no benefit and would require a join at query time. |
| Cosine similarity | In-code utility in `lib/utils/cosineSimilarity.ts` | Ranking is O(20) articles — no need for pgvector `<=>` operator. In-code is independently testable and has no round-trip cost. |
| EMA update location | Synchronous inside `POST /api/feedback`, after primary feedback write | Keeps the update in a single transaction-like sequence. Async/background would add complexity (queue, retry logic) for negligible latency benefit at single-user scale. |
| EMA update atomicity | Fetch-then-update in application code, no locking | Concurrent device writes are unlikely for a single-user app. If a race occurs, the later write wins — acceptable for a taste profile. SQL-level locking would add latency on every feedback event. |
| EMA update failure handling | Log + swallow (never fails the feedback POST) | Profile update is best-effort. A DB transient failure should not cause the user to see a 500 on a like/dislike action. |
| Scoring integration point | `lib/pipeline/run.ts`, after combined articles assembled, before `writeBatch()` | This is the only place where all articles (fixed + discovery) are co-located before the batch is written. Scoring inside `runDiscovery()` would miss fixed-source articles. |
| Scoring execution order | Sequential per-article (not parallel) | Anthropic API is rate-limited. Parallel calls at 20 articles would hit the concurrency limit. Sequential adds ~1s/article = ~20s to pipeline run — acceptable for a once-daily run. |
| Scoring failure behavior | Log per-article, continue, no null row written | Absent row = no score; the ranker treats both absent and null as 0.0 aesthetic proximity. Writing a null row would require an additional null-check column or a sentinel value. Absent row is cleaner. |
| Profile identity design | Matches `discovery_topic_weights`: `user_id` nullable + `device_id` always present, UNIQUE(user_id, device_id) | Consistent with the established identity routing pattern from Milestone 3. The existing helpers (`resolveSession`, `extractDeviceId`) produce exactly these two fields. |
| Migration number | `009_aesthetic_scores.sql` | `007_small_web_sources.sql` and `008_seed_starter_sources.sql` already exist. Next sequential number is 009. |
| Vector serialization from Neon | Parse string `"[1.5, 3.0, ...]"` in helper, not in ranker | Keeps serialization concerns inside the DB module. The ranker and scorer work with typed `AestheticScoreVector` objects throughout. |
| `rankFeed` signature | New optional parameters (profile, scoreMap) at end | Backward compatible. Existing callers with two arguments continue to compile and run without modification. |
| LLM model | `claude-haiku-4-5-20251001` | Same model used in Phase 1 LLM evaluator. Fast, cheap (~$1/year at Phase 2 volumes), sufficient for structured multi-dimensional scoring. |
| IVFFlat vs HNSW | IVFFlat with a comment noting the 100-row requirement | Phase 2 corpus is small (O(days × 20 articles)). IVFFlat is fine. The index is essentially a no-op at small scale. Comment in migration warns operator not to expect benefit until 100+ rows. HNSW could be swapped in if the corpus grows to thousands of articles in Phase 3+. |

---

## 8. External Dependencies and Environment Variables

No new environment variables are required. The existing `ANTHROPIC_API_KEY` and
`DATABASE_URL` are the only runtime dependencies for Phase 2.

No new npm packages are required. `@anthropic-ai/sdk` was installed in Phase 1
(AGDISC-TASK-001). The Neon `@neondatabase/serverless` driver and
`@neondatabase/serverless` types already handle the `vector` column type via
string serialization.

---

## 9. Deferred Items

| Item | Why Deferred |
|------|-------------|
| Retroactive scoring of pre-Phase-2 articles | Batch files on disk are not re-processed. Articles without scores rank on source score only, which is the correct pre-Phase-2 behavior. |
| User-visible aesthetic profile | No UI for aesthetic scores or the centroid vector in Phase 2. Internal signal only. |
| Batched LLM calls (multiple articles in one prompt) | Anthropic's tool use API does not support multiple independent tool calls in a single request. Scoring is inherently per-article. |
| Per-user adaptive alpha | Phase 2 uses a fixed alpha=0.2. A future phase could tune alpha based on feedback_count (e.g., higher alpha for sparse profiles). |
| HNSW index | Not needed at Phase 2 scale. IVFFlat with a comment suffices. |
| Phase 3: short-term/long-term preference fusion | Out of scope per BRD-008. Tracked in FUTURE-AESTH-006. |
| Natural language aesthetic feedback | Out of scope per BRD-008. Tracked in FUTURE-AESTH-003. |
| Cross-modal aesthetics (audio, video) | Out of scope per BRD-008. Tracked in FUTURE-AESTH-005. |

---

## 10. Directory Map

Expected file tree after all Phase 2 tasks are complete. New files are marked
`[NEW]`; modified files are marked `[MOD]`.

```
lib/
├── config/
│   ├── feed.ts                              [unchanged]
│   └── aesthetic.ts                         [NEW] — dimensions, constants, vectorToArray, arrayToVector
├── db/
│   ├── aesthetics.ts                        [NEW] — upsertArticleAestheticScore, getArticleAestheticScore,
│   │                                                 getArticleAestheticScores (bulk), getAestheticProfile,
│   │                                                 upsertAestheticProfile
│   ├── migrations/
│   │   ├── 007_small_web_sources.sql        [unchanged]
│   │   ├── 008_seed_starter_sources.sql     [unchanged]
│   │   └── 009_aesthetic_scores.sql         [NEW] — article_aesthetic_scores + user_aesthetic_profiles DDL
│   ├── client.ts                            [unchanged]
│   ├── auth.ts                              [unchanged]
│   ├── discovery.ts                         [unchanged]
│   └── feedback.ts                          [unchanged]
├── discovery/
│   └── aestheticScorer.ts                   [NEW] — scoreAesthetic(), AestheticScoringError
├── pipeline/
│   ├── ranker.ts                            [MOD] — extended rankFeed() signature + blended score
│   └── run.ts                               [MOD] — scoreArticlesAesthetic() added before writeBatch()
├── types/
│   ├── article.ts                           [unchanged]
│   └── aesthetic.ts                         [NEW] — AestheticScoreVector, AestheticProfile types
└── utils/
    └── cosineSimilarity.ts                  [NEW] — cosineSimilarity(a, b): number

app/
└── api/
    └── feedback/
        └── route.ts                         [MOD] — updateAestheticProfile() after upsertFeedback()
    └── feed/
        └── today/
            └── route.ts                     [MOD] — read profile + scores, pass to rankFeed()
```
