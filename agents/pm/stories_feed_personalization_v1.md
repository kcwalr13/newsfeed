# User Stories — Feed Personalization (Milestone 4)

**Document ID**: stories_feed_personalization_v1.md
**Date**: 2026-04-04
**Status**: Draft
**Milestone**: 4 — Personalized Feed
**Source BRD**: `agents/ba/brd_feed_personalization_v1.md` (BRD-004)
**Maintained by**: PM Agent

---

## Overview

These stories deliver the first version of a personalized daily feed. When complete,
users who have given like/dislike feedback will see articles ranked by source
affinity. Sources they consistently like appear higher; sources they consistently
dislike drift lower or disappear. A small number of slots are always reserved for
sources the user has not yet rated, preventing filter-bubble lock-in.

Personalization is scope-aware: authenticated users are personalized by their
account-level feedback history (cross-device); anonymous users are personalized by
their device-scoped history. New users with no feedback history see the same
unranked feed as today — no visible difference, no error.

All stories depend on server-side feedback storage (Milestone 2.5) and user
authentication (Milestone 3) being shipped.

---

## Open Question Resolutions (PM Decisions)

BRD-004 had several open questions. The ones that are product decisions are resolved
here. The ones that are architecture decisions are flagged for the Architect.

### 1. Source Diversity Cap — PM Decision

**Decision**: Enforce a maximum of 3 consecutive articles from the same source in
the final ranked feed. There is no cap on the total count of articles from a single
source per feed, but they must be distributed, not clustered.

**Rationale**: Without a diversity constraint, a user who loves one prolific source
could see 8 or 10 articles from it at the top of the feed, which feels repetitive
and limits the value of a curated digest. A consecutive-articles cap (rather than
a total-count cap) is simpler to implement deterministically and addresses the core
UX problem while still rewarding highly-scored sources with prominent placement.

### 2. Exploration Slot Placement — PM Decision

**Decision**: Exploration slots are placed at fixed positions: slot 3, slot 10, and
slot 17 out of 20 (1-indexed). This gives one exploration article near the top of
the feed, one in the middle, and one near the bottom. The exact count of exploration
slots (3 out of 20) is a constant defined in config, not hardcoded inline.

**Rationale**: Fixed positions are deterministic (the feed is stable if run twice
on the same day), discoverable by the user (new sources are not always buried), and
simple to reason about in product terms. The positions are spread so that exploration
articles appear at natural reading pause points without dominating the top of the
feed. The config constant allows easy adjustment once we have usage data.

### 3. Pipeline Architecture — Architect Decision (Flagged, Not Resolved Here)

BRD-004 raises the question of whether personalization happens at pipeline time
(per-identity batch files) or at API read time (ranking in memory when the client
calls `GET /api/feed/today`). The product owner's stated preference is pipeline-time
personalization. However, the choice has significant architectural implications
(batch file management, pipeline discovery of identities, storage growth) that the
PM is not positioned to resolve.

**This decision is delegated to the Architect.** The PM's requirement is that the
client always receives a pre-ranked feed from `GET /api/feed/today` — the client
does not perform any reordering. How the server produces that ranked response is an
implementation detail.

The stories below are written to be architecture-neutral on this point. They describe
observable behavior (what the client receives) rather than implementation mechanism
(how the server produces it).

### 4. Suppression Threshold Values — Architect Decision (Flagged)

The minimum dislike ratio and minimum event count required for suppression are
implementation details with UX consequences. The PM's behavioral requirements are
captured in PERS-003: suppression must require more than one or two signals, and
the data model must not make reversal structurally impossible. Exact numbers are
delegated to the Architect, with a note that they should be configurable constants
rather than hardcoded values.

### 5. Score Tiebreaker — Architect Decision (Flagged)

The tiebreaker when two sources have equal scores must be deterministic for a given
day (same result if run twice). The Architect should document the chosen approach
in the design doc.

---

## Dependency Order

```
PERS-001 (Source Scoring Model)
    ├── PERS-002 (Ranked Feed Output)
    │       ├── PERS-003 (Source Suppression)
    │       │       └── PERS-007 (All-Sources-Suppressed Fallback)
    │       ├── PERS-004 (Source Diversity Cap)
    │       ├── PERS-005 (Exploration Budget)
    │       └── PERS-006 (Pipeline Integration)
    │               └── PERS-008 (API Delivers Pre-Ranked Feed)
    │
PERS-009 (Anonymous vs. Authenticated Identity Routing)
    └── depends on PERS-001 and AUTH-010 (Milestone 3)

PERS-010 (New User Graceful Degradation)
    └── depends on PERS-002 and PERS-008

PERS-011 (Feedback-After-Cutoff Handling)
    └── depends on PERS-006
```

Stories marked **[BLOCKS X]** must be accepted before those stories can begin.

---

## Stories

---

### PERS-001 — Source Scoring Model

**Priority**: P0
**Blocks**: PERS-002, PERS-003, PERS-005, PERS-009
**Depends on**: SFB-002 (feedback table), SFB-004 (feedback write API)

**As a** system that learns from user feedback,
**I want** a scoring model that aggregates article-level feedback into source-level
affinity scores,
**so that** sources a user genuinely likes rank higher and sources they dislike rank
lower in their daily feed.

#### Acceptance Criteria

1. For a given identity (user ID for authenticated users, device ID for anonymous
   users), source scores are derived by aggregating all feedback records associated
   with that identity where the article belongs to a known source.
2. Source membership is determined by the source slug prefix in the article ID
   (e.g., an article with ID `bbc-news-a1b2c3d4` belongs to source `bbc-news`).
   The Architect must confirm and document the canonical join key (slug prefix vs.
   `sourceName` field) in their design doc.
3. A source with a higher ratio of likes to total feedback events scores higher than
   a source with an even split. A source with a higher ratio of dislikes scores
   lower than a source with an even split. The precise formula is an Architect
   decision.
4. A source with no feedback receives a neutral score. It neither benefits nor suffers
   from the absence of signal.
5. Scores are confidence-dampened: a single like or dislike produces a score very
   close to neutral. A consistent pattern across many feedback events produces a
   score meaningfully above or below neutral. Small sample sizes should not cause
   extreme rankings.
6. Scores are bounded: there is a maximum score (no source can rank infinitely above
   others) and a minimum score floor (at which point the source is suppressed —
   see PERS-003 — rather than receiving a further-reduced score).
7. The scoring logic is isolated in a module that can be tested independently of
   the pipeline and API layers.
8. Suppression threshold constants and exploration slot count are defined as named
   configuration constants, not hardcoded inline. The Architect documents where
   these constants live.

---

### PERS-002 — Ranked Feed Output

**Priority**: P0
**Blocks**: PERS-003, PERS-004, PERS-005, PERS-006, PERS-010
**Depends on**: PERS-001

**As a** user with a feedback history,
**I want** the articles in my daily feed to be ordered so that sources I enjoy
appear near the top,
**so that** I see more relevant content at a glance without having to scroll.

#### Acceptance Criteria

1. The feed returned to a user is sorted in descending order of source score. An
   article whose source has a higher score appears before an article whose source
   has a lower score.
2. Articles from suppressed sources do not appear in the ranked output (see PERS-003).
3. Exploration articles are placed at fixed positions (positions 3, 10, and 17
   out of 20) regardless of score. All other positions are filled by ranked articles
   in score order, skipping the exploration positions.
4. If there are fewer ranked (non-exploration) articles available than required to
   fill the remaining positions (e.g., many sources suppressed), the available
   articles fill positions in score order; remaining positions are left empty rather
   than padding with suppressed articles. The all-suppressed fallback (PERS-007)
   handles the extreme case.
5. When two sources have equal scores, the tiebreaker is deterministic for a given
   day (running the ranking twice on the same inputs produces the same order). The
   specific tiebreaker is an Architect decision.
6. The total article count in the feed equals `ARTICLES_PER_DAY` (20) when
   sufficient articles are available, minus any suppressed sources that could not
   be replaced.

---

### PERS-003 — Source Suppression

**Priority**: P0
**Blocks**: PERS-007
**Depends on**: PERS-001

**As a** user who consistently dislikes content from a specific source,
**I want** articles from that source to stop appearing in my feed,
**so that** I do not have to keep scrolling past content I have told the system
I do not want.

#### Acceptance Criteria

1. When a source's score falls at or below the suppression floor (determined by the
   scoring model in PERS-001), that source is excluded entirely from the user's
   ranked feed. Its articles do not appear at any position, including exploration
   slots.
2. Suppression requires a minimum number of feedback events on that source before
   it can be triggered. A user who accidentally taps dislike once does not lose a
   source. The exact minimum event count is a configurable constant defined by the
   Architect.
3. Suppression is silent — no notification, toast, or UI indicator tells the user
   a source has been suppressed.
4. The data model must not make suppression reversal structurally impossible. If the
   user's feedback on a suppressed source later improves (e.g., after future tooling
   allows feedback deletion or reset), the source must be capable of re-entering the
   feed. No permanent flags or hard deletes are used to implement suppression —
   suppression is always derived at runtime from the current feedback state.
5. A suppressed source behaves the same whether the user is authenticated (user-level
   suppression) or anonymous (device-level suppression).

---

### PERS-004 — Source Diversity Cap

**Priority**: P0
**Blocks**: —
**Depends on**: PERS-002

**As a** user,
**I want** the feed not to be dominated by articles from a single source,
**so that** even a highly-scored source feels like part of a curated digest rather
than a firehose from one outlet.

#### Acceptance Criteria

1. In the final ranked output, no more than 3 consecutive article positions may be
   occupied by articles from the same source.
2. If a source would place 4 or more articles consecutively (due to its high score),
   the 4th consecutive article from that source is repositioned: it is placed after
   the next article from a different source. The same rule applies recursively.
3. The diversity cap is enforced after exploration slots are placed. Exploration
   slots are counted as belonging to their respective sources when evaluating
   consecutiveness.
4. The cap does not reduce the total article count — no article is dropped due to
   the diversity cap. It only affects ordering.
5. The cap is implemented as a post-ranking step so that the core scoring and
   sorting logic is unaffected.
6. Running the diversity cap algorithm twice on the same ranked input produces the
   same output (deterministic).

---

### PERS-005 — Exploration Budget

**Priority**: P0
**Blocks**: —
**Depends on**: PERS-001, PERS-002

**As a** user whose feed has been personalized over time,
**I want** a few slots in every feed to be reserved for sources I have not yet
rated,
**so that** I can discover new content and my feed does not collapse into a narrow
loop of already-known sources.

#### Acceptance Criteria

1. Each daily feed reserves `EXPLORATION_SLOTS` positions for exploration articles.
   The default value is 3. This is a named configuration constant, not hardcoded.
2. Exploration slots are placed at fixed positions 3, 10, and 17 (1-indexed) in
   the final feed output.
3. Exploration slots are filled by articles from sources the user has never given
   feedback on. If multiple such sources are available, the selection is random
   within that pool (varied day-to-day is acceptable; the determinism requirement
   from PERS-002 applies only to the scored ranking, not the exploration slot
   assignment).
4. Suppressed sources are excluded from exploration slot candidates. A suppressed
   source cannot re-enter the feed via an exploration slot.
5. If there are fewer unseen sources than `EXPLORATION_SLOTS`, the available unseen
   sources fill as many exploration slots as possible. The remaining exploration
   positions are filled by the highest-ranked non-suppressed articles (treated as
   regular ranked positions for that day only).
6. If the user has given feedback on every configured source, there are zero
   exploration candidates. All positions are filled by scored ranked articles.
   No error or empty slots occur.
7. Exploration slot placement is applied after scored ranking and before the
   diversity cap (PERS-004). If an exploration article violates the consecutive-
   source cap in context, the diversity cap algorithm handles it.

---

### PERS-006 — Pipeline Integration

**Priority**: P0
**Blocks**: PERS-008, PERS-011
**Depends on**: PERS-002, PERS-003, PERS-004, PERS-005

**As a** system operator,
**I want** the daily content pipeline to produce personalized feed outputs for each
identity that has a feedback history,
**so that** personalization is computed once per day and the API can serve results
without expensive per-request computation.

#### Acceptance Criteria

1. When the pipeline runs (`POST /api/pipeline/run`), it fetches the full article
   batch as it does today. This existing behavior is unchanged.
2. In addition to (or in place of) writing a single shared batch file, the pipeline
   produces personalized feed outputs for identities with existing feedback history.
   The mechanism for doing this (per-identity batch files vs. in-memory ranking at
   API time) is an Architect decision, flagged in the Open Questions section above.
   The PM requirement is that the client receives a pre-ranked feed — the server
   must not offload ranking to the client.
3. The pipeline must handle both user-ID-keyed personalization (for authenticated
   users) and device-ID-keyed personalization (for anonymous users). Both identity
   types are first-class.
4. The pipeline continues to produce a default (unranked) output for identities with
   no feedback history.
5. A pipeline failure during the personalization step (e.g., database unreachable
   when querying feedback) must not prevent the default unranked feed from being
   written. The pipeline degrades gracefully: if personalization fails, the default
   feed is still available. The failure is logged.
6. The pipeline run is idempotent per day: running it twice on the same day
   produces the same outputs with no errors (consistent with existing behavior on
   the shared batch).
7. Pipeline performance must remain acceptable as the number of identities grows.
   The Architect documents the expected performance profile and any limits in their
   design doc.

---

### PERS-007 — All-Sources-Suppressed Fallback

**Priority**: P0
**Blocks**: —
**Depends on**: PERS-003, PERS-006

**As a** user who (in an extreme edge case) has suppressed every configured source,
**I want** the feed to still show something rather than being empty,
**so that** the app never presents a broken or blank experience.

#### Acceptance Criteria

1. When the ranking step produces zero eligible articles for a given identity
   (because all sources are suppressed), the pipeline detects this condition.
2. In this case, the suppression floor is temporarily lifted: articles from the
   least-disliked suppressed sources are included until `ARTICLES_PER_DAY`
   is met (or all sources are exhausted). "Least-disliked" means ordered by
   suppressed score descending — the source closest to the suppression floor
   appears first.
3. The exact number of fallback articles to include and the ordering within the
   fallback set are Architect decisions; the behavioral requirement is simply that
   the feed is never empty.
4. The fallback is silent — no message is shown to the user explaining why they are
   seeing suppressed content.
5. The fallback applies per-identity. An identity that has not suppressed all sources
   is unaffected by this logic.

---

### PERS-008 — API Delivers Pre-Ranked Feed

**Priority**: P0
**Blocks**: —
**Depends on**: PERS-006

**As a** frontend developer,
**I want** `GET /api/feed/today` to return articles already ranked for the requesting
user or device,
**so that** the client can render the feed in the order received without any
reordering logic.

#### Acceptance Criteria

1. `GET /api/feed/today` continues to accept the `dd_device_id` cookie and, for
   authenticated users, the `dd_session` cookie.
2. For an **authenticated user** (valid session present), the endpoint returns
   articles ranked according to that user's account-level feedback history.
3. For an **anonymous user** (no session, device ID present), the endpoint returns
   articles ranked according to that device's feedback history.
4. For a **new user** (no session and no feedback history for the device), the
   endpoint returns the default unranked batch — identical to the current behavior.
5. The client does not need to change its calling convention. The same
   `GET /api/feed/today` URL works for all three cases; the server resolves the
   identity from cookies.
6. The response shape is unchanged from today: a `FeedResponse` envelope with
   `batchDate` and `articles`. No new fields are required on the response for
   personalization to work.
7. The endpoint does not expose which articles are exploration-slot articles vs.
   ranked articles. The distinction is invisible to the client.

---

### PERS-009 — Anonymous vs. Authenticated Identity Routing

**Priority**: P0
**Blocks**: —
**Depends on**: PERS-001, AUTH-010 (Milestone 3 — session client integration)

**As a** system that supports both anonymous and authenticated users,
**I want** the personalization logic to correctly route to the right feedback history
depending on whether the user is logged in,
**so that** an authenticated user always gets their account-scoped personalization,
not their device-scoped personalization.

#### Acceptance Criteria

1. When determining which feedback history to use for personalization, the system
   checks for a valid session first.
2. If a valid session is present, the system uses the authenticated `user_id` as
   the identity key for scoring and ranking. The `device_id` is ignored for
   personalization purposes on this request.
3. If no valid session is present but a `device_id` is present, the system uses
   the `device_id` as the identity key.
4. If neither is present, the system returns the default unranked feed (see
   PERS-010).
5. An authenticated user who logs in on a new device sees their full account-level
   personalization immediately after login. They do not see device-level
   personalization from the new device's empty history.
6. After logout, the device reverts to its `device_id`-scoped personalization.
   Any anonymous feedback accumulated before login (and now also associated with
   the user account) still affects the device's personalization because those
   records have the `device_id` set.

---

### PERS-010 — New User Graceful Degradation

**Priority**: P0
**Blocks**: —
**Depends on**: PERS-002, PERS-008

**As a** new user who has not yet given any feedback,
**I want** the app to behave exactly as it does today,
**so that** the introduction of personalization logic produces no visible change or
degradation for users who have not yet engaged with the feedback system.

#### Acceptance Criteria

1. When a user has no feedback records (new device, no prior likes or dislikes), the
   feed returned by `GET /api/feed/today` is the standard default unranked batch.
2. The unranked batch is identical in format and content to what the app returns
   today. No new fields, no empty feed, no error states.
3. The first feedback event a user gives (like or dislike on any article) does not
   produce an immediate visible change to the current day's feed. It will influence
   the next day's pipeline run.
4. This story is verified by manual test: create a device with no feedback history
   (or clear all feedback), load the feed, and confirm it matches the default batch
   with no visible difference.

---

### PERS-011 — Feedback-After-Cutoff Behavior

**Priority**: P1
**Blocks**: —
**Depends on**: PERS-006

**As a** user who gives feedback after today's pipeline has already run,
**I want** that feedback to be stored and to influence tomorrow's feed,
**so that** my signal is never lost, even if it cannot affect today's already-
generated batch.

#### Acceptance Criteria

1. Feedback given after the pipeline has written today's batch is stored normally
   in the database. There is no "too late" state — all feedback writes succeed
   regardless of the time of day.
2. Feedback given after today's batch is written does not change today's feed for
   this or any other user. Today's batch is fixed once written.
3. The next pipeline run (tomorrow) reads all feedback records including those
   written since yesterday's run. Tomorrow's feed reflects all feedback accumulated
   through the end of today.
4. No message or UI indicator is shown to the user when their feedback is "too late
   for today." The app behaves identically regardless of whether feedback was given
   before or after that day's pipeline run.

---

## Story Summary Table

| Story ID | Title | Priority | Depends On | Blocks |
|----------|-------|----------|------------|--------|
| PERS-001 | Source Scoring Model | P0 | SFB-002 | PERS-002, PERS-003, PERS-005, PERS-009 |
| PERS-002 | Ranked Feed Output | P0 | PERS-001 | PERS-004, PERS-005, PERS-010 |
| PERS-003 | Source Suppression | P0 | PERS-001 | PERS-007 |
| PERS-004 | Source Diversity Cap | P0 | PERS-002 | — |
| PERS-005 | Exploration Budget | P0 | PERS-001, PERS-002 | — |
| PERS-006 | Pipeline Integration | P0 | PERS-002, PERS-003, PERS-004, PERS-005 | PERS-008, PERS-011 |
| PERS-007 | All-Sources-Suppressed Fallback | P0 | PERS-003, PERS-006 | — |
| PERS-008 | API Delivers Pre-Ranked Feed | P0 | PERS-006 | — |
| PERS-009 | Anonymous vs. Authenticated Identity Routing | P0 | PERS-001, AUTH-010 | — |
| PERS-010 | New User Graceful Degradation | P0 | PERS-002, PERS-008 | — |
| PERS-011 | Feedback-After-Cutoff Behavior | P1 | PERS-006 | — |

PERS-001 through PERS-010 are P0. PERS-011 is P1 (documentation and behavioral
clarification; the behavior is a natural consequence of the pipeline architecture
and requires no additional implementation, but must be verified).

---

## Definition of Done (Milestone 4)

All P0 stories are accepted when:

1. A returning user who has consistently liked articles from source A and disliked
   articles from source B sees source A's articles near the top of the feed and
   source B's articles near the bottom (or absent entirely, if suppressed).
2. An authenticated user who logs into a new device sees their account-personalized
   feed, not the new device's empty-history feed.
3. An anonymous user's feed is personalized to their device's feedback history.
4. A new user (no feedback) sees the same unranked feed as today. No visible
   difference.
5. Exploration articles appear at positions 3, 10, and 17, drawn from sources the
   user has not yet rated.
6. No more than 3 consecutive articles in the feed come from the same source.
7. A user who has managed to suppress all sources still receives a non-empty feed.
8. The pipeline run succeeds and produces correct output when the database is
   available.
9. A database failure during the personalization step does not break the default
   unranked feed.

---

## Notes for the Architect

- **Pipeline architecture decision** (per-identity batch files vs. API-time ranking)
  is explicitly delegated here. The PM's constraint is: the client must receive a
  pre-ranked feed from `GET /api/feed/today` without performing any reordering.
- **Suppression threshold constants** (minimum event count, minimum dislike ratio)
  are configurable named constants. The PM's behavioral requirement is that a single
  accidental dislike cannot trigger suppression.
- **Exploration slot count** (`EXPLORATION_SLOTS = 3`) and **positions** (3, 10, 17)
  are configurable constants. Document where they live.
- **Source identity** (slug prefix vs. `sourceName`): the Architect must document
  the canonical join key and ensure consistency between feedback records and article
  data.
- **Suppression reversal**: the data model must not make this impossible. Suppression
  must be derived at runtime from current feedback, not stored as a permanent flag.
- Future milestone note: BRD-004 explicitly defers suppression reversal as a
  user-facing feature. The roadmap should include a backlog item for a "reset
  personalization" or "manage sources" screen.

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-04 | PM Agent | Initial draft. 11 stories written from BRD-004. Open questions on source diversity cap and exploration placement resolved per PM decisions. Pipeline architecture and suppression thresholds flagged as Architect decisions. |
