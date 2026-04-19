# Dev Task List — Feed Refresh and Source Diversity (Milestone 5)

**ID**: ARCH-TASKS-006
**Design Reference**: `agents/architect/design_feed_refresh_v1.md`
**Stories Reference**: `agents/pm/stories_feed_refresh_and_diversity_v1.md`
**Date**: 2026-04-04
**Status**: Complete — all 11 tasks shipped

---

## Dependency Order

```
REFRESH-TASK-001  (config.ts — 3 new constants)
  ├── REFRESH-TASK-002  (run.ts — cap + isolation + diversity warning + overwrite support)
  │     └── REFRESH-TASK-003  (cooldown.ts — new module)
  │           └── REFRESH-TASK-004  (POST /api/feed/refresh route)
  │                 └── REFRESH-TASK-007  (UI: RefreshButton component)
  │                       └── REFRESH-TASK-009  (Feed page integration)
  └── REFRESH-TASK-005  (FeedResponse type: add generatedAt)
        └── REFRESH-TASK-006  (GET /api/feed/today: include generatedAt)
              └── REFRESH-TASK-007  (UI: LastUpdatedLabel component — depends on type)
                    └── REFRESH-TASK-009  (Feed page integration)

REFRESH-TASK-009 (Feed page integration — depends on 004, 006, 007, 008)
  └── REFRESH-TASK-010  (Manual verification)
        └── REFRESH-TASK-011  (ARCHITECTURE.md update)
```

Tasks 001, 002, 005 have no inter-dependencies and can start immediately. Tasks 003 and 005 can be worked in parallel after 001 is done. Task 008 (LastUpdatedLabel) depends only on 005 (type update) and can be built in parallel with 004.

---

## REFRESH-TASK-001 — Add Pipeline Constants to config.ts

**[BLOCKER for REFRESH-TASK-002 and REFRESH-TASK-003]**
**Covers stories**: REFRESH-001, REFRESH-008, REFRESH-009

### What to build

Add three new exported constants to `lib/pipeline/config.ts`. Each follows the existing `ARTICLES_PER_DAY` pattern: env-var override with a hardcoded default fallback.

### Files to modify

| Action | Path |
|--------|------|
| Modify | `lib/pipeline/config.ts` |

### Implementation

Append the following three constants after the existing `LOG_PATH` and `loadSources` exports:

```typescript
/** Maximum number of articles any single source may contribute to one batch.
 *  Enforced after cross-source deduplication. The cap is a ceiling, not a target.
 *  Excess articles are discarded; the order returned by each adapter (newest-first)
 *  determines which articles are kept.
 */
export const MAX_ARTICLES_PER_SOURCE: number = process.env.MAX_ARTICLES_PER_SOURCE
  ? parseInt(process.env.MAX_ARTICLES_PER_SOURCE, 10)
  : 5;

/** Minimum number of distinct active sources that must each contribute at least
 *  one article to a batch. If fewer contribute, the batch is still written but
 *  a DIVERSITY WARNING is logged (see run.ts).
 */
export const MIN_SOURCES_PER_BATCH: number = process.env.MIN_SOURCES_PER_BATCH
  ? parseInt(process.env.MIN_SOURCES_PER_BATCH, 10)
  : 3;

/** Cooldown between manual refresh requests per authenticated user, in minutes.
 *  Enforced by lib/pipeline/cooldown.ts. Read by the /api/feed/refresh route.
 */
export const REFRESH_COOLDOWN_MINUTES: number = process.env.REFRESH_COOLDOWN_MINUTES
  ? parseInt(process.env.REFRESH_COOLDOWN_MINUTES, 10)
  : 15;
```

### Acceptance criteria

- [ ] `lib/pipeline/config.ts` exports `MAX_ARTICLES_PER_SOURCE` (default 5).
- [ ] `lib/pipeline/config.ts` exports `MIN_SOURCES_PER_BATCH` (default 3).
- [ ] `lib/pipeline/config.ts` exports `REFRESH_COOLDOWN_MINUTES` (default 15).
- [ ] All three constants read from env vars when present (same pattern as `ARTICLES_PER_DAY`).
- [ ] `npx tsc --noEmit` passes with no new type errors.

---

## REFRESH-TASK-002 — Pipeline Changes: Cap, Isolation, Diversity Warning, Overwrite

**[BLOCKER for REFRESH-TASK-003]**
**Covers stories**: REFRESH-004, REFRESH-008, REFRESH-009, REFRESH-010, REFRESH-011
**Prerequisites**: REFRESH-TASK-001

### What to build

Update `lib/pipeline/run.ts` with four changes:
1. `Promise.allSettled` for per-source failure isolation with per-source failure logging.
2. Inline URL deduplication pass before the source cap.
3. Per-source article cap enforcement using `MAX_ARTICLES_PER_SOURCE`.
4. Diversity warning using `MIN_SOURCES_PER_BATCH` after the cap.
5. `RunOptions` interface and `forceOverwrite` support (to allow same-day rewrites for manual refresh).

### Files to modify

| Action | Path |
|--------|------|
| Modify | `lib/pipeline/run.ts` |
| Modify | `lib/pipeline/storage.ts` |

### Implementation — lib/pipeline/run.ts

Replace the full file with this implementation:

```typescript
import crypto from 'crypto';
import { ARTICLES_PER_DAY, MAX_ARTICLES_PER_SOURCE, MIN_SOURCES_PER_BATCH, loadSources } from './config';
import { writeBatch, readBatch, appendLog } from './storage';
import { fetchRssArticles } from './adapters/rssAdapter';
import { fetchNewsApiArticles } from './adapters/newsApiAdapter';
import { validateAndTrim } from './validator';
import type { Article, ArticleBatch, Source } from '../types/article';

export interface RunOptions {
  /** When true, overwrites an existing same-day batch. Default: false. */
  forceOverwrite?: boolean;
}

export interface RunResult {
  batchDate: string;
  count: number;
  alreadyExists: boolean;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function makeId(sourceName: string, articleUrl: string): string {
  const sourceSlug = slugify(sourceName);
  const hash = crypto.createHash('sha256').update(articleUrl).digest('hex').slice(0, 8);
  return `${sourceSlug}-${hash}`;
}

async function fetchFromSource(source: Source) {
  if (source.type === 'rss') return fetchRssArticles(source);
  if (source.type === 'newsapi') return fetchNewsApiArticles(source);
  return [];
}

type PartialArticle = Omit<Article, 'id' | 'batchDate' | 'feedbackSlot'>;

function applySourceCap(articles: PartialArticle[], cap: number): PartialArticle[] {
  const countBySource = new Map<string, number>();
  return articles.filter((a) => {
    const count = countBySource.get(a.sourceName) ?? 0;
    if (count >= cap) return false;
    countBySource.set(a.sourceName, count + 1);
    return true;
  });
}

/**
 * Runs the full content pipeline: fetches from all active sources, validates,
 * deduplicates, applies per-source cap, checks diversity, and writes the batch.
 *
 * @param options.forceOverwrite - If true, overwrites an existing same-day batch.
 *   Use for manual refresh. Default: false (scheduled pipeline behavior).
 */
export async function runPipeline(options: RunOptions = {}): Promise<RunResult> {
  const today = todayUTC();

  try {
    // Guard: skip if batch already exists (unless explicitly overwriting)
    if (!options.forceOverwrite && readBatch(today) !== null) {
      return { batchDate: today, count: 0, alreadyExists: true };
    }

    const sources = loadSources();

    // Fetch from all sources with per-source failure isolation
    const settled = await Promise.allSettled(sources.map(fetchFromSource));
    const results: PartialArticle[][] = settled.map((outcome, i) => {
      if (outcome.status === 'rejected') {
        const reason =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
        appendLog(`[pipeline] Source "${sources[i].slug}" failed: ${reason}`);
        return [];
      }
      return outcome.value;
    });

    const candidates = results.flat();

    // Cross-source URL deduplication (first occurrence wins)
    const seenUrls = new Set<string>();
    const deduped = candidates.filter((a) => {
      if (!a.articleUrl || seenUrls.has(a.articleUrl)) return false;
      seenUrls.add(a.articleUrl);
      return true;
    });

    // Per-source article cap (applied after dedup, per PM requirement)
    const capped = applySourceCap(deduped, MAX_ARTICLES_PER_SOURCE);

    // Diversity check — log warning if below minimum (do not abort)
    const contributingSourceNames = new Set(capped.map((a) => a.sourceName));
    const contributingCount = contributingSourceNames.size;
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

    // Validate (titles/URLs) and trim to target batch size
    const validated = validateAndTrim(capped, ARTICLES_PER_DAY);

    const articles: Article[] = validated.map((a) => ({
      ...a,
      id: makeId(a.sourceName, a.articleUrl),
      batchDate: today,
      feedbackSlot: null,
    }));

    const batch: ArticleBatch = {
      batchDate: today,
      generatedAt: new Date().toISOString(),
      articles,
    };

    writeBatch(batch, options.forceOverwrite ?? false);
    appendLog(`[pipeline] Run complete. batchDate=${today} count=${articles.length}`);

    return { batchDate: today, count: articles.length, alreadyExists: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendLog(`[pipeline] Run failed: ${message}`);
    throw err;
  }
}
```

### Implementation — lib/pipeline/storage.ts

Update `writeBatch` to accept an optional `force` parameter:

```typescript
/**
 * Writes a batch to data/batches/<batchDate>.json.
 * Creates the batches directory if it does not exist.
 * When force is false (default), does NOT overwrite an existing file.
 * Returns true if the file was written successfully.
 */
export function writeBatch(batch: ArticleBatch, force = false): boolean {
  if (!fs.existsSync(BATCH_DIR)) {
    fs.mkdirSync(BATCH_DIR, { recursive: true });
  }
  const filePath = path.join(BATCH_DIR, `${batch.batchDate}.json`);
  if (!force && fs.existsSync(filePath)) {
    return false;
  }
  fs.writeFileSync(filePath, JSON.stringify(batch, null, 2), 'utf-8');
  return true;
}
```

All existing callers of `writeBatch` call it without a second argument, so they default to `force = false` — behavior unchanged.

### Acceptance criteria

- [ ] `runPipeline()` (no options) behaves identically to before for the scheduled pipeline: if a batch exists for today, returns `alreadyExists: true`.
- [ ] `runPipeline({ forceOverwrite: true })` overwrites an existing same-day batch file.
- [ ] If source A throws an unhandled exception, `Promise.allSettled` catches it, logs `[pipeline] Source "source-slug" failed: ...`, and the pipeline continues with the remaining sources.
- [ ] After deduplication, if source X contributed 7 articles and `MAX_ARTICLES_PER_SOURCE = 5`, only 5 of source X's articles appear in the validated batch.
- [ ] The per-source cap is applied after deduplication: a URL that was deduplicated away does not count toward the source's cap.
- [ ] A source that contributes 3 articles (below the cap) is unaffected — all 3 articles are present.
- [ ] When only 2 sources contribute and `MIN_SOURCES_PER_BATCH = 3`, `data/pipeline.log` contains a line matching `DIVERSITY WARNING`.
- [ ] When 3 or more sources contribute, no diversity warning is emitted.
- [ ] The batch is still written and served when the diversity warning fires (no thrown error).
- [ ] `writeBatch(batch)` (no force) continues to refuse overwriting an existing file.
- [ ] `writeBatch(batch, true)` overwrites an existing file.
- [ ] `npx tsc --noEmit` passes.

---

## REFRESH-TASK-003 — Create lib/pipeline/cooldown.ts

**[BLOCKER for REFRESH-TASK-004]**
**Covers stories**: REFRESH-001, REFRESH-003, REFRESH-005
**Prerequisites**: REFRESH-TASK-001

### What to build

Create `lib/pipeline/cooldown.ts` — the per-user cooldown tracker. Reads and writes `data/refresh_cooldowns.json`. Exported interface: `checkCooldown(userId)` and `recordRefresh(userId)`.

### Files to create

| Action | Path |
|--------|------|
| Create | `lib/pipeline/cooldown.ts` |

### Implementation

```typescript
import fs from 'fs';
import path from 'path';
import { REFRESH_COOLDOWN_MINUTES } from './config';

const COOLDOWN_FILE = path.resolve(process.cwd(), 'data', 'refresh_cooldowns.json');

type CooldownStore = Record<string, string>; // userId → ISO-8601 UTC timestamp

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
  /** true if the user is allowed to trigger a refresh now. */
  allowed: boolean;
  /** Seconds until the cooldown expires. 0 when allowed is true. */
  secondsRemaining: number;
}

/**
 * Checks whether the given userId may trigger a manual refresh.
 * Does NOT write to the cooldown store. Call recordRefresh() separately
 * only after a successful pipeline run.
 */
export function checkCooldown(userId: string): CooldownStatus {
  const store = readStore();
  const lastRefresh = store[userId];
  if (!lastRefresh) return { allowed: true, secondsRemaining: 0 };

  const cooldownMs = REFRESH_COOLDOWN_MINUTES * 60 * 1000;
  const elapsed = Date.now() - new Date(lastRefresh).getTime();
  if (elapsed >= cooldownMs) return { allowed: true, secondsRemaining: 0 };

  return { allowed: false, secondsRemaining: Math.ceil((cooldownMs - elapsed) / 1000) };
}

/**
 * Records that the given userId has triggered a successful refresh.
 * Starts the cooldown window. Must only be called after a successful
 * pipeline run — do NOT call on failure so the user can retry immediately.
 */
export function recordRefresh(userId: string): void {
  const store = readStore();
  store[userId] = new Date().toISOString();
  writeStore(store);
}
```

### Acceptance criteria

- [ ] `lib/pipeline/cooldown.ts` is created and exports `checkCooldown` and `recordRefresh`.
- [ ] `checkCooldown(userId)` returns `{ allowed: true, secondsRemaining: 0 }` when the file does not exist.
- [ ] `checkCooldown(userId)` returns `{ allowed: true, secondsRemaining: 0 }` when the user's last refresh was more than `REFRESH_COOLDOWN_MINUTES` minutes ago.
- [ ] `checkCooldown(userId)` returns `{ allowed: false, secondsRemaining: N }` when N > 0 seconds remain in the cooldown window.
- [ ] `recordRefresh(userId)` writes the current UTC timestamp to `data/refresh_cooldowns.json` under the user's ID key.
- [ ] A second call to `recordRefresh` for the same user overwrites the previous timestamp (does not append).
- [ ] If `data/refresh_cooldowns.json` does not exist, `recordRefresh` creates it.
- [ ] If `data/refresh_cooldowns.json` is corrupt, `checkCooldown` returns `allowed: true` (fail-open).
- [ ] `REFRESH_COOLDOWN_MINUTES` is read from `lib/pipeline/config.ts` — the value is not hardcoded in this file.
- [ ] `npx tsc --noEmit` passes.

---

## REFRESH-TASK-004 — Create POST /api/feed/refresh Route

**[BLOCKER for REFRESH-TASK-009]**
**Covers stories**: REFRESH-003, REFRESH-004, REFRESH-005
**Prerequisites**: REFRESH-TASK-002, REFRESH-TASK-003

### What to build

Create `app/api/feed/refresh/route.ts` — the manual refresh endpoint. Auth-gated, cooldown-enforced, delegates to `runPipeline({ forceOverwrite: true })`.

### Files to create

| Action | Path |
|--------|------|
| Create | `app/api/feed/refresh/route.ts` |

### Implementation

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { resolveSession } from '@/lib/auth/session';
import { runPipeline } from '@/lib/pipeline/run';
import { checkCooldown, recordRefresh } from '@/lib/pipeline/cooldown';
import { appendLog } from '@/lib/pipeline/storage';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Auth check — must have a valid session
  const tempRes = new NextResponse();
  const session = await resolveSession(req, tempRes);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Cooldown check — enforce per-user 15-minute window
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
  appendLog(`[refresh] Manual refresh triggered. userId=${session.userId}`);

  // Run the full pipeline with overwrite enabled
  try {
    const result = await runPipeline({ forceOverwrite: true });

    // Record cooldown ONLY after success — failed refresh does not consume cooldown
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

### Acceptance criteria

- [ ] `POST /api/feed/refresh` with no session cookie returns HTTP 401.
- [ ] `POST /api/feed/refresh` with a valid session and no prior cooldown runs the pipeline and returns `{ ok: true, batchDate, count }`.
- [ ] After a successful refresh, the cooldown is recorded — a second immediate request returns HTTP 429 with `secondsRemaining`.
- [ ] The 429 body contains a `secondsRemaining` field (integer, seconds until cooldown expires).
- [ ] If the pipeline throws an error, the endpoint returns HTTP 500 with `{ ok: false, error: string }`.
- [ ] After a failed pipeline run, `checkCooldown` still returns `allowed: true` — no cooldown was recorded.
- [ ] `data/pipeline.log` contains a `[refresh] Manual refresh triggered. userId=...` line on every attempt (before the pipeline runs).
- [ ] `data/pipeline.log` contains a `[refresh] Manual refresh complete` line on success.
- [ ] `data/pipeline.log` contains a `[refresh] Manual refresh failed` line on error.
- [ ] Manual verification: `POST /api/pipeline/run` (the scheduled route) still requires `Authorization: Bearer <CRON_SECRET>` and is unaffected by this change.
- [ ] `npx tsc --noEmit` passes.

---

## REFRESH-TASK-005 — Add generatedAt to FeedResponse Type

**[BLOCKER for REFRESH-TASK-006 and REFRESH-TASK-008]**
**Covers stories**: REFRESH-002, REFRESH-006
**Prerequisites**: none (independent of REFRESH-TASK-001)

### What to build

Add an optional `generatedAt` field to the `FeedResponse` interface in `lib/types/article.ts`.

### Files to modify

| Action | Path |
|--------|------|
| Modify | `lib/types/article.ts` |

### Implementation

Update the `FeedResponse` interface:

```typescript
/** The response shape returned by GET /api/feed/today. */
export interface FeedResponse {
  /** YYYY-MM-DD date of the batch being returned. Empty string if no batch exists. */
  batchDate: string;
  /** Ordered list of articles for the day. */
  articles: Article[];
  /**
   * ISO-8601 UTC timestamp of when the most recent successful pipeline run completed.
   * Absent when no batch exists (initial state before any pipeline run).
   * Clients should format this to local time for display.
   */
  generatedAt?: string;
}
```

No changes to `Article` or `ArticleBatch` — they are correct as-is.

### Acceptance criteria

- [ ] `FeedResponse` has a new optional field `generatedAt?: string`.
- [ ] `ArticleBatch.generatedAt` is unchanged (non-optional string — every batch on disk has it).
- [ ] `Article` type is unchanged.
- [ ] No existing call sites break (the field is additive / optional).
- [ ] `npx tsc --noEmit` passes.

---

## REFRESH-TASK-006 — Include generatedAt in GET /api/feed/today Response

**[BLOCKER for REFRESH-TASK-009]**
**Covers stories**: REFRESH-002
**Prerequisites**: REFRESH-TASK-005

### What to build

Update `app/api/feed/today/route.ts` to include `batch.generatedAt` in the response body.

### Files to modify

| Action | Path |
|--------|------|
| Modify | `app/api/feed/today/route.ts` |

### Implementation

The only change is in the two success return statements — add `generatedAt: batch.generatedAt` to the response JSON. The file has two paths that return batch data (one for the DB-failure degraded path, one for the normal ranked path). Both should include `generatedAt`.

Locate the return statement that currently reads:
```typescript
return NextResponse.json(
  { batchDate: batch.batchDate, articles: batch.articles },
  { headers: { 'Cache-Control': 'no-store' } }
);
```
(the DB-failure early return inside the catch block)

Update to:
```typescript
return NextResponse.json(
  { batchDate: batch.batchDate, articles: batch.articles, generatedAt: batch.generatedAt },
  { headers: { 'Cache-Control': 'no-store' } }
);
```

Locate the final return statement:
```typescript
return NextResponse.json(
  { batchDate: batch.batchDate, articles: rankedArticles },
  { headers }
);
```

Update to:
```typescript
return NextResponse.json(
  { batchDate: batch.batchDate, articles: rankedArticles, generatedAt: batch.generatedAt },
  { headers }
);
```

The no-batch early return `{ batchDate: '', articles: [] }` does not include `generatedAt` (field absent = undefined) — this is correct behavior per the type definition.

### Acceptance criteria

- [ ] `GET /api/feed/today` response includes `generatedAt` (ISO-8601 UTC string) when a batch exists.
- [ ] `GET /api/feed/today` response omits `generatedAt` (field absent) when no batch exists.
- [ ] The `generatedAt` value matches the `generatedAt` field in the corresponding `data/batches/YYYY-MM-DD.json` file.
- [ ] Response shape is still `FeedResponse` — no extra fields, no removed fields.
- [ ] `npx tsc --noEmit` passes.
- [ ] `curl -s http://localhost:3000/api/feed/today | jq '.generatedAt'` prints an ISO-8601 string (not null).

---

## REFRESH-TASK-007 — Create LastUpdatedLabel UI Component

**Covers stories**: REFRESH-006
**Prerequisites**: REFRESH-TASK-005

### What to build

Create `app/components/LastUpdatedLabel.tsx` — a client component that displays a "Last updated" label in the user's local timezone. Visible to all users.

### Files to create

| Action | Path |
|--------|------|
| Create | `app/components/LastUpdatedLabel.tsx` |

### Implementation

```tsx
'use client';

interface Props {
  /** ISO-8601 UTC timestamp. If undefined/empty, renders nothing. */
  generatedAt?: string;
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

### Acceptance criteria

- [ ] `LastUpdatedLabel` renders nothing when `generatedAt` is `undefined` or absent.
- [ ] When `generatedAt` is today's date (UTC), the label reads "Last updated today at HH:MM [AM/PM]" in the browser's locale time.
- [ ] When `generatedAt` is a prior date, the label includes the month and day (e.g., "Last updated April 3 at 11:00 PM").
- [ ] The timestamp is formatted using the user's local timezone (not UTC) — verify by running the app in a non-UTC timezone.
- [ ] `aria-live="polite"` is present on the element.
- [ ] `npx tsc --noEmit` passes.

---

## REFRESH-TASK-008 — Create RefreshButton UI Component

**Covers stories**: REFRESH-007
**Prerequisites**: REFRESH-TASK-004

### What to build

Create `app/components/RefreshButton.tsx` — a client component with loading, cooldown countdown, and idle states. Calls `POST /api/feed/refresh` and reports results via callbacks.

### Files to create

| Action | Path |
|--------|------|
| Create | `app/components/RefreshButton.tsx` |

### Implementation

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';

interface Props {
  /** Called with the new generatedAt timestamp after a successful refresh + feed reload. */
  onRefreshSuccess: (newGeneratedAt: string, newArticles: import('@/lib/types/article').Article[]) => void;
  /** Called with an error message string when the refresh fails. */
  onRefreshError: (message: string) => void;
}

type ButtonState = 'idle' | 'loading' | 'cooldown';

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

const refreshIcon = (
  <svg
    className="w-3.5 h-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

export default function RefreshButton({ onRefreshSuccess, onRefreshError }: Props) {
  const [buttonState, setButtonState] = useState<ButtonState>('idle');
  const [secondsRemaining, setSecondsRemaining] = useState(0);

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
      const json = await res.json() as {
        ok?: boolean;
        error?: string;
        secondsRemaining?: number;
        batchDate?: string;
        count?: number;
      };

      if (res.ok) {
        // Reload the feed to pick up new articles and generatedAt
        try {
          const feedRes = await fetch('/api/feed/today');
          if (feedRes.ok) {
            const feedJson = await feedRes.json() as import('@/lib/types/article').FeedResponse;
            onRefreshSuccess(feedJson.generatedAt ?? '', feedJson.articles);
          }
        } catch {
          // Feed reload failed after successful pipeline — still report success
          onRefreshSuccess('', []);
        }
        setButtonState('idle');
      } else if (res.status === 429) {
        setSecondsRemaining(json.secondsRemaining ?? 900);
        setButtonState('cooldown');
      } else {
        onRefreshError(json.error ?? 'Refresh failed. Please try again later.');
        setButtonState('idle');
      }
    } catch {
      onRefreshError('Refresh failed. Please try again later.');
      setButtonState('idle');
    }
  }, [buttonState, onRefreshSuccess, onRefreshError]);

  if (buttonState === 'loading') {
    return (
      <button
        disabled
        aria-label="Refreshing feed…"
        aria-busy="true"
        className="flex items-center gap-1.5 text-sm text-gray-400 px-3 py-2 rounded-lg
                   border border-gray-200 cursor-not-allowed select-none"
      >
        <svg
          className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        Refreshing…
      </button>
    );
  }

  if (buttonState === 'cooldown') {
    return (
      <button
        disabled
        aria-label={`Refresh available in ${formatSeconds(secondsRemaining)}`}
        className="text-sm text-gray-400 px-3 py-2 rounded-lg border border-gray-200
                   cursor-not-allowed select-none tabular-nums"
      >
        {formatSeconds(secondsRemaining)}
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
      {refreshIcon}
      Refresh
    </button>
  );
}
```

### Acceptance criteria

- [ ] Tapping "Refresh" when idle calls `POST /api/feed/refresh` and shows the loading spinner.
- [ ] During loading, the feed content remains visible below the button — the button does not replace the feed.
- [ ] On success, `onRefreshSuccess` is called; the button returns to idle state.
- [ ] On HTTP 429, the button transitions to cooldown state with a live countdown. The countdown decrements every second and the button re-enables automatically when it reaches 0.
- [ ] On HTTP 500 or network error, `onRefreshError` is called; the button returns to idle state.
- [ ] Loading spinner uses `animate-spin motion-reduce:animate-none` (reduced motion respected).
- [ ] All button states have an `aria-label` that describes the current state.
- [ ] `aria-busy="true"` is set on the button during loading.
- [ ] `npx tsc --noEmit` passes.

---

## REFRESH-TASK-009 — Feed Page Integration

**Covers stories**: REFRESH-006, REFRESH-007
**Prerequisites**: REFRESH-TASK-004, REFRESH-TASK-006, REFRESH-TASK-007, REFRESH-TASK-008

### What to build

Update `app/page.tsx` to:
1. Show `LastUpdatedLabel` below `BatchLabel` (all users).
2. Show `RefreshButton` in the header (authenticated users only).
3. Handle refresh success (update articles and timestamp in-place).
4. Handle refresh error (show dismissible error banner without replacing the feed).

### Files to modify

| Action | Path |
|--------|------|
| Modify | `app/page.tsx` |

### Implementation

Full updated `app/page.tsx`:

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Article, FeedResponse } from '@/lib/types/article';
import { initDeviceId } from '@/lib/identity/device';
import { runMigrationIfNeeded, loadFromServer, drainQueue } from '@/lib/feedback/store';
import { useAuth } from './components/AuthContext';
import AccountIcon from './components/AccountIcon';
import ArticleCard from './components/ArticleCard';
import FeedSkeleton from './components/FeedSkeleton';
import ErrorState from './components/ErrorState';
import BatchLabel from './components/BatchLabel';
import LastUpdatedLabel from './components/LastUpdatedLabel';
import RefreshButton from './components/RefreshButton';

type Status = 'loading' | 'success' | 'error';

export default function FeedPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<FeedResponse | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const fetchFeed = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch('/api/feed/today');
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const json: FeedResponse = await res.json();
      setData(json);
      setGeneratedAt(json.generatedAt);
      setStatus('success');
    } catch {
      setErrorMessage('Could not load your digest. Please check your connection.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void drainQueue();
    };
    const handleFocus = () => void drainQueue();

    async function initFeedback() {
      initDeviceId();
      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleFocus);
      await runMigrationIfNeeded();
      await loadFromServer();
    }

    void initFeedback();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const handleRefreshSuccess = useCallback(
    (newGeneratedAt: string, newArticles: Article[]) => {
      setRefreshError(null);
      if (newArticles.length > 0) {
        setData((prev) =>
          prev ? { ...prev, articles: newArticles, generatedAt: newGeneratedAt } : prev
        );
        setGeneratedAt(newGeneratedAt);
      } else if (newGeneratedAt) {
        setGeneratedAt(newGeneratedAt);
      }
    },
    []
  );

  const handleRefreshError = useCallback((message: string) => {
    setRefreshError(message);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Tangent</h1>
          <div className="flex items-center gap-2">
            {!authLoading && user && (
              <RefreshButton
                onRefreshSuccess={handleRefreshSuccess}
                onRefreshError={handleRefreshError}
              />
            )}
            <AccountIcon />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {status === 'loading' && <FeedSkeleton />}

        {status === 'error' && (
          <ErrorState
            message={errorMessage ?? 'Something went wrong.'}
            onRetry={fetchFeed}
          />
        )}

        {status === 'success' && data && (
          <>
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
                  className="text-red-400 hover:text-red-600 shrink-0 leading-none"
                >
                  ✕
                </button>
              </div>
            )}
            <BatchLabel batchDate={data.batchDate} />
            <LastUpdatedLabel generatedAt={generatedAt} />
            {data.articles.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-12">
                No articles available yet. Check back soon.
              </p>
            ) : (
              <div className="space-y-3">
                {data.articles.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    onClick={() => router.push(`/articles/${article.id}`)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
```

### Acceptance criteria

- [ ] The "Refresh" button appears in the header when the user is authenticated and does NOT appear when the user is anonymous.
- [ ] During initial auth load (`authLoading === true`), the refresh button is not rendered (avoids flash).
- [ ] After a successful refresh, the article list updates in-place without a full page reload. The feed does not show a loading skeleton.
- [ ] After a successful refresh, the `LastUpdatedLabel` updates to the new timestamp.
- [ ] After a failed refresh, a red error banner appears above the article list. The existing articles remain visible.
- [ ] The error banner can be dismissed by clicking ✕.
- [ ] `LastUpdatedLabel` is rendered below `BatchLabel` and is visible to all users (authenticated and anonymous).
- [ ] `npx tsc --noEmit` passes.

---

## REFRESH-TASK-010 — Manual Verification

**Covers stories**: REFRESH-001 through REFRESH-011 (all)
**Prerequisites**: REFRESH-TASK-009

### What to verify

This is a manual verification task. No new code is written. Run the dev server and verify all milestone acceptance criteria end-to-end.

### Verification checklist

**Authentication gating**

- [ ] Open the feed as an anonymous user (no session cookie). Confirm: no "Refresh" button visible.
- [ ] Log in. Confirm: "Refresh" button appears in the header without a page reload (AuthContext updates reactively).

**Manual refresh — happy path**

- [ ] Tap "Refresh" while authenticated. Confirm: button shows loading spinner during the pipeline run.
- [ ] Confirm: the article list updates in-place after the run completes (no page reload needed).
- [ ] Confirm: the "Last updated" label updates to the new timestamp.
- [ ] Check `data/pipeline.log` — confirm two new log lines: `[refresh] Manual refresh triggered. userId=...` and `[refresh] Manual refresh complete.`.

**Cooldown enforcement**

- [ ] Immediately after a successful refresh, tap "Refresh" again. Confirm: HTTP 429 is returned and the button enters cooldown state with a live countdown (e.g., "14m 58s").
- [ ] Wait for the countdown to reach 0. Confirm: the button re-enables automatically (no page reload).
- [ ] Confirm: `data/refresh_cooldowns.json` exists and contains the userId and ISO-8601 timestamp.

**Cooldown survives server restart** (important for the PM requirement)

- [ ] Trigger a refresh (start the cooldown).
- [ ] Stop and restart the dev server.
- [ ] Attempt a second refresh immediately. Confirm: the cooldown is still active (not reset by the restart) because it was persisted to `data/refresh_cooldowns.json`.

**Failed refresh does not consume cooldown**

- [ ] Temporarily break all RSS sources (e.g., set all `active: true` sources to an invalid feedUrl in `data/sources.json`).
- [ ] Tap "Refresh". Confirm: pipeline fails, HTTP 500 returned, error banner appears.
- [ ] Confirm: the existing feed articles are still visible (not replaced by an empty state).
- [ ] Confirm: tapping "Refresh" again immediately is allowed (no cooldown applied to the failed attempt).
- [ ] Restore sources.

**Last Updated label**

- [ ] Confirm: the "Last updated" label is visible to an anonymous user (no session cookie).
- [ ] Confirm: the label reads "Last updated today at HH:MM [AM/PM]" when the batch was generated today.
- [ ] Confirm: the label is absent when no batch exists (test by temporarily removing all `data/batches/` files or calling the API against an empty data dir).

**Source diversity — per-source cap**

- [ ] Check `data/batches/YYYY-MM-DD.json` after a pipeline run. Group articles by `sourceName`. Confirm: no source has more than 5 articles in the batch.

**Source diversity — failure isolation**

- [ ] Set one source to an invalid feedUrl in `data/sources.json`.
- [ ] Trigger a pipeline run (via `/api/pipeline/run` with the cron secret, or manually via the Refresh button).
- [ ] Confirm: the pipeline completes and a batch is written (does not abort due to the one failing source).
- [ ] Confirm: `data/pipeline.log` contains `[pipeline] Source "source-slug" failed: ...`.
- [ ] Restore sources.

**Source diversity — degraded-mode warning**

- [ ] Set all but one source to invalid feedUrls.
- [ ] Run the pipeline.
- [ ] Confirm: a batch is still written with articles from the one working source.
- [ ] Confirm: `data/pipeline.log` contains `DIVERSITY WARNING`.
- [ ] Restore sources.

**Scheduled pipeline unaffected**

- [ ] Call `POST /api/pipeline/run` with `Authorization: Bearer <CRON_SECRET>`.
- [ ] Confirm: if no batch exists for today, the pipeline runs and writes a batch.
- [ ] Confirm: if a batch already exists for today, it returns HTTP 409 (same behavior as before M5).

### Acceptance criteria

All checklist items above pass.

---

## REFRESH-TASK-011 — Update ARCHITECTURE.md and README.md

**Covers stories**: (documentation)
**Prerequisites**: REFRESH-TASK-010

### What to update

Update `agents/architect/ARCHITECTURE.md` and `agents/shared/README.md` to reflect Milestone 5 completion.

### Files to modify

| Action | Path |
|--------|------|
| Modify | `agents/architect/ARCHITECTURE.md` |
| Modify | `agents/shared/README.md` |

### Changes to ARCHITECTURE.md

**1. Add to API Routes table**:

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST | `/api/feed/refresh` | Triggers manual pipeline run with cooldown enforcement | `dd_session` cookie (authenticated users only) |

**2. Add to Repository Structure** under `lib/pipeline/`:
```
│   │   ├── cooldown.ts           ← Per-user refresh cooldown tracker (filesystem-backed)
```

And under `data/`:
```
│   └── refresh_cooldowns.json    ← Per-user manual refresh timestamps (git-ignored)
```

**3. Add to Key Architectural Decisions table**:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Manual refresh cooldown storage | JSON file at `data/refresh_cooldowns.json` | Survives server restarts; consistent with filesystem-first architecture; no new DB table needed; low write volume (one entry per user per 15 minutes) |
| Same-day batch overwrite | `writeBatch(batch, force=true)` | Manual refresh overwrites same-day file; `GET /api/feed/today` reads the latest state naturally; no co-day collision |

**4. Add to Design Documents table**:

| Milestone | Design Doc | Task List |
|-----------|-----------|-----------|
| Milestone 5 — Feed Refresh and Source Diversity | `agents/architect/design_feed_refresh_v1.md` | `agents/architect/tasks_feed_refresh_v1.md` |

**5. Add to "What Has Been Built" table** (initially Not started):

| Layer | Status | Notes |
|-------|--------|-------|
| Pipeline constants (cap, min sources, cooldown) in `lib/pipeline/config.ts` | **Not started** | REFRESH-TASK-001 |
| Pipeline: per-source cap + failure isolation + diversity warning + overwrite | **Not started** | REFRESH-TASK-002 |
| Cooldown tracker module (`lib/pipeline/cooldown.ts`) | **Not started** | REFRESH-TASK-003 |
| `POST /api/feed/refresh` route | **Not started** | REFRESH-TASK-004 |
| `FeedResponse` type update (`generatedAt` field) | **Not started** | REFRESH-TASK-005 |
| `GET /api/feed/today` update to include `generatedAt` | **Not started** | REFRESH-TASK-006 |
| `LastUpdatedLabel` UI component | **Not started** | REFRESH-TASK-007 |
| `RefreshButton` UI component | **Not started** | REFRESH-TASK-008 |
| Feed page integration (button + label + error banner) | **Not started** | REFRESH-TASK-009 |
| Manual verification (M5) | **Not started** | REFRESH-TASK-010 |
| ARCHITECTURE.md + README.md Milestone 5 update | **Not started** | REFRESH-TASK-011 |

**6. Update changelog**:
```
| 2026-04-04 | Architect Agent | Milestone 5 design complete. Manual refresh endpoint with filesystem cooldown. Per-source article cap and failure isolation in run.ts. generatedAt exposed in FeedResponse. LastUpdatedLabel and RefreshButton UI components. 11 tasks, all Not started. |
```

### Changes to agents/shared/README.md

Replace the "In progress" table and "Next action" section:

```markdown
### In progress

| Milestone | Status |
|-----------|--------|
| 5 — Feed Refresh and Source Diversity | **Design complete — dev implementation next** |

### Next action

M5 design and task list are complete. → @agent-dev, start with REFRESH-TASK-001.
```

Update "Last updated" date to 2026-04-04.

### Acceptance criteria

- [ ] `ARCHITECTURE.md` API Routes table includes `POST /api/feed/refresh`.
- [ ] `ARCHITECTURE.md` Key Architectural Decisions includes cooldown storage and co-day batch overwrite rows.
- [ ] `ARCHITECTURE.md` Design Documents table includes M5 row.
- [ ] `ARCHITECTURE.md` "What Has Been Built" includes 11 new M5 rows, all "Not started".
- [ ] `ARCHITECTURE.md` changelog entry added.
- [ ] `agents/shared/README.md` shows M5 status as "Design complete — dev implementation next".
- [ ] `agents/shared/README.md` next action points to @agent-dev and REFRESH-TASK-001.
```

---

Now here are the exact updates needed to the two existing documentation files:

### Updates to `agents/architect/ARCHITECTURE.md`

The following changes need to be made:

**API Routes table** — add after the existing last row:
```
| POST | `/api/feed/refresh` | Triggers manual pipeline run with cooldown enforcement | `dd_session` cookie (authenticated users only) |
```

**Repository Structure** — under `lib/pipeline/`, add after `ranker.ts`:
```
│   │   ├── cooldown.ts           ← Per-user refresh cooldown tracker (filesystem-backed)
```

Under `data/`, add:
```
│   └── refresh_cooldowns.json    ← Per-user manual refresh timestamps (git-ignored)
```

**Key Architectural Decisions table** — add two rows:
```
| Manual refresh cooldown storage | JSON file at `data/refresh_cooldowns.json` | Survives server restarts; consistent with filesystem-first architecture; no new DB table needed |
| Same-day batch overwrite | `writeBatch(batch, force=true)` | Manual refresh overwrites same-day file; GET /api/feed/today reads the latest state naturally |
```

**Design Documents table** — add:
```
| Milestone 5 — Feed Refresh and Source Diversity | `agents/architect/design_feed_refresh_v1.md` | `agents/architect/tasks_feed_refresh_v1.md` |
```

**What Has Been Built** — add 11 rows (all "Not started") as detailed in REFRESH-TASK-011 above.

**Changelog** — add:
```
| 2026-04-04 | Architect Agent | Milestone 5 design complete. Manual refresh endpoint with filesystem cooldown. Per-source article cap and failure isolation in run.ts. generatedAt exposed in FeedResponse. LastUpdatedLabel and RefreshButton UI components. 11 tasks, all Not started. |
