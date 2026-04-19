# User Stories — Engineered Serendipity, Phase 4

**Document ID**: stories_engineered_serendipity_phase4.md
**Date**: 2026-04-04
**Status**: Draft
**Phase**: Phase 4 — Engineered Serendipity
**Source BRD**: `agents/ba/brd_engineered_serendipity_phase4.md` (BRD-010)
**Maintained by**: PM Agent

---

## Overview

Phase 4 introduces a deliberate, structured exploration layer on top of the Phase 3
ranking system. The goal is not randomness but engineered surprise: serving the user
articles that are genuinely fascinating and that they would never have found through
search or reinforced preference.

The phase delivers four interconnected capabilities:

1. **Surprise scoring** — a serendipity score computed for every candidate article
   at pipeline time, combining hop-distance from the user's concept graph with a
   quality weight. This is the signal that distinguishes valuable surprise from noise.

2. **Exploration budget and slot assembly** — a structured reservation of exploration
   slots in the daily 20-article feed, allocated across three surprise types (semantic
   stretch, blind spot probe, complete wildcard) with a baseline of 4 slots and an
   adaptive range of 2 to 6.

3. **Active learning via blind spot probing** — identification of conceptual domains
   absent from the concept graph, periodic injection of probe articles targeting those
   domains, and structured interpretation of the user's response (like, dislike, ignore)
   to direct future probing.

4. **Psychographic modulation via receptivity signal** — a composite score computed
   from three observable engagement signals (topic diversity, probe acceptance rate,
   dwell ratio) that adjusts the exploration budget up or down based on the user's
   current cognitive state, with a floor that guarantees exploration is never
   eliminated.

All Phase 4 changes are additive. The Phase 3 concept graph (`user_concepts`,
`user_concept_edges`), aesthetic centroids, source-score ranker, and feedback
endpoints are preserved without modification. No new UI is introduced.

---

## Dependency Order for the Architect

The four groups are not independent. The required implementation order is:

```
Group A — Surprise scoring (SEREN-001 through SEREN-005)
    — must precede Groups B, C, and D
    — SEREN-001 (concept distance utilities) BLOCKS SEREN-002 (raw surprise computation)
    — SEREN-002 BLOCKS SEREN-003 (quality weight normalization)
    — SEREN-003 BLOCKS SEREN-004 (serendipity score assembly)
    — SEREN-004 BLOCKS all of Group C (exploration slot assembly needs the score)
    — SEREN-005 (concept extraction for candidates) BLOCKS SEREN-001 being useful;
      these two stories are tightly coupled and should be sequenced together

Group B — Blind spot probing (SEREN-006 through SEREN-012)
    — SEREN-001 (concept distance utilities) is a prerequisite for blind spot
      identification; Group B should not begin until SEREN-001 is complete
    — SEREN-006 (blind spot identification) BLOCKS SEREN-007 (probe selection)
    — SEREN-007 BLOCKS SEREN-008 (probe injection and batch flag)
    — SEREN-008 BLOCKS SEREN-009 (probe response interpretation)
    — SEREN-009 BLOCKS SEREN-010 (cluster promotion) and SEREN-011 (cluster suppression)
    — SEREN-010 and SEREN-011 BLOCK SEREN-012 (ignore handling)
    — Architect decision: blind_spot_state DB schema (needed before SEREN-006)

Group C — Exploration budget and slot assembly (SEREN-013 through SEREN-017)
    — cannot begin until SEREN-004 (serendipity score) is complete
    — SEREN-013 (budget constants and configuration) BLOCKS SEREN-014
    — SEREN-014 (slot type pool construction) BLOCKS SEREN-015 (slot assembly)
    — SEREN-015 BLOCKS SEREN-016 (article deduplication across pools)
    — SEREN-016 BLOCKS SEREN-017 (feed assembly integration in rankFeed)
    — Group B's blind spot probe slot (SEREN-007) is required before SEREN-015
      can fully assemble the blind spot probe slot

Group D — Receptivity signal (SEREN-018 through SEREN-022)
    — depends on Group B (probe tracking data) and Group C (exploration/exploitation
      slot classification on article records) being available before accurate
      computation is possible
    — SEREN-018 (diversity score computation) can begin after Group C is complete
    — SEREN-019 (probe acceptance rate) requires SEREN-008 (probe injection flag)
    — SEREN-020 (dwell ratio signal) requires Group C slot classification
    — SEREN-018, SEREN-019, SEREN-020 can be implemented in parallel with each other
    — SEREN-021 (receptivity score assembly) BLOCKS SEREN-022
    — SEREN-021 depends on SEREN-018, SEREN-019, and SEREN-020
    — SEREN-022 (budget modulation) requires SEREN-021 and SEREN-013
```

---

## Architect-Level Decisions (Flagged — Do Not Resolve in Stories)

The following questions are implementation decisions the Architect must resolve in
the Phase 4 design document. They are flagged in relevant stories and must not be
silently assumed.

1. **DB schema for `blind_spot_state` table**: The BRD specifies probe suppression
   (30-day cooling) and cluster promotion (14-day elevation) state per blind spot
   cluster per user identity. The Architect decides: table name and columns (cluster
   identifier, suppression state, promotion state, timestamps, user_id/device_id
   identity pattern), index strategy, whether cluster identity is a text label or a
   hash of label set, and whether suppression and promotion state are rows in one
   table or separate tables.

2. **Serendipity score integration point in `rankFeed()`**: The BRD specifies that
   exploration slots and exploitation slots are ranked from separate pools and
   assembled at feed construction time. The Architect decides: whether serendipity
   scoring is a new pre-pass inside `rankFeed()`, a separate function called before
   `rankFeed()`, or a transformation layer applied to the candidate pool before the
   ranker runs. The existing Phase 3 ranking formula must remain unchanged for
   exploitation slots.

3. **Receptivity score storage**: The BRD specifies the receptivity score is computed
   fresh on each `rankFeed()` call and not persisted. The Architect decides: whether
   the three component signals (diversity score, probe acceptance rate, dwell ratio)
   are also transient or whether any of them benefit from intermediate caching (e.g.,
   pre-aggregated dwell data); and whether receptivity score computation requires a
   new DB query module or can be added to existing helpers.

4. **Slot classification field on article records**: The Architect decides how
   exploration vs. exploitation slot assignment is recorded on an article at feed
   assembly time so that the receptivity dwell ratio computation (SEREN-020) can
   later distinguish which pool each dwell event belongs to. Options include a
   transient in-memory flag, a new `slotType` field on the `Article` type (stripped
   at API time like `discoveryTopic`), or a separate lookup table keyed by
   article_id and batch_date.

5. **Probe concept extraction on feedback**: When a liked probe article triggers
   concept graph expansion (SEREN-009), the concept extraction and graph upsert
   follow the existing Phase 3 pipeline in `POST /api/feedback`. The Architect
   confirms whether this reuses `conceptExtractor.ts` and `lib/db/concepts.ts`
   without modification, or whether probe-sourced extraction requires a distinct
   code path (e.g., to apply a different engagement weight for probe discoveries).

6. **Quality score range from `qualityGate.ts`**: SEREN-003 (quality weight
   normalization) requires knowing the numeric range of the LLM quality score
   produced by `lib/discovery/qualityGate.ts`. The Architect must confirm this
   range before SEREN-003 can be implemented. The linear mapping to [0.5, 1.0]
   depends on knowing the min and max of the raw quality score output.

7. **Exploration slot count constants location**: The BRD specifies
   `EXPLORATION_BASELINE = 4`, `EXPLORATION_FLOOR = 2`, `EXPLORATION_CEILING = 6`,
   wildcard cap = 1, and the slot type allocation table across budget levels as
   named constants. The Architect decides whether these live in `lib/config/feed.ts`
   (alongside existing quota constants), a new `lib/config/serendipity.ts`, or
   elsewhere.

---

## Stories

---

### Group A — Surprise Scoring via Semantic Distance

---

#### SEREN-001 — Concept Distance Classification Utilities

**Priority**: P0
**Blocks**: SEREN-002, SEREN-006
**Depends on**: Phase 3 `user_concepts` and `user_concept_edges` tables (DEPTH-005,
shipped); `lib/db/concepts.ts` (DEPTH-010, shipped)

**As a** pipeline function that needs to classify an article's extracted concepts
against the user's concept graph,
**I want** a set of utility functions that accept a list of concept labels and a
user identity, query the concept graph, and classify each label as "known" (node
exists in graph), "adjacent" (no node but connected by one edge to a known node),
or "unknown" (no node and no edge connection to any known node),
**so that** the raw surprise score can be computed from these classifications without
each calling site repeating the graph query and normalization logic.

#### Acceptance Criteria

1. A function (name is an Architect decision; suggested: `classifyConceptDistance`)
   accepts a list of concept labels (strings, already normalized) and a user identity
   (`userId | deviceId`) and returns a classification result: for each label, one of
   `'known'`, `'adjacent'`, or `'unknown'`.
2. "Known" classification: a node exists in `user_concepts` for this user identity
   with a label that matches via the same normalization already used in Phase 3
   concept matching (lowercase, punctuation-stripped substring match).
3. "Adjacent" classification: no matching node exists, but at least one of the
   article's other concept labels (or a close match to one) appears as `concept_a`
   or `concept_b` on a `user_concept_edges` row for this user identity that connects
   to a known node.
4. "Unknown" classification: the concept satisfies neither known nor adjacent
   criteria.
5. The function issues at most two DB queries per call (one against `user_concepts`,
   one against `user_concept_edges`), regardless of how many concept labels are
   passed in. It does not issue per-concept queries.
6. The function is a pure transformation once the DB results are fetched: the
   classification logic is unit-testable without a DB connection by passing pre-
   fetched concept and edge sets.
7. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-002 — Raw Surprise Score Computation

**Priority**: P0
**Blocks**: SEREN-003, SEREN-004
**Depends on**: SEREN-001

**As a** pipeline function scoring each candidate article for its serendipity
potential,
**I want** a function that computes the raw surprise score for one article given its
extracted concept labels and their distance classifications,
**so that** the score reflects how novel the article's conceptual content is relative
to the user's existing knowledge map.

#### Acceptance Criteria

1. A function (name is an Architect decision; suggested: `computeRawSurprise`)
   accepts a list of concept distance classifications (output of SEREN-001) and
   returns a numeric value in [0.0, 1.0].
2. The formula applied is exactly:
   `raw_surprise = (unknown_count * 1.0 + adjacent_count * 0.5) / total_concept_count`
   where `total_concept_count` is the length of the input classification list.
3. An article where all concepts are "unknown" returns 1.0.
4. An article where all concepts are "known" returns 0.0.
5. An article where all concepts are "adjacent" returns 0.5.
6. An article with zero concepts (empty list) returns 0.0 (no surprise if nothing
   was extracted).
7. The function is pure (no I/O) and unit-testable in isolation.
8. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-003 — Quality Weight Normalization

**Priority**: P0
**Blocks**: SEREN-004
**Depends on**: Phase 1 `qualityGate.ts` quality score output (AGDISC-008, shipped)

**As a** pipeline function that combines surprise with quality to produce serendipity,
**I want** a function that maps the LLM quality score from its native range (as
produced by `lib/discovery/qualityGate.ts`) to the [0.5, 1.0] range required by the
serendipity score formula,
**so that** quality acts as a multiplier that cannot eliminate a high-surprise article
but does meaningfully discount low-quality ones.

#### Acceptance Criteria

1. A function (name is an Architect decision; suggested: `normalizeQualityWeight`)
   accepts a numeric quality score in the range produced by `qualityGate.ts` and
   returns a value in [0.5, 1.0].
   **Architect decision**: confirm the exact output range of the quality score from
   `qualityGate.ts` before implementing the linear mapping; this range is the
   prerequisite input to this function's design.
2. The mapping is a linear transformation: the lowest-passing quality score maps to
   0.5; the highest possible quality score maps to 1.0.
3. A quality score at the exact minimum of the passing range returns 0.5.
4. A quality score at the exact maximum returns 1.0.
5. Scores outside the expected range are clamped (below minimum returns 0.5, above
   maximum returns 1.0) rather than throwing.
6. The function is pure (no I/O) and unit-testable in isolation.
7. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-004 — Serendipity Score Assembly

**Priority**: P0
**Blocks**: SEREN-005 (needed for the score to be applied), Group C (slot assembly)
**Depends on**: SEREN-002, SEREN-003

**As a** pipeline function assembling the final serendipity score for each candidate
article,
**I want** a function that multiplies raw surprise by quality weight to produce a
final serendipity score,
**so that** each candidate article in the pool has a single numeric value that
captures both its novelty (surprise) and its quality, enabling sorted selection for
exploration slots.

#### Acceptance Criteria

1. A function (name is an Architect decision; suggested: `computeSerendipityScore`)
   accepts a raw surprise score (output of SEREN-002) and a quality weight (output
   of SEREN-003) and returns a numeric serendipity score.
2. The formula applied is exactly: `serendipity_score = raw_surprise * quality_weight`.
3. A raw surprise of 1.0 and quality weight of 1.0 produces serendipity score 1.0.
4. A raw surprise of 0.0 and any quality weight produces serendipity score 0.0.
5. A raw surprise of 1.0 and quality weight of 0.5 (minimum) produces serendipity
   score 0.5.
6. The function is pure (no I/O) and unit-testable in isolation.
7. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-005 — Concept Extraction for All Candidate Articles

**Priority**: P0
**Blocks**: SEREN-001 (provides the concept labels that classification acts on),
SEREN-006 (blind spot identification)
**Depends on**: Phase 1 LLM evaluator (`lib/discovery/aestheticScorer.ts` pattern,
AGDISC-008 shipped); Phase 3 concept extraction (DEPTH-006, shipped)

**As a** pipeline that needs serendipity scores for every candidate article,
**I want** concept extraction to run on all candidate articles at pipeline time (not
just liked articles as in Phase 3), pulling from body text when available and falling
back to title and description combined,
**so that** the raw surprise computation has concept labels for every article, not
just those that received a like.

#### Acceptance Criteria

1. At pipeline time (before feed assembly), for every candidate article that has
   passed the quality gate, a concept extraction call is made that returns 3–5 concept
   labels for that article.
2. Extraction uses body text when `article.bodyText` is present and non-empty;
   falls back to `article.title + ' ' + article.description` when body text is
   absent or empty.
3. Extraction reuses the existing LLM extraction mechanism already used in Phase 3's
   `POST /api/feedback` flow. No second LLM client or prompt structure is introduced.
   **Architect decision**: exact call site for this extraction pass (new pre-pass
   in the pipeline orchestrator, or a method on an existing module).
4. Extraction failures for individual articles are isolated: a failure on one article
   logs an error and assigns that article an empty concept list (resulting in raw
   surprise 0.0), without aborting the pipeline run. This is consistent with Phase 1
   and Phase 2 failure isolation patterns.
5. Extracted concepts for candidate articles are held in memory during feed assembly
   and not persisted to the database. Only concepts from liked articles are added to
   the concept graph (existing Phase 3 behavior, unchanged).
6. `npx tsc --noEmit` passes with no new errors.

---

### Group B — Active Learning via Blind Spot Probing

---

#### SEREN-006 — Blind Spot Cluster Identification

**Priority**: P1
**Blocks**: SEREN-007
**Depends on**: SEREN-001 (concept distance classification), SEREN-005 (concept
labels for all candidates)

**As a** pipeline that wants to identify conceptual territory the user has never
explored,
**I want** a function that groups the "unknown" concept labels (from this run's
candidate articles) into thematic clusters and identifies which clusters meet the
threshold for active blind spot candidate status,
**so that** the probe article selection has a structured set of real, backed blind
spot targets rather than arbitrary gaps.

#### Acceptance Criteria

1. At pipeline time, after concept extraction (SEREN-005) and classification
   (SEREN-001) have run for all candidates, the set of "unknown" concept labels
   across all candidate articles is assembled into one list.
2. A single LLM batch call groups this list of unknown concept labels into broad
   thematic clusters. The LLM is asked to assign each label to a named thematic
   area; labels that do not fit any clear theme may be grouped into a catch-all
   cluster.
   **Architect decision**: prompt design and structured output schema for this
   clustering call; whether the output is validated before use; how the cluster name
   is assigned (LLM-provided string vs. hash of member labels).
3. A cluster is designated an "active blind spot candidate" for this pipeline run
   if it contains concept labels from at least 3 distinct candidate articles.
4. The resulting list of active blind spot candidate clusters (with their member
   concept labels and backing article identifiers) is held in memory for use by
   SEREN-007. It is not persisted.
5. If fewer than 3 unknown concept labels exist across all candidates (very early
   operation, when the concept graph is sparse), the blind spot identification step
   produces an empty list without error, and the blind spot probe slot for that
   day's run is filled by a semantic stretch article instead (consistent with the
   floor slot allocation).
6. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-007 — Blind Spot Probe Article Selection

**Priority**: P1
**Blocks**: SEREN-008
**Depends on**: SEREN-006, SEREN-004 (serendipity score for each candidate),
`blind_spot_state` DB table (Architect decision)

**As a** pipeline function selecting which article fills the blind spot probe slot,
**I want** a function that picks the highest-serendipity-scoring article from the
most underrepresented active blind spot cluster (excluding clusters that are currently
suppressed),
**so that** each day's probe article is backed by real candidate content, targets the
most novel territory first, and respects prior dislike signals without permanently
retiring any blind spot area.

#### Acceptance Criteria

1. Given the list of active blind spot candidate clusters (from SEREN-006), any
   clusters currently in the 30-day suppression state (recorded in `blind_spot_state`)
   are excluded from probe selection for this run.
2. From the remaining eligible clusters, the "most underrepresented" cluster is
   selected. "Most underrepresented" means the cluster whose member concept labels
   are most distant from any known node in the concept graph — i.e., the cluster
   with the highest average raw surprise score across its backing candidate articles.
3. From the selected cluster, the backing candidate article with the highest
   serendipity score is selected as the probe article for this run.
4. The probe article is marked with an internal `probe_type: 'blind_spot'` flag in
   the batch JSON. This flag is never sent to the client; it is stripped at API time
   alongside `discoveryTopic`.
   **Architect decision**: exact field name and location on the `Article` type or
   batch record; whether this requires a new optional field on `Article` or an
   extension to internal batch metadata.
5. If no eligible clusters remain after suppression filtering, the blind spot probe
   slot falls back to a semantic stretch article (same behavior as when the budget
   is at floor level), and no probe flag is set.
6. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-008 — Probe Article Tracking in Batch Metadata

**Priority**: P1
**Blocks**: SEREN-009, SEREN-019 (probe acceptance rate signal)
**Depends on**: SEREN-007

**As a** feedback processing system that needs to know which articles were blind spot
probes when feedback arrives,
**I want** probe articles to be identifiable from their stored batch record so that
feedback on them can trigger the correct probe response logic,
**so that** the like/dislike/ignore interpretation pipeline knows to treat feedback
on these articles as probe responses, not ordinary preference signals.

#### Acceptance Criteria

1. A probe article's batch JSON entry includes a field (name is an Architect
   decision, consistent with SEREN-007 AC4) that records `probe_type: 'blind_spot'`
   and the cluster identifier from which it was selected.
2. This field is stripped from all API responses that deliver article data to the
   client. The `GET /api/feed/today` and `GET /api/articles/[id]` responses must
   not include this field (same mechanism as `discoveryTopic` stripping in BUG-002).
3. The batch JSON is the authoritative record of probe status. When feedback arrives
   on an article, the feedback handler looks up the article's batch entry to
   determine whether it was a probe and which cluster it belonged to.
4. A non-probe article has no `probe_type` field (field is absent, not null).
5. Verification: after a pipeline run that includes a probe article, the batch JSON
   file on disk contains the probe field; the `GET /api/feed/today` response for
   the same article does not contain the probe field.
6. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-009 — Probe Response Interpretation on Feedback

**Priority**: P1
**Blocks**: SEREN-010, SEREN-011, SEREN-012
**Depends on**: SEREN-008; Phase 3 concept extraction pipeline in `POST /api/feedback`
(DEPTH-006, DEPTH-007, shipped)

**As a** feedback handler receiving a like or dislike on an article,
**I want** the handler to detect when the article being rated was a blind spot probe
and route the feedback through probe-specific response logic,
**so that** probe responses drive cluster promotion or suppression rather than being
treated solely as ordinary source-score or concept-weight updates.

#### Acceptance Criteria

1. On receiving feedback for an article, the handler checks the article's batch
   record for the probe flag (SEREN-008 AC1). If no probe flag is present, the
   handler proceeds with the existing Phase 3 feedback logic unchanged.
2. If a probe flag is present and the feedback is a **like**:
   a. The article's extracted concepts are added to the concept graph via the
      standard Phase 3 concept extraction and upsert pipeline (reusing
      `conceptExtractor.ts` and `lib/db/concepts.ts`).
      **Architect decision**: whether probe-sourced concept extraction uses the same
      engagement weight as ordinary likes, or a different weight (flag for design doc).
   b. The blind spot cluster that produced this probe is promoted (SEREN-010 logic
      is invoked for this cluster).
   c. The existing source-score update for the article's source runs normally.
3. If a probe flag is present and the feedback is a **dislike**:
   a. The article's concepts are not added to the concept graph.
   b. The blind spot cluster that produced this probe is suppressed (SEREN-011 logic
      is invoked for this cluster).
   c. The existing source-score update for the article's source runs normally.
4. If a probe flag is present and the article receives no feedback (ignore), no
   immediate cluster state change occurs at this step. Ignore tracking is handled
   by SEREN-012 at pipeline time.
5. All probe response logic is isolated: a failure in cluster state update (SEREN-010
   or SEREN-011) is logged and suppressed; it does not prevent the underlying
   feedback record from being written.
6. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-010 — Blind Spot Cluster Promotion

**Priority**: P1
**Blocks**: SEREN-012
**Depends on**: SEREN-009, `blind_spot_state` DB table (Architect decision)

**As a** system that wants to follow up on newly discovered interests,
**I want** a liked probe to trigger a 14-day promotion window for the probe's
originating blind spot cluster,
**so that** future pipeline runs prioritize serving more content from that cluster
during the window, compounding the discovery effect while the user's interest is fresh.

#### Acceptance Criteria

1. A function (name is an Architect decision) accepts a cluster identifier and a
   user identity and writes or updates the cluster's promotion state in
   `blind_spot_state`: sets `is_promoted = true`, `promoted_at = now()`,
   `promoted_until = now() + 14 days`.
2. During the 14-day promotion window, when SEREN-007 selects a probe cluster, a
   promoted cluster's priority is elevated above unpromoted clusters of equivalent
   underrepresentation. Promoted clusters are considered before unpromoted clusters
   when building the probe candidate set.
3. After 14 days, the promotion window expires. The cluster returns to normal
   priority. Expiry is evaluated at pipeline time (not via a background job):
   SEREN-007 ignores the promotion flag when `promoted_until` is in the past.
4. Promotion and suppression states can coexist for different clusters. Promotion
   of one cluster does not affect the suppression state of any other cluster.
5. If the cluster is currently in a suppression period when a like arrives, the
   behavior is an Architect decision: whether the like resets the suppression timer
   early and schedules a promotion, or whether promotion is queued to take effect
   after suppression ends (flag for design doc).
6. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-011 — Blind Spot Cluster Suppression

**Priority**: P1
**Blocks**: SEREN-012
**Depends on**: SEREN-009, `blind_spot_state` DB table (Architect decision)

**As a** system that respects the user's rejection of specific conceptual territory,
**I want** a disliked probe to suppress the probe's originating blind spot cluster
for 30 days,
**so that** the system probes elsewhere rather than repeatedly surfacing content the
user has explicitly rejected, while preserving the ability to re-evaluate after
the cooling period.

#### Acceptance Criteria

1. A function (name is an Architect decision) accepts a cluster identifier and a
   user identity and writes or updates the cluster's suppression state in
   `blind_spot_state`: sets `is_suppressed = true`, `suppressed_at = now()`,
   `suppressed_until = now() + 30 days`.
2. During the 30-day suppression window, the cluster is excluded from probe
   selection (SEREN-007 AC1 filters it out).
3. After 30 days, suppression expires. The cluster becomes eligible for probe
   selection again, but at reduced priority relative to clusters that have never
   been suppressed.
   **Architect decision**: how reduced priority is represented — a numeric field on
   `blind_spot_state`, or the presence of a historical suppression record that
   SEREN-007 uses to deprioritize.
4. Suppressing a cluster does not permanently retire it. After the 30-day period,
   the cluster re-enters the candidate pool.
5. A second dislike on a probe from the same cluster (in a later probe cycle, after
   suppression expires) resets the suppression timer: `suppressed_until` is updated
   to `now() + 30 days` from the new dislike event.
6. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-012 — Probe Ignore Handling

**Priority**: P1
**Blocks**: none
**Depends on**: SEREN-010, SEREN-011

**As a** system that needs to distinguish active rejection from passive disengagement,
**I want** a mechanism that tracks when a probe article receives no feedback
(ignore), counts consecutive ignores per cluster, and reduces that cluster's probe
priority after two consecutive ignores — without triggering the 30-day suppression
used for dislikes,
**so that** a user who scrolls past a probe without engaging does not suffer the
same re-suppression as a user who explicitly dislikes it.

#### Acceptance Criteria

1. An article that was a probe and received no feedback signal is treated as ignored
   when it ages out of the active feed window — i.e., the next pipeline run begins
   and the article did not receive a like or dislike.
   **Architect decision**: how "aged out of active feed" is determined — whether the
   next pipeline run explicitly declares prior-day probes without feedback as ignored,
   or whether a time-based check is used.
2. The ignore event is recorded in `blind_spot_state` for the affected cluster:
   `ignore_count` is incremented for this cluster and user identity.
3. After 2 consecutive ignores from the same cluster (no intervening like or dislike
   on a probe from that cluster between the two ignores), the cluster's priority is
   reduced and it becomes eligible for probe selection again after 14 days at lower
   priority.
4. The 14-day reduced-priority timeout from double-ignore is distinct from the 30-day
   suppression: the cluster is not fully suppressed, but it is deprioritized relative
   to clusters without recent ignores.
5. An intervening like or dislike on a probe from the same cluster resets the
   consecutive ignore count for that cluster to zero.
6. Ignore tracking never triggers the same outcome as a dislike. Even after multiple
   consecutive ignores, the cluster returns to the pool; it is never permanently
   retired.
7. `npx tsc --noEmit` passes with no new errors.

---

### Group C — Structured Exploration Budget and Slot Assembly

---

#### SEREN-013 — Exploration Budget Constants and Slot Type Allocation Table

**Priority**: P0
**Blocks**: SEREN-014, SEREN-022
**Depends on**: none (constants-only story; no runtime dependencies)

**As a** developer configuring the exploration budget for Phase 4,
**I want** all exploration budget parameters stored as named constants in a
single, well-known configuration location,
**so that** the baseline, floor, ceiling, and slot type allocations can be adjusted
without hunting for magic numbers across multiple modules.

#### Acceptance Criteria

1. The following named constants are defined (location is an Architect decision,
   see Architect-Level Decision 7):
   - `EXPLORATION_BASELINE = 4` — default exploration slot count per day
   - `EXPLORATION_FLOOR = 2` — minimum exploration slots regardless of receptivity
   - `EXPLORATION_CEILING = 6` — maximum exploration slots regardless of receptivity
   - `WILDCARD_SLOT_COUNT = 1` — wildcard count is always exactly 1
2. A slot type allocation table (or function mapping budget level to slot counts)
   is defined that produces the following at each budget level:

   | Budget | Semantic Stretch | Blind Spot Probe | Wildcard |
   |--------|-----------------|------------------|---------|
   | 2      | 1               | 0                | 1       |
   | 3      | 2               | 0                | 1       |
   | 4      | 2               | 1                | 1       |
   | 5      | 3               | 1                | 1       |
   | 6      | 3               | 2                | 1       |

3. The wildcard count is capped at 1 regardless of budget level. The allocation
   for any budget between floor and ceiling is derivable from the constants without
   a hardcoded per-level lookup, if possible.
   **Architect decision**: whether the allocation is expressed as a lookup table,
   a formula, or a combination; and whether these constants live alongside the
   existing `ARTICLES_PER_DAY` in `lib/config/feed.ts` or in a dedicated
   `lib/config/serendipity.ts`.
4. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-014 — Slot Type Candidate Pool Construction

**Priority**: P0
**Blocks**: SEREN-015
**Depends on**: SEREN-004 (serendipity scores), SEREN-005 (concept classifications),
SEREN-007 (probe article selection), SEREN-013 (constants)

**As a** feed assembly function needing a ranked candidate pool for each exploration
slot type,
**I want** three separate ranked pools to be constructed from the full candidate
article set: one for semantic stretch slots, one for blind spot probe slots, and one
for wildcard slots,
**so that** each slot type can draw from the most appropriate candidates without
cross-contamination between slot types during selection.

#### Acceptance Criteria

1. The **semantic stretch pool** contains candidate articles where at least one
   extracted concept is classified as "adjacent" (one hop from the concept graph),
   ranked by serendipity score descending.
2. The **blind spot probe pool** contains the single article selected by SEREN-007
   (if available). It is a pool of exactly 0 or 1 article.
3. The **wildcard pool** contains all candidate articles that passed the quality
   gate, ranked by their raw LLM quality score descending (not by serendipity score).
   The wildcard slot is explicitly not filtered by concept graph proximity.
4. An article may appear in more than one pool before slot assembly (e.g., a high-
   quality adjacent article may be in both semantic stretch and wildcard pools).
   Deduplication that prevents double-selection happens in SEREN-016, not here.
5. Pool construction does not modify the candidate article objects; it produces
   sorted reference lists.
6. If the semantic stretch pool is empty (the concept graph is very sparse and no
   article has adjacent concepts), the semantic stretch pool falls back to the
   articles with the highest raw surprise scores (i.e., unknown-concept articles,
   ranked by serendipity score).
7. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-015 — Exploration Slot Assembly

**Priority**: P0
**Blocks**: SEREN-016
**Depends on**: SEREN-014, SEREN-013

**As a** feed assembly function filling the exploration portion of the daily feed,
**I want** a function that selects articles from the type pools to fill the current
day's exploration budget,
**so that** the correct number of semantic stretch, blind spot probe, and wildcard
articles are selected according to the slot type allocation table for the given
budget level.

#### Acceptance Criteria

1. A function accepts the current exploration budget (an integer in [2, 6], from
   SEREN-022 when available or `EXPLORATION_BASELINE` before receptivity is
   implemented), the three slot type pools from SEREN-014, and returns a list of
   selected exploration articles.
2. The slot type allocation table from SEREN-013 determines how many articles to
   select from each pool for the given budget level.
3. Slots are filled greedily from the top of each pool: the highest-ranked article
   from each pool is selected first, then the second-ranked if that slot type has
   more than one slot.
4. If a pool has fewer articles than its allocated slot count (e.g., only one
   semantic stretch candidate when three are needed), remaining slots of that type
   are filled with articles from the highest available serendipity-scored candidates
   across all exploration pools, without regard to slot type. This prevents
   exploration budget waste.
5. The function never selects more than `EXPLORATION_CEILING` articles total.
6. The function never selects fewer than `EXPLORATION_FLOOR` articles total (it
   fills any gap from the highest-serendipity candidates available if type-specific
   pools are exhausted).
7. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-016 — Exploration vs. Exploitation Deduplication

**Priority**: P0
**Blocks**: SEREN-017
**Depends on**: SEREN-015

**As a** feed assembly function combining exploration and exploitation articles,
**I want** a deduplication step that ensures no article appears in both the
exploration selection and the exploitation selection,
**so that** the feed contains exactly 20 distinct articles, with the correct
number from each pool.

#### Acceptance Criteria

1. Exploitation slot candidates are the full ranked candidate pool produced by the
   existing Phase 3 `rankFeed()` formula (`0.7 * source_score + 0.3 *
   aesthetic_proximity + concept_bonus`), unchanged.
2. Any article already selected for an exploration slot is excluded from the
   exploitation selection pool before the top-N exploitation articles are chosen.
3. The final feed contains exactly `ARTICLES_PER_DAY` (20) articles:
   `exploration_count + exploitation_count = 20`, where `exploration_count` is the
   current budget and `exploitation_count = 20 - exploration_count`.
4. If deduplication causes the exploitation pool to have fewer than
   `exploitation_count` candidates (extremely unlikely in normal operation), the
   shortfall is filled by the highest-serendipity exploration candidates not already
   selected, rather than serving fewer than 20 articles.
5. The identity of each article's slot assignment (exploration vs. exploitation, and
   which exploration type) is recorded on the article in memory during feed assembly,
   for use by the receptivity dwell ratio signal (SEREN-020).
   **Architect decision**: how this slot assignment is represented (see Architect-
   Level Decision 4).
6. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-017 — Feed Assembly Integration in `rankFeed()`

**Priority**: P0
**Blocks**: none (capstone for Group C)
**Depends on**: SEREN-016, SEREN-013

**As a** daily pipeline that produces the final ranked feed,
**I want** `rankFeed()` (or its calling context) to execute the full Phase 4 slot
assembly flow — serendipity scoring, pool construction, exploration slot selection,
deduplication, exploitation slot selection — and return a combined 20-article feed,
**so that** the feed always contains the correct mix of exploitation and exploration
articles with no changes to the Phase 3 ranking formula itself.

#### Acceptance Criteria

1. The Phase 3 ranking formula (`0.7 * source_score + 0.3 * aesthetic_proximity +
   concept_bonus`) is applied without modification to the exploitation slot pool.
   No changes are made to how source scores, aesthetic proximity, or concept bonus
   are computed.
2. The Phase 4 serendipity flow (concept extraction for all candidates, distance
   classification, raw surprise, quality weight normalization, serendipity score,
   pool construction, slot assembly, deduplication) runs as a pre-pass or parallel
   pass alongside the existing ranking logic.
   **Architect decision**: exact integration point and call structure (see Architect-
   Level Decision 2).
3. The returned feed is a list of exactly 20 articles, with exploration articles
   interspersed among exploitation articles (not grouped at the end).
   **Architect decision**: whether interleaving follows a fixed pattern (e.g., one
   exploration article per every N slots) or a random distribution.
4. New users with no concept graph (zero nodes in `user_concepts`) degrade
   gracefully: serendipity scoring treats all concepts as "unknown" (raw surprise
   1.0 for all articles), and the exploration slots are filled primarily by the
   wildcard pool (quality-first selection). Consistent with Phase 3 graceful
   degradation patterns.
5. The pipeline does not make more LLM calls per day than the count of candidate
   articles (for SEREN-005 extraction) plus one (for SEREN-006 blind spot
   clustering). No additional per-article LLM calls are introduced.
6. `npx tsc --noEmit` passes with no new errors.

---

### Group D — Psychographic Modulation via Receptivity Signal

---

#### SEREN-018 — Topic Diversity Score Computation

**Priority**: P1
**Blocks**: SEREN-021
**Depends on**: Phase 3 concept graph DB helpers (`lib/db/concepts.ts`, DEPTH-010,
shipped); feedback history in the database (SFB-002, shipped)

**As a** receptivity computation that needs to measure how broadly the user has been
engaging across topics,
**I want** a function that computes a diversity score from the user's liked articles
in the trailing 7-day window,
**so that** a user engaging across many topic clusters contributes a high diversity
component to the receptivity score, while a user focused in one area contributes a
low component.

#### Acceptance Criteria

1. A function (name is an Architect decision) accepts a user identity and queries
   the feedback history for all like events in the trailing 7 calendar days.
2. For each liked article in the window, the function identifies which concept graph
   cluster(s) its concept labels belong to, using the concept data already stored
   by Phase 3.
   **Architect decision**: how concept graph clusters are identified, given that
   Phase 3 does not explicitly store cluster assignments. Options include using the
   `user_concept_edges` connected component structure, the thematic area label from
   SEREN-006's clustering output (if available), or a simpler proxy such as treating
   each unique concept label as its own distinct unit.
3. The diversity score formula is:
   `diversity_score = distinct_clusters / liked_count`, bounded to [0.0, 1.0].
4. If fewer than 3 liked articles exist in the 7-day window, the function returns
   0.5 (neutral default) rather than inferring from sparse data.
5. The function returns a value in [0.0, 1.0].
6. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-019 — Probe Acceptance Rate Computation

**Priority**: P1
**Blocks**: SEREN-021
**Depends on**: SEREN-008 (probe tracking in batch metadata), feedback history DB

**As a** receptivity computation that needs to measure the user's demonstrated
openness to surprise,
**I want** a function that computes the probe acceptance rate from probe articles
shown in the trailing 14-day window,
**so that** a user who consistently likes probe articles contributes a high
acceptance component to the receptivity score.

#### Acceptance Criteria

1. A function (name is an Architect decision) accepts a user identity and queries
   the feedback history and probe tracking data for all probe articles shown to
   this user in the trailing 14 calendar days.
2. The probe acceptance rate formula is:
   `probe_acceptance_rate = probe_likes / probes_shown`, bounded to [0.0, 1.0],
   where `probe_likes` is the count of probe articles that received a like and
   `probes_shown` is the total count of probe articles in the window (liked +
   disliked + ignored).
3. If fewer than 3 probe articles have been shown in the 14-day window, the function
   returns 0.5 (neutral default).
4. The function returns a value in [0.0, 1.0].
5. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-020 — Exploration Dwell Ratio Computation

**Priority**: P1
**Blocks**: SEREN-021
**Depends on**: Phase 3 dwell time tracking (DEPTH-014, DEPTH-015, shipped);
SEREN-016 (slot classification on articles)

**As a** receptivity computation that needs to measure relative engagement with
exploration vs. familiar content,
**I want** a function that computes the ratio of average dwell time on exploration
slot articles to average dwell time on exploitation slot articles,
**so that** a user who spends comparable time on unfamiliar content as on familiar
content contributes a higher dwell component to the receptivity score.

#### Acceptance Criteria

1. A function (name is an Architect decision) accepts a user identity and queries
   the dwell time data stored by Phase 3 (DEPTH-015), filtered to articles from
   recent feed batches that have slot classification data (exploration vs. exploitation,
   from SEREN-016).
2. The dwell ratio formula is:
   `dwell_ratio = avg_dwell_exploration / avg_dwell_exploitation`, capped at 1.5.
3. If either pool (exploration or exploitation) has fewer than 3 dwell data points,
   the function returns 0.75 (slightly below neutral default, reflecting that
   exploration content typically earns less dwell time than familiar content).
4. The function returns a value in [0.0, 1.5]. The SEREN-021 formula normalizes this
   to [0.0, 1.0] via `min(dwell_ratio, 1.5) / 1.5` before weighting.
5. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-021 — Receptivity Score Assembly

**Priority**: P1
**Blocks**: SEREN-022
**Depends on**: SEREN-018, SEREN-019, SEREN-020

**As a** feed assembly function that needs a single signal to modulate the
exploration budget,
**I want** a function that combines the three component signals (diversity score,
probe acceptance rate, dwell ratio) into a single receptivity score using the
specified weights,
**so that** the exploration budget adapts to the user's current engagement mode
with a single, interpretable composite signal.

#### Acceptance Criteria

1. A function (name is an Architect decision; suggested: `computeReceptivity`)
   accepts the three component values and returns a receptivity score in [0.0, 1.0].
2. The formula applied is exactly:
   ```
   receptivity = (0.40 * diversity_score)
               + (0.35 * probe_acceptance_rate)
               + (0.25 * min(dwell_ratio, 1.5) / 1.5)
   ```
3. The weights (0.40, 0.35, 0.25) are named constants (location is an Architect
   decision, consistent with the SEREN-013 constants location).
4. The result is clamped to [0.0, 1.0] after computation.
5. The function is pure (no I/O) and unit-testable in isolation.
6. `npx tsc --noEmit` passes with no new errors.

---

#### SEREN-022 — Budget Modulation from Receptivity Score

**Priority**: P1
**Blocks**: none (capstone for Group D)
**Depends on**: SEREN-021, SEREN-013

**As a** feed assembly function that wants exploration to adapt to the user's
current cognitive state,
**I want** a function that maps the receptivity score to an exploration budget
(integer slot count) using the defined threshold table,
**so that** the exploration slot count increases when the user is demonstrably open
to discovery and decreases when engagement signals suggest focused, familiar-content-
seeking mode — without ever eliminating exploration entirely.

#### Acceptance Criteria

1. A function (name is an Architect decision; suggested: `receptivityToBudget`)
   accepts a receptivity score in [0.0, 1.0] and returns an integer budget in
   [EXPLORATION_FLOOR, EXPLORATION_CEILING].
2. The mapping applies the following threshold table exactly:

   | Receptivity Range | Budget |
   |-------------------|--------|
   | 0.00 – 0.30       | 2      |
   | 0.31 – 0.55       | 3      |
   | 0.56 – 0.70       | 4      |
   | 0.71 – 0.85       | 5      |
   | 0.86 – 1.00       | 6      |

3. The threshold boundary values are named constants (location is an Architect
   decision, consistent with SEREN-013).
4. The returned budget is never below `EXPLORATION_FLOOR` (2) and never above
   `EXPLORATION_CEILING` (6), regardless of the receptivity score input.
5. When the receptivity computation is unavailable (e.g., Group B has not shipped
   and probe tracking data does not yet exist), the function returns
   `EXPLORATION_BASELINE` (4) as the default budget. This ensures the P0 Group C
   stories can ship and operate correctly before Group D is implemented.
6. The function is pure (no I/O) and unit-testable in isolation.
7. `npx tsc --noEmit` passes with no new errors.

---

## Future Stories

These items are explicitly deferred from Phase 4 scope. They may be considered in
a future phase if the concept graph has grown substantially, multi-user
infrastructure is in place, or the user requests explicit discovery controls.

| ID | Title | Reason Deferred |
|----|-------|-----------------|
| FUTURE-SEREN-001 | User-visible exploration mode indicator | Non-goal in BRD-010; no new UI in Phase 4 |
| FUTURE-SEREN-002 | "Why this is here" explanation for exploration articles | Non-goal in BRD-010; explanation surface deferred to future phase |
| FUTURE-SEREN-003 | Vector embedding-based semantic distance (replacing hop-distance) | BRD decision: label-based hop-distance sufficient for single-user scale; transition to embeddings if graph grows substantially or multi-user is added |
| FUTURE-SEREN-004 | User-configurable exploration budget override | Non-goal in BRD-010; all exploration controls are system-internal |
| FUTURE-SEREN-005 | Real-time or sub-daily receptivity updates | Non-goal in BRD-010; all Phase 4 computation runs at pipeline time |
| FUTURE-SEREN-006 | Cross-device blind spot state merge on login | Depends on multi-user infrastructure; single-user scope for now |
| FUTURE-SEREN-007 | Scroll depth as a third engagement proxy for receptivity | BRD-010 out of scope; noted as a future consideration |
| FUTURE-SEREN-008 | Retroactive serendipity scoring of pre-Phase-4 batches | Not needed for Phase 4 operation; scoring runs forward from Phase 4 launch |

---

## Story Summary Table

| ID | Title | Group | Priority |
|----|-------|-------|----------|
| SEREN-001 | Concept Distance Classification Utilities | A — Surprise Scoring | P0 |
| SEREN-002 | Raw Surprise Score Computation | A — Surprise Scoring | P0 |
| SEREN-003 | Quality Weight Normalization | A — Surprise Scoring | P0 |
| SEREN-004 | Serendipity Score Assembly | A — Surprise Scoring | P0 |
| SEREN-005 | Concept Extraction for All Candidate Articles | A — Surprise Scoring | P0 |
| SEREN-006 | Blind Spot Cluster Identification | B — Blind Spot Probing | P1 |
| SEREN-007 | Blind Spot Probe Article Selection | B — Blind Spot Probing | P1 |
| SEREN-008 | Probe Article Tracking in Batch Metadata | B — Blind Spot Probing | P1 |
| SEREN-009 | Probe Response Interpretation on Feedback | B — Blind Spot Probing | P1 |
| SEREN-010 | Blind Spot Cluster Promotion | B — Blind Spot Probing | P1 |
| SEREN-011 | Blind Spot Cluster Suppression | B — Blind Spot Probing | P1 |
| SEREN-012 | Probe Ignore Handling | B — Blind Spot Probing | P1 |
| SEREN-013 | Exploration Budget Constants and Slot Type Allocation Table | C — Exploration Budget | P0 |
| SEREN-014 | Slot Type Candidate Pool Construction | C — Exploration Budget | P0 |
| SEREN-015 | Exploration Slot Assembly | C — Exploration Budget | P0 |
| SEREN-016 | Exploration vs. Exploitation Deduplication | C — Exploration Budget | P0 |
| SEREN-017 | Feed Assembly Integration in `rankFeed()` | C — Exploration Budget | P0 |
| SEREN-018 | Topic Diversity Score Computation | D — Receptivity Signal | P1 |
| SEREN-019 | Probe Acceptance Rate Computation | D — Receptivity Signal | P1 |
| SEREN-020 | Exploration Dwell Ratio Computation | D — Receptivity Signal | P1 |
| SEREN-021 | Receptivity Score Assembly | D — Receptivity Signal | P1 |
| SEREN-022 | Budget Modulation from Receptivity Score | D — Receptivity Signal | P1 |
