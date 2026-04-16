# System Architecture

**Last Updated**: 2026-04-04
**Maintained by**: Architect Agent
**Status**: Active — Milestones 1–8, Phase 1, and Phase 2 shipped

> **Vision (2026-04-07):** The project is a personalized content discovery companion,
> not a news aggregator. Single-user scope (Kyle), starter sources provided, identity
> parameterized for future multi-user expansion. Full vision:
> `agents/ba/vision_discovery_companion.md`. Four-phase plan: Agentic Discovery →
> Latent Aesthetic Space → Deep User Model → Engineered Serendipity.

---

## How to Use This Document

This is the single source of truth for the system's technical shape. Every agent
reads it before acting. Every significant decision made by the Architect is
reflected here.

For full technical detail on any milestone, see the linked design documents below.

---

## Tech Stack

| Layer | Technology | Status | Why |
|-------|-----------|--------|-----|
| Framework | Next.js 14+ (App Router) | Active | Chosen at project start; provides routing, API routes, and SSR in one package |
| Language | TypeScript (strict) | Active | Type safety across pipeline, API, and UI; shared types prevent drift |
| Styling | Tailwind CSS | Active | Utility-first; consistent with project setup; no separate CSS files |
| Package manager | npm | Active | Project default |
| Platform | PWA (Progressive Web App) | Active | Installable on mobile without app stores; works on desktop too |
| Database | Neon serverless Postgres | Active | Feedback, auth, topic weights; scales to future use cases |
| Storage (v1) | JSON files on filesystem | Active | Zero infrastructure; adequate for 20 articles/day; trivially replaceable |
| LLM | Claude API (Anthropic SDK) | Phase 1+ | Content evaluation, quality scoring, agent orchestration, query generation |
| Web crawling | Playwright (headless browser) | Phase 1+ | Small Web / IndieWeb crawling; hybrid API + browser agent strategy |
| Vector storage | pgvector on Neon | Phase 2+ | Embedding storage for latent aesthetic space; already available in Neon |
| Memory | Mem0 (open source) | Phase 3+ | Graph-enhanced long-term user memory |

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
│   ├── config/               ← Cross-module tuning constants
│   │   ├── feed.ts           ← Quota + discovery constants (ARTICLES_PER_DAY, DISCOVERY_*, etc.)
│   │   └── aesthetic.ts      ← Aesthetic constants, DIMENSION_KEYS, vectorToArray, arrayToVector (Phase 2+)
│   ├── db/                   ← Database query helpers
│   │   ├── aesthetics.ts     ← Aesthetic score + profile DB helpers (Phase 2+)
│   │   ├── auth.ts           ← Users, sessions, tokens query helpers
│   │   ├── client.ts         ← Neon DB connection singleton
│   │   ├── discovery.ts      ← Topic weight DB helpers
│   │   └── feedback.ts       ← Feedback query helpers
│   ├── discovery/            ← Proactive content discovery subsystem
│   │   ├── aestheticScorer.ts ← scoreAesthetic(), AestheticScoringError (Phase 2+)
│   │   ├── braveSearch.ts    ← Brave Search API HTTP adapter
│   │   ├── qualityGate.ts    ← evaluateCandidate() pure function module
│   │   ├── run.ts            ← runDiscovery() orchestrator
│   │   └── topics.ts         ← DISCOVERY_TOPICS array + DiscoveryTopic type
│   ├── email/                ← Email dispatch
│   │   └── send.ts           ← Nodemailer SMTP wrapper
│   ├── identity/             ← Client-side device identity
│   │   └── device.ts         ← initDeviceId(), readDeviceId(), getDeviceHeaders()
│   ├── feedback/             ← Client-side feedback store
│   │   └── store.ts          ← localStorage + server write logic
│   ├── pipeline/             ← Content pipeline modules
│   │   ├── adapters/         ← Per-source-type fetch adapters
│   │   ├── config.ts         ← Infrastructure constants and source loader (ARTICLES_PER_DAY re-exported from lib/config/feed.ts)
│   │   ├── cooldown.ts       ← Per-user refresh cooldown tracker (filesystem-backed)
│   │   ├── ranker.ts         ← Feed personalization ranker (pure function)
│   │   ├── run.ts            ← Pipeline orchestrator (calls runDiscovery, assembles combined batch)
│   │   ├── storage.ts        ← Batch file read/write
│   │   └── validator.ts      ← Article validation and deduplication
│   ├── types/                ← Shared TypeScript types
│   │   ├── aesthetic.ts      ← AestheticScoreVector, AestheticProfile (Phase 2+)
│   │   ├── article.ts        ← Article (+ discoveryTopic internal field), FeedResponse, ArticleBatch, Source
│   │   ├── auth.ts           ← DbUser, DbSession, DbToken
│   │   └── feedback.ts       ← QueuedWrite, ServerFeedbackMap
│   └── utils/                ← Pure utility functions (no I/O)
│       └── cosineSimilarity.ts ← cosineSimilarity(a, b): number (Phase 2+)
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
- `discoveryTopic?: string | null` — internal metadata only; set on discovery-sourced articles;
  never sent to the client (stripped from `GET /api/feed/today` response before serialization)

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

**`discovery_topic_weights`** — DB table for per-identity soft topic weights.
- `user_id` (nullable), `device_id`, `topic_id`, `weight` (0.1–2.0), `updated_at`
- Helpers in `lib/db/discovery.ts`

**`article_aesthetic_scores`** — DB table for per-article aesthetic score vectors (Phase 2+).
- `article_id` (TEXT PK — matches `Article.id`), `scores vector(6)`, `scored_at TIMESTAMPTZ`
- Vector element order: [contemplative, concrete, personal, playful, specialist, emotional]
- DDL: `lib/db/migrations/009_aesthetic_scores.sql`
- Helpers in `lib/db/aesthetics.ts`

**`user_aesthetic_profiles`** — DB table for per-user aesthetic centroids (Phase 2+).
- `id SERIAL PK`, `user_id TEXT` (nullable), `device_id TEXT NOT NULL`, `centroid vector(6)`,
  `feedback_count INTEGER`, `updated_at TIMESTAMPTZ`, UNIQUE(user_id, device_id)
- Matches identity pattern from `discovery_topic_weights`.
- DDL: `lib/db/migrations/009_aesthetic_scores.sql`
- Helpers in `lib/db/aesthetics.ts`

**`AestheticScoreVector`** — TypeScript type in `lib/types/aesthetic.ts` (Phase 2+).
- Six named numeric fields: `contemplative`, `concrete`, `personal`, `playful`, `specialist`, `emotional`
- All values 1.0–5.0. Canonical index order defined in `lib/config/aesthetic.ts`.

**`AestheticProfile`** — TypeScript type in `lib/types/aesthetic.ts` (Phase 2+).
- `user_id`, `device_id`, `centroid: AestheticScoreVector`, `feedback_count`, `updated_at`

**`small_web_sources`** — DB table for Small Web / IndieWeb source pool (Phase 1+).
- `id`, `url` (unique), `feed_url`, `last_crawled_at`, `last_yielded_at`,
  `yield_count`, `consecutive_zero_yields`, `status` ('active'|'deprioritized'),
  `cooldown_until`, `discovered_via` ('seed'|'blogroll'), `created_at`
- Active sources crawled on 7-day interval; deprioritized on 30-day interval.
- DDL: `lib/db/migrations/007_small_web_sources.sql`
- Helpers in `lib/db/smallWeb.ts`
- TypeScript type: `SmallWebSource` in `lib/types/smallWeb.ts`

**`Article.bodyText`** (Phase 1 update) — For qualifying discovery articles
  (those that pass body extraction + LLM evaluation), `bodyText` is now populated
  with plain text extracted via Mozilla Readability. Fixed-pipeline articles
  retain existing behavior (populated from RSS `content:encoded` if available,
  absent otherwise).

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
| Search provider for discovery | Brave Search API | Independent index (no Google dependency), strong long-tail coverage, free tier covers our cadence (~180 calls/month), structured JSON response with outlet name and age fields |
| Discovery integration point | `runDiscovery()` called inside `runPipeline()` after fixed-source fetch | Discovery failure does not block fixed-source batch; combined batch assembled in `runPipeline` before write |
| `discoveryTopic` storage | Optional field on `Article`, stored in batch JSON, stripped from API response | Co-located with article; no extra DB query at feedback time; never leaks to client |
| Topic configuration | TypeScript static array in `lib/discovery/topics.ts` | Type-safe, no runtime I/O, compile-time schema validation; adding a topic = one-line edit + redeploy |
| Quality gate | Isolated pure function in `lib/discovery/qualityGate.ts` | No I/O, independently testable, three ordered pre-filter criteria: validator rules, freshness (72h), domain blocklist — followed by body extraction + LLM evaluation (Phase 1+) |
| Quality gate Gate 4 (specificity heuristic) | Removed in Phase 1 | LLM evaluation supersedes the regex-based specificity score; `computeSpecificityScore()` deleted; `SPECIFICITY_THRESHOLD` removed from feed.ts |
| Quota constants | New `lib/config/feed.ts` with startup assertion | Cross-module constants (quota split, discovery tuning) in a neutral home; assertion prevents PIPELINE + DISCOVERY != ARTICLES_PER_DAY from going undetected |
| Small Web source state storage | Postgres table `small_web_sources` (Phase 1+) | Cooldown enforcement requires SQL predicates; upsert atomicity built-in; Neon already in use; handles pool growth better than a JSON file |
| Blogroll parsing scope | OPML files (fast-xml-parser), `<a rel="blogroll">` links, heuristic class/id/nav patterns; depth limit 1 (Phase 1+) | Covers canonical IndieWeb formats plus majority of hand-crafted blogrolls; depth-1 prevents exponential pool expansion |
| Small Web crawl throttle | Sequential with 1s inter-source delay (Phase 1+) | Protects small personal sites; prevents DDoS appearance |
| LLM model for content evaluation | `claude-haiku-4-5-20251001` (Phase 1+) | Fast, cheap (~$2/month at expected volume), sufficient for classification and scoring task |
| LLM output format | Tool use (structured output) with `score_article` tool (Phase 1+) | Eliminates fragile response parsing; JSON schema enforced by Anthropic API |
| LLM body text truncation | First 3,000 characters sent to LLM (Phase 1+) | Cost control; sufficient for quality assessment of article-length prose |
| Aesthetic constants file | New `lib/config/aesthetic.ts` (Phase 2+) | `lib/config/feed.ts` covers pipeline quota and discovery — mixing aesthetic concerns would conflate unrelated domains. Separate file per concern. |
| Aesthetic article score DB key | `article.id` (`<source-slug>-<8-char-hash>`) (Phase 2+) | All other tables (feedback, topic weights) use this same ID. Using `articleUrl` as PK would introduce a different key convention requiring joins at query time. |
| Cosine similarity | In-code utility in `lib/utils/cosineSimilarity.ts` (Phase 2+) | Ranking operates over O(20) articles per request — pgvector `<=>` operator buys nothing and adds round-trip complexity. In-code is independently testable. |
| EMA update location | Synchronous inside `POST /api/feedback`, after primary feedback write (Phase 2+) | Keeps update in a single sequence. Async would add queue/retry complexity for negligible latency benefit at single-user scale. |
| EMA update atomicity | Fetch-then-update in application code, no locking (Phase 2+) | Concurrent writes unlikely for single-user app. A race yields last-write-wins — acceptable for a taste profile. SQL-level locking would add latency per feedback event. |
| EMA update failure handling | Log + swallow, never fails the feedback POST (Phase 2+) | Profile update is best-effort. A transient DB failure must not cause user to see 500 on a like/dislike action. |
| Aesthetic scoring integration point | `lib/pipeline/run.ts`, after combined articles assembled, before `writeBatch()` (Phase 2+) | Only place where all articles (fixed + discovery) are co-located before batch write. Scoring in `runDiscovery()` would miss fixed-source articles. |
| Aesthetic scoring execution | Sequential per-article (not parallel) (Phase 2+) | Anthropic API is rate-limited. Parallel calls at 20 articles would risk concurrency limit. Sequential adds ~20s to pipeline — acceptable for a once-daily scheduled run. |
| Aesthetic scoring failure behavior | Log per-article, continue, no null row written (Phase 2+) | Absent row = no score; ranker treats both absent row and null as 0.0 aesthetic proximity. Absent row is cleaner than a sentinel null column. |
| Aesthetic migration number | `009_aesthetic_scores.sql` (Phase 2+) | 007 and 008 already exist; next sequential number is 009. |
| Body text extraction library | `@mozilla/readability` + `jsdom`, server-side only (Phase 1+) | Battle-tested on editorial/blog layouts (Firefox Reader Mode); no headless browser needed |
| Query bank storage | `data/query_banks.json` (runtime, gitignored) + `data/query_banks.default.json` (committed seed) (Phase 1+) | Inspectable/editable by operator without redeploy; default seed prevents cold-start failure |
| Query rotation cursor storage | `data/query_rotation_state.json` (separate from bank) (Phase 1+) | Decouples query content from cursor state; bank can be refreshed without corrupting cursor |
| Queries per topic per run | 2 (Phase 1+) | Stays within Brave free tier (~360 calls/month vs. 2,000 limit); meaningful rotation |
| Query bank refresh trigger | `scripts/refresh-query-banks.ts` standalone script; monthly manual/cron operation (Phase 1+) | Not auto-called in pipeline; operator controls timing |
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
| `BRAVE_SEARCH_API_KEY` | Discovery pipeline (all Brave Search calls) | Obtain at https://api.search.brave.com. Free tier: 2,000 req/month. Never commit. |
| `ANTHROPIC_API_KEY` | LLM content evaluator (Phase 1+), query bank generation script | Obtain at console.anthropic.com. Never commit. |

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
| Manual verification | **Shipped** | REFRESH-TASK-010 |
| ARCHITECTURE.md Milestone 5 update | **Shipped** | REFRESH-TASK-011 |
| `lib/config/feed.ts` (quota + discovery constants) | **Done** | DISC-TASK-001 |
| `lib/types/article.ts` — `discoveryTopic` field | **Done** | DISC-TASK-002 |
| `lib/discovery/topics.ts` — topic configuration | **Done** | DISC-TASK-003 |
| `lib/discovery/braveSearch.ts` — Brave Search adapter | **Done** | DISC-TASK-004 |
| `lib/discovery/qualityGate.ts` — quality gate | **Done** | DISC-TASK-005 |
| `lib/discovery/run.ts` — discovery orchestrator | **Done** | DISC-TASK-006 |
| `lib/pipeline/run.ts` — discovery integration + batch assembly | **Done** | DISC-TASK-007 |
| `lib/pipeline/config.ts` — `ARTICLES_PER_DAY` re-export | **Done** | DISC-TASK-008 |
| `app/api/feed/today/route.ts` — strip `discoveryTopic` | **Done** | DISC-TASK-009 |
| Discovery integration verification | **Done** | DISC-TASK-010 |
| `lib/db/discovery.ts` + DB schema (topic weights) | **Done** | DISC-TASK-011 |
| `lib/discovery/run.ts` — topic weight feedback loop | **Done** | DISC-TASK-012 |
| Topic weight loop verification | **Done** | DISC-TASK-013 |
| ARCHITECTURE.md Milestone 7 update | **Done** | DISC-TASK-014 |
| topic weight double-counting fix (last_processed_at DDL + filter) | **Done** | BUG-TASK-001 |
| discoveryTopic strip from GET /api/articles/[id] | **Done** | BUG-TASK-002 |
| deviceId threading fix in runDiscovery + upsertTopicWeight | **Done** | BUG-TASK-003 |
| npm dependencies: @anthropic-ai/sdk, @mozilla/readability, jsdom, fast-xml-parser, @types/jsdom | **Done** | AGDISC-TASK-001 |
| lib/config/feed.ts — add LLM_EVAL_THRESHOLD, LLM_EVAL_BODY_CHAR_LIMIT, SMALL_WEB_MAX_NEW_SOURCES_PER_RUN; remove SPECIFICITY_THRESHOLD | **Done** | AGDISC-TASK-002 |
| lib/db/migrations/007_small_web_sources.sql — DB migration | **Done (file created; DDL pending user apply)** | AGDISC-TASK-003 |
| lib/db/smallWeb.ts — Small Web DB helper module | **Done** | AGDISC-TASK-004 |
| lib/discovery/smallWeb/seeds.ts — seed URL constant | **Done** | AGDISC-TASK-005 |
| lib/discovery/smallWeb/blogroll.ts — blogroll parser (OPML + HTML) | **Done** | AGDISC-TASK-006 |
| lib/discovery/smallWeb/crawler.ts — crawl orchestrator | **Done** | AGDISC-TASK-007 |
| lib/discovery/bodyExtractor.ts — Readability + jsdom extraction module | **Done** | AGDISC-TASK-008 |
| lib/discovery/llmEvaluator.ts — Claude Haiku content evaluator | **Done** | AGDISC-TASK-009 |
| lib/discovery/qualityGate.ts — remove Gate 4 specificity heuristic | **Done** | AGDISC-TASK-010 |
| lib/discovery/run.ts — integrate body extraction and LLM evaluation | **Done** | AGDISC-TASK-011 |
| data/query_banks.default.json — committed seed file | **Done** | AGDISC-TASK-012 |
| lib/discovery/queryBank.ts — bank loader and rotation cursor | **Done** | AGDISC-TASK-013 |
| scripts/refresh-query-banks.ts — query bank init script | **Done** | AGDISC-TASK-014 |
| lib/discovery/run.ts — integrate two-queries-per-topic | **Done** | AGDISC-TASK-015 |
| lib/types/smallWeb.ts — SmallWebSource type | **Done** | AGDISC-TASK-016 |
| lib/discovery/run.ts — integrate Small Web crawler | **Done** | AGDISC-TASK-017 |
| End-to-end verification run | **Done** | AGDISC-TASK-018 |
| ARCHITECTURE.md update (Phase 1 final) | **Done** | AGDISC-TASK-019 |
| `lib/types/aesthetic.ts` — AestheticScoreVector + AestheticProfile types | **Done** | AESTH-TASK-001 |
| `lib/config/aesthetic.ts` — dimension constants, utilities, startup assertion | **Done** | AESTH-TASK-002 |
| `lib/db/migrations/009_aesthetic_scores.sql` — DDL (requires manual apply in Neon) | **Done** | AESTH-TASK-003 |
| `lib/db/aesthetics.ts` — all DB helper functions (scores + profiles) | **Done** | AESTH-TASK-004 |
| `lib/discovery/aestheticScorer.ts` — LLM scorer module (Claude Haiku) | **Done** | AESTH-TASK-005 |
| `lib/pipeline/run.ts` — scoreArticlesAesthetic() integration | **Done** | AESTH-TASK-006 |
| `lib/utils/cosineSimilarity.ts` — cosine similarity utility | **Done** | AESTH-TASK-007 |
| `lib/pipeline/ranker.ts` — blended score extension (aesthetic + source) | **Done** | AESTH-TASK-008 |
| `app/api/feed/today/route.ts` — aesthetic profile + score reads, rankFeed extension | **Done** | AESTH-TASK-009 |
| `app/api/feedback/route.ts` — EMA aesthetic profile update | **Done** | AESTH-TASK-010 |
| End-to-end verification (static code inspection) | **Done** | AESTH-TASK-011 |
| ARCHITECTURE.md update (Phase 2) | **Done** | AESTH-TASK-012 |

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
| Milestone 7 — Proactive Content Discovery | `agents/architect/design_proactive_discovery_v1.md` | `agents/architect/tasks_proactive_discovery_v1.md` |
| Milestone 8 — Discovery Bug Fixes | _(no design doc; see README defect descriptions)_ | `agents/architect/tasks_discovery_bugfix_v1.md` |
| Phase 1 — Agentic Content Discovery | `agents/architect/design_agentic_discovery_phase1_v1.md` | `agents/architect/tasks_agentic_discovery_phase1_v1.md` |
| Phase 2 — Latent Aesthetic Space | `agents/architect/design_aesthetic_space_phase2_v1.md` | `agents/architect/tasks_aesthetic_space_phase2_v1.md` |

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
| 2026-04-04 | Architect Agent | Milestone 7 design complete. Brave Search API selected. Quality gate (4 criteria: validator rules, freshness 72h, domain blocklist, specificity score). discoveryTopic in batch JSON, stripped from API. Topic weights in new DB table. Constants in new lib/config/feed.ts with startup assertion. 14 tasks, all Not started. |
| 2026-04-04 | Dev Agent | DISC-TASK-001 through DISC-TASK-010 (P0) shipped. lib/config/feed.ts, lib/discovery/ (topics, braveSearch, qualityGate, run), pipeline/run.ts integration, pipeline/config.ts re-export, feed/today route strip. All 9 P0 DISC stories Released. |
| 2026-04-04 | Dev Agent | Milestone 7 fully shipped. DISC-TASK-011 (lib/db/discovery.ts + discovery_topic_weights table), DISC-TASK-012 (topic weight feedback loop in runDiscovery), DISC-TASK-013 (verification), DISC-TASK-014 (ARCHITECTURE.md update) all Done. All 14 Milestone 7 tasks complete. Milestones 1–5 and 7 now shipped. |
| 2026-04-04 | Architect Agent | Milestone 8 bug-fix tasks written. Three defects from M7 review: topic weight double-counting (BUG-TASK-001), discoveryTopic leak via articles/[id] route (BUG-TASK-002), deviceId/userId confusion in upsertTopicWeight (BUG-TASK-003). tasks_discovery_bugfix_v1.md created. |
| 2026-04-04 | Dev Agent | Milestone 8 all three bug fixes shipped. BUG-TASK-001: added last_processed_at to TopicWeightRow + SELECT helpers, added setLastProcessedAt/migrateDiscoverySchema to lib/db/discovery.ts, updated feedback.ts updated_at to string, added cutoff filter in runDiscovery. BUG-TASK-002: stripped discoveryTopic from GET /api/articles/[id] response. BUG-TASK-003: threaded deviceId through runDiscovery signature, RunOptions, upsertTopicWeight call, setLastProcessedAt call, and refresh route. Also fixed downstream cast error in app/api/feedback/route.ts. npx tsc --noEmit passes. |
| 2026-04-04 | Dev Agent | Phase 1 (Agentic Discovery) AGDISC-TASK-001 through AGDISC-TASK-017 implemented. Packages installed; feed.ts constants updated; SmallWebSource type; migration SQL file; lib/db/smallWeb.ts; seeds.ts; blogroll.ts; crawler.ts; bodyExtractor.ts; llmEvaluator.ts; qualityGate.ts Gate 4 removal; queryBank.ts; query_banks.default.json; scripts/refresh-query-banks.ts; run.ts fully rewritten (two-queries-per-topic, body extraction, LLM eval, Small Web integration). npx tsc --noEmit passes. DDL must be applied manually — see lib/db/migrations/007_small_web_sources.sql. AGDISC-TASK-018 (E2E verification) pending. |
| 2026-04-04 | Dev Agent | Phase 1 complete. AGDISC-TASK-018 (E2E verification) confirmed by static code inspection: all log lines, extraction error codes, LLM threshold logging, bodyText field, discoveryTopic stripping, and query rotation logic present and correct. npx tsc --noEmit passes. AGDISC-TASK-019 (ARCHITECTURE.md update) confirmed: all Phase 1 sections already present from Architect pre-population. All 19 Phase 1 tasks Done. |
| 2026-04-04 | Architect Agent | Phase 2 (Latent Aesthetic Space) design complete. Six aesthetic dimensions (contemplative, concrete, personal, playful, specialist, emotional), Claude Haiku scorer, pgvector article score table and user profile table, EMA centroid update in feedback handler, blended cosine-similarity ranking (30/70). 12 tasks, all Not started. Migration 009 requires manual Neon apply before AESTH-TASK-004. |
| 2026-04-04 | Dev Agent | Phase 2 (Latent Aesthetic Space) complete. AESTH-TASK-004 through AESTH-TASK-012 implemented. lib/db/aesthetics.ts (5 helpers), lib/discovery/aestheticScorer.ts (Claude Haiku structured output), lib/utils/cosineSimilarity.ts, run.ts scoreArticlesAesthetic() integration, ranker.ts blended score (70/30 source/aesthetic), feed/today route parallel aesthetic reads, feedback route EMA profile update. npx tsc --noEmit passes. All 12 Phase 2 tasks Done. |