# Dev Task List — Article Feed v1

**ID**: ARCH-TASKS-001
**Design Reference**: ARCH-DESIGN-001
**Stories Reference**: PM-STORIES-001
**Date**: 2026-04-04
**Status**: Ready for Dev

---

## How to Use This Document

Tasks are ordered by dependency. A Dev can work through them top-to-bottom in a single
branch. Each task is scoped to be completable in one focused session (roughly 30–90 min).

**Blocker notation**: A task marked `[BLOCKER]` must be completed before any task that
lists it as a prerequisite. The dependency graph is linear in this list — completing
tasks in order is always safe.

**Acceptance criteria** are written to be verifiable by running the dev server and/or
inspecting files directly. No automated tests are required in v1 (testing infrastructure
is a future task).

---

## Task Index

| ID | Title | Blocks |
|----|-------|--------|
| TASK-001 | Project scaffolding — env, gitignore, dependencies | All |
| TASK-002 | Shared TypeScript types | TASK-003, TASK-004, TASK-005, TASK-008 |
| TASK-003 | Pipeline config and storage module | TASK-004, TASK-005, TASK-006 |
| TASK-004 | RSS adapter | TASK-006 |
| TASK-005 | NewsAPI adapter | TASK-006 |
| TASK-006 | Pipeline validator and orchestrator | TASK-007 |
| TASK-007 | Pipeline API route (POST /api/pipeline/run) | — |
| TASK-008 | Feed API route (GET /api/feed/today) | TASK-009, TASK-011 |
| TASK-009 | Article API route (GET /api/articles/[id]) | TASK-012 |
| TASK-010 | Shared UI components (ArticleCard, FeedSkeleton, ErrorState, BatchLabel) | TASK-011 |
| TASK-011 | Feed page (/) | — |
| TASK-012 | Article reading view (/articles/[id]) | — |
| TASK-013 | PWA assets and layout meta tags | — |
| TASK-014 | Mobile responsive audit and polish | — |

---

## TASK-001 — Project Scaffolding

**[BLOCKER — prerequisite for all other tasks]**

**Stories**: FEED-001, FEED-002 (infrastructure prerequisite)

### What to Build

- Install `rss-parser` npm package.
- Create `.env.example` with placeholder entries.
- Create `.env.local` with real values (not committed).
- Update `.gitignore` to exclude runtime data.
- Create the `data/` directory with `sources.json`.
- Create the `lib/` and `lib/pipeline/` directory structure (empty dirs with `.gitkeep`
  or stub files to establish the tree).

### Files to Create / Modify

| Action | Path |
|--------|------|
| Modify | `package.json` (via `npm install rss-parser`) |
| Create | `.env.example` |
| Create | `.env.local` (not committed) |
| Modify | `.gitignore` |
| Create | `data/sources.json` |
| Create | `data/batches/` (directory, git-ignored) |

### Acceptance Criteria

- [x] `npm install` completes without errors after `rss-parser` is added.
- [x] `.env.example` contains `NEWSAPI_KEY=` and `CRON_SECRET=` with no real values.
- [ ] `.env.local` is present locally and listed in `.gitignore`. *(listed in .gitignore; file left for developer to populate with real secrets)*
- [x] `.gitignore` excludes `data/batches/` and `data/pipeline.log`.
- [x] `data/sources.json` is a valid JSON array containing at least 4 sources: 3 RSS
  (BBC News, Ars Technica, The Verge) and 1 NewsAPI entry. See ARCH-DESIGN-001 §4.1
  for the initial source list.
- [x] `data/sources.json` is NOT listed in `.gitignore` (it is configuration, not data).
- [x] `npm run dev` still starts without errors.

---

## TASK-002 — Shared TypeScript Types

**[BLOCKER — prerequisite for TASK-003 through TASK-009]**

**Stories**: FEED-002

### What to Build

Define all shared TypeScript types as documented in ARCH-DESIGN-001 §2. No logic —
types only.

### Files to Create / Modify

| Action | Path |
|--------|------|
| Create | `lib/types/article.ts` |

### Acceptance Criteria

- [x] `lib/types/article.ts` exports: `Article`, `FeedResponse`, `ArticleBatch`, `Source`.
- [x] `Article` contains all required fields: `id`, `title`, `sourceName`, `sourceUrl`,
  `articleUrl`, `publishedAt`, `fetchedAt`, `batchDate`.
- [x] `Article` contains all optional fields typed with `?`: `description`, `imageUrl`,
  `bodyText`, `feedbackSlot`.
- [x] `feedbackSlot` type is `'like' | 'dislike' | null` (optional field, not a required
  field with a null type).
- [x] Every field has an inline JSDoc comment explaining its purpose.
- [x] `FeedResponse` contains `batchDate: string` and `articles: Article[]`.
- [x] `ArticleBatch` contains `batchDate`, `generatedAt`, and `articles: Article[]`.
- [x] `Source` contains `slug`, `name`, `url`, `type` (`'rss' | 'newsapi'`), `active`,
  and optional `feedUrl` and `query`.
- [x] `npm run build` (or `tsc --noEmit`) passes with no type errors in this file.

---

## TASK-003 — Pipeline Config and Storage Module

**[BLOCKER — prerequisite for TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009]**

**Stories**: FEED-001, FEED-002

### What to Build

Two modules:

1. `lib/pipeline/config.ts` — exports pipeline constants and loads the source list.
2. `lib/pipeline/storage.ts` — read/write batch files and append to the run log.

### Files to Create / Modify

| Action | Path |
|--------|------|
| Create | `lib/pipeline/config.ts` |
| Create | `lib/pipeline/storage.ts` |

### config.ts Details

Export the following:
- `ARTICLES_PER_DAY: number` — default `20`; read from `process.env.ARTICLES_PER_DAY`
  with fallback to `20`.
- `BATCH_DIR: string` — absolute path to `data/batches/` resolved from project root.
- `SOURCES_PATH: string` — absolute path to `data/sources.json`.
- `LOG_PATH: string` — absolute path to `data/pipeline.log`.
- `loadSources(): Source[]` — reads and parses `data/sources.json`, returns only entries
  where `active === true`.

### storage.ts Details

Export the following functions:

- `writeBatch(batch: ArticleBatch): void` — writes batch to
  `data/batches/<batchDate>.json`. Creates `data/batches/` directory if it does not
  exist. Does NOT overwrite an existing file for the same date (throws or returns early
  with a flag indicating the file already existed — the pipeline route will handle the
  409 response).
- `readBatch(date: string): ArticleBatch | null` — reads and parses
  `data/batches/<date>.json`. Returns `null` if the file does not exist.
- `readLatestBatch(): ArticleBatch | null` — lists all files in `data/batches/`,
  sorts descending by filename (YYYY-MM-DD lexicographic sort is correct), returns the
  parsed batch from the most recent file. Returns `null` if directory is empty or
  missing.
- `appendLog(message: string): void` — appends a timestamped line to
  `data/pipeline.log`. Creates the file if it does not exist. Format:
  `[ISO-8601 datetime] message\n`

### Acceptance Criteria

- [ ] `ARTICLES_PER_DAY` is `20` when env var is not set.
- [ ] `loadSources()` returns only sources where `active === true`.
- [ ] `writeBatch()` creates `data/batches/` if absent before writing.
- [ ] `writeBatch()` does not overwrite an existing file for the same date; it signals
  this condition so the caller can return a 409.
- [ ] `readBatch('2026-04-04')` returns `null` when the file does not exist.
- [ ] `readLatestBatch()` returns `null` when `data/batches/` is empty or missing.
- [ ] `readLatestBatch()` returns the batch with the latest date when multiple batch
  files exist.
- [ ] `appendLog()` creates `data/pipeline.log` on first call and appends on subsequent
  calls (does not truncate).
- [ ] No TypeScript errors (`tsc --noEmit`).

---

## TASK-004 — RSS Adapter

**Stories**: FEED-001, FEED-003

**Prerequisites**: TASK-001 (`rss-parser` installed), TASK-002, TASK-003

### What to Build

A function that fetches and parses a single RSS source, returning an array of partial
Article objects ready for the validator.

### Files to Create / Modify

| Action | Path |
|--------|------|
| Create | `lib/pipeline/adapters/rssAdapter.ts` |

### Details

Export a single async function:

```typescript
fetchRssArticles(source: Source): Promise<Omit<Article, 'id' | 'batchDate' | 'feedbackSlot'>[]>
```

- Uses `rss-parser` to fetch and parse `source.feedUrl`.
- Maps each feed item to the partial Article shape:
  - `title` ← `item.title` (trimmed)
  - `articleUrl` ← `item.link`
  - `publishedAt` ← `item.pubDate` (ISO string; if missing, use current time as fallback)
  - `fetchedAt` ← current ISO datetime
  - `sourceName` ← `source.name`
  - `sourceUrl` ← `source.url`
  - `description` ← `item.contentSnippet` or `item.summary` (optional)
  - `imageUrl` ← `item.enclosure?.url` (optional)
  - `bodyText` ← `item['content:encoded']` or `item.content` if length > 200 chars (optional)
- On network or parse error, logs a warning to console and returns an empty array (do
  not throw — the pipeline should continue with other sources).
- Does NOT assign `id` or `batchDate` (those are assigned by the orchestrator).

### Acceptance Criteria

- [ ] Calling `fetchRssArticles` with a valid BBC News source config returns an array
  of at least 1 article (integration test: run manually against live feed).
- [ ] Returned articles all have `title`, `articleUrl`, `sourceName`, `sourceUrl`,
  `fetchedAt` populated.
- [ ] On an invalid `feedUrl`, returns `[]` without throwing.
- [ ] `bodyText` is not set if the RSS item has no content or content is fewer than 200
  characters.
- [ ] No TypeScript errors.

---

## TASK-005 — NewsAPI Adapter

**Stories**: FEED-001, FEED-003

**Prerequisites**: TASK-002, TASK-003

### What to Build

A function that calls the NewsAPI.org top-headlines endpoint and returns an array of
partial Article objects.

### Files to Create / Modify

| Action | Path |
|--------|------|
| Create | `lib/pipeline/adapters/newsApiAdapter.ts` |

### Details

Export a single async function:

```typescript
fetchNewsApiArticles(source: Source): Promise<Omit<Article, 'id' | 'batchDate' | 'feedbackSlot'>[]>
```

- Uses the Node.js built-in `fetch` (available in Next.js / Node 18+) — no extra HTTP
  library needed.
- Calls `https://newsapi.org/v2/top-headlines?language=en&pageSize=40&apiKey=<NEWSAPI_KEY>`.
  Request `pageSize=40` to provide a larger candidate pool for the validator.
- Reads `NEWSAPI_KEY` from `process.env.NEWSAPI_KEY`. If the env var is missing, logs an
  error and returns `[]`.
- Maps each NewsAPI article to the partial Article shape:
  - `title` ← `article.title`
  - `articleUrl` ← `article.url`
  - `publishedAt` ← `article.publishedAt`
  - `fetchedAt` ← current ISO datetime
  - `sourceName` ← `article.source.name`
  - `sourceUrl` ← origin derived from `article.url` (e.g. `new URL(article.url).origin`)
  - `description` ← `article.description` (optional)
  - `imageUrl` ← `article.urlToImage` (optional)
  - `bodyText` ← NOT set (NewsAPI free tier truncates; not useful as body)
- Filters out any item where `article.title === '[Removed]'` (NewsAPI's placeholder for
  deleted articles).
- On HTTP error or missing API key, logs a warning and returns `[]`.

### Acceptance Criteria

- [ ] With a valid `NEWSAPI_KEY` in `.env.local`, `fetchNewsApiArticles` returns an
  array of articles (integration test: run manually).
- [ ] Items with title `[Removed]` are not included in the output.
- [ ] Missing `NEWSAPI_KEY` returns `[]` without throwing.
- [ ] `bodyText` is never set on returned articles.
- [ ] No TypeScript errors.

---

## TASK-006 — Pipeline Validator and Orchestrator

**[BLOCKER — prerequisite for TASK-007]**

**Stories**: FEED-001, FEED-003

**Prerequisites**: TASK-002, TASK-003, TASK-004, TASK-005

### What to Build

Two modules:

1. `lib/pipeline/validator.ts` — validates and filters a pool of article candidates.
2. `lib/pipeline/run.ts` — orchestrates the full pipeline from sources to stored batch.

### Files to Create / Modify

| Action | Path |
|--------|------|
| Create | `lib/pipeline/validator.ts` |
| Create | `lib/pipeline/run.ts` |

### validator.ts Details

Export:

```typescript
validateAndTrim(
  candidates: Omit<Article, 'id' | 'batchDate' | 'feedbackSlot'>[],
  limit: number
): Omit<Article, 'id' | 'batchDate' | 'feedbackSlot'>[]
```

Rules (applied in this order):
1. Discard articles where `title` is falsy or empty string after trimming.
2. Discard articles where `articleUrl` is falsy or empty string.
3. Deduplicate by `articleUrl` (keep first occurrence).
4. Trim to `limit` items (take the first `limit` after the above filters).

### run.ts Details

Export:

```typescript
interface RunResult {
  batchDate: string;
  count: number;
  alreadyExists: boolean;
}

runPipeline(): Promise<RunResult>
```

Steps:
1. Determine today's date string (`YYYY-MM-DD` in UTC).
2. Check if today's batch file already exists via `storage.readBatch(today)`. If yes,
   return `{ batchDate: today, count: 0, alreadyExists: true }` immediately.
3. Load active sources via `config.loadSources()`.
4. For each source, call the appropriate adapter (`rssAdapter` or `newsApiAdapter`).
   Collect all results into one flat candidates array. Run adapters concurrently
   (`Promise.all`).
5. Call `validator.validateAndTrim(candidates, ARTICLES_PER_DAY)`.
6. For each validated article, assign:
   - `batchDate` ← today's date string
   - `id` ← `<source-slug>-<first-8-chars-of-sha256-of-articleUrl>` using Node's
     built-in `crypto.createHash('sha256')`. Derive the source slug from `sourceName`
     (lowercase, spaces to hyphens, strip non-alphanumeric except hyphens).
   - `feedbackSlot` ← `null`
7. Build `ArticleBatch` and call `storage.writeBatch()`.
8. Call `storage.appendLog()` with a summary line (e.g.
   `"Pipeline run complete. batchDate=2026-04-04 count=20"`).
9. Return `{ batchDate, count: articles.length, alreadyExists: false }`.

On any unhandled error: call `storage.appendLog()` with the error message and rethrow
so the API route can return a 500.

### Acceptance Criteria

- [ ] `validateAndTrim` discards articles with empty or null `title`.
- [ ] `validateAndTrim` discards articles with empty or null `articleUrl`.
- [ ] `validateAndTrim` deduplicates by `articleUrl`.
- [ ] `validateAndTrim` never returns more than `limit` items.
- [ ] `runPipeline()` returns `alreadyExists: true` if today's batch file already exists.
- [ ] `runPipeline()` creates `data/batches/YYYY-MM-DD.json` when called on a day with
  no existing batch.
- [ ] All articles in the batch have a non-empty `id`, `batchDate`, and `feedbackSlot`
  set to `null`.
- [ ] `data/pipeline.log` has a new line appended after each `runPipeline()` call.
- [ ] No TypeScript errors.

---

## TASK-007 — Pipeline API Route

**Stories**: FEED-001

**Prerequisites**: TASK-006

### What to Build

A Next.js Route Handler that exposes the pipeline runner as an HTTP endpoint, protected
by a shared secret.

### Files to Create / Modify

| Action | Path |
|--------|------|
| Create | `app/api/pipeline/run/route.ts` |

### Details

`POST /api/pipeline/run`

- Read `Authorization` header. If it does not equal `Bearer <CRON_SECRET>` (from
  `process.env.CRON_SECRET`), return HTTP 401 with `{ "error": "Unauthorized" }`.
- Call `runPipeline()`.
- If `result.alreadyExists`, return HTTP 409 with
  `{ "ok": false, "error": "Batch already exists for today", "batchDate": result.batchDate }`.
- Otherwise return HTTP 200 with `{ "ok": true, "batchDate": result.batchDate, "count": result.count }`.
- If `runPipeline()` throws, return HTTP 500 with `{ "ok": false, "error": err.message }`.

Mark the route as `export const dynamic = 'force-dynamic'` to prevent Next.js from
caching or statically analyzing it.

### Acceptance Criteria

- [ ] `POST /api/pipeline/run` without the correct `Authorization` header returns 401.
- [ ] `POST /api/pipeline/run` with the correct header and no existing batch for today
  returns 200 and creates the batch file.
- [ ] Calling the endpoint a second time on the same day returns 409.
- [ ] Response body is JSON in all cases (200, 401, 409, 500).

---

## TASK-008 — Feed API Route (GET /api/feed/today)

**[BLOCKER — prerequisite for TASK-011]**

**Stories**: FEED-004

**Prerequisites**: TASK-002, TASK-003

### What to Build

A Next.js Route Handler that returns the current day's article batch.

### Files to Create / Modify

| Action | Path |
|--------|------|
| Create | `app/api/feed/today/route.ts` |

### Details

`GET /api/feed/today`

Algorithm:
1. Compute today's date string (UTC, `YYYY-MM-DD`).
2. Try `storage.readBatch(today)`. If found, return it.
3. Otherwise, try `storage.readLatestBatch()`. If found, return it.
4. If neither exists, return HTTP 200 with `{ "batchDate": "", "articles": [] }`.

Response shape: `FeedResponse` — `{ batchDate: string, articles: Article[] }`.

Set `Cache-Control: no-store` on the response.

Mark the route as `export const dynamic = 'force-dynamic'`.

### Acceptance Criteria

- [ ] Returns 200 with `{ batchDate: "", articles: [] }` when `data/batches/` is empty.
- [ ] Returns today's batch when it exists.
- [ ] Returns the most recent prior batch when today's does not exist.
- [ ] `batchDate` in the response matches the date of the batch being returned (not
  always today's date).
- [ ] Never returns 404.
- [ ] Response is valid JSON matching `FeedResponse` shape.

---

## TASK-009 — Article API Route (GET /api/articles/[id])

**Stories**: FEED-005

**Prerequisites**: TASK-002, TASK-003, TASK-008

### What to Build

A Next.js Route Handler that returns a single article by ID.

### Files to Create / Modify

| Action | Path |
|--------|------|
| Create | `app/api/articles/[id]/route.ts` |

### Details

`GET /api/articles/[id]`

Algorithm:
1. Use the same batch-loading logic as TASK-008 (today's batch, or latest fallback).
2. Search the `articles` array for an article where `article.id === params.id`.
3. If found, return HTTP 200 with the `Article` object.
4. If not found, return HTTP 404 with `{ "error": "Article not found" }`.

Mark the route as `export const dynamic = 'force-dynamic'`.

### Acceptance Criteria

- [ ] Returns 200 and the full `Article` object when a valid ID is requested.
- [ ] Returns 404 with `{ "error": "Article not found" }` for an unknown ID.
- [ ] The returned article includes all fields present on the stored record (no fields
  stripped or omitted).

---

## TASK-010 — Shared UI Components

**[BLOCKER — prerequisite for TASK-011]**

**Stories**: FEED-006, FEED-007, FEED-008, FEED-009, FEED-010, FEED-011, FEED-013

**Prerequisites**: TASK-002

### What to Build

Five reusable React components. No data fetching in these components — they are purely
presentational. All styled with Tailwind CSS.

### Files to Create / Modify

| Action | Path |
|--------|------|
| Create | `app/components/ArticleCard.tsx` |
| Create | `app/components/FeedSkeleton.tsx` |
| Create | `app/components/ErrorState.tsx` |
| Create | `app/components/BatchLabel.tsx` |
| Create | `app/components/ViewSourceLink.tsx` |

### Component Specs

**ArticleCard** (`ArticleCard.tsx`):
- Props: `article: Article`, `onClick?: () => void`
- Renders: headline (`article.title`), source name (`article.sourceName`), description
  if present (do not render an empty string or the word "undefined").
- If `article.imageUrl` is present, renders an `<img>` with that URL. If absent, no
  image element or placeholder is rendered.
- The entire card is a clickable surface (use a `<button>` or wrap in a `<Link>`).
- Minimum touch target: entire card should be at least 44px tall (easily met if padding
  is reasonable).
- Responsive: full-width on mobile, up to a max-width container width on desktop.

**FeedSkeleton** (`FeedSkeleton.tsx`):
- No props.
- Renders 5 placeholder skeleton cards (gray animated pulse blocks) that approximate
  the shape of an `ArticleCard`.
- Prevents layout shift when transitioning to loaded state: skeleton cards should
  approximate the same height as real cards.

**ErrorState** (`ErrorState.tsx`):
- Props: `message: string`, `onRetry: () => void`
- Renders a human-readable error message and a "Try again" button that calls `onRetry`.
- Does not render any article content alongside the error.

**BatchLabel** (`BatchLabel.tsx`):
- Props: `batchDate: string` (YYYY-MM-DD or empty string)
- If `batchDate` equals today's date (compare to `new Date().toISOString().slice(0,10)`):
  renders "Today's Digest".
- If `batchDate` is a prior date: renders "Latest Digest — [formatted date]"
  (e.g. "Latest Digest — April 3, 2026"). Use `Intl.DateTimeFormat` for formatting.
- If `batchDate` is empty: renders nothing (return `null`).
- Positioned above the article list, visible without scrolling.

**ViewSourceLink** (`ViewSourceLink.tsx`):
- Props: `articleUrl: string`, `sourceName: string`
- Renders an anchor tag: label "View on [sourceName]", `href={articleUrl}`,
  `target="_blank"`, `rel="noopener noreferrer"`.
- Styled as a prominent button or clearly styled link.

### Acceptance Criteria

- [ ] `ArticleCard` renders title and source name in all cases.
- [ ] `ArticleCard` does not render a description element when `description` is undefined.
- [ ] `ArticleCard` does not render an image element when `imageUrl` is undefined.
- [ ] `FeedSkeleton` renders exactly 5 skeleton items.
- [ ] `ErrorState` renders the provided `message` and a retry button.
- [ ] `BatchLabel` renders "Today's Digest" when `batchDate` is today's date.
- [ ] `BatchLabel` renders "Latest Digest — [date]" when `batchDate` is a prior date.
- [ ] `BatchLabel` renders nothing when `batchDate` is empty.
- [ ] `ViewSourceLink` opens in a new tab with `target="_blank"`.
- [ ] All components render without TypeScript errors.
- [ ] All tap targets are at least 44px in height or width (verify visually at 375px
  viewport in browser devtools).

---

## TASK-011 — Feed Page (/)

**Stories**: FEED-006, FEED-007, FEED-008, FEED-009, FEED-013

**Prerequisites**: TASK-008, TASK-010

### What to Build

Replace the default Next.js scaffold `app/page.tsx` with the feed page. This is a
client component (`'use client'`) because it manages fetch state.

### Files to Create / Modify

| Action | Path |
|--------|------|
| Replace | `app/page.tsx` |

### Details

State machine (simple, no library needed):
- `status: 'loading' | 'success' | 'error'`
- `data: FeedResponse | null`
- `errorMessage: string | null`

On mount (`useEffect`):
1. Set status to `'loading'`.
2. Fetch `GET /api/feed/today`.
3. On success (2xx): parse JSON as `FeedResponse`, set `data`, set status to `'success'`.
4. On non-2xx or network error: set `errorMessage` to a human-readable string, set
   status to `'error'`.

Render:
- Status `'loading'`: render `<FeedSkeleton />` above a content area.
- Status `'error'`: render `<ErrorState message={errorMessage} onRetry={fetchFeed} />`
  where `fetchFeed` is the same fetch function used on mount.
- Status `'success'`:
  - Render `<BatchLabel batchDate={data.batchDate} />` above the article list.
  - Render one `<ArticleCard>` per article in `data.articles`, in order.
  - Each `ArticleCard` links to `/articles/[article.id]` on click (use `router.push` or
    wrap in a Next.js `<Link>`).
  - If `data.articles` is empty, render a message: "No articles available yet. Check
    back soon." (cold start scenario).

Layout:
- Max-width container centered on desktop.
- Single-column on mobile.
- Page has a simple header with the app name ("Daily Digest" or similar).

### Acceptance Criteria

- [ ] Visiting `/` shows a loading skeleton while the API request is in flight.
- [ ] After loading, the page shows the `BatchLabel` and then a list of article cards.
- [ ] The number of cards matches the number of articles returned by the API.
- [ ] Descriptions absent from an article do not appear as blank space or "undefined".
- [ ] Images absent from an article produce no image element in the card.
- [ ] Clicking a card navigates to `/articles/[id]`.
- [ ] If the API returns a network error, the error state is shown with a retry button.
- [ ] Clicking "Try again" re-fetches from `/api/feed/today`.
- [ ] Layout has no horizontal overflow at 320px viewport width.
- [ ] The `BatchLabel` is visible above the first card without scrolling.

---

## TASK-012 — Article Reading View (/articles/[id])

**Stories**: FEED-010, FEED-011, FEED-013

**Prerequisites**: TASK-009, TASK-010

### What to Build

The article detail page at `/articles/[id]`. This can be a server component that
fetches at render time, or a client component — either works. Server component is
preferred (simpler, no client-side fetch state).

### Files to Create / Modify

| Action | Path |
|--------|------|
| Create | `app/articles/[id]/page.tsx` |

### Details

As a Next.js server component:
1. Extract `params.id`.
2. Fetch `GET /api/articles/${id}` (internal fetch; use absolute URL via an env var
   `NEXT_PUBLIC_BASE_URL` or construct from headers; alternatively, import and call
   the storage module directly to avoid an HTTP round-trip).
   **Recommended**: call the storage module directly (import `readBatch` /
   `readLatestBatch` from `lib/pipeline/storage.ts`) rather than making an HTTP call
   to self — this avoids needing an absolute URL and is more efficient.
3. If article is not found, call Next.js `notFound()` (renders the built-in 404 page).
4. Render the reading view.

Render layout:
- Back navigation: a `<Link href="/">← Back to feed</Link>` at the top.
- `<ViewSourceLink>` component: placed prominently near the top (below the back link or
  in a sticky/fixed header). Must be visible without scrolling.
- Headline (`article.title`) as an `<h1>`.
- Source name and published date line.
- Body text section:
  - If `article.bodyText` is present: render it. If bodyText may contain HTML, sanitize
    before rendering with `dangerouslySetInnerHTML` or render as plain text. For v1,
    treating it as plain text (wrapped in a `<p>`) is acceptable and safe.
  - If `article.bodyText` is absent: render "Full text not available — view the original
    source." as a plain text message.

### Acceptance Criteria

- [ ] Navigating to `/articles/[id]` with a valid article ID renders the reading view.
- [ ] The headline, source name, and published date are displayed.
- [ ] `ViewSourceLink` is visible near the top of the page (above any body text).
- [ ] `ViewSourceLink` opens in a new tab and does not navigate away from the app.
- [ ] If `bodyText` is present, it is displayed as the article body.
- [ ] If `bodyText` is absent, "Full text not available — view the original source."
  is displayed instead.
- [ ] A back link to `/` is present and functional.
- [ ] Navigating to `/articles/nonexistent-id` renders a 404 page (not a blank page or
  unhandled error).
- [ ] Layout has no horizontal overflow at 320px viewport width.
- [ ] Tap targets (back link, view source) are at least 44x44px.

---

## TASK-013 — PWA Assets and Layout Meta Tags

**Stories**: FEED-012

**Prerequisites**: TASK-011 (app must be functionally complete before PWA audit)

### What to Build

All assets and configuration required to make the app installable as a PWA.

### Files to Create / Modify

| Action | Path |
|--------|------|
| Create | `public/manifest.json` |
| Create | `public/sw.js` |
| Create | `public/icons/icon-192.png` |
| Create | `public/icons/icon-512.png` |
| Modify | `app/layout.tsx` |

### Details

**manifest.json**:
```json
{
  "name": "Daily Digest",
  "short_name": "Digest",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#111827",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

**sw.js** (minimal — registration only, no caching strategy):
```javascript
// Service worker v1 — registration only.
// Offline caching is deferred to a future milestone.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
```

**Icons**: Create simple placeholder PNG icons at the required sizes. They do not need
to be polished artwork in v1 — a solid color square with a text initial is acceptable
and can be generated programmatically or with any image editor.

**layout.tsx modifications** — add to the `<head>` via Next.js `metadata` export or
direct tags:
```tsx
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#111827" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<link rel="apple-touch-icon" href="/icons/icon-192.png" />
```

Register the service worker in a client-side effect. The cleanest way in Next.js App
Router is a small `<ServiceWorkerRegistration>` client component that calls
`navigator.serviceWorker.register('/sw.js')` in a `useEffect`, imported in
`layout.tsx`.

### Acceptance Criteria

- [ ] `public/manifest.json` is valid JSON with `name`, `short_name`, `start_url`,
  `display: "standalone"`, and two icon entries.
- [ ] `/manifest.json` is accessible in the browser (no 404).
- [ ] `/sw.js` is accessible in the browser (no 404).
- [ ] Both PNG icons exist at the specified paths.
- [ ] Running Lighthouse PWA audit on the deployed (or local) app shows no blocking
  installability failures.
- [ ] On an Android device or Chrome DevTools "Application" panel, the app shows as
  installable (the browser offers "Add to Home Screen").

---

## TASK-014 — Mobile Responsive Audit and Polish

**Stories**: FEED-013

**Prerequisites**: TASK-011, TASK-012 (both pages must exist before audit)

### What to Build

This is an audit-and-fix task, not a feature build. Review both pages at 320px, 375px,
and 390px viewport widths and fix any layout issues found.

### Files to Modify

Any component or page file that has a responsive layout issue. Likely candidates:
- `app/page.tsx`
- `app/articles/[id]/page.tsx`
- Any component in `app/components/`

### Checklist

Go through each item below in browser devtools with device emulation at 320px, 375px,
and 390px width:

- [ ] No horizontal scrollbar or content overflow at any of the three widths.
- [ ] All tap targets (article cards, "Try again" button, "View Source" link, back link)
  are at least 44px in height.
- [ ] Body text is at least 16px on mobile (check Tailwind class applied).
- [ ] The `BatchLabel` is visible without vertical scrolling on mobile.
- [ ] Feed page: single-column card layout with comfortable padding (no cards side-by-side
  on 320px).
- [ ] Article page: headline text wraps correctly without overflow on long headlines.
- [ ] No fixed-width elements that break the layout (avoid `w-[Xpx]` on text containers).

### Acceptance Criteria

- [ ] All checklist items above pass at 320px, 375px, and 390px.
- [ ] No new TypeScript errors introduced by any fixes.

---

## Dependency Graph Summary

```
TASK-001 (scaffolding)
    └── TASK-002 (types)
            ├── TASK-003 (config + storage)
            │       ├── TASK-004 (RSS adapter)
            │       │       └── TASK-006 (validator + orchestrator)
            │       ├── TASK-005 (NewsAPI adapter)
            │       │       └── TASK-006
            │       │               └── TASK-007 (pipeline route)
            │       ├── TASK-008 (feed API route)
            │       │       └── TASK-011 (feed page)
            │       │               └── TASK-013 (PWA)
            │       │               └── TASK-014 (responsive audit)
            │       └── TASK-009 (article API route)
            │               └── TASK-012 (article page)
            │                       └── TASK-014
            └── TASK-010 (UI components)
                    ├── TASK-011
                    └── TASK-012
```

Safe parallel work (if two Devs are available):
- TASK-004 and TASK-005 can be done concurrently after TASK-003.
- TASK-008 and TASK-009 can be started once TASK-003 is done (they only depend on
  storage, not the pipeline itself).
- TASK-010 (UI components) can be started after TASK-002 (types) regardless of pipeline
  progress.

---

## Session Handoff Notes

At the end of each Dev session, update this file's task statuses with one of:
`Pending | In Progress | Done | Blocked`.

| ID | Title | Status |
|----|-------|--------|
| TASK-001 | Project Scaffolding | Pending |
| TASK-002 | Shared TypeScript Types | Pending |
| TASK-003 | Pipeline Config and Storage | Pending |
| TASK-004 | RSS Adapter | Pending |
| TASK-005 | NewsAPI Adapter | Pending |
| TASK-006 | Pipeline Validator and Orchestrator | Pending |
| TASK-007 | Pipeline API Route | Pending |
| TASK-008 | Feed API Route | Pending |
| TASK-009 | Article API Route | Pending |
| TASK-010 | Shared UI Components | Pending |
| TASK-011 | Feed Page | Pending |
| TASK-012 | Article Reading View | Pending |
| TASK-013 | PWA Assets and Meta Tags | Pending |
| TASK-014 | Mobile Responsive Audit | Pending |
