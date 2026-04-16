# Product Roadmap

**Last Updated**: 2026-04-04 (Phase 2 Latent Aesthetic Space shipped; all 15 AESTH stories Released)
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

**Goal**: Build a persistent cognitive model of the user's evolving taste. Replace
the topic weight system with a vector-based taste profile. Add natural language
feedback alongside like/dislike. Implement short-term/long-term preference fusion.
Use Mem0-style graph-enhanced memory for longitudinal relationship tracking.

**Status**: Backlog
**Prerequisite**: Phase 2 shipped.
**Vision reference**: `agents/ba/vision_discovery_companion.md` — Section: "Longitudinal Dynamics and Memory Architectures"

---

## Phase 4 — Engineered Serendipity (Pillar 4)

**Goal**: Compute serendipity via semantic distance, relevance, and diversity.
Implement active learning to test blind spots and contradict the machine's
assumptions. Deploy structured randomness weighted by the user's psychographic
profile. Balance exploration and exploitation to continuously expand intellectual
boundaries.

**Status**: Backlog
**Prerequisite**: Phase 3 shipped.
**Vision reference**: `agents/ba/vision_discovery_companion.md` — Section: "Engineering Serendipity and Mapping the Unknown"

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
