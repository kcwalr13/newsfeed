# Technical Design — Article Feed v1

**ID**: ARCH-DESIGN-001
**Stories Reference**: PM-STORIES-001 (FEED-001 through FEED-013)
**Date**: 2026-04-04
**Status**: Draft
**Author**: Architect Agent

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Model](#2-data-model)
3. [API Route Design](#3-api-route-design)
4. [Content Pipeline Design](#4-content-pipeline-design)
5. [Storage Strategy](#5-storage-strategy)
6. [PWA Configuration](#6-pwa-configuration)
7. [Key Decisions and Rationale](#7-key-decisions-and-rationale)
8. [External Dependencies and API Keys](#8-external-dependencies-and-api-keys)
9. [Deferred Items](#9-deferred-items)
10. [Directory Map](#10-directory-map)

---

## 1. Architecture Overview

The system has three distinct runtime contexts:

```
┌─────────────────────────────────────────────────────────────────┐
│  CONTENT PIPELINE (server-side, scheduled)                      │
│  lib/pipeline/fetchArticles.ts                                  │
│    → RSS adapter (fast-xml-parser / rss-parser)                 │
│    → NewsAPI adapter (REST, free tier)                          │
│    → Validator (strips invalid articles, enforces quota)        │
│    → Writer (appends JSON batch file to data/batches/)          │
│                                                                 │
│  Triggered by: Next.js Route Handler with cron header guard     │
│  POST /api/pipeline/run  (protected by CRON_SECRET header)      │
└─────────────────────────────────────────────────────────────────┘
           ↓ writes
┌─────────────────────────────────────────────────────────────────┐
│  FILE STORE  (local filesystem, git-ignored)                    │
│  data/batches/YYYY-MM-DD.json   — one file per day             │
│  data/sources.json              — configurable source list      │
│  data/pipeline.log              — append-only run log           │
└─────────────────────────────────────────────────────────────────┘
           ↑ reads
┌─────────────────────────────────────────────────────────────────┐
│  FEED API (Next.js Route Handlers, server-side)                 │
│  GET /api/feed/today                                            │
│  GET /api/articles/[id]                                         │
└─────────────────────────────────────────────────────────────────┘
           ↑ fetches
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (React, client-side)                                  │
│  /           → FeedPage (article card list)                     │
│  /articles/[id]  → ArticlePage (reading view)                   │
└─────────────────────────────────────────────────────────────────┘
```

### What Gets Built

| Layer | Location | Description |
|-------|----------|-------------|
| Types | `lib/types/article.ts` | Shared TypeScript types |
| Pipeline config | `lib/pipeline/config.ts` | ARTICLES_PER_DAY, source list path, batch dir |
| RSS adapter | `lib/pipeline/adapters/rssAdapter.ts` | Fetches + parses RSS feeds |
| NewsAPI adapter | `lib/pipeline/adapters/newsApiAdapter.ts` | Calls NewsAPI.org REST API |
| Validator | `lib/pipeline/validator.ts` | Validates and filters article candidates |
| Storage | `lib/pipeline/storage.ts` | Read/write batch JSON files, log writer |
| Pipeline runner | `lib/pipeline/run.ts` | Orchestrates adapters → validate → store |
| API: pipeline | `app/api/pipeline/run/route.ts` | POST endpoint; cron + manual trigger |
| API: feed today | `app/api/feed/today/route.ts` | GET today's batch |
| API: article by id | `app/api/articles/[id]/route.ts` | GET single article |
| Feed page | `app/(feed)/page.tsx` | Homepage; replaces scaffold |
| Article page | `app/(feed)/articles/[id]/page.tsx` | Reading view |
| Components | `app/components/` | ArticleCard, FeedSkeleton, ErrorState, BatchLabel, ViewSourceLink |
| PWA assets | `public/manifest.json`, `public/sw.js` | Installability |

---

## 2. Data Model

All types live in `lib/types/article.ts`.

```typescript
/**
 * The canonical shape of a single article stored in a daily batch.
 * This type is shared by the pipeline, API layer, and UI.
 */
export interface Article {
  /** Stable unique identifier. Format: "<source-slug>-<hash-of-url>" */
  id: string;

  /** Article headline. Never null or empty — articles without a title are discarded. */
  title: string;

  /** Human-readable name of the publication or feed origin (e.g. "BBC News"). */
  sourceName: string;

  /** Root URL of the source publication (e.g. "https://www.bbc.com"). */
  sourceUrl: string;

  /** Direct URL to the original article. Used for "View Source" link. */
  articleUrl: string;

  /** ISO-8601 datetime string when the article was originally published. */
  publishedAt: string;

  /** ISO-8601 datetime string when this article was fetched by the pipeline. */
  fetchedAt: string;

  /**
   * YYYY-MM-DD string identifying which daily batch this article belongs to.
   * This is the date the pipeline ran, not necessarily the article's publish date.
   */
  batchDate: string;

  /**
   * Short summary or lede. Optional — UI renders text-only card when absent.
   * @optional
   */
  description?: string;

  /**
   * URL of the article's lead image. Optional — UI omits image when absent.
   * @optional
   */
  imageUrl?: string;

  /**
   * Full body text of the article, plain text or minimal HTML.
   * Used for the in-app reading view. Optional — reading view shows fallback
   * message ("Full text not available") when absent.
   * @optional
   */
  bodyText?: string;

  /**
   * Reserved slot for a future like/dislike signal.
   * Value is always null in v1. When the feedback system ships (Milestone 2),
   * this field will be written without any schema migration on stored records.
   * Allowed values once active: "like" | "dislike" | null
   * @optional
   */
  feedbackSlot?: 'like' | 'dislike' | null;
}

/**
 * The envelope returned by GET /api/feed/today.
 * The batchDate field tells the UI whether it is showing today's content
 * or a prior day's fallback.
 */
export interface FeedResponse {
  /** YYYY-MM-DD of the batch being returned. */
  batchDate: string;

  /** Ordered array of articles in this batch. Empty array on cold start. */
  articles: Article[];
}

/**
 * Shape of a single day's batch file as stored on disk (data/batches/YYYY-MM-DD.json).
 */
export interface ArticleBatch {
  batchDate: string;
  generatedAt: string; // ISO-8601 datetime of the pipeline run
  articles: Article[];
}

/**
 * A single entry in the source configuration file (data/sources.json).
 */
export interface Source {
  /** Unique slug used in article ID generation (e.g. "bbc-news"). */
  slug: string;

  /** Human-readable name (e.g. "BBC News"). */
  name: string;

  /** Root URL of the publication. */
  url: string;

  /** Source adapter type. Determines which pipeline adapter handles it. */
  type: 'rss' | 'newsapi';

  /**
   * RSS feed URL. Required when type === 'rss'.
   * @optional
   */
  feedUrl?: string;

  /**
   * NewsAPI query string or topic keyword. Required when type === 'newsapi'.
   * @optional
   */
  query?: string;

  /**
   * Whether this source is active. Inactive sources are skipped by the pipeline.
   * Default: true.
   */
  active: boolean;
}
```

---

## 3. API Route Design

### 3.1  GET /api/feed/today

**File**: `app/api/feed/today/route.ts`

**Purpose**: Returns the current daily batch for the feed page.

**Response (200)**:
```json
{
  "batchDate": "2026-04-04",
  "articles": [ /* Article[] */ ]
}
```

**Behavior**:
- Reads `data/batches/<today>.json`.
- If today's file does not exist, scans `data/batches/` for the most recent file and returns that.
- If no files exist at all, returns `{ "batchDate": "", "articles": [] }` with HTTP 200.
- Never returns 404.

**Caching**: Set `Cache-Control: no-store` — the batch is fixed per day but the fallback behavior
(today's vs. yesterday's) must be evaluated at request time.

---

### 3.2  GET /api/articles/[id]

**File**: `app/api/articles/[id]/route.ts`

**Purpose**: Returns a single article by ID for the reading view.

**Response (200)**:
```json
{ /* Article */ }
```

**Response (404)**:
```json
{ "error": "Article not found" }
```

**Behavior**:
- Reads today's batch (same fallback logic as `/api/feed/today`).
- Searches the articles array for a matching `id`.
- Because article IDs are stable within a batch, this is an O(n) scan — acceptable for n=20.
- No cross-batch search in v1 (an article from a prior day that is not in the current batch
  will return 404; acceptable because article detail links are only surfaced from the
  current feed).

---

### 3.3  POST /api/pipeline/run

**File**: `app/api/pipeline/run/route.ts`

**Purpose**: Triggers the content pipeline. Protected so it cannot be invoked by
unauthenticated clients.

**Auth**: Checks `Authorization: Bearer <CRON_SECRET>` header. If absent or wrong,
returns 401.

**Response (200)**:
```json
{ "ok": true, "batchDate": "2026-04-04", "count": 20 }
```

**Response (409)**:
```json
{ "ok": false, "error": "Batch already exists for today" }
```

**Notes**:
- Idempotent per day: if today's batch already exists, the endpoint returns 409 and does
  not overwrite.
- Allows manual re-trigger from a cron service (e.g. Vercel Cron, GitHub Actions, cron-job.org).
- Logs result to `data/pipeline.log`.

---

## 4. Content Pipeline Design

### 4.1  Source Configuration

A static JSON file at `data/sources.json` lists all sources. This file is checked into
version control (unlike batch data) and is the single place to add/remove sources.
Example initial set:

```json
[
  {
    "slug": "bbc-news",
    "name": "BBC News",
    "url": "https://www.bbc.com",
    "type": "rss",
    "feedUrl": "https://feeds.bbci.co.uk/news/rss.xml",
    "active": true
  },
  {
    "slug": "ars-technica",
    "name": "Ars Technica",
    "url": "https://arstechnica.com",
    "type": "rss",
    "feedUrl": "https://feeds.arstechnica.com/arstechnica/index",
    "active": true
  },
  {
    "slug": "the-verge",
    "name": "The Verge",
    "url": "https://www.theverge.com",
    "type": "rss",
    "feedUrl": "https://www.theverge.com/rss/index.xml",
    "active": true
  },
  {
    "slug": "nasa",
    "name": "NASA",
    "url": "https://www.nasa.gov",
    "type": "rss",
    "feedUrl": "https://www.nasa.gov/rss/dyn/breaking_news.rss",
    "active": true
  },
  {
    "slug": "newsapi-general",
    "name": "NewsAPI — Top Headlines",
    "url": "https://newsapi.org",
    "type": "newsapi",
    "query": "top-headlines",
    "active": true
  }
]
```

The eclectic mix (tech, science, general news) is achieved through the source list, not
through pipeline logic. Adding a new source requires only editing `sources.json`.

### 4.2  Pipeline Execution Flow

```
pipeline/run.ts
  1. Load sources.json → filter active sources
  2. For each source, call appropriate adapter:
       rss     → rssAdapter.ts
       newsapi → newsApiAdapter.ts
  3. Collect all raw candidates into a single pool (may be >> 20)
  4. Pass pool through validator.ts:
       - Discard any article missing title or articleUrl
       - Deduplicate by articleUrl
       - Trim pool to ARTICLES_PER_DAY (take first N after dedup)
  5. If validated pool < ARTICLES_PER_DAY:
       - Log warning with actual count
       - Continue with whatever is available (do not error)
  6. Assign stable IDs to each article (slugify source + hash of URL)
  7. Build ArticleBatch object
  8. Write to data/batches/YYYY-MM-DD.json via storage.ts
  9. Append result line to data/pipeline.log
 10. Return { batchDate, count }
```

### 4.3  RSS Adapter

- Library: `rss-parser` (small, well-maintained, no extra deps)
- Reads `feedUrl` from the source config
- Maps RSS fields to the Article shape:
  - `item.title` → `title`
  - `item.link` → `articleUrl`
  - `item.pubDate` → `publishedAt`
  - `item.contentSnippet` or `item.summary` → `description`
  - `item.enclosure.url` or `media:content` → `imageUrl`
  - `item.content` (if long enough) → `bodyText`
- Source-level fields (`sourceName`, `sourceUrl`) come from the Source config record.

### 4.4  NewsAPI Adapter

- API: [NewsAPI.org](https://newsapi.org) free tier (developer plan, 100 req/day)
- Endpoint used: `GET https://newsapi.org/v2/top-headlines?language=en&pageSize=20`
- API key stored in env var: `NEWSAPI_KEY`
- Maps NewsAPI response fields to the Article shape:
  - `article.title` → `title`
  - `article.url` → `articleUrl`
  - `article.publishedAt` → `publishedAt`
  - `article.description` → `description`
  - `article.urlToImage` → `imageUrl`
  - `article.content` → `bodyText` (NOTE: NewsAPI free tier truncates content at 200 chars;
    treated as a description fallback rather than full body text)
  - `article.source.name` → `sourceName`
  - Derive `sourceUrl` from origin of `article.url`

### 4.5  Body Text Strategy

Full article body text is hard to obtain reliably in v1 without a paid scraping service
or browser automation. The approach:

- RSS feeds: use `item.content:encoded` or `item.content` when present; many feeds
  include full text.
- NewsAPI: `content` field is truncated; treat as `description` only.
- For articles where full body is unavailable, `bodyText` is simply not set (undefined).
  The reading view handles this gracefully per FEED-010 acceptance criteria.

A future task can add a body-scraping step (e.g. using `@extractus/article-extractor`)
as a post-validation enrichment pass without changing the data model.

---

## 5. Storage Strategy

**Decision**: JSON files on the local filesystem under `data/batches/`.

**Rationale**:
- No database setup, no connection management, no schema migrations.
- Perfectly adequate for 20 articles/day read by at most a handful of users in v1.
- Batch files are human-readable and trivially debuggable.
- The data model is forward-compatible: adding fields to the JSON does not break existing
  readers (TypeScript optional fields).
- Migrating to a proper database (SQLite, Postgres, etc.) in a future milestone is
  straightforward: the `storage.ts` module is the only thing that needs to change.

**File layout**:
```
data/
  batches/
    2026-04-04.json    ← ArticleBatch shape
    2026-04-05.json
    ...
  sources.json         ← Source[] (checked into git)
  pipeline.log         ← append-only plain text run log
```

**Git ignore rules**: `data/batches/` and `data/pipeline.log` should be added to
`.gitignore`. `data/sources.json` is checked in (it is configuration, not runtime data).

**Cold start**: On first deploy, `data/batches/` is empty. `GET /api/feed/today` returns
`{ batchDate: "", articles: [] }` and the UI renders a graceful empty state message.
The pipeline must be triggered manually (or by the first cron run) to populate the feed.

---

## 6. PWA Configuration

The Next.js scaffold already has a `public/` directory. PWA installability requires:

1. **Web App Manifest** (`public/manifest.json`): `name`, `short_name`, `start_url: "/"`,
   `display: "standalone"`, `theme_color`, `background_color`, icons at 192x192 and 512x512.

2. **Service Worker** (`public/sw.js`): Minimal registration-only service worker. No
   offline caching strategy in v1 (deferred to FUTURE-006). The SW is required by Chrome
   and Safari for "Add to Home Screen" eligibility.

3. **Meta tags** in `app/layout.tsx`: `<link rel="manifest">`, `<meta name="theme-color">`,
   `<meta name="apple-mobile-web-app-capable" content="yes">`.

4. **Icons**: Two PNG icons at minimum (192x192 and 512x512). Place in `public/icons/`.

**Library choice**: `next-pwa` is not used in v1. It adds complexity and its latest
version has compatibility issues with Next.js App Router. A hand-written minimal SW and
a static manifest is simpler and more transparent.

---

## 7. Key Decisions and Rationale

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | JSON files | Zero infrastructure; trivially migrated later; fine for n=20/day |
| Content fetch — primary | RSS feeds | Free, no API key, broad source coverage, often includes full text |
| Content fetch — secondary | NewsAPI.org | Provides web search discovery mechanism required by FEED-001; free tier covers 1 run/day |
| Body text | Best-effort from RSS `content` field | Avoids web scraping complexity in v1; transparent fallback UX |
| Pipeline trigger | HTTP endpoint guarded by CRON_SECRET | Works with any external cron service; no vendor lock-in |
| PWA SW | Hand-written minimal SW | Avoids `next-pwa` compatibility issues with Next.js App Router; sufficient for installability |
| Article ID | `<source-slug>-<sha256-of-url>[0..8]` | Stable, deterministic, no collision risk for n=20, no DB needed |
| API auth | None on read endpoints | No user accounts in v1; content is public |
| Client-side routing | Next.js App Router `Link` | Already the framework; no additional router needed |
| Dedup strategy | By `articleUrl` | Simplest correct key; same article from two sources yields one record |

---

## 8. External Dependencies and API Keys

### New npm packages required

| Package | Purpose | Install command |
|---------|---------|-----------------|
| `rss-parser` | Parse RSS/Atom feeds | `npm install rss-parser` |
| `@types/rss-parser` | TypeScript types | Included in package or `npm install -D @types/rss-parser` |

No other new runtime dependencies are required. The existing Next.js + TypeScript + Tailwind
stack handles everything else.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEWSAPI_KEY` | Yes (for NewsAPI adapter) | API key from [newsapi.org](https://newsapi.org). Free tier: 100 req/day, developer use only. **Note**: NewsAPI free tier prohibits production server-side use; in v1 (personal/dev use) this is acceptable. Upgrade to paid plan before any public deployment. |
| `CRON_SECRET` | Yes (for pipeline trigger) | Random secret string. Used to authenticate `POST /api/pipeline/run`. Set in `.env.local`. |

Add both to `.env.local` (never committed). Document their names in `.env.example`.

---

## 9. Deferred Items

The following are explicitly out of scope for v1 and documented here to guide future
Architect sessions.

| Item | Deferred Reason |
|------|----------------|
| Full article body scraping | Requires a headless browser or scraping service (cost/complexity); best-effort RSS content is sufficient for v1 |
| Like/dislike UI | `feedbackSlot` field is reserved in schema; UI controls are Milestone 2 |
| Source weighting from feedback | Depends on Milestone 2 feedback system |
| Offline article caching | Requires non-trivial service worker cache strategy; not needed for installability |
| User accounts | Milestone 3; no auth system in place |
| Cross-batch article search | Article IDs are only surfaced in the current feed; no need to search prior batches |
| Database / ORM | File storage is sufficient for v1 scale |
| Rate limiting on API routes | No auth and single-user in v1; add when user accounts land |
| Image proxy / optimization | `next/image` with remote patterns can be added incrementally; deferred to keep task scope small |

---

## 10. Directory Map

Final expected file tree after all v1 tasks are complete:

```
newsfeed/
├── app/
│   ├── api/
│   │   ├── articles/
│   │   │   └── [id]/
│   │   │       └── route.ts
│   │   ├── feed/
│   │   │   └── today/
│   │   │       └── route.ts
│   │   └── pipeline/
│   │       └── run/
│   │           └── route.ts
│   ├── articles/
│   │   └── [id]/
│   │       └── page.tsx
│   ├── components/
│   │   ├── ArticleCard.tsx
│   │   ├── BatchLabel.tsx
│   │   ├── ErrorState.tsx
│   │   ├── FeedSkeleton.tsx
│   │   └── ViewSourceLink.tsx
│   ├── globals.css
│   ├── layout.tsx          ← modified (PWA meta tags)
│   └── page.tsx            ← replaced (feed page)
├── data/
│   ├── batches/            ← git-ignored
│   ├── pipeline.log        ← git-ignored
│   └── sources.json        ← checked in
├── lib/
│   ├── pipeline/
│   │   ├── adapters/
│   │   │   ├── newsApiAdapter.ts
│   │   │   └── rssAdapter.ts
│   │   ├── config.ts
│   │   ├── run.ts
│   │   ├── storage.ts
│   │   └── validator.ts
│   └── types/
│       └── article.ts
├── public/
│   ├── icons/
│   │   ├── icon-192.png
│   │   └── icon-512.png
│   ├── manifest.json
│   └── sw.js
├── .env.example
└── .gitignore              ← modified
```
