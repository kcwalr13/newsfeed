# Technical Design — Feed Refresh and Source Diversity (Milestone 5)

**ID**: ARCH-DESIGN-006
**Stories Reference**: `agents/pm/stories_feed_refresh_and_diversity_v1.md` (REFRESH-001 through REFRESH-011)
**BRD Reference**: `agents/ba/brd_feed_refresh_and_diversity_v1.md` (BRD-005)
**Date**: 2026-04-04
**Status**: Final
**Author**: Architect Agent

---

## Table of Contents

1. Scope Overview
2. Configuration Constants
3. Source Diversity: Per-Source Article Cap
4. Source Diversity: Failure Isolation
5. Source Diversity: Degraded-Mode Logging
6. Pipeline Changes Summary
7. Cooldown Storage: Architecture Decision
8. Cooldown Tracker Module
9. Co-Day Batch Management
10. POST /api/feed/refresh Route
11. FeedResponse Type: Exposing generatedAt
12. GET /api/feed/today Route Update
13. UI: LastUpdatedLabel Component
14. UI: RefreshButton Component
15. Feed Page Integration
16. What Does NOT Change
17. Deferred Items

---

## 1. Scope Overview

Milestone 5 delivers two related capabilities:

**Manual Refresh**: Authenticated users gain a "Refresh" button in the feed header. Tapping it calls `POST /api/feed/refresh`, which enforces a 15-minute per-user cooldown and then runs the full pipeline (same logic as the scheduled run). The feed updates in-place on success; existing content is preserved on failure. A "Last updated" label shows the timestamp of the most recent successful run to all users.

**Source Diversity**: The pipeline acquires three new behavioral guarantees enforced on every run (scheduled or manual): (1) no single source contributes more than `MAX_ARTICLES_PER_SOURCE` articles to a batch; (2) at least `MIN_SOURCES_PER_BATCH` distinct sources must contribute; (3) a single source failure never aborts the entire run. If fewer than the minimum sources contribute, the pipeline still writes the batch but emits a warning-level log entry.

All pipeline changes apply equally to the scheduled trigger (`POST /api/pipeline/run`) and the new manual trigger (`POST /api/feed/refresh`). There is one pipeline code path.

---

## 2. Configuration Constants

**Decision**: All three new pipeline-behavior constants live in `lib/pipeline/config.ts` alongside the existing `ARTICLES_PER_DAY`, `BATCH_DIR`, `SOURCES_PATH`, and `LOG_PATH` constants.

**Rationale**: `config.ts` is already the home for pipeline infrastructure constants. Ranker constants live in `ranker.ts` because they are algorithm-specific and only used by that module. The new diversity constants are pipeline-orchestration constants used by `run.ts`, making `config.ts` the correct home. Centralizing all three in one file means an operator changing the source configuration only needs to look in one place.

The three constants to add to `lib/pipeline/config.ts`:

```typescript
/** Maximum number of articles any single source may contribute to one batch.
 *  Enforced after deduplication. Excess articles are discarded (highest-scored
 *  kept via the order returned by the adapter — adapters return newest-first).
 */
export const MAX_ARTICLES_PER_SOURCE: number = process.env.MAX_ARTICLES_PER_SOURCE
  ? parseInt(process.env.MAX_ARTICLES_PER_SOURCE, 10)
  : 5;

/** Minimum number of distinct active sources that must each contribute at least
 *  one article for a batch to meet the diversity requirement. If fewer sources
 *  contribute, the pipeline still writes the batch but logs a warning.
 */
export const MIN_SOURCES_PER_BATCH: number = process.env.MIN_SOURCES_PER_BATCH
  ? parseInt(process.env.MIN_SOURCES_PER_BATCH, 10)
  : 3;

/** Cooldown between manual refresh requests per authenticated user, in minutes. */
export const REFRESH_COOLDOWN_MINUTES: number = process.env.REFRESH_COOLDOWN_MINUTES
  ? parseInt(process.env.REFRESH_COOLDOWN_MINUTES, 10)
  : 15;
```

All three follow the existing `ARTICLES_PER_DAY` pattern: an env-var override for operator configuration without a code deploy, with a hardcoded default as a fallback. The constants are exported so both `run.ts` and the new `lib/pipeline/cooldown.ts` module can import them without circular dependencies.

---

## 3. Source Diversity: Per-Source Article Cap

**Decision**: The per-source cap is enforced inside `lib/pipeline/run.ts` after all sources have been fetched and after cross-source deduplication, but before `validateAndTrim` trims to `ARTICLES_PER_DAY`.

**Why after deduplication, before trim**: The PM story explicitly requires the cap to be applied after deduplication. An article deduplicated away does not count toward the source's cap. The cap is a ceiling on how many unique articles from a source enter the final batch — enforcing it before the final trim ensures the trim step draws from a fairly-capped pool.

**Which articles are kept when a source exceeds the cap**: The adapters already return articles in the order the source publishes them, which is newest-first for RSS (via `pubDate`) and NewsAPI (by `publishedAt` sort order from the API). The pipeline currently processes them in that order. After deduplication, taking the first `MAX_ARTICLES_PER_SOURCE` from each source preserves recency-bias without any additional sort.

**Implementation inside `runPipeline()`** in `lib/pipeline/run.ts`:

After the existing `const candidates = results.flat()` line, and before calling `validateAndTrim`, add a per-source cap pass:

```typescript
// Step: Enforce per-source article cap (after cross-source dedup)
// Group by source name, keep only the first MAX_ARTICLES_PER_SOURCE per source.
// This runs before validateAndTrim so the trim draws from a fairly-capped pool.
function applySourceCap(
  articles: PartialArticle[],
  cap: number
): PartialArticle[] {
  const countBySource = new Map<string, number>();
  return articles.filter((a) => {
    const count = countBySource.get(a.sourceName) ?? 0;
    if (count >= cap) return false;
    countBySource.set(a.sourceName, count + 1);
    return true;
  });
}
```

The `results` from `Promise.allSettled` (see Section 4) are per-source arrays. Cross-source deduplication happens inside `validateAndTrim` today. To preserve the correct order of operations (dedup first, then cap), a small adjustment is needed:

1. Extract dedup logic from `validateAndTrim` or run a dedup pass before capping.
2. The cleaner approach: run a URL-dedup pass inline in `runPipeline`, then apply the source cap, then call `validateAndTrim` (which still deduplicates — a no-op at that point since URLs are already unique, but it continues to validate titles/URLs and trim to limit).

The inline dedup pass in `runPipeline`:

```typescript
// Deduplicate by articleUrl across all sources (first occurrence wins)
const seenUrls = new Set<string>();
const deduped = candidates.filter((a) => {
  if (!a.articleUrl || seenUrls.has(a.articleUrl)) return false;
  seenUrls.add(a.articleUrl);
  return true;
});

// Apply per-source cap after deduplication
const capped = applySourceCap(deduped, MAX_ARTICLES_PER_SOURCE);

// validateAndTrim now just validates (titles/URLs) and trims to ARTICLES_PER_DAY
const validated = validateAndTrim(capped, ARTICLES_PER_DAY);
```

`validateAndTrim` already handles URL deduplication safely — with unique URLs already present, its dedup pass becomes a no-op, so there is no double-dedup bug. No changes to `validator.ts` are needed.

---

## 4. Source Diversity: Failure Isolation

**Current state**: `run.ts` uses `Promise.all(sources.map(fetchFromSource))`. Both adapters already catch their own errors and return empty arrays on failure (`rssAdapter.ts` has a try/catch; `newsApiAdapter.ts` does the same). This means the current code already tolerates per-source failures gracefully — a source throwing an exception becomes an empty array in `results`, and the pipeline continues.

**What is missing**: The pipeline does not currently log per-source failures with the source name, and it does not check whether enough sources contributed after aggregation. These are the two gaps to close.

**Decision**: Change `Promise.all` to `Promise.allSettled` to be defensively explicit about per-source isolation, even though the adapters already swallow errors. This ensures that if a future adapter change accidentally throws a top-level exception, the pipeline still does not abort.

**Updated fetch loop in `runPipeline()`**:

```typescript
const sources = loadSources();
const settled = await Promise.allSettled(sources.map(fetchFromSource));

const results: PartialArticle[][] = settled.map((outcome, i) => {
  if (outcome.status === 'rejected') {
    const reason = outcome.reason instanceof Error
      ? outcome.reason.message
      : String(outcome.reason);
    appendLog(
      `[pipeline] Source "${sources[i].slug}" failed: ${reason}`
    );
    return [];
  }
  return outcome.value;
});

const candidates = results.flat();
```

After the dedup and cap passes, check how many sources actually contributed at least one article:

```typescript
// Count contributing sources (after dedup + cap, before trim)
const contributingSourceNames = new Set(capped.map((a) => a.sourceName));
const contributingCount = contributingSourceNames.size;
```

This check is deferred until after the cap pass to avoid counting sources whose only articles were removed by deduplication or capping. The `capped` array is the correct set to measure.

---

## 5. Source Diversity: Degraded-Mode Logging

After counting contributing sources, log a warning if the minimum is not met:

```typescript
if (contributingCount < MIN_SOURCES_PER_BATCH) {
  const failedSources = sources
    .filter((s) => !contributingSourceNames.has(s.name))
    .map((s) => s.slug);
  appendLog(
    `[pipeline] DIVERSITY WARNING: Only ${contributingCount}/${MIN_SOURCES_PER_BATCH} ` +
    `required sources contributed. ` +
    `Contributing: [${[...contributingSourceNames].join(', ')}]. ` +
    `Failed/empty: [${failedSources.join(', ')}].`
  );
}
```

The warning is not a thrown error. The pipeline proceeds to write the batch regardless. This satisfies REFRESH-011: operator-visible log warning, no user-facing message, batch still served.

The per-source failure log (from Section 4) is written at the time of the per-source failure. The diversity warning is written at the end of the run when the final contributing count is known. These are distinct log lines, satisfying the PM requirement that the two warnings be separable.

---

## 6. Pipeline Changes Summary

All changes to `lib/pipeline/run.ts` in order of execution:

1. Import `MAX_ARTICLES_PER_SOURCE`, `MIN_SOURCES_PER_BATCH` from `./config`.
2. Add `applySourceCap` as a local helper function.
3. Change `Promise.all` to `Promise.allSettled` with per-source failure logging.
4. After `candidates = results.flat()`, add an inline URL-dedup pass.
5. After dedup, call `applySourceCap(deduped, MAX_ARTICLES_PER_SOURCE)`.
6. After cap, count contributing sources and emit a diversity warning if below minimum.
7. Call `validateAndTrim(capped, ARTICLES_PER_DAY)` (replaces the existing call).
8. Remove the `alreadyExists` early return guard. This guard currently prevents re-running the pipeline on the same day, which would block a same-day manual refresh. See Section 9 for the replacement strategy.

---

## 7. Cooldown Storage: Architecture Decision

**Decision**: Store per-user cooldown state in a JSON file at `data/refresh_cooldowns.json`.

**Why not in-memory**: The PM note in the stories document explicitly states the cooldown must survive server restarts. In-memory module-level variables reset on every Next.js cold start, which is frequent on serverless and preview deployments. A user who triggers a refresh and then the server restarts would bypass the cooldown on their next request. This is unacceptable.

**Why not a new DB table**: The project's architectural principle is "filesystem-first, zero infrastructure". Adding a DB table for cooldown state would require a migration, a new `lib/db/` helper file, and a dependency on the Neon connection for every refresh request. This is disproportionate for a piece of state that is a handful of key-value pairs.

**Why a JSON file in `data/`**: The `data/` directory already holds `pipeline.log` (append-only), `sources.json` (config), and `data/batches/` (daily JSON files). A small JSON file containing `{ [userId: string]: string }` (userId → ISO-8601 timestamp of last refresh) is consistent with the existing filesystem-first pattern. The file is small (one line per user who has ever triggered a manual refresh), read-write is synchronous (the same pattern used by `writeBatch` and `appendLog`), and it is git-ignored (same as `pipeline.log` and `batches/`).

**Concurrency concern**: Next.js API routes can execute concurrently. Two simultaneous refresh requests from the same user could both pass the cooldown check before either writes the cooldown record. This is a race condition. To mitigate it without adding a lock library:

The refresh route reads, checks, writes the cooldown file, and then kicks off the pipeline. The write happens before the pipeline starts. A second concurrent request that arrives after the write will be blocked. The window for a race is the time between the read and the write, which is synchronous (both read and write use `fs.readFileSync`/`fs.writeFileSync` — synchronous I/O on the same Node.js event loop thread). Because JavaScript is single-threaded on the event loop, synchronous file read-check-write is effectively atomic within a single process. On serverless (multiple instances), a race remains possible but the consequence is that the user triggers two pipeline runs within the cooldown window, not a security issue — just a minor UX inconsistency that is acceptable given the low-stakes nature of this cooldown.

**File location and format**:

```
data/refresh_cooldowns.json
```

Content:
```json
{
  "user_<uuid>": "2026-04-04T14:23:11.000Z",
  "user_<uuid2>": "2026-04-04T09:15:00.000Z"
}
```

Keys are `userId` strings (the same `user_id` values from the DB sessions table). Values are ISO-8601 UTC timestamps of the last successful refresh trigger. The file is created on first write if it does not exist.

---

## 8. Cooldown Tracker Module

A new file `lib/pipeline/cooldown.ts` encapsulates all cooldown read/write logic. This keeps `app/api/feed/refresh/route.ts` clean and makes the cooldown logic independently testable.

```typescript
// lib/pipeline/cooldown.ts

import fs from 'fs';
import path from 'path';
import { REFRESH_COOLDOWN_MINUTES } from './config';

const COOLDOWN_FILE = path.resolve(process.cwd(), 'data', 'refresh_cooldowns.json');

type CooldownStore = Record<string, string>; // userId → ISO-8601 timestamp

function readStore(): CooldownStore {
  if (!fs.existsSync(COOLDOWN_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf-8')) as CooldownStore;
  } catch {
    return {};
  }
}

function writeStore(store: CooldownStore): void {
  const dir = path.dirname(COOLDOWN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export interface CooldownStatus {
  allowed: boolean;
  secondsRemaining: number; // 0 when allowed
}

/**
 * Checks whether a user is allowed to trigger a refresh.
 * Does NOT update the cooldown record — call recordRefresh() after a
 * successful pipeline run to avoid consuming the cooldown on failure.
 */
export function checkCooldown(userId: string): CooldownStatus {
  const store = readStore();
  const lastRefresh = store[userId];
  if (!lastRefresh) return { allowed: true, secondsRemaining: 0 };

  const cooldownMs = REFRESH_COOLDOWN_MINUTES * 60 * 1000;
  const elapsed = Date.now() - new Date(lastRefresh).getTime();
  if (elapsed >= cooldownMs) return { allowed: true, secondsRemaining: 0 };

  const secondsRemaining = Math.ceil((cooldownMs - elapsed) / 1000);
  return { allowed: false, secondsRemaining };
}

/**
 * Records a successful refresh for the given user (updates the timestamp).
 * Call this only after a pipeline run completes successfully.
 * A failed run should NOT call this function so the user can retry immediately.
 */
export function recordRefresh(userId: string): void {
  const store = readStore();
  store[userId] = new Date().toISOString();
  writeStore(store);
}
```

Key behaviors:
- `checkCooldown` reads the file without writing — it is a pure read.
- `recordRefresh` is called only after a successful pipeline run. A failed run does not consume the cooldown (satisfying REFRESH-005 AC#4).
- If the cooldown file is corrupt or missing, `readStore` returns `{}` (fail-open — a user might get an extra refresh, but the experience is never broken).

---

## 9. Co-Day Batch Management

**Problem**: The existing `runPipeline()` has an early-return guard:
```typescript
if (readBatch(today) !== null) {
  return { batchDate: today, count: 0, alreadyExists: true };
}
```
This prevents a manual refresh from producing a new batch on the same day as the scheduled run.

**Decision**: Remove this guard from `runPipeline()` and replace it with overwrite support.

**How overwrite works**: `writeBatch()` in `storage.ts` currently refuses to overwrite an existing file and returns `false`. For manual refresh support, the pipeline needs to overwrite the file when triggered manually.

The cleanest approach is to pass an `options` argument to `runPipeline()`:

```typescript
export interface RunOptions {
  forceOverwrite?: boolean; // defaults to false
}

export async function runPipeline(options: RunOptions = {}): Promise<RunResult> {
  const today = todayUTC();

  try {
    if (!options.forceOverwrite && readBatch(today) !== null) {
      return { batchDate: today, count: 0, alreadyExists: true };
    }
    // ... rest of pipeline
```

And `writeBatch()` needs a corresponding `force` flag:

```typescript
export function writeBatch(batch: ArticleBatch, force = false): boolean {
  // ...
  if (!force && fs.existsSync(filePath)) return false;
  fs.writeFileSync(filePath, JSON.stringify(batch, null, 2), 'utf-8');
  return true;
}
```

In `runPipeline()`, call `writeBatch(batch, options.forceOverwrite ?? false)`.

**What `GET /api/feed/today` serves**: It calls `readBatch(today)`, which reads the file at `data/batches/YYYY-MM-DD.json`. When a manual refresh overwrites that file, the next call to `readBatch(today)` returns the new batch. The PM requirement is satisfied: the most recently completed run's output is what the client receives on the next feed load. No special routing or file renaming is needed.

**Scheduled pipeline route (`POST /api/pipeline/run`)**: Continues to call `runPipeline()` without `forceOverwrite`. If the scheduled job runs a second time the same day (duplicate cron trigger), the `alreadyExists` guard still fires. This is the correct behavior.

**Manual refresh route (`POST /api/feed/refresh`)**: Calls `runPipeline({ forceOverwrite: true })`. Every manual trigger rewrites the batch for today with fresh content.

**Personalization interaction**: M4's API-time ranking reads `batch.articles` at request time. When a manual refresh overwrites the batch file, the next call to `GET /api/feed/today` picks up the new file automatically. Per-identity ranking is applied at request time, so there is no per-identity file to update or invalidate. This is a natural benefit of the M4 architecture decision.

---

## 10. POST /api/feed/refresh Route

**File**: `app/api/feed/refresh/route.ts`

This is a new file. Its logic:

1. Resolve session using `resolveSession(req, tempRes)`. If no session, return 401.
2. Call `checkCooldown(session.userId)`. If not allowed, return 429 with `secondsRemaining`.
3. Log the manual refresh event with timestamp and userId.
4. Call `runPipeline({ forceOverwrite: true })`.
5. If pipeline succeeds: call `recordRefresh(session.userId)`, return 200 with `{ ok: true, batchDate, count, generatedAt }`.
6. If pipeline throws: log the failure with userId and error, return 500. Do NOT call `recordRefresh` (cooldown not consumed).

```typescript
// app/api/feed/refresh/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { resolveSession } from '@/lib/auth/session';
import { runPipeline } from '@/lib/pipeline/run';
import { checkCooldown, recordRefresh } from '@/lib/pipeline/cooldown';
import { appendLog } from '@/lib/pipeline/storage';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Auth check
  const tempRes = new NextResponse();
  const session = await resolveSession(req, tempRes);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Cooldown check
  const cooldown = checkCooldown(session.userId);
  if (!cooldown.allowed) {
    return NextResponse.json(
      {
        error: 'Refresh cooldown active',
        secondsRemaining: cooldown.secondsRemaining,
      },
      { status: 429 }
    );
  }

  // Log the manual refresh attempt
  appendLog(
    `[refresh] Manual refresh triggered by userId=${session.userId}`
  );

  // Run the pipeline
  try {
    const result = await runPipeline({ forceOverwrite: true });

    // Record cooldown only on success (failed refresh does not consume cooldown)
    recordRefresh(session.userId);

    appendLog(
      `[refresh] Manual refresh complete. userId=${session.userId} ` +
      `batchDate=${result.batchDate} count=${result.count}`
    );

    return NextResponse.json({
      ok: true,
      batchDate: result.batchDate,
      count: result.count,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    appendLog(
      `[refresh] Manual refresh failed. userId=${session.userId} error=${message}`
    );
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
```

**Latency**: The pipeline run is synchronous from the route's perspective (await `runPipeline()`). Based on the existing pipeline structure, a full run fetches from 4 sources concurrently via `Promise.allSettled`, validates, and writes. RSS + NewsAPI fetches typically complete in 1–5 seconds. The endpoint waits for completion before responding — this is intentional. The client shows a loading state during this time. No polling or async job tracking is needed; the pipeline is fast enough for a synchronous response. The PM requirement is that the client knows when the run completes, and a synchronous response satisfies this cleanly.

**Auth header forwarding**: The response does not need to forward the refreshed session cookie from `resolveSession` because the refresh endpoint does not extend the session window as a primary concern. The session was already refreshed by the most recent `GET /api/feed/today` call. If session refresh is desired here too, the same `tempRes`/`Set-Cookie` copy pattern from `GET /api/feed/today` can be applied — but it is not architecturally required.

---

## 11. FeedResponse Type: Exposing generatedAt

**Decision**: Add `generatedAt?: string` (optional, ISO-8601 UTC) to the `FeedResponse` interface.

**Why optional**: `FeedResponse` is returned when no batch exists (`{ batchDate: '', articles: [] }`), in which case there is no timestamp. Making it optional allows the same type to cover both cases without null-assertion gymnastics on the client.

**Change to `lib/types/article.ts`**:

```typescript
export interface FeedResponse {
  batchDate: string;
  articles: Article[];
  generatedAt?: string; // ISO-8601 UTC; absent if no batch exists
}
```

`ArticleBatch` already has `generatedAt: string` (non-optional) — no change needed there. The pipeline already writes it on every run.

---

## 12. GET /api/feed/today Route Update

**File**: `app/api/feed/today/route.ts`

The only change is to include `generatedAt` from the batch in the response body. The session cookie forwarding, identity resolution, and ranking logic from M4 are all unchanged.

```typescript
// In the success return path, replace:
return NextResponse.json(
  { batchDate: batch.batchDate, articles: rankedArticles },
  { headers }
);

// With:
return NextResponse.json(
  {
    batchDate: batch.batchDate,
    articles: rankedArticles,
    generatedAt: batch.generatedAt,
  },
  { headers }
);
```

The early-return no-batch path already returns `{ batchDate: '', articles: [] }` — `generatedAt` is absent (undefined), which is correct for the optional field.

The early-return DB-failure path also omits `generatedAt`, which is acceptable — the feed still renders.

---

## 13. UI: LastUpdatedLabel Component

**File**: `app/components/LastUpdatedLabel.tsx`

A new client component. It replaces (or supplements) `BatchLabel` in the feed header area. It is visible to all users (authenticated and anonymous). It updates reactively when `generatedAt` changes (e.g., after a manual refresh).

```tsx
'use client';

interface Props {
  generatedAt?: string; // ISO-8601 UTC; if undefined, renders nothing
}

export default function LastUpdatedLabel({ generatedAt }: Props) {
  if (!generatedAt) return null;

  const date = new Date(generatedAt);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const timeStr = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);

  const label = isToday
    ? `Last updated today at ${timeStr}`
    : `Last updated ${new Intl.DateTimeFormat(undefined, {
        month: 'long',
        day: 'numeric',
      }).format(date)} at ${timeStr}`;

  return (
    <p className="text-xs text-gray-400" aria-live="polite">
      {label}
    </p>
  );
}
```

Key points:
- Uses `new Intl.DateTimeFormat(undefined, ...)` — `undefined` as the locale argument uses the browser's locale. This formats in the user's local timezone automatically (the `Date` constructor parses ISO-8601 UTC and the formatter applies the local timezone offset).
- `aria-live="polite"` announces updates to screen readers after a successful refresh without interrupting.
- Renders nothing when `generatedAt` is absent — no fallback text.
- `isToday` comparison uses the local date, so "today" reflects the user's timezone, not UTC. This is the correct behavior for a "last updated" label.

**BatchLabel**: The existing `BatchLabel` component shows "Today's Digest" or "Latest Digest — April 3, 2026". It reads `batchDate` (a YYYY-MM-DD string) from the feed response. It remains in place. The `LastUpdatedLabel` is rendered below it as a secondary label. No changes to `BatchLabel` are needed.

---

## 14. UI: RefreshButton Component

**File**: `app/components/RefreshButton.tsx`

A new client component. It is only rendered when the user is authenticated (the feed page gates its rendering). It manages its own loading and cooldown state.

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';

interface Props {
  onRefreshSuccess: (generatedAt: string) => void;
  onRefreshError: (message: string) => void;
}

type ButtonState = 'idle' | 'loading' | 'cooldown';

export default function RefreshButton({ onRefreshSuccess, onRefreshError }: Props) {
  const [buttonState, setButtonState] = useState<ButtonState>('idle');
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  // Countdown ticker when in cooldown state
  useEffect(() => {
    if (buttonState !== 'cooldown' || secondsRemaining <= 0) return;
    const timer = setInterval(() => {
      setSecondsRemaining((s) => {
        if (s <= 1) {
          setButtonState('idle');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [buttonState, secondsRemaining]);

  const handleRefresh = useCallback(async () => {
    if (buttonState !== 'idle') return;
    setButtonState('loading');

    try {
      const res = await fetch('/api/feed/refresh', { method: 'POST' });
      const json = await res.json();

      if (res.ok) {
        setButtonState('idle');
        // Read generatedAt from the updated feed
        const feedRes = await fetch('/api/feed/today');
        if (feedRes.ok) {
          const feedJson = await feedRes.json();
          onRefreshSuccess(feedJson.generatedAt ?? '');
        }
      } else if (res.status === 429) {
        setSecondsRemaining(json.secondsRemaining ?? 900);
        setButtonState('cooldown');
      } else {
        setButtonState('idle');
        onRefreshError(json.error ?? 'Refresh failed. Please try again later.');
      }
    } catch {
      setButtonState('idle');
      onRefreshError('Refresh failed. Please try again later.');
    }
  }, [buttonState, onRefreshSuccess, onRefreshError]);

  const formatCooldown = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0
      ? `${m}m ${s > 0 ? `${s}s` : ''}`.trim()
      : `${s}s`;
  };

  if (buttonState === 'loading') {
    return (
      <button
        disabled
        aria-label="Refreshing feed…"
        aria-busy="true"
        className="flex items-center gap-1.5 text-sm text-gray-400 px-3 py-2 rounded-lg
                   border border-gray-200 cursor-not-allowed"
      >
        <svg
          className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Refreshing…
      </button>
    );
  }

  if (buttonState === 'cooldown') {
    return (
      <button
        disabled
        aria-label={`Refresh available in ${formatCooldown(secondsRemaining)}`}
        className="flex items-center gap-1.5 text-sm text-gray-400 px-3 py-2 rounded-lg
                   border border-gray-200 cursor-not-allowed"
      >
        Available in {formatCooldown(secondsRemaining)}
      </button>
    );
  }

  return (
    <button
      onClick={handleRefresh}
      aria-label="Refresh feed"
      className="flex items-center gap-1.5 text-sm text-gray-600 px-3 py-2 rounded-lg
                 border border-gray-200 hover:border-gray-300 hover:text-gray-900
                 transition-colors active:bg-gray-50"
    >
      <svg
        className="w-3.5 h-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      Refresh
    </button>
  );
}
```

Key design decisions:
- The refresh button fetches the updated feed after a successful pipeline run to get the new `generatedAt` timestamp. This avoids needing the pipeline route to return `generatedAt` in its response body (the batch file already has it; reading it via the existing feed API is the clean path).
- On 429, the component reads `secondsRemaining` from the response JSON and starts the countdown. Re-enabling happens automatically via the interval — no page reload needed.
- `animate-spin motion-reduce:animate-none` respects `prefers-reduced-motion`. Tailwind's `motion-reduce` variant handles this with zero custom CSS.
- Accessible: `aria-label` describes the button state at all times; `aria-busy` is set during loading; `aria-label` changes to include the countdown string when in cooldown.
- The component does not render if the user is not authenticated — that gate is in the feed page (Section 15), not this component.

---

## 15. Feed Page Integration

**File**: `app/page.tsx`

The feed page (`app/page.tsx`) needs:

1. Import `useAuth` from `AuthContext` to know whether to show the refresh button.
2. Add `generatedAt` to local state (extracted from `FeedResponse` which now carries it).
3. Render `LastUpdatedLabel` below `BatchLabel` (visible to all users).
4. Render `RefreshButton` in the header (visible only when `user` is non-null).
5. Wire `onRefreshSuccess` callback: receive the new `generatedAt` and the new articles, update state without a full page reload.
6. Wire `onRefreshError` callback: set an error banner message (do not replace the feed with `ErrorState` — the existing content must remain visible).

State additions:
```typescript
const [generatedAt, setGeneratedAt] = useState<string | undefined>(undefined);
const [refreshError, setRefreshError] = useState<string | null>(null);
```

`fetchFeed` update — after setting `data`, also set `generatedAt`:
```typescript
const json: FeedResponse = await res.json();
setData(json);
setGeneratedAt(json.generatedAt);
setStatus('success');
```

`onRefreshSuccess` handler:
```typescript
const handleRefreshSuccess = useCallback(async (newGeneratedAt: string) => {
  setRefreshError(null);
  // Re-fetch the full feed to update articles in-place
  try {
    const res = await fetch('/api/feed/today');
    if (res.ok) {
      const json: FeedResponse = await res.json();
      setData(json);
      setGeneratedAt(json.generatedAt ?? newGeneratedAt);
    }
  } catch {
    // Feed reload failed — update timestamp only (articles stay as-is)
    setGeneratedAt(newGeneratedAt);
  }
}, []);
```

`onRefreshError` handler:
```typescript
const handleRefreshError = useCallback((message: string) => {
  setRefreshError(message);
}, []);
```

Header update (add RefreshButton next to AccountIcon, only when authenticated):
```tsx
<div className="max-w-2xl mx-auto px-4 py-4 flex justify-between items-center">
  <h1 className="text-xl font-bold text-gray-900 tracking-tight">Tangent</h1>
  <div className="flex items-center gap-2">
    {user && !loading && (
      <RefreshButton
        onRefreshSuccess={handleRefreshSuccess}
        onRefreshError={handleRefreshError}
      />
    )}
    <AccountIcon />
  </div>
</div>
```

Refresh error banner (below header, above BatchLabel, dismissible):
```tsx
{refreshError && (
  <div
    role="alert"
    className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg
               text-sm text-red-700 flex justify-between items-start gap-2"
  >
    <span>{refreshError}</span>
    <button
      onClick={() => setRefreshError(null)}
      aria-label="Dismiss error"
      className="text-red-400 hover:text-red-600 shrink-0"
    >
      ✕
    </button>
  </div>
)}
```

`LastUpdatedLabel` rendering (below `BatchLabel`, visible to all):
```tsx
<BatchLabel batchDate={data.batchDate} />
<LastUpdatedLabel generatedAt={generatedAt} />
```

---

## 16. What Does NOT Change

| Component | Status |
|-----------|--------|
| `lib/pipeline/validator.ts` | No changes. Its dedup logic becomes a no-op after the inline dedup pass in `run.ts`, but continues to validate titles/URLs and trim correctly. |
| `lib/pipeline/ranker.ts` | No changes. Rankings are applied at API time; pipeline changes do not affect it. |
| `lib/pipeline/storage.ts` | `writeBatch` receives a new optional `force` parameter (default `false`). Behavior is unchanged when called without the parameter. `readBatch`, `readLatestBatch`, `appendLog` are unchanged. |
| `lib/types/article.ts` | `FeedResponse` gains an optional `generatedAt` field. `Article` and `ArticleBatch` are unchanged. |
| `app/api/pipeline/run/route.ts` | No changes. Continues to call `runPipeline()` without `forceOverwrite`. |
| `app/api/articles/[id]/route.ts` | No changes. |
| `app/api/feedback/` routes | No changes. |
| `app/api/auth/` routes | No changes. |
| `app/components/BatchLabel.tsx` | No changes. Continues to show "Today's Digest" / "Latest Digest — date". |
| `app/components/AccountIcon.tsx` | No changes. |
| `app/components/ArticleCard.tsx` | No changes. |
| `app/components/AuthContext.tsx` | No changes. |
| `data/sources.json` | No changes. |
| `data/batches/` | Still one JSON file per day (YYYY-MM-DD.json). Manual refresh overwrites the same-day file. |
| `lib/db/` | No changes. No new DB tables. |
| `lib/auth/session.ts` | No changes. |
| Scheduled cron trigger behavior | No changes. Once-daily schedule is unchanged. |

---

## 17. Deferred Items

The following items are explicitly out of scope per the BRD and PM stories:

| Item | Reason |
|------|--------|
| Per-user refresh history / dashboard | REFRESH-006 (operator logging via `appendLog` is sufficient for M5) |
| Push notifications on background refresh | Out of scope per BRD |
| Adding/removing sources via UI | Separate capability; source list is config-driven |
| Per-source cap adjustable per user | System-level config only |
| Real-time streaming | Pipeline remains batch-based |
| Idempotency key / request deduplication on the refresh endpoint | Low-stakes; server-side cooldown is sufficient |

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-04 | Architect Agent | Initial draft. Milestone 5 Feed Refresh and Source Diversity design. Filesystem cooldown store decision. Co-day batch overwrite strategy. Per-source cap in run.ts after dedup. Promise.allSettled for failure isolation. 11 tasks defined in tasks_feed_refresh_v1.md. |
