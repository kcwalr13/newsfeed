# System Architecture

**Last Updated**: 2026-06-15
**Maintained by**: Architect Agent
**Status**: Active — Milestones 1–8, Phases 1–4, QA pass, post-Phase-4 operational fixes, and the
review-remediation campaigns Round 1 → Round 6 shipped: Round 1+2 (code/UX remediation), Round 3
(product/vision alignment), Round 4 (adversarial review), Round 5 (content mix + curator voice),
Round 6 (LLM provider abstraction → live on Gemini 2.5 Flash-Lite free tier, 2026-06-15). See the
**Post-review updates** sections near the end for systems added/changed during remediation;
`agents/review/REVIEW_TRACKER.md` has the finding-by-finding log.

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
| Framework | Next.js 16 (App Router) + React 19 | Active | Chosen at project start; provides routing, API routes, and SSR in one package |
| Language | TypeScript (strict) | Active | Type safety across pipeline, API, and UI; shared types prevent drift |
| Styling | Tailwind CSS | Active | Utility-first; consistent with project setup; no separate CSS files |
| Package manager | npm | Active | Project default |
| Platform | PWA (Progressive Web App) | Active | Installable on mobile without app stores; works on desktop too |
| Database | Neon serverless Postgres | Active | Feedback, auth, topic weights; scales to future use cases |
| Storage | Neon Postgres (batches, cooldown, run-lock, rate limits) | Active | Vercel's filesystem is read-only; batches moved to the `article_batches` table (migration 013) and the refresh cooldown + global run-lock + rate limiter to the `rate_limits` table (migration 019). The original JSON-file approach was local-dev only. |
| LLM | Provider-abstracted (`lib/llm/`): Anthropic SDK (default) or Gemini (`@google/genai`) | Phase 1+; abstraction Round 6 | Content evaluation, quality scoring, concept/theme/curator generation, query generation. Backend chosen by `LLM_PROVIDER`; a shared RPM limiter meters all calls. |
| Web crawling | Playwright (headless browser) | Phase 1+ | Small Web / IndieWeb crawling; hybrid API + browser agent strategy |
| Vector storage | pgvector on Neon | Phase 2+ | Embedding storage for latent aesthetic space; already available in Neon |
| Memory | Mem0 (open source) | Phase 3+ | Graph-enhanced long-term user memory |

---

## Repository Structure

```
tangent/
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
├── data/                     ← Runtime data
│   └── sources.json          ← Fixed-pipeline RSS source configuration (checked into git)
│       (23 sources across 11 categories; each entry carries a `category`:
│        science/philosophy/ideas/economics/psychology/culture/music/art/
│        design/film/literature — broadened 12→23 in Round 3, P3-B1/B2)
│   NOTE: Batch storage and pipeline logs moved to Neon DB (migration 013).
│         Refresh cooldown + global run-lock now Postgres-backed (rate_limits
│         table, migration 019) in lib/pipeline/cooldown.ts (was in-memory Map).
├── lib/                      ← Server-side business logic
│   ├── auth/                 ← Session middleware
│   │   └── session.ts        ← resolveSession(), buildSessionCookie(), clearSessionCookie()
│   ├── config/               ← Cross-module tuning constants
│   │   ├── feed.ts           ← Quota + discovery constants (ARTICLES_PER_DAY, DISCOVERY_*, etc.)
│   │   └── aesthetic.ts      ← Aesthetic constants, DIMENSION_KEYS, vectorToArray, arrayToVector (Phase 2+)
│   ├── db/                   ← Database query helpers
│   │   ├── aesthetics.ts     ← Aesthetic score + profile DB helpers (Phase 2+; extended Phase 3)
│   │   ├── auth.ts           ← Users, sessions, tokens query helpers
│   │   ├── blindSpots.ts     ← Blind spot cluster DB helpers (Phase 4+)
│   │   ├── client.ts         ← Neon DB connection singleton
│   │   ├── concepts.ts       ← Concept graph DB helpers (Phase 3+)
│   │   ├── discovery.ts      ← Topic weight DB helpers
│   │   └── feedback.ts       ← Feedback query helpers
│   ├── discovery/            ← Proactive content discovery subsystem
│   │   ├── aestheticScorer.ts ← scoreAesthetic(), AestheticScoringError (Phase 2+)
│   │   ├── bodyExtractor.ts  ← Article body text extraction (node-html-parser; CJS-compatible)
│   │   ├── braveSearch.ts    ← Brave Search API HTTP adapter
│   │   ├── conceptExtractor.ts ← extractConcepts() — LLM concept label extraction (Phase 3+)
│   │   ├── qualityGate.ts    ← evaluateCandidate() pure function module
│   │   ├── run.ts            ← runDiscovery() orchestrator
│   │   ├── serendipityScorer.ts ← Serendipity score computation (Phase 4+)
│   │   └── topics.ts         ← DISCOVERY_TOPICS array + DiscoveryTopic type
│   ├── email/                ← Email dispatch
│   │   └── send.ts           ← Nodemailer SMTP wrapper
│   ├── identity/             ← Client-side device identity
│   │   └── device.ts         ← initDeviceId(), readDeviceId(), getDeviceHeaders()
│   ├── feedback/             ← Client-side feedback store
│   │   └── store.ts          ← localStorage + server write logic
│   ├── pipeline/             ← Content pipeline modules
│   │   ├── adapters/         ← Per-source-type fetch adapters
│   │   ├── conceptBonus.ts   ← applyConceptBonus() — concept resonance ranking signal (Phase 3+)
│   │   ├── config.ts         ← Infrastructure constants and source loader (ARTICLES_PER_DAY re-exported from lib/config/feed.ts)
│   │   ├── cooldown.ts       ← Postgres-backed refresh cooldown + global pipeline run-lock (token-scoped; rate_limits table, migration 019)
│   │   ├── explorationAssembler.ts ← Serendipity exploration slot assembly (Phase 4+)
│   │   ├── blindSpotProber.ts ← Blind spot cluster identification and probe injection (Phase 4+)
│   │   ├── receptivity.ts    ← Receptivity score computation and budget modulation (Phase 4+)
│   │   ├── ranker.ts         ← Feed personalization ranker (pure function)
│   │   ├── run.ts            ← Pipeline orchestrator (calls runDiscovery, assembles combined batch)
│   │   ├── storage.ts        ← Batch DB read/write (article_batches table; Neon-backed)
│   │   └── validator.ts      ← Article validation and deduplication
│   ├── types/                ← Shared TypeScript types
│   │   ├── aesthetic.ts      ← AestheticScoreVector, AestheticProfile (Phase 2+)
│   │   ├── article.ts        ← Article (+ discoveryTopic internal field), FeedResponse, ArticleBatch, Source
│   │   ├── auth.ts           ← DbUser, DbSession, DbToken
│   │   └── feedback.ts       ← QueuedWrite, ServerFeedbackMap
│   └── utils/                ← Pure utility functions (no I/O)
│       ├── cosineSimilarity.ts ← cosineSimilarity(a, b): number (Phase 2+)
│       └── driftScore.ts     ← computeDriftScore() (Phase 3+)
├── public/                   ← Static assets
│   ├── icons/                ← PWA icons (192x192, 512x512)
│   ├── manifest.json         ← Web App Manifest
│   └── sw.js                 ← Minimal service worker
├── vercel.json               ← Vercel deployment config (cron trigger for daily pipeline)
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
- `discoveryTopic?: string | null` — internal; set on discovery-sourced articles;
  never sent to the client (stripped from API responses)
- Phase 4 internal fields (all stripped from API responses):
  - `llmScore?: number` — LLM composite quality score [1.0, 5.0]; set at pipeline time for discovery articles
  - `extractedConcepts?: string[]` — concepts extracted at pipeline time; stored in batch JSON
  - `serendipityScore?: number` — transient; computed in `rankFeed()`, never written to batch JSON
  - `explorationSlotType?: 'semantic_stretch' | 'blind_spot_probe' | 'wildcard' | null` — written to batch JSON; analytics only
  - `probeInfo?: { probeType: 'blind_spot'; clusterLabel: string }` — set only on probe articles; written to batch JSON

**`FeedResponse`** — envelope returned by `GET /api/feed/today`
- `batchDate: string` (YYYY-MM-DD), `articles: Article[]`, `generatedAt?: string`,
  `discoveryCount?: number`, `discoverySources?: string[]` (registrable domains of the day's
  discovery-sourced articles, P3-A4)

**`ArticleBatch`** — in-memory shape and DB storage shape for a daily article batch.
- `batchDate`, `generatedAt` (ISO-8601), `articles: Article[]`
- Persisted to `article_batches` Neon table (DDL: `lib/db/migrations/013_article_batches.sql`).
  Previously stored as `data/batches/YYYY-MM-DD.json` files; moved to DB for Vercel compatibility.

**`Source`** — entry in `data/sources.json`
- `slug`, `name`, `url`, `type: 'rss' | 'newsapi'`, `active: boolean`
- Optional: `feedUrl` (for RSS), `query` (for NewsAPI), `category?: SourceCategory`
- `SourceCategory` (`lib/types/article.ts`): `science | philosophy | ideas | economics | psychology | culture | music | art | design | film | literature`. Resolved onto articles at read time via `categoryForArticle()` (`lib/pipeline/sourceCategory.ts`); not persisted on `Article`. (Round 3, P3-B2)

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

**`AestheticProfile`** — TypeScript type in `lib/types/aesthetic.ts` (Phase 2+; extended Phase 3).
- Phase 2 fields: `user_id`, `device_id`, `centroid: AestheticScoreVector`, `feedback_count`, `updated_at`
- Phase 3 additions: `short_term_centroid: AestheticScoreVector | null`, `short_term_feedback_count: number`,
  `short_term_window_start: string | null`, `is_drifting: boolean`, `drift_detected_at: string | null`

**`user_aesthetic_profiles`** — Phase 3 column additions (migration 010):
- `short_term_centroid vector(6)` — nullable; 21-day rolling average centroid
- `short_term_feedback_count INTEGER NOT NULL DEFAULT 0` — qualifying events in current window
- `short_term_window_start TIMESTAMPTZ` — nullable; oldest qualifying event timestamp
- `is_drifting BOOLEAN NOT NULL DEFAULT FALSE` — true when cosine distance >= 0.25
- `drift_detected_at TIMESTAMPTZ` — nullable; when drift period began

**`blind_spot_clusters`** — DB table for Phase 4 blind spot cluster state (Phase 4+).
- `id SERIAL PK`, `user_id TEXT` (nullable), `device_id TEXT NOT NULL`,
  `cluster_label TEXT NOT NULL`, `status TEXT` CHECK ('active','suppressed','promoted'),
  `suppress_until TIMESTAMPTZ`, `promote_until TIMESTAMPTZ`,
  `probe_count INTEGER`, `like_count INTEGER`, `dislike_count INTEGER`, `ignore_count INTEGER`,
  `last_probed_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`
- UNIQUE(user_id, device_id, cluster_label); index on (device_id, status)
- DDL: `lib/db/migrations/011_serendipity.sql`
- Helpers: `lib/db/blindSpots.ts`

**`user_feedback`** — Phase 4 column addition (migration 011):
- `dwell_seconds NUMERIC(7,2)` — nullable; persisted when `dwellSeconds` is in the feedback request body

**`user_aesthetic_profiles`** — Phase 4 column additions (migration 011):
- `receptivity_score NUMERIC(4,3)` — nullable; updated in `POST /api/feedback` after each event
- `exploration_budget INTEGER NOT NULL DEFAULT 4` — current exploration slot count (2–6)

**`user_concepts`** — DB table for Phase 3 concept graph nodes.
- `id SERIAL PK`, `user_id TEXT` (nullable), `device_id TEXT NOT NULL`, `label TEXT NOT NULL`,
  `extraction_count INTEGER NOT NULL DEFAULT 1`, `engagement_weight NUMERIC(5,2) NOT NULL DEFAULT 1.0`,
  `last_seen_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`
- UNIQUE(user_id, device_id, label); index on (device_id, engagement_weight DESC)
- DDL: `lib/db/migrations/010_deep_user_model.sql`
- Helpers: `lib/db/concepts.ts`

**`user_concept_edges`** — DB table for Phase 3 concept graph edges (undirected).
- `id SERIAL PK`, `user_id TEXT` (nullable), `device_id TEXT NOT NULL`,
  `concept_a TEXT NOT NULL`, `concept_b TEXT NOT NULL` (alphabetically ordered; enforced in app code),
  `co_occurrence_count INTEGER NOT NULL DEFAULT 1`, `last_seen_at TIMESTAMPTZ`
- UNIQUE(user_id, device_id, concept_a, concept_b); index on (device_id, concept_a, concept_b)
- DDL: `lib/db/migrations/010_deep_user_model.sql`
- Helpers: `lib/db/concepts.ts`

**`UserConcept`** — TypeScript type in `lib/types/concepts.ts` (Phase 3+).
**`UserConceptEdge`** — TypeScript type in `lib/types/concepts.ts` (Phase 3+).

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
| POST | `/api/feedback` | Upserts a feedback record (`value: 'like' \| 'dislike' \| 'save'`); accepts optional `dwellSeconds: number` (Phase 3+) | Device cookie / `X-Device-ID` header |
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
| GET | `/api/metrics` | Product metrics (discovery share, sources/week, category mix, exploration acceptance, taste maturity) for `/dashboard` (Round 3, P3-D2) | Solo gate (device cookie) |
| GET | `/api/onboarding/calibration` | Returns ~16 contrasting calibration pieces for first-run taste calibration (Round 3, P3-E1) | None / device |
| POST | `/api/onboarding/tone` | Applies an optional tone preference to the aesthetic centroid (Round 3, P3-E2) | Device cookie / `X-Device-ID` header |

---

## Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Batch storage | Neon `article_batches` table (migration 013) | Vercel's serverless filesystem is read-only; DB-backed storage is required for deployment. Previous filesystem approach (JSON files) worked only in local dev. |
| Primary content source | RSS feeds (**23 sources across 11 categories**) | Free, broad coverage, full text. Round 3 broadened the palette 12→23 (added music ×4, visual art ×2, design, film, literature, esoteric-culture ×2) and gave every source a `category` (P3-B1/B2). Swapped from mainstream outlets (BBC, Ars, The Verge) to match the discovery-companion vision. |
| Adaptive aesthetic blend (Round 3) | `aestheticWeightForFeedback()` ramps the aesthetic weight 0.30 → 0.50 over 50 feedback events; source weight is the complement | The fixed 0.70/0.30 split under-trusted the learned taste once mature. Ramping up (never down) with feedback keeps early issues stable while letting a trained model lead (P3-C1). |
| Display diversity (Round 3) | `promoteUnfamiliarSources` (≥2 never-shown) + `ensureCategorySpread` (≥4 categories) reorder before the top-7 slice (`lib/pipeline/displayDiversity.ts`) | Guarantees the shown issue is visibly broad even when ranking concentrates on a few sources (P3-C2/C3). |
| Secondary content source | Small Web crawler (Phase 1+) | Replaced NewsAPI. IndieWeb sources surfaced via blogroll expansion. |
| Body text strategy | Best-effort from RSS `content` field | Avoids scraping complexity in v1; graceful fallback UX |
| Pipeline trigger | HTTP endpoint guarded by `CRON_SECRET` | Works with any external cron service; no vendor lock-in |
| PWA service worker | Hand-written minimal SW (not `next-pwa`) | Avoids `next-pwa` compatibility issues with App Router |
| Article ID | `<source-slug>-<sha256-of-url>[0..8]` | Stable, deterministic, no collision risk for n=20 |
| Client routing | Next.js App Router `Link` | Already the framework |
| Dedup strategy | By `articleUrl` | Same article from two sources yields one record |
| Feed personalization | API-time ranking in `rankFeed()` | Avoids per-identity batch file proliferation; ranking is O(20 articles) in memory; single shared batch on disk unchanged; graceful DB failure degrades to unranked feed |
| Manual refresh cooldown storage | Postgres `rate_limits` table (migration 019) + a global token-scoped pipeline run-lock, both in `cooldown.ts` | The original in-memory Map reset on every cold start, so the cooldown never applied and concurrent refreshes could each run the full pipeline (DAT-H5). The DB-backed cooldown + run-lock fail open on any DB error, never locking the owner out. The run-lock stores a random token so only the acquiring run can release it (R2-03). |
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
| Body text extraction library | `node-html-parser`, server-side only (Phase 1+) | Originally used `@mozilla/readability` + `jsdom` but jsdom pulls in ESM-only code (`@exodus/bytes`) that crashes Vercel's CJS serverless runtime with ERR_REQUIRE_ESM. Replaced with `node-html-parser` (CJS-compatible) with a custom content extractor targeting `article`/`main`/`role=main` containers. jsdom and @mozilla/readability removed from dependencies. |
| Solo mode (auth bypass) | `AuthContext` always resolves to hardcoded `solo` user; `/api/auth/me` returns it without DB lookup | Single-user deployment doesn't need an auth gate. Auth plumbing preserved for future re-enablement. `RefreshButton` is unconditionally visible. |
| Daily pipeline trigger | Vercel cron via `vercel.json` calling `POST /api/pipeline/run` at 08:00 UTC (`0 8 * * *`) | Zero-ops scheduling; no external cron service needed. `CRON_SECRET` bearer token guards the endpoint (compared in constant time). |
| Query bank storage | `data/query_banks.json` (runtime, gitignored) + `data/query_banks.default.json` (committed seed) (Phase 1+) | Inspectable/editable by operator without redeploy; default seed prevents cold-start failure |
| Query rotation cursor storage | `data/query_rotation_state.json` (separate from bank) (Phase 1+) | Decouples query content from cursor state; bank can be refreshed without corrupting cursor |
| Queries per topic per run | 2 (Phase 1+) | Stays within Brave free tier (~360 calls/month vs. 2,000 limit); meaningful rotation |
| Query bank refresh trigger | `scripts/refresh-query-banks.ts` standalone script; monthly manual/cron operation (Phase 1+) | Not auto-called in pipeline; operator controls timing |
| Session tokens | Random 32-byte hex in DB (`sessions` table) | Enables server-side invalidation on logout; required for 30-day sliding window |
| Session transport | `HttpOnly` cookie `dd_session` | Cannot be read by JS; separate from `dd_device_id` which must be JS-readable |
| Email sending | Nodemailer + SMTP | Provider-agnostic; no vendor SDK lock-in; volume too low to require an API |
| Phase 3 DDL migration number | `010_deep_user_model.sql` (Phase 3+) | Bundles all Phase 3 DDL (short-term centroid columns, drift columns, user_concepts, user_concept_edges) into one file and one apply operation |
| Phase 3 drift columns migration | Bundled with short-term centroid columns in migration 010 (Phase 3+) | Single apply; all Phase 3 DB changes are logically related |
| Phase 3 concept_a/concept_b ordering | Application-layer sort before upsert (Phase 3+) | Simpler than DB CHECK or trigger; single-writer single-user; testable in TypeScript |
| Phase 3 concept pruning score | Computed in application code, not SQL (Phase 3+) | Formula uses Math.log and conditional branches; easier to unit test; node count ≤300 makes full fetch trivial |
| Phase 3 dwell time storage | Transient only — not persisted (Phase 3+) | No current query needs raw dwell; avoids schema churn; `engagementWeight` is computed and discarded |
| Phase 3 dwell beacon endpoint | `POST /api/feedback` with `value: null` (Phase 3+) | Avoids a new route; all engagement signals flow through one handler |
| Phase 3 save/bookmark API route | `POST /api/feedback` with `value: 'save'` — NOT a new `/api/articles/[id]/save` route (Phase 3+) | `'save'` is a feedback value; reuses auth, device resolution, feedback DB, and concept pipeline already in the handler |
| Phase 3 blend weight constants | Added to `lib/config/aesthetic.ts` (Phase 3+) | Co-located with Phase 2 aesthetic constants; avoids a new config file for five constants |
| Phase 3 short-term centroid mechanism | Full recompute from feedback table on every event (Phase 3+) | 21-day bounded window, single user, trivially small set; incremental adds complexity for no benefit |
| Phase 3 top-20 concept fetch | One query per `rankFeed()` call, not cached (Phase 3+) | O(20) query is negligible; caching adds state management complexity at single-user scale |
| Phase 3 concept label normalization | Lowercase + punctuation-strip substring match (Phase 3+) | Handles most mismatches without fragile stemming; concept labels are phrases, not single words |
| Phase 3 drift state update SQL | Single UPDATE with CASE expressions, no fetch-then-write (Phase 3+) | Avoids round trip; CASE preserves drift_detected_at onset when already drifting |
| Phase 4 quality score source | `LLMScores.composite` from `llmEvaluator.ts` (range 1.0–5.0), not `qualityGate.ts` (boolean) (Phase 4+) | `qualityGate.ts` is boolean-only; composite is the actual numeric scorer confirmed by code inspection |
| Phase 4 quality weight formula | `0.5 + (llm_score - 1.0) * 0.125`; fixed-source articles default to 0.75 (Phase 4+) | Linear map [1.0,5.0]→[0.5,1.0]; 0.75 neutral midpoint for articles without LLM scores |
| Phase 4 serendipity integration point | Pre-pass inside `rankFeed()` after Phase 3 blend computation (Phase 4+) | Co-locates all ranking logic; preserves Phase 3 exploitation formula unchanged |
| Phase 4 feed interleaving | Deterministic evenly-spaced positions: `Math.round(2 + i * (20 / budget))` (Phase 4+) | Reproducible; avoids clustering; no random variation between requests |
| Phase 4 concept extraction timing | Pipeline time, stored in batch JSON as `extractedConcepts` (Phase 4+) | Avoids per-request LLM calls; one call per candidate per run |
| Phase 4 `explorationSlotType` storage | Transient on Article during `rankFeed()`; written to batch JSON for analytics; DB column advisory (Phase 4+) | Runtime does not depend on DB column; file-backed architecture is sufficient |
| Phase 4 blind spot cluster identity | LLM-provided cluster label string (Phase 4+) | Human-readable; stable enough for single-user; no hash needed |
| Phase 4 like during suppression | Clears suppression immediately and sets cluster to promoted (Phase 4+) | Like is a stronger signal than timer; should not be delayed |
| Phase 4 dwell time persistence | `dwell_seconds` column added to `user_feedback` in migration 011 (Phase 4+) | Phase 3 computed engagementWeight transiently but never persisted raw dwell for future receptivity use |
| Phase 4 diversity score cluster proxy | Distinct concept labels per liked article (not graph traversal) (Phase 4+) | Phase 3 does not store explicit cluster assignments; label-level proxy is sufficient at single-user scale |
| Phase 4 receptivity storage | `receptivity_score` + `exploration_budget` on `user_aesthetic_profiles` (Phase 4+) | Updated in feedback handler for observability; recomputed fresh on each feed request for correctness |
| Phase 4 constants location | New `lib/config/serendipity.ts` (Phase 4+) | 12+ constants + lookup table; too substantial to add to `lib/config/feed.ts` |

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
| `EMAIL_FROM` | Email sending | From address: `"Tangent <noreply@yourdomain.com>"` |
| `NEXTAUTH_URL` | Email link generation | Base URL: `http://localhost:3000` (dev), `https://yourdomain.com` (prod). Validated to an https origin before building email links (SEC-M1). |
| `ALLOWED_BASE_URLS` | Email link generation (optional) | Comma-separated allowlist of origins permitted in email links; when set, `NEXTAUTH_URL`'s origin must be a member or email sending fails closed (SEC-M1). |
| `BRAVE_SEARCH_API_KEY` | Discovery pipeline (all Brave Search calls) | Obtain at https://api.search.brave.com. Free tier: 2,000 req/month. Never commit. |
| `ANTHROPIC_API_KEY` | LLM calls when `LLM_PROVIDER=anthropic` (committed default; **production currently runs `gemini`**): evaluator, aesthetic scorer, concept extractor, theme + curator notes, query-bank script | Obtain at console.anthropic.com. Never commit. |
| `LLM_PROVIDER` | Provider selection (Round 6) | `anthropic` (committed default) or `gemini` (**active in production since 2026-06-15**). Selects the active backend in `lib/llm/`. |
| `GEMINI_API_KEY` | LLM calls when `LLM_PROVIDER=gemini` (**active in production**) | Google AI Studio free-tier key (**Gemini 2.5 Flash-Lite**; the earlier `gemini-2.0-flash` pick was deprecated/shut down 2026-06-01). Never commit. |
| `OWNER_EMAIL` | Account menu (single-user) | Owner email returned by `/api/auth/me`; server-only, never hardcoded in source or shipped in the client bundle (SEC-C1). |

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
| `lib/discovery/smallWeb/seeds.ts` — 43 starter seed URLs across five categories (Discovery Directories, Master Curators, Digital Gardens, Literary, Science/Tech); 7 unresolved sources remain commented out | **Done** | Seeds expansion 2026-04-16 |
| `lib/db/migrations/008_seed_starter_sources.sql` — back-fill migration for the 43 seed URLs; safe to re-run (ON CONFLICT DO NOTHING); required because seedSourcesIfEmpty() only fires on an empty table | **Done (applied in Neon)** | Seeds expansion 2026-04-16 |
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
| `lib/db/migrations/010_deep_user_model.sql` — Phase 3 DDL (applied in Neon) | **Done** | DEPTH-TASK-001 |
| `lib/config/aesthetic.ts` — Phase 3 blend weight + engagement weight constants | **Done** | DEPTH-TASK-002 |
| `lib/types/aesthetic.ts` / `article.ts` / `concepts.ts` — Phase 3 type extensions | **Done** | DEPTH-TASK-003 |
| `lib/db/aesthetics.ts` — recomputeShortTermCentroid, updateDriftState, extended getAestheticProfile | **Done** | DEPTH-TASK-004 |
| `lib/utils/driftScore.ts` — computeDriftScore() pure function | **Done** | DEPTH-TASK-005 |
| `lib/pipeline/ranker.ts` — blendCentroids(), concept bonus hook, blended centroid integration | **Done** | DEPTH-TASK-006 |
| `app/api/feedback/route.ts` — dwellSeconds, save, short-term recompute, drift, concept pipeline | **Done** | DEPTH-TASK-007 |
| `lib/db/concepts.ts` — all concept graph DB helpers | **Done** | DEPTH-TASK-008 |
| `lib/pipeline/conceptBonus.ts` — applyConceptBonus() pure function | **Done** | DEPTH-TASK-009 |
| `lib/discovery/conceptExtractor.ts` — extractConcepts() LLM module (Claude Haiku) | **Done** | DEPTH-TASK-010 |
| `app/api/feed/today/route.ts` — fetch top concept nodes, pass to rankFeed | **Done** | DEPTH-TASK-011 |
| `app/articles/[id]/` — dwell timer + save/bookmark button UI (ArticleInteractions component) | **Done** | DEPTH-TASK-012 |
| End-to-end verification (Phase 3) | **Done** | DEPTH-TASK-013 |
| ARCHITECTURE.md update (Phase 3) | **Done** | DEPTH-TASK-014 |
| `lib/db/migrations/011_serendipity.sql` — Phase 4 DDL (applied in Neon) | **Done** | SEREN-TASK-001 |
| `lib/config/serendipity.ts` — all Phase 4 constants + slot allocation table | **Done** | SEREN-TASK-002 |
| `lib/types/article.ts` — 5 new internal fields; `lib/pipeline/serendipityScorer.ts` — 4 pure functions; `lib/db/concepts.ts` — 2 new helpers | **Done** | SEREN-TASK-003 |
| `lib/pipeline/run.ts` — pipeline-time concept extraction + llmScore persistence | **Done** | SEREN-TASK-004 |
| `lib/db/blindSpots.ts` — BlindSpotCluster type + 6 DB helpers | **Done** | SEREN-TASK-006 |
| `lib/pipeline/blindSpotProber.ts` — cluster identification, probe selection, ignore detection | **Done** | SEREN-TASK-007 |
| `app/api/feedback/route.ts` — probe response routing + dwell_seconds persistence | **Done** | SEREN-TASK-008 |
| `lib/pipeline/explorationAssembler.ts` — three-pool construction + slot assembly + deduplication | **Done** | SEREN-TASK-009 |
| `lib/pipeline/ranker.ts` — Phase 4 serendipity pre-pass + two-pool feed assembly | **Done** | SEREN-TASK-010 |
| `app/api/feed/today/route.ts` — concept graph reads + exploration budget + internal field stripping | **Done** | SEREN-TASK-011 |
| `lib/pipeline/receptivity.ts` — diversity, probe acceptance, dwell ratio, receptivity score, budget mapping | **Done** | SEREN-TASK-012 |
| `lib/db/aesthetics.ts` + feedback route — receptivity persistence; feed route — budget from stored profile | **Done** | SEREN-TASK-013 |
| End-to-end verification (Phase 4) | **Done** | SEREN-TASK-014 |
| ARCHITECTURE.md + roadmap update (Phase 4) | **Done** | SEREN-TASK-015 |
| QA-001: migration 011 `user_feedback` typo → HTTP 500 on all feedback — fixed in SQL; migration 012 corrective added | **Done** | QA pass 2026-04-19 |
| QA-002: raw HTML tags in RSS body text — `htmlToPlainText()` added to `lib/pipeline/adapters/rssAdapter.ts` | **Done** | QA pass 2026-04-19 |
| QA-003: numeric HTML entities not decoded in titles/descriptions — `decodeEntities()` added to `lib/pipeline/adapters/rssAdapter.ts` | **Done** | QA pass 2026-04-19 |
| QA-004: `explorationSlotType` stripped from feed API response (no badges) — field now passes through; `ArticleCard` renders Stretch/Blind spot/Wildcard violet badges | **Done** | QA pass 2026-04-19 |
| App rebrand to **Tangent** — `manifest.json`, layout, page titles updated | **Done** | 2026-04-20 |
| `vercel.json` — Vercel cron config; daily pipeline at 08:00 UTC (`0 8 * * *`) via `POST /api/pipeline/run` | **Done** | 2026-04-20 |
| Solo mode auth bypass — `AuthContext` hardcoded to solo user; `/api/auth/me` no DB lookup; `RefreshButton` always visible | **Done** | 2026-04-20 |
| `lib/pipeline/storage.ts` — rewritten to use `article_batches` Neon table; `writeBatch`/`readBatch`/`readLatestBatch` now async DB calls; `appendLog` → `console.log` | **Done** | 2026-04-20 |
| `lib/db/migrations/013_article_batches.sql` — `article_batches` table DDL (applied in Neon) | **Done** | 2026-04-20 |
| `lib/pipeline/cooldown.ts` — replaced filesystem JSON with in-memory `Map`; Vercel-compatible | **Done** | 2026-04-20 |
| `lib/discovery/bodyExtractor.ts` — replaced `@mozilla/readability` + `jsdom` with `node-html-parser`; removed jsdom and @types/jsdom from package.json | **Done** | 2026-04-20 |
| `data/sources.json` — replaced mainstream RSS sources with 8 esoteric discovery sources (Quanta, Aeon, Nautilus, Astral Codex Ten, Ribbonfarm, LessWrong, Marginal Revolution, The Marginalian) | **Done** | 2026-04-20 |

---

## Post-review updates (Round 3 — Product / Vision Alignment, 2026-06-14)

Source: `agents/architect/design_product_round3_vision_alignment.md`; backlog in
`agents/review/REVIEW_TRACKER.md` → ROUND 3. **No migration** (D4 metrics-snapshot table deferred);
**no new required env var** (optional `MAX_ARTICLES_PER_CATEGORY` knob added, default 4).

**Supply & palette**
- Fixed palette **12 → 23** sources, each with a `category` (`SourceCategory`); `categoryForArticle()`
  resolver in `lib/pipeline/sourceCategory.ts` (P3-B1/B2). `MAX_ARTICLES_PER_SOURCE` 5 → 4; new soft
  `MAX_ARTICLES_PER_CATEGORY` (4); round-robin diversify before trim (P3-B3).
- Discovery **hard-floored** to fill 6 slots down to `LLM_EVAL_FLOOR`, with a structured
  `[discovery] YIELD …` log (P3-A1). Candidate supply widened: full 12-topic bank
  (`DISCOVERY_TOPICS_PER_RUN=12`, `DISCOVERY_QUERIES_PER_TOPIC=1`, `DISCOVERY_CANDIDATES_PER_TOPIC=20`,
  `DISCOVERY_MAX_EVAL_CANDIDATES=40`) inside the DAT-H2 wall-clock budget (P3-A2).
- **Novelty filter** (`lib/discovery/novelty.ts` — `loadSeenSourceDomains` + `registrableDomain`,
  `NOVELTY_LOOKBACK_ISSUES=14`) drops fixed/recently-seen domains so discovery surfaces unfamiliar
  sources (P3-A3). `computeDiscoveryYield()` (`lib/pipeline/discoveryMeta.ts`) exposes
  `discoveryCount`/`discoverySources` on `GET /api/feed/today` (P3-A4).

**Ranking & display**
- Adaptive source/aesthetic blend (`aestheticWeightForFeedback`, `lib/config/aesthetic.ts`: 0.30 →
  `AESTHETIC_WEIGHT_MAX` 0.50 over `AESTHETIC_WEIGHT_SATURATION_COUNT` 50 events) replaces the fixed
  0.70/0.30 (P3-C1).
- Display guarantees (`lib/pipeline/displayDiversity.ts`, applied before the top-`ISSUE_DISPLAY_SIZE`=7
  slice): ≥`MIN_UNFAMILIAR_IN_ISSUE` (2) never-shown sources, ≥`MIN_CATEGORIES_IN_ISSUE` (4) categories
  (P3-C2/C3).

**Instrumentation & onboarding**
- `lib/db/metrics.ts` `computeMetrics()` → `GET /api/metrics` (solo gate) → `/dashboard` page
  (linked from `Colophon.tsx`); on-the-fly, no snapshot table (P3-D1/D2/D3; D4 deferred).
- First-run calibration: `app/api/onboarding/calibration` + `/tone`, `CalibrationModal.tsx`, seeded
  through the existing feedback path to cross `SHORT_TERM_MIN_EVENTS=3` (P3-E1/E2/E3).

**Known gaps (logged for Round 4):** `/api/issue/meta` builds the colophon credits + theme from raw
batch order, so they can describe a different 7 than the C2/C3-reordered displayed 7; the calibration
seed-set fallback writes synthetic article IDs that don't seed the aesthetic EMA. See REVIEW_TRACKER.md
ROUND 4.

---

## Post-review updates (Round 1 + Round 2 remediation, 2026-06-12 → 2026-06-13)

The "What Has Been Built" table above is a point-in-time milestone log; the review
remediation campaign (see `agents/review/REVIEW_TRACKER.md` for the finding-by-finding
record) added or changed the following systems. Where this section conflicts with
older rows, this section wins.

**New / changed infrastructure**
- **Postgres cooldown + global run-lock** (`lib/pipeline/cooldown.ts`, migration 019 `rate_limits`): replaced the in-memory `Map` (which reset on every cold start, so the cooldown never applied and concurrent runs could clobber each other — DAT-H5). The run-lock is token-scoped — only the acquiring run can release it — with a TTL above `maxDuration` (R2-03).
- **Rate limiter** (`lib/rateLimit.ts`, migration 019): Postgres fixed-window limiter on the auth, feedback, and refresh routes; fails open on DB error (SEC-H2). Client IP is read from `x-vercel-forwarded-for` / right-most `x-forwarded-for` to resist spoofing (R2-08).
- **Migration runner** (`scripts/migrate.mjs`, `npm run db:migrate` / `:migrate:status`): applies `lib/db/migrations/NNN_*.sql` in order, each in a transaction, recording them in `schema_migrations`. Migrations 001–006 were backfilled (DAT-H1).
- **`maxDuration = 300`** on both pipeline routes; per-article LLM loops and the discovery body+LLM loop run at bounded concurrency via `lib/utils/concurrency.ts` (DAT-H2, R2-18), under a wall-clock budget.

**New modules**
- `lib/config/llm.ts` — central `LLM_MODEL` id (was duplicated across modules; PIPE-L9); extended in Round 6 with `LLM_PROVIDER` + a per-provider `PROVIDER_CONFIG` table (model/rpm/concurrency/dailyCap).
- `lib/utils/bodyClean.ts` — shared body-text chrome stripper used by the RSS adapter + body extractor (PIPE-Q1, R2-17).
- `lib/utils/promptSafety.ts` — untrusted-content fencing for all LLM call sites (PIPE-M4).
- `lib/utils/concurrency.ts` — `forEachWithConcurrency` shared by the pipeline and discovery (R2-18).
- `app/hooks/useModalA11y.ts` — focus trap / Escape / restore / ref-counted body-scroll-lock for all overlays (FE-M4, R2-14, R2-24).
- `app/components/HeroImage.tsx` — client hero image with broken-image fallback (R2-26).
- `app/not-found.tsx`, `app/error.tsx` — styled editorial error/404 (DAT-H3, FE-M6).

**Behavioural changes**
- Blind-spot prober is now **wired into** `runPipeline` (was dead code): `probeInfo` rides in the batch JSON → ranker `◐` slot + feedback promote/suppress (PIPE-H3).
- Centered-cosine aesthetic proximity + drift (PIPE-H2); drift state now persists (the null `driftScore` SQL param is cast `::float8` — R2-01).
- Feedback resolves the liked/saved article across **all** batches so archived likes still learn concepts (R2-02).
- Owner email moved out of the client bundle to `OWNER_EMAIL` (SEC-C1); device id validated as a UUID and treated as a namespacing key, not an auth boundary (SEC-H1).
- Tailwind v4 CSS-variable utility syntax fixed app-wide (focus rings now render — FE-H2); card navigation uses `<Link>` (FE-M7).

**Migrations 014–019** (all applied to Neon 2026-06-12)
- `014_issue_metadata.sql` — issue cover/theme metadata.
- `015_query_rotation_state.sql` — discovery query rotation cursor (moved off the read-only filesystem; DAT-C1).
- `016_nulls_not_distinct_unique.sql` — de-dup + `UNIQUE NULLS NOT DISTINCT` on the five identity tables so anonymous upserts converge (DAT-C2).
- `017_article_batches_gin.sql` — GIN index for cross-batch article lookup (DAT-H3).
- `018_feedback_value_save.sql` — `feedback_value_check` includes `'save'` (DAT-H4).
- `019_rate_limits.sql` — backs the rate limiter, cooldown, and run-lock.

**Removed v1 components** (FE-L1 deleted 8 dead components): `FeedbackButtons`, `FeedSkeleton`, `ErrorState`, `BatchLabel`, `ViewSourceLink`, `LastUpdatedLabel`, `RefreshButton`, `AccountIcon` no longer exist — their "Shipped" rows above are historical. Their roles are now handled inline or by the components listed above.

---

## Round 6 — LLM provider abstraction + go free-tier

Plan: `agents/architect/design_product_round6_llm_provider_abstraction.md`. All LLM work now flows through a small provider interface so the backend is config-selected (`LLM_PROVIDER`), with Gemini free-tier as the cost-zero default target.

**The abstraction (`lib/llm/`)**
- `types.ts` — `LlmProvider` interface (`generateStructured<T>` for tool/JSON-schema sites, `generateText` for text sites), a minimal `JsonSchema`, and a typed `LlmError {kind:'api'|'parse'}`.
- `index.ts` — `getLlm()` factory (selects + memoizes the active adapter, then wraps it with the rate limiter) and `isLlmConfigured()` (provider-aware key check, used by the graceful-skip sites: curator notes, issue theme, the query-bank script).
- `anthropic.ts` — `@anthropic-ai/sdk`; structured = single forced `tool_use`, text = first text block. Default provider.
- `gemini.ts` — `@google/genai` (**Gemini 2.5 Flash-Lite** — the design's `gemini-2.0-flash` was shut down 2026-06-01); structured = `responseMimeType:'application/json'` + a `responseSchema` converted from `JsonSchema` (Type enum, string `minItems`/`maxItems`), text = plain `generateContent`; `system → systemInstruction`.
- `limiter.ts` — a shared fixed-interval (leaky-bucket) scheduler keyed on the active provider's RPM; guarantees ≤ rpm calls in every rolling 60s window. **No-op for Anthropic** (Infinity RPM). Per serverless instance (one cron run = one instance).

**The 7 refactored call sites** keep their prompts, schemas, `max_tokens`, and post-parse validation byte-identical; the prompt-injection invariant (`UNTRUSTED_CONTENT_NOTICE` in `system` + `wrapUntrusted()` on user content) holds for the 6 in-app sites (the offline query-bank script is exempt — trusted labels). Gemini honors schema constraints weakly, so the client-side validation at each site is load-bearing.

**Budget-fit (R6-5)** — under Gemini's ~15 RPM (a self-imposed safe ceiling in `PROVIDER_CONFIG`; free-tier RPM/RPD are account-specific and no longer published per-model) the limiter spaces calls ~4s apart, so `lib/config/feed.ts` lowers `DISCOVERY_MAX_EVAL_CANDIDATES` (40→15) and per-loop concurrency (4→2) for `gemini`, and `runPipeline`'s per-article scoring/concept phase gained a wall-clock **deadline** (`LlmBudget.deadlineMs = runStartMs + PIPELINE_WALL_CLOCK_BUDGET_MS`, enforced in `tryConsumeLlm`). The batch is written *after* scoring, so the deadline guarantees it is still written before `maxDuration` even when the slow rate forces some articles to stay unscored (they rank by source score — the existing DAT-H2/PIPE-H1 degraded fallback).

**Caveats (free tier)** — Google may use free-tier prompts for product improvement (public article text + a taste digest are sent); aesthetic scores are now a *mixed* Haiku/Gemini space (accept the drift or one-time re-score); a daily request cap means avoiding gratuitous `forceOverwrite` refreshes.

**Ops** — the committed code default is `anthropic`; production **went live on Gemini** via the single Vercel env change `LLM_PROVIDER=gemini` (with `GEMINI_API_KEY` set) on 2026-06-15. This **resolved R5-C3** (curator notes weren't generating because the Anthropic account ran out of credits) — verified live: `/api/feed/today` returns personalized `curatorNote` for all displayed pieces at $0 on the Gemini free tier. The model is `gemini-2.5-flash-lite` (the design's `gemini-2.0-flash` was deprecated/shut down 2026-06-01).

---

## Design Documents

| Milestone | Design Doc | Task List |
|-----------|-----------|-----------|
| Milestone 1 — Core Feed | `agents/architect/design_article_feed_v1.md` | `agents/architect/tasks_article_feed_v1.md` |
| Milestone 2 — Feedback System | `agents/architect/design_feedback_capture_v1.md` | `agents/architect/tasks_feedback_capture_v1.md` |
| Milestone 2.5 — Feedback Durability | `agents/architect/design_server_feedback_v1.md` | `agents/architect/tasks_server_feedback_v1.md` |
| Milestone 3 — Identity Foundation | `agents/architect/design_user_auth_v1.md` | `agents/architect/tasks_user_auth_v1.md` |
| Milestone 4 — Feed Personalization | `agents/architect/design_feed_personalization_v1.md` | `agents/architect/tasks_feed_personalization_v1.md` |
| Milestone 5 — Feed Refresh and Source Diversity | `agents/architect/design_feed_refresh_v1.md` | `agents/architect/tasks_feed_refresh_v1.md` |
| Milestone 7 — Proactive Content Discovery | `agents/architect/design_proactive_discovery_v1.md` | `agents/architect/tasks_proactive_discovery_v1.md` |
| Milestone 8 — Discovery Bug Fixes | _(no design doc; see README defect descriptions)_ | `agents/architect/tasks_discovery_bugfix_v1.md` |
| Phase 1 — Agentic Content Discovery | `agents/architect/design_agentic_discovery_phase1_v1.md` | `agents/architect/tasks_agentic_discovery_phase1_v1.md` |
| Phase 2 — Latent Aesthetic Space | `agents/architect/design_aesthetic_space_phase2_v1.md` | `agents/architect/tasks_aesthetic_space_phase2_v1.md` |
| Phase 3 — Deep User Model | `agents/architect/design_deep_user_model_phase3_v1.md` | `agents/architect/tasks_deep_user_model_phase3_v1.md` |
| Phase 4 — Engineered Serendipity | `agents/architect/design_engineered_serendipity_phase4_v1.md` | `agents/architect/tasks_engineered_serendipity_phase4_v1.md` |

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
| 2026-04-16 | Manual | Expanded seeds.ts from 3 placeholder URLs to 43 curated starter sources across five categories (Discovery Directories, Master Curators & Idea Aggregators, Digital Gardens & Personal Sites, Literary & Creative, Science/Tech). Created lib/db/migrations/008_seed_starter_sources.sql to back-fill the new seeds into an already-initialized database. 7 sources remain commented out pending URL confirmation (Wander, Scaling Synthesis, Chromatic, Burny, The Beginning of Infinity, occasionally humdrum, Industrial Nation). Migration 008 must be applied in Neon before next pipeline run. |
| 2026-04-04 | Architect Agent | Phase 3 (Deep User Model) design complete. Short-term 21-day centroid, drift detection, concept graph (user_concepts + user_concept_edges), implicit engagement signals (dwell time + save/bookmark). 14 tasks, all Not started. Migration 010 requires manual Neon apply before DEPTH-TASK-004+ can proceed. |
| 2026-04-04 | Architect Agent | Phase 4 (Engineered Serendipity) design complete. Serendipity scorer (4 pure functions), blind spot cluster DB + prober, exploration assembler (3-pool), receptivity signal (4 functions), rankFeed 2-pool extension. 15 tasks. Migration 011 requires manual Neon apply before SEREN-TASK-006+. |
| 2026-04-04 | Dev Agent | Phase 3 (Deep User Model) fully implemented. migration 010 SQL file, 12 Phase 3 constants + 2 assertions in aesthetic.ts, AestheticProfile extended with 5 fields, lib/types/concepts.ts, lib/db/aesthetics.ts extended (recomputeShortTermCentroid + updateDriftState), lib/utils/driftScore.ts, lib/db/concepts.ts (8 helpers), lib/pipeline/conceptBonus.ts, lib/discovery/conceptExtractor.ts, lib/pipeline/ranker.ts (blendCentroids + topConceptLabels), app/api/feedback/route.ts (save + dwell + concept pipeline), app/api/feed/today/route.ts (concept nodes parallel fetch), app/components/ArticleInteractions.tsx (dwell timer + save button). npx tsc --noEmit passes. All 14 DEPTH tasks Done. |
| 2026-04-04 | Dev Agent | Phase 4 (Engineered Serendipity) fully implemented and verified. migration 011 SQL applied. lib/config/serendipity.ts (15 constants + startup assertion), Article type extended (5 new @internal fields), lib/pipeline/serendipityScorer.ts (4 pure functions), lib/db/concepts.ts (2 new graph-read helpers), lib/pipeline/run.ts (llmScore + concept extraction), lib/db/blindSpots.ts (6 cluster helpers), lib/pipeline/blindSpotProber.ts (3 functions), lib/pipeline/explorationAssembler.ts (5 functions), lib/pipeline/ranker.ts (Phase 4 two-pool assembly replaces Phase 3 source-diversity exploration), lib/pipeline/receptivity.ts (5 functions), lib/db/aesthetics.ts (updateReceptivity), app/api/feedback/route.ts (probe routing + receptivity update), app/api/feed/today/route.ts (concept graph reads + budget from profile + field stripping), app/api/articles/[id]/route.ts (5 new internal fields stripped). npx tsc --noEmit passes clean. All 15 SEREN tasks Done. |
| 2026-04-19 | Manual | QA pass: four browser-verified bugs fixed — migration 011 user_feedback typo (HTTP 500 on all feedback), raw HTML body text in RSS articles, HTML entities not decoded in titles, explorationSlotType stripped from API (no badges). migration 012 corrective DDL added. ESLint cleaned. ANTHROPIC_API_KEY confirmed required. CLAUDE.md updated with env notes and implementation notes. |
| 2026-04-20 | Manual | Post-Phase-4 operational fixes: (1) app rebranded to Tangent; (2) Vercel cron added (vercel.json, daily 08:00 UTC `0 8 * * *`); (3) solo mode auth bypass (no login required); (4) batch storage migrated from filesystem to Neon DB (migration 013, storage.ts rewrite); (5) cooldown.ts rewritten to in-memory Map; (6) bodyExtractor.ts rewritten using node-html-parser (jsdom/readability removed — ESM incompatibility on Vercel); (7) data/sources.json replaced with 8 esoteric discovery sources (Quanta, Aeon, Nautilus, ACX, Ribbonfarm, LessWrong, Marginal Revolution, The Marginalian). ARCHITECTURE.md updated to reflect all changes. |
| 2026-04-25 | Dev Agent | Taste-learning fixes: (1) ranker.ts — cross-session source scoring: all historical feedback now processed via `extractSourceSlugFromId()` (slices trailing `-<8hex>` suffix) instead of filtering to today's batch only; `save` events count as positive signals alongside `like` for Wilson scores; (2) feedback/route.ts — `save` events now also update the aesthetic EMA centroid (treated as `like`); previously only like/dislike updated the profile; (3) run.ts — `estimateReadTime()` added (238 WPM, min 1 min), `Article.readTime` populated at pipeline time for all article types; (4) data/sources.json — expanded from 8 to 12 active RSS sources: Psyche, The Baffler, Noema, Works in Progress; (5) .gitignore — push.sh added; (6) types/node-html-parser.d.ts — minimal type stub for offline TypeScript resolution; (7) bodyExtractor.ts — explicit HTMLElement type annotation on `el` forEach callback. npx tsc --noEmit passes clean. |
| 2026-06-13 | Claude Code | Review remediation (Round 1 + Round 2) doc sync (D-03): refreshed the stale facts in this file — Next.js 14+→16, cron 07:00→08:00 UTC, 8→12 sources, in-memory cooldown→Postgres cooldown+run-lock, added `OWNER_EMAIL`/`ALLOWED_BASE_URLS` to the env table — and added the **Post-review updates** section documenting the rate limiter, run-lock, blind-spot prober wiring, migration runner, migrations 014–019, new shared modules (bodyClean, promptSafety, llm.ts, concurrency, useModalA11y, HeroImage), and the 8 removed v1 components. Per-finding detail in `agents/review/REVIEW_TRACKER.md`. |
| 2026-06-15 | Claude Code + Cowork | Rounds 4–6 shipped. R4 (adversarial review remediation); R5 (content mix: scroll restoration, paywall/teaser guard, personalized second-person curator notes replacing the RSS blurb, format taxonomy `longread/short/visual/potpourri/place`); R6 (LLM provider abstraction in `lib/llm/` — interface + Anthropic/Gemini adapters + shared rate limiter, all 7 call sites refactored, prompt-injection invariants preserved). Production **went live on Gemini free tier** (`LLM_PROVIDER=gemini`, 2026-06-15), **resolving R5-C3** (curator notes now generate at $0; verified live 7/7). The Round-6 design's `gemini-2.0-flash` pick was deprecated/shut down 2026-06-01, so the active model is **`gemini-2.5-flash-lite`** (commit 0dbd842). Per-finding detail in `agents/review/REVIEW_TRACKER.md`. |

