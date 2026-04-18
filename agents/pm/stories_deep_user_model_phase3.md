# User Stories — Deep User Model, Phase 3

**Document ID**: stories_deep_user_model_phase3.md
**Date**: 2026-04-04
**Status**: Draft
**Phase**: Phase 3 — Deep User Model
**Source BRD**: `agents/ba/brd_deep_user_model_phase3.md` (BRD-009)
**Maintained by**: PM Agent

---

## Overview

Phase 3 extends the Phase 2 aesthetic preference model in two structural directions.
First, it splits the single flat aesthetic centroid into a two-window system — a
21-day rolling short-term centroid and the existing long-term EMA centroid — blended
at ranking time in a configurable ratio. Second, it builds a concept graph: a
persistent, LLM-derived map of the specific ideas and themes the user repeatedly
engages with, stored in Postgres and used as a supplementary ranking signal.

On top of this foundation, two dependent capabilities are added: taste drift
detection (which automatically inverts the blend ratio when the user's recent and
historical taste have meaningfully diverged) and implicit engagement signals (dwell
time and save/bookmark) that modulate how heavily a liked article's concepts are
weighted in the graph.

All Phase 3 changes are additive. The existing EMA centroid, source-score ranker,
aesthetic proximity ranker, and feedback endpoints are preserved without modification.
There is no new user-visible UI in Phase 3 except the save/bookmark button on the
article reading view, which is a standard affordance and requires no explanation.

---

## Dependency Order for the Architect

The four scope areas are not independent. The required implementation order is:

```
Group A — Short-term centroid (DEPTH-001 through DEPTH-004)
    — must precede Group C (drift detection cannot be measured without
      a short-term centroid to compare against the long-term)
    — DEPTH-001 (DB schema) BLOCKS DEPTH-002 and DEPTH-003
    — DEPTH-003 (recompute function) BLOCKS DEPTH-004 (blend integration)

Group B — Concept graph (DEPTH-005 through DEPTH-010)
    — DEPTH-005 (DB schema) BLOCKS DEPTH-006, DEPTH-007, DEPTH-008, DEPTH-009
    — DEPTH-006 (LLM extraction) BLOCKS DEPTH-007 (graph upsert) and DEPTH-008 (pruning)
    — DEPTH-007 BLOCKS DEPTH-009 (ranking integration)
    — Group B can begin in parallel with Group A

Group C — Taste drift detection (DEPTH-011 through DEPTH-013)
    — cannot begin until DEPTH-003 is complete (short-term centroid recompute)
    — DEPTH-011 (drift computation) BLOCKS DEPTH-012 (state persistence) and
      DEPTH-013 (blend inversion)
    — DEPTH-013 cannot be complete until DEPTH-004 (blend integration) is done

Group D — Implicit engagement signals (DEPTH-014 through DEPTH-017)
    — DEPTH-014 (dwell time client tracking) BLOCKS DEPTH-015 (server acceptance)
    — DEPTH-015 BLOCKS DEPTH-016 (concept weight modulation)
    — DEPTH-017 (save/bookmark) is independent within Group D but DEPTH-016
      must be done before DEPTH-017's weight contribution can be fully verified
    — Group D can begin in parallel with Groups A and B, but DEPTH-016
      requires DEPTH-007 (concept graph upsert) to be complete
```

---

## Architect-Level Decisions (Flagged — Do Not Resolve in Stories)

The following questions are implementation decisions the Architect must resolve
in the design document. They are called out in relevant stories so they cannot
be missed, but the PM does not constrain the choice.

1. **DB schema for short-term centroid columns**: The BRD specifies three new
   columns on `user_aesthetic_profiles`: `short_term_centroid vector(6)`,
   `short_term_feedback_count INTEGER`, and `short_term_window_start TIMESTAMPTZ`.
   The Architect decides: the migration file number, nullability constraints,
   default values, and whether the recompute of `short_term_window_start` is done
   in SQL or application code at window-roll time.

2. **DB schema for concept graph tables**: The BRD specifies `user_concepts` and
   `user_concept_edges` with the column sets documented in Feature 2. The Architect
   decides: migration file number, index strategy beyond the unique constraints
   (B-tree on `engagement_weight` for pruning sorts? partial index on `user_id`?),
   and whether `concept_a`/`concept_b` alphabetical ordering is enforced in the
   DB constraint or in application code.

3. **Dwell time storage and aggregation**: The BRD specifies `dwellSeconds` as an
   optional field on the existing `POST /api/feedback` payload, or as a separate
   beacon POST when the user leaves without giving explicit feedback. The Architect
   decides: whether dwell time is stored as a column on the feedback record table,
   as a separate table, or only used transiently at concept weight update time and
   never persisted beyond that computation; and whether a separate beacon endpoint
   is needed or whether extending `POST /api/feedback` is sufficient.

4. **Drift state persistence**: The BRD specifies `is_drifting BOOLEAN` and
   `drift_detected_at TIMESTAMPTZ` as new columns on `user_aesthetic_profiles`.
   The Architect decides: whether drift state is recomputed fresh on every feedback
   event (stateless derivation) versus persisted and only updated when the drift
   score crosses the threshold in either direction; and whether the migration for
   drift state columns is bundled with the short-term centroid migration or separate.

5. **Blend weight constants location**: The BRD specifies `short_term_weight = 0.35`
   (normal) and `short_term_weight = 0.65` (drift) as named constants. The Architect
   decides whether these live in `lib/config/aesthetic.ts` (alongside the existing
   Phase 2 constants) or in a new `lib/config/userModel.ts`. The drift threshold
   constant `0.25` should be co-located with the blend weight constants.

6. **Concept extraction LLM call integration point**: The BRD specifies extraction
   runs synchronously inside `POST /api/feedback` after the primary feedback write,
   consistent with the Phase 2 EMA update pattern. The Architect decides: the exact
   call site in the feedback handler, whether extraction failures are logged-and-
   suppressed (consistent with Phase 2 scoring failures) or retried, and whether
   the structured output schema for concept extraction shares the LLM client
   configuration from `lib/discovery/aestheticScorer.ts` or has its own module.

7. **Concept resonance check at ranking time**: The BRD specifies a label substring
   match against article title and description for the top-20 concept nodes. The
   Architect decides: whether the check is case-insensitive, how punctuation is
   handled (stemming vs. raw match), whether this check runs in-DB (SQL ILIKE) or
   in application code in `lib/pipeline/ranker.ts`, and how the top-20 concept
   nodes are fetched (one query per ranking run, cached, or passed in as a
   parameter to the rank function).

---

## Stories

---

### Group A — Short-Term vs. Long-Term Preference Memory

---

#### DEPTH-001 — Short-Term Centroid Database Schema

**Priority**: P0
**Blocks**: DEPTH-002, DEPTH-003
**Depends on**: Phase 2 `user_aesthetic_profiles` table (AESTH-008, shipped)

**As a** system that maintains separate short-term and long-term aesthetic profiles,
**I want** new columns on `user_aesthetic_profiles` to store the short-term centroid
vector, its window metadata, and (later) drift state,
**so that** the short-term preference representation has a persistent home that
survives server restarts and is updated atomically alongside the existing long-term
centroid.

#### Acceptance Criteria

1. A new database migration adds three columns to `user_aesthetic_profiles`:
   `short_term_centroid vector(6)` (nullable; null until the first qualifying
   short-term recompute), `short_term_feedback_count INTEGER NOT NULL DEFAULT 0`,
   and `short_term_window_start TIMESTAMPTZ` (nullable; set to the timestamp of
   the oldest qualifying event in the current window on first recompute).
2. The migration also adds two drift-state columns to the same table:
   `is_drifting BOOLEAN NOT NULL DEFAULT FALSE` and
   `drift_detected_at TIMESTAMPTZ` (nullable; set when drift is first declared,
   cleared when drift ends).
   **Architect decision**: whether these drift columns are in the same migration
   as the short-term centroid columns or a separate migration (flag for design doc).
3. The migration is backward-compatible: existing rows are unaffected; the new
   columns carry defaults that cause no change in behavior until Phase 3 code
   is deployed.
4. The migration follows the existing numbered naming convention under
   `lib/db/migrations/` (e.g., `010_short_term_centroid.sql`).
5. `npx tsc --noEmit` passes after any corresponding TypeScript type updates
   to `AestheticProfile` in `lib/types/aesthetic.ts` to reflect the new fields.

---

#### DEPTH-002 — Short-Term Centroid TypeScript Type Extensions

**Priority**: P0
**Blocks**: DEPTH-003, DEPTH-004
**Depends on**: DEPTH-001

**As a** developer writing the short-term centroid recompute and blend functions,
**I want** the `AestheticProfile` type extended to include the short-term centroid
fields and drift state fields introduced in DEPTH-001,
**so that** the recompute function, blend function, and drift computation all
operate on a shared typed structure and TypeScript catches missing fields at
compile time.

#### Acceptance Criteria

1. `AestheticProfile` in `lib/types/aesthetic.ts` is extended with:
   `short_term_centroid: AestheticScoreVector | null`,
   `short_term_feedback_count: number`,
   `short_term_window_start: string | null` (ISO-8601),
   `is_drifting: boolean`,
   `drift_detected_at: string | null` (ISO-8601).
2. All existing usages of `AestheticProfile` compile without error after the
   extension; no previously passing code is broken.
3. DB read helpers in `lib/db/aesthetics.ts` that return `AestheticProfile`
   objects are updated to populate the new fields from the DB row (null-safe for
   the nullable columns).
4. `npx tsc --noEmit` passes with no new errors.

---

#### DEPTH-003 — Short-Term Centroid Recompute Function

**Priority**: P0
**Blocks**: DEPTH-004, DEPTH-011
**Depends on**: DEPTH-001, DEPTH-002

**As a** system computing a short-term aesthetic preference signal,
**I want** a function that recomputes the short-term centroid by fetching all
qualifying feedback events within the trailing 21-day window, averaging the liked
vectors, and subtracting the mirrored disliked vectors,
**so that** the short-term centroid always reflects only recent engagement and
rolls forward naturally as time passes without any manual intervention.

#### Acceptance Criteria

1. A function (name is an Architect decision) accepts a user identity (`userId`
   or `deviceId`) and queries the feedback table for all events within the
   trailing 21 calendar days that have an associated aesthetic score in
   `article_aesthetic_scores`.
2. Events with `value = 'like'` contribute their article's aesthetic score
   vector positively; events with `value = 'dislike'` contribute their vector
   negated (same mirror mechanism used in the Phase 2 EMA update). Events
   without a resolvable aesthetic score are silently skipped.
3. The resulting centroid is the unweighted average of all contributing vectors
   (positive liked + negative disliked). If fewer than 3 events qualify, the
   function returns `null` for the centroid and sets `short_term_feedback_count`
   to the actual count.
4. The function writes the computed centroid (or null), the event count, and
   the `short_term_window_start` (ISO-8601 timestamp of the oldest qualifying
   event, or null if count < 3) back to `user_aesthetic_profiles` in a single
   atomic write.
5. The function is called in two places: inside `POST /api/feedback` after the
   primary feedback write (consistent with Phase 2 EMA update placement), and
   at the start of each daily pipeline run to roll the window forward. The
   Architect decides the exact call sites.
6. If the user has no row in `user_aesthetic_profiles` (new user), the function
   exits without error and without inserting a row (row creation remains the
   responsibility of the Phase 2 EMA update path).
7. `npx tsc --noEmit` passes.

---

#### DEPTH-004 — Blended Centroid at Ranking Time

**Priority**: P0
**Blocks**: DEPTH-013
**Depends on**: DEPTH-002, DEPTH-003

**As a** ranker that uses a user's aesthetic profile to score articles,
**I want** `rankFeed()` to use a blended centroid instead of the raw long-term
centroid when computing aesthetic proximity,
**so that** recent preferences contribute meaningfully to the ranking signal
without overriding the stable long-term aesthetic profile.

#### Acceptance Criteria

1. A pure function `blendCentroids(profile: AestheticProfile): AestheticScoreVector | null`
   (name is an Architect decision) computes:
   `blended = SHORT_TERM_WEIGHT * short_term_centroid + (1 - SHORT_TERM_WEIGHT) * long_term_centroid`
   where `SHORT_TERM_WEIGHT` is a named constant (default `0.35`).
2. If `short_term_centroid` is null or `short_term_feedback_count < 3`, the
   function returns the long-term centroid unchanged (falls back to Phase 2
   behavior with no blending).
3. If `is_drifting` is true on the profile, `SHORT_TERM_WEIGHT` is replaced by
   `DRIFT_SHORT_TERM_WEIGHT` (a separate named constant, default `0.65`).
   **Architect decision**: both constants live in a single config location (flag
   for design doc).
4. `rankFeed()` in `lib/pipeline/ranker.ts` calls `blendCentroids()` and uses
   its result in place of the direct `centroid` field when computing
   `aesthetic_proximity`. The ranking formula structure (`0.7 * source_score +
   0.3 * aesthetic_proximity`) is otherwise unchanged.
5. When the profile has no `centroid` at all (new user, no Phase 2 data), the
   function returns null and `rankFeed()` degrades to source-score-only ranking,
   unchanged from current behavior.
6. `npx tsc --noEmit` passes.
7. Unit tests (or acceptance by code inspection) confirm: blend produces the
   expected weighted average for sample inputs; the fallback path returns the
   long-term centroid when short-term is null; the drift path uses `0.65`.

---

### Group B — Concept Graph

---

#### DEPTH-005 — Concept Graph Database Schema

**Priority**: P0
**Blocks**: DEPTH-006, DEPTH-007, DEPTH-008, DEPTH-009
**Depends on**: Phase 2 DB infrastructure shipped (AESTH-005, AESTH-008)

**As a** system storing a user's concept graph in Postgres,
**I want** two new tables — `user_concepts` and `user_concept_edges` — with the
column sets and constraints defined in BRD-009,
**so that** concept nodes and their co-occurrence relationships can be stored,
looked up, and pruned using standard SQL without a separate graph database.

#### Acceptance Criteria

1. A new migration creates `user_concepts` with columns: `id SERIAL PK`,
   `user_id TEXT` (nullable), `device_id TEXT NOT NULL`, `label TEXT NOT NULL`,
   `extraction_count INTEGER NOT NULL DEFAULT 1`,
   `engagement_weight FLOAT NOT NULL DEFAULT 1.0`,
   `last_seen_at TIMESTAMPTZ NOT NULL`, `created_at TIMESTAMPTZ NOT NULL`.
   Unique constraint on `(user_id, device_id, label)`.
2. The same migration creates `user_concept_edges` with columns: `id SERIAL PK`,
   `user_id TEXT` (nullable), `device_id TEXT NOT NULL`,
   `concept_a TEXT NOT NULL`, `concept_b TEXT NOT NULL`,
   `co_occurrence_count INTEGER NOT NULL DEFAULT 1`,
   `last_seen_at TIMESTAMPTZ NOT NULL`. Unique constraint on
   `(user_id, device_id, concept_a, concept_b)`.
3. `concept_a` and `concept_b` in `user_concept_edges` are stored in
   alphabetical order to ensure undirected uniqueness. **Architect decision**:
   whether this ordering is enforced by a DB CHECK constraint, a trigger, or
   application-layer sorting before every insert (flag for design doc).
4. The migration follows the existing numbered naming convention under
   `lib/db/migrations/`.
5. TypeScript types `UserConcept` and `UserConceptEdge` are defined in
   `lib/types/` with fields matching the DB columns. The Architect decides the
   file location (e.g., `lib/types/concepts.ts`).
6. `npx tsc --noEmit` passes.

---

#### DEPTH-006 — Concept Extraction from Liked Articles

**Priority**: P0
**Blocks**: DEPTH-007
**Depends on**: DEPTH-005

**As a** system building a concept graph from the user's reading history,
**I want** an LLM call that extracts five to eight specific concept labels from
a liked article's body text when a user taps Like,
**so that** the concept graph is populated bottom-up from actual engagement rather
than from a predefined topic taxonomy.

#### Acceptance Criteria

1. A function `extractConcepts(bodyText: string): Promise<string[]>` (name is
   an Architect decision) calls the LLM (`claude-haiku-4-5-20251001`) using
   structured output and returns an array of 5–8 concept label strings.
2. The prompt instructs the model to extract specific intellectual concepts (two to
   five words each), not broad category labels. The prompt includes at least two
   examples distinguishing acceptable labels ("deliberative democracy theory",
   "urban heat islands") from unacceptable ones ("politics", "technology").
   The Architect writes the exact prompt.
3. Extraction runs inside `POST /api/feedback` only when: (a) `value = 'like'`,
   and (b) the article has non-empty `bodyText`. On dislikes or articles without
   body text, extraction is skipped silently.
4. Extraction is called after the primary feedback write and after the Phase 2 EMA
   centroid update, consistent with the existing async-after-write pattern. A
   failure in concept extraction (LLM error, timeout, malformed output) is
   logged and suppressed — it must not cause the feedback endpoint to return an
   error to the client.
5. The function returns the raw array of strings; it does not touch the database.
   Graph storage is the responsibility of DEPTH-007.
6. If the LLM returns fewer than 2 concepts or more than 10 (outside the expected
   range), the result is logged and the extraction result is still passed through
   without modification. The Architect decides whether to clamp or pass through.
7. `npx tsc --noEmit` passes.

---

#### DEPTH-007 — Concept Graph Upsert and Edge Creation

**Priority**: P0
**Blocks**: DEPTH-008, DEPTH-009, DEPTH-016
**Depends on**: DEPTH-005, DEPTH-006

**As a** system maintaining a persistent concept graph,
**I want** a function that takes a list of extracted concept labels and an
engagement weight, upserts each label as a node in `user_concepts`, and upserts
co-occurrence edges between all label pairs in `user_concept_edges`,
**so that** concepts the user engages with repeatedly accumulate extraction count
and engagement weight, and their relationships are recorded.

#### Acceptance Criteria

1. A function (name is an Architect decision) accepts: user identity, a list of
   concept label strings, and an `engagementWeight: number`. For each label,
   it upserts a row in `user_concepts` using the unique constraint on
   `(user_id, device_id, label)`:
   - On insert: sets `extraction_count = 1`, `engagement_weight = engagementWeight`,
     `last_seen_at = now()`, `created_at = now()`.
   - On conflict: increments `extraction_count`, adds `engagementWeight` to the
     existing `engagement_weight`, and updates `last_seen_at = now()`.
2. For each unordered pair of labels from the same extraction, it upserts a row
   in `user_concept_edges` with `concept_a` and `concept_b` in alphabetical order:
   - On insert: sets `co_occurrence_count = 1`, `last_seen_at = now()`.
   - On conflict: increments `co_occurrence_count`, updates `last_seen_at = now()`.
3. Before performing any upserts, the function checks whether the current node
   count for the user identity is at or above 300. If so, it calls the pruning
   function (DEPTH-008) before inserting any new nodes.
4. The function is called from the feedback handler after concept extraction
   (DEPTH-006) completes. If the upsert fails (DB error), it is logged and
   suppressed — it must not cause the feedback endpoint to return an error.
5. `npx tsc --noEmit` passes.

---

#### DEPTH-008 — Concept Graph Pruning

**Priority**: P0
**Blocks**: — (called by DEPTH-007)
**Depends on**: DEPTH-005, DEPTH-007

**As a** system that must keep the concept graph bounded,
**I want** a pruning function that removes the 30 lowest-scoring concept nodes
(and their associated edges) when the graph reaches the 300-node cap,
**so that** stale, low-relevance concepts are removed before new ones are added,
keeping graph size and query performance within bounds indefinitely.

#### Acceptance Criteria

1. A function `pruneConceptGraph(userIdentity)` (name is an Architect decision)
   queries `user_concepts` for the user identity and computes a composite score
   for each node:
   `node_score = engagement_weight * log(1 + extraction_count) * recency_factor(last_seen_at)`
   where `recency_factor` returns:
   - `1.0` if `last_seen_at` is within 90 days
   - `0.5` if `last_seen_at` is 91–180 days ago
   - `0.25` if `last_seen_at` is more than 180 days ago
2. The function selects the 30 nodes with the lowest composite score and deletes
   them from `user_concepts` by their IDs.
3. For each deleted node, all rows in `user_concept_edges` where `concept_a` or
   `concept_b` matches the deleted node's label are also deleted in the same
   transaction (or immediately after).
4. Pruning runs in a single DB transaction so that a partial failure does not
   leave the graph in an inconsistent state (nodes deleted, edges not, or vice
   versa). **Architect decision**: whether the composite score computation runs
   in SQL (computed column in SELECT) or in application code after fetching all
   node rows (flag for design doc).
5. The function is idempotent: calling it on a graph with fewer than 300 nodes
   is a no-op.
6. `npx tsc --noEmit` passes.

---

#### DEPTH-009 — Concept Resonance Bonus at Ranking Time

**Priority**: P0
**Blocks**: —
**Depends on**: DEPTH-005, DEPTH-007

**As a** feed ranker that uses the concept graph as a supplementary signal,
**I want** `rankFeed()` to apply a small concept resonance bonus to articles
whose title or description contains labels from the user's top-20 most-weighted
concept nodes,
**so that** articles on familiar intellectual terrain surface higher in the feed
even when they come from low-source-score origins, without the concept match
overwhelming the source and aesthetic signals.

#### Acceptance Criteria

1. At ranking time, the top-20 concept nodes by `engagement_weight` for the
   user identity are fetched from `user_concepts`. If the user has no concept
   graph yet (new user or no likes with body text), `concept_bonus = 0` for
   all articles and no DB query is made.
2. For each article being ranked, the ranker checks whether two or more concept
   node labels appear in the article's `title + ' ' + description` string.
   The match is case-insensitive substring. **Architect decision**: exact
   normalization behavior (punctuation stripping, stemming) — flag for design doc.
3. If two or more concept node labels match, `concept_bonus = 0.10` (the cap).
   If exactly one label matches, `concept_bonus = 0.05`. If zero labels match,
   `concept_bonus = 0`.
4. The concept bonus is applied only to articles that do not already rank in the
   top 30% by (`0.7 * source_score + 0.3 * aesthetic_proximity`) alone. Articles
   already in the top 30% receive `concept_bonus = 0` regardless of concept
   match, to prevent the concept graph from creating a reinforcing feedback loop
   on already-highly-ranked content.
5. The final ranking formula becomes:
   `final_score = 0.7 * source_score + 0.3 * aesthetic_proximity + concept_bonus`
   The `0.7` / `0.3` split is unchanged from Phase 2.
6. The Architect documents how the top-20 concept query is issued (one query per
   ranking call, or cached for the duration of the pipeline run).
7. `npx tsc --noEmit` passes.

---

#### DEPTH-010 — Concept Graph DB Helpers

**Priority**: P0
**Blocks**: —
**Depends on**: DEPTH-005

**As a** developer building the concept graph subsystem,
**I want** typed DB helper functions for all concept graph read and write
operations grouped in a single module,
**so that** the feedback handler, ranker, and pruning function all go through
a consistent, testable data access layer instead of writing raw SQL inline.

#### Acceptance Criteria

1. A new module (e.g., `lib/db/concepts.ts`) exports functions covering at
   minimum: upsert concept node, upsert concept edge, get top-N concept nodes
   by engagement weight for a user identity, count concept nodes for a user
   identity, and delete concept nodes (and their edges) by ID list.
2. Each function accepts a user identity object consistent with the pattern used
   in `lib/db/aesthetics.ts` (nullable `userId` + required `deviceId`).
3. All functions return typed results using `UserConcept` and `UserConceptEdge`
   from DEPTH-005 where applicable.
4. Functions that write to the DB use parameterized queries (no string
   interpolation of user-supplied values).
5. `npx tsc --noEmit` passes.

---

### Group C — Taste Drift Detection

---

#### DEPTH-011 — Drift Score Computation

**Priority**: P1
**Blocks**: DEPTH-012, DEPTH-013
**Depends on**: DEPTH-003 (short-term centroid recompute must exist)

**As a** system that detects when a user's recent taste has meaningfully diverged
from their historical baseline,
**I want** a function that computes a drift score as the cosine distance between
the short-term and long-term centroids,
**so that** the system has a single, deterministic measurement of how far the
user's recent engagement has moved from their established aesthetic identity.

#### Acceptance Criteria

1. A pure function `computeDriftScore(profile: AestheticProfile): number | null`
   returns `1 - cosineSimilarity(short_term_centroid, long_term_centroid)` using
   the existing `lib/utils/cosineSimilarity.ts` utility.
2. The function returns `null` (drift cannot be measured) when either of the
   following is true:
   - `short_term_centroid` is null, or
   - `short_term_feedback_count < 3`.
   In both cases, drift is treated as not-detected by the caller.
3. The function returns a value in `[0, 1]` where `0` = perfect alignment and
   `1` = complete orthogonality.
4. The function is pure (no side effects, no DB calls). Persistence of drift
   state is handled by DEPTH-012.
5. `npx tsc --noEmit` passes.
6. The function is unit-testable: given two identical vectors it returns `0`;
   given two orthogonal vectors it returns a value close to `1`; given the
   BRD's illustrative case (cosine similarity ~0.75) it returns ~0.25.

---

#### DEPTH-012 — Drift State Persistence

**Priority**: P1
**Blocks**: DEPTH-013
**Depends on**: DEPTH-001 (drift columns), DEPTH-011

**As a** system that persists drift state across pipeline runs and feedback events,
**I want** the drift score computed on each feedback event to update `is_drifting`
and `drift_detected_at` on `user_aesthetic_profiles`,
**so that** the blend inversion in DEPTH-013 can read the current drift state
from the profile without recomputing drift on every ranking call.

#### Acceptance Criteria

1. After `computeDriftScore()` (DEPTH-011) is called on each feedback event, a
   helper updates `user_aesthetic_profiles` for the user identity as follows:
   - If `drift_score >= 0.25` and `is_drifting` is currently false: set
     `is_drifting = TRUE`, `drift_detected_at = now()`.
   - If `drift_score < 0.25` and `is_drifting` is currently true: set
     `is_drifting = FALSE`, `drift_detected_at = NULL`.
   - If `drift_score` is null (short-term window unreliable): set
     `is_drifting = FALSE`, `drift_detected_at = NULL`.
2. The `0.25` drift threshold is a named constant (e.g., `DRIFT_THRESHOLD`)
   in the same config location as the blend weight constants from DEPTH-004.
   **Architect decision**: exact file location (flag for design doc).
3. Drift state is also evaluated at the start of the daily pipeline run
   (immediately after the short-term centroid is recomputed for the window
   roll), so that drift state remains current even on days the user gives no
   feedback.
4. The update is performed in a single SQL statement where possible (not a
   fetch-then-write round trip for the state check). **Architect decision**:
   exact SQL strategy.
5. `npx tsc --noEmit` passes.

---

#### DEPTH-013 — Blend Inversion During Drift

**Priority**: P1
**Blocks**: —
**Depends on**: DEPTH-004, DEPTH-012

**As a** feed that responds dynamically to periods of genuine taste shift,
**I want** `blendCentroids()` to use the elevated `DRIFT_SHORT_TERM_WEIGHT`
(0.65) when `is_drifting` is true on the user's profile,
**so that** during drift periods the feed leans into the user's current engagement
pattern rather than being pulled back toward a historical baseline that may no
longer reflect their present interest.

#### Acceptance Criteria

1. `blendCentroids()` from DEPTH-004 reads `profile.is_drifting` and substitutes
   `DRIFT_SHORT_TERM_WEIGHT` (default `0.65`) for `SHORT_TERM_WEIGHT` (default
   `0.35`) when `is_drifting` is true.
2. `DRIFT_SHORT_TERM_WEIGHT` and `SHORT_TERM_WEIGHT` are co-located named
   constants. Their values sum to 1.0 when read as (weight, 1-weight). The
   design note in the BRD confirms this symmetry is intentional.
3. When `is_drifting` is false (or the profile has no short-term centroid),
   `blendCentroids()` uses `SHORT_TERM_WEIGHT = 0.35`, unchanged from
   DEPTH-004's baseline behavior.
4. No additional code changes are needed in `rankFeed()` — the drift effect is
   fully encapsulated inside `blendCentroids()`.
5. `npx tsc --noEmit` passes.

---

### Group D — Feedback Richness Signals

---

#### DEPTH-014 — Dwell Time Client Tracking

**Priority**: P1
**Blocks**: DEPTH-015
**Depends on**: Phase 2 article reading view at `app/articles/[id]/` (shipped)

**As a** system inferring reading depth from time spent on an article,
**I want** the article reading view to track active foreground time using
`visibilitychange` events and send the accumulated dwell time to the server
when feedback is given or when the user leaves the page,
**so that** a dwell time signal is available to the server without requiring any
new user action beyond normal reading behavior.

#### Acceptance Criteria

1. The article reading view (`app/articles/[id]/page.tsx` or its client
   component) initializes a dwell timer when the page mounts, using a
   `visibilitychange` event listener to accumulate only foreground time.
   Time is not accumulated while `document.visibilityState === 'hidden'`.
2. The accumulated dwell time is stored in component state as whole seconds.
3. When the user taps Like or Dislike, the current accumulated dwell time is
   included in the feedback payload as `dwellSeconds: number` alongside the
   existing `articleId` and `value` fields.
4. When the user leaves the article page without giving explicit feedback (via
   `beforeunload` or navigation away), the accumulated dwell time is sent to the
   server as a standalone beacon. **Architect decision**: whether this uses a
   separate endpoint or an extended `POST /api/feedback` with a `value: null`
   sentinel (flag for design doc).
5. If the user spends fewer than 5 seconds on the page, no beacon is sent
   (avoids noise from accidental navigation).
6. The dwell timer is cleaned up on component unmount (event listener removed).
7. `npx tsc --noEmit` passes.

---

#### DEPTH-015 — Dwell Time Server Acceptance and Storage

**Priority**: P1
**Blocks**: DEPTH-016
**Depends on**: DEPTH-014

**As a** server that receives dwell time alongside explicit feedback,
**I want** `POST /api/feedback` to accept an optional `dwellSeconds` field and
make it available for the concept weight computation,
**so that** the engagement weight applied to concept graph updates reflects
reading depth, not just the binary like/dislike signal.

#### Acceptance Criteria

1. `POST /api/feedback` accepts an optional `dwellSeconds: number` field in the
   request body. The field is validated as a non-negative integer. If absent or
   null, behavior is unchanged from the current implementation.
2. **Architect decision**: whether `dwellSeconds` is persisted as a column on the
   feedback table (for future analysis) or used transiently only within the
   feedback handler to compute the engagement weight for the current event. This
   must be documented in the design doc (flag for design doc).
3. The handler computes `engagementWeight` from `dwellSeconds` using the
   following table (from BRD-009 Feature 4):
   - `dwellSeconds >= 180`: `engagementWeight = 1.5`
   - `dwellSeconds` in `[60, 179]`: `engagementWeight = 1.2`
   - `dwellSeconds < 60` or absent: `engagementWeight = 1.0`
   The three threshold values and three weight values are named constants in the
   same config location as the blend weight constants.
4. The computed `engagementWeight` is passed to the concept graph upsert function
   (DEPTH-007). It does not affect the Phase 2 EMA centroid update, which
   continues to treat all likes as equal-weight events.
5. `npx tsc --noEmit` passes.

---

#### DEPTH-016 — Concept Weight Modulation from Implicit Signals

**Priority**: P1
**Blocks**: —
**Depends on**: DEPTH-007, DEPTH-015

**As a** concept graph that reflects the depth of engagement, not just its breadth,
**I want** the `engagementWeight` passed to the concept upsert to incorporate
both dwell time and save/bookmark signals according to the weighting table in
BRD-009,
**so that** concepts from articles the user read deeply or saved are ranked more
highly than concepts from articles that were liked but only skimmed.

#### Acceptance Criteria

1. The `engagementWeight` computation in the feedback handler applies the
   following rules (evaluated in priority order):
   - Like + Save: `engagementWeight = 1.8` (cap, regardless of dwell)
   - Like + `dwellSeconds >= 180`: `engagementWeight = 1.5`
   - Like + `dwellSeconds` in `[60, 179]`: `engagementWeight = 1.2`
   - Like + `dwellSeconds < 60` or no dwell data: `engagementWeight = 1.0`
   - Save without explicit like: `engagementWeight = 1.2`
2. All five weight values and their associated dwell thresholds are named
   constants co-located in the same config file as the other Phase 3 constants.
3. The `engagementWeight` is passed to DEPTH-007's upsert function, which adds
   it to the existing `engagement_weight` on the node row on conflict.
4. The aesthetic centroid EMA update (Phase 2) is not affected by `engagementWeight`.
5. `npx tsc --noEmit` passes.

---

#### DEPTH-017 — Save/Bookmark Action

**Priority**: P1
**Blocks**: —
**Depends on**: DEPTH-005, DEPTH-007

**As a** user reading an article I want to return to,
**I want** a Save button on the article reading view so I can flag an article
without necessarily Liking it,
**so that** I have a low-friction way to mark articles that feel important or
that I want to finish reading later, without conflating that intent with an
aesthetic endorsement.

#### Acceptance Criteria

1. A Save button (bookmark icon or equivalent) is present in the article reading
   view UI alongside the Like and Dislike buttons. The Architect decides exact
   placement.
2. Tapping Save sends `POST /api/feedback` with `value: 'save'` for the article.
   The `feedbackSlot` type in `lib/types/article.ts` is extended to include
   `'save'`.
3. A saved article displays a visual "saved" state in the UI (e.g., filled
   bookmark icon), consistent with how liked and disliked articles show their
   state.
4. Saving the same article again (tapping Save when already saved) un-saves it
   (toggles back to null), consistent with the existing Like/Dislike toggle
   behavior.
5. A `save` feedback value does not update the aesthetic centroid. It is filtered
   out of the Phase 2 EMA update path in the feedback handler. Only `'like'` and
   `'dislike'` events trigger centroid updates.
6. A `save` event does trigger concept extraction (DEPTH-006) and graph upsert
   (DEPTH-007) with `engagementWeight = 1.2` (from DEPTH-016's table: "Save
   without explicit like").
7. `npx tsc --noEmit` passes.

---

## Future Stories

The following items are explicitly out of scope for Phase 3. They are recorded
here for continuity with Phase 4 planning.

| ID | Title | Phase | Notes |
|----|-------|-------|-------|
| FUTURE-DEPTH-001 | Graph traversal for serendipity injection | Phase 4 | Use concept graph edges to surface articles at the user's intellectual perimeter |
| FUTURE-DEPTH-002 | User-visible concept graph dashboard | Future | Internal signal only in Phase 3; visualization deferred |
| FUTURE-DEPTH-003 | Drift indicator in feed UI | Future | Drift is system-internal in Phase 3 |
| FUTURE-DEPTH-004 | Natural language feedback | Future | Out of scope per BRD-009 non-goals |
| FUTURE-DEPTH-005 | Scroll depth as engagement proxy | Future | Excluded in BRD-009; noise-to-signal too high |
| FUTURE-DEPTH-006 | Per-user adaptive blend weights | Future | Requires psychographic modeling infrastructure |
| FUTURE-DEPTH-007 | Retroactive concept extraction on pre-Phase-3 liked articles | Future | Bootstraps the graph from existing feedback history |
| FUTURE-DEPTH-008 | Cross-device concept graph merge on login | Future | Consistent with cross-device feedback merge (AUTH-006); deferred |

---

## Story Summary Table

| ID | Title | Group | Priority |
|----|-------|-------|----------|
| DEPTH-001 | Short-Term Centroid Database Schema | A — Short/Long Memory | P0 |
| DEPTH-002 | Short-Term Centroid TypeScript Type Extensions | A — Short/Long Memory | P0 |
| DEPTH-003 | Short-Term Centroid Recompute Function | A — Short/Long Memory | P0 |
| DEPTH-004 | Blended Centroid at Ranking Time | A — Short/Long Memory | P0 |
| DEPTH-005 | Concept Graph Database Schema | B — Concept Graph | P0 |
| DEPTH-006 | Concept Extraction from Liked Articles | B — Concept Graph | P0 |
| DEPTH-007 | Concept Graph Upsert and Edge Creation | B — Concept Graph | P0 |
| DEPTH-008 | Concept Graph Pruning | B — Concept Graph | P0 |
| DEPTH-009 | Concept Resonance Bonus at Ranking Time | B — Concept Graph | P0 |
| DEPTH-010 | Concept Graph DB Helpers | B — Concept Graph | P0 |
| DEPTH-011 | Drift Score Computation | C — Taste Drift | P1 |
| DEPTH-012 | Drift State Persistence | C — Taste Drift | P1 |
| DEPTH-013 | Blend Inversion During Drift | C — Taste Drift | P1 |
| DEPTH-014 | Dwell Time Client Tracking | D — Implicit Signals | P1 |
| DEPTH-015 | Dwell Time Server Acceptance and Storage | D — Implicit Signals | P1 |
| DEPTH-016 | Concept Weight Modulation from Implicit Signals | D — Implicit Signals | P1 |
| DEPTH-017 | Save/Bookmark Action | D — Implicit Signals | P1 |
