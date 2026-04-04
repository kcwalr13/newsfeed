# Dev Task List — Server-Side Feedback Storage (Milestone 2.5)

**ID**: ARCH-TASKS-003
**Design Reference**: `agents/architect/design_server_feedback_v1.md`
**Stories Reference**: `agents/pm/stories_server_feedback_v1.md`
**Date**: 2026-04-04
**Status**: SFB-TASK-001 through SFB-TASK-010 complete. Pending manual end-to-end verification.

---

## Dependency Order

```
SFB-TASK-001  (Install + DB setup)
  ├── SFB-TASK-002  (DB client + query helpers)
  │     └── SFB-TASK-003  (API: GET + POST /api/feedback)
  │           └── SFB-TASK-004  (API: DELETE /api/feedback/[articleId])
  │                 └── SFB-TASK-005  (API: POST /api/feedback/migrate)
  │
  └── SFB-TASK-006  (Device identity module)
        └── SFB-TASK-007  (New types + store async additions)
              ├── SFB-TASK-008  (Server write integration into setFeedback/clearFeedback)
              │     └── SFB-TASK-009  (Offline queue + drain logic)
              └── SFB-TASK-010  (App startup sequence in page.tsx)
```

Both chains (DB/API and client) can proceed in parallel from SFB-TASK-001.
SFB-TASK-008 requires SFB-TASK-003 + SFB-TASK-004 complete for end-to-end testing.
SFB-TASK-010 requires SFB-TASK-003 + SFB-TASK-005 + SFB-TASK-007 complete.

---

## SFB-TASK-001 — Install dependency and set up database

**[BLOCKER — prerequisite for all other tasks]**
**Covers story**: SFB-002 (infrastructure)

### What to build

Install `@neondatabase/serverless`, provision the Neon database, run the DDL, and configure the environment.

### Steps

1. `npm install @neondatabase/serverless`
2. Create a free Neon project at neon.tech
3. Copy the connection string (`postgresql://user:pass@host/dbname?sslmode=require`)
4. Add `DATABASE_URL=<connection-string>` to `.env.local`
5. Run the following DDL in the Neon SQL console:

```sql
CREATE TABLE IF NOT EXISTS feedback (
  id          SERIAL PRIMARY KEY,
  device_id   TEXT        NOT NULL,
  user_id     TEXT        NULL,
  article_id  TEXT        NOT NULL,
  value       TEXT        NOT NULL CHECK (value IN ('like', 'dislike')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT feedback_device_article_unique UNIQUE (device_id, article_id)
);

CREATE INDEX IF NOT EXISTS feedback_device_id_idx ON feedback (device_id);
```

6. Add `DATABASE_URL=` (no value) to `.env.example`

### Files to modify

| Action | Path |
|--------|------|
| Auto-modified | `package.json` |
| Modify | `.env.local` |
| Modify | `.env.example` |

### Acceptance criteria

- [ ] `@neondatabase/serverless` in `package.json` dependencies.
- [ ] `feedback` table exists in Neon with all columns and the unique constraint on `(device_id, article_id)`.
- [ ] `feedback_device_id_idx` index exists.
- [ ] `DATABASE_URL` set in `.env.local`, not committed to git.
- [ ] `.env.example` contains `DATABASE_URL=` with no value.
- [ ] `npx tsc --noEmit` passes.

---

## SFB-TASK-002 — Database client and query helpers

**[BLOCKER — prerequisite for SFB-TASK-003, 004, 005]**
**Covers story**: SFB-002 (complete)
**Prerequisites**: SFB-TASK-001

### Files to create

| Action | Path |
|--------|------|
| Create | `lib/db/client.ts` |
| Create | `lib/db/feedback.ts` |

### `lib/db/client.ts`

```typescript
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

export const sql = neon(process.env.DATABASE_URL);
```

### `lib/db/feedback.ts`

Export typed helpers:

```typescript
export interface DbFeedbackRow {
  article_id: string;
  value: 'like' | 'dislike';
  updated_at: Date;
}

export async function getFeedbackForDevice(deviceId: string): Promise<DbFeedbackRow[]>
export async function upsertFeedback(deviceId: string, articleId: string, value: 'like' | 'dislike'): Promise<DbFeedbackRow>
export async function deleteFeedback(deviceId: string, articleId: string): Promise<void>
export async function migrateFeedbackRecords(
  deviceId: string,
  records: Array<{ articleId: string; value: 'like' | 'dislike'; updatedAt: string }>
): Promise<number>
```

Implement each using the `sql` tag from `client.ts`. Use the exact SQL from the design doc. `migrateFeedbackRecords` returns a best-effort count of affected rows.

### Acceptance criteria

- [ ] `lib/db/client.ts` exports `sql` and throws on missing `DATABASE_URL`.
- [ ] `lib/db/feedback.ts` exports all four helpers with correct signatures.
- [ ] Neither file imports from `react`, `next/navigation`, or any client-side module.
- [ ] `npx tsc --noEmit` passes.

---

## SFB-TASK-003 — API routes: GET and POST /api/feedback

**[BLOCKER — prerequisite for SFB-TASK-008, SFB-TASK-010]**
**Covers stories**: SFB-003, SFB-004
**Prerequisites**: SFB-TASK-002

### Files to create

| Action | Path |
|--------|------|
| Create | `app/api/feedback/route.ts` |

### Implement

Both handlers in the same file. Use `extractDeviceId(req)` inline (reads cookie first, `X-Device-ID` header as fallback). See design doc §6.1 and §6.2 for exact request/response shapes and SQL.

Mark `export const dynamic = 'force-dynamic'`.

### Acceptance criteria

- [ ] `GET /api/feedback` with no device ID returns `{}` with 200.
- [ ] `GET /api/feedback` with a valid device ID and records returns the correct map.
- [ ] `POST /api/feedback` without device ID returns 400.
- [ ] `POST /api/feedback` with missing `articleId` returns 400.
- [ ] `POST /api/feedback` with invalid `value` returns 400.
- [ ] `POST /api/feedback` with valid payload upserts and returns `{ articleId, value, updatedAt }`.
- [ ] Calling `POST` twice for the same `(deviceId, articleId)` updates the record (no duplicate rows).
- [ ] `npx tsc --noEmit` passes.

---

## SFB-TASK-004 — API route: DELETE /api/feedback/[articleId]

**[BLOCKER — prerequisite for SFB-TASK-008]**
**Covers story**: SFB-005
**Prerequisites**: SFB-TASK-002

### Files to create

| Action | Path |
|--------|------|
| Create | `app/api/feedback/[articleId]/route.ts` |

See design doc §6.3. Idempotent — 200 even if row not found. Mark `export const dynamic = 'force-dynamic'`.

### Acceptance criteria

- [ ] `DELETE /api/feedback/[articleId]` without device ID returns 400.
- [ ] `DELETE /api/feedback/[articleId]` for an existing record deletes it and returns `{ ok: true }`.
- [ ] `DELETE /api/feedback/[articleId]` for a non-existent record returns `{ ok: true }` (idempotent).
- [ ] `npx tsc --noEmit` passes.

---

## SFB-TASK-005 — API route: POST /api/feedback/migrate

**Covers story**: SFB-009
**Prerequisites**: SFB-TASK-002

### Files to create

| Action | Path |
|--------|------|
| Create | `app/api/feedback/migrate/route.ts` |

See design doc §6.4. Validate all records before writing any. Use `Promise.all` for concurrent upserts. Server record wins if its `updated_at` is newer (the `WHERE feedback.updated_at < EXCLUDED.updated_at` clause). Mark `export const dynamic = 'force-dynamic'`.

### Acceptance criteria

- [ ] No device ID → 400.
- [ ] `records` not an array → 400.
- [ ] Invalid record in array → 400 with index in message.
- [ ] Valid payload upserts all records and returns `{ ok: true, written: N }`.
- [ ] Calling the endpoint twice with the same payload does not create duplicate rows.
- [ ] If a server record has a newer `updated_at` than the incoming record, the server record is not overwritten.
- [ ] `npx tsc --noEmit` passes.

---

## SFB-TASK-006 — Device identity module

**[BLOCKER — prerequisite for SFB-TASK-007]**
**Covers story**: SFB-001
**Prerequisites**: SFB-TASK-001 (conceptual — no code dependency, but must be installed before testing)

### Files to create

| Action | Path |
|--------|------|
| Create | `lib/identity/device.ts` |

Implement `readDeviceId()`, `initDeviceId()`, `getDeviceHeaders()` per design doc §5.

- All functions guard `typeof window === 'undefined'`.
- Cookie written via `document.cookie` string assignment with `MaxAge`, `Path`, `SameSite`, and `Secure` (production only) attributes.
- `initDeviceId()` refreshes cookie expiry on every call.
- `crypto.randomUUID()` for UUID generation — no external package.
- Minimal `getCookie(name)` helper included inline.

### Acceptance criteria

- [ ] `readDeviceId()` returns `null` when neither cookie nor localStorage has a value.
- [ ] `initDeviceId()` returns the same UUID on subsequent calls (reads existing value).
- [ ] `initDeviceId()` generates a new UUID if neither storage location has a value.
- [ ] Cookie is written with correct attributes (`SameSite=Lax`; `Secure` in prod).
- [ ] `getDeviceHeaders()` returns `{ 'X-Device-ID': uuid }` after `initDeviceId()` has been called.
- [ ] Module does not import from `react`, `next`, or any server-side module.
- [ ] `npx tsc --noEmit` passes.

---

## SFB-TASK-007 — New types and store async additions (non-write)

**[BLOCKER — prerequisite for SFB-TASK-008, SFB-TASK-010]**
**Covers story**: SFB-001 (partial), SFB-006
**Prerequisites**: SFB-TASK-006

### Files to create / modify

| Action | Path |
|--------|------|
| Create | `lib/types/feedback.ts` |
| Modify | `lib/feedback/store.ts` — add constants + `loadFromServer` + `runMigrationIfNeeded` + queue helpers |

### `lib/types/feedback.ts`

```typescript
export interface QueuedWrite {
  articleId: string;
  value: 'like' | 'dislike' | 'cleared';
  timestamp: string;
}

export type ServerFeedbackMap = Record<string, {
  value: 'like' | 'dislike';
  updatedAt: string;
}>;
```

### `lib/feedback/store.ts` additions

Add constants `FEEDBACK_QUEUE_KEY` and `MIGRATION_FLAG_KEY`. Add queue read/write helpers (internal). Add `loadFromServer()`, `runMigrationIfNeeded()`, `drainQueue()` as exported async functions. See design doc §7 for full logic.

Do NOT yet modify `setFeedback` or `clearFeedback` — that is SFB-TASK-008.

### Acceptance criteria

- [ ] `QueuedWrite` and `ServerFeedbackMap` exported from `lib/types/feedback.ts`.
- [ ] `FEEDBACK_QUEUE_KEY` and `MIGRATION_FLAG_KEY` exported from `lib/feedback/store.ts`.
- [ ] `loadFromServer()` exported and calls `GET /api/feedback` with `X-Device-ID` header.
- [ ] `loadFromServer()` merges server response into localStorage (server wins), returns merged store.
- [ ] `loadFromServer()` returns `getAllFeedback()` on network error (no throw).
- [ ] `runMigrationIfNeeded()` is a no-op if `dd_feedback_migrated` flag is set.
- [ ] `runMigrationIfNeeded()` uploads existing localStorage feedback and sets flag on success.
- [ ] `drainQueue()` is a no-op when queue is empty.
- [ ] `npx tsc --noEmit` passes.

---

## SFB-TASK-008 — Wire server writes into setFeedback and clearFeedback

**Covers story**: SFB-006
**Prerequisites**: SFB-TASK-007, SFB-TASK-003, SFB-TASK-004

### Files to modify

| Action | Path |
|--------|------|
| Modify | `lib/feedback/store.ts` — add `serverSetFeedback` + `serverClearFeedback` internal helpers; update `setFeedback` and `clearFeedback` |

Add internal async functions `serverSetFeedback` and `serverClearFeedback` per design doc §7. Update `setFeedback` to call `serverSetFeedback` (fire-and-forget) after the localStorage write. Update `clearFeedback` to call `serverClearFeedback` (fire-and-forget) after the localStorage delete.

Both functions remain synchronous (`void`) — the server call is not awaited.

### Acceptance criteria

- [ ] Tapping a feedback button (like or dislike) results in a row appearing in the Neon database within a few seconds.
- [ ] Tapping the same button again (clear) deletes the row from the database.
- [ ] `setFeedback` and `clearFeedback` remain synchronous and return `void`.
- [ ] `FeedbackButtons` component is not modified.
- [ ] A server error on the write does not produce any visible error in the UI.
- [ ] Failed write is added to `dd_feedback_queue` in localStorage.
- [ ] `npx tsc --noEmit` passes.

---

## SFB-TASK-009 — Offline queue drain logic

**Covers story**: SFB-007
**Prerequisites**: SFB-TASK-008

### Files to modify

| Action | Path |
|--------|------|
| Modify | `lib/feedback/store.ts` — implement `drainQueue` using design doc §7 drain logic |

Ensure `drainQueue`:
- Processes items oldest-first.
- Removes each item from the queue only after 2xx from the server.
- Stops on first failure, preserving remaining items.
- Is safe to call concurrently (guard with a module-level `isDraining` boolean flag to prevent overlapping drain runs).

### Acceptance criteria

- [ ] With a valid queue entry, `drainQueue()` sends the write to the server and removes the entry on success.
- [ ] With a failing server (e.g., wrong URL), `drainQueue()` preserves the queue entry.
- [ ] Multiple items in queue are processed in order; on second item failure, first item is already removed.
- [ ] Concurrent calls to `drainQueue()` while a drain is in progress do not send duplicate requests.
- [ ] `npx tsc --noEmit` passes.

---

## SFB-TASK-010 — App startup sequence

**Covers story**: SFB-008, SFB-010
**Prerequisites**: SFB-TASK-007, SFB-TASK-003, SFB-TASK-005

### Files to modify

| Action | Path |
|--------|------|
| Modify | `app/page.tsx` — add `initFeedback` useEffect |

Add a new `useEffect` (independent of the existing `fetchFeed` effect) that:
1. Calls `initDeviceId()`
2. Registers `visibilitychange` and `focus` listeners that call `drainQueue()`
3. Awaits `runMigrationIfNeeded()`
4. Awaits `loadFromServer()`
5. Cleans up listeners on unmount

See design doc §9 for the full implementation.

### Acceptance criteria

- [ ] On first app load, a `dd_device_id` cookie and localStorage entry are created.
- [ ] On subsequent loads, the same UUID is reused (cookie refreshed, not regenerated).
- [ ] `GET /api/feedback` is called on every app load and button states reflect server state.
- [ ] Existing localStorage feedback is uploaded on first post-feature session and `dd_feedback_migrated` flag is set.
- [ ] Migration does not run on subsequent sessions (flag guards it).
- [ ] Switching to the app tab after being away triggers `drainQueue()`.
- [ ] Feed page still renders and loads articles correctly (existing `fetchFeed` effect unaffected).
- [ ] `npx tsc --noEmit` passes.

---

## Task Summary

| Task | Story | Depends On | Creates | Modifies |
|------|-------|------------|---------|----------|
| SFB-TASK-001 | SFB-002 | — | — | `package.json`, `.env.*` |
| SFB-TASK-002 | SFB-002 | 001 | `lib/db/client.ts`, `lib/db/feedback.ts` | — |
| SFB-TASK-003 | SFB-003, SFB-004 | 002 | `app/api/feedback/route.ts` | — |
| SFB-TASK-004 | SFB-005 | 002 | `app/api/feedback/[articleId]/route.ts` | — |
| SFB-TASK-005 | SFB-009 | 002 | `app/api/feedback/migrate/route.ts` | — |
| SFB-TASK-006 | SFB-001 | 001 | `lib/identity/device.ts` | — |
| SFB-TASK-007 | SFB-001, SFB-006 | 006 | `lib/types/feedback.ts` | `lib/feedback/store.ts` |
| SFB-TASK-008 | SFB-006 | 007 + 003 + 004 | — | `lib/feedback/store.ts` |
| SFB-TASK-009 | SFB-007 | 008 | — | `lib/feedback/store.ts` |
| SFB-TASK-010 | SFB-008, SFB-010 | 007 + 003 + 005 | — | `app/page.tsx` |
