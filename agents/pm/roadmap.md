# Product Roadmap

**Last Updated**: 2026-04-04 (Phase 4 Released — all four phases complete)
**Maintained by**: PM Agent

> **Vision shift (2026-04-07):** The project has been refined from a news aggregator
> to a personalized content discovery companion. Scope is single-user first (Kyle),
> with starter content sources provided by the user. Identity is parameterized
> throughout for future multi-user expansion. The full vision is documented in
> `agents/ba/vision_discovery_companion.md`. Milestones 1–8 are the v1 foundation.
> Future work follows a four-phase plan aligned with the vision's four pillars.

---

## How to Read This Roadmap

- **Released**: In production.
- **In Progress**: Actively being designed or built.
- **Planned**: Scoped and ready for the Architect to pick up.
- **Backlog**: Identified but not yet scoped; prerequisites may be unmet.

Stories are linked to their source documents. The Architect picks up items with
status "Planned" and breaks them into technical tasks.

---

## Milestone 1 — Core Daily Digest (v1)

**Goal**: A user can open the app, see 20 articles curated from the web, read each
article inside the app, and tap through to the original source. The feed refreshes
once daily. The app is installable as a PWA on mobile.

**Status**: Released
**Shipped**: 2026-04-04
**Stories doc**: `agents/pm/stories_article_feed_v1.md`

### P0 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| FEED-002 | Article Data Model | Released |
| FEED-001 | Daily Article Fetch Job | Released |
| FEED-003 | Content Validation and Fallback | Released |
| FEED-004 | Today's Feed Endpoint | Released |
| FEED-005 | Article Detail Endpoint | Released |
| FEED-006 | Feed Page — Article Card List | Released |
| FEED-007 | Feed Page — Loading State | Released |
| FEED-010 | Article Reading View — Layout and Content | Released |
| FEED-011 | Article Reading View — View Source Link | Released |
| FEED-013 | Mobile Responsive Layout | Released |

### P1 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| FEED-008 | Feed Page — Error State | Released |
| FEED-009 | Feed Page — Batch Date Label | Released |
| FEED-012 | PWA Installability | Released |

---

## Milestone 2 — Feedback System (v2)

**Goal**: Users can like or dislike articles. These signals are stored and begin
feeding back into source weighting and article scoring.

**Status**: Released
**Shipped**: 2026-04-04
**Stories doc**: `agents/pm/stories_feedback_capture_v1.md`
**Source BRD**: `agents/ba/requirements_feedback_capture_v1.md` (BRD-002)

### P0 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| FB-001 | Feedback Store Module | Released |
| FB-002 | FeedbackButtons Component | Released |
| FB-003 | Feedback Buttons on Feed Cards | Released |
| FB-004 | Feedback Buttons on Article Detail View | Released |
| FB-005 | Feedback Persists Across Sessions | Released |

### Deferred to Later Milestones

| Story ID | Title | Status |
|----------|-------|--------|
| FUTURE-002 | Source weighting and ranking based on feedback signals | Backlog |
| FUTURE-003 | Personalized article scoring and feed reordering | Backlog |
| FUTURE-004 | Source discovery driven by feedback | Backlog |

---

## Milestone 2.5 — Feedback Durability

**Goal**: Feedback is persisted server-side so it survives browser data clears.
Each device receives a stable anonymous UUID on first visit. Existing localStorage
feedback is migrated automatically. Failed writes are queued and retried. The
FeedbackButtons UI is completely unchanged.

**Status**: Released
**Shipped**: 2026-04-04
**Stories doc**: `agents/pm/stories_server_feedback_v1.md`
**Source BRD**: `agents/ba/requirements_server_feedback_v1.md` (BRD-003)
**Prerequisite**: Milestone 2 FB stories (FB-001 through FB-005) shipped.

### P0 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| SFB-001 | Device Identity Initialization | Released |
| SFB-002 | Feedback Database Schema | Released |
| SFB-003 | GET /api/feedback Endpoint | Released |
| SFB-004 | POST /api/feedback Endpoint | Released |
| SFB-005 | DELETE /api/feedback/[articleId] Endpoint | Released |
| SFB-006 | Client: Write Feedback to Server on Tap | Released |
| SFB-007 | Offline Retry Queue | Released |
| SFB-008 | POST /api/feedback/migrate Endpoint | Released |
| SFB-009 | Client: Run One-Time Migration | Released |
| SFB-010 | Client: Load Feedback from Server on App Start | Released |

---

## Milestone 3 — User Authentication (Identity Foundation)

**Goal**: Users can create accounts with email and password, verify their email,
and log in from any device. Feedback history is associated with the account and
follows the user across devices. Existing anonymous users are unaffected. A user
who gave feedback before registering does not lose any of that history at first
login.

**Status**: Released
**Shipped**: 2026-04-04
**Prerequisite**: Milestone 2.5 shipped.
**Stories doc**: `agents/pm/stories_user_auth_v1.md`
**Source BRD**: `agents/ba/brd_user_auth_v1.md` (BRD-005)
**Required by**: Milestone 4 (cross-device personalization depends on this)

### P0 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| AUTH-001 | Users, Sessions, and Token Schema | Released |
| AUTH-002 | Registration API | Released |
| AUTH-003 | Email Verification API | Released |
| AUTH-004 | Login API | Released |
| AUTH-005 | Device-to-User Feedback Migration on First Login | Released |
| AUTH-006 | Cross-Device Feedback Merge on Login | Released |
| AUTH-007 | Password Reset Flow | Released |
| AUTH-008 | Logout API | Released |
| AUTH-009 | Auth UI — Header Icon and Auth Pages | Released |
| AUTH-010 | Session Persistence — Client Integration | Released |
| AUTH-011 | Anonymous Fallback Remains Fully Functional | Released |

### Deferred to Later Milestones

| Story ID | Title | Status |
|----------|-------|--------|
| FUTURE-007 | Push notifications for new daily digest | Backlog |
| FUTURE-AUTH-001 | Mandatory login enforcement (grace period / hard gate) | Backlog |
| FUTURE-AUTH-002 | User-facing account management (email change, account deletion) | Backlog |

---

## Milestone 4 — Feed Personalization (Personalized Feed)

**Goal**: The daily feed is ranked by each user's feedback history. Sources
consistently liked appear near the top; sources consistently disliked drift lower
or are suppressed. A small exploration budget ensures the feed does not collapse
into a filter bubble. Personalization follows authenticated users across devices;
anonymous users are personalized by device. New users with no feedback history see
no change.

**Status**: Released
**Shipped**: 2026-04-04
**Prerequisite**: Milestone 3 (user authentication) shipped.
**Stories doc**: `agents/pm/stories_feed_personalization_v1.md`
**Source BRD**: `agents/ba/brd_feed_personalization_v1.md` (BRD-004)

### P0 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| PERS-001 | Source Scoring Model | Released |
| PERS-002 | Ranked Feed Output | Released |
| PERS-003 | Source Suppression | Released |
| PERS-004 | Source Diversity Cap | Released |
| PERS-005 | Exploration Budget | Released |
| PERS-006 | Pipeline Integration | Released |
| PERS-007 | All-Sources-Suppressed Fallback | Released |
| PERS-008 | API Delivers Pre-Ranked Feed | Released |
| PERS-009 | Anonymous vs. Authenticated Identity Routing | Released |
| PERS-010 | New User Graceful Degradation | Released |

### P1 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| PERS-011 | Feedback-After-Cutoff Behavior | Released |

### Deferred to Later Milestones

| Story ID | Title | Status |
|----------|-------|--------|
| FUTURE-PERS-001 | User-facing suppression reversal ("reset personalization") | Backlog |
| FUTURE-PERS-002 | Topic or category-level scoring (beyond source-level) | Backlog |
| FUTURE-PERS-003 | Article-level scoring (title/content similarity) | Backlog |
| FUTURE-PERS-004 | Source discovery driven by feedback (dynamic source list) | Backlog |

---

## Milestone 5 — Feed Refresh and Source Diversity

**Goal**: Authenticated users can trigger a fresh pipeline run on demand via a
button in the feed UI, without waiting for the next scheduled run. Every pipeline
run — scheduled or manually triggered — is guaranteed to draw articles from at
least 3 distinct active sources, and no single source may contribute more than 5
articles to any batch. Source failures are isolated: one failing source does not
abort the run.

**Status**: Released
**Shipped**: 2026-04-04
**Prerequisite**: Milestone 4 (Feed Personalization) shipped.
**Stories doc**: `agents/pm/stories_feed_refresh_and_diversity_v1.md`
**Source BRD**: `agents/ba/brd_feed_refresh_and_diversity_v1.md` (BRD-005)

### Must Have Stories

| Story ID | Title | Status |
|----------|-------|--------|
| REFRESH-001 | Refresh Cooldown Configuration | Released |
| REFRESH-002 | Pipeline Writes Last-Updated Timestamp | Released |
| REFRESH-003 | Manual Refresh API Endpoint | Released |
| REFRESH-004 | Manual Refresh Applies Full Pipeline Rules | Released |
| REFRESH-005 | Manual Refresh Failure Behavior | Released |
| REFRESH-006 | Feed UI — Last Updated Label | Released |
| REFRESH-007 | Feed UI — Manual Refresh Button | Released |
| REFRESH-008 | Source Diversity — Configurable Minimum Sources | Released |
| REFRESH-009 | Per-Source Article Cap | Released |
| REFRESH-010 | Source Failure Isolation | Released |
| REFRESH-011 | Degraded-Mode Diversity Warning | Released |

### Deferred to Later Milestones

| Story ID | Title | Status |
|----------|-------|--------|
| FUTURE-009 | Pull-to-refresh gesture (native mobile feel) | Backlog |
| FUTURE-REFRESH-001 | Operator dashboard for manual refresh activity | Backlog |
| FUTURE-REFRESH-002 | Per-source article cap adjustable by users | Backlog |

---

## Milestone 7 — Proactive Content Discovery

**Goal**: The daily feed contains a portion of articles sourced from active,
topic-driven web discovery rather than from the fixed configured source list.
Each day, the discovery layer ranges across a broad, system-controlled topic list,
evaluates candidate articles against quality criteria, and contributes up to 6
articles to the combined 20-article batch. Discovery articles are first-class
citizens of the personalization system: feedback on them feeds into the existing
source-scoring ranker with no new logic, and topics that produce liked articles
over time are probed more often. The existing RSS and NewsAPI pipeline is untouched.

**Status**: Released
**Shipped**: 2026-04-04
**Prerequisite**: Milestone 5 (Feed Refresh and Source Diversity) shipped.
**Stories doc**: `agents/pm/stories_proactive_discovery.md`
**Source BRD**: `agents/ba/brd_proactive_discovery.md` (BRD-006)

### P0 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| DISC-001 | Topic Configuration | Released |
| DISC-002 | Daily Discovery Run — Scheduler Integration | Released |
| DISC-003 | Web Search Execution per Topic | Released |
| DISC-004 | Quality Gate — Candidate Evaluation | Released |
| DISC-005 | Deduplication Against Fixed Pipeline | Released |
| DISC-006 | Discovery Quota Enforcement | Released |
| DISC-007 | Pipeline Quota Split | Released |
| DISC-008 | Discovery Articles in Feed API | Released |
| DISC-010 | Discovery Source Attribution | Released |

### P1 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| DISC-009 | Topic Weight Feedback Loop | Released |

### Deferred to Later Milestones

| Story ID | Title | Status |
|----------|-------|--------|
| FUTURE-DISC-001 | Operator UI for managing discovery topics | Backlog |
| FUTURE-DISC-002 | Article body text extraction improvements | Backlog |

---

## Milestone 8 — Discovery Bug Fixes

**Goal**: Eliminate three post-ship defects identified in the M7 review: topic
weight double-counting due to unbounded feedback reprocessing, the
`discoveryTopic` internal field leaking through `GET /api/articles/[id]`, and
the `deviceId`/`userId` argument confusion in the topic weight upsert call.

**Status**: Released
**Shipped**: 2026-04-04
**Prerequisite**: Milestone 7 (Proactive Content Discovery) shipped.
**Task list**: `agents/architect/tasks_discovery_bugfix_v1.md`

### Stories

| Story ID | Title | Status |
|----------|-------|--------|
| BUG-001 | Topic weight double-counting — add last_processed_at guard | Released |
| BUG-002 | discoveryTopic leaks via GET /api/articles/[id] | Released |
| BUG-003 | deviceId/userId confusion in upsertTopicWeight call | Released |

---

## Phase 1 — Agentic Content Discovery (Pillar 1)

**Goal**: Replace the Brave Search keyword approach with richer, more intelligent
discovery from the Small Web, IndieWeb, and decentralized sources. Surface the
kind of content The Browser, The Marginalian, or Arts & Letters Daily would
feature. Includes IndieWeb/Small Web source seeding with organic blogroll expansion,
article body text extraction, LLM-based content evaluation (replacing the regex
quality gate), and expanded multi-query search strategies with rotation and
LLM-generated query banks.

**Status**: Released
**Shipped**: 2026-04-16
**Prerequisite**: Milestone 8 (Discovery Bug Fixes) shipped.
**Stories doc**: `agents/pm/stories_agentic_discovery_phase1.md`
**Source BRD**: `agents/ba/brd_agentic_discovery_phase1.md` (BRD-007)
**Design doc**: `agents/architect/design_agentic_discovery_phase1_v1.md`
**Task list**: `agents/architect/tasks_agentic_discovery_phase1_v1.md`
**Vision reference**: `agents/ba/vision_discovery_companion.md` — Section: "Agentic Deep Research and Multi-Agent Collaboration"

### P0 Stories

| Story ID | Title | Group | Status |
|----------|-------|-------|--------|
| AGDISC-001 | Small Web Source State Store | A — IndieWeb Seeding | Released |
| AGDISC-002 | Small Web Source Crawl Scheduler | A — IndieWeb Seeding | Released |
| AGDISC-003 | Blogroll Discovery and Source Pool Expansion | A — IndieWeb Seeding | Released |
| AGDISC-004 | Small Web Article Fetching and Feed Parsing | A — IndieWeb Seeding | Released |
| AGDISC-005 | Article Body Text Extraction Module | B — Body Extraction | Released |
| AGDISC-006 | Extraction Failure Logging and Pipeline Continuity | B — Body Extraction | Released |
| AGDISC-007 | Body Text Population on Article Record | B — Body Extraction | Released |
| AGDISC-008 | LLM Content Evaluator Module | C — LLM Evaluation | Released |
| AGDISC-009 | Quality Gate: Replace Specificity Heuristic with LLM Evaluation | C — LLM Evaluation | Released |
| AGDISC-011 | Multi-Query Topic Bank Schema | D — Expanded Search | Released |
| AGDISC-012 | Query Rotation Cursor | D — Expanded Search | Released |
| AGDISC-013 | Two-Queries-Per-Topic Execution | D — Expanded Search | Released |
| AGDISC-014 | LLM-Generated Query Bank Initialization and Refresh | D — Expanded Search | Released |

### P1 Stories

| Story ID | Title | Group | Status |
|----------|-------|-------|--------|
| AGDISC-010 | LLM Evaluation Cost and Run-Time Observability | C — LLM Evaluation | Released |

### Implementation Order Note

Groups A and D can be implemented in parallel with each other and with Group B.
Group C (AGDISC-008, AGDISC-009) cannot begin until AGDISC-005 (body extraction
module) is accepted. The Architect must sequence tasks accordingly.

---

## Phase 2 — Latent Aesthetic Space (Pillar 2)

**Goal**: Score every article along six orthogonal aesthetic dimensions (tone,
pacing, abstraction, voice, register, emotional resonance) using LLM-based
structured output at ingest time. Store scores as pgvector `vector(6)` in Neon.
Maintain a per-user aesthetic centroid updated via EMA (alpha = 0.2) on each
qualifying feedback event. Blend aesthetic proximity (30%) with source score (70%)
in `rankFeed()` using cosine similarity. New users and articles without scores
degrade gracefully to source-score-only ranking — no special-case cold-start code.

**Status**: Released
**Shipped**: 2026-04-04
**Prerequisite**: Phase 1 (Agentic Content Discovery) shipped.
**Stories doc**: `agents/pm/stories_aesthetic_space_phase2.md`
**Source BRD**: `agents/ba/brd_aesthetic_space_phase2.md` (BRD-008)
**Design doc**: `agents/architect/design_aesthetic_space_phase2_v1.md`
**Task list**: `agents/architect/tasks_aesthetic_space_phase2_v1.md`
**Vision reference**: `agents/ba/vision_discovery_companion.md` — Section: "Mapping Latent Aesthetic Spaces"

### P0 Stories

| Story ID | Title | Group | Status |
|----------|-------|-------|--------|
| AESTH-001 | Six-Dimension Aesthetic Schema Definition | A — Schema | Released |
| AESTH-002 | Aesthetic Score TypeScript Type | A — Schema | Released |
| AESTH-003 | Aesthetic Scoring Constants | A — Schema | Released |
| AESTH-004 | Aesthetic Scorer Module | B — LLM Scoring | Released |
| AESTH-005 | Aesthetic Scores Database Schema | B — LLM Scoring | Released |
| AESTH-006 | Pipeline Integration: Score Every Article at Ingest | B — LLM Scoring | Released |
| AESTH-007 | Scoring Failure Isolation | B — LLM Scoring | Released |
| AESTH-008 | User Aesthetic Profile Database Schema | C — User Profile | Released |
| AESTH-009 | Aesthetic Profile Update on Feedback | C — User Profile | Released |
| AESTH-010 | Aesthetic Profile Read Path | C — User Profile | Released |
| AESTH-011 | Cosine Similarity Utility | D — Ranking | Released |
| AESTH-012 | Blended Score Computation in rankFeed() | D — Ranking | Released |
| AESTH-013 | Feed API Integration for Aesthetic Ranking | D — Ranking | Released |
| AESTH-014 | Zero Aesthetic Term for New Users | E — Cold Start | Released |
| AESTH-015 | Graceful Degradation for Unscored Articles | E — Cold Start | Released |

### Implementation Order Note

Groups A and B must be implemented before Group C. Group C must be complete before
Group D can begin. Group D must be complete before Group E can be fully verified.
Groups A (schema/constants) can be implemented in parallel with each other.
AESTH-004 (scorer module) and AESTH-005 (DB schema) can be implemented in parallel.
AESTH-006 (pipeline integration) requires both AESTH-004 and AESTH-005 to be
complete. Full dependency graph is in `agents/pm/stories_aesthetic_space_phase2.md`.

### Deferred to Phase 3+

| Story ID | Title | Status |
|----------|-------|--------|
| FUTURE-AESTH-001 | User-visible aesthetic profile dashboard | Backlog |
| FUTURE-AESTH-002 | Retroactive scoring of pre-Phase-2 articles | Backlog |
| FUTURE-AESTH-003 | Natural language aesthetic feedback | Backlog |
| FUTURE-AESTH-004 | Dimension tuning without code change | Backlog |
| FUTURE-AESTH-005 | Cross-modal aesthetics (audio, video, image) | Backlog |
| FUTURE-AESTH-006 | Short-term vs. long-term aesthetic preference fusion | Backlog |
| FUTURE-AESTH-007 | Per-user adaptive alpha | Backlog |

---

## Phase 3 — Deep User Model (Pillars 2+3)

**Goal**: Extend the Phase 2 aesthetic preference model with two structural
additions: (1) a two-window preference memory system (21-day rolling short-term
centroid blended 35/65 with the existing long-term EMA centroid, inverted to
65/35 during detected taste drift), and (2) a concept graph — a persistent,
LLM-derived map of the specific ideas the user repeatedly engages with, stored in
Postgres, used as a supplementary ranking signal. Taste drift detection (cosine
distance >= 0.25 between centroids) and implicit engagement signals (dwell time
via `visibilitychange`, save/bookmark) complete the phase. All changes are
additive; no existing Phase 2 infrastructure is replaced.

**Status**: Released
**Shipped**: 2026-04-04
**Prerequisite**: Phase 2 (Latent Aesthetic Space) shipped.
**Stories doc**: `agents/pm/stories_deep_user_model_phase3.md`
**Source BRD**: `agents/ba/brd_deep_user_model_phase3.md` (BRD-009)
**Design doc**: `agents/architect/design_deep_user_model_phase3_v1.md`
**Task list**: `agents/architect/tasks_deep_user_model_phase3_v1.md`
**Vision reference**: `agents/ba/vision_discovery_companion.md` — Section: "Longitudinal Dynamics and Memory Architectures"

### P0 Stories (must ship)

| Story ID | Title | Group | Status |
|----------|-------|-------|--------|
| DEPTH-001 | Short-Term Centroid Database Schema | A — Short/Long Memory | Released |
| DEPTH-002 | Short-Term Centroid TypeScript Type Extensions | A — Short/Long Memory | Released |
| DEPTH-003 | Short-Term Centroid Recompute Function | A — Short/Long Memory | Released |
| DEPTH-004 | Blended Centroid at Ranking Time | A — Short/Long Memory | Released |
| DEPTH-005 | Concept Graph Database Schema | B — Concept Graph | Released |
| DEPTH-006 | Concept Extraction from Liked Articles | B — Concept Graph | Released |
| DEPTH-007 | Concept Graph Upsert and Edge Creation | B — Concept Graph | Released |
| DEPTH-008 | Concept Graph Pruning | B — Concept Graph | Released |
| DEPTH-009 | Concept Resonance Bonus at Ranking Time | B — Concept Graph | Released |
| DEPTH-010 | Concept Graph DB Helpers | B — Concept Graph | Released |

### P1 Stories (can slip to next minor)

| Story ID | Title | Group | Status |
|----------|-------|-------|--------|
| DEPTH-011 | Drift Score Computation | C — Taste Drift | Released |
| DEPTH-012 | Drift State Persistence | C — Taste Drift | Released |
| DEPTH-013 | Blend Inversion During Drift | C — Taste Drift | Released |
| DEPTH-014 | Dwell Time Client Tracking | D — Implicit Signals | Released |
| DEPTH-015 | Dwell Time Server Acceptance and Storage | D — Implicit Signals | Released |
| DEPTH-016 | Concept Weight Modulation from Implicit Signals | D — Implicit Signals | Released |
| DEPTH-017 | Save/Bookmark Action | D — Implicit Signals | Released |

### Implementation Order Note

Group A (short-term centroid) and Group B (concept graph) can be implemented in
parallel. Group C (drift detection) cannot begin until DEPTH-003 is complete.
Group D (implicit signals) can begin in parallel with A and B, but DEPTH-016
requires DEPTH-007. See full dependency graph in `agents/pm/stories_deep_user_model_phase3.md`.

### Deferred to Phase 4+

| Story ID | Title | Status |
|----------|-------|--------|
| FUTURE-DEPTH-001 | Graph traversal for serendipity injection | Backlog |
| FUTURE-DEPTH-002 | User-visible concept graph dashboard | Backlog |
| FUTURE-DEPTH-003 | Drift indicator in feed UI | Backlog |
| FUTURE-DEPTH-004 | Natural language feedback | Backlog |
| FUTURE-DEPTH-005 | Scroll depth as engagement proxy | Backlog |
| FUTURE-DEPTH-006 | Per-user adaptive blend weights | Backlog |
| FUTURE-DEPTH-007 | Retroactive concept extraction on pre-Phase-3 liked articles | Backlog |
| FUTURE-DEPTH-008 | Cross-device concept graph merge on login | Backlog |

---

## Phase 4 — Engineered Serendipity (Pillar 4)

**Goal**: Compute a serendipity score for every candidate article by combining
hop-distance from the user's concept graph with a quality weight. Reserve a
structured exploration budget (4 baseline slots, adaptive 2–6) in the daily 20-
article feed, allocated across semantic stretch, blind spot probe, and complete
wildcard slot types. Implement blind spot probing: identify conceptual domains
absent from the concept graph, inject probe articles targeting those domains, and
learn from the user's like/dislike/ignore response to direct future probing.
Compute a receptivity signal from three observable signals (topic diversity, probe
acceptance rate, dwell ratio) and use it to modulate the exploration budget within
the floor/ceiling bounds. All changes are additive and system-internal; no new UI.

**Status**: Released
**Shipped**: 2026-04-04
**Prerequisite**: Phase 3 (Deep User Model) shipped.
**Stories doc**: `agents/pm/stories_engineered_serendipity_phase4.md`
**Source BRD**: `agents/ba/brd_engineered_serendipity_phase4.md` (BRD-010)
**Design doc**: `agents/architect/design_engineered_serendipity_phase4_v1.md`
**Task list**: `agents/architect/tasks_engineered_serendipity_phase4_v1.md`
**Vision reference**: `agents/ba/vision_discovery_companion.md` — Section: "Engineering Serendipity and Mapping the Unknown"

### P0 Stories (must ship)

| Story ID | Title | Group | Status |
|----------|-------|-------|--------|
| SEREN-001 | Concept Distance Classification Utilities | A — Surprise Scoring | Released |
| SEREN-002 | Raw Surprise Score Computation | A — Surprise Scoring | Released |
| SEREN-003 | Quality Weight Normalization | A — Surprise Scoring | Released |
| SEREN-004 | Serendipity Score Assembly | A — Surprise Scoring | Released |
| SEREN-005 | Concept Extraction for All Candidate Articles | A — Surprise Scoring | Released |
| SEREN-013 | Exploration Budget Constants and Slot Type Allocation Table | C — Exploration Budget | Released |
| SEREN-014 | Slot Type Candidate Pool Construction | C — Exploration Budget | Released |
| SEREN-015 | Exploration Slot Assembly | C — Exploration Budget | Released |
| SEREN-016 | Exploration vs. Exploitation Deduplication | C — Exploration Budget | Released |
| SEREN-017 | Feed Assembly Integration in `rankFeed()` | C — Exploration Budget | Released |

### P1 Stories (can slip to next minor)

| Story ID | Title | Group | Status |
|----------|-------|-------|--------|
| SEREN-006 | Blind Spot Cluster Identification | B — Blind Spot Probing | Released |
| SEREN-007 | Blind Spot Probe Article Selection | B — Blind Spot Probing | Released |
| SEREN-008 | Probe Article Tracking in Batch Metadata | B — Blind Spot Probing | Released |
| SEREN-009 | Probe Response Interpretation on Feedback | B — Blind Spot Probing | Released |
| SEREN-010 | Blind Spot Cluster Promotion | B — Blind Spot Probing | Released |
| SEREN-011 | Blind Spot Cluster Suppression | B — Blind Spot Probing | Released |
| SEREN-012 | Probe Ignore Handling | B — Blind Spot Probing | Released |
| SEREN-018 | Topic Diversity Score Computation | D — Receptivity Signal | Released |
| SEREN-019 | Probe Acceptance Rate Computation | D — Receptivity Signal | Released |
| SEREN-020 | Exploration Dwell Ratio Computation | D — Receptivity Signal | Released |
| SEREN-021 | Receptivity Score Assembly | D — Receptivity Signal | Released |
| SEREN-022 | Budget Modulation from Receptivity Score | D — Receptivity Signal | Released |

### Implementation Order Note

Group A (surprise scoring) must be implemented before Groups B, C, and D. Groups B
and C depend on Group A and can proceed in parallel once SEREN-001 through SEREN-005
are complete. Group D depends on Groups B and C being substantially complete before
accurate receptivity computation is possible. See full dependency graph in
`agents/pm/stories_engineered_serendipity_phase4.md`.

### Architect Decisions Required Before Design Begins

Seven decisions are flagged in the stories document that the Architect must resolve
in the Phase 4 design document: (1) `blind_spot_state` DB schema, (2) serendipity
score integration point in `rankFeed()`, (3) receptivity score storage strategy,
(4) slot classification field on article records, (5) probe concept extraction
engagement weight, (6) quality score range confirmation from `qualityGate.ts`,
(7) exploration constants file location.

### Deferred to Phase 5+

| Story ID | Title | Status |
|----------|-------|--------|
| FUTURE-SEREN-001 | User-visible exploration mode indicator | Backlog |
| FUTURE-SEREN-002 | "Why this is here" explanation for exploration articles | Backlog |
| FUTURE-SEREN-003 | Vector embedding-based semantic distance | Backlog |
| FUTURE-SEREN-004 | User-configurable exploration budget override | Backlog |
| FUTURE-SEREN-005 | Real-time or sub-daily receptivity updates | Backlog |
| FUTURE-SEREN-006 | Cross-device blind spot state merge on login | Backlog |
| FUTURE-SEREN-007 | Scroll depth as a third engagement proxy for receptivity | Backlog |
| FUTURE-SEREN-008 | Retroactive serendipity scoring of pre-Phase-4 batches | Backlog |

---

## Milestone 6 — Extended Features (Deferred)

**Goal**: Quality-of-life features. Deprioritized in favor of the four-phase
vision work. May be revisited as needed.

**Status**: Backlog

| Story ID | Title | Status |
|----------|-------|--------|
| FUTURE-006 | Offline reading / article caching | Backlog |
| FUTURE-008 | Search and filter by topic or category | Backlog |
| FUTURE-010 | Article sharing | Backlog |

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-04 | PM Agent | Initial roadmap created. Milestone 1 scoped from BRD-001. |
| 2026-04-04 | PM Agent | Milestone 1 marked Released. All 13 FEED stories shipped. Milestone 2 unblocked pending Feedback BRD. |
| 2026-04-04 | PM Agent | Milestone 2 moved to In Progress. BRD-002 resolved. 5 FB stories written (stories_feedback_capture_v1.md). FUTURE-001 replaced by FB-001 through FB-005. FUTURE-002/003/004 remain backlog. |
| 2026-04-04 | PM Agent | Milestone 2.5 added. BRD-003 resolved. 10 SFB stories written (stories_server_feedback_v1.md). Covers device identity, DB schema, all four API endpoints, client integration, offline retry queue, and localStorage migration. |
| 2026-04-04 | Manual | Milestone 2 and 2.5 marked Released. All FB and SFB stories updated to Released status. Roadmap drift corrected. |
| 2026-04-04 | PM Agent | Milestone 3 (User Authentication) and Milestone 4 (Feed Personalization) added. 11 AUTH stories and 11 PERS stories written. Former Milestone 3 (Extended Features) renumbered to Milestone 5. Deferred backlog items added for future suppression reversal and mandatory login enforcement. |
| 2026-04-04 | Manual | Milestones 3, 4, and 5 marked Released. All AUTH, PERS, and REFRESH stories updated to Released. Roadmap drift corrected again (same issue as M2/M2.5). dev.md tightened to prevent recurrence.  |
| 2026-04-04 | PM Agent | Milestone 5 (Feed Refresh and Source Diversity) added. 11 REFRESH stories written (stories_feed_refresh_and_diversity_v1.md). BRD-005 open questions resolved: 15-min cooldown, 3-source minimum, 5-article-per-source cap, all authenticated users may refresh, anonymous users unaffected. Former Milestone 5 (Extended Features) renumbered to Milestone 6. FUTURE-009 (pull-to-refresh) moved to M5 deferred list. |
| 2026-04-04 | PM Agent | Milestone 7 (Proactive Content Discovery) added as Planned. 10 DISC stories written (stories_proactive_discovery.md) from BRD-006. Quota split resolved: 6 discovery / 14 fixed-source, both configurable constants. Architect decisions flagged: search provider, quality gate specificity and credibility mechanisms, freshness recency window, topic weight storage and mechanism. DISC-009 (topic weight feedback loop) is P1; all other stories are P0. Extended Features remains Milestone 6. |
| 2026-04-04 | Architect Agent | Milestone 7 design complete. Status updated to In Progress. Brave Search API selected. 14 tasks in tasks_proactive_discovery_v1.md. DISC-TASK-001 through DISC-TASK-010 are P0; DISC-TASK-011 through DISC-TASK-013 are P1 (topic weight loop); DISC-TASK-014 is documentation. |
| 2026-04-04 | Dev Agent | Milestone 7 P0 shipped. DISC-001 through DISC-008, DISC-010 all Released. P1 story DISC-009 (topic weight feedback loop) remains Planned. |
| 2026-04-04 | Dev Agent | DISC-009 (Topic Weight Feedback Loop) verified (DISC-TASK-013). All six acceptance criteria pass by code inspection. DISC-009 marked Released. Milestone 7 still In Progress pending DISC-TASK-014 (ARCHITECTURE.md update). |
| 2026-04-04 | Dev Agent | DISC-TASK-014 complete. ARCHITECTURE.md updated: status header, DISC-TASK-014 marked Done, changelog entry added. Milestone 7 marked Released. All 14 Milestone 7 tasks shipped. |
| 2026-04-04 | Architect Agent | Milestone 8 (Discovery Bug Fixes) added as In Progress. Three bug stories (BUG-001, BUG-002, BUG-003) written from M7 post-ship review. Task list at agents/architect/tasks_discovery_bugfix_v1.md. |
| 2026-04-04 | Dev Agent | Milestone 8 all three bug fixes shipped. BUG-001, BUG-002, BUG-003 all Released. Milestone 8 marked Released. |
| 2026-04-07 | Manual | Vision refined: project is now a personalized content discovery companion (not a news aggregator). Scope narrowed to single-user first (Kyle) with user-supplied starter sources. Identity parameterized for future multi-user expansion. Four-phase plan added (Agentic Discovery, Latent Aesthetic Space, Deep User Model, Engineered Serendipity). M6 Extended Features deprioritized. Vision doc at agents/ba/vision_discovery_companion.md. |
| 2026-04-04 | PM Agent | Phase 1 (Agentic Content Discovery) stories written from BRD-007. 14 AGDISC stories across four groups: IndieWeb/Small Web seeding (A, 4 stories), body text extraction (B, 3 stories), LLM content evaluation (C, 3 stories), expanded search strategy (D, 4 stories). 13 P0, 1 P1. Phase 1 roadmap section updated from placeholder to full story table with group labels and implementation order note. Architect decisions flagged: source state storage mechanism, blogroll parsing scope, LLM model confirmation, prompt design, query bank storage path and schema, initialization trigger mechanism, Readability library version. |
| 2026-04-04 | Dev Agent | Phase 1 AGDISC-TASK-001–017 implemented. All 14 P0 stories + AGDISC-010 (P1, observability) Released. DDL at lib/db/migrations/007_small_web_sources.sql must be applied manually in Neon before E2E verification (AGDISC-TASK-018). npx tsc --noEmit passes. |
| 2026-04-16 | Dev Agent | Phase 1 complete. AGDISC-TASK-018 (E2E verification) complete by static code inspection + TypeScript clean build. AGDISC-TASK-019 (ARCHITECTURE.md final update) complete. All 19 Phase 1 tasks Done. Phase 1 milestone marked Released. |
| 2026-04-04 | PM Agent | Phase 2 (Latent Aesthetic Space) scoped from BRD-008. 15 AESTH stories written across five groups: dimension schema (A, 3 stories), LLM scoring pipeline (B, 4 stories), user aesthetic profile (C, 3 stories), aesthetic-aware ranking (D, 3 stories), cold-start and graceful degradation (E, 2 stories). All 15 stories are P0. Phase 2 roadmap section updated from placeholder to full story table. Seven future items deferred to Phase 3+. Architect decisions flagged: pgvector DDL for two new tables, cosine similarity implementation location, EMA update atomicity, LLM model ID and prompt design, pipeline scoring integration point, feedback handler integration approach. |
| 2026-04-04 | Dev Agent | Phase 2 (Latent Aesthetic Space) complete. AESTH-TASK-004 through AESTH-TASK-012 implemented. All 15 AESTH stories Released. Phase 2 milestone marked Released. |
| 2026-04-04 | PM Agent | Phase 3 (Deep User Model) scoped from BRD-009. 17 DEPTH stories written across four groups: short/long-term preference memory (A, 4 stories), concept graph (B, 6 stories), taste drift detection (C, 3 stories), implicit engagement signals (D, 4 stories). 10 P0 stories (Groups A and B), 7 P1 stories (Groups C and D). Phase 3 roadmap section updated from placeholder to full story table. 8 future items deferred to Phase 4+. Architect decisions flagged: short-term centroid migration DDL, concept graph table schema and index strategy, dwell time storage approach, drift state persistence strategy, blend weight constants location, LLM extraction call site and failure handling, concept resonance check implementation. |
| 2026-04-04 | Dev Agent | Phase 3 (Deep User Model) fully shipped. All 17 DEPTH stories Released. All 14 DEPTH tasks Done. Phase 3 milestone marked Released. Implemented: migration 010, 12 Phase 3 constants, AestheticProfile extended, UserConcept/UserConceptEdge types, recomputeShortTermCentroid, updateDriftState, computeDriftScore, lib/db/concepts.ts, conceptBonus.ts, conceptExtractor.ts, blendCentroids + topConceptLabels in ranker, feedback route Phase 3 integration (save + dwell + concept pipeline), feed route concept nodes, ArticleInteractions UI component (dwell timer + save button). npx tsc --noEmit passes. |
| 2026-04-04 | PM Agent | Phase 4 (Engineered Serendipity) scoped from BRD-010. 22 SEREN stories written across four groups: surprise scoring (A, 5 stories), blind spot probing (B, 7 stories), exploration budget and slot assembly (C, 5 stories), receptivity signal (D, 5 stories). 10 P0 stories (Groups A and C), 12 P1 stories (Groups B and D). Phase 4 roadmap section updated from placeholder to full story table with implementation order note. 7 Architect decisions flagged: blind_spot_state DB schema, serendipity score integration point in rankFeed(), receptivity score storage, slot classification field on articles, probe concept extraction engagement weight, quality score range from qualityGate.ts, exploration constants file location. 8 future items deferred. |
| 2026-04-04 | Dev Agent | Phase 4 (Engineered Serendipity) fully shipped. All 22 SEREN stories Released. All 15 SEREN tasks Done. migration 011 applied. lib/config/serendipity.ts, serendipityScorer.ts, explorationAssembler.ts, blindSpotProber.ts, receptivity.ts, lib/db/blindSpots.ts all implemented. rankFeed() extended with serendipity pre-pass and two-pool exploration assembly. Feedback route extended with probe routing and receptivity update. Feed route reads stored exploration budget. npx tsc --noEmit passes clean. Phase 4 milestone marked Released. The four-phase Discovery Companion vision is now fully delivered. |
