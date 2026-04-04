# System Architecture

**Last Updated**: 2026-04-04
**Maintained by**: Architect Agent
**Status**: Active — Milestone 1 shipped

---

## How to Use This Document

This is the single source of truth for the system's technical shape. Every agent
reads it before acting. Every significant decision made by the Architect is
reflected here.

For full technical detail on any milestone, see the linked design documents below.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | Next.js 14+ (App Router) | Chosen at project start; provides routing, API routes, and SSR in one package |
| Language | TypeScript (strict) | Type safety across pipeline, API, and UI; shared types prevent drift |
| Styling | Tailwind CSS | Utility-first; consistent with project setup; no separate CSS files |
| Package manager | npm | Project default |
| Platform | PWA (Progressive Web App) | Installable on mobile without app stores; works on desktop too |
| Storage (v1) | JSON files on filesystem | Zero infrastructure; adequate for 20 articles/day; trivially replaceable |

---

## Repository Structure

```
newsfeed/
├── agents/                   ← Agent shared memory (never delete)
│   ├── ba/                   ← BRDs produced by the BA agent
│   ├── pm/                   ← User stories and roadmap produced by the PM agent
│   ├── architect/            ← Design docs, task lists, and this file
│   └── shared/               ← Cross-agent reference material
├── app/                      ← Next.js App Router source
│   ├── api/                  ← Route Handlers (backend endpoints)
│   │   ├── articles/[id]/    ← GET /api/articles/[id]
│   │   ├── feed/today/       ← GET /api/feed/today
│   │   └── pipeline/run/     ← POST /api/pipeline/run
│   ├── articles/[id]/        ← Article reading view page
│   ├── components/           ← Shared React components
│   └── page.tsx              ← Feed homepage (/)
├── data/                     ← Runtime data (mostly git-ignored)
│   ├── batches/              ← Daily article JSON files (git-ignored)
│   ├── pipeline.log          ← Append-only pipeline run log (git-ignored)
│   └── sources.json          ← Source configuration (checked into git)
├── lib/                      ← Server-side business logic
│   ├── pipeline/             ← Content pipeline modules
│   │   ├── adapters/         ← Per-source-type fetch adapters
│   │   ├── config.ts         ← Constants and source loader
│   │   ├── run.ts            ← Pipeline orchestrator
│   │   ├── storage.ts        ← Batch file read/write
│   │   └── validator.ts      ← Article validation and deduplication
│   └── types/                ← Shared TypeScript types
│       └── article.ts        ← Article, FeedResponse, ArticleBatch, Source
├── public/                   ← Static assets
│   ├── icons/                ← PWA icons (192x192, 512x512)
│   ├── manifest.json         ← Web App Manifest
│   └── sw.js                 ← Minimal service worker
├── .env.example              ← Env var names with no values (checked in)
├── .env.local                ← Real env vars (never committed)
└── CLAUDE.md                 ← Project constitution (read by all agents)
```

---

## Data Models

Full TypeScript definitions live in `lib/types/article.ts`. Summary:

**`Article`** — canonical shape of one article, shared by pipeline, API, and UI.
- Required: `id`, `title`, `sourceName`, `sourceUrl`, `articleUrl`, `publishedAt`,
  `fetchedAt`, `batchDate`
- Optional: `description`, `imageUrl`, `bodyText`, `feedbackSlot`
- `feedbackSlot?: 'like' | 'dislike' | null` — reserved for Milestone 2; always
  null/absent in v1

**`FeedResponse`** — envelope returned by `GET /api/feed/today`
- `batchDate: string` (YYYY-MM-DD) + `articles: Article[]`

**`ArticleBatch`** — shape of a stored `data/batches/YYYY-MM-DD.json` file
- `batchDate`, `generatedAt` (ISO-8601), `articles: Article[]`

**`Source`** — entry in `data/sources.json`
- `slug`, `name`, `url`, `type: 'rss' | 'newsapi'`, `active: boolean`
- Optional: `feedUrl` (for RSS), `query` (for NewsAPI)

---

## API Routes

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET | `/api/feed/today` | Returns today's article batch (falls back to most recent if today's doesn't exist) | None |
| GET | `/api/articles/[id]` | Returns single article by ID; 404 if not found | None |
| POST | `/api/pipeline/run` | Triggers content pipeline; idempotent per day (409 if batch exists) | `Authorization: Bearer <CRON_SECRET>` |

---

## Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | JSON files on filesystem | Zero infrastructure; trivially migrated; fine for n=20/day |
| Primary content source | RSS feeds | Free, no API key, broad coverage, often includes full text |
| Secondary content source | NewsAPI.org | Satisfies "web search discovery" requirement; free tier covers 1 run/day |
| Body text strategy | Best-effort from RSS `content` field | Avoids scraping complexity in v1; graceful fallback UX |
| Pipeline trigger | HTTP endpoint guarded by `CRON_SECRET` | Works with any external cron service; no vendor lock-in |
| PWA service worker | Hand-written minimal SW (not `next-pwa`) | Avoids `next-pwa` compatibility issues with App Router |
| Article ID | `<source-slug>-<sha256-of-url>[0..8]` | Stable, deterministic, no collision risk for n=20 |
| Client routing | Next.js App Router `Link` | Already the framework |
| Dedup strategy | By `articleUrl` | Same article from two sources yields one record |

---

## Environment Variables

| Variable | Required For | Notes |
|----------|-------------|-------|
| `NEWSAPI_KEY` | NewsAPI adapter | Free tier: 100 req/day. **Dev use only** — upgrade before public deployment |
| `CRON_SECRET` | Pipeline trigger auth | Random string; set in `.env.local` |

---

## What Has Been Built

| Layer | Status | Notes |
|-------|--------|-------|
| Project scaffolding (rss-parser, .env.example, .gitignore, sources.json) | **Shipped** | TASK-001 |
| TypeScript types (`lib/types/article.ts`) | **Shipped** | TASK-002 |
| Pipeline config + storage | **Shipped** | TASK-003 |
| RSS adapter | **Shipped** | TASK-004 |
| NewsAPI adapter | **Shipped** | TASK-005 |
| Pipeline validator + orchestrator | **Shipped** | TASK-006 |
| Pipeline API route (`POST /api/pipeline/run`) | **Shipped** | TASK-007 |
| Feed API route (`GET /api/feed/today`) | **Shipped** | TASK-008 |
| Article API route (`GET /api/articles/[id]`) | **Shipped** | TASK-009 |
| UI components (ArticleCard, FeedSkeleton, ErrorState, BatchLabel, ViewSourceLink) | **Shipped** | TASK-010 |
| Feed page (`/`) | **Shipped** | TASK-011 |
| Article reading view (`/articles/[id]`) | **Shipped** | TASK-012 |
| PWA assets (manifest, sw.js, icons, layout meta) | **Shipped** | TASK-013 |
| Mobile responsive audit | **Shipped** | TASK-014 |
| Client-side feedback store (`lib/feedback/store.ts`) | **Shipped** | FB-TASK-002 |
| FeedbackButtons component (`app/components/FeedbackButtons.tsx`) | **Shipped** | FB-TASK-003 |

---

## Design Documents

| Milestone | Design Doc | Task List |
|-----------|-----------|-----------|
| Milestone 1 — Core Daily Digest | `agents/architect/design_article_feed_v1.md` | `agents/architect/tasks_article_feed_v1.md` |
| Milestone 2 — Feedback System | `agents/architect/design_feedback_capture_v1.md` | `agents/architect/tasks_feedback_capture_v1.md` |

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-04 | Architect Agent | Initial ARCHITECTURE.md created from design_article_feed_v1.md |
| 2026-04-04 | Dev Agent | All 14 Milestone 1 tasks shipped. "What Has Been Built" table updated. |
| 2026-04-04 | Architect Agent | Milestone 2 design complete. Added FeedbackStore and FeedbackButtons to build table. Added design_feedback_capture_v1.md and tasks_feedback_capture_v1.md. |
| 2026-04-04 | Dev Agent | FB-TASK-001–005 shipped. FeedbackStore, FeedbackButtons, ArticleCard refactor, article detail integration complete. FB-TASK-006 pending manual verification. |
