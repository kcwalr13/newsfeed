# User Stories — Server-Side Feedback Storage (Milestone 2.5)

**Document ID**: stories_server_feedback_v1.md
**Date**: 2026-04-04
**Status**: Draft
**Milestone**: 2.5 — Feedback Durability
**Source BRD**: `agents/ba/requirements_server_feedback_v1.md` (BRD-003)
**Maintained by**: PM Agent

---

## Overview

These stories deliver server-side persistence for feedback signals. When complete,
feedback survives browser data clears and is fetched from the server on every app
load. The FeedbackButtons UI is completely unchanged. localStorage is retained as a
write-through cache and offline fallback.

Stories are ordered by dependency. A story marked **[BLOCKS X, Y]** must be
accepted before those stories can begin.

---

## Story Map (Dependency Order)

```
SFB-001 (Device Identity)
    └── SFB-002 (DB Schema)
            ├── SFB-003 (GET /api/feedback)
            ├── SFB-004 (POST /api/feedback)
            │       └── SFB-006 (Client: write to server on tap)
            │               └── SFB-007 (Offline retry queue)
            ├── SFB-005 (DELETE /api/feedback/[articleId])
            │       └── SFB-006 (Client: write to server on tap)
            ├── SFB-003 + SFB-004 → SFB-008 (POST /api/feedback/migrate)
            │       └── SFB-009 (Client: run migration on first session)
            └── SFB-003 → SFB-010 (Client: load from server on app start)
```

---

## Stories

---

### SFB-001 — Device Identity Initialization

**Priority**: P0
**Blocks**: SFB-002, all stories that follow
**Depends on**: Nothing (no server required)

**Narrative**
As a returning user, I want my feedback to be tied to this specific device so that
my likes and dislikes are restored every time I open the app, even if I reload the
page or clear browser storage.

**Background**
Today there is no stable identity for a device. We need to generate and store a UUID
that persists across sessions and travels with every feedback API request.

**Acceptance Criteria**

- On first visit, a UUID v4 is generated client-side and stored in two places:
  an HTTP cookie named `dd_device_id` and a `localStorage` key named `dd_device_id`.
- The cookie is set with: 1-year expiry (refreshed on each visit), `SameSite=Lax`,
  `Secure` flag in production, and is **not** `HttpOnly` (the client must be able
  to read it).
- On every subsequent visit, the client reads the existing UUID from the cookie
  (primary) or from `localStorage` (fallback if cookie is absent). No new UUID is
  generated if one already exists.
- Every feedback API request includes the device ID in an `X-Device-ID` request
  header in addition to the cookie.
- The device ID is never displayed to the user and does not affect any visible UI.

---

### SFB-002 — Feedback Database Schema

**Priority**: P0
**Blocks**: SFB-003, SFB-004, SFB-005, SFB-008
**Depends on**: SFB-001 (device identity must be understood before schema is finalized)

**Narrative**
As a product that aims to personalize content over time, I need feedback signals
stored in a durable, queryable database so that future personalization features can
use them without migrating or re-architecting storage.

**Background**
This is an infrastructure story for the Architect. The database must exist and be
reachable before any API endpoint can be built. The schema must support a future
`userId` column without requiring a migration when accounts are introduced.

**Acceptance Criteria**

- A PostgreSQL database is provisioned via a managed cloud provider (Supabase or
  Neon). The Architect chooses the specific provider.
- A `feedback` table (or equivalent) exists with the following columns:
  - `deviceId` — string, required
  - `userId` — string, nullable (defaults to null; reserved for Milestone 3)
  - `articleId` — string, required
  - `value` — enum or string constrained to `'like'` or `'dislike'`
  - `updatedAt` — timestamp with timezone
- The combination of `(deviceId, articleId)` is unique — duplicate records for
  the same device and article are not permitted.
- Database connection credentials are stored as environment variables and are never
  committed to the repository.
- The Architect documents the chosen provider and schema DDL in their design doc.

---

### SFB-003 — GET /api/feedback Endpoint

**Priority**: P0
**Blocks**: SFB-010 (client load on app start)
**Depends on**: SFB-002 (database must exist)

**Narrative**
As a user opening the app, I want my previously recorded feedback to be shown
correctly on every article card so I can see which articles I already reacted to,
even after closing and reopening the app.

**Acceptance Criteria**

- `GET /api/feedback` returns a JSON object shaped as
  `Record<articleId, { value: 'like' | 'dislike', updatedAt: string }>` for all
  feedback records associated with the requesting device.
- The device is identified by reading the `dd_device_id` cookie. If the cookie is
  absent, the server falls back to reading the `X-Device-ID` request header.
- If neither the cookie nor the header is present, the endpoint returns an empty
  object `{}` with a 200 status — it does not return an error.
- If the device has no feedback records, the endpoint returns `{}` with a 200 status.
- The response reflects the full feedback history for the device, not just articles
  in the current feed.

---

### SFB-004 — POST /api/feedback Endpoint

**Priority**: P0
**Blocks**: SFB-006 (client write on tap)
**Depends on**: SFB-002 (database must exist)

**Narrative**
As a user tapping thumbs up or thumbs down on an article, I want that signal saved
to the server immediately so it is not lost if I clear my browser storage.

**Acceptance Criteria**

- `POST /api/feedback` accepts a JSON body containing `articleId` (string) and
  `value` (`'like'` or `'dislike'`).
- The server writes or overwrites the record for that `(deviceId, articleId)` pair.
  `updatedAt` is set to the current server time.
- Device identification follows the same cookie-first, header-fallback rule as
  SFB-003. If no device ID is present, the endpoint returns 400.
- A successful write returns 200 or 201 with the saved record.
- If the same `(deviceId, articleId)` record already exists, it is overwritten
  (upsert behavior). No duplicate records are created.
- Invalid `value` fields (anything other than `'like'` or `'dislike'`) return 400.

---

### SFB-005 — DELETE /api/feedback/[articleId] Endpoint

**Priority**: P0
**Blocks**: SFB-006 (client write on tap — clear action)
**Depends on**: SFB-002 (database must exist)

**Narrative**
As a user who taps a feedback button a second time to undo it, I want that removal
to be reflected on the server so my cleared reaction does not reappear unexpectedly
on a future visit.

**Acceptance Criteria**

- `DELETE /api/feedback/[articleId]` removes the feedback record for the given
  `(deviceId, articleId)` pair from the database.
- Device identification follows the same cookie-first, header-fallback rule.
  If no device ID is present, the endpoint returns 400.
- If no matching record exists, the endpoint returns 200 (idempotent — deleting
  a non-existent record is not an error).
- A successful deletion returns 200.
- The record is deleted from the database, not nulled or soft-deleted. Absence of
  a record is the canonical representation of "no feedback."

---

### SFB-006 — Client: Write Feedback to Server on Tap

**Priority**: P0
**Blocks**: SFB-007 (offline queue)
**Depends on**: SFB-004 (POST endpoint), SFB-005 (DELETE endpoint)

**Narrative**
As a user tapping a feedback button, I want the app to feel instant — the button
should respond immediately — while my feedback is also saved to the server in the
background without any noticeable delay.

**Background**
The existing `setFeedback` and `clearFeedback` functions in `lib/feedback/store.ts`
write only to localStorage. This story extends the feedback store to also write to
the server. The FeedbackButtons component itself does not change.

**Acceptance Criteria**

- When `setFeedback(articleId, value)` is called:
  - The localStorage write happens immediately (existing behavior, unchanged).
  - A `POST /api/feedback` call is dispatched in the background with `articleId`,
    `value`, and the `X-Device-ID` header.
  - The UI button state updates immediately without waiting for the server response
    (optimistic update).
- When `clearFeedback(articleId)` is called:
  - The localStorage delete happens immediately (existing behavior, unchanged).
  - A `DELETE /api/feedback/[articleId]` call is dispatched in the background with
    the `X-Device-ID` header.
- If the server request fails, no error is shown to the user. The failure is logged
  silently. The failed write is added to the offline retry queue (see SFB-007).
- The `FeedbackButtons` component source file is not modified as part of this story.

---

### SFB-007 — Offline Retry Queue

**Priority**: P0
**Depends on**: SFB-006 (client write flow must exist before queue can intercept failures)

**Narrative**
As a user who gives feedback while offline or on a flaky connection, I want those
reactions to reach the server once I'm back online, so my feedback history is
complete even when connectivity is interrupted.

**Acceptance Criteria**

- When a server feedback write fails (network error, timeout, or non-2xx response),
  the failed operation is appended to a persistent queue stored in localStorage
  under the key `dd_feedback_queue`.
- Each queue entry records: `articleId`, `value` (or a delete marker), and the
  timestamp when the action was taken.
- When network connectivity is restored (or when the app regains focus), the client
  processes the queue in order — oldest entry first.
- Each pending entry is sent to the appropriate endpoint (`POST` or `DELETE`).
  An entry is removed from the queue only after the server responds with a 2xx status.
- If a drain attempt fails (server still unreachable), the queue is preserved intact
  and drain is retried on the next connectivity or focus event.
- The queue is not shown in any UI. No user-visible indicator of queue size or
  pending writes is displayed.

---

### SFB-008 — POST /api/feedback/migrate Endpoint

**Priority**: P0
**Blocks**: SFB-009 (client migration run)
**Depends on**: SFB-002 (database), SFB-004 (single-record write must already work)

**Narrative**
As a user who has been using the app before server-side feedback launched, I want
my existing feedback history preserved automatically so I do not have to re-rate
articles I already reacted to.

**Background**
This endpoint is the server-side receiver for the one-time bulk migration. It is
called once per device, immediately after the device identity is established on the
user's first post-launch session.

**Acceptance Criteria**

- `POST /api/feedback/migrate` accepts a JSON body containing an array of feedback
  records, each with `articleId`, `value`, and `updatedAt`.
- The server writes all records for the requesting device ID. If a record for a
  given `(deviceId, articleId)` already exists on the server and the incoming record
  has an older `updatedAt`, the existing server record wins (server does not
  regress newer data).
- Device identification follows the same cookie-first, header-fallback rule. If no
  device ID is present, the endpoint returns 400.
- A successful migration returns 200. The response body may confirm the count of
  records written, but no UI depends on this.
- The endpoint is idempotent — calling it multiple times with the same payload
  produces the same server state with no errors.

---

### SFB-009 — Client: Run One-Time Migration on First Post-Launch Session

**Priority**: P0
**Depends on**: SFB-001 (device identity), SFB-008 (migrate endpoint)

**Narrative**
As a user who has been using the app for weeks, I want my existing likes and
dislikes to silently carry over to server storage the first time I open the updated
app, so nothing is lost and I do not have to do anything.

**Acceptance Criteria**

- On app load, before calling `GET /api/feedback`, the client checks localStorage
  for a flag named `dd_feedback_migrated`.
- If the flag is absent and localStorage contains one or more feedback records
  under `dd_feedback`, the client calls `POST /api/feedback/migrate` with the
  full contents of the local feedback store.
- After a successful 2xx response, the client sets `dd_feedback_migrated = 'true'`
  in localStorage. The migration call does not run again on any subsequent session.
- If the migration call fails, the flag is not set and the migration will be
  attempted again on the next session.
- If localStorage contains no feedback records, the migration call is skipped
  entirely and the flag is set immediately to avoid unnecessary future checks.
- The migration is invisible to the user. No loading indicator, toast, or
  confirmation message is shown.

---

### SFB-010 — Client: Load Feedback from Server on App Start

**Priority**: P0
**Depends on**: SFB-001 (device identity), SFB-003 (GET endpoint), SFB-009 (migration
should run before load so server state is complete)

**Narrative**
As a user opening the app, I want the like and dislike buttons on every article
to reflect my actual feedback history — including reactions I gave on a previous
visit — so I always see an accurate picture of what I have already rated.

**Acceptance Criteria**

- On app load (after migration check, see SFB-009), the client calls
  `GET /api/feedback` with the `X-Device-ID` header set.
- The response is merged into the in-memory feedback store. Server state wins over
  any locally cached state for any article where both exist.
- The feed does not block rendering while the `GET /api/feedback` call is in flight.
  Article cards render immediately; button states update once the response arrives.
- If `GET /api/feedback` fails (network error or server error), the client falls
  back to reading the local `dd_feedback` key from localStorage and uses that as
  the initial state. No error message is shown.
- If no device ID cookie exists yet, the `GET` call is skipped and the store is
  initialized from localStorage only.

---

## Story Summary Table

| Story ID | Title | Priority | Depends On | Blocks |
|----------|-------|----------|------------|--------|
| SFB-001 | Device Identity Initialization | P0 | — | All others |
| SFB-002 | Feedback Database Schema | P0 | SFB-001 | SFB-003, 004, 005, 008 |
| SFB-003 | GET /api/feedback Endpoint | P0 | SFB-002 | SFB-010 |
| SFB-004 | POST /api/feedback Endpoint | P0 | SFB-002 | SFB-006, SFB-008 |
| SFB-005 | DELETE /api/feedback/[articleId] Endpoint | P0 | SFB-002 | SFB-006 |
| SFB-006 | Client: Write Feedback to Server on Tap | P0 | SFB-004, SFB-005 | SFB-007 |
| SFB-007 | Offline Retry Queue | P0 | SFB-006 | — |
| SFB-008 | POST /api/feedback/migrate Endpoint | P0 | SFB-002, SFB-004 | SFB-009 |
| SFB-009 | Client: Run One-Time Migration | P0 | SFB-001, SFB-008 | SFB-010 |
| SFB-010 | Client: Load Feedback from Server on App Start | P0 | SFB-001, SFB-003, SFB-009 | — |

---

## Definition of Done (Milestone 2.5)

All ten stories are accepted when:

1. A user can give feedback on an article and the record appears in the database.
2. A user who clears localStorage and reloads the app still sees their previous
   feedback correctly reflected on article cards.
3. A user who gave feedback before this milestone shipped has that feedback
   automatically present in the database on their first post-launch session.
4. A user who gives feedback while offline sees it uploaded to the server once
   connectivity is restored.
5. None of the above produces any visible change to the FeedbackButtons UI.

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-04 | PM Agent | Initial draft. 10 stories written from BRD-003. |
