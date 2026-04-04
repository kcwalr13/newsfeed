# BRD-003: Server-Side Feedback Storage with Anonymous Device Identity

| Field | Value |
|-------|-------|
| **ID** | BRD-003 |
| **Title** | Server-Side Feedback Storage with Anonymous Device Identity |
| **Date** | 2026-04-04 |
| **Status** | Resolved |
| **Supersedes** | BRD-002 (persistence section only — UI and feedback behavior are unchanged) |
| **Milestone** | Milestone 2.5 — Feedback Durability |

---

## Problem Statement

Feedback (likes and dislikes) is currently stored only in the browser's `localStorage`.
This has two concrete failure modes:

1. **Data loss on browser clear.** If a user clears their browser storage, all feedback
   history is gone permanently. There is no recovery path.
2. **No cross-device continuity.** A user who switches from desktop to mobile (or
   reinstalls the app) starts with a blank slate. The personalization signal built up
   on one device is invisible to all others.

Both failures become worse over time. Feedback is designed to accumulate indefinitely
as the primary input to future personalization. Losing that signal, or fragmenting it
across devices, degrades the product's core value proposition.

The fix at this stage is not full user accounts — it is moving feedback writes to a
server-side store, keyed by a stable anonymous device identifier. This makes feedback
durable against browser clears and lays the structural foundation for associating
signals with a real user identity later, without any data migration.

---

## Goals

- Feedback writes are persisted server-side, so they survive browser data clears.
- Each device is assigned a stable anonymous identifier (UUID) on first visit. No
  login, email, or password is required.
- The server-side feedback schema accommodates a future `userId` field so that when
  accounts are introduced, device feedback can be linked to a user without migrating
  or re-keying records.
- The existing `FeedbackButtons` UI is completely unchanged. This feature is invisible
  to the user.
- When the app loads, feedback state for the current feed is fetched from the server
  and reflects the full history for that device.
- Feedback stored in `localStorage` by existing users is migrated to the server on
  their next session. No existing feedback signal is silently discarded.
- A failed feedback write does not produce visible errors. The UI remains responsive.

---

## Non-Goals

The following are explicitly out of scope for this BRD and must not be included:

- **User accounts, login, or registration.** No email, password, OAuth, or session
  tokens. The device ID is the only identity mechanism here.
- **Cross-device sync UI.** There is no UI surface for linking devices or viewing
  feedback across them. Sync is a byproduct of accounts, which is deferred.
- **Cross-device feedback merging.** If a user has given feedback on Device A and
  Device B, there is no automatic merge. Each device ID has its own independent
  feedback history until accounts associate them.
- **Analytics dashboards or aggregate reporting.** No operator-facing views of
  feedback data.
- **Feed personalization.** Using feedback signals to reorder or filter the feed
  remains deferred (roadmap items FUTURE-002 and FUTURE-003).
- **Source or topic weighting.** Aggregating signals into scores is downstream work.
- **Social features.** Feedback is private and per-device. No sharing or public signals.
- **Offline write queuing.** A retry queue is in scope for this milestone. See
  Decisions below for the approach.
- **Deleting or exporting feedback.** No user-facing data management tools.

---

## Device Identity Model

### How the device ID is assigned

On first visit, the client generates a UUID v4 and stores it locally. Every subsequent
feedback write and read from that device includes this ID. There is no server-side
ID issuance step — the client is authoritative for its own identity.

### Cookie vs. localStorage: the decision

The device ID must be stored in an **HTTP cookie** (not `localStorage`), for one
specific reason: cookies are sent automatically with every API request by the browser,
which means the server can always read the device ID without the client explicitly
passing it in each call. This simplifies the feedback write endpoint and makes the
device ID available to server-side rendering if needed in future milestones.

`localStorage` alone is insufficient for this role because it is inaccessible outside
the browser JavaScript context — it cannot ride along with server requests.

**Decision: dual storage — cookie primary, `localStorage` secondary, `X-Device-ID` header as belt-and-suspenders.**

The device ID is stored in both an HTTP cookie (`dd_device_id`) and in `localStorage`
(`dd_device_id`). On every API request, the client also sends the device ID explicitly
in an `X-Device-ID` request header. The server reads the device ID from whichever
of the three sources is available, preferring cookie → header → none.

Rationale: installed PWAs on iOS Safari and some Android browsers have historically
exhibited inconsistent or shortened cookie lifetimes. Storing the device ID in
`localStorage` as well ensures it survives across sessions even when the cookie is
reset by the platform. Sending it as an explicit header removes any ambiguity on the
server side — the server never has to guess or infer identity from partial signals.
This approach is the most robust across browser, PWA-installed, and future
server-side-rendering contexts, and adds negligible complexity.

Cookie configuration:
- **Name**: `dd_device_id`
- **Value**: UUID v4 string
- **Expiry**: Far-future (1 year, refreshed on each visit)
- **Flags**: `SameSite=Lax`; `Secure` in production; **not** `HttpOnly` (client must
  be able to read it for migration and for detecting first-visit state)

`localStorage` key: `dd_device_id` (same name, separate namespace from the cookie).

Request header: `X-Device-ID: <uuid>` sent on all feedback API calls.

### Lifetime expectations

The device ID is permanent for as long as the cookie persists. If a user clears
cookies, a new UUID is generated on the next visit and the device starts a fresh
feedback history. This is acceptable — cookie clears are rarer and more deliberate
than localStorage clears. Feedback durability against accidental data loss is
satisfied. Durability against intentional data deletion is not a goal.

---

## Feedback Write Flow

When a user taps thumbs up or thumbs down on any article:

1. The `FeedbackButtons` component calls the existing feedback store interface
   (unchanged externally). Internally, the store now sends a write to the server.
2. The server endpoint receives the device ID (from the cookie), the article ID, and
   the new feedback value (`like`, `dislike`, or `cleared`). It writes the record
   to the server-side store.
3. **While the request is in flight**: the UI updates immediately (optimistic update).
   The button state reflects the user's tap without waiting for the server response.
   This matches the current zero-latency feel of the localStorage implementation.
4. **If the server write succeeds**: no further action. The server is now the source
   of truth.
5. **If the server write fails**: the optimistic UI state remains. The failure is
   logged silently. No error toast or retry prompt is shown to the user. The write
   is not retried automatically in this milestone (see Open Questions).

**Offline / failed write handling — retry queue (in scope):**

If the server write fails (network offline, server error, or timeout), the write
is added to a persistent retry queue stored in `localStorage` under a key such as
`dd_feedback_queue`. The queue is a list of pending write operations (article ID,
value, timestamp). On the next successful network request (or on app focus), the
client drains the queue by replaying each pending write to the server in order.

This ensures that feedback given while offline is not permanently lost and reaches
the server once connectivity is restored. The queue is bounded by the number of
feedback actions taken offline — in practice a handful at most. Items are removed
from the queue only after the server confirms the write with a 2xx response.

Note: the `localStorage` store is kept as a write-through cache alongside the server
write (see "Relationship to Existing localStorage Implementation" below). This means
a server write failure does not result in a blank UI on reload — the cached value
in localStorage will serve as the fallback on next load.

---

## Feedback Read Flow

When the app loads and fetches today's feed, the client needs to know the current
feedback state for each article in order to render the correct button states.

### The problem

Fetching feedback one article at a time (one request per card) is not viable — a
feed of 20 articles would generate 20 sequential or parallel requests on every page
load.

### The approach: bulk read by device ID

A single endpoint accepts the device ID (from the cookie) and returns all feedback
records for that device as a flat map keyed by `articleId`. This mirrors the shape
of the existing `FeedbackStore` type (`Record<articleId, FeedbackRecord>`). The
client replaces its in-memory state with the server response on load.

The client does not filter this map by the current feed — it fetches the full history.
This is intentional: the feedback store is small (a few hundred records at most over
years of use), the overhead is negligible, and having the full history in memory
supports future features (e.g., personalization signals) without a second fetch.

### Load sequence

1. App loads; cookie is read to obtain `dd_device_id`.
2. Client calls `GET /api/feedback` (authenticated by cookie). If no cookie exists
   yet, the call is skipped and the store is initialized empty.
3. Server returns the full feedback map for that device.
4. Client merges server state into the local store. Server state wins in any conflict
   (server is the source of truth for existing records).
5. Feed renders with correct button states.

### Fallback

If the `GET /api/feedback` call fails (network error, server error), the client falls
back to reading `localStorage` and renders whatever state it has cached locally.
The page does not block or show an error.

---

## Server Storage Requirements

### Record shape

Each feedback record on the server must contain the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `deviceId` | string (UUID) | The anonymous device identifier from the cookie |
| `userId` | string or null | Reserved for future account association. Null until accounts exist. |
| `articleId` | string | Article ID (e.g., `bbc-news-a1b2c3d4`) |
| `value` | `'like'` or `'dislike'` | The feedback signal |
| `updatedAt` | ISO-8601 string | When the record was last created or changed |

When feedback is cleared by the user, the record is deleted from the server store
(matching the existing localStorage behavior: absence of a record means "no feedback").

### Future-proofing for accounts

The `userId` field is present from the start and defaults to `null`. When user accounts
are introduced (Milestone 3), an association step can write a real `userId` into
existing records for all `deviceId` values that the user claims ownership of. No
schema migration is needed — the column is already there.

### Server-side storage technology

**Decision: PostgreSQL via a managed cloud provider (e.g. Supabase or Neon).**

The rationale is rooted in the long-term personalization goal. Feedback data will
eventually need to:
- Be queried in aggregate across many users and articles (e.g. "what topics does
  this user like?", "which sources have the highest dislike rate?")
- Join against article metadata for content scoring
- Support complex ranking and weighting queries as the personalization engine matures
- Scale to high write volumes as the user base grows

A relational database with a proper schema is the right foundation for this. A
key-value store or filesystem approach would require costly migrations once
personalization queries grow complex. PostgreSQL specifically is chosen because:
- It handles structured queries, indexes, and aggregations natively
- Managed providers (Supabase, Neon) offer free tiers suitable for early development
  and scale gracefully without infrastructure management
- The `userId` foreign key relationship (future Milestone 3) is a natural fit for
  a relational model
- Full-text and JSON column support provides flexibility for future signal types

The Architect will determine the specific provider and schema DDL. The BA
requirement is: use a relational database capable of serving the long-term
personalization ambition, not just the immediate feedback storage need.

---

## Relationship to Existing localStorage Implementation

**Decision: localStorage is kept as a write-through cache, not removed.**

On every feedback write, the client writes to both the server and to `localStorage`
(the existing `dd_feedback` key, unchanged). On every load, the server response is
the authoritative state; `localStorage` serves as a fallback if the server is
unreachable.

This is the most conservative path:
- No regression in offline or degraded-network behavior.
- No need to remove or deprecate existing code immediately.
- The fallback gives users a seamless experience even during a server outage.

`localStorage` is not the source of truth in this milestone. The server is. But
`localStorage` is a useful resilience layer and its removal is deferred.

---

## Migration: Existing localStorage Feedback

Users who have given feedback prior to this feature shipping have records stored only
in `localStorage` under the `dd_feedback` key. This data must not be silently lost.

### Migration approach: first-visit upload

On the session immediately following the feature launch:

1. The client reads the cookie. If `dd_device_id` is absent, a UUID is generated and
   set. This is a first-time visitor or a returning visitor who is being onboarded to
   device identity for the first time.
2. Before calling `GET /api/feedback`, the client reads `localStorage`. If it contains
   any feedback records under `dd_feedback`, it submits them in a single bulk upload
   call to the server (`POST /api/feedback/migrate` or an equivalent endpoint).
3. The server writes all records for that device ID. Duplicates (if any) are
   overwritten by the newer `updatedAt` value.
4. The client sets a flag in `localStorage` (e.g., `dd_feedback_migrated = true`) to
   prevent the migration upload from running again on subsequent visits.

### What is not migrated

If the user clears `localStorage` before the migration runs, their pre-existing
feedback is unrecoverable. This is acceptable — it is the same data loss that existed
before this feature. The migration only applies to feedback that still exists in
localStorage at the time of the first post-launch session.

---

## New API Endpoints Required

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/feedback` | Returns all feedback records for the requesting device (identified by cookie) |
| `POST` | `/api/feedback` | Writes or overwrites a single feedback record for the requesting device |
| `DELETE` | `/api/feedback/[articleId]` | Removes a single feedback record for the requesting device |
| `POST` | `/api/feedback/migrate` | Accepts a bulk payload of existing records for one-time migration from localStorage |

All endpoints identify the device via the `dd_device_id` cookie. No Authorization
header or token is required.

---

## Decisions (Resolved 2026-04-04)

1. **Storage technology: PostgreSQL via managed cloud provider.**
   The long-term goal is a sophisticated, high-volume personalization engine. A
   relational database is the correct foundation — it supports aggregate queries,
   joins against article metadata, complex scoring, and scales without re-architecture.
   PostgreSQL (via Supabase or Neon) is chosen for its query power, managed
   infrastructure, and natural fit with the future `userId` foreign key relationship.
   The Architect will select the specific provider and define the schema DDL.

2. **Offline write queuing: in scope, via `localStorage`-backed retry queue.**
   Failed or offline writes are added to a `dd_feedback_queue` in `localStorage`.
   The queue is drained in order on next successful network connectivity. Items are
   removed only after server confirmation. This ensures no feedback signal is
   permanently lost due to transient network conditions.

3. **Device ID storage: cookie + `localStorage` + `X-Device-ID` header.**
   Triple redundancy for maximum reliability across browser, PWA-installed, and
   future SSR contexts. Cookie is primary; `localStorage` is fallback; explicit
   header removes server-side ambiguity. See Device Identity Model section for full
   specification.

## Open Questions

None. All blockers are resolved. This BRD is ready for PM.

---

## Related Documents

| Document | Location |
|----------|----------|
| Prior feedback BRD (localStorage) | `agents/ba/requirements_feedback_capture_v1.md` |
| System architecture | `agents/architect/ARCHITECTURE.md` |
| Roadmap | `agents/pm/roadmap.md` |
| Existing feedback store implementation | `lib/feedback/store.ts` |
