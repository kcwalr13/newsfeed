# Technical Design — Engineered Serendipity, Phase 4

**ID**: ARCH-DESIGN-SEREN-001
**Stories Reference**: `agents/pm/stories_engineered_serendipity_phase4.md` (SEREN-001 through SEREN-022)
**BRD Reference**: `agents/ba/brd_engineered_serendipity_phase4.md` (BRD-010)
**Date**: 2026-04-04
**Status**: Final
**Author**: Architect Agent

---

## Table of Contents

1. Architecture Overview
2. Group A — Surprise Scoring via Semantic Distance
3. Group B — Active Learning via Blind Spot Probing
4. Group C — Structured Exploration Budget and Slot Assembly
5. Group D — Psychographic Modulation via Receptivity Signal
6. Key Decisions Table
7. External Dependencies and Environment Variables
8. Deferred Items
9. Directory Map

---

## 1. Architecture Overview

Phase 4 adds a deliberate exploration layer on top of the Phase 3 ranking system.
It does not replace any Phase 3 infrastructure. The concept graph, aesthetic centroids,
source-score ranker, and all feedback endpoints are preserved without modification.

**The core change is to `rankFeed()`.** Phase 4 converts it from a single-pool ranker
into a two-pool ranker:

- The **exploitation pool** (16 articles at baseline) is filled using the unchanged
  Phase 3 formula: `0.7 * source_score + 0.3 * aesthetic_proximity + concept_bonus`.
- The **exploration pool** (4 articles at baseline) is filled from three typed sub-pools
  ranked by serendipity score: semantic stretch, blind spot probe, and wildcard.

The serendipity score is computed as a pre-pass inside the `rankFeed()` orchestration:
for every candidate article, extract concepts at pipeline time (not just on likes),
classify each concept against the user's concept graph as known/adjacent/unknown,
compute a raw surprise score, normalize the LLM quality score as a quality weight,
and multiply to produce the final serendipity score.

**Active learning (Group B)** runs at pipeline time. Unknown concept labels across all
candidates are clustered into thematic blind spots by a single LLM call. The most
underrepresented eligible cluster provides the blind spot probe article. Probe tracking
is stored in a new `blind_spot_clusters` DB table. Like/dislike/ignore on probes
updates cluster state (promotion, suppression, ignore count).

**Receptivity modulation (Group D)** is fully transient. Three signals are computed
from existing DB data at feed-request time: topic diversity of recent liked articles,
probe acceptance rate, and exploration dwell ratio. These combine into a receptivity
score that maps to an exploration budget in [2, 6].

```
POST /api/pipeline/run   (unchanged structure; Phase 4 pre-pass inside run.ts)
  |
  |-- [existing pipeline: discovery, fixed sources, aesthetic scoring]
  |-- [NEW, Group A] extractConceptsForCandidates(articles)
  |       ↓ candidateConcepts: Map<articleId, string[]>
  |-- writeBatch(articles + Phase 4 probe metadata)  [extended in Group B]

GET /api/feed/today   (extended in Phase 4)
  |-- readBatch(), resolveSession()           [unchanged]
  |-- [parallel] getFeedbackRows()            [unchanged]
  |-- [parallel] getAestheticProfile()        [unchanged]
  |-- [parallel] getArticleAestheticScores()  [unchanged]
  |-- [parallel] getTopConceptNodes(20)       [unchanged]
  |-- [parallel] getAllConceptNodes() + getConceptEdges()  [NEW — Group A]
  |-- [parallel] computeReceptivityInputs()   [NEW — Group D; reads feedback + dwell + probe history]
  |-- rankFeed(articles, feedback, profile, scoreMap, topConcepts,
               allConcepts, allEdges, receptivityInputs)  [extended]
  |     |-- blendCentroids(profile)                       [unchanged]
  |     |-- Phase 3 exploit scores (source + aesthetic + concept bonus)  [unchanged]
  |     |-- [NEW] extractedConcepts = concepts already in batch JSON (from pipeline)
  |     |-- [NEW] classifyConceptDistance(articleConcepts, allConcepts, allEdges)
  |     |-- [NEW] computeRawSurprise(classifications)
  |     |-- [NEW] normalizeQualityWeight(article.llmScore)
  |     |-- [NEW] computeSerendipityScore(rawSurprise, qualityWeight)
  |     |-- [NEW] identifyBlindSpotClusters(unknownConcepts) → clusters
  |     |-- [NEW] selectProbeArticle(clusters, blindSpotState)
  |     |-- [NEW] buildSlotPools(candidates, serendipityScores, probeArticle)
  |     |-- [NEW] budget = receptivityToBudget(receptivityScore)
  |     |-- [NEW] assembleExplorationSlots(pools, budget)
  |     |-- [NEW] deduplicate(explorationSlots, exploitCandidates)
  |     |-- [NEW] interleave(exploitTop-N, explorationSlots)
  |-- strip internal fields (discoveryTopic, probeType, slotType)  [extended]
  |-- return FeedResponse                     [shape unchanged]

POST /api/feedback   (extended in Phase 4)
  |-- [all Phase 3 logic unchanged]
  |-- [NEW] if article was a blind spot probe:
  |         if like:  upsertClusterPromotion()
  |         if dislike: upsertClusterSuppression()
  |-- [NEW] probe response isolation (failures logged, never surface to caller)
```

---

## 2. Group A — Surprise Scoring via Semantic Distance

### LLM Quality Score — Confirmed Range

**Confirmed from `lib/discovery/llmEvaluator.ts`**: The `evaluateWithLLM()` function
returns `LLMEvalResult`. On success, `scores.composite` is the arithmetic mean of five
integer dimensions, each scored 1–5. The composite is therefore in **[1.0, 5.0]**.

The `qualityGate.ts` file is a boolean pass/fail gate (Gates 1–3: missing fields,
freshness, domain blocklist) and does NOT produce a numeric score. The numeric signal
is `llmScore` (the composite from `llmEvaluator.ts`), which is stored on the `Article`
object and persisted in the batch JSON.

**Quality weight normalization:**
```
quality_weight = 0.5 + ((llm_score - 1.0) / (5.0 - 1.0)) * 0.5
               = 0.5 + (llm_score - 1.0) * 0.125
```
- `llm_score = 1.0` → `quality_weight = 0.5`
- `llm_score = 5.0` → `quality_weight = 1.0`
- Scores outside [1.0, 5.0] are clamped.

### TypeScript Type Extensions

The `Article` type gains two new `@internal` fields:

```typescript
// In lib/types/article.ts — additions:

/**
 * LLM composite quality score (arithmetic mean of five 1–5 dimensions).
 * Set by llmEvaluator.ts at pipeline time. Range: [1.0, 5.0].
 * Absent for fixed-source articles that skip LLM evaluation.
 * Never sent to the client. @internal
 */
llmScore?: number;

/**
 * Serendipity score for this article, computed at pipeline time.
 * Range: [0.0, 1.0] = raw_surprise * quality_weight.
 * Transient on the Article object during rankFeed(); never written to batch JSON.
 * @internal
 */
serendipityScore?: number;

/**
 * Slot type assigned at feed assembly time.
 * 'semantic_stretch' | 'blind_spot_probe' | 'wildcard' | null (for exploitation articles).
 * Transient on the Article object; never sent to the client.
 * Written to batch JSON at batch-write time for analytics only.
 * @internal
 */
explorationSlotType?: 'semantic_stretch' | 'blind_spot_probe' | 'wildcard' | null;

/**
 * Probe tracking: set when this article was selected as a blind spot probe.
 * Carries the originating cluster label.
 * Never sent to the client; stripped from API responses alongside discoveryTopic.
 * @internal
 */
probeInfo?: { probeType: 'blind_spot'; clusterLabel: string } | null;
```

**Note on `llmScore` persistence**: The `llmScore` field is already computed by
`llmEvaluator.ts` and returned as `scores.composite` on each discovery article. It must
be stored in the batch JSON so that the serendipity scorer can access it at feed-request
time. Dev must confirm whether it is already persisted; if not, `lib/pipeline/run.ts`
must be updated to copy `llmResult.scores.composite` into `article.llmScore` before
`writeBatch()`. Fixed-source (RSS/NewsAPI) articles that bypass LLM evaluation will have
`llmScore = undefined`; these articles receive `quality_weight = 0.75` (midpoint) as a
safe default.

### New Files: `lib/pipeline/serendipityScorer.ts`

Contains four pure functions:

```typescript
// 1. Concept distance classification
export type ConceptDistance = 'known' | 'adjacent' | 'unknown';

export interface ConceptClassification {
  label: string;
  distance: ConceptDistance;
}

// Accepts pre-fetched concept labels and edge pairs for this user.
// Issues zero DB queries — all data passed in.
export function classifyConceptDistance(
  articleConcepts: string[],
  knownLabels: Set<string>,           // all node labels for user (pre-fetched)
  edgePairs: Array<[string, string]>  // all [concept_a, concept_b] for user (pre-fetched)
): ConceptClassification[]

// 2. Raw surprise score: (unknown * 1.0 + adjacent * 0.5) / total
export function computeRawSurprise(
  classifications: ConceptClassification[]
): number   // [0.0, 1.0]

// 3. Quality weight normalization
// llmScore: 1.0–5.0 (or undefined → 0.75 default)
export function normalizeQualityWeight(
  llmScore: number | undefined
): number   // [0.5, 1.0]

// 4. Final serendipity score
export function computeSerendipityScore(
  rawSurprise: number,
  qualityWeight: number
): number   // [0.0, 1.0]
```

### Concept Extraction at Pipeline Time

**Location**: `lib/pipeline/run.ts`, as a post-assembly pass after `writeBatch()`.

Phase 3 already calls `extractConcepts()` in `POST /api/feedback` on liked articles.
For Phase 4, the same `extractConcepts()` function from `lib/discovery/conceptExtractor.ts`
is called at pipeline time on **all candidate articles** after quality scoring, before
the batch is written.

The extracted concepts are stored as `article.extractedConcepts?: string[]` on each
`Article` in the batch JSON. This is an `@internal` field, stripped from API responses
alongside `discoveryTopic`. By storing in the batch JSON, feed-request time does not
re-call the LLM.

Extraction failures: article gets `extractedConcepts = []` (empty array). Raw surprise
defaults to 0.0. This is consistent with Phase 1/2/3 failure isolation patterns.

**LLM call budget at pipeline time (SEREN-017 AC5):**
- One `extractConcepts()` call per candidate article (N calls)
- One LLM batch call for blind spot clustering (1 call)
- No additional per-article LLM calls
Total: N + 1 LLM calls per pipeline run.

### New DB Helpers: `lib/db/concepts.ts` extension

Two new functions are added to the existing `lib/db/concepts.ts`:

```typescript
// Returns all concept node labels for the given identity as a Set<string>.
// Used by serendipity scorer to classify candidate concepts.
export async function getAllConceptLabels(
  userId: string | null,
  deviceId: string
): Promise<Set<string>>

// Returns all concept edge pairs [concept_a, concept_b] for the given identity.
// Used by serendipity scorer to classify adjacent concepts.
export async function getAllConceptEdges(
  userId: string | null,
  deviceId: string
): Promise<Array<[string, string]>>
```

These issue one DB query each. Both are called in parallel with other feed-request-time
DB reads.

---

## 3. Group B — Active Learning via Blind Spot Probing

### Database Schema

New migration: `lib/db/migrations/011_serendipity.sql`

```sql
-- Migration 011: Engineered Serendipity — Phase 4
-- BRD-010 | Stories: SEREN-006 through SEREN-012

CREATE TABLE IF NOT EXISTS blind_spot_clusters (
  id               SERIAL       PRIMARY KEY,
  user_id          TEXT,
  device_id        TEXT         NOT NULL,
  cluster_label    TEXT         NOT NULL,
  status           TEXT         NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'suppressed', 'promoted')),
  suppress_until   TIMESTAMPTZ,
  promote_until    TIMESTAMPTZ,
  probe_count      INTEGER      NOT NULL DEFAULT 0,
  like_count       INTEGER      NOT NULL DEFAULT 0,
  dislike_count    INTEGER      NOT NULL DEFAULT 0,
  ignore_count     INTEGER      NOT NULL DEFAULT 0,
  last_probed_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device_id, cluster_label)
);

CREATE INDEX IF NOT EXISTS idx_blind_spot_clusters_device_status
  ON blind_spot_clusters(device_id, status);

ALTER TABLE user_aesthetic_profiles
  ADD COLUMN IF NOT EXISTS receptivity_score   NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS exploration_budget  INTEGER NOT NULL DEFAULT 4;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS exploration_slot_type TEXT
    CHECK (exploration_slot_type IN ('semantic_stretch', 'blind_spot_probe', 'wildcard'));
```

**Notes on the `articles` DDL**: The `articles` table column is for post-hoc analytics
only. It is written at batch write time. It does not need to exist for Phase 4 to
function — `explorationSlotType` is transient on the `Article` object during
`rankFeed()`. This column can be omitted if the `articles` table is not a Postgres
table (if articles are file-backed only, skip this ALTER entirely and note in the
migration file).

**File-backed architecture note**: Since the system uses JSON files for batch storage,
the `articles` table column is advisory. The `explorationSlotType` field is written to
the batch JSON for analytics, and the `articles` ALTER in the migration can be a no-op
or skipped.

### `blind_spot_clusters` State Machine

```
                         ┌──────────────────────────────────────┐
                         │                                      │
              like        ▼          30 days expire             │
 created ─► active ────► promoted ◄─────────────────────────── │
              │               │                                  │
           dislike          suppress_until expires              │
              │                    │                            │
              ▼                    ▼                            │
         suppressed ──── 30 days ─► active (reduced priority)  │
                                                                 │
              ignore × 2 ──► active (14-day reduced priority)  │
                                                                 │
```

**Cluster identity**: The `cluster_label` is the LLM-provided thematic cluster name
(a short English string, e.g., "urban ecology"). It is stored as-is and matched
case-insensitively. No hash is used — the LLM names are stable enough for single-user
scale, and readability in DB queries is preferred.

**Promotion + suppression coexistence on same cluster**: If a like arrives while a
cluster is in `suppressed` status, the suppression is cleared immediately and the
cluster is set to `promoted` with `promote_until = NOW() + 14 days`. The like is
a stronger signal than the suppression timer.

**Post-suppression reduced priority**: After `suppress_until` expires, the cluster
status is reset to `active` at next pipeline run. Priority reduction is represented by
the cumulative `dislike_count` on the cluster row. SEREN-007's selection logic
deprioritizes clusters with `dislike_count > 0` relative to clusters with
`dislike_count = 0`, using the following tie-breaker in selection order:
1. Promoted clusters (status = `promoted` and `promote_until` in the future)
2. Never-suppressed clusters (`dislike_count = 0`)
3. Previously-suppressed clusters (`dislike_count > 0`, ordered by average raw surprise DESC)

**Ignore tracking — "aged out" determination**: At pipeline time, when
`buildSlotPools()` runs, any probe article from the previous run that has no feedback
and is not in the current batch (date < today) is treated as ignored. Dev implements
this by checking: for each `probeInfo` entry in yesterday's batch JSON, if no `like` or
`dislike` feedback row exists for that article, increment `ignore_count` for the
relevant cluster.

### New File: `lib/db/blindSpots.ts`

Contains all `blind_spot_clusters` DB helpers:

```typescript
export interface BlindSpotCluster {
  id:              number;
  user_id:         string | null;
  device_id:       string;
  cluster_label:   string;
  status:          'active' | 'suppressed' | 'promoted';
  suppress_until:  string | null;  // ISO-8601
  promote_until:   string | null;  // ISO-8601
  probe_count:     number;
  like_count:      number;
  dislike_count:   number;
  ignore_count:    number;
  last_probed_at:  string | null;  // ISO-8601
  created_at:      string;         // ISO-8601
}

// Returns all clusters for user, filtering out currently-suppressed ones.
export async function getEligibleClusters(
  userId: string | null, deviceId: string
): Promise<BlindSpotCluster[]>

// Upsert a cluster row (creates if absent, updates last_probed_at + probe_count).
export async function upsertCluster(
  userId: string | null, deviceId: string, clusterLabel: string
): Promise<void>

// Record a like on a probe: clears suppression, sets status='promoted',
// sets promote_until = NOW() + 14 days, increments like_count.
export async function recordProbeClusterPromotion(
  userId: string | null, deviceId: string, clusterLabel: string
): Promise<void>

// Record a dislike on a probe: sets status='suppressed',
// sets suppress_until = NOW() + 30 days, increments dislike_count.
export async function recordProbeClusterSuppression(
  userId: string | null, deviceId: string, clusterLabel: string
): Promise<void>

// Record an ignore event on a probe: increments ignore_count.
// Caller checks if ignore_count >= 2 for consecutive ignores and sets
// suppress_until = NOW() + 14 days with status='suppressed'.
export async function recordProbeClusterIgnore(
  userId: string | null, deviceId: string, clusterLabel: string
): Promise<void>

// At pipeline time: resets status to 'active' for all clusters whose
// suppress_until or promote_until has passed.
export async function expireClusterTimers(
  userId: string | null, deviceId: string
): Promise<void>
```

### New File: `lib/pipeline/blindSpotProber.ts`

Handles blind spot cluster identification and probe selection:

```typescript
// SEREN-006: groups unknown concept labels into thematic clusters via LLM.
// Returns clusters with >= 3 distinct backing articles, or [] if too few unknowns.
export async function identifyBlindSpotClusters(
  unknownConceptsByArticle: Map<string, string[]>  // articleId → unknown concept labels
): Promise<Array<{
  clusterLabel: string;
  memberConcepts: string[];
  backingArticleIds: string[];
  avgRawSurprise: number;
}>>

// SEREN-007: selects the probe article from the most underrepresented eligible cluster.
export function selectProbeArticle(
  clusters: ReturnType<typeof identifyBlindSpotClusters> extends Promise<infer T> ? T : never,
  eligibleDbClusters: BlindSpotCluster[],  // from getEligibleClusters()
  serendipityScores: Map<string, number>,  // articleId → serendipityScore
  articles: Article[]
): { article: Article; clusterLabel: string } | null

// SEREN-012: at pipeline time, detect and record ignores for prior-day probe articles.
export async function processPriorDayProbeIgnores(
  userId: string | null,
  deviceId: string,
  yesterdayBatch: ArticleBatch,
  feedbackRows: DbFeedbackRow[]
): Promise<void>
```

### LLM Clustering Call (SEREN-006)

A single LLM call groups all unknown concept labels into thematic areas. The call uses
`claude-haiku-4-5-20251001` (same model as all Phase 1–3 LLM calls) with structured
output via tool use.

**Tool schema:**
```typescript
{
  name: 'group_concepts',
  input_schema: {
    type: 'object',
    properties: {
      clusters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            cluster_label: { type: 'string' },    // e.g. "urban ecology"
            member_concepts: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['cluster_label', 'member_concepts']
        }
      }
    },
    required: ['clusters']
  }
}
```

The LLM prompt passes all unknown concept labels (newline-separated), asks the model
to group them into broad thematic clusters of 2–8 words each, and allows an "other"
catch-all cluster for miscellaneous labels. The output is validated: each `cluster_label`
must be a non-empty string; any item failing validation is dropped silently (consistent
with Phase 1–3 LLM failure isolation).

### Probe Metadata in Batch JSON

The `Article` type gains `probeInfo?: { probeType: 'blind_spot'; clusterLabel: string } | null`
(defined in Section 2 above). This field is written to the batch JSON for the probe article
only. Non-probe articles omit the field entirely (not null, absent).

`explorationSlotType` is also written to the batch JSON for all exploration articles.

Both fields are stripped from API responses in `GET /api/feed/today` and
`GET /api/articles/[id]` alongside `discoveryTopic`.

---

## 4. Group C — Structured Exploration Budget and Slot Assembly

### New File: `lib/config/serendipity.ts`

All Phase 4 constants in a dedicated module (not added to `lib/config/feed.ts`):

```typescript
// Exploration budget bounds
export const EXPLORATION_BASELINE  = 4;  // default daily exploration slot count
export const EXPLORATION_FLOOR     = 2;  // minimum regardless of receptivity
export const EXPLORATION_CEILING   = 6;  // maximum regardless of receptivity
export const WILDCARD_SLOT_COUNT   = 1;  // wildcard is always exactly 1

// Slot type allocation table (budget → slot counts)
// Expressed as a lookup to avoid ambiguity in formula derivation.
export const SLOT_ALLOCATION: Record<number, {
  semanticStretch: number;
  blindSpotProbe: number;
  wildcard: number;
}> = {
  2: { semanticStretch: 1, blindSpotProbe: 0, wildcard: 1 },
  3: { semanticStretch: 2, blindSpotProbe: 0, wildcard: 1 },
  4: { semanticStretch: 2, blindSpotProbe: 1, wildcard: 1 },
  5: { semanticStretch: 3, blindSpotProbe: 1, wildcard: 1 },
  6: { semanticStretch: 3, blindSpotProbe: 2, wildcard: 1 },
};

// Receptivity score thresholds
export const RECEPTIVITY_THRESHOLDS = [
  { max: 0.30, budget: 2 },
  { max: 0.55, budget: 3 },
  { max: 0.70, budget: 4 },
  { max: 0.85, budget: 5 },
  { max: 1.00, budget: 6 },
] as const;

// Receptivity component weights
export const RECEPTIVITY_WEIGHT_DIVERSITY        = 0.40;
export const RECEPTIVITY_WEIGHT_PROBE_ACCEPTANCE = 0.35;
export const RECEPTIVITY_WEIGHT_DWELL_RATIO      = 0.25;

// Dwell ratio cap
export const DWELL_RATIO_CAP = 1.5;

// Minimum data points before defaulting (rather than inferring from sparse data)
export const RECEPTIVITY_DIVERSITY_MIN_LIKES  = 3;  // 7-day window
export const RECEPTIVITY_PROBE_MIN_SHOWN      = 3;  // 14-day window
export const RECEPTIVITY_DWELL_MIN_POINTS     = 3;  // per pool
```

**Why not `lib/config/feed.ts`**: The Phase 4 constants (12 named values + a lookup
table) are substantial enough to warrant their own module. `lib/config/feed.ts`
covers pipeline quota and discovery — mixing serendipity/receptivity constants would
conflate unrelated concerns.

### New File: `lib/pipeline/explorationAssembler.ts`

Handles the three-pool construction and slot assembly (SEREN-014, SEREN-015,
SEREN-016):

```typescript
export interface ExplorationPools {
  semanticStretch: Article[];  // sorted by serendipityScore DESC
  blindSpotProbe: Article[];   // 0 or 1 article
  wildcard: Article[];         // sorted by llmScore DESC
}

// SEREN-014: build three typed pools from the full candidate set
export function buildSlotPools(
  candidates: Article[],
  serendipityScores: Map<string, number>,
  conceptClassifications: Map<string, ConceptClassification[]>,
  probeArticle: Article | null
): ExplorationPools

// SEREN-015: fill exploration slots from pools for the given budget
export function assembleExplorationSlots(
  pools: ExplorationPools,
  budget: number                // from receptivityToBudget() or EXPLORATION_BASELINE
): Article[]                    // exactly min(budget, available) articles

// SEREN-016: deduplicate exploration vs. exploitation candidates
export function deduplicateExploitPool(
  explorationSlots: Article[],
  exploitCandidates: Article[]   // Phase 3 ranked candidates
): Article[]                    // exploitCandidates with exploration articles removed

// Tag each selected exploration article with its slot type (in-memory only)
export function tagExplorationSlotTypes(
  explorationSlots: Article[],
  pools: ExplorationPools
): void   // mutates explorationSlotType field on each article
```

### Feed Interleaving Pattern (SEREN-017 AC3)

Exploration articles are distributed across the feed using a deterministic spacing
pattern, not random insertion. The pattern is: for a feed of 20 articles with N
exploration slots, exploration articles are inserted at evenly spaced positions
computed as `Math.round(i * 20 / N)` for i in [0, N-1], offset by 2 to avoid position 0.
This produces natural distribution without clustering exploration articles together.

For example, at baseline (4 exploration slots in 20 articles):
- Positions (0-indexed): 2, 7, 12, 17 (approximately every 5 articles)

### `rankFeed()` Integration

The Phase 4 serendipity flow is added to `rankFeed()` as a pre-pass that runs after
existing Phase 3 score computation (blendedScore, conceptBonus) but before final sorting.
The function signature is extended:

```typescript
export function rankFeed(
  articles: Article[],
  feedbackRows: DbFeedbackRow[],
  aestheticProfile?: AestheticProfile | null,
  aestheticScoreMap?: Map<string, AestheticScoreVector>,
  topConceptLabels?: string[],
  // Phase 4 additions:
  allConceptLabels?: Set<string>,         // all graph node labels for user
  allConceptEdges?: Array<[string,string]>,// all graph edges for user
  explorationBudget?: number              // from receptivityToBudget(), defaults to EXPLORATION_BASELINE
): Article[]
```

The existing exploitation logic (Steps 1–9 in the current implementation) is
preserved intact. Steps 4–9 now operate on the exploitation sub-pool (articles not
selected for exploration).

**Graceful degradation (SEREN-017 AC4)**: When `allConceptLabels` is undefined or
empty, `classifyConceptDistance()` classifies all concepts as "unknown" (raw surprise
= 1.0 for all articles). Exploration slots are filled primarily from the wildcard pool
(quality-first). This is the correct behavior for new users.

---

## 5. Group D — Psychographic Modulation via Receptivity Signal

### New File: `lib/pipeline/receptivity.ts`

Contains signal computation and budget mapping:

```typescript
// SEREN-018: topic diversity score
// Queries feedback history for 7-day window.
export async function computeDiversityScore(
  userId: string | null,
  deviceId: string
): Promise<number>   // [0.0, 1.0]

// SEREN-019: probe acceptance rate
// Queries feedback history + batch JSON probe flags for 14-day window.
export async function computeProbeAcceptanceRate(
  userId: string | null,
  deviceId: string
): Promise<number>   // [0.0, 1.0]

// SEREN-020: exploration dwell ratio
// Queries dwell time data, filtered to articles with explorationSlotType != null.
export async function computeDwellRatio(
  userId: string | null,
  deviceId: string
): Promise<number>   // [0.0, 1.5]

// SEREN-021: receptivity score assembly (pure function)
export function computeReceptivity(
  diversityScore: number,
  probeAcceptanceRate: number,
  dwellRatio: number
): number   // [0.0, 1.0]

// SEREN-022: budget mapping (pure function)
// Returns EXPLORATION_BASELINE (4) when called without a valid receptivity score.
export function receptivityToBudget(
  receptivityScore: number | null
): number   // [EXPLORATION_FLOOR, EXPLORATION_CEILING]
```

### Receptivity Storage

`receptivity_score NUMERIC(4,3)` and `exploration_budget INTEGER NOT NULL DEFAULT 4`
are added to `user_aesthetic_profiles` (in migration 011). They are updated in
`POST /api/feedback` alongside the EMA update, after the Phase 3 feedback writes
complete. Both default to neutral values until sufficient data exists.

**Why store receptivity**: It is recomputed fresh on each feed request (transient use
for `rankFeed()`), but persisted for observability and future use. The persistence does
not affect correctness — `rankFeed()` always calls the computation functions directly.

### Diversity Score — Cluster Identification (SEREN-018 AC2)

Phase 3 does not explicitly store cluster assignments on concept nodes. The diversity
score uses a simple proxy: each distinct concept label in a liked article's
`extractedConcepts` array (stored in batch JSON from Phase 4) is treated as a cluster
unit. `distinct_clusters` = count of distinct concept labels across all liked articles
in the 7-day window; `liked_count` = count of liked articles in the window.

This proxy is coarser than connected-component analysis but is consistent with
single-user scale constraints and does not require a graph traversal at query time.

### Probe Acceptance Rate — Data Source (SEREN-019)

The probe acceptance rate queries:
1. The feedback table for like/dislike events in the trailing 14 days.
2. The batch JSON files for the same 14 days, reading `probeInfo` fields to identify
   which articles were probes.

Articles with `probeInfo.probeType === 'blind_spot'` that have a like feedback row
= `probe_likes`. Total probe articles in window = `probes_shown`.

### Dwell Ratio — Data Source (SEREN-020)

Dwell time data is currently stored transiently (Phase 3 decision: not persisted).
Phase 4 requires it for dwell ratio computation. This requires Phase 3's dwell beacon
(`POST /api/feedback` with `value: null`) to persist dwell seconds to a new DB column.

**Decision**: Add `dwell_seconds NUMERIC(7,2)` to `user_feedback` table (also in
migration 011). The `POST /api/feedback` handler already accepts `dwellSeconds` as an
optional field; it currently uses it only for `engagementWeight` computation without
persisting. Phase 4 updates the handler to also persist `dwell_seconds` when present.

To identify which articles were exploration vs. exploitation, the dwell query joins
against the batch JSON's `explorationSlotType` field (read from batch file on disk).

```sql
-- Additional DDL in migration 011:
ALTER TABLE user_feedback
  ADD COLUMN IF NOT EXISTS dwell_seconds NUMERIC(7,2);
```

---

## 6. Key Decisions Table

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Quality score source for serendipity | `LLMScores.composite` from `lib/discovery/llmEvaluator.ts` (range 1.0–5.0) | `qualityGate.ts` is boolean-only; `llmEvaluator.ts` is the actual numeric scorer. Confirmed by reading both files. |
| Quality weight normalization formula | `0.5 + (llm_score - 1.0) * 0.125` | Linear mapping of [1.0, 5.0] → [0.5, 1.0] per BRD requirement. Bottom-bound of 0.5 ensures high-surprise articles are never zeroed. |
| Fixed-source articles without llmScore | Default quality_weight = 0.75 | Midpoint of [0.5, 1.0]; conservative neutral assumption. RSS/NewsAPI articles bypass LLM evaluation. |
| Serendipity integration point | Pre-pass inside `rankFeed()`, after existing Phase 3 blendedScore computation | Keeps all ranking logic co-located; preserves Phase 3 exploitation formula unchanged; avoids external pre-pass that would need to share state across call boundaries. |
| Feed interleaving | Deterministic evenly-spaced positions (not random) | Reproducible; avoids clustering exploration at start or end of feed; easier to verify in tests. |
| Concept extraction timing | At pipeline time, stored in batch JSON as `extractedConcepts` | Avoids per-request LLM calls; serendipity scorer reads stored concepts from batch. One LLM call per candidate article per run (acceptable within existing pipeline cadence). |
| `llmScore` storage | Added to `Article` type as `@internal` field, persisted in batch JSON | Already computed at pipeline time; free to store alongside other Article fields; consistent with `discoveryTopic` precedent. |
| `explorationSlotType` storage | Transient on `Article` object during `rankFeed()`; written to batch JSON at assembly time; `articles` table column for analytics only | Transient is sufficient for receptivity dwell ratio (reads batch JSON files); DB column enables future SQL analytics without changing the architecture. |
| `probeInfo` field design | Single optional field `probeInfo?: { probeType: 'blind_spot'; clusterLabel: string }` | Extensible if other probe types are added in future; cluster label co-located for feedback routing without extra lookup. |
| Blind spot cluster identity | LLM-provided cluster label string | Human-readable; stable enough for single-user; avoids hash computation; easy to inspect in DB. |
| Promotion + suppression same cluster | Like during suppression clears suppression and promotes immediately | Like is a stronger signal than suppression timer; user's positive response should not be delayed. |
| Post-suppression reduced priority | Cumulative `dislike_count` field, used as tie-breaker in selection | No extra column needed; selection order is deterministic; `dislike_count > 0` correctly identifies previously-suppressed clusters. |
| Ignore "aged out" determination | Next pipeline run checks prior-day probe articles with no feedback | Consistent with once-daily cadence; no background job needed; implemented in `processPriorDayProbeIgnores()`. |
| Receptivity storage | `receptivity_score` + `exploration_budget` columns on `user_aesthetic_profiles` | Updated in feedback handler for observability; recomputed fresh on each feed request for correctness. |
| Diversity score cluster proxy | Distinct concept labels per liked article (not connected-component analysis) | Phase 3 does not store cluster assignments; label-level proxy is sufficient at single-user scale without graph traversal. |
| Dwell time persistence | New `dwell_seconds` column on `user_feedback` (migration 011) | Required for SEREN-020 dwell ratio computation; Phase 3 computed engagementWeight transiently but never persisted raw dwell seconds for future use. |
| Serendipity constants location | New `lib/config/serendipity.ts` | Phase 4 has 12+ constants plus a lookup table — substantial enough for its own module; avoids polluting `lib/config/feed.ts` with unrelated concerns. |
| Probe concept weight on like | Same `engagementWeight` as ordinary likes (1.0 default) | No separate code path; concept graph update is via the existing `upsertConceptGraph()` call. Phase 3's engagement weight already captures dwell time modulation if present. |
| P0 before Group D | Group C (slot assembly) ships before Group D (receptivity) | `receptivityToBudget(null)` returns `EXPLORATION_BASELINE` (4); exploration slots work correctly before receptivity is implemented. |
| `articles` table ALTER in migration 011 | Advisory for analytics; can be skipped if articles table does not exist | The system uses file-backed batch storage. The `exploration_slot_type` column is only needed for SQL analytics, not runtime operation. |

---

## 7. External Dependencies and Environment Variables

No new external dependencies or environment variables are introduced in Phase 4.

All LLM calls use the existing `claude-haiku-4-5-20251001` model via `ANTHROPIC_API_KEY`
(already required since Phase 1).

All DB operations use the existing `DATABASE_URL` Neon connection.

**LLM call volume increase**: Phase 4 adds one `extractConcepts()` call per candidate
article per pipeline run plus one clustering call. At 20 candidates per run and one run
per day, this is ~21 additional Haiku calls per day. Current usage is already ~20/day
from Phase 2 aesthetic scoring. Total rises to ~40 Haiku calls/day — well within the
free tier and well below any practical cost concern at single-user scale.

---

## 8. Deferred Items

| Item | Reason Deferred |
|------|-----------------|
| Vector embedding-based semantic distance | Hop-distance on the concept graph is sufficient at single-user scale. Embeddings add infrastructure complexity (pgvector queries per article) with marginal benefit. |
| User-visible exploration indicators | Non-goal in BRD-010. All Phase 4 behavior is system-internal. |
| "Why this is here" explanations | Deferred to a future phase per BRD-010. |
| User-configurable exploration budget | Non-goal in BRD-010. System controls exploration level. |
| Real-time / sub-daily receptivity updates | All Phase 4 computation runs at pipeline time or feed-request time per BRD-010 cadence. |
| Cross-device blind spot state merge | Depends on multi-user infrastructure. |
| Scroll depth as engagement proxy | BRD-010 out of scope. |
| Retroactive serendipity scoring | Not needed for forward operation. |
| `articles` table `exploration_slot_type` column | Runtime operation does not depend on it. Dev may skip the ALTER and note it as analytics-only. |

---

## 9. Directory Map

Files to create or modify as a result of Phase 4 tasks:

```
lib/
├── config/
│   └── serendipity.ts              ← NEW  (SEREN-TASK-002)
├── db/
│   ├── blindSpots.ts               ← NEW  (SEREN-TASK-006)
│   ├── concepts.ts                 ← MODIFY  add getAllConceptLabels, getAllConceptEdges (SEREN-TASK-003)
│   ├── migrations/
│   │   └── 011_serendipity.sql     ← NEW  (SEREN-TASK-001)
│   └── aesthetics.ts               ← MODIFY  persist receptivity_score + exploration_budget (SEREN-TASK-013)
├── discovery/
│   └── conceptExtractor.ts         ← MODIFY  expose for pipeline-time use (SEREN-TASK-004, already exists)
├── pipeline/
│   ├── blindSpotProber.ts          ← NEW  (SEREN-TASK-007)
│   ├── explorationAssembler.ts     ← NEW  (SEREN-TASK-009)
│   ├── ranker.ts                   ← MODIFY  Phase 4 pre-pass + extended signature (SEREN-TASK-010)
│   ├── receptivity.ts              ← NEW  (SEREN-TASK-012)
│   ├── run.ts                      ← MODIFY  pipeline-time concept extraction + llmScore storage (SEREN-TASK-005)
│   └── serendipityScorer.ts        ← NEW  (SEREN-TASK-003)
├── types/
│   └── article.ts                  ← MODIFY  add llmScore, serendipityScore, explorationSlotType, probeInfo (SEREN-TASK-003)
app/
└── api/
    ├── feed/
    │   └── today/
    │       └── route.ts            ← MODIFY  parallel concept graph reads, receptivity, strip new internal fields (SEREN-TASK-011)
    └── feedback/
        └── route.ts                ← MODIFY  probe response routing, dwell_seconds persistence (SEREN-TASK-008)
```
