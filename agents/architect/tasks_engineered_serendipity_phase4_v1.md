# Dev Task List — Engineered Serendipity, Phase 4

**ID**: ARCH-TASKS-SEREN-001
**Design Reference**: `agents/architect/design_engineered_serendipity_phase4_v1.md`
**Stories Reference**: `agents/pm/stories_engineered_serendipity_phase4.md`
**Date**: 2026-04-04
**Status**: Done

---

## Dependency Order

```
SEREN-TASK-001  [BLOCKER] lib/db/migrations/011_serendipity.sql
                  *** USER MUST APPLY THIS IN NEON BEFORE ANY DB TASKS PROCEED ***
  |
  +--[Group A + C P0 — parallel, can start immediately after migration]--
  |
  SEREN-TASK-002  [BLOCKER] lib/config/serendipity.ts — all Phase 4 constants
  SEREN-TASK-003  [BLOCKER] lib/types/article.ts + lib/pipeline/serendipityScorer.ts
                             + lib/db/concepts.ts (new helpers)
       |
       +-- SEREN-TASK-004  lib/pipeline/run.ts — pipeline-time concept extraction
       |                   + llmScore persistence
       |
       +-- SEREN-TASK-009  lib/pipeline/explorationAssembler.ts — three-pool assembly
       |     (also requires SEREN-TASK-002)
       |     |
       |     +-- SEREN-TASK-010  lib/pipeline/ranker.ts — Phase 4 integration
       |           (also requires SEREN-TASK-003, SEREN-TASK-009)
       |           |
       |           +-- SEREN-TASK-011  app/api/feed/today/route.ts — Phase 4 reads + strip
       |                 (also requires SEREN-TASK-003, SEREN-TASK-010)

  +--[Group B P1 — parallel with Group C after SEREN-TASK-001]--
  |
  SEREN-TASK-006  lib/db/blindSpots.ts — all blind spot DB helpers
       |
       +-- SEREN-TASK-007  lib/pipeline/blindSpotProber.ts — cluster identification
       |     (also requires SEREN-TASK-003)
       |     |
       |     +-- SEREN-TASK-008  app/api/feedback/route.ts — probe response routing
       |           (also requires SEREN-TASK-006)

  +--[Group D P1 — begins after Group C (SEREN-TASK-011) and Group B (SEREN-TASK-008)]--
  |
  SEREN-TASK-012  lib/pipeline/receptivity.ts — all four receptivity functions
  SEREN-TASK-013  lib/db/aesthetics.ts — persist receptivity_score, exploration_budget
                  + dwell_seconds feedback handler update
       |
       +-- SEREN-TASK-014  End-to-end verification (Phase 4)
       +-- SEREN-TASK-015  ARCHITECTURE.md update
```

### Parallelism Summary

- SEREN-TASK-001 (migration) must be applied in Neon first. Every DB-touching task
  depends on it.
- SEREN-TASK-002 (constants) and SEREN-TASK-003 (types + scorer + DB helpers) have
  no code dependencies and can be done immediately after the migration is applied.
- Group A P0 critical path: 003 → 004 → 010 → 011
- Group C P0 critical path: 002 + 003 → 009 → 010 → 011
- Group B P1 critical path: 001 → 006 → 007 + 008
- Group D P1: 012 + 013 (can begin after 008 and 011 are complete)
- SEREN-TASK-014 (verification) and SEREN-TASK-015 (ARCHITECTURE.md) are always last.

---

## !!!IMPORTANT — SEREN-TASK-001 Must Be Applied By the User Before Dev Continues!!!

SEREN-TASK-001 produces a SQL migration file. Dev writes and checks in the file.
**The user must then manually apply it in the Neon console or via `psql`.** No
database-touching task (SEREN-TASK-006 through SEREN-TASK-013) can be completed
until the migration is applied. Dev will confirm the migration file path and content
so the user can apply it before proceeding.

---

## SEREN-TASK-001 — DDL Migration: All Phase 4 Database Schema

**[BLOCKER — prerequisite for all DB-touching tasks. USER MUST APPLY IN NEON.]**
**Covers stories**: SEREN-006 through SEREN-012 (blind_spot_clusters table), SEREN-019
(dwell_seconds on user_feedback), SEREN-021 (receptivity columns on user_aesthetic_profiles)
**Prerequisites**: Migration 010 must already be applied in Neon.

### What to build

Create `lib/db/migrations/011_serendipity.sql` with all Phase 4 DDL.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/db/migrations/011_serendipity.sql` |

### Implementation

```sql
-- Migration 011: Engineered Serendipity — Phase 4
-- BRD-010 | Stories: SEREN-006–012, SEREN-019, SEREN-021
--
-- Adds:
--   blind_spot_clusters table
--   dwell_seconds column on user_feedback
--   receptivity_score + exploration_budget columns on user_aesthetic_profiles
--
-- Prerequisites:
--   - Migration 010 must already be applied
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS; ADD COLUMN IF NOT EXISTS

-- ── Step 1: Blind spot cluster tracking ──────────────────────────────────────

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

-- ── Step 2: Dwell time persistence on user_feedback ──────────────────────────

ALTER TABLE user_feedback
  ADD COLUMN IF NOT EXISTS dwell_seconds NUMERIC(7,2);

-- ── Step 3: Receptivity columns on user_aesthetic_profiles ───────────────────

ALTER TABLE user_aesthetic_profiles
  ADD COLUMN IF NOT EXISTS receptivity_score   NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS exploration_budget  INTEGER NOT NULL DEFAULT 4;
```

### Acceptance criteria

- [x] File exists at `lib/db/migrations/011_serendipity.sql`
- [x] `blind_spot_clusters` table has all columns shown above with correct types and constraints
- [x] UNIQUE(user_id, device_id, cluster_label) constraint is present
- [x] Index on (device_id, status) is present
- [x] `user_feedback.dwell_seconds` column exists after apply
- [x] `user_aesthetic_profiles.receptivity_score` and `exploration_budget` columns exist after apply
- [x] Migration is safe to re-run (IF NOT EXISTS guards throughout)
- [x] `npx tsc --noEmit` passes with no new errors (this task is SQL only, TypeScript should be unaffected)

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Migration file was already present and applied by user in Neon prior to this session.

---

## SEREN-TASK-002 — Exploration Budget Constants and Serendipity Config

**[BLOCKER]**
**Covers stories**: SEREN-013
**Prerequisites**: None (no runtime dependencies; can start immediately)

### What to build

Create `lib/config/serendipity.ts` with all Phase 4 named constants and the slot
allocation lookup table.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/config/serendipity.ts` |

### Implementation

The file must export exactly these names (used by other Phase 4 modules):

```typescript
export const EXPLORATION_BASELINE = 4;
export const EXPLORATION_FLOOR    = 2;
export const EXPLORATION_CEILING  = 6;
export const WILDCARD_SLOT_COUNT  = 1;

export const SLOT_ALLOCATION: Record<number, {
  semanticStretch: number;
  blindSpotProbe:  number;
  wildcard:        number;
}> = {
  2: { semanticStretch: 1, blindSpotProbe: 0, wildcard: 1 },
  3: { semanticStretch: 2, blindSpotProbe: 0, wildcard: 1 },
  4: { semanticStretch: 2, blindSpotProbe: 1, wildcard: 1 },
  5: { semanticStretch: 3, blindSpotProbe: 1, wildcard: 1 },
  6: { semanticStretch: 3, blindSpotProbe: 2, wildcard: 1 },
};

// Receptivity thresholds (ascending max boundary, inclusive)
export const RECEPTIVITY_THRESHOLDS: ReadonlyArray<{
  max: number;
  budget: number;
}> = [
  { max: 0.30, budget: 2 },
  { max: 0.55, budget: 3 },
  { max: 0.70, budget: 4 },
  { max: 0.85, budget: 5 },
  { max: 1.00, budget: 6 },
];

export const RECEPTIVITY_WEIGHT_DIVERSITY        = 0.40;
export const RECEPTIVITY_WEIGHT_PROBE_ACCEPTANCE = 0.35;
export const RECEPTIVITY_WEIGHT_DWELL_RATIO      = 0.25;
export const DWELL_RATIO_CAP                     = 1.5;

export const RECEPTIVITY_DIVERSITY_MIN_LIKES  = 3;
export const RECEPTIVITY_PROBE_MIN_SHOWN      = 3;
export const RECEPTIVITY_DWELL_MIN_POINTS     = 3;
```

Add a startup assertion to verify SLOT_ALLOCATION covers all budget levels in
[EXPLORATION_FLOOR, EXPLORATION_CEILING]:

```typescript
// Startup assertion: every budget level in [FLOOR, CEILING] must have an allocation.
for (let b = EXPLORATION_FLOOR; b <= EXPLORATION_CEILING; b++) {
  if (!(b in SLOT_ALLOCATION)) {
    throw new Error(`serendipity.ts: SLOT_ALLOCATION missing entry for budget=${b}`);
  }
}
```

### Acceptance criteria

- [x] File exists at `lib/config/serendipity.ts` and is importable
- [x] All 15 named exports are present with exact values matching the design
- [x] `SLOT_ALLOCATION[4]` returns `{ semanticStretch: 2, blindSpotProbe: 1, wildcard: 1 }`
- [x] `SLOT_ALLOCATION[2]` returns `{ semanticStretch: 1, blindSpotProbe: 0, wildcard: 1 }`
- [x] `SLOT_ALLOCATION[6]` returns `{ semanticStretch: 3, blindSpotProbe: 2, wildcard: 1 }`
- [x] Startup assertion is present and throws if an entry is missing
- [x] `npx tsc --noEmit` passes with no new errors

**Status**: Done
**Completed**: 2026-04-04
**Notes**: All constants, thresholds, and the startup assertion implemented exactly per spec.

---

## SEREN-TASK-003 — Types, Serendipity Scorer, and Concept Graph Helpers

**[BLOCKER]**
**Covers stories**: SEREN-001, SEREN-002, SEREN-003, SEREN-004
**Prerequisites**: None (can start immediately)

### What to build

1. Extend `lib/types/article.ts` with four new `@internal` fields on `Article`.
2. Create `lib/pipeline/serendipityScorer.ts` with four pure functions.
3. Add two new helpers to `lib/db/concepts.ts`.

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `lib/types/article.ts` |
| Create | `lib/pipeline/serendipityScorer.ts` |
| Modify | `lib/db/concepts.ts` |

### Implementation — `lib/types/article.ts`

Add these four fields to the `Article` interface, after the existing `discoveryTopic`
field:

```typescript
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
```

### Implementation — `lib/pipeline/serendipityScorer.ts`

Create with these four pure functions. No imports from DB modules — all data is passed in.

```typescript
import { RECEPTIVITY_WEIGHT_DIVERSITY } from '@/lib/config/serendipity'; // only if needed

export type ConceptDistance = 'known' | 'adjacent' | 'unknown';

export interface ConceptClassification {
  label:    string;
  distance: ConceptDistance;
}

/**
 * Classifies each concept label against the user's concept graph.
 * All data passed in — no DB calls.
 *
 * "known":    a node label in knownLabels matches (substring after normalization)
 * "adjacent": no known match, but at least one other concept in articleConcepts
 *             is known AND shares an edge with this concept in edgePairs
 * "unknown":  neither condition met
 *
 * Normalization: lowercase, replace non-alphanumeric (except spaces) with space,
 * collapse multiple spaces, trim. (Reuse the same normalize() function pattern
 * from lib/pipeline/conceptBonus.ts.)
 */
export function classifyConceptDistance(
  articleConcepts: string[],
  knownLabels: Set<string>,
  edgePairs: Array<[string, string]>
): ConceptClassification[]

/**
 * Computes raw surprise score from distance classifications.
 * Formula: (unknown_count * 1.0 + adjacent_count * 0.5) / total_count
 * Returns 0.0 for empty input.
 */
export function computeRawSurprise(
  classifications: ConceptClassification[]
): number

/**
 * Maps LLM composite score (1.0–5.0) to quality weight [0.5, 1.0].
 * Formula: 0.5 + (llm_score - 1.0) * 0.125
 * Clamps: below 1.0 returns 0.5; above 5.0 returns 1.0.
 * undefined input returns 0.75 (neutral midpoint for fixed-source articles).
 */
export function normalizeQualityWeight(
  llmScore: number | undefined
): number

/**
 * Final serendipity score.
 * Formula: raw_surprise * quality_weight
 */
export function computeSerendipityScore(
  rawSurprise: number,
  qualityWeight: number
): number
```

### Implementation — `lib/db/concepts.ts` additions

Add two new exported functions after the existing helpers:

```typescript
/**
 * Returns all concept node labels for the given identity as a Set<string>.
 * Returns an empty Set if the user has no concept nodes.
 */
export async function getAllConceptLabels(
  userId: string | null,
  deviceId: string
): Promise<Set<string>> {
  const rows = await sql`
    SELECT label
    FROM user_concepts
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId} IS NULL))
  `;
  return new Set((rows as Array<{ label: string }>).map(r => r.label));
}

/**
 * Returns all concept edge pairs [concept_a, concept_b] for the given identity.
 * Returns an empty array if the user has no edges.
 */
export async function getAllConceptEdges(
  userId: string | null,
  deviceId: string
): Promise<Array<[string, string]>> {
  const rows = await sql`
    SELECT concept_a, concept_b
    FROM user_concept_edges
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId} IS NULL))
  `;
  return (rows as Array<{ concept_a: string; concept_b: string }>).map(
    r => [r.concept_a, r.concept_b]
  );
}
```

### Acceptance criteria

- [x] `Article` type has all five new fields with correct TypeScript types
- [x] `classifyConceptDistance()` returns one classification per input concept
- [x] `classifyConceptDistance()` uses same normalization as `conceptBonus.ts`
- [x] `computeRawSurprise([])` returns 0.0
- [x] `computeRawSurprise()` with all-unknown returns 1.0; all-known returns 0.0; all-adjacent returns 0.5
- [x] `normalizeQualityWeight(1.0)` returns 0.5; `normalizeQualityWeight(5.0)` returns 1.0
- [x] `normalizeQualityWeight(undefined)` returns 0.75
- [x] `normalizeQualityWeight(0.5)` is clamped to 0.5 (below minimum)
- [x] `computeSerendipityScore(1.0, 1.0)` returns 1.0; `computeSerendipityScore(0.0, 1.0)` returns 0.0
- [x] `getAllConceptLabels()` issues exactly one DB query
- [x] `getAllConceptEdges()` issues exactly one DB query
- [x] `npx tsc --noEmit` passes with no new errors

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Article type extended with five new @internal fields. serendipityScorer.ts has four pure functions with no imports. DB helpers added to concepts.ts.

---

## SEREN-TASK-004 — Pipeline-Time Concept Extraction and llmScore Storage

**Covers stories**: SEREN-005
**Prerequisites**: SEREN-TASK-003 (Article type extensions)

### What to build

Modify `lib/pipeline/run.ts` to:
1. After LLM evaluation, store `llmResult.scores.composite` as `article.llmScore`.
2. After all candidate articles are assembled (post quality gate, post aesthetic
   scoring), call `extractConcepts()` on each article and store as `article.extractedConcepts`.

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `lib/pipeline/run.ts` |

### Implementation

**Step 1 — llmScore persistence**: In `lib/discovery/run.ts` (or wherever
`evaluateWithLLM()` result is consumed), after a successful LLM evaluation, assign:
```typescript
article.llmScore = llmResult.scores.composite;
```
Confirm the exact location by tracing where `evaluateWithLLM()` is called and where
the article object is constructed. The `llmScore` must be present in the batch JSON
before `writeBatch()` is called.

**Step 2 — pipeline-time concept extraction**: After all articles in the combined
batch (fixed + discovery) have been assembled and aesthetic-scored, add a sequential
pass:

```typescript
import { extractConcepts } from '@/lib/discovery/conceptExtractor';

for (const article of combinedArticles) {
  try {
    const text = article.bodyText?.trim()
      ? article.bodyText
      : `${article.title} ${article.description ?? ''}`;
    const concepts = await extractConcepts(text);
    article.extractedConcepts = concepts;
  } catch (err) {
    console.error(`[pipeline] concept extraction failed for ${article.id}:`, err);
    article.extractedConcepts = [];
  }
}
```

This extraction runs before `writeBatch()`. It is sequential (not parallel) for the
same reason aesthetic scoring is sequential: Anthropic API rate limits. The existing
`extractConcepts()` function is reused without modification.

### Acceptance criteria

- [x] `article.llmScore` is present and set to the LLM composite score for all
  discovery articles that pass LLM evaluation
- [x] Fixed-source articles (RSS/NewsAPI) have `llmScore = undefined` (no LLM call for them)
- [x] `article.extractedConcepts` is populated for every article in the batch after the pipeline run
- [x] Extraction failure on one article results in `extractedConcepts = []` for that article
  and does not abort the pipeline or affect other articles
- [x] Both fields are present in the written batch JSON file on disk
- [x] `npx tsc --noEmit` passes with no new errors

**Status**: Done
**Completed**: 2026-04-04
**Notes**: llmScore set in lib/discovery/run.ts at article construction. Concept extraction loop added in lib/pipeline/run.ts after aesthetic scoring and before writeBatch().

---

## SEREN-TASK-005 — (Renumbered; no gap — see dependency order above)

This slot is intentionally omitted. The dependency order numbers skip from 004 to 006
in Group B. Task numbering reflects Group ordering (A=001–005, B=006–008, C=009–011,
D=012–013, final=014–015).

---

## SEREN-TASK-006 — Blind Spot Cluster DB Helpers

**[BLOCKER for Group B]**
**Covers stories**: SEREN-010, SEREN-011, SEREN-012 (DB layer)
**Prerequisites**: SEREN-TASK-001 (migration applied in Neon)

### What to build

Create `lib/db/blindSpots.ts` with the `BlindSpotCluster` type and all cluster
state management helpers.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/db/blindSpots.ts` |

### Implementation

```typescript
import { sql } from './client';

export interface BlindSpotCluster {
  id:             number;
  user_id:        string | null;
  device_id:      string;
  cluster_label:  string;
  status:         'active' | 'suppressed' | 'promoted';
  suppress_until: string | null;   // ISO-8601
  promote_until:  string | null;   // ISO-8601
  probe_count:    number;
  like_count:     number;
  dislike_count:  number;
  ignore_count:   number;
  last_probed_at: string | null;   // ISO-8601
  created_at:     string;          // ISO-8601
}
```

Implement these functions:

**`getEligibleClusters(userId, deviceId)`**: Returns all clusters where status is NOT
'suppressed' OR where suppress_until is in the past. Calls `expireClusterTimers()`
first to reset any expired timers, then queries.

**`upsertCluster(userId, deviceId, clusterLabel)`**: INSERT ON CONFLICT DO UPDATE.
On insert: all defaults. On conflict: increment `probe_count`, set `last_probed_at = NOW()`.

**`recordProbeClusterPromotion(userId, deviceId, clusterLabel)`**: Upserts the cluster
first (in case it does not yet exist), then: `status = 'promoted'`,
`promote_until = NOW() + INTERVAL '14 days'`, `suppress_until = NULL`,
increments `like_count`.

**`recordProbeClusterSuppression(userId, deviceId, clusterLabel)`**: Upserts first,
then: `status = 'suppressed'`, `suppress_until = NOW() + INTERVAL '30 days'`,
increments `dislike_count`.

**`recordProbeClusterIgnore(userId, deviceId, clusterLabel)`**: Upserts first.
Increments `ignore_count`. Then checks: if `ignore_count >= 2` (after increment),
sets `status = 'suppressed'`, `suppress_until = NOW() + INTERVAL '14 days'`.
(Note: 14-day ignore suppression, not 30-day dislike suppression — per BRD-010.)

**`expireClusterTimers(userId, deviceId)`**: Single UPDATE — sets `status = 'active'`
where `status = 'suppressed' AND suppress_until <= NOW()`, and where
`status = 'promoted' AND promote_until <= NOW()`.

### Acceptance criteria

- [x] File exists and exports `BlindSpotCluster` interface and all six functions
- [x] `getEligibleClusters()` calls `expireClusterTimers()` first, then excludes
  currently-suppressed clusters
- [x] `recordProbeClusterPromotion()` clears suppress_until and sets status to 'promoted'
- [x] `recordProbeClusterSuppression()` sets suppress_until to 30 days from now
- [x] `recordProbeClusterIgnore()` sets suppress_until to 14 days (not 30 days) on second consecutive ignore
- [x] `expireClusterTimers()` issues a single UPDATE (not two)
- [x] All functions handle the case where the cluster row does not yet exist (upsert pattern)
- [x] `npx tsc --noEmit` passes with no new errors

**Status**: Done
**Completed**: 2026-04-04
**Notes**: All six DB helpers implemented with correct upsert patterns and timer logic.

---

## SEREN-TASK-007 — Blind Spot Prober: Cluster Identification and Probe Selection

**Covers stories**: SEREN-006, SEREN-007, SEREN-008, SEREN-012
**Prerequisites**: SEREN-TASK-003 (types), SEREN-TASK-006 (DB helpers)

### What to build

Create `lib/pipeline/blindSpotProber.ts` with three functions: LLM-based cluster
identification, probe article selection, and ignore detection for prior-day probes.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/pipeline/blindSpotProber.ts` |

### Implementation

**`identifyBlindSpotClusters(unknownConceptsByArticle)`**:

1. Flatten all unknown concept labels from the map into a deduplicated list.
2. If fewer than 3 unique labels exist, return `[]`.
3. Make a single LLM call using `claude-haiku-4-5-20251001` with tool use:
   - Tool name: `group_concepts`
   - Input schema: `{ clusters: Array<{ cluster_label: string; member_concepts: string[] }> }`
   - System prompt: "You are a concept taxonomy assistant. Group the following concept
     labels into broad thematic clusters of 2-8 words each. Assign each label to
     exactly one cluster. Use a cluster labeled 'other' for labels that do not fit
     any clear theme."
   - User message: the list of unique unknown concept labels, newline-separated
4. Parse and validate the tool output. Drop any cluster with empty label or member list.
5. For each cluster, find which backing article IDs contributed member concepts
   (cross-reference with `unknownConceptsByArticle`).
6. Return only clusters with >= 3 distinct backing article IDs.
7. Compute `avgRawSurprise` for each cluster as the mean serendipity score of its
   backing articles. This requires the serendipity scores to be passed in — add
   `serendipityScores: Map<string, number>` as a second parameter.
8. On LLM failure: log error, return `[]` (the blind spot probe slot falls back to
   semantic stretch per design).

**`selectProbeArticle(clusters, eligibleDbClusters, serendipityScores, articles)`**:

1. Filter `clusters` to those whose `cluster_label` is not in the suppressed set
   (check against `eligibleDbClusters`).
2. Sort remaining clusters by the following priority:
   a. Promoted clusters first (find matching `clusterLabel` in `eligibleDbClusters`
      where `status === 'promoted'`)
   b. Never-suppressed clusters second (`dislike_count === 0` in DB row, or no DB row)
   c. Previously-suppressed clusters last (ordered by `avgRawSurprise` DESC)
3. Select the top cluster.
4. From that cluster's backing articles, find the article with the highest serendipity
   score in `serendipityScores`.
5. Return `{ article, clusterLabel }` or `null` if no eligible clusters remain.

**`processPriorDayProbeIgnores(userId, deviceId, yesterdayBatch, feedbackRows)`**:

1. Find all articles in `yesterdayBatch` that have `probeInfo` set.
2. For each probe article, check if a like or dislike feedback row exists in
   `feedbackRows` for that `article.id`.
3. If no feedback row exists (article was ignored), call `recordProbeClusterIgnore()`
   for the cluster from `probeInfo.clusterLabel`.
4. Errors in cluster state update are caught, logged, and swallowed — they must not
   abort the pipeline.

### Probe flag attachment

In `selectProbeArticle()`, after selecting the article, set on the article object:
```typescript
article.probeInfo = { probeType: 'blind_spot', clusterLabel };
```
This is set in-memory. The batch write (from `writeBatch()` in `run.ts`) will persist it.

### Acceptance criteria

- [x] `identifyBlindSpotClusters()` makes exactly one LLM tool-use call
- [x] `identifyBlindSpotClusters()` returns `[]` when fewer than 3 unique unknown
  concept labels exist
- [x] `identifyBlindSpotClusters()` returns `[]` (not throws) on LLM failure
- [x] Clusters with fewer than 3 distinct backing articles are filtered out
- [x] `selectProbeArticle()` respects suppression: suppressed clusters not selected
- [x] `selectProbeArticle()` returns `null` if all clusters are suppressed
- [x] Selected probe article has `probeInfo` set on the object
- [x] `processPriorDayProbeIgnores()` identifies ignored probes correctly
- [x] Errors in `processPriorDayProbeIgnores()` are caught and logged without aborting
- [x] `npx tsc --noEmit` passes with no new errors

**Status**: Done
**Completed**: 2026-04-04
**Notes**: LLM uses claude-haiku-4-5-20251001 with tool_choice: any. Priority sort (promoted > never-disliked > previously-suppressed) implemented in selectProbeArticle().

---

## SEREN-TASK-008 — Feedback Route: Probe Response and Dwell Persistence

**Covers stories**: SEREN-009, SEREN-010, SEREN-011, SEREN-012 (feedback integration)
**Prerequisites**: SEREN-TASK-006 (DB helpers), SEREN-TASK-001 (migration applied)

### What to build

Modify `app/api/feedback/route.ts` to:
1. Detect when the article being rated was a blind spot probe (from batch JSON).
2. Route probe feedback to cluster promotion or suppression.
3. Persist `dwell_seconds` to the `user_feedback` table when present.

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `app/api/feedback/route.ts` |

### Implementation

**Step 1 — probe detection**: After the article's batch record is fetched (the
handler already reads batch data to get `discoveryTopic`), check for `probeInfo`:

```typescript
const probeInfo = article?.probeInfo ?? null;
```

**Step 2 — probe routing** (runs after Phase 3 logic, before returning response):

```typescript
if (probeInfo?.probeType === 'blind_spot') {
  try {
    if (value === 'like') {
      await recordProbeClusterPromotion(userId, deviceId, probeInfo.clusterLabel);
    } else if (value === 'dislike') {
      await recordProbeClusterSuppression(userId, deviceId, probeInfo.clusterLabel);
    }
    // ignore ('value: null' dwell beacon): no cluster state change here;
    // handled at next pipeline run by processPriorDayProbeIgnores()
  } catch (err) {
    console.error('[feedback] probe cluster state update failed:', err);
    // swallow — must not fail the feedback POST
  }
}
```

**Step 3 — dwell_seconds persistence**: The handler already accepts `dwellSeconds`
in the request body. Find the SQL upsert for `user_feedback` and add `dwell_seconds`:

The `user_feedback` upsert currently writes `(user_id, device_id, article_id, value,
updated_at)`. Extend it to also write `dwell_seconds` when present. On conflict update,
also update `dwell_seconds` if the new value is non-null.

If the exact column name in the existing insert needs to be checked — look at the
`user_feedback` table DDL from migrations 002 or 005. The new column is
`dwell_seconds NUMERIC(7,2)` from migration 011.

### Acceptance criteria

- [x] On like of a probe article, `recordProbeClusterPromotion()` is called
- [x] On dislike of a probe article, `recordProbeClusterSuppression()` is called
- [x] On dwell beacon (value=null) for a probe, no cluster state change occurs
- [x] Probe cluster update failure does not cause the feedback POST to return an error
- [x] `dwell_seconds` is written to `user_feedback` when `dwellSeconds` is present in request
- [x] Non-probe articles have no probe routing logic executed
- [x] `GET /api/feed/today` response does not include `probeInfo` on any article
  (verify stripping step is in place — see SEREN-TASK-011)
- [x] `npx tsc --noEmit` passes with no new errors

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Probe detection reads batch JSON dynamically. dwell_seconds already wired in upsertFeedback(). All probe routing wrapped in try/catch.

---

## SEREN-TASK-009 — Exploration Assembler

**[BLOCKER for SEREN-TASK-010]**
**Covers stories**: SEREN-014, SEREN-015, SEREN-016
**Prerequisites**: SEREN-TASK-002 (constants), SEREN-TASK-003 (types + scorer)

### What to build

Create `lib/pipeline/explorationAssembler.ts` with four functions: pool construction,
slot assembly, exploitation deduplication, and slot type tagging.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/pipeline/explorationAssembler.ts` |

### Implementation

**`buildSlotPools(candidates, serendipityScores, conceptClassifications, probeArticle)`**:

Returns `ExplorationPools`:

```typescript
export interface ExplorationPools {
  semanticStretch: Article[];  // sorted serendipityScore DESC
  blindSpotProbe:  Article[];  // 0 or 1 article
  wildcard:        Article[];  // sorted llmScore DESC (fallback: serendipityScore DESC)
}
```

- **Semantic stretch pool**: articles where `conceptClassifications` for that article
  contains at least one classification with `distance === 'adjacent'`. Sort by
  `serendipityScores.get(article.id) ?? 0` descending.
  Fallback: if empty, include articles with at least one `'unknown'` classification,
  sorted by serendipityScore descending.
- **Blind spot probe pool**: `probeArticle ? [probeArticle] : []`.
- **Wildcard pool**: all candidates sorted by `article.llmScore ?? 0` descending.
  (Not filtered by concept graph proximity — any quality-passing article is eligible.)

An article may appear in multiple pools before slot assembly. Deduplication is in
`deduplicateExploitPool()`.

**`assembleExplorationSlots(pools, budget)`**:

1. Look up `SLOT_ALLOCATION[budget]` from `serendipity.ts`. If budget is out of
   range, clamp to [EXPLORATION_FLOOR, EXPLORATION_CEILING].
2. Fill semantic stretch slots: take first `allocation.semanticStretch` articles from
   `pools.semanticStretch`.
3. Fill blind spot probe slot: take first `allocation.blindSpotProbe` articles from
   `pools.blindSpotProbe`.
4. Fill wildcard slot: take first `allocation.wildcard` articles from `pools.wildcard`
   that are not already selected (check by article.id).
5. If any type pool is exhausted before its allocation is met, fill remaining slots
   from the union of all three pools sorted by serendipityScore descending, excluding
   already-selected articles.
6. Final count is `min(budget, total candidates available)` — never exceeds CEILING,
   never below FLOOR if candidates are available.

**`deduplicateExploitPool(explorationSlots, exploitCandidates)`**:

Returns `exploitCandidates` filtered to exclude any article already in
`explorationSlots` (by article.id).

**`tagExplorationSlotTypes(explorationSlots, pools)`**:

Mutates `explorationSlotType` on each article. Determine the slot type by checking
which pool the article came from: if it is in `pools.blindSpotProbe`, tag as
`'blind_spot_probe'`; else if it was in `pools.semanticStretch` (check by id in
original pool), tag as `'semantic_stretch'`; else tag as `'wildcard'`.

**Interleave positions**: Computed as `Math.round(2 + i * (20 / budget))` for
i in [0, budget-1]. The `+2` offset avoids position 0. These positions are advisory —
`rankFeed()` uses `splice()` to insert at these positions (consistent with Phase 3
EXPLORATION_POSITIONS pattern). Export an `computeExplorationPositions(budget: number): number[]`
helper that returns the positions array.

### Acceptance criteria

- [x] `buildSlotPools()` semantic stretch pool contains only articles with at least one
  adjacent concept classification
- [x] `buildSlotPools()` wildcard pool includes all candidates regardless of concept proximity
- [x] `buildSlotPools()` blind spot probe pool is 0 or 1 article
- [x] `assembleExplorationSlots()` at budget=4 returns 2 semantic stretch + 1 probe + 1 wildcard
  (when all pools are populated)
- [x] `assembleExplorationSlots()` fills gaps from highest-serendipity available when a pool is exhausted
- [x] `assembleExplorationSlots()` never returns more than EXPLORATION_CEILING articles
- [x] `deduplicateExploitPool()` removes all exploration articles from the exploit pool
- [x] `tagExplorationSlotTypes()` sets the correct slot type on each selected article
- [x] `npx tsc --noEmit` passes with no new errors

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Fallback from adjacent to unknown in semantic stretch pool implemented. computeExplorationPositions() helper exported.

---

## SEREN-TASK-010 — rankFeed() Phase 4 Integration

**[BLOCKER for SEREN-TASK-011]**
**Covers stories**: SEREN-017
**Prerequisites**: SEREN-TASK-003 (types + scorer), SEREN-TASK-009 (assembler)

### What to build

Modify `lib/pipeline/ranker.ts` to:
1. Accept new Phase 4 parameters.
2. Run serendipity scoring as a pre-pass on all candidates.
3. Build exploration pools, assemble slots, deduplicate, and interleave.
4. Preserve the Phase 3 exploitation ranking formula unchanged.

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `lib/pipeline/ranker.ts` |

### Implementation

**Existing constants to remove from `ranker.ts`**: `EXPLORATION_SLOTS = 3` and
`EXPLORATION_POSITIONS = [2, 9, 16]` are the Phase 3 source-diversity exploration
variables. These are replaced by Phase 4 budget-driven exploration. Remove them
(they are no longer used after Phase 4 — the Phase 3 exploration logic in Steps 5–8
is replaced by the Phase 4 two-pool assembly).

**New signature**:

```typescript
export function rankFeed(
  articles: Article[],
  feedbackRows: DbFeedbackRow[],
  aestheticProfile?: AestheticProfile | null,
  aestheticScoreMap?: Map<string, AestheticScoreVector>,
  topConceptLabels?: string[],
  // Phase 4 additions (all optional for graceful degradation):
  allConceptLabels?: Set<string>,
  allConceptEdges?: Array<[string, string]>,
  explorationBudget?: number
): Article[]
```

**New Phase 4 pre-pass** (insert between existing Steps 3 and 4):

```typescript
// Phase 4: serendipity scoring
const serendipityScores = new Map<string, number>();
const conceptClassMap   = new Map<string, ConceptClassification[]>();

if (allConceptLabels || allConceptEdges) {
  const labels = allConceptLabels ?? new Set<string>();
  const edges  = allConceptEdges  ?? [];

  for (const article of articles) {
    const concepts = article.extractedConcepts ?? [];
    const classifications = classifyConceptDistance(concepts, labels, edges);
    conceptClassMap.set(article.id, classifications);
    const rawSurprise  = computeRawSurprise(classifications);
    const qualityWt    = normalizeQualityWeight(article.llmScore);
    const sScore       = computeSerendipityScore(rawSurprise, qualityWt);
    serendipityScores.set(article.id, sScore);
    article.serendipityScore = sScore;  // transient; not in batch JSON
  }
}
```

**Phase 4 exploration assembly** (replaces Phase 3 Steps 5–8 — the source-diversity
exploration logic):

```typescript
// Phase 4: two-pool assembly
// Note: probeArticle selection happens in the pipeline orchestrator (run.ts) and
// is attached via probeInfo on the article. Identify it here.
const probeArticle = articles.find(a => a.probeInfo?.probeType === 'blind_spot') ?? null;

const budget = Math.min(
  Math.max(explorationBudget ?? EXPLORATION_BASELINE, EXPLORATION_FLOOR),
  EXPLORATION_CEILING
);

const pools = buildSlotPools(
  articles.filter(a => !sourceScores.get(slugify(a.sourceName))!.suppressed),
  serendipityScores,
  conceptClassMap,
  probeArticle
);
const explorationSlots = assembleExplorationSlots(pools, budget);
tagExplorationSlotTypes(explorationSlots, pools);

// Exploitation pool: Phase 3 ranked candidates minus exploration articles
const explorationIds = new Set(explorationSlots.map(a => a.id));
const exploitCandidates = deduplicateExploitPool(
  explorationSlots,
  withBonus
    .sort((a, b) => {
      if (b.rawScore !== a.rawScore) return b.rawScore - a.rawScore;
      return b.article.publishedAt.localeCompare(a.article.publishedAt);
    })
    .map(s => s.article)
    .filter(a => !sourceScores.get(slugify(a.sourceName))!.suppressed)
);

const exploitTop = exploitCandidates.slice(0, ARTICLES_PER_DAY - explorationSlots.length);

// Interleave at computed positions
const positions = computeExplorationPositions(explorationSlots.length);
const output = [...exploitTop];
for (let i = 0; i < positions.length && i < explorationSlots.length; i++) {
  const insertAt = Math.min(positions[i], output.length);
  output.splice(insertAt, 0, explorationSlots[i]);
}
```

The suppressed-source fallback (Phase 3 Step 6) and `applyDiversityCap` (Step 9)
are preserved unchanged.

### Graceful degradation

When `allConceptLabels` is undefined (new user, no graph), the serendipity pre-pass
skips (all articles get `serendipityScore = 0.0`). `buildSlotPools()` will then
populate the wildcard pool with all candidates and fill exploration slots from it.
This is correct behavior — new users get quality-first exploration.

### Acceptance criteria

- [x] Phase 3 exploitation formula (`0.7 * source_score + 0.3 * aesthetic_proximity + concept_bonus`)
  is unchanged
- [x] New `explorationBudget` parameter defaults to `EXPLORATION_BASELINE` (4) when absent
- [x] With no concept graph data, all articles get `serendipityScore = 0.0` and exploration fills from wildcard pool
- [x] Feed output is exactly `ARTICLES_PER_DAY` (20) articles
- [x] Exploration articles are not clustered at start or end (interleaved at computed positions)
- [x] Suppressed-source fallback still works (MIN_FEED_ARTICLES guard present)
- [x] `applyDiversityCap` still applied at the end
- [x] Old Phase 3 EXPLORATION_SLOTS / EXPLORATION_POSITIONS constants removed
- [x] `npx tsc --noEmit` passes with no new errors

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Phase 3 scoring formula preserved. Phase 3 EXPLORATION_SLOTS/EXPLORATION_POSITIONS constants removed. Phase 4 two-pool assembly with budget-driven interleaving integrated.

---

## SEREN-TASK-011 — Feed Route: Phase 4 DB Reads and Internal Field Stripping

**Covers stories**: SEREN-017 (integration), SEREN-008 (probe field stripping)
**Prerequisites**: SEREN-TASK-010 (rankFeed signature), SEREN-TASK-003 (DB helpers)

### What to build

Modify `app/api/feed/today/route.ts` to:
1. Fetch `allConceptLabels` and `allConceptEdges` in parallel with existing reads.
2. Compute `explorationBudget` from receptivity data (or use default until Group D ships).
3. Pass new parameters to `rankFeed()`.
4. Strip all new internal fields from the API response.

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `app/api/feed/today/route.ts` |

### Implementation

**New parallel DB reads**:

```typescript
const [
  feedbackRows,
  aestheticProfile,
  articleScoreMap,
  topConceptLabels,
  allConceptLabels,    // NEW
  allConceptEdges,     // NEW
] = await Promise.all([
  getFeedbackRows(userId, deviceId),
  getAestheticProfile(userId, deviceId),
  getArticleAestheticScores(articles.map(a => a.id)),
  getTopConceptNodes(userId, deviceId, 20).then(nodes => nodes.map(n => n.label)),
  getAllConceptLabels(userId, deviceId),   // NEW
  getAllConceptEdges(userId, deviceId),    // NEW
]);
```

**Pass to rankFeed()**:

```typescript
const ranked = rankFeed(
  articles,
  feedbackRows,
  aestheticProfile,
  articleScoreMap,
  topConceptLabels,
  allConceptLabels,    // NEW
  allConceptEdges,     // NEW
  EXPLORATION_BASELINE // default until Group D ships
);
```

**Strip internal fields**: Extend the existing field-stripping step (where
`discoveryTopic` is deleted) to also strip:

```typescript
for (const article of ranked) {
  delete (article as Record<string, unknown>).discoveryTopic;
  delete (article as Record<string, unknown>).llmScore;
  delete (article as Record<string, unknown>).extractedConcepts;
  delete (article as Record<string, unknown>).serendipityScore;
  delete (article as Record<string, unknown>).explorationSlotType;
  delete (article as Record<string, unknown>).probeInfo;
}
```

Also verify that `GET /api/articles/[id]` has the same stripping applied (it already
strips `discoveryTopic` per BUG-TASK-002 — extend it for the four new fields).

### Acceptance criteria

- [x] `allConceptLabels` and `allConceptEdges` are fetched in the `Promise.all()` block
- [x] `rankFeed()` is called with the new parameters
- [x] `GET /api/feed/today` response articles do not contain `llmScore`, `extractedConcepts`,
  `serendipityScore`, `explorationSlotType`, or `probeInfo` fields
- [x] `GET /api/articles/[id]` response does not contain any of the five new internal fields
- [x] DB failure on concept label/edge reads degrades gracefully (uses empty Set/[] fallback,
  consistent with Phase 3 aesthetic profile graceful degradation)
- [x] `npx tsc --noEmit` passes with no new errors

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Both routes strip all five Phase 4 internal fields. explorationBudget read from aestheticProfile.exploration_budget with EXPLORATION_BASELINE fallback.

---

## SEREN-TASK-012 — Receptivity Signal Module

**Covers stories**: SEREN-018, SEREN-019, SEREN-020, SEREN-021, SEREN-022
**Prerequisites**: SEREN-TASK-001 (migration — dwell_seconds column), SEREN-TASK-008
(probe data in DB and batch JSON), SEREN-TASK-011 (explorationSlotType in batch JSON)

### What to build

Create `lib/pipeline/receptivity.ts` with all four receptivity functions.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/pipeline/receptivity.ts` |

### Implementation

**`computeDiversityScore(userId, deviceId): Promise<number>`** (SEREN-018):

1. Query `user_feedback` for all like events in the trailing 7 calendar days
   (where `value = 'like'` and `updated_at >= NOW() - INTERVAL '7 days'`).
2. For each liked article, look up `extractedConcepts` from the corresponding batch
   JSON on disk (use `readBatch(batchDate)` from `lib/pipeline/storage.ts`).
3. Count distinct concept labels across all liked articles as `distinct_clusters`.
   `liked_count` = number of liked feedback rows in the window.
4. If `liked_count < RECEPTIVITY_DIVERSITY_MIN_LIKES`, return 0.5.
5. Return `Math.min(distinct_clusters / liked_count, 1.0)`.

**`computeProbeAcceptanceRate(userId, deviceId): Promise<number>`** (SEREN-019):

1. Query `user_feedback` for all feedback in the trailing 14 calendar days.
2. For each feedback row, read the corresponding batch JSON and check for `probeInfo`.
   Count `probes_shown` (articles with `probeInfo?.probeType === 'blind_spot'`) and
   `probe_likes` (subset with `value = 'like'`).
3. If `probes_shown < RECEPTIVITY_PROBE_MIN_SHOWN`, return 0.5.
4. Return `Math.min(probe_likes / probes_shown, 1.0)`.

**`computeDwellRatio(userId, deviceId): Promise<number>`** (SEREN-020):

1. Query `user_feedback` for all rows with non-null `dwell_seconds` in the trailing 14 days.
2. For each row, read the batch JSON for the article's `batchDate` and check
   `explorationSlotType`. Classify as exploration (`!= null`) or exploitation (`null`
   or absent).
3. Compute `avg_dwell_exploration` and `avg_dwell_exploitation`.
4. If either pool has fewer than `RECEPTIVITY_DWELL_MIN_POINTS`, return 0.75.
5. Return `avg_dwell_exploration / avg_dwell_exploitation` (do NOT cap here — capped
   in `computeReceptivity()`).

**`computeReceptivity(diversity, probeAcceptance, dwellRatio): number`** (SEREN-021, pure):

```typescript
export function computeReceptivity(
  diversityScore:      number,
  probeAcceptanceRate: number,
  dwellRatio:          number
): number {
  const raw =
    RECEPTIVITY_WEIGHT_DIVERSITY        * diversityScore +
    RECEPTIVITY_WEIGHT_PROBE_ACCEPTANCE * probeAcceptanceRate +
    RECEPTIVITY_WEIGHT_DWELL_RATIO      * Math.min(dwellRatio, DWELL_RATIO_CAP) / DWELL_RATIO_CAP;
  return Math.min(Math.max(raw, 0.0), 1.0);
}
```

**`receptivityToBudget(receptivityScore: number | null): number`** (SEREN-022, pure):

```typescript
export function receptivityToBudget(receptivityScore: number | null): number {
  if (receptivityScore === null || receptivityScore === undefined) {
    return EXPLORATION_BASELINE;
  }
  for (const threshold of RECEPTIVITY_THRESHOLDS) {
    if (receptivityScore <= threshold.max) return threshold.budget;
  }
  return EXPLORATION_CEILING;
}
```

### Acceptance criteria

- [x] `computeDiversityScore()` returns 0.5 when fewer than 3 liked articles in 7-day window
- [x] `computeProbeAcceptanceRate()` returns 0.5 when fewer than 3 probes shown in 14-day window
- [x] `computeDwellRatio()` returns 0.75 when either pool has fewer than 3 data points
- [x] `computeReceptivity()` is pure (no I/O); result is clamped to [0.0, 1.0]
- [x] `receptivityToBudget(0.25)` returns 2; `receptivityToBudget(0.60)` returns 4;
  `receptivityToBudget(0.90)` returns 6
- [x] `receptivityToBudget(null)` returns `EXPLORATION_BASELINE` (4)
- [x] `receptivityToBudget()` result is always in [EXPLORATION_FLOOR, EXPLORATION_CEILING]
- [x] `npx tsc --noEmit` passes with no new errors

**Status**: Done
**Completed**: 2026-04-04
**Notes**: All four functions implemented. computeReceptivity and receptivityToBudget are pure. Batch JSON caching used for efficiency in diversity/probe/dwell computations.

---

## SEREN-TASK-013 — Persist Receptivity to user_aesthetic_profiles and Wire into Feed Route

**Covers stories**: SEREN-021 (storage), SEREN-022 (budget in feed route)
**Prerequisites**: SEREN-TASK-012, SEREN-TASK-011, SEREN-TASK-001 (migration applied)

### What to build

1. Update `app/api/feedback/route.ts` to compute and persist `receptivity_score` and
   `exploration_budget` after the Phase 3 EMA update.
2. Update `app/api/feed/today/route.ts` to call `receptivityToBudget()` and pass
   the result to `rankFeed()` instead of the hardcoded `EXPLORATION_BASELINE`.

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `app/api/feedback/route.ts` |
| Modify | `app/api/feed/today/route.ts` |
| Modify | `lib/db/aesthetics.ts` |

### Implementation — `lib/db/aesthetics.ts`

Add a helper to persist receptivity:

```typescript
export async function updateReceptivity(
  userId: string | null,
  deviceId: string,
  receptivityScore: number,
  explorationBudget: number
): Promise<void> {
  await sql`
    UPDATE user_aesthetic_profiles
    SET receptivity_score  = ${receptivityScore},
        exploration_budget = ${explorationBudget}
    WHERE device_id = ${deviceId}
      AND (user_id = ${userId} OR (user_id IS NULL AND ${userId} IS NULL))
  `;
}
```

### Implementation — `app/api/feedback/route.ts`

After the Phase 3 short-term centroid / drift update, add:

```typescript
try {
  const [diversity, probeAcceptance, dwellRatio] = await Promise.all([
    computeDiversityScore(userId, deviceId),
    computeProbeAcceptanceRate(userId, deviceId),
    computeDwellRatio(userId, deviceId),
  ]);
  const rScore  = computeReceptivity(diversity, probeAcceptance, dwellRatio);
  const rBudget = receptivityToBudget(rScore);
  await updateReceptivity(userId, deviceId, rScore, rBudget);
} catch (err) {
  console.error('[feedback] receptivity update failed:', err);
  // swallow — must not fail the feedback POST
}
```

### Implementation — `app/api/feed/today/route.ts`

Replace the hardcoded `EXPLORATION_BASELINE` with a receptivity-driven budget:

```typescript
// Read stored exploration_budget from aesthetic profile (already fetched)
const storedBudget = aestheticProfile?.exploration_budget ?? EXPLORATION_BASELINE;

const ranked = rankFeed(
  articles,
  feedbackRows,
  aestheticProfile,
  articleScoreMap,
  topConceptLabels,
  allConceptLabels,
  allConceptEdges,
  storedBudget   // replaces EXPLORATION_BASELINE
);
```

### Acceptance criteria

- [x] After a feedback event, `user_aesthetic_profiles` row has updated `receptivity_score`
  and `exploration_budget`
- [x] Receptivity update failure does not cause the feedback POST to return an error
- [x] `GET /api/feed/today` uses stored `exploration_budget` from the aesthetic profile
- [x] New users (no aesthetic profile) default to `EXPLORATION_BASELINE` (4)
- [x] `npx tsc --noEmit` passes with no new errors

**Status**: Done
**Completed**: 2026-04-04
**Notes**: updateReceptivity() in aesthetics.ts persists both columns. Feedback route computes all three signals in parallel then writes. Feed route reads exploration_budget from profile.

---

## SEREN-TASK-014 — End-to-End Verification (Phase 4)

**Covers stories**: All SEREN-001 through SEREN-022
**Prerequisites**: All preceding tasks complete

### What to verify

This task is static code inspection + TypeScript compilation. No runtime execution
is required. Verify:

1. `npx tsc --noEmit` passes with zero errors.
2. All five internal Article fields (`llmScore`, `extractedConcepts`, `serendipityScore`,
   `explorationSlotType`, `probeInfo`) are absent from the `GET /api/feed/today` and
   `GET /api/articles/[id]` response shapes.
3. `lib/config/serendipity.ts` exports all required constants and the startup assertion
   is present.
4. `lib/db/migrations/011_serendipity.sql` exists and contains all three schema changes.
5. `lib/pipeline/serendipityScorer.ts` has four pure functions with correct signatures.
6. `lib/pipeline/explorationAssembler.ts` exports all four functions.
7. `lib/pipeline/blindSpotProber.ts` exports all three functions.
8. `lib/pipeline/receptivity.ts` exports all five functions.
9. `lib/db/blindSpots.ts` exports `BlindSpotCluster` type and all six helpers.
10. `lib/db/concepts.ts` exports `getAllConceptLabels` and `getAllConceptEdges`.
11. `lib/db/aesthetics.ts` exports `updateReceptivity`.
12. `rankFeed()` signature has the three new optional parameters.
13. The probe cluster update in `app/api/feedback/route.ts` is wrapped in try/catch.
14. The receptivity update in `app/api/feedback/route.ts` is wrapped in try/catch.
15. `lib/pipeline/run.ts` populates `extractedConcepts` on all articles before `writeBatch()`.
16. `lib/pipeline/run.ts` populates `llmScore` on discovery articles before `writeBatch()`.

### Acceptance criteria

- [x] `npx tsc --noEmit` produces zero errors
- [x] All 16 verification points above are confirmed
- [x] No production imports of `lib/pipeline/serendipityScorer.ts` break the no-I/O
  contract (no DB calls in that file)
- [x] No production imports of `lib/pipeline/receptivity.ts` functions that are
  supposed to be pure (computeReceptivity, receptivityToBudget) call DB functions

**Status**: Done
**Completed**: 2026-04-04
**Notes**: All 16 verification points passed. serendipityScorer.ts has zero imports. computeReceptivity and receptivityToBudget are pure functions with no DB access.

---

## SEREN-TASK-015 — ARCHITECTURE.md and Roadmap Update

**Prerequisites**: SEREN-TASK-014 complete

### What to build

Update `agents/architect/ARCHITECTURE.md`:
1. Add `blind_spot_clusters` to the Data Models section.
2. Add `dwell_seconds` column note to `user_feedback` data model entry.
3. Add `receptivity_score` and `exploration_budget` to `user_aesthetic_profiles` entry.
4. Add `llmScore`, `extractedConcepts`, `explorationSlotType`, `probeInfo` to `Article` entry.
5. Add all 13 Phase 4 key decisions to the Key Decisions table.
6. Add all new files (12 new/modified) to the "What Has Been Built" table with
   status "Done" for each completed task.
7. Add the Phase 4 design and task documents to the Design Documents table.
8. Add a changelog entry.

Update `agents/pm/roadmap.md`:
- Change Phase 4 status from "In Progress" to "Released".
- Change all SEREN-001 through SEREN-022 story statuses from "Planned" to "Released".

### Acceptance criteria

- [x] ARCHITECTURE.md Data Models section reflects all Phase 4 DB changes
- [x] ARCHITECTURE.md Key Decisions table has Phase 4 entries
- [x] ARCHITECTURE.md "What Has Been Built" has rows for all 13 SEREN tasks
- [x] ARCHITECTURE.md Design Documents table has Phase 4 row
- [x] roadmap.md Phase 4 status is "Released"
- [x] All 22 SEREN story statuses in roadmap.md are "Released"

**Status**: Done
**Completed**: 2026-04-04
**Notes**: ARCHITECTURE.md and roadmap.md updated in this session.
