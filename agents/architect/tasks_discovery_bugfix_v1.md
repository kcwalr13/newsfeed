# Dev Task List — Discovery Bug Fixes (Milestone 8)

**ID**: ARCH-TASKS-008
**Date**: 2026-04-04
**Status**: Ready for Dev

---

## Background

Three defects were identified during the M7 post-ship review. No new design is
required; the fixes are surgical changes to existing files. Execute the tasks
top-to-bottom in the order listed. All three tasks are independent of each other
and may be executed in any order, but the order below is recommended (most
critical first).

---

## Dependency Order

```
BUG-TASK-001  (lib/db/discovery.ts + DDL migration -- last_processed_at column)
  |-- BUG-TASK-003  (lib/discovery/run.ts -- deviceId threading + upsert fix)
        |
BUG-TASK-002  (app/api/articles/[id]/route.ts -- strip discoveryTopic from response)
```

BUG-TASK-001 must be completed before BUG-TASK-003 (the `upsertTopicWeight` call
site in `run.ts` is modified by both tasks; doing them in order avoids a merge
conflict). BUG-TASK-002 is fully independent.

---

## BUG-TASK-001 — Add last_processed_at to discovery_topic_weights; filter feedback by it

**[BLOCKER — prerequisite for BUG-TASK-003]**
**Defect**: Topic weight double-counting (Critical)
**Prerequisites**: None

### What to build

`runDiscovery` currently processes ALL rows from the `feedback` table on every
pipeline run. This causes topic weights to drift unboundedly: each run re-applies
every historical like/dislike, compounding the weight delta. The fix is to make
weight updates idempotent by tracking which feedback rows have already been
processed.

Add a `last_processed_at TIMESTAMPTZ` column to `discovery_topic_weights`. Before
processing feedback, load each row's `last_processed_at`. Filter the feedback
query to rows where `feedback.updated_at > last_processed_at` (or all rows if
`last_processed_at` is null). After writing updated weights, set
`last_processed_at = NOW()` on those rows.

The change touches two files: `lib/db/discovery.ts` (DDL migration + updated
helper) and `lib/discovery/run.ts` (feedback filter + post-update call).

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `lib/db/discovery.ts` |
| Modify | `lib/discovery/run.ts` |

### Implementation

#### Step 1 — DDL migration in lib/db/discovery.ts

At the bottom of `lib/db/discovery.ts`, add an exported `migrateDiscoverySchema`
function that runs the following DDL idempotently. Call this function once from
a migration script or manually in the Neon console. Do not call it automatically
on every module import.

```sql
ALTER TABLE discovery_topic_weights
  ADD COLUMN IF NOT EXISTS last_processed_at TIMESTAMPTZ;
```

The column defaults to `NULL` (meaning "never processed"). No backfill is
needed: a NULL value is treated as "process all feedback" on the next run, which
is the correct starting behavior for existing rows.

Add the following exported function to `lib/db/discovery.ts`:

```typescript
export async function migrateDiscoverySchema(): Promise<void> {
  await sql`
    ALTER TABLE discovery_topic_weights
      ADD COLUMN IF NOT EXISTS last_processed_at TIMESTAMPTZ
  `;
}
```

#### Step 2 — Update TopicWeightRow interface

Add `last_processed_at: string | null` to the `TopicWeightRow` interface in
`lib/db/discovery.ts`:

```typescript
export interface TopicWeightRow {
  user_id: string | null;
  device_id: string;
  topic_id: string;
  weight: number;
  last_processed_at: string | null;  // ISO-8601 or null if never processed
}
```

Update the `SELECT` statement in both `getTopicWeightsForUser` and
`getTopicWeightsForDevice` to include the new column:

```sql
SELECT user_id, device_id, topic_id, weight::float AS weight,
       last_processed_at::text AS last_processed_at
FROM discovery_topic_weights
WHERE ...
```

#### Step 3 — Add setLastProcessedAt helper in lib/db/discovery.ts

```typescript
/**
 * Updates last_processed_at to NOW() for all topic weight rows belonging to
 * the given identity. Called after feedback processing is complete for a run.
 */
export async function setLastProcessedAt(
  userId: string | null,
  deviceId: string
): Promise<void> {
  await sql`
    UPDATE discovery_topic_weights
    SET last_processed_at = NOW()
    WHERE device_id = ${deviceId}
      AND (
        (${userId}::text IS NULL AND user_id IS NULL)
        OR user_id = ${userId}
      )
  `;
}
```

#### Step 4 — Update lib/discovery/run.ts feedback processing block

Inside the `if (userId)` feedback processing block (currently around line 103),
make these two changes:

**4a. Determine the cutoff timestamp for this identity.**

Before the `getFeedbackForUser` call, find the minimum `last_processed_at` across
all loaded weight rows for this user. If any row has `last_processed_at = null`,
treat the cutoff as `null` (meaning no cutoff — process all feedback).

```typescript
// Determine the earliest last_processed_at across all loaded weight rows.
// If any row has null (never processed), fall back to null (process all).
const cutoffIso: string | null = weightRows.every((r) => r.last_processed_at !== null)
  ? weightRows.reduce((earliest, r) =>
      r.last_processed_at! < earliest ? r.last_processed_at! : earliest,
      weightRows[0].last_processed_at!
    )
  : null;
```

**4b. Filter feedback rows by the cutoff timestamp.**

Replace the existing call:

```typescript
const feedbackRows = await getFeedbackForUser(userId);
```

with filtering logic using the cutoff:

```typescript
const allFeedbackRows = await getFeedbackForUser(userId);
const feedbackRows = cutoffIso === null
  ? allFeedbackRows
  : allFeedbackRows.filter((r) => r.updated_at > cutoffIso);
```

This requires that `DbFeedbackRow` exposes an `updated_at` field. Verify that
`lib/db/feedback.ts` includes `updated_at` in the `DbFeedbackRow` interface and
in the SELECT query for `getFeedbackForUser`. If it is missing, add it:
- Add `updated_at: string` to `DbFeedbackRow` in `lib/db/feedback.ts`.
- Add `updated_at::text AS updated_at` to the SELECT in `getFeedbackForUser`.

**4c. After all weight upserts succeed, call setLastProcessedAt.**

At the end of the feedback processing for-loop (after all `upsertTopicWeight`
calls), add:

```typescript
import { ..., setLastProcessedAt } from '@/lib/db/discovery';

// ... inside the if (userId) block, after the for-loop over feedbackRows:
if (feedbackRows.length > 0) {
  await setLastProcessedAt(userId, /* deviceId — see BUG-TASK-003 */ userId);
}
```

Note: the `deviceId` argument to `setLastProcessedAt` is temporarily set to
`userId` here (same pragmatic workaround already in place). BUG-TASK-003 will
replace this with the real `deviceId` parameter.

### Acceptance criteria

- [x] `lib/db/discovery.ts` exports `migrateDiscoverySchema()`, `setLastProcessedAt()`.
- [x] `TopicWeightRow` interface includes `last_processed_at: string | null`.
- [x] `getTopicWeightsForUser` and `getTopicWeightsForDevice` SELECT and return
  `last_processed_at`.
- [x] The feedback processing block in `lib/discovery/run.ts` computes `cutoffIso`
  from the loaded weight rows before fetching feedback.
- [x] `getFeedbackForUser` is called once; the returned rows are filtered to only
  those with `updated_at > cutoffIso` when `cutoffIso` is non-null.
- [x] `setLastProcessedAt` is called after all weight upserts in the feedback loop
  (only when `feedbackRows.length > 0`).
- [x] On a second call to `runDiscovery` with no new feedback since the last run,
  `feedbackRows` after filtering is empty and no `upsertTopicWeight` calls are
  made. (Verify by code inspection: if `allFeedbackRows` are all older than
  `cutoffIso`, the filtered array is empty and the for-loop body does not execute.)
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Added `last_processed_at: string | null` to `TopicWeightRow`; updated both SELECT helpers to include the column; added `setLastProcessedAt` and `migrateDiscoverySchema` to `lib/db/discovery.ts`; updated `lib/db/feedback.ts` to cast `updated_at` to text (string) for ISO comparison; added cutoff logic in `lib/discovery/run.ts` with empty-array guard. Also fixed a downstream type error in `app/api/feedback/route.ts` where `updated_at` was being cast to `Date` and `.toISOString()` called — now passes the string directly.

---

## BUG-TASK-002 — Strip discoveryTopic from GET /api/articles/[id] response

**Defect**: discoveryTopic leaks to client via article detail endpoint
**Prerequisites**: None

### What to build

`app/api/articles/[id]/route.ts` returns an article object verbatim from the
batch file, including the `discoveryTopic` internal field when it is present.
Strip this field before serializing the response, matching the pattern already
used in `app/api/feed/today/route.ts`.

Note: `GET /api/feed/today` already strips `discoveryTopic` correctly in both
its ranked and fallback paths — that route does not need to change.

### Files to modify

| Action | Path |
|--------|------|
| Modify | `app/api/articles/[id]/route.ts` |

### Implementation

In `app/api/articles/[id]/route.ts`, replace the final `return` statement:

**Before:**
```typescript
return NextResponse.json(article);
```

**After:**
```typescript
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { discoveryTopic: _dt, ...publicArticle } = article;
return NextResponse.json(publicArticle);
```

No other changes are needed in this file.

### Acceptance criteria

- [x] `GET /api/articles/[id]` for a discovery-sourced article does not include
  `discoveryTopic` in the response body.
- [x] `GET /api/articles/[id]` for a fixed-pipeline article (which never has
  `discoveryTopic` set) is functionally unchanged.
- [x] All other fields of the article object (`id`, `title`, `sourceName`,
  `sourceUrl`, `articleUrl`, `publishedAt`, `fetchedAt`, `batchDate`,
  `description`, `imageUrl`, `bodyText`, `feedbackSlot`) are present in the
  response and unchanged.
- [x] `npx tsc --noEmit` passes with no new errors.
- [ ] Manual verification: trigger a pipeline run that includes discovery
  articles, then call `GET /api/articles/[id]` for a discovery article ID and
  confirm `discoveryTopic` is absent from the JSON response.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Destructured `discoveryTopic` out of the article object before serializing the response, matching the identical pattern used in `app/api/feed/today/route.ts`.

---

## BUG-TASK-003 — Thread real deviceId through runDiscovery; fix upsertTopicWeight call

**Defect**: deviceId/userId confusion in topic weight upsert
**Prerequisites**: BUG-TASK-001 (modifies the same lines in run.ts)

### What to build

In `lib/discovery/run.ts`, `upsertTopicWeight` is called as:

```typescript
await upsertTopicWeight(userId, topicId, updated, userId);
```

The signature of `upsertTopicWeight` is:

```typescript
export async function upsertTopicWeight(
  deviceId: string,
  topicId: string,
  weight: number,
  userId?: string | null
): Promise<void>
```

This means `userId` is passed as the `deviceId` argument. As a result, weight
rows written during user-triggered runs have `device_id = userId` rather than
`device_id = <actual device id>`. The existing `getTopicWeightsForDevice` lookup
will never find these rows by real device ID, breaking device-scoped weight reads.

The fix is to thread the caller's `deviceId` through the `runDiscovery` function
and use it in the `upsertTopicWeight` call.

Additionally, the same `deviceId` must be passed to `setLastProcessedAt` (added
in BUG-TASK-001) to correctly scope the timestamp update.

### Files to modify

| Action | Path |
|--------|------|
| Modify | `lib/discovery/run.ts` |
| Modify | `lib/pipeline/run.ts` |

### Implementation

#### Step 1 — Update runDiscovery signature in lib/discovery/run.ts

Change the function signature from:

```typescript
export async function runDiscovery(
  fixedArticleUrls: Set<string>,
  userId?: string | null
): Promise<Article[]>
```

to:

```typescript
export async function runDiscovery(
  fixedArticleUrls: Set<string>,
  userId?: string | null,
  deviceId?: string | null
): Promise<Article[]>
```

The new `deviceId` parameter is optional and nullable to preserve backward
compatibility with the scheduled-run call path (which passes no `deviceId`).

#### Step 2 — Fix upsertTopicWeight call in lib/discovery/run.ts

Locate the line (currently around line 122):

```typescript
await upsertTopicWeight(userId, topicId, updated, userId);
```

Replace it with:

```typescript
await upsertTopicWeight(deviceId ?? userId ?? 'unknown', topicId, updated, userId);
```

Explanation of the fallback chain:
- `deviceId` is the real device ID when passed from a manual refresh call.
- `userId` as fallback preserves the prior behavior for any code path that does
  not yet pass `deviceId` (scheduled runs use the averaged path, so this branch
  is only reached for user-triggered runs where `deviceId` should be present).
- `'unknown'` is a last-resort guard; the `NOT NULL` constraint on `device_id`
  prevents the upsert from failing.

#### Step 3 — Fix setLastProcessedAt call in lib/discovery/run.ts

Locate the `setLastProcessedAt` call added in BUG-TASK-001:

```typescript
await setLastProcessedAt(userId, userId);  // BUG-TASK-001 left userId as placeholder
```

Replace it with:

```typescript
await setLastProcessedAt(userId, deviceId ?? userId ?? 'unknown');
```

#### Step 4 — Update lib/pipeline/run.ts call site

In `lib/pipeline/run.ts`, `runDiscovery` is called at line 131:

```typescript
discoveryArticles = await runDiscovery(fixedArticleUrls, options.userId ?? null);
```

The `RunOptions` interface does not currently carry a `deviceId`. Add it:

```typescript
export interface RunOptions {
  /** When true, overwrites an existing same-day batch. Default: false. */
  forceOverwrite?: boolean;
  /** When set, the discovery topic selection uses this user's topic weights. */
  userId?: string | null;
  /** When set, topic weight upserts use this device ID (required for correct upsert keying). */
  deviceId?: string | null;
}
```

Update the `runDiscovery` call to pass `options.deviceId`:

```typescript
discoveryArticles = await runDiscovery(
  fixedArticleUrls,
  options.userId ?? null,
  options.deviceId ?? null
);
```

#### Step 5 — Pass deviceId into RunOptions from the refresh route

In `app/api/feed/refresh/route.ts`, locate where `runPipeline` is called and
ensure `deviceId` is included in the options. The device ID is available from the
request cookie `dd_device_id`. If the refresh route does not currently read this
cookie, add it:

```typescript
const deviceId = req.cookies.get('dd_device_id')?.value ?? null;
// ... when calling runPipeline:
await runPipeline({ forceOverwrite: true, userId: session.userId, deviceId });
```

If `app/api/pipeline/run/route.ts` (the scheduled cron route) calls `runPipeline`
without a `userId`, no change is needed there — `runDiscovery` takes the
averaged-weights path when `userId` is null, and the `upsertTopicWeight` branch
is not reached in that path.

### Acceptance criteria

- [x] `runDiscovery` signature accepts a third optional `deviceId?: string | null`
  parameter.
- [x] `upsertTopicWeight` is called with `deviceId ?? userId ?? 'unknown'` as the
  first argument, not `userId`.
- [x] `setLastProcessedAt` is called with `deviceId ?? userId ?? 'unknown'` as the
  `deviceId` argument.
- [x] `RunOptions` in `lib/pipeline/run.ts` includes `deviceId?: string | null`.
- [x] `runDiscovery` is called from `runPipeline` with `options.deviceId ?? null`
  as the third argument.
- [x] `app/api/feed/refresh/route.ts` reads `dd_device_id` from the request cookie
  and passes it as `deviceId` in the `RunOptions` to `runPipeline`.
- [ ] After a manual refresh by an authenticated user, a row in
  `discovery_topic_weights` has `device_id` equal to the user's actual device ID
  (not their `user_id`). Verify by inspecting the DB after a test refresh.
- [x] `getTopicWeightsForDevice(deviceId)` returns the user's weight rows when
  queried with the real device ID. (Verify by code inspection: the `device_id`
  written matches what `getTopicWeightsForDevice` queries on.)
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Added `deviceId?: string | null` to `runDiscovery` signature, `RunOptions` interface, and the `runDiscovery` call in `runPipeline`. Fixed `upsertTopicWeight` and `setLastProcessedAt` call sites to use `deviceId ?? userId ?? 'unknown'`. Updated `app/api/feed/refresh/route.ts` to read `dd_device_id` cookie and pass it as `deviceId`. One DB-inspection criterion requires a live test refresh and is left unchecked (cannot be automated here).
