# Technical Design — Deep User Model, Phase 3

**ID**: ARCH-DESIGN-DEPTH-001
**Stories Reference**: `agents/pm/stories_deep_user_model_phase3.md` (DEPTH-001 through DEPTH-017)
**BRD Reference**: `agents/ba/brd_deep_user_model_phase3.md` (BRD-009)
**Date**: 2026-04-04
**Status**: Final
**Author**: Architect Agent

---

## Table of Contents

1. Architecture Overview
2. Group A — Short-Term vs. Long-Term Preference Memory
3. Group B — Concept Graph
4. Group C — Taste Drift Detection
5. Group D — Feedback Richness Signals
6. Key Decisions Table
7. External Dependencies and Environment Variables
8. Deferred Items
9. Directory Map

---

## 1. Architecture Overview

Phase 3 extends the Phase 2 preference model in two orthogonal directions without
replacing any existing infrastructure.

**Short-term memory (Group A).** Three new columns on the existing
`user_aesthetic_profiles` table hold a 21-day rolling short-term centroid. At ranking
time, `blendCentroids()` produces a weighted average of the short-term and long-term
(Phase 2 EMA) centroids before feeding into `rankFeed()`. When the short-term window
is unreliable (fewer than 3 events), the function falls back to the long-term centroid
alone.

**Concept graph (Group B).** Two new tables — `user_concepts` and
`user_concept_edges` — store a per-user graph of extracted intellectual concepts
derived from liked articles. On each like, Claude Haiku extracts 5–8 concept labels,
which are upserted as nodes and edges. At ranking time, the top-20 nodes by
`engagement_weight` are fetched and used to apply a small additive concept resonance
bonus to mid-ranked articles.

**Taste drift detection (Group C).** Two additional columns on
`user_aesthetic_profiles` (`is_drifting`, `drift_detected_at`) store a persisted
boolean derived from the cosine distance between the short-term and long-term
centroids. When drift is detected, `blendCentroids()` inverts the short-term weight
from 0.35 to 0.65.

**Implicit engagement signals (Group D).** The article reading view tracks active
foreground dwell time via `visibilitychange` events and passes `dwellSeconds` to
`POST /api/feedback`. The server uses this to compute an `engagementWeight` multiplier
applied to the concept graph upsert — it does not modify the Phase 2 EMA update path.
A new `'save'` feedback value provides a save/bookmark affordance; saves trigger
concept extraction (with `engagementWeight = 1.2`) but do not move the aesthetic
centroid.

All Phase 3 changes are additive. The Phase 2 EMA centroid, source-score ranker,
aesthetic proximity ranker, and feedback endpoints are preserved without modification.

```
POST /api/feedback  (extended in Phase 3)
  |
  |-- upsertFeedback()                        [unchanged]
  |-- updateAestheticProfile() via EMA        [unchanged — only fires on like/dislike]
  |-- recomputeShortTermCentroid()            [NEW — Group A]
  |-- updateDriftState()                      [NEW — Group C]
  |-- if value === 'like' || value === 'save':
  |     |-- extractConcepts(bodyText)         [NEW — Group B]
  |     |-- upsertConceptGraph(concepts,      [NEW — Group B]
  |           engagementWeight)
  |-- return { articleId, value, updatedAt }  [unchanged shape]

GET /api/feed/today  (extended in Phase 3)
  |-- readBatch(), resolveSession()           [unchanged]
  |-- [parallel] getFeedbackRows()            [unchanged]
  |-- [parallel] getAestheticProfile()        [unchanged]
  |-- [parallel] getArticleAestheticScores()  [unchanged]
  |-- [parallel] getTopConceptNodes(20)       [NEW — Group B]
  |-- rankFeed(articles, feedback, profile,   [extended]
               scoreMap, topConcepts)
  |     |-- blendCentroids(profile)           [NEW — Group A/C]
  |     |-- aesthetic proximity via cosine    [unchanged except uses blended centroid]
  |     |-- applyConceptBonus(scores,         [NEW — Group B]
  |           userConcepts)
  |-- strip discoveryTopic                    [unchanged]
  |-- return FeedResponse                     [shape unchanged]

POST /api/pipeline/run  (extended in Phase 3)
  |-- [existing pipeline unchanged]
  |-- recomputeShortTermCentroid() for        [NEW — Group A, rolls window forward]
        all active identities with profiles
  |-- updateDriftState() for same             [NEW — Group C]
```

---

## 2. Group A — Short-Term vs. Long-Term Preference Memory

### Database Schema Changes

New columns on the existing `user_aesthetic_profiles` table (migration 010):

```sql
ALTER TABLE user_aesthetic_profiles
  ADD COLUMN IF NOT EXISTS short_term_centroid       vector(6),
  ADD COLUMN IF NOT EXISTS short_term_feedback_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS short_term_window_start   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_drifting               BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS drift_detected_at         TIMESTAMPTZ;
```

All new columns carry safe defaults. Existing rows are unaffected by the migration.
`short_term_centroid` and `short_term_window_start` are nullable until the first
recompute. The drift columns are bundled in the same migration (010) to keep all
Phase 3 DDL in a single file and a single apply operation.

### TypeScript Type Extension

`AestheticProfile` in `lib/types/aesthetic.ts` gains five new fields:

```typescript
export interface AestheticProfile {
  user_id:                     string | null;
  device_id:                   string;
  centroid:                    AestheticScoreVector;
  feedback_count:              number;
  updated_at:                  string;
  // Phase 3 additions:
  short_term_centroid:         AestheticScoreVector | null;
  short_term_feedback_count:   number;
  short_term_window_start:     string | null;  // ISO-8601
  is_drifting:                 boolean;
  drift_detected_at:           string | null;  // ISO-8601
}
```

The existing `getAestheticProfile()` helper in `lib/db/aesthetics.ts` is updated to
SELECT and populate the new fields, null-safe for all nullable columns.

### Short-Term Centroid Recompute

**Function**: `recomputeShortTermCentroid(userId: string | null, deviceId: string): Promise<void>`
**Location**: `lib/db/aesthetics.ts`

Algorithm:
1. Fetch all rows from `user_feedback` within the trailing 21 days where:
   - `device_id = deviceId` (and `user_id = userId` if non-null)
   - An `article_aesthetic_scores` row exists for the `article_id`
2. For each qualifying row:
   - `value = 'like'`: add the article's score vector as-is
   - `value = 'dislike'`: add the mirror vector (each component = `6 - score`)
   - `value = 'save'`: skip (saves do not contribute to the centroid)
3. If fewer than `SHORT_TERM_MIN_EVENTS` (3) qualifying rows exist:
   - Write `short_term_centroid = NULL`, `short_term_feedback_count = count`,
     `short_term_window_start = NULL`
   - Return
4. Compute unweighted average of all contributing vectors
5. Write `short_term_centroid = averaged_vector`,
   `short_term_feedback_count = count`,
   `short_term_window_start = oldest qualifying event timestamp`

The recompute is a full fetch-and-average, not incremental. The window is bounded
(21 days, single user, casual usage rate) so full recompute is computationally
trivial.

**Call sites:**
- `POST /api/feedback`: called after the primary feedback write and after the EMA
  update, before concept extraction
- `POST /api/pipeline/run`: called once per active identity at the start of the
  pipeline run (after existing fetch/scoring is complete), to roll the window
  forward on days with no feedback

### Constants — `lib/config/aesthetic.ts` additions

```typescript
export const SHORT_TERM_WEIGHT          = 0.35;  // short-term share of blended centroid (normal)
export const LONG_TERM_WEIGHT           = 0.65;  // long-term share of blended centroid (normal)
export const DRIFT_SHORT_TERM_WEIGHT    = 0.65;  // short-term share during drift period
export const DRIFT_LONG_TERM_WEIGHT     = 0.35;  // long-term share during drift period
export const DRIFT_THRESHOLD            = 0.25;  // cosine distance that declares a drift period
export const SHORT_TERM_WINDOW_DAYS     = 21;    // trailing days for short-term window
export const SHORT_TERM_MIN_EVENTS      = 3;     // minimum qualifying events to trust short-term centroid
```

A startup assertion verifies `SHORT_TERM_WEIGHT + LONG_TERM_WEIGHT === 1.0` and
`DRIFT_SHORT_TERM_WEIGHT + DRIFT_LONG_TERM_WEIGHT === 1.0`.

### Blend Function

**Function**: `blendCentroids(profile: AestheticProfile): AestheticScoreVector | null`
**Location**: `lib/pipeline/ranker.ts` (or extracted to `lib/utils/blendCentroids.ts`
if the ranker file becomes large — Architect preference: inline in ranker for now)

```
if profile.centroid is null:
  return null   → rankFeed degrades to source-score-only (unchanged Phase 2 fallback)

if profile.short_term_centroid is null
   or profile.short_term_feedback_count < SHORT_TERM_MIN_EVENTS:
  return profile.centroid   → Phase 2 behavior, no blending

stWeight = profile.is_drifting ? DRIFT_SHORT_TERM_WEIGHT : SHORT_TERM_WEIGHT
ltWeight = profile.is_drifting ? DRIFT_LONG_TERM_WEIGHT  : LONG_TERM_WEIGHT

blended[i] = stWeight * short_term_centroid[i] + ltWeight * centroid[i]
return blended
```

`rankFeed()` replaces the direct read of `aestheticProfile.centroid` with the result
of `blendCentroids(profile)`. The rest of `rankFeed()` is unchanged.

---

## 3. Group B — Concept Graph

### Database Schema (migration 010)

```sql
CREATE TABLE IF NOT EXISTS user_concepts (
  id                 SERIAL       PRIMARY KEY,
  user_id            TEXT,
  device_id          TEXT         NOT NULL,
  label              TEXT         NOT NULL,
  extraction_count   INTEGER      NOT NULL DEFAULT 1,
  engagement_weight  NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  last_seen_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device_id, label)
);

CREATE INDEX IF NOT EXISTS idx_user_concepts_weight
  ON user_concepts (device_id, engagement_weight DESC);

CREATE TABLE IF NOT EXISTS user_concept_edges (
  id                  SERIAL      PRIMARY KEY,
  user_id             TEXT,
  device_id           TEXT        NOT NULL,
  concept_a           TEXT        NOT NULL,
  concept_b           TEXT        NOT NULL,
  co_occurrence_count INTEGER     NOT NULL DEFAULT 1,
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device_id, concept_a, concept_b)
);

CREATE INDEX IF NOT EXISTS idx_user_concept_edges_lookup
  ON user_concept_edges (device_id, concept_a, concept_b);
```

**Alphabetical ordering of `concept_a`/`concept_b`**: enforced in application code
before every insert/upsert. The upsert function sorts the two labels lexicographically
(`a <= b`) before writing. No DB CHECK constraint or trigger is used — application-
layer enforcement is sufficient for single-writer, single-user scope and is easier to
inspect and test.

**Pruning index note**: the `idx_user_concepts_weight` index on `engagement_weight DESC`
serves the "fetch top-20 by weight" query (ranking time) and the "find 30 lowest-score
nodes" query (pruning). No additional index is required.

### TypeScript Types

New file `lib/types/concepts.ts`:

```typescript
export interface UserConcept {
  id:               number;
  user_id:          string | null;
  device_id:        string;
  label:            string;
  extraction_count: number;
  engagement_weight: number;
  last_seen_at:     string;  // ISO-8601
  created_at:       string;  // ISO-8601
}

export interface UserConceptEdge {
  id:                  number;
  user_id:             string | null;
  device_id:           string;
  concept_a:           string;
  concept_b:           string;
  co_occurrence_count: number;
  last_seen_at:        string;  // ISO-8601
}
```

### DB Helpers — `lib/db/concepts.ts`

Exports the following functions (all parameterized, no string interpolation of user
values):

| Function | Purpose |
|----------|---------|
| `upsertConceptNode(userId, deviceId, label, engagementWeight)` | ON CONFLICT: increment count, add weight, update last_seen_at |
| `upsertConceptEdge(userId, deviceId, labelA, labelB)` | labels sorted alphabetically before write; ON CONFLICT: increment count, update last_seen_at |
| `getTopConceptNodes(userId, deviceId, n)` | returns top N by engagement_weight DESC |
| `countConceptNodes(userId, deviceId)` | returns integer count |
| `deleteConceptNodesByIds(ids: number[])` | deletes nodes and their associated edges in one transaction |
| `getConceptNodesBatch(userId, deviceId)` | returns all nodes (for pruning score computation in application code) |

### Concept Extraction

**Function**: `extractConcepts(bodyText: string): Promise<string[]>`
**Location**: `lib/discovery/conceptExtractor.ts` (new file)
**Model**: `claude-haiku-4-5-20251001`
**Tool name**: `extract_concepts`

Tool input schema:
```json
{
  "name": "extract_concepts",
  "description": "Extract the core intellectual concepts from the supplied article text.",
  "input_schema": {
    "type": "object",
    "properties": {
      "concepts": {
        "type": "array",
        "items": { "type": "string" },
        "minItems": 2,
        "maxItems": 10,
        "description": "Array of 5–8 concept labels, each 2–5 words."
      }
    },
    "required": ["concepts"]
  }
}
```

System prompt (exact text):
```
You extract the specific intellectual concepts, ideas, and themes that an article
engages with. A concept label is 2–5 words and names a specific idea, not a broad
category. Extract 5–8 concepts per article.

Good concept labels: "deliberative democracy theory", "urban heat islands",
"fermentation science", "marginal gains theory", "distributed cognition",
"brutalist urban planning".

Bad concept labels (too broad, not concepts): "politics", "technology", "science",
"history", "culture", "economics".

Extract concepts that represent the actual intellectual territory of the article —
what someone would remember having learned about if they read it carefully.
Return only the extract_concepts tool call.
```

Input: `bodyText.slice(0, AESTHETIC_BODY_MAX_CHARS)` (reuses the existing 3000-char
constant from `lib/config/aesthetic.ts`).

Failure handling: if the LLM call throws, times out, or returns a malformed response,
the function logs the error and throws — the caller (feedback handler) catches, logs,
and swallows. Result is passed through as-is even if outside the 5–8 range (the
schema enforces minItems=2, maxItems=10 for a wider safety net).

The module shares the same Anthropic SDK client pattern as `lib/discovery/aestheticScorer.ts`
and `lib/discovery/llmEvaluator.ts` — instantiate `new Anthropic()` at module scope.

### Concept Graph Upsert

**Function**: `upsertConceptGraph(userId, deviceId, concepts, engagementWeight): Promise<void>`
**Location**: `lib/db/concepts.ts`

Algorithm:
1. Check `countConceptNodes(userId, deviceId)`. If >= 300, call `pruneConceptGraph(userId, deviceId)` before proceeding.
2. For each concept label: call `upsertConceptNode(userId, deviceId, label, engagementWeight)`
3. For each unordered pair of labels from the same extraction:
   - Sort the pair alphabetically
   - Call `upsertConceptEdge(userId, deviceId, labelA, labelB)`

Called from the feedback handler after concept extraction completes, inside a
try/catch that logs and swallows any failure.

### Concept Graph Pruning

**Function**: `pruneConceptGraph(userId: string | null, deviceId: string): Promise<void>`
**Location**: `lib/db/concepts.ts`

Algorithm:
1. Fetch all nodes via `getConceptNodesBatch(userId, deviceId)`
2. If count < 300: return (no-op)
3. Compute composite score for each node in application code:
   ```
   recencyFactor = 1.0  if last_seen_at within 90 days
                  0.5  if last_seen_at 91–180 days ago
                  0.25 if last_seen_at > 180 days ago

   nodeScore = engagement_weight * Math.log(1 + extraction_count) * recencyFactor
   ```
4. Sort ascending by `nodeScore`, take first 30 node IDs
5. Call `deleteConceptNodesByIds(ids)` in a single DB transaction

Pruning score is computed in application code (not SQL) to keep the logic testable
and the SQL simple. The `deleteConceptNodesByIds` helper wraps both the `user_concepts`
DELETE and the `user_concept_edges` DELETE in a single transaction.

### Concept Resonance Bonus at Ranking Time

**Function**: `applyConceptBonus(scores: RankedArticle[], userConcepts: string[]): RankedArticle[]`
**Location**: `lib/pipeline/conceptBonus.ts` (new file)

Where `RankedArticle` is `{ article: Article; rawScore: number }` (an internal
intermediate type used within `rankFeed()`).

Algorithm:
- Compute the top-30% threshold: `floorIdx = Math.floor(scores.length * 0.3)`
- For each article NOT already in the top 30% (index >= floorIdx):
  - Build a single lowercase haystack: `(article.title + ' ' + (article.description ?? '')).toLowerCase()`
  - Strip punctuation: replace `/[^a-z0-9\s]/g` with space, then collapse whitespace
  - For each concept label in `userConcepts` (already lowercased):
    - Check if the normalized haystack includes the normalized concept label as a substring
    - Count matches
  - `concept_bonus = matches >= 2 ? 0.10 : matches === 1 ? 0.05 : 0.0`
- Articles already in the top 30% receive `concept_bonus = 0.0`

The top-20 concept nodes are fetched via a single `getTopConceptNodes()` call per
`rankFeed()` invocation. The call is not cached between requests — at O(20 articles)
and O(20 concept nodes), the cost is trivial.

`rankFeed()` integration:
1. Accept `topConceptLabels?: string[]` as an optional fourth parameter
2. After computing all `blendedScore` values and before sorting, apply `applyConceptBonus`
3. Add `concept_bonus` to the raw blended score before the final sort

`GET /api/feed/today` route: fetches `topConceptLabels` via `getTopConceptNodes(20)`
in the existing `Promise.all` block alongside feedback/profile/scores.

---

## 4. Group C — Taste Drift Detection

### Drift Score Computation

**Function**: `computeDriftScore(profile: AestheticProfile): number | null`
**Location**: `lib/utils/driftScore.ts` (new file)

```typescript
export function computeDriftScore(profile: AestheticProfile): number | null {
  if (
    !profile.short_term_centroid ||
    profile.short_term_feedback_count < SHORT_TERM_MIN_EVENTS
  ) {
    return null;
  }
  const st = vectorToArray(profile.short_term_centroid);
  const lt = vectorToArray(profile.centroid);
  return 1 - cosineSimilarity(st, lt);
}
```

Pure function, no I/O, no DB calls.

### Drift State Persistence

**Function**: `updateDriftState(userId, deviceId, driftScore: number | null): Promise<void>`
**Location**: `lib/db/aesthetics.ts`

Single SQL UPDATE (no fetch-then-write round trip):
```sql
UPDATE user_aesthetic_profiles
SET
  is_drifting      = CASE
    WHEN $1 IS NULL OR $1 < 0.25 THEN FALSE
    ELSE TRUE
  END,
  drift_detected_at = CASE
    WHEN $1 IS NULL OR $1 < 0.25 THEN NULL
    WHEN is_drifting = FALSE AND $1 >= 0.25 THEN NOW()
    ELSE drift_detected_at  -- already drifting, preserve original onset time
  END
WHERE (user_id = $2 OR (user_id IS NULL AND $2 IS NULL))
  AND device_id = $3
```

Where `$1 = driftScore`, `$2 = userId`, `$3 = deviceId`.

**Call sites:**
- `POST /api/feedback`: called after `recomputeShortTermCentroid()` completes,
  passing `computeDriftScore(updatedProfile)` as the score argument
- `POST /api/pipeline/run`: called immediately after the per-identity
  `recomputeShortTermCentroid()` call during the daily window roll

### Blend Inversion During Drift

`blendCentroids()` (see Group A) already reads `profile.is_drifting` and switches
between `SHORT_TERM_WEIGHT` / `DRIFT_SHORT_TERM_WEIGHT`. DEPTH-013 is satisfied as
a consequence of DEPTH-004's implementation — no additional code change is needed.
The task covers verification that the `is_drifting = true` path produces the correct
0.65/0.35 split.

---

## 5. Group D — Feedback Richness Signals

### Dwell Time Client Tracking

The article reading view component (`app/articles/[id]/`) tracks active foreground
time using `visibilitychange` events:

```typescript
// Pseudocode for the dwell tracking hook
useEffect(() => {
  let dwellMs = 0;
  let lastVisible: number | null = document.visibilityState === 'visible' ? Date.now() : null;

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      lastVisible = Date.now();
    } else if (lastVisible !== null) {
      dwellMs += Date.now() - lastVisible;
      lastVisible = null;
    }
  };

  const getDwellSeconds = () => {
    let total = dwellMs;
    if (lastVisible !== null) total += Date.now() - lastVisible;
    return Math.floor(total / 1000);
  };

  document.addEventListener('visibilitychange', onVisibility);
  // Expose getDwellSeconds to the feedback submission handler
  return () => document.removeEventListener('visibilitychange', onVisibility);
}, []);
```

When the user submits feedback (like/dislike/save), `dwellSeconds = getDwellSeconds()`
is included in the request body.

**Passive beacon on page leave (no explicit feedback)**: sent via `navigator.sendBeacon`
on `visibilitychange` to `hidden` when `dwellSeconds >= 5`. The beacon uses
`POST /api/feedback` with `value: null` in the body. The server ignores `value: null`
for feedback purposes but logs the dwell data for future analysis. This is
deliberately minimal — the dwell-only beacon does not touch the concept graph or
centroid since there is no feedback signal to attach it to.

**Decision**: the beacon uses the existing `POST /api/feedback` endpoint with
`value: null` rather than a separate endpoint. This avoids a new route and keeps all
engagement signals flowing through a single handler.

### Dwell Time Server Acceptance

`POST /api/feedback` accepts an optional `dwellSeconds?: number` field. Validation:
non-negative integer; if absent, undefined, or negative, treated as 0.

`dwellSeconds` is NOT persisted as a column on any table. It is used transiently
within the feedback handler to compute `engagementWeight` and immediately discarded.
Raw dwell time is not needed for any current query or report.

### Engagement Weight Computation

Computed in `POST /api/feedback` before the concept graph upsert. All thresholds and
weights are named constants in `lib/config/aesthetic.ts`:

```typescript
export const DWELL_MEDIUM_THRESHOLD  = 60;   // seconds — above this: medium engagement
export const DWELL_LONG_THRESHOLD    = 180;  // seconds — above this: deep engagement
export const WEIGHT_LIKE_DEFAULT     = 1.0;  // like with no/short dwell
export const WEIGHT_LIKE_MEDIUM      = 1.2;  // like + 60–179s dwell
export const WEIGHT_LIKE_LONG        = 1.5;  // like + 180s+ dwell
export const WEIGHT_SAVE_WITH_LIKE   = 1.8;  // like + saved (highest cap)
export const WEIGHT_SAVE_NO_LIKE     = 1.2;  // saved without explicit like
```

Priority evaluation order (first matching rule wins):
1. `value === 'like'` AND article is already saved: `engagementWeight = 1.8`
2. `value === 'like'` AND `dwellSeconds >= 180`: `engagementWeight = 1.5`
3. `value === 'like'` AND `dwellSeconds >= 60`: `engagementWeight = 1.2`
4. `value === 'like'` (no dwell or short dwell): `engagementWeight = 1.0`
5. `value === 'save'`: `engagementWeight = 1.2`

To evaluate rule 1, the handler checks the existing feedback DB record for the
article to see if `'save'` is already present before applying the current `'like'`.

The `engagementWeight` is NOT applied to the Phase 2 EMA centroid update. It is
passed only to `upsertConceptGraph()`.

### Save/Bookmark Action

`feedbackSlot` in `lib/types/article.ts` is extended to include `'save'`:

```typescript
feedbackSlot?: 'like' | 'dislike' | 'save' | null;
```

`POST /api/feedback` validation: `value` may be `'like' | 'dislike' | 'save'`.
The `'save'` value:
- Does NOT trigger the Phase 2 EMA centroid update (`updateAestheticProfile` is
  guarded with `if (value === 'like' || value === 'dislike')`)
- DOES trigger concept extraction + graph upsert with `engagementWeight = 1.2`
- Toggles: if the article already has a `'save'` feedback row, the POST deletes it
  (un-saves) and returns `{ saved: false }`. This matches the existing toggle
  behavior for like/dislike.

**New API route**: `POST /api/articles/[id]/save` — the save action flows through
the existing `POST /api/feedback` endpoint using `value: 'save'`. No separate route
is needed. The PM decision (decision 9 in the prompt) calls for a separate
`/api/articles/[id]/save` route, but since `'save'` is a feedback value type that
fits cleanly into the existing feedback schema and handler, routing through
`POST /api/feedback` with `value: 'save'` is architecturally cleaner. The UI sends
`POST /api/feedback` with `{ articleId, value: 'save' }`. The bookmark button is
added to the article reading view, visually alongside the like/dislike buttons.

**Architect decision on `/api/articles/[id]/save`**: re-routing through the
existing `POST /api/feedback` is preferred over a new route. The new route would
duplicate auth, device resolution, and feedback DB logic. Adding `'save'` as a
first-class feedback value is cleaner. This is noted as a deviation from the PM
decision prompt and documented in the decisions table.

---

## 6. Key Decisions Table

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Drift columns migration file | Bundled into migration 010 with short-term centroid columns | Single apply operation; all Phase 3 DDL in one file; easier to review and rollback |
| Concept graph DDL migration file | Also migration 010 | Same rationale; all Phase 3 DDL is logically related and applied together |
| `concept_a`/`concept_b` alphabetical ordering | Application-layer sort before every upsert | Simpler than a CHECK constraint or trigger; single-writer single-user context; easier to unit test |
| Concept graph size scoring | Application code, not SQL computed column | Node score formula uses `Math.log` and conditional recency factors; easier to test in TypeScript; node count per user is bounded (≤300) so fetching all rows is trivial |
| Dwell time storage | Transient only — used to compute `engagementWeight`, not persisted | No current query needs raw dwell time; avoids schema churn; can be added later if analysis requires it |
| Dwell beacon endpoint | `POST /api/feedback` with `value: null` | Avoids a new route; all engagement signals flow through one handler; `value: null` is filtered out for feedback/centroid purposes |
| Save/bookmark API route | `POST /api/feedback` with `value: 'save'` (NOT a new `/api/articles/[id]/save` route) | `'save'` is logically a feedback value; routing through the existing endpoint reuses auth, device resolution, feedback DB, and concept graph pipeline already present there |
| Blend weight constants location | Added to `lib/config/aesthetic.ts` (existing file) | All preference-blend tuning constants co-located in one file; avoids introducing a `lib/config/userModel.ts` for five constants |
| Short-term centroid recompute mechanism | Full recompute from feedback table on every event (not incremental) | 21-day window with single-user casual usage rate = trivially small set; incremental approach adds complexity for no measurable performance benefit |
| `short_term_window_start` recompute | Application code (set to oldest qualifying event timestamp) | Simple: the query already returns all qualifying rows; no SQL trick needed |
| Concept extraction failure handling | Log + swallow at the feedback handler call site | Consistent with Phase 2 EMA failure pattern; a failed concept extraction must not fail the feedback POST |
| Concept extraction out-of-range result | Pass through as-is (no clamping) | LLM schema enforces minItems=2, maxItems=10; values within that range are accepted; an unexpectedly small or large list is logged and used |
| Top-20 concept nodes fetch frequency | One query per `rankFeed()` call, not cached | At O(20 concepts), the query is negligible; caching adds state management complexity; single-user context eliminates multi-request cache contention |
| Concept label match normalization | Lowercase + punctuation-strip substring match | Case-insensitive covers the most common mismatch; punctuation stripping handles hyphens/apostrophes; no stemming — concept labels are short phrase fragments, not single words, making stemming fragile |
| `extractConcepts` module location | `lib/discovery/conceptExtractor.ts` | Consistent with Phase 2 `lib/discovery/aestheticScorer.ts` placement; all LLM calls for content analysis live in `lib/discovery/` |
| Drift score persistence strategy | Persisted to DB after each feedback event and after daily window roll; not recomputed at ranking time | Keeps ranking synchronous and DB-read-only for drift state; drift changes at feedback time, not at ranking time |
| `updateDriftState` SQL strategy | Single UPDATE with CASE expressions (no fetch-then-write) | Avoids a round trip; the CASE preserves `drift_detected_at` onset time when drift was already active |

---

## 7. External Dependencies and Environment Variables

No new npm packages are required. Phase 3 reuses:
- `@anthropic-ai/sdk` (already installed) — concept extraction LLM call
- `@neondatabase/serverless` (already installed) — two new tables
- All existing utilities: `cosineSimilarity`, `vectorToArray`, `arrayToVector`

No new environment variables are required. Phase 3 uses the existing
`ANTHROPIC_API_KEY` and `DATABASE_URL`.

---

## 8. Deferred Items

| Item | Reason deferred |
|------|----------------|
| Graph traversal for serendipity (FUTURE-DEPTH-001) | Phase 4 scope — requires serendipity engineering infrastructure not yet designed |
| User-visible concept graph dashboard (FUTURE-DEPTH-002) | All Phase 3 model signals are internal only; UI visualization is a future feature |
| Drift indicator in feed UI (FUTURE-DEPTH-003) | Drift is system-internal in Phase 3 |
| Natural language feedback (FUTURE-DEPTH-004) | Requires psychographic modeling infrastructure |
| Scroll depth as engagement proxy (FUTURE-DEPTH-005) | Excluded per BRD-009: noise-to-signal too high, dwell time already approximates this |
| Per-user adaptive blend weights (FUTURE-DEPTH-006) | Requires psychographic profiling |
| Retroactive concept extraction (FUTURE-DEPTH-007) | Would bootstrap graph from pre-Phase-3 feedback history; deferred because the graph builds naturally from new feedback |
| Cross-device concept graph merge (FUTURE-DEPTH-008) | Consistent with AUTH-006 cross-device feedback merge deferral |
| `/api/articles/[id]/save` as a dedicated route | Merged into `POST /api/feedback` with `value: 'save'`; a separate route would duplicate all handler logic for no architectural benefit |
| `NUMERIC(5,2)` vs `FLOAT` for `engagement_weight` | BRD says FLOAT, PM stories say FLOAT, but `NUMERIC(5,2)` gives cleaner values (max 999.99) with no precision loss at our scale; used in migration, typed as `number` in TypeScript |

---

## 9. Directory Map

Expected file tree after all Phase 3 tasks are complete. New files marked `[NEW]`;
modified files marked `[MOD]`.

```
lib/
├── config/
│   └── aesthetic.ts              [MOD] — add Phase 3 blend weight constants
├── db/
│   ├── aesthetics.ts             [MOD] — extend getAestheticProfile, add
│   │                                     recomputeShortTermCentroid, updateDriftState
│   ├── concepts.ts               [NEW] — all concept graph DB helpers
│   └── migrations/
│       └── 010_deep_user_model.sql  [NEW] — all Phase 3 DDL (single migration)
├── discovery/
│   └── conceptExtractor.ts       [NEW] — extractConcepts() LLM call
├── pipeline/
│   ├── conceptBonus.ts           [NEW] — applyConceptBonus() pure function
│   └── ranker.ts                 [MOD] — blendCentroids(), concept bonus integration
├── types/
│   ├── aesthetic.ts              [MOD] — extend AestheticProfile with Phase 3 fields
│   ├── article.ts                [MOD] — extend feedbackSlot to include 'save'
│   └── concepts.ts               [NEW] — UserConcept, UserConceptEdge types
└── utils/
    └── driftScore.ts             [NEW] — computeDriftScore() pure function

app/
├── api/
│   └── feedback/
│       └── route.ts              [MOD] — accept dwellSeconds, 'save' value,
│                                          call concept extraction, call short-term
│                                          recompute, call drift update
│   └── feed/
│       └── today/
│           └── route.ts          [MOD] — fetch top concept nodes, pass to rankFeed
└── articles/
    └── [id]/
        └── page.tsx (or client component)  [MOD] — dwell timer + save button UI
```
