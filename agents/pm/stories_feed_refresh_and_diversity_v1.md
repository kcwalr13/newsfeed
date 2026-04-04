# User Stories — Feed Refresh and Source Diversity (Milestone 5)

**Document ID**: stories_feed_refresh_and_diversity_v1.md
**Date**: 2026-04-04
**Status**: Draft
**Milestone**: 5 — Feed Refresh and Source Diversity
**Source BRD**: `agents/ba/brd_feed_refresh_and_diversity_v1.md` (BRD-005)
**Maintained by**: PM Agent

---

## Overview

These stories deliver two related improvements to the content pipeline: a manual
refresh capability for authenticated users, and a source diversity guarantee that
applies to every pipeline run (scheduled or manually triggered).

Manual refresh gives engaged users control over content freshness without changing
the once-daily scheduled cadence. The diversity guarantee ensures every batch is
drawn from at least 3 distinct active sources and that no single source can crowd
out the rest. Both changes apply to the same pipeline execution path, so they are
scoped together in one milestone.

All stories depend on user authentication (Milestone 3) and feed personalization
(Milestone 4) being shipped.

---

## Open Question Resolutions (PM Decisions)

BRD-005 raised six open questions. Product-level questions are resolved here.
Architecture-level questions are flagged for the Architect.

### 1. Refresh Cooldown Duration — PM Decision

**Decision**: 15 minutes between manual refresh requests per authenticated user.

**Rationale**: 15 minutes balances responsiveness (a user who encounters a
mid-afternoon news event does not have to wait long) with protection against
rapid-fire API cost spikes. The cooldown must be stored as a configurable constant,
not hardcoded, so it can be tuned post-launch without a code deploy.

### 2. Minimum Distinct Sources per Batch — PM Decision

**Decision**: At least 3 active sources must contribute at least 1 article each
to a valid batch.

**Rationale**: With 4 active sources currently configured, requiring 3 of 4 to
contribute ensures genuine multi-source diversity while leaving a one-source
failure margin. The value must be a configurable constant so it adjusts naturally
if the source list grows or shrinks.

### 3. Per-Source Article Cap — PM Decision

**Decision**: No single source may contribute more than 5 articles to one batch.

**Rationale**: With a target batch of ~20 articles across 4 sources, 5 per source
is an equal split. This is a ceiling: a source may contribute fewer (if it has
fewer usable articles after deduplication), but never more. The cap is enforced
after deduplication. This value must be a configurable constant.

### 4. Who Can Trigger a Manual Refresh — PM Decision

**Decision**: All authenticated users may trigger a manual refresh. No role
distinction is applied at this stage.

**Rationale**: The product does not yet have a role system. All authenticated
users are equivalent. If an admin-only gate is needed in the future, that is a
future story.

### 5. Anonymous User Experience During a Refresh — PM Decision

**Decision**: Anonymous users do not see the refresh button and are unaffected
by a refresh in progress. They continue to see the most recently written shared
batch. If a shared (non-personalized) batch is updated mid-day by a manual
refresh, anonymous users will see the new batch on their next page load. No
special handling is required.

**Rationale**: This is the simplest consistent behavior and requires no
per-identity gating for anonymous sessions.

### 6. Operator Refresh Activity Logging — PM Decision

**Decision**: Manual refresh events should be logged (timestamp + user ID) as
part of normal server-side logging. A dedicated operator-facing dashboard is out
of scope for M5 but this backlog item is noted below.

---

## Dependency Order

```
REFRESH-001 (Refresh Cooldown — Configuration)
    └── REFRESH-003 (Manual Refresh API Endpoint)
            └── REFRESH-004 (Refresh Enforces Diversity)
            └── REFRESH-005 (Refresh Failure Behavior)

REFRESH-002 (Last-Updated Timestamp — Pipeline writes it)
    └── REFRESH-006 (Feed UI — Last Updated Label)
    └── REFRESH-007 (Feed UI — Refresh Button for Authenticated Users)
            └── depends on REFRESH-003

REFRESH-008 (Source Diversity — Configurable Minimums)
    └── REFRESH-009 (Per-Source Article Cap)
            └── REFRESH-010 (Source Failure Isolation)
                    └── REFRESH-011 (Degraded-Mode Logging)
```

Stories marked **[BLOCKS X]** must be accepted before those stories can begin.

---

## Stories

---

### REFRESH-001 — Refresh Cooldown Configuration

**Priority**: Must Have
**Blocks**: REFRESH-003
**Depends on**: —

**As a** system operator,
**I want** the manual refresh cooldown duration to be a named configuration
constant rather than a hardcoded value,
**so that** the cooldown can be adjusted post-launch without a code change if
usage patterns or API cost targets change.

#### Acceptance Criteria

- A configuration constant `REFRESH_COOLDOWN_MINUTES` exists in the codebase at
  a location the Architect designates (e.g., `lib/config.ts` or an environment
  variable).
- The default value is `15` (minutes).
- The cooldown enforcement logic in REFRESH-003 reads from this constant; the
  value is not duplicated inline.
- The Architect documents where this constant lives and how to change it.

---

### REFRESH-002 — Pipeline Writes Last-Updated Timestamp

**Priority**: Must Have
**Blocks**: REFRESH-006
**Depends on**: —

**As a** user viewing the feed,
**I want** the system to record when the feed was last refreshed,
**so that** the UI can show me an accurate "last updated" label and I can make
an informed decision about whether to trigger a manual refresh.

#### Acceptance Criteria

- Every pipeline run (scheduled or manually triggered) writes a timestamp
  representing when the run completed successfully.
- The timestamp is accessible to the `GET /api/feed/today` response or a
  dedicated endpoint, at the Architect's discretion.
- The timestamp is recorded in the user's local timezone context at display time
  (the stored value should be UTC; formatting to local time is a client
  responsibility).
- If the pipeline has never run (no batch exists), no timestamp is present and
  the UI handles this gracefully (see REFRESH-006).
- The timestamp is updated on every successful pipeline completion, including
  manually triggered runs.

---

### REFRESH-003 — Manual Refresh API Endpoint

**Priority**: Must Have
**Blocks**: REFRESH-004, REFRESH-005, REFRESH-007
**Depends on**: REFRESH-001, AUTH-010 (Milestone 3 — session client integration)

**As an** authenticated user,
**I want** to trigger a new pipeline run on demand via the app,
**so that** I can get a fresh set of articles without waiting for the next
scheduled run.

#### Acceptance Criteria

- A new API endpoint (e.g., `POST /api/feed/refresh`) accepts requests from
  authenticated users only. Unauthenticated requests receive a 401 response.
- When called by an authenticated user who last triggered a refresh more than
  `REFRESH_COOLDOWN_MINUTES` ago (or who has never triggered one), the endpoint
  initiates a pipeline run and returns success once the run completes.
- When called by an authenticated user within the cooldown window, the endpoint
  returns an appropriate response (e.g., HTTP 429) indicating when the next
  refresh will be available. The body includes a machine-readable value (e.g.,
  seconds remaining) so the client can display accurate messaging.
- The pipeline run triggered by this endpoint is the same pipeline that runs on
  the scheduled cadence. It applies the same source fetching, deduplication,
  personalization, and diversity rules (REFRESH-004).
- The cooldown is tracked per authenticated user (not per device). Logging in
  from a different device does not reset or bypass the cooldown.
- Every manual refresh event is logged with the timestamp and the authenticated
  user ID for operator visibility.

---

### REFRESH-004 — Manual Refresh Applies Full Pipeline Rules

**Priority**: Must Have
**Blocks**: —
**Depends on**: REFRESH-003

**As a** user who triggers a manual refresh,
**I want** the resulting feed to be produced by the same rules as the daily
scheduled run,
**so that** manually refreshed content meets the same quality, personalization,
and diversity standards as the automatically generated feed.

#### Acceptance Criteria

- A manually triggered run executes the same source-fetch, deduplication,
  personalization, and diversity steps as the scheduled pipeline. No steps are
  skipped or short-circuited for manual runs.
- The diversity requirements from REFRESH-009 and REFRESH-010 apply to the
  batch produced by a manual run.
- If personalization (Milestone 4) is active for the requesting user, the
  manually refreshed feed is personalized using that user's current feedback
  history at the time of the run.
- Multiple pipeline outputs from the same day (one scheduled, one or more manual)
  do not collide or corrupt each other. The Architect documents how co-day
  outputs are stored and which one `GET /api/feed/today` serves. The PM's
  requirement is that the most recently completed run's output is what the client
  receives.

---

### REFRESH-005 — Manual Refresh Failure Behavior

**Priority**: Must Have
**Blocks**: —
**Depends on**: REFRESH-003

**As an** authenticated user who triggers a manual refresh when sources are
unavailable,
**I want** to see an error message and continue seeing my existing feed,
**so that** a failed refresh never leaves me with a blank or broken experience.

#### Acceptance Criteria

- If the pipeline run triggered by a manual refresh fails (e.g., all sources
  are unreachable, or an internal error occurs), the API endpoint returns an
  error response to the client.
- The existing feed content (the most recently successful batch) remains visible
  to the user. The feed does not go blank or show an empty state on a failed
  refresh.
- The client displays a human-readable error message (e.g., "Refresh failed.
  Please try again later.") when the refresh endpoint returns an error.
- A failed manual refresh does not consume the user's cooldown. They may try
  again immediately.
- The failure is logged server-side with the timestamp, user ID, and error
  reason.

---

### REFRESH-006 — Feed UI — Last Updated Label

**Priority**: Must Have
**Blocks**: —
**Depends on**: REFRESH-002

**As a** user viewing the feed,
**I want** to see when the feed was last refreshed,
**so that** I know whether the content is likely to be fresh or stale before
deciding to trigger a manual refresh.

#### Acceptance Criteria

- The feed page displays a "Last updated" label showing the time of the most
  recent successful pipeline run (e.g., "Last updated today at 2:34 PM").
- The timestamp is formatted in the user's local timezone using the browser's
  locale. The server provides a UTC timestamp; the client formats it.
- If the timestamp indicates the feed was updated today, the label shows time
  only (e.g., "today at 2:34 PM"). If it was updated on a prior day, the label
  includes the date (e.g., "April 3 at 11:00 PM"). The exact format is a UI
  implementation detail but must clearly communicate recency.
- If no timestamp is available (feed has never been generated), the label is
  omitted rather than showing a fallback like "unknown" or a raw null value.
- The label is visible to all users (authenticated and anonymous). It is not
  hidden behind the auth gate.
- The label updates to reflect the new timestamp after a successful manual
  refresh without requiring a full page reload.

---

### REFRESH-007 — Feed UI — Manual Refresh Button

**Priority**: Must Have
**Blocks**: —
**Depends on**: REFRESH-003, REFRESH-006

**As an** authenticated user,
**I want** a visible button in the feed UI that lets me trigger a fresh pipeline
run,
**so that** I can get updated articles mid-day without navigating away from the
feed or waiting for the next scheduled run.

#### Acceptance Criteria

- A "Refresh" button (or equivalent control) is visible in the feed UI when the
  user is authenticated. It is not rendered at all for unauthenticated (anonymous)
  users.
- Tapping the button calls the refresh endpoint (REFRESH-003) and shows a
  loading state while the pipeline run is in progress. The feed remains visible
  during the loading state; it is not replaced with a spinner that hides
  existing content.
- On success, the feed updates to show the newly fetched articles and the "Last
  updated" label (REFRESH-006) reflects the new timestamp.
- On failure, the button returns to its default state and displays an error
  message (per REFRESH-005). The existing feed remains visible.
- While the user is within the cooldown window (i.e., they triggered a refresh
  recently), the button is disabled or visually indicates that a refresh is not
  yet available. The UI communicates when the next refresh will be available
  (e.g., "Refresh available in 12 minutes").
- Once the cooldown expires, the button re-enables automatically without
  requiring a page reload.
- The button and its states are accessible: it has a descriptive label for
  screen readers and respects the user's reduced-motion preference for any
  loading animation.

---

### REFRESH-008 — Source Diversity — Configurable Minimum Sources

**Priority**: Must Have
**Blocks**: REFRESH-009, REFRESH-010
**Depends on**: —

**As a** system operator,
**I want** the minimum number of distinct active sources required per batch to be
a named configuration constant,
**so that** the diversity floor can be tuned as the source list grows or shrinks
without a code change.

#### Acceptance Criteria

- A configuration constant `MIN_SOURCES_PER_BATCH` exists in the codebase.
- The default value is `3`.
- The pipeline's diversity enforcement logic (REFRESH-009 and REFRESH-010) reads
  this constant; the value is not duplicated inline.
- The Architect documents where this constant lives alongside `REFRESH_COOLDOWN_MINUTES`
  and the per-source cap constant from REFRESH-009.

---

### REFRESH-009 — Per-Source Article Cap

**Priority**: Must Have
**Blocks**: REFRESH-010
**Depends on**: REFRESH-008

**As a** user of the feed,
**I want** no single source to contribute more than a capped number of articles
to any batch,
**so that** a high-volume or prolific source cannot crowd out the others and the
feed consistently represents multiple outlets.

#### Acceptance Criteria

- A configuration constant `MAX_ARTICLES_PER_SOURCE` exists in the codebase.
- The default value is `5`.
- After the pipeline fetches articles from all active sources and runs
  deduplication, any source that produced more than `MAX_ARTICLES_PER_SOURCE`
  unique articles has its excess articles discarded before the batch is assembled.
  The selection of which articles are kept (e.g., most recent, highest relevance)
  is an Architect decision.
- The cap is applied after deduplication. An article that was deduplicated away
  does not count toward the source's cap.
- A source that contributes fewer than `MAX_ARTICLES_PER_SOURCE` articles is
  unaffected. The cap is a ceiling, not a target.
- The total article count in the batch is unaffected by capping in the expected
  case (other sources fill the remaining slots). If capping a dominant source
  reduces total article count below `ARTICLES_PER_DAY` and no other source has
  articles to contribute, the batch is assembled with whatever is available.

---

### REFRESH-010 — Source Failure Isolation

**Priority**: Must Have
**Blocks**: REFRESH-011
**Depends on**: REFRESH-008, REFRESH-009

**As a** system operator,
**I want** the pipeline to continue running when an individual source fails to
return articles,
**so that** a single unavailable source does not cause the entire run to fail
and leave users with no content.

#### Acceptance Criteria

- If a source fails to return any usable articles (network error, API rate limit,
  empty response, or invalid response), the pipeline logs the failure and
  continues fetching from the remaining active sources. The pipeline does not
  abort on a single-source failure.
- All active sources are attempted in every run. A prior failure does not cause
  a source to be skipped in subsequent steps of the same run.
- After all sources are attempted, the pipeline checks whether `MIN_SOURCES_PER_BATCH`
  sources contributed at least one article each. If so, the batch proceeds to
  assembly normally.
- If fewer than `MIN_SOURCES_PER_BATCH` sources contributed (diversity minimum
  cannot be met), the pipeline produces a batch from whatever is available rather
  than generating an empty feed. This degraded-mode behavior is subject to
  REFRESH-011.
- Article deduplication (cross-source) proceeds on whatever articles were
  successfully fetched. Deduplication does not fail because one source had zero
  articles.

---

### REFRESH-011 — Degraded-Mode Diversity Warning

**Priority**: Must Have
**Blocks**: —
**Depends on**: REFRESH-010

**As a** system operator,
**I want** the pipeline to log a warning when a batch is produced without meeting
the minimum source diversity requirement,
**so that** I can detect persistent source failures before users are noticeably
impacted.

#### Acceptance Criteria

- When the pipeline completes a run with fewer contributing sources than
  `MIN_SOURCES_PER_BATCH`, a warning-level log entry is written. The log entry
  includes: the run timestamp, the number of sources that contributed, the names
  of the sources that contributed, and the names of the sources that failed or
  returned no articles.
- The warning does not prevent the batch from being written and served. Users
  receive a degraded but non-empty feed.
- The warning is distinct from a per-source failure log (REFRESH-010). A
  per-source failure is logged at the time it occurs; the degraded-mode warning
  is logged at the end of the run when the final contributing source count is
  known.
- No user-facing message is shown indicating that diversity requirements were
  not met. The degraded experience is silent from the user's perspective.
- A run that meets or exceeds `MIN_SOURCES_PER_BATCH` does not emit the warning,
  even if one or more individual sources failed (as long as enough succeeded).

---

## Story Summary Table

| Story ID | Title | Priority | Depends On | Blocks |
|----------|-------|----------|------------|--------|
| REFRESH-001 | Refresh Cooldown Configuration | Must Have | — | REFRESH-003 |
| REFRESH-002 | Pipeline Writes Last-Updated Timestamp | Must Have | — | REFRESH-006 |
| REFRESH-003 | Manual Refresh API Endpoint | Must Have | REFRESH-001, AUTH-010 | REFRESH-004, REFRESH-005, REFRESH-007 |
| REFRESH-004 | Manual Refresh Applies Full Pipeline Rules | Must Have | REFRESH-003 | — |
| REFRESH-005 | Manual Refresh Failure Behavior | Must Have | REFRESH-003 | — |
| REFRESH-006 | Feed UI — Last Updated Label | Must Have | REFRESH-002 | — |
| REFRESH-007 | Feed UI — Manual Refresh Button | Must Have | REFRESH-003, REFRESH-006 | — |
| REFRESH-008 | Source Diversity — Configurable Minimum Sources | Must Have | — | REFRESH-009, REFRESH-010 |
| REFRESH-009 | Per-Source Article Cap | Must Have | REFRESH-008 | REFRESH-010 |
| REFRESH-010 | Source Failure Isolation | Must Have | REFRESH-008, REFRESH-009 | REFRESH-011 |
| REFRESH-011 | Degraded-Mode Diversity Warning | Must Have | REFRESH-010 | — |

All 11 stories are Must Have. There are no Should Have or Nice to Have stories in
this milestone; scope was kept tight per the BRD's explicit non-goals (no real-time
streaming, no push notifications, no source management UI).

---

## Definition of Done (Milestone 5)

All Must Have stories are accepted when:

1. An authenticated user can tap a "Refresh" button in the feed and receive a
   new batch of articles without waiting for the next scheduled pipeline run.
2. The refresh button is not visible to unauthenticated users.
3. A user who triggers two refreshes in quick succession is blocked on the second
   attempt and sees a message indicating when the next refresh will be available.
4. After a successful refresh, the "Last updated" label shows the correct new
   time.
5. If all sources are unreachable and the refresh fails, the existing feed remains
   visible and the user sees an error message. A failed refresh does not consume
   the user's cooldown.
6. Every pipeline batch — scheduled or manual — draws articles from at least 3
   distinct active sources.
7. No single source contributes more than 5 articles to any batch.
8. If one source fails during a run, the pipeline continues and produces a batch
   from the remaining sources. The run does not abort.
9. If fewer than 3 sources contribute to a batch, a warning is logged but the
   batch is still written and served.
10. All new configuration constants (`REFRESH_COOLDOWN_MINUTES`, `MIN_SOURCES_PER_BATCH`,
    `MAX_ARTICLES_PER_SOURCE`) are documented and confirmed configurable without
    a code change.

---

## Notes for the Architect

- **Cooldown storage**: The per-user cooldown state (last refresh timestamp) must
  survive server restarts. In-memory storage is insufficient. The Architect decides
  the storage mechanism (database row, cache layer, etc.).
- **Co-day batch management**: A manual refresh on the same day as the scheduled
  run creates two pipeline outputs. The Architect must document how these are
  stored and which one `GET /api/feed/today` serves. The PM's requirement is that
  the most recent successful run's output is served.
- **Personalization interaction**: A manually triggered run should apply the same
  personalization logic as a scheduled run. The Architect must confirm there are
  no edge cases when both a scheduled and a manual run complete on the same day
  (e.g., which per-identity batch file wins, if per-identity batch files are the
  chosen architecture).
- **Refresh endpoint latency**: The pipeline run may take several seconds. The
  Architect should consider whether the refresh endpoint should return
  synchronously (wait for completion) or asynchronously (return immediately,
  poll for result). The PM's requirement is that the client knows when the run
  completes so it can reload the feed.
- **Configuration constant location**: All three new constants should live in the
  same place as existing pipeline constants. The Architect documents this location
  in the design doc.

---

## Deferred / Out of Scope Items

The following were explicitly excluded from BRD-005 and are not stories in this
milestone. They are recorded here so they are not lost.

| Item | Rationale for Deferral | Suggested Future Milestone |
|------|------------------------|---------------------------|
| Adding or removing sources via UI | Source management is a separate capability; current source list is config-driven | Future |
| Real-time streaming of articles | Pipeline remains batch-based | Future |
| Per-source article cap adjustable by users via UI | System-level config only for now | Future |
| Scheduled pipeline cadence changes | Once-daily schedule unchanged | Future |
| Push notifications when background refresh completes | Out of scope per BRD | Future |
| Operator dashboard for refresh activity | Logging is sufficient for M5; dashboard deferred | Future |

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-04 | PM Agent | Initial draft. 11 stories written from BRD-005. Open questions on cooldown (15 min), minimum sources (3), per-source cap (5), role gating (all authenticated), anonymous behavior, and operator logging all resolved per PM decisions. Pipeline architecture and cooldown storage flagged as Architect decisions. |
