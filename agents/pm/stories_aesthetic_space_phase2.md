# User Stories — Latent Aesthetic Space, Phase 2

**Document ID**: stories_aesthetic_space_phase2.md
**Date**: 2026-04-04
**Status**: Draft
**Phase**: Phase 2 — Latent Aesthetic Space
**Source BRD**: `agents/ba/brd_aesthetic_space_phase2.md` (BRD-008)
**Maintained by**: PM Agent

---

## Overview

Phase 2 introduces a new layer of personalization that operates below the topic and
source level. Rather than learning which sources a user likes, the system will learn
what kind of *writing* a user gravitates toward — regardless of subject matter or
publication.

Every article that enters the pipeline is scored along six aesthetic dimensions
(tone, pacing, abstraction, voice, register, and emotional resonance) by an LLM at
ingestion time. These scores are stored as a six-element vector in the database using
pgvector. As the user gives feedback, the system builds and refines a running
aesthetic profile — a centroid in this six-dimensional space. Feed ranking blends this
aesthetic proximity signal (30%) with the existing source-score signal (70%), producing
a feed that gets better not just at knowing what the user *reads from*, but at
understanding what kind of writing *feels right* to them.

Five concrete scope areas make up Phase 2:

1. **Aesthetic dimension schema**: A fixed set of six orthogonal dimensions, each
   scored 1.0–5.0, defined precisely enough that the LLM scores them consistently.

2. **LLM-based aesthetic scoring**: Every article scored at ingest via Claude Haiku
   using structured output; scores stored as `vector(6)` in Postgres via pgvector.
   Scoring failures degrade gracefully — the article remains in the feed.

3. **User aesthetic profile**: A per-user centroid vector updated incrementally via
   EMA (alpha = 0.2) on each qualifying feedback event. Cold start is handled
   without special-case code.

4. **Aesthetic-aware ranking**: The existing `rankFeed()` function is extended to
   blend cosine similarity between the user's centroid and each article's score
   vector into the final rank score.

5. **Cold-start handling**: A new user with zero feedback sees no change from the
   current experience. The EMA mechanism naturally bootstraps from the first
   qualifying feedback event.

All five areas build on Phase 1 infrastructure (body extraction, LLM evaluation
pipeline, pgvector already available in Neon, existing feedback DB helpers). The RSS
and NewsAPI fixed-source pipeline, UI, and downstream API behavior are unchanged.
There is no new user-visible UI in Phase 2.

---

## Dependency Order for the Architect

The five scope areas are not independent. The required implementation order is:

```
AESTH-001 through AESTH-003  (Dimension schema — definitions and constants)
    — must precede all scoring and profile work
    — AESTH-001 and AESTH-002 can be implemented simultaneously
    — AESTH-003 BLOCKS everything in Groups B and C

AESTH-004 through AESTH-007  (Group B — LLM scoring pipeline)
    — depends on AESTH-003 (dimension schema constants)
    — AESTH-004 BLOCKS AESTH-005, AESTH-006, AESTH-007

AESTH-008 through AESTH-010  (Group C — User aesthetic profile)
    — depends on AESTH-004 (aesthetic scores must exist to update the profile)
    — AESTH-008 BLOCKS AESTH-009 and AESTH-010

AESTH-011 through AESTH-013  (Group D — Aesthetic-aware ranking)
    — depends on AESTH-008 (profile must be readable to use at ranking time)
    — AESTH-011 BLOCKS AESTH-012 and AESTH-013

AESTH-014 through AESTH-015  (Group E — Cold-start and graceful degradation)
    — depends on AESTH-011 (blending logic must exist to verify zero-term behavior)
    — can be verified in parallel with Group D stories
```

---

## Architect-Level Decisions (Flagged — Do Not Resolve in Stories)

The following questions are implementation decisions the Architect must resolve
in the design document. They are called out in the relevant stories so the
Architect cannot miss them, but the PM does not constrain the choice.

1. **pgvector schema for article scores**: The BRD specifies a `vector(6)` column
   in Postgres keyed by `article_id`. The Architect decides: table name and full
   DDL, whether this is a standalone table or a new column on an existing table,
   indexing strategy (IVFFlat vs. HNSW vs. no vector index given the small corpus
   size), and whether the migration is applied via a new numbered SQL file under
   `lib/db/migrations/` (consistent with prior art) or inline at startup.

2. **pgvector schema for user aesthetic profiles**: The BRD specifies a
   `user_aesthetic_profiles` table with `vector(6)` centroid, `feedback_count`
   integer, and `updated_at` timestamp, keyed by `user_id` or `device_id`. The
   Architect decides the full DDL, whether `user_id` and `device_id` are separate
   nullable columns (consistent with the identity routing pattern in Milestone 3)
   or a unified key approach, and which existing DB migration file to follow as a
   model.

3. **Cosine similarity implementation**: The BRD specifies cosine similarity between
   the user centroid and article score vectors. The Architect decides whether to
   compute this in-database using pgvector's `<=>` operator (which returns cosine
   distance, not similarity — the difference is 1 - distance) or in application
   code after fetching both vectors. Given that Phase 2 does not require nearest-
   neighbor index scans (ranking is O(20) at query time, not O(millions)), an
   in-code implementation may be simpler. The Architect documents the choice and
   ensures the result is correctly normalized to [-1, 1] before blending.

4. **EMA update storage format and atomicity**: The BRD specifies the centroid is
   updated via EMA on each feedback event. The Architect decides how the centroid
   vector is read, mutated, and written back (SQL UPDATE with computed value, or
   fetch-then-update in application code), and what isolation guarantees are
   required (e.g., whether a concurrent feedback event from two devices could
   cause a lost update, and whether that matters at current scale).

5. **LLM scoring model ID and prompt structure**: The BRD specifies
   `claude-haiku-4-5-20251001` with structured output using a `score_aesthetic`
   tool. The Architect confirms the model ID is still current, designs the exact
   tool schema (field names, types, validation bounds), writes the system prompt
   framing (the "thoughtful editor" persona, pole descriptions for each dimension,
   midpoint instruction, extremes guidance), and documents the expected cost per
   run at 20–60 scored articles/day.

6. **Integration point for aesthetic scoring in the pipeline**: The BRD specifies
   scoring happens "before the article enters the batch file." The Architect decides
   the exact call site in `lib/discovery/run.ts` or `lib/pipeline/run.ts`, whether
   scoring is called per-article or in a batched pass, and whether the score is
   written to DB immediately after scoring or buffered until the batch is committed.

7. **Feedback handler integration for profile updates**: The BRD specifies the
   centroid is updated "when feedback is processed." The Architect decides whether
   the EMA update is triggered inside the existing `POST /api/feedback` handler (in
   `app/api/feedback/route.ts`) or in a separate async step, and how the handler
   resolves the article's aesthetic score vector at update time (direct DB lookup,
   batch-file lookup, or in-memory cache during the request).

---

## Stories

---

### Group A — Aesthetic Dimension Schema

---

#### AESTH-001 — Six-Dimension Aesthetic Schema Definition

**Priority**: P0
**Blocks**: AESTH-003, AESTH-004
**Depends on**: —

**As a** system that scores articles for aesthetic qualities,
**I want** a precisely defined, versioned set of six aesthetic dimensions with
named poles, a 1.0–5.0 scale, and documented midpoint semantics,
**so that** LLM scoring prompts can reference a single authoritative definition
and scores from different pipeline runs are comparable.

#### Acceptance Criteria

1. Six dimensions are defined and named in code as a canonical constant or type:
   Contemplative/Propulsive, Concrete/Abstract, Personal/Universal,
   Playful/Serious, Specialist/Generalist, and Emotionally Resonant/Neutral.
2. Each dimension is defined with: a machine-readable key (used as the JSON field
   name in the LLM tool call), a human-readable label, a description of the
   low-pole (1.0) and high-pole (5.0) semantics, and a description of the
   neutral midpoint (3.0).
3. The scale range is 1.0 to 5.0 inclusive, with decimal precision to one place
   (e.g., 3.5). The definition explicitly documents that 1.0 and 5.0 are reserved
   for clearly extreme cases.
4. Dimension definitions are stored in a single source-of-truth location
   (a TypeScript constant, a config file, or a type module) such that a change to
   a dimension requires editing exactly one file. The Architect decides the location
   and documents it.
5. The six dimensions are ordered consistently in all representations: schema
   definitions, LLM tool output, database vector storage, and application code.
   The canonical order is: [contemplative, concrete, personal, playful,
   specialist, emotional] (indices 0–5). This order must not change without a
   corresponding database migration.

---

#### AESTH-002 — Aesthetic Score TypeScript Type

**Priority**: P0
**Blocks**: AESTH-004, AESTH-008, AESTH-011
**Depends on**: AESTH-001

**As a** developer building the scoring pipeline and ranking logic,
**I want** a shared TypeScript type representing a six-element aesthetic score
vector,
**so that** the LLM scorer output, database read/write helpers, profile update
logic, and ranker all operate on the same typed structure and TypeScript
catches any field-count mismatch at compile time.

#### Acceptance Criteria

1. A TypeScript interface or type alias `AestheticScoreVector` (or equivalent)
   is defined in `lib/types/` and exported. It represents all six dimension scores
   as named numeric fields (not an anonymous tuple), one field per dimension,
   using the machine-readable keys established in AESTH-001.
2. A utility function or method converts the named-field representation to an
   ordered numeric array `[number, number, number, number, number, number]` for
   pgvector storage and cosine similarity computation. The canonical array order
   is the same as defined in AESTH-001 (indices 0–5).
3. `npx tsc --noEmit` passes with no new type errors after this type is introduced.
4. The type is imported by (or will be imported by) the LLM scorer module, the DB
   helper for aesthetic scores, the profile update helper, and the ranker. The
   Architect determines the exact import graph.

---

#### AESTH-003 — Aesthetic Scoring Constants

**Priority**: P0
**Blocks**: AESTH-004, AESTH-008, AESTH-011
**Depends on**: AESTH-001, AESTH-002

**As a** system that tunes its aesthetic ranking and profile update behavior,
**I want** all numeric tuning constants — alpha, blend weights, scale bounds, and
text-input limits — defined as named, documented constants in a single config
location,
**so that** they can be adjusted without hunting through multiple files and without
touching the logic that uses them.

#### Acceptance Criteria

1. The following constants are defined and named (exact names are Architect
   decisions; the semantics are fixed):
   - EMA adaptation rate: `0.2` (alpha used in profile centroid updates)
   - Aesthetic blend weight: `0.3` (aesthetic proximity share of final score)
   - Source score blend weight: `0.7` (source score share of final score)
   - Aesthetic dimension scale minimum: `1.0`
   - Aesthetic dimension scale maximum: `5.0`
   - Body text minimum length for scoring: `300` characters
   - Body text maximum characters sent to LLM: `3,000` characters
2. The two blend weights sum to 1.0. A startup assertion or compile-time check
   verifies this. An assertion failure must surface at pipeline startup, not
   silently at runtime.
3. All constants are in a single file. The Architect decides whether this file
   is `lib/config/feed.ts` (extending the existing constants file) or a new
   `lib/config/aesthetic.ts` file and documents the choice.
4. Every constant has an inline comment explaining its meaning, unit, and the
   rationale for the specific value.

---

### Group B — LLM-Based Aesthetic Scoring

---

#### AESTH-004 — Aesthetic Scorer Module

**Priority**: P0
**Blocks**: AESTH-005, AESTH-006, AESTH-007
**Depends on**: AESTH-001, AESTH-002, AESTH-003

**As a** pipeline that scores every article for aesthetic qualities,
**I want** an isolated, pure-function module that accepts an article's text input
and returns a six-element aesthetic score vector by calling the LLM with
structured output,
**so that** the scoring logic is independently testable, the LLM call is
encapsulated, and failures are catchable at the call site.

#### Acceptance Criteria

1. A module `lib/discovery/aestheticScorer.ts` (or equivalent path chosen by
   the Architect) exports a single async function `scoreAesthetic(input: string):
   Promise<AestheticScoreVector>` (or equivalent typed signature). The function
   accepts a text string and returns a fully populated score vector.
2. The function calls `claude-haiku-4-5-20251001` (or the current equivalent model
   confirmed by the Architect) using the Anthropic SDK's tool-use structured output
   mechanism, with a `score_aesthetic` tool whose JSON schema enforces six named
   float fields, each in the range 1.0–5.0. The Architect designs the exact tool
   schema and documents it.
3. The system prompt frames the model as a thoughtful editor scoring the six
   dimensions as defined in AESTH-001. The prompt instructs the model to use 3.0
   as the midpoint for neutral writing, and to reserve 1.0 and 5.0 for clearly
   extreme cases. The exact prompt text is an Architect decision and must be
   documented in the design doc.
4. If the LLM call fails (network error, API error, timeout) or returns a malformed
   or out-of-range response, the function throws a typed error (not swallows it
   silently). The caller is responsible for handling the failure and writing a NULL
   score to the database.
5. The module does not perform text truncation or source selection internally. The
   caller passes in the pre-prepared text string. (Text preparation logic lives in
   the pipeline integration story, AESTH-006.)
6. `npx tsc --noEmit` passes after this module is introduced.

**Architect decision required**: Exact LLM model ID, tool schema field names and
validation, system prompt text, and handling of partial or truncated LLM responses.

---

#### AESTH-005 — Aesthetic Scores Database Schema

**Priority**: P0
**Blocks**: AESTH-006, AESTH-007
**Depends on**: AESTH-002

**As a** system that stores and retrieves per-article aesthetic scores,
**I want** a Postgres table backed by pgvector that stores a six-element float
vector keyed by article ID,
**so that** scores written at ingest time can be retrieved at ranking time without
re-running the LLM.

#### Acceptance Criteria

1. A new Postgres table (table name is an Architect decision) stores at minimum:
   `article_id` (the same deterministic hash used in `Article.id`), a `vector(6)`
   column for the six-dimension score, and a `created_at` timestamp.
2. `article_id` is the primary key. A second insert for the same `article_id`
   performs an upsert (ON CONFLICT DO UPDATE) rather than failing with a duplicate
   key error.
3. The pgvector extension is confirmed enabled in the Neon instance. If not
   enabled, the migration fails with a clear error message rather than silently
   creating the table with an incompatible column type.
4. A SQL migration file is created under `lib/db/migrations/` following the
   existing naming convention (e.g., `008_aesthetic_scores.sql`). The migration is
   idempotent (safe to re-run).
5. A TypeScript DB helper module (path determined by the Architect, e.g.,
   `lib/db/aesthetics.ts`) exports at minimum:
   - `upsertArticleAestheticScore(articleId: string, scores: AestheticScoreVector): Promise<void>`
   - `getArticleAestheticScore(articleId: string): Promise<AestheticScoreVector | null>`
6. Both helper functions handle DB errors by throwing, not swallowing. NULL is
   returned by `getArticleAestheticScore` when no row exists, not on error.
7. `npx tsc --noEmit` passes after the helper module is introduced.

**Architect decision required**: Table name, full DDL including index strategy,
migration file numbering, whether to store scores as a pgvector column or as a
JSONB array, and the DB helper module path.

---

#### AESTH-006 — Pipeline Integration: Score Every Article at Ingest

**Priority**: P0
**Blocks**: AESTH-007
**Depends on**: AESTH-004, AESTH-005

**As a** pipeline that produces aesthetically scored articles,
**I want** every article that completes the pipeline to be scored by the aesthetic
scorer before the batch is committed,
**so that** all new articles in the system have aesthetic scores available for
ranking without a separate backfill step.

#### Acceptance Criteria

1. After an article passes validation and before the batch is written to disk,
   the pipeline calls the aesthetic scorer for each article.
2. The text input passed to the scorer is selected as follows: if `article.bodyText`
   is present and has at least 300 characters, use the first 3,000 characters of
   `article.bodyText`. Otherwise, use the concatenation of `article.title` and
   `article.description` (if available). This text preparation logic is implemented
   at the call site (in the pipeline integration), not inside the scorer module.
3. The resulting `AestheticScoreVector` is written to the DB via the helper
   introduced in AESTH-005 (`upsertArticleAestheticScore`).
4. If the scorer throws an error for a specific article (as specified in AESTH-004
   AC-4), the error is caught at the call site, logged with the article ID and
   error message, and the pipeline continues. A NULL score is written to the DB
   (or the row is omitted, as determined by the Architect). The article is still
   included in the batch output.
5. The batch file on disk is not modified to include aesthetic scores. Scores live
   in the database only. `Article.bodyText` and all existing `Article` fields are
   unchanged.
6. A pipeline run log entry records the count of articles scored, count of scoring
   failures, and total scoring time (in milliseconds). This is consistent with
   the observability pattern established in AGDISC-010.
7. `npx tsc --noEmit` passes after the integration is introduced.

**Architect decision required**: Exact call site within `lib/pipeline/run.ts` or
`lib/discovery/run.ts`, whether scoring is per-article sequential or batched, and
whether a NULL score means an absent row or a NULL column value.

---

#### AESTH-007 — Scoring Failure Isolation

**Priority**: P0
**Blocks**: —
**Depends on**: AESTH-006

**As a** pipeline that must never drop articles due to a non-critical service
failure,
**I want** aesthetic scoring failures to be fully isolated from article delivery,
**so that** an LLM API outage, rate limit, or malformed response never prevents
an article from appearing in the feed.

#### Acceptance Criteria

1. When the aesthetic scorer fails for any article (any exception type), the
   article still appears in the batch output. The scoring failure for article N
   does not affect scoring of article N+1.
2. Each scoring failure is logged with: the article ID, the article URL, the
   error class (network error, API error, parse error, timeout), and the error
   message. Log format is consistent with existing pipeline error log format.
3. If all articles in a run fail scoring (e.g., the LLM API is completely
   unavailable), the batch is still written and the feed is served normally,
   ranked by source score only for all articles.
4. Scoring failures do not increment any error counter that could trigger a
   pipeline-level abort or alerting mechanism (if such a mechanism is added in
   the future). Scoring failure is expected to be a recoverable transient error.
5. Verification: given a mock scorer that throws unconditionally, the pipeline
   completes, the batch is written, and the log contains one failure entry per
   article with the correct article ID.

---

### Group C — User Aesthetic Profile

---

#### AESTH-008 — User Aesthetic Profile Database Schema

**Priority**: P0
**Blocks**: AESTH-009, AESTH-010, AESTH-011
**Depends on**: AESTH-005

**As a** system that maintains a per-user running aesthetic taste profile,
**I want** a Postgres table that stores each user's or device's current aesthetic
centroid vector, feedback event count, and last-updated timestamp,
**so that** the centroid can be read at ranking time and updated incrementally on
each feedback event.

#### Acceptance Criteria

1. A new Postgres table `user_aesthetic_profiles` (or equivalent name confirmed
   by the Architect) stores at minimum:
   - An identity key: `user_id` (nullable UUID, references the `users` table)
     and/or `device_id` (nullable text) — the Architect decides the exact schema,
     consistent with the identity routing pattern from Milestone 3.
   - `centroid`: a `vector(6)` column representing the current aesthetic centroid.
   - `feedback_count`: an integer representing the total number of qualifying
     feedback events incorporated into this centroid.
   - `updated_at`: an ISO-8601 timestamp of the last centroid update.
2. The table supports upsert: inserting a profile for an identity that already
   exists updates the existing row rather than failing.
3. A SQL migration file is created under `lib/db/migrations/` following the
   existing numbering convention. The migration is idempotent.
4. A TypeScript DB helper module exports at minimum:
   - `getAestheticProfile(identity): Promise<AestheticProfile | null>` — returns
     the full profile row, or null if no profile exists yet.
   - `upsertAestheticProfile(identity, centroid: AestheticScoreVector, feedbackCount: number): Promise<void>`
   The `identity` type is consistent with the existing identity routing pattern
   (user_id or device_id, as resolved by the Architect).
5. Both helper functions throw on DB error. Null is returned by `getAestheticProfile`
   only when no row exists for the given identity.
6. `npx tsc --noEmit` passes after the helper module is introduced.

**Architect decision required**: Table name, full DDL including identity column
design, migration file number, and the DB helper module path and exported type names.

---

#### AESTH-009 — Aesthetic Profile Update on Feedback

**Priority**: P0
**Blocks**: AESTH-010
**Depends on**: AESTH-008

**As a** system that learns the user's aesthetic taste from their feedback,
**I want** the user's aesthetic centroid to be updated via EMA each time the user
likes or dislikes an article that has an aesthetic score,
**so that** the centroid incrementally converges on the user's taste without
requiring a full recompute of historical feedback.

#### Acceptance Criteria

1. When a feedback event (like or dislike) is processed via `POST /api/feedback`,
   the handler (or an async step immediately after) attempts to update the user's
   aesthetic profile:
   a. Fetch the article's aesthetic score vector from the DB using
      `getArticleAestheticScore(articleId)`.
   b. If no score exists for the article, skip the profile update entirely. No
      error is logged; this is expected behavior for articles scored before
      Phase 2.
   c. If a score exists, fetch the user's current aesthetic profile using
      `getAestheticProfile(identity)`.
   d. If no profile exists yet (first qualifying feedback event), initialize the
      centroid: for a like, centroid = article score vector; for a dislike,
      centroid = mirror of article score vector (6.0 - score for each dimension,
      which maps the 1–5 scale to its opposite). Set feedback_count = 1.
   e. If a profile exists, apply EMA using the alpha constant from AESTH-003:
      - For a like: `centroid[i] = (1 - alpha) * centroid[i] + alpha * v[i]`
        for each dimension i.
      - For a dislike: `centroid[i] = (1 - alpha) * centroid[i] + alpha * (6.0 - v[i])`
        for each dimension i.
      Increment feedback_count by 1.
   f. Upsert the updated profile via `upsertAestheticProfile`.
2. A feedback event on an article without an aesthetic score does not create a
   profile row. The user's profile must be initialized by a feedback event on a
   scored article.
3. A profile update failure (DB error) is logged with the identity and article ID,
   but does not cause the `POST /api/feedback` request to return an error to the
   client. The feedback write itself (the primary operation) is unaffected.
4. The EMA formula is applied as written in AC-1e above. The Architect may compute
   this in application code or as a SQL expression; the result must be numerically
   identical to the formula regardless of implementation.
5. The alpha constant used in the EMA is the named constant from AESTH-003, not a
   hardcoded literal.
6. `npx tsc --noEmit` passes after the feedback handler integration is introduced.

**Architect decision required**: Whether the profile update runs synchronously
inside the feedback request handler or is deferred to an async step (and if async,
what mechanism is used and what the failure surface is).

---

#### AESTH-010 — Aesthetic Profile Read Path

**Priority**: P0
**Blocks**: AESTH-011
**Depends on**: AESTH-008, AESTH-009

**As a** ranking system that uses the user's aesthetic profile to score articles,
**I want** the current user aesthetic centroid to be readable by the ranking layer
at feed-request time,
**so that** the ranker can compute cosine similarity between the centroid and each
article's score vector.

#### Acceptance Criteria

1. The identity resolution in `GET /api/feed/today` (which already resolves
   `user_id` or `device_id` for personalization) also reads the user's aesthetic
   profile via `getAestheticProfile(identity)`.
2. If no profile exists (new user, or user with no qualifying feedback), the
   profile is treated as absent. A null/undefined profile value is passed to the
   ranker, which treats it as zero aesthetic contribution (see AESTH-011 and
   AESTH-014).
3. The DB read for the aesthetic profile occurs within the same request that fetches
   the feed, not in a separate HTTP call. It may be parallelized with other DB
   reads in the same handler (e.g., `Promise.all`).
4. If the aesthetic profile DB read fails (network error, query error), the failure
   is logged, the profile is treated as absent, and the feed is served using source
   score only. The feed request does not return an error to the client.
5. The aesthetic profile value is passed into `rankFeed()` as a new parameter (or
   via an options object). The ranker function signature is updated accordingly.
   The Architect decides the exact signature extension.

---

### Group D — Aesthetic-Aware Ranking

---

#### AESTH-011 — Cosine Similarity Utility

**Priority**: P0
**Blocks**: AESTH-012
**Depends on**: AESTH-002

**As a** ranking system that must compute aesthetic proximity between two
six-element vectors,
**I want** a utility function that computes cosine similarity between two
`AestheticScoreVector` values and returns a value in the range [-1, 1],
**so that** the ranker has a correct, independently testable proximity measure
without embedding the math inline.

#### Acceptance Criteria

1. A pure utility function `cosineSimilarity(a: number[], b: number[]): number`
   (or equivalent typed signature using `AestheticScoreVector`) is implemented.
   The function returns a value in the range [-1, 1].
2. The function handles the zero-vector edge case: if either input is a zero vector
   (all elements 0.0), the function returns 0.0 rather than producing NaN or
   throwing. This case arises when a user profile is all-zero (not a real scenario
   in Phase 2, but a defensive requirement).
3. The function is covered by at least two deterministic unit tests (or inline
   documented test cases verified during Architect review):
   - Identical vectors of any non-zero values return 1.0 (or within floating-point
     tolerance of 1.0).
   - Orthogonal vectors (dot product = 0) return 0.0.
4. The Architect decides whether this is implemented in application code (a utility
   function in `lib/`) or using pgvector's `<=>` cosine distance operator in SQL.
   The BRD notes that since ranking is over O(20) articles, an in-code
   implementation may be simpler and avoids a round-trip; this is documented as
   a recommendation but is an Architect decision.
5. If in-code, the function is placed in a utility module (e.g.,
   `lib/pipeline/aestheticUtils.ts` or `lib/utils/vector.ts`). If in-database,
   the query structure is documented in the design doc.

**Architect decision required**: In-code vs. in-database implementation, and the
exact module location if in-code.

---

#### AESTH-012 — Blended Score Computation in rankFeed()

**Priority**: P0
**Blocks**: AESTH-013
**Depends on**: AESTH-010, AESTH-011

**As a** ranking system that blends source quality and aesthetic taste into a
single article score,
**I want** `rankFeed()` to compute a blended final score for each article that
weights source score and aesthetic proximity according to the defined constants,
**so that** articles that are both source-trusted and aesthetically close to the
user's profile are ranked highest.

#### Acceptance Criteria

1. The `rankFeed()` function in `lib/pipeline/ranker.ts` is extended to accept the
   user's aesthetic profile (or null/undefined if absent) as an input parameter.
   The existing function signature and behavior are not broken: if the profile
   parameter is absent or null, the function returns the same result as before
   Phase 2.
2. For each article in the input list, the final rank score is computed as:
   `final_score = SOURCE_SCORE_WEIGHT * source_score + AESTHETIC_WEIGHT * aesthetic_proximity`
   where `SOURCE_SCORE_WEIGHT` and `AESTHETIC_WEIGHT` are the named constants from
   AESTH-003 (0.7 and 0.3 respectively).
3. `aesthetic_proximity` for a given article is computed using the cosine similarity
   utility from AESTH-011, applied to the user's aesthetic centroid and the
   article's aesthetic score vector (fetched from the DB or provided alongside the
   article). If the article has no aesthetic score, `aesthetic_proximity` is treated
   as 0.0.
4. The ranker does not fetch aesthetic scores from the DB directly. The Architect
   decides how article score vectors are made available to `rankFeed()` — passed in
   as a parallel data structure, joined before the call, or pre-populated on each
   article object. The design must not require `rankFeed()` to perform I/O.
5. The suppression check, diversity cap, and exploration budget in `rankFeed()`
   operate on the final blended score without modification. Only the score
   computation itself changes.
6. `npx tsc --noEmit` passes after the ranker modification is introduced.

**Architect decision required**: How article aesthetic score vectors are passed into
the ranker (data structure shape), how the ranker handles missing vectors for some
articles in a partially-scored batch, and whether the function accepts a map of
article IDs to vectors or expects vectors pre-attached to article objects.

---

#### AESTH-013 — Feed API Integration for Aesthetic Ranking

**Priority**: P0
**Blocks**: —
**Depends on**: AESTH-012, AESTH-010

**As a** user requesting today's feed,
**I want** the feed API to deliver articles ranked by the blended score that
incorporates my aesthetic profile,
**so that** the aesthetic ranking is live for every feed request, not only after
a pipeline re-run.

#### Acceptance Criteria

1. The `GET /api/feed/today` handler fetches the user's aesthetic profile (as
   specified in AESTH-010) and the aesthetic score vectors for all articles in
   today's batch, then passes both to `rankFeed()` before returning the response.
2. The feed response payload (`FeedResponse`) is unchanged: no new fields are
   added, no aesthetic scores or profile data are exposed to the client. The
   ranking improvement is internal.
3. If either the aesthetic profile read or the article score vector read fails, the
   feed is served using source score only (same graceful degradation as before
   Phase 2). The HTTP response status is always 200 for a valid feed request.
4. The total latency budget for the two new DB reads (aesthetic profile +
   article score vectors for ~20 articles) must not materially degrade the feed
   response time. The Architect determines whether these reads are batched
   (one query for all article IDs) or issued per-article, and whether they are
   parallelized with the existing feedback DB read.
5. No new environment variables are required for this integration. The same
   `DATABASE_URL` used by existing DB modules is used for aesthetic DB reads.

**Architect decision required**: Whether article score vectors are fetched as a
single bulk query (e.g., `WHERE article_id = ANY(...)`) or individually, and
whether the fetch is parallelized with the existing feedback read in the handler.

---

### Group E — Cold-Start and Graceful Degradation

---

#### AESTH-014 — Zero Aesthetic Term for New Users

**Priority**: P0
**Blocks**: —
**Depends on**: AESTH-012, AESTH-013

**As a** new user who has never given any feedback,
**I want** the feed to function identically to the pre-Phase-2 behavior,
**so that** Phase 2 does not alter the experience for users who have not yet
built up an aesthetic profile.

#### Acceptance Criteria

1. When `getAestheticProfile(identity)` returns null (no profile exists), the
   value passed to `rankFeed()` for the profile parameter is null or undefined.
2. `rankFeed()` treats a null/undefined aesthetic profile as an aesthetic proximity
   of 0.0 for every article. The blending formula collapses to
   `final_score = 0.7 * source_score + 0.3 * 0.0 = 0.7 * source_score`, which
   is equivalent to sorting by source score only. Ranking order is identical to
   the pre-Phase-2 output for any given set of source scores.
3. There is no special-case code path, flag, or mode switch for "cold start." The
   same code path executes for new users and established users. Cold-start behavior
   is a consequence of the null profile check, not a separate branch.
4. A new user who gives their first like or dislike on a scored article
   immediately initializes the aesthetic profile (per AESTH-009). On the next feed
   request, the profile is present and the aesthetic term is non-zero. There is no
   minimum feedback threshold before the profile becomes active.
5. A new user who gives feedback only on unscored articles has no aesthetic profile
   initialized. Their feed continues to rank by source score only until they
   interact with a scored article.

---

#### AESTH-015 — Graceful Degradation for Unscored Articles

**Priority**: P0
**Blocks**: —
**Depends on**: AESTH-012

**As a** user whose feed includes articles that were not scored (e.g., pre-Phase-2
articles, articles where scoring failed),
**I want** unscored articles to still appear in the feed and compete fairly on
source score,
**so that** a partial scoring failure never creates a dead zone of invisible
articles.

#### Acceptance Criteria

1. When an article has no aesthetic score in the DB (no row for its `article_id`),
   its aesthetic proximity contribution is 0.0. Its final score is:
   `final_score = 0.7 * source_score + 0.3 * 0.0 = 0.7 * source_score`.
2. Unscored articles are sorted against scored articles in the same pass. A highly
   source-trusted unscored article can outrank a low-source-trust scored article.
   Unscored articles are not grouped separately or penalized beyond the 0.0
   aesthetic term.
3. A batch in which no articles have aesthetic scores (all scoring failed, or
   the feature is in transition) sorts identically to the pre-Phase-2 output.
4. A batch in which some articles have aesthetic scores and some do not sorts
   coherently: scored articles compete on both signals, unscored articles compete
   on source score only. There is no undefined behavior or NaN in the sort output
   when vectors are partially absent.
5. The handling of absent vectors (null DB result, missing map key, etc.) is
   explicit in the ranker code. The Architect must ensure the ranker never receives
   an undefined value where a number is expected in the score computation.

---

## Future Stories (Explicitly Deferred)

The following items are out of scope for Phase 2 and should not be designed or
built until Phase 3 or later.

| ID | Title | Deferred To | Notes |
|----|-------|-------------|-------|
| FUTURE-AESTH-001 | User-visible aesthetic profile dashboard | Phase 3+ | No UI for aesthetic dimensions in Phase 2. Internal signal only. |
| FUTURE-AESTH-002 | Retroactive scoring of pre-Phase-2 articles | Phase 3+ | Only articles ingested after Phase 2 ships are scored. Past batch files are not re-processed. |
| FUTURE-AESTH-003 | Natural language aesthetic feedback ("I want more meditative writing") | Phase 3 | NLP feedback is a Phase 3 feature; Phase 2 uses like/dislike only. |
| FUTURE-AESTH-004 | Dimension tuning or extension without code change | Phase 3+ | Adding or modifying dimensions currently requires a code change and DB migration. Operator tooling not in scope. |
| FUTURE-AESTH-005 | Cross-modal aesthetics (audio, video, image scoring) | Phase 4+ | Phase 2 covers written articles only. |
| FUTURE-AESTH-006 | Short-term vs. long-term aesthetic preference fusion | Phase 3 | Phase 2 uses a single EMA centroid. Temporal weighting is a Phase 3 concern. |
| FUTURE-AESTH-007 | Explicit alpha tuning per user (adaptive learning rate) | Phase 3+ | Alpha is a global constant in Phase 2. Per-user adaptation rates are out of scope. |

---

## Story Summary Table

| ID | Title | Group | Priority |
|----|-------|-------|----------|
| AESTH-001 | Six-Dimension Aesthetic Schema Definition | A — Schema | P0 |
| AESTH-002 | Aesthetic Score TypeScript Type | A — Schema | P0 |
| AESTH-003 | Aesthetic Scoring Constants | A — Schema | P0 |
| AESTH-004 | Aesthetic Scorer Module | B — LLM Scoring | P0 |
| AESTH-005 | Aesthetic Scores Database Schema | B — LLM Scoring | P0 |
| AESTH-006 | Pipeline Integration: Score Every Article at Ingest | B — LLM Scoring | P0 |
| AESTH-007 | Scoring Failure Isolation | B — LLM Scoring | P0 |
| AESTH-008 | User Aesthetic Profile Database Schema | C — User Profile | P0 |
| AESTH-009 | Aesthetic Profile Update on Feedback | C — User Profile | P0 |
| AESTH-010 | Aesthetic Profile Read Path | C — User Profile | P0 |
| AESTH-011 | Cosine Similarity Utility | D — Ranking | P0 |
| AESTH-012 | Blended Score Computation in rankFeed() | D — Ranking | P0 |
| AESTH-013 | Feed API Integration for Aesthetic Ranking | D — Ranking | P0 |
| AESTH-014 | Zero Aesthetic Term for New Users | E — Cold Start | P0 |
| AESTH-015 | Graceful Degradation for Unscored Articles | E — Cold Start | P0 |
