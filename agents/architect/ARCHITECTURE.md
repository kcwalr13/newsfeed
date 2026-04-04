# System Architecture

**Last Updated**: 2026-04-04
**Maintained by**: Architect Agent
**Status**: Active — Milestone 4 in progress

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
│   │   ├── auth/             ← Auth endpoints (register, login, logout, me, etc.)
│   │   ├── feed/today/       ← GET /api/feed/today
│   │   ├── feedback/         ← GET + POST /api/feedback
│   │   ├── feedback/[articleId]/ ← DELETE /api/feedback/[articleId]
│   │   └── pipeline/run/     ← POST /api/pipeline/run
│   ├── articles/[id]/        ← Article reading view page
│   ├── auth/                 ← /auth page (register/login/forgot/reset)
│   ├── components/           ← Shared React components
│   └── page.tsx              ← Feed homepage (/)
├── data/                     ← Runtime data (mostly git-ignored)
│   ├── batches/              ← Daily article JSON files (git-ignored)
│   ├── pipeline.log          ← Append-only pipeline run log (git-ignored)
│   ├── refresh_cooldowns.json ← Per-user manual refresh timestamps (git-ignored)
│   └── sources.json          ← Source configuration (checked into git)
├── lib/                      ← Server-side business logic
│   ├── auth/                 ← Session middleware
│   │   └── session.ts        ← resolveSession(), buildSessionCookie(), clearSessionCookie()
│   ├── db/                   ← Database query helpers
│   │   ├── auth.ts           ← Users, sessions, tokens query helpers
│   │   ├── client.ts         ← Neon DB connection singleton
│   │   └── feedback.ts       ← Feedback query helpers
│   ├── email/                ← Email dispatch
│   │   └── send.ts           ← Nodemailer SMTP wrapper
│   ├── identity/             ← Client-side device identity
│   │   └── device.ts         ← initDeviceId(), readDeviceId(), getDeviceHeaders()
│   ├── feedback/             ← Client-side feedback store
│   │   └── store.ts          ← localStorage + server write logic
│   ├── pipeline/             ← Content pipeline modules
│   │   ├── adapters/         ← Per-source-type fetch adapters
│   │   ├── config.ts         ← Constants and source loader
│   │   ├── cooldown.ts       ← Per-user refresh cooldown tracker (filesystem-backed)
│   │   ├── ranker.ts         ← Feed personalization ranker (pure function)
│   │   ├── run.ts            ← Pipeline orchestrator
│   │   ├── storage.ts        ← Batch file read/write
│   │   └── validator.ts      ← Article validation and deduplication
│   └── types/                ← Shared TypeScript types
│       ├── article.ts        ← Article, FeedResponse, ArticleBatch, Source
│       ├── auth.ts           ← DbUser, DbSession, DbToken
│       └── feedback.ts       ← QueuedWrite, ServerFeedbackMap
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

Full TypeScript definitions live in `lib/types/`. Summary:

**`Article`** — canonical shape of one article, shared by pipeline, API, and UI.
- Required: `id`, `title`, `sourceName`, `sourceUrl`, `articleUrl`, `publishedAt`,
  `fetchedAt`, `batchDate`
- Optional: `description`, `imageUrl`, `bodyText`, `feedbackSlot`
- `feedbackSlot?: 'like' | 'dislike' | null`

**`FeedResponse`** — envelope returned by `GET /api/feed/today`
- `batchDate: string` (YYYY-MM-DD) + `articles: Article[]`

**`ArticleBatch`** — shape of a stored `data/batches/YYYY-MM-DD.json` file
- `batchDate`, `generatedAt` (ISO-8601), `articles: Article[]`

**`Source`** — entry in `data/sources.json`
- `slug`, `name`, `url`, `type: 'rss' | 'newsapi'`, `active: boolean`
- Optional: `feedUrl` (for RSS), `query` (for NewsAPI)

**`DbUser`** — `lib/types/auth.ts`
- `user_id`, `email`, `hashed_password`, `email_verified_at`, `created_at`

**`DbSession`** — `lib/types/auth.ts`
- `session_id`, `user_id`, `created_at`, `last_active_at`, `expires_at`

---

## API Routes

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET | `/api/feed/today` | Returns today's article batch | None |
| GET | `/api/articles/[id]` | Returns single article by ID | None |
| POST | `/api/pipeline/run` | Triggers content pipeline | `Authorization: Bearer <CRON_SECRET>` |
| GET | `/api/feedback` | Returns feedback for current device or user | Device cookie / `X-Device-ID` header |
| POST | `/api/feedback` | Upserts a feedback record | Device cookie / `X-Device-ID` header |
| DELETE | `/api/feedback/[articleId]` | Deletes a feedback record | Device cookie / `X-Device-ID` header |
| POST | `/api/feedback/migrate` | One-time bulk upsert from localStorage | Device cookie / `X-Device-ID` header |
| POST | `/api/auth/register` | Create user account | None |
| GET | `/api/auth/verify-email` | Verify email address via token | None |
| POST | `/api/auth/resend-verification` | Resend email verification link | None |
| POST | `/api/auth/login` | Authenticate and create session | None |
| POST | `/api/auth/logout` | Invalidate current session | `dd_session` cookie |
| GET | `/api/auth/me` | Return current authenticated user | `dd_session` cookie |
| POST | `/api/auth/forgot-password` | Send password reset email | None |
| POST | `/api/auth/reset-password` | Set new password, invalidate sessions | None |
| POST | `/api/feed/refresh` | Triggers manual pipeline run with cooldown enforcement | `dd_session` cookie (authenticated users only) |

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
| Feed personalization | API-time ranking in `rankFeed()` | Avoids per-identity batch file proliferation; ranking is O(20 articles) in memory; single shared batch on disk unchanged; graceful DB failure degrades to unranked feed |
| Manual refresh cooldown storage | JSON file at `data/refresh_cooldowns.json` | Survives server restarts; consistent with filesystem-first architecture; no new DB table needed |
| Same-day batch overwrite | `writeBatch` with force flag | Manual refresh overwrites same-day file; `GET /api/feed/today` reads the latest state naturally |
| Password hashing | bcryptjs, cost=12 | No native bindings needed; works on serverless; industry standard |
| Session tokens | Random 32-byte hex in DB (`sessions` table) | Enables server-side invalidation on logout; required for 30-day sliding window |
| Session transport | `HttpOnly` cookie `dd_session` | Cannot be read by JS; separate from `dd_device_id` which must be JS-readable |
| Email sending | Nodemailer + SMTP | Provider-agnostic; no vendor SDK lock-in; volume too low to require an API |

---

## Environment Variables

| Variable | Required For | Notes |
|----------|-------------|-------|
| `NEWSAPI_KEY` | NewsAPI adapter | Free tier: 100 req/day. **Dev use only** — upgrade before public deployment |
| `CRON_SECRET` | Pipeline trigger auth | Random string; set in `.env.local` |
| `DATABASE_URL` | All DB routes | Neon connection string: `postgresql://user:pass@host/dbname?sslmode=require`. Never committed. |
| `SMTP_HOST` | Email sending | e.g. `smtp.mailtrap.io` (dev) or `smtp.postmarkapp.com` (prod) |
| `SMTP_PORT` | Email sending | `587` (STARTTLS, default) or `465` (SSL) |
| `SMTP_USER` | Email sending | SMTP username or API token |
| `SMTP_PASS` | Email sending | SMTP password or API token secret |
| `EMAIL_FROM` | Email sending | From address: `"Daily Digest <noreply@yourdomain.com>"` |
| `NEXTAUTH_URL` | Email link generation | Base URL: `http://localhost:3000` (dev), `https://yourdomain.com` (prod) |

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
| Device identity module (`lib/identity/device.ts`) | **Shipped** | SFB-TASK-006 |
| Database client + query helpers (`lib/db/`) | **Shipped** | SFB-TASK-002 |
| Feedback API routes (`app/api/feedback/`) | **Shipped** | SFB-TASK-003–005 |
| Server write integration + offline queue (`lib/feedback/store.ts`) | **Shipped** | SFB-TASK-007–009 |
| Auth DDL (`users`, `sessions`, `verification_tokens` tables) | **Shipped** | AUTH-TASK-001 |
| Auth DB helpers (`lib/db/auth.ts`, `lib/types/auth.ts`) | **Shipped** | AUTH-TASK-002 |
| Session middleware (`lib/auth/session.ts`) | **Shipped** | AUTH-TASK-003 |
| Register + Verify Email + Resend APIs | **Shipped** | AUTH-TASK-004 |
| Login API with feedback migration | **Shipped** | AUTH-TASK-005 |
| Password Reset APIs (forgot + reset) | **Shipped** | AUTH-TASK-006 |
| Logout + Me APIs | **Shipped** | AUTH-TASK-007 |
| Email module (`lib/email/send.ts`) | **Shipped** | AUTH-TASK-008 |
| Feedback DB/route changes for user identity | **Shipped** | AUTH-TASK-009 |
| Auth Context + AccountIcon component | **Shipped** | AUTH-TASK-010 |
| `/auth` page (register/login/forgot/reset) | **Shipped** | AUTH-TASK-011 |
| Feed page and article page header integration | **Shipped** | AUTH-TASK-012 |
| ARCHITECTURE.md Milestone 3 update | **Shipped** | AUTH-TASK-013 |
| Feed ranker module (`lib/pipeline/ranker.ts`) | **Shipped** | PERS-TASK-001 |
| Personalized `GET /api/feed/today` route | **Shipped** | PERS-TASK-002 |
| Integration + edge-case verification | **Shipped** | PERS-TASK-003, PERS-TASK-004 |
| ARCHITECTURE.md Milestone 4 update | **Shipped** | PERS-TASK-005 |
| Pipeline constants (per-source cap, min sources) in `lib/pipeline/config.ts` | **Shipped** | REFRESH-TASK-001 |
| Per-source cap + failure isolation + diversity warning in `lib/pipeline/run.ts` | **Shipped** | REFRESH-TASK-002 |
| Cooldown tracker module (`lib/pipeline/cooldown.ts`) | **Shipped** | REFRESH-TASK-003 |
| `POST /api/feed/refresh` route | **Shipped** | REFRESH-TASK-004 |
| `FeedResponse` expose `generatedAt` | **Shipped** | REFRESH-TASK-005 |
| `GET /api/feed/today` include `generatedAt` in response | **Shipped** | REFRESH-TASK-006 |
| `LastUpdatedLabel` component | **Shipped** | REFRESH-TASK-007 |
| `RefreshButton` component | **Shipped** | REFRESH-TASK-008 |
| Feed page integration (button + label wired up) | **Shipped** | REFRESH-TASK-009 |
| Manual verification | **Not started** | REFRESH-TASK-010 |
| ARCHITECTURE.md Milestone 5 update | **Shipped** | REFRESH-TASK-011 |

---

## Design Documents

| Milestone | Design Doc | Task List |
|-----------|-----------|-----------|
| Milestone 1 — Core Daily Digest | `agents/architect/design_article_feed_v1.md` | `agents/architect/tasks_article_feed_v1.md` |
| Milestone 2 — Feedback System | `agents/architect/design_feedback_capture_v1.md` | `agents/architect/tasks_feedback_capture_v1.md` |
| Milestone 2.5 — Feedback Durability | `agents/architect/design_server_feedback_v1.md` | `agents/architect/tasks_server_feedback_v1.md` |
| Milestone 3 — Identity Foundation | `agents/architect/design_user_auth_v1.md` | `agents/architect/tasks_user_auth_v1.md` |
| Milestone 4 — Feed Personalization | `agents/architect/design_feed_personalization_v1.md` | `agents/architect/tasks_feed_personalization_v1.md` |
| Milestone 5 — Feed Refresh and Source Diversity | `agents/architect/design_feed_refresh_v1.md` | `agents/architect/tasks_feed_refresh_v1.md` |

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-04 | Architect Agent | Initial ARCHITECTURE.md created from design_article_feed_v1.md |
| 2026-04-04 | Dev Agent | All 14 Milestone 1 tasks shipped. "What Has Been Built" table updated. |
| 2026-04-04 | Architect Agent | Milestone 2 design complete. Added FeedbackStore and FeedbackButtons to build table. Added design_feedback_capture_v1.md and tasks_feedback_capture_v1.md. |
| 2026-04-04 | Dev Agent | FB-TASK-001–005 shipped. FeedbackStore, FeedbackButtons, ArticleCard refactor, article detail integration complete. FB-TASK-006 pending manual verification. |
| 2026-04-04 | Architect Agent | Milestone 2.5 design complete. Added device identity, DB layer, feedback API routes, and server write integration to build table. Added DATABASE_URL to env vars. |
| 2026-04-04 | Architect Agent | Milestone 3 design complete. Added auth tables, session middleware, 8 new auth API routes, email module, Auth Context, AccountIcon, and /auth page. Added SMTP env vars and NEXTAUTH_URL. 13 new tasks, all Not started. |
| 2026-04-04 | Dev Agent | All 13 Milestone 3 tasks shipped. Registration, email verification, login, password reset, logout, device→user feedback migration, cross-device merge, AuthContext, AccountIcon, /auth page all complete and verified. |
| 2026-04-04 | Architect Agent | Milestone 4 design complete. API-time feed personalization via rankFeed(). Wilson score lower bound for source scoring. One new module (lib/pipeline/ranker.ts), one modified route (app/api/feed/today/route.ts). 5 tasks, all Not started. |
| 2026-04-04 | Dev Agent | All 5 Milestone 4 tasks shipped. lib/pipeline/ranker.ts created (rankFeed, Wilson score, suppression, exploration, diversity cap). GET /api/feed/today updated with identity resolution and graceful DB fallback. All algorithm edge cases verified. |
| 2026-04-04 | Architect Agent | Milestone 5 design complete. Manual refresh endpoint with filesystem cooldown. Per-source article cap and failure isolation in run.ts. generatedAt exposed in FeedResponse. LastUpdatedLabel and RefreshButton UI components. 11 tasks, all Not started. |
| 2026-04-04 | Dev Agent | REFRESH-TASK-001–009 shipped. Config constants, run.ts rewrite (allSettled isolation, per-source cap, diversity warning, forceOverwrite), cooldown.ts, POST /api/feed/refresh, generatedAt in FeedResponse + feed route, LastUpdatedLabel, RefreshButton, page.tsx integration. |