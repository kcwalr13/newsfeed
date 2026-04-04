# Technical Design — Server-Side Feedback Storage (Milestone 2.5)

**ID**: ARCH-DESIGN-003
**Stories Reference**: `agents/pm/stories_server_feedback_v1.md` (SFB-001 through SFB-010)
**BRD Reference**: `agents/ba/requirements_server_feedback_v1.md` (BRD-003)
**Date**: 2026-04-04
**Status**: Final
**Author**: Architect Agent

---

## Table of Contents

1. Architecture Overview
2. New Directory Structure
3. Database Schema (DDL)
4. Database Client Module
5. Device Identity Module
6. API Route Specifications
7. Client Store Changes
8. Migration Flow
9. App Startup Sequence
10. New npm Dependencies
11. Environment Variables
12. Deferred Items

---

## 1. Architecture Overview

Milestone 2.5 adds a server-side persistence layer for feedback without changing any user-visible UI. The `FeedbackButtons` component and its external API surface are completely unchanged.

### What is new

- `lib/identity/device.ts` — generates, reads, and persists the anonymous device UUID across cookie and localStorage
- `lib/db/client.ts` — database connection singleton using `@neondatabase/serverless`
- `lib/db/feedback.ts` — typed query helpers wrapping raw SQL for the `feedback` table
- `lib/types/feedback.ts` — new types for this milestone
- `app/api/feedback/route.ts` — handles `GET` and `POST /api/feedback`
- `app/api/feedback/[articleId]/route.ts` — handles `DELETE /api/feedback/[articleId]`
- `app/api/feedback/migrate/route.ts` — handles `POST /api/feedback/migrate`

### What is modified

- `lib/feedback/store.ts` — new async functions appended; `setFeedback` and `clearFeedback` fire server writes as fire-and-forget side effects; queue drain logic added
- `app/page.tsx` — startup sequence: device identity init, migration check, server load, drain listeners
- `.env.example` — `DATABASE_URL` added

### What is NOT modified

- `app/components/FeedbackButtons.tsx` — zero changes
- `app/components/ArticleCard.tsx` — zero changes
- `lib/types/article.ts` — zero changes
- All pipeline code — zero changes
- All article API routes — zero changes

### Data flow

```
USER TAP
  │
  ▼
FeedbackButtons (unchanged)
  │  calls setFeedback() / clearFeedback()
  ▼
lib/feedback/store.ts
  ├─► localStorage write (dd_feedback)            ← synchronous, immediate
  └─► serverSetFeedback() / serverClearFeedback() ← async, fire-and-forget
        ├─ success → done (server is source of truth)
        └─ failure → enqueue to dd_feedback_queue

APP LOAD (page.tsx useEffect)
  ├─► initDeviceId()           ← lib/identity/device.ts
  ├─► runMigrationIfNeeded()   ← lib/feedback/store.ts
  ├─► drainQueue()             ← lib/feedback/store.ts
  └─► loadFromServer()         ← GET /api/feedback → merge into localStorage

SERVER (Next.js Route Handlers)
  └─► lib/db/feedback.ts → lib/db/client.ts → Neon PostgreSQL
```

---

## 2. New Directory Structure

```
lib/
  feedback/
    store.ts          ← modified
  identity/
    device.ts         ← NEW
  db/
    client.ts         ← NEW
    feedback.ts       ← NEW
  types/
    article.ts        ← unchanged
    feedback.ts       ← NEW

app/
  api/
    feedback/
      route.ts                ← NEW (GET + POST)
      [articleId]/
        route.ts              ← NEW (DELETE)
      migrate/
        route.ts              ← NEW (POST)
  page.tsx                    ← modified
```

---

## 3. Database Schema (DDL)

**Provider**: Neon (serverless PostgreSQL). Run once in the Neon SQL console.

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

**Column notes:**

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL | Auto-increment PK. Never sent to client. |
| `device_id` | TEXT NOT NULL | UUID v4 from the client. No FK — device identity is client-authoritative. |
| `user_id` | TEXT NULL | Reserved for Milestone 3 accounts. Always NULL until then. |
| `article_id` | TEXT NOT NULL | e.g. `bbc-news-a1b2c3d4` |
| `value` | TEXT NOT NULL | Constrained to `'like'` or `'dislike'`. Absence of row = no feedback. |
| `updated_at` | TIMESTAMPTZ NOT NULL | `NOW()` on insert; client-supplied timestamp on migrate. |

**Why `TEXT CHECK` not a PostgreSQL enum?** Enum types require DDL migrations to extend. A CHECK constraint on TEXT achieves the same validation with no migration cost when a new value is needed.

---

## 4. Database Client Module

**File**: `lib/db/client.ts` — server-only. Never import in client-side code.

```typescript
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

export const sql = neon(process.env.DATABASE_URL);
```

The `neon()` function returns a tagged-template SQL function. Values interpolated into templates are automatically parameterized — no SQL injection risk.

---

## 5. Device Identity Module

**File**: `lib/identity/device.ts` — client-only (SSR guards required).

### Storage locations

| Location | Key | Priority |
|----------|-----|----------|
| HTTP cookie | `dd_device_id` | 1st (primary) |
| localStorage | `dd_device_id` | 2nd (fallback) |
| `X-Device-ID` header | — | Sent on every API call |

### Cookie configuration

```
Name:     dd_device_id
MaxAge:   31536000  (1 year)
Path:     /
SameSite: Lax
Secure:   true in production, false in development
HttpOnly: false  (client must read it)
```

### Function signatures

```typescript
/**
 * Returns the device ID from cookie (primary) or localStorage (fallback).
 * Returns null if neither is present.
 */
export function readDeviceId(): string | null

/**
 * Reads or creates the device ID.
 * - Cookie present: refresh expiry, sync to localStorage, return value.
 * - Cookie absent, localStorage present: write cookie, return value.
 * - Neither present: generate UUID v4, write both, return value.
 * Always returns a string after this call.
 */
export function initDeviceId(): string

/**
 * Returns headers to attach to all feedback API requests.
 * Returns {} if no device ID is available.
 */
export function getDeviceHeaders(): Record<string, string>
```

Uses `crypto.randomUUID()` — no external UUID library needed.

### Server-side extraction (used in all API routes)

```typescript
function extractDeviceId(req: NextRequest): string | null {
  return req.cookies.get('dd_device_id')?.value
    ?? req.headers.get('X-Device-ID')
    ?? null;
}
```

---

## 6. API Route Specifications

All routes: `export const dynamic = 'force-dynamic'`. Auth: device ID via cookie or `X-Device-ID` header.

---

### GET /api/feedback

**File**: `app/api/feedback/route.ts`

Returns all feedback records for the requesting device as a flat map.

**Response (200 — always)**:
```typescript
Record<string, { value: 'like' | 'dislike'; updatedAt: string }>
// {} if no device ID or no records
```

On database error: log server-side, return `{}` with 200 (avoids breaking client startup).

**SQL**:
```sql
SELECT article_id, value, updated_at
FROM feedback
WHERE device_id = $1
```

---

### POST /api/feedback

**File**: `app/api/feedback/route.ts`

Upserts a single feedback record.

**Request body**: `{ articleId: string; value: 'like' | 'dislike' }`

**Response (200)**: `{ articleId: string; value: string; updatedAt: string }`

**Errors**: 400 (missing device ID, missing articleId, invalid value), 500 (DB error)

**SQL** (upsert):
```sql
INSERT INTO feedback (device_id, article_id, value, updated_at)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (device_id, article_id)
DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
RETURNING article_id, value, updated_at
```

---

### DELETE /api/feedback/[articleId]

**File**: `app/api/feedback/[articleId]/route.ts`

Deletes a feedback record. Idempotent — 200 even if record not found.

**Response (200)**: `{ ok: true }`

**Errors**: 400 (no device ID), 500 (DB error)

**SQL**:
```sql
DELETE FROM feedback WHERE device_id = $1 AND article_id = $2
```

---

### POST /api/feedback/migrate

**File**: `app/api/feedback/migrate/route.ts`

One-time bulk upsert from localStorage. Server record wins if its `updated_at` is newer.

**Request body**:
```typescript
{
  records: Array<{
    articleId: string;
    value: 'like' | 'dislike';
    updatedAt: string; // ISO-8601 — the client's stored timestamp
  }>;
}
```

**Response (200)**: `{ ok: true; written: number }`

**Errors**: 400 (no device ID, records not array, invalid record), 500 (DB error)

**SQL** (per record):
```sql
INSERT INTO feedback (device_id, article_id, value, updated_at)
VALUES ($1, $2, $3, $4::timestamptz)
ON CONFLICT (device_id, article_id)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = EXCLUDED.updated_at
WHERE feedback.updated_at < EXCLUDED.updated_at
```

The `WHERE` clause prevents the migration from regressing a newer server record with older local data. Execute all records via `Promise.all` — do not build multi-row VALUES clauses manually.

---

## 7. Client Store Changes

**File**: `lib/feedback/store.ts`

Existing four functions (`getFeedback`, `setFeedback`, `clearFeedback`, `getAllFeedback`) are **completely unchanged in signature and return type**. New additions are appended.

### New constants (appended to store.ts)

```typescript
export const FEEDBACK_QUEUE_KEY  = 'dd_feedback_queue';
export const MIGRATION_FLAG_KEY  = 'dd_feedback_migrated';
```

### Behavioral changes to existing functions

`setFeedback(articleId, value)` — after localStorage write, calls `serverSetFeedback(articleId, value)` (fire-and-forget, no `await`). Returns `void`, unchanged.

`clearFeedback(articleId)` — after localStorage delete, calls `serverClearFeedback(articleId)` (fire-and-forget, no `await`). Returns `void`, unchanged.

### New types (`lib/types/feedback.ts`)

```typescript
export interface QueuedWrite {
  articleId: string;
  value: 'like' | 'dislike' | 'cleared';
  timestamp: string; // ISO-8601
}

export type ServerFeedbackMap = Record<string, {
  value: 'like' | 'dislike';
  updatedAt: string;
}>;
```

### New exported async functions

```typescript
/**
 * Fetches all feedback for the current device from the server.
 * Merges result into localStorage (server wins on conflict).
 * Falls back to localStorage on error.
 */
export async function loadFromServer(): Promise<FeedbackStore>

/**
 * One-time migration: reads dd_feedback and uploads to /api/feedback/migrate
 * if dd_feedback_migrated flag is absent. Sets the flag on success.
 */
export async function runMigrationIfNeeded(): Promise<void>

/**
 * Drains dd_feedback_queue. Sends each item in order.
 * Removes items only after 2xx. Stops on first failure.
 */
export async function drainQueue(): Promise<void>
```

### Internal async helpers (not exported)

```typescript
async function serverSetFeedback(articleId: string, value: 'like' | 'dislike'): Promise<void>
// POST /api/feedback → on failure, enqueue({ articleId, value, timestamp })

async function serverClearFeedback(articleId: string): Promise<void>
// DELETE /api/feedback/[articleId] → on failure, enqueue({ articleId, value: 'cleared', timestamp })
```

Both use `getDeviceHeaders()` from `lib/identity/device.ts` for the `X-Device-ID` header.

### Queue drain logic

```
1. Read dd_feedback_queue from localStorage.
2. If empty, return.
3. For each item in order (oldest first):
   a. value === 'cleared': DELETE /api/feedback/[articleId]
   b. value === 'like'|'dislike': POST /api/feedback { articleId, value }
   c. On 2xx: remove item from queue, persist.
   d. On failure: stop. Preserve remaining queue.
```

### `loadFromServer` merge logic

```
1. GET /api/feedback with X-Device-ID header.
2. On success: for each server record, overwrite localStorage entry
   (server wins unconditionally). Write merged store back to localStorage.
3. On failure: return getAllFeedback() (localStorage fallback).
```

---

## 8. Migration Flow

**Trigger**: `dd_feedback_migrated` absent from localStorage AND `dd_feedback` non-empty.

```
1. Check dd_feedback_migrated → if present, return.
2. Read dd_feedback via getAllFeedback().
3. If empty: set dd_feedback_migrated = 'true', return.
4. POST /api/feedback/migrate with records array + X-Device-ID header.
5. On 2xx: set dd_feedback_migrated = 'true'.
6. On failure: log silently, do NOT set flag (retry next session).
```

Migration runs before `loadFromServer()` in startup so the GET response includes migrated records.

---

## 9. App Startup Sequence

New `useEffect` in `app/page.tsx` (independent of the existing `fetchFeed` effect):

```typescript
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') drainQueue();
  };
  const handleFocus = () => drainQueue();

  async function initFeedback() {
    initDeviceId();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    await runMigrationIfNeeded();
    await loadFromServer();
  }

  initFeedback();

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('focus', handleFocus);
  };
}, []);
```

`loadFromServer()` is non-blocking to the feed render. `FeedbackButtons` initialises from localStorage; the server load enriches this state for the next render cycle. On the common path (localStorage and server in sync), the UX is unchanged.

---

## 10. New npm Dependencies

| Package | Why |
|---------|-----|
| `@neondatabase/serverless` | Neon-native serverless Postgres driver. HTTP/WebSocket transport, no persistent connection overhead, works in Node.js and Edge runtimes. Preferred over `pg` for serverless cold-start performance. |

No ORM. No UUID library (`crypto.randomUUID()` is native).

**Install**: `npm install @neondatabase/serverless`

---

## 11. Environment Variables

| Variable | Required For | Notes |
|----------|-------------|-------|
| `NEWSAPI_KEY` | NewsAPI adapter | Existing. |
| `CRON_SECRET` | Pipeline trigger | Existing. |
| `DATABASE_URL` | All feedback API routes | Neon connection string: `postgresql://user:pass@host/dbname?sslmode=require`. Add to `.env.local` and production deployment. |

`.env.example` after update:
```
NEWSAPI_KEY=
CRON_SECRET=
DATABASE_URL=
```

---

## 12. Deferred Items

| Item | Reason |
|------|--------|
| `useFeedback` hook / React context | Not needed until `FeedbackButtons` must reactively re-render after `loadFromServer()`. Deferred to Milestone 3. |
| `user_id` population | Column exists, always NULL. Wired in Milestone 3 (accounts). |
| Cross-device sync UI | Requires accounts. |
| Rate limiting on feedback endpoints | Deferred until abuse patterns emerge. |
| GDPR data export / deletion | No timeline. |
| `localStorage` (dd_feedback) removal | Retained as cache/fallback. Removal deferred. |
| Database migration tooling | Single-table schema doesn't need it yet. Introduce when schema grows. |
| Feed personalization | FUTURE-002 / FUTURE-003, downstream of Milestone 3. |
