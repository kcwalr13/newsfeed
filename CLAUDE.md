# Project: Tangent (Discovery Companion)

## What This Is
A personalized content **discovery agent** that acts as a trusted companion,
hunting down genuinely interesting, original, one-off finds from across the
internet — including the decentralized Small Web (digital gardens, IndieWeb,
independent blogs). This is not a news aggregator, and (as of Round 7) **not a
feed reader**: each day it surfaces a small mix of *the best things on the
internet* — not just essays but websites/web-toys, music, video, threads, and
standalone curiosities (e.g. a feed-less `moltbook.com`). **The unit is the
*find*, not the source.** An index (Hacker News, are.na, r/InternetIsBeautiful)
is mined only for the outbound links it points at — never its own posts. The
goal is to help Kyle encounter ideas and perspectives he'd never find on his own,
and to learn his taste deeply over time.

## Scope
**Single-user, permanently.** The app is built for one person (Kyle) as the sole
user, and (decided 2026-06-23, Round 7) this is **definitive and forever** — no
multi-user, no extensibility-for-others. All personalization, taste modeling, and
discovery is opinionated to Kyle's taste. The codebase keeps its parameterized
identity (`userId`, `deviceId`) plumbing as-is (harmless), but we **stop designing
for expansion**: the "Future state — multi-user rollout" backlog in
`agents/review/REVIEW_TRACKER.md` is permanently closed. (The economics flip the
right way: one daily digest of ~7 items means we can spend a lot of effort per
item — fetch + verify + LLM-judge each candidate — to find a few genuinely great
one-offs, instead of cheaply ingesting volume.)

**Vision broadened (Round 7).** Tangent is deliberately widened from "evergreen
essays" to "agent-discovered best-of-the-internet, one-off gems" across content
types — personal-use only. See `agents/architect/design_product_round7_content_types.md`
(rev 2) and the note at the top of `agents/ba/vision_discovery_companion.md`.

**Discovery seeds, not subscriptions.** Round 7 will retire `data/sources.json` as
the digest's content supply, the RSS-feed path as the primary pipeline, and the
essay-only evaluator as the universal gate — this happens across R7-2 (supply) and
R7-3 (evaluator); as of R7-1 the existing pipeline is still live (behavior-
preserving). Curated index/seed lists
(`data/discovery_indexes.json`, `data/places.json`) are *crawl seeds* for
harvesting outbound destinations — never feeds-of-items.

## Vision
The product vision is documented in `agents/ba/vision_discovery_companion.md`.
It rests on four foundational pillars, to be built in sequence:

1. **Agentic Web Discovery** — Multi-agent content sourcing from the Small Web,
   IndieWeb, and decentralized sources, with LLM-based content evaluation
2. **Latent Aesthetic Space** — Embedding content along subjective dimensions
   (tone, pacing, complexity, emotional resonance) rather than topic tags
3. **Graph-Enhanced Long-Term Memory** — Persistent cognitive model of the user's
   evolving taste, with short-term/long-term preference fusion
4. **Engineered Serendipity** — Computing surprise via semantic distance, active
   learning to test blind spots, structured randomness

## Tech Stack
- Framework: Next.js 16 (App Router) + React 19, with TypeScript
- Styling: Tailwind CSS
- Database: Neon serverless Postgres (with pgvector for future embeddings)
- LLM: Claude API (for content evaluation, taste modeling, agent orchestration)
- Deployment target: Progressive Web App (PWA)
- Package manager: npm
- Version control: GitHub
- Platform: Web (desktop browser) + installable on mobile via PWA — no app stores

## Environment Variables
Copy `.env.example` to `.env.local` and fill in the values. Full reference:

**Required**
- `ANTHROPIC_API_KEY` — Used by the aesthetic scorer, concept extractor, LLM content evaluator, theme generator, and curator notes **when `LLM_PROVIDER=anthropic` (the committed code default)**. Without a valid key for the active provider, those LLM steps silently skip and articles are ranked by source score only. **Production currently runs `LLM_PROVIDER=gemini` (since 2026-06-15), so `GEMINI_API_KEY` is the active key and `ANTHROPIC_API_KEY` is only needed if you switch the provider back.**
- `DATABASE_URL` — Neon serverless Postgres connection string.

**LLM provider (Round 6)** — all LLM work goes through `lib/llm/` (`getLlm()`); the backend is config-selected, not hardcoded.
- `LLM_PROVIDER` — `anthropic` (committed default) or `gemini` (**active in production since 2026-06-15**). Switching is an env change only (no code change). A shared RPM limiter (`lib/llm/limiter.ts`) meters every call to the active provider's rate (no-op for Anthropic; metered to a conservative ~15 RPM ceiling for Gemini — free-tier RPM/RPD are account-specific and no longer published per-model, so this is a self-imposed safe ceiling tunable in `PROVIDER_CONFIG`, not a documented limit — with a discovery cap + a scoring wall-clock deadline so a daily run fits the budget and the batch always writes).
- `GEMINI_API_KEY` — Google AI Studio (**Gemini 2.5 Flash-Lite**) free-tier key; required when `LLM_PROVIDER=gemini` (the active production provider). The original Round-6 pick `gemini-2.0-flash` was deprecated and **shut down 2026-06-01** (free-tier quota → 0, `429 RESOURCE_EXHAUSTED`), so the active model is `gemini-2.5-flash-lite` (stable, free-tier, "thinking" off by default). Free-tier caveats (training-data privacy, Haiku↔Gemini taste-score drift, daily request cap) are documented in README + ARCHITECTURE.

**Discovery / pipeline**
- `BRAVE_SEARCH_API_KEY` — Used by the proactive discovery pipeline (Brave Search + Small Web).
- `CRON_SECRET` — Bearer token authenticating the daily cron trigger at `/api/pipeline/run` (set in Vercel env). Generate with `openssl rand -hex 32`.
- `NEWSAPI_KEY` — Optional; for the dormant NewsAPI adapter (not used by default).

**Single-user / auth (auth is currently OFF)**
- `OWNER_EMAIL` — Owner email shown in the account menu. Server-only — never hardcode in source.
- `NEXTAUTH_URL` — Base URL used to build verification / reset email links.
- `ALLOWED_BASE_URLS` — Optional comma-separated allowlist of origins permitted in email links; when set, `NEXTAUTH_URL`'s origin must be a member or email sending fails.
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` — Transactional email (verification / reset).

**Optional tuning knobs** (parsed in `lib/pipeline/config.ts`; fall back to defaults if unset/invalid)
- `MAX_ARTICLES_PER_SOURCE` (default **4** — tuned down from 5 for diversity now the palette is 23 sources, P3-B3), `MAX_ARTICLES_PER_CATEGORY` (default 4 — soft per-category cap on the diverse core, P3-B3), `MIN_SOURCES_PER_BATCH` (default 3), `REFRESH_COOLDOWN_MINUTES` (default 15).

## Key Implementation Notes

### Round 3 — Product (vision alignment) — see `agents/architect/design_product_round3_vision_alignment.md`
- **Source palette = 23** (was 12), each with a `category` (`SourceCategory` in `lib/types/article.ts`: science/philosophy/ideas/economics/psychology/culture/music/art/design/film/literature). Category is **not** stored on `Article` — resolved on read via `categoryForArticle()` in `lib/pipeline/sourceCategory.ts`. New domains: music ×4, art ×2, design, film, literature, esoteric-culture ×2.
- **Discovery** fills its 6 slots down to `LLM_EVAL_FLOOR`, then dips below the floor only as a last resort capped at `DISCOVERY_BELOW_FLOOR_MAX`=2 (R4-04) (`lib/discovery/run.ts`, structured `[discovery] YIELD …` log, P3-A1); a **novelty filter** (`lib/discovery/novelty.ts` `loadSeenSourceDomains` + `noveltyKey`, `NOVELTY_LOOKBACK_ISSUES=14`) drops fixed/recently-seen domains so it surfaces unfamiliar sources (P3-A3). A `MEGA_SITE_DENYLIST` drops mainstream platforms (Wikipedia/YouTube/Reddit/NYT/…) before eval, and `SHARED_HOSTS` (substack.com, github.io, …) are keyed by full host so one author doesn't suppress the whole platform (R4-03). Candidate supply is widened (`DISCOVERY_TOPICS_PER_RUN=12`, `DISCOVERY_CANDIDATES_PER_TOPIC=20`, `DISCOVERY_MAX_EVAL_CANDIDATES=40`, P3-A2) inside the DAT-H2 wall-clock budget. `computeDiscoveryYield()` (`lib/pipeline/discoveryMeta.ts`) returns `discoveryCount`/`discoverySources` (`{domain, name}[]` since R4-02) on `GET /api/feed/today` (P3-A4).
- **Adaptive rank blend:** the source/aesthetic split is no longer fixed 0.70/0.30 — `aestheticWeightForFeedback()` (`lib/config/aesthetic.ts`) ramps aesthetic weight `AESTHETIC_WEIGHT` (0.30) → `AESTHETIC_WEIGHT_MAX` (0.50) over `AESTHETIC_WEIGHT_SATURATION_COUNT` (50) feedback events; source weight is the complement (P3-C1).
- **Display guarantees** (`lib/pipeline/displayDiversity.ts`, applied before the top-`ISSUE_DISPLAY_SIZE`=7 slice): `promoteUnfamiliarSources` ≥`MIN_UNFAMILIAR_IN_ISSUE` (2) never-shown sources, `ensureCategorySpread` ≥`MIN_CATEGORIES_IN_ISSUE` (4) categories (P3-C2/C3). The rank + C2/C3 reorder (then a re-applied consecutive-source cap, R4-05) is resolved once in the shared `resolveDisplayedFeed()` (`lib/pipeline/displayedFeed.ts`), used by **both** `GET /api/feed/today` and `GET /api/issue/meta`, so the colophon credits + theme always match the displayed 7 (R4-01; cached metadata regenerates once via `ISSUE_META_VERSION`).
- **Instrumentation:** `computeMetrics()` (`lib/db/metrics.ts`) → `GET /api/metrics` (solo-gated) → `/dashboard` page (linked from the Colophon); on-the-fly, no snapshot table (P3-D1/D2/D3; D4 deferred).
- **First-run calibration:** `app/components/CalibrationModal.tsx` + `app/api/onboarding/calibration` (+ `/tone`) seed the taste model. **Batch** pieces (real DB-scored articles) route through the existing feedback path; **seed-set fallback** pieces (committed fixtures in `data/calibration_seed.json`, each carrying a hand-authored `aesthetic` vector) seed the centroid directly via `POST /api/onboarding/seed` and write **no** feedback rows (R4-08). Partial progress persists to `tangent_calibration_progress` and resumes across a refresh; an empty/failed fetch no longer consumes onboarding (R4-10/R4-13).


### RSS Adapter helpers (`lib/pipeline/adapters/rssAdapter.ts`)
- `htmlToPlainText(html, title?)` — strips HTML tags from RSS `content:encoded` fields **and** removes page chrome (share bars, "Featured Video", repeated title/byline/dateline, trailing related-article lists) via the shared `cleanBodyParagraphs` from `lib/utils/bodyClean.ts` (PIPE-Q1), before storing as `bodyText`.
- `decodeEntities(str)` — an alias for the shared `decodeHtmlEntities` in `lib/utils/htmlEntities.ts`, which decodes **both named and numeric** HTML entities (astral-safe, order-correct; e.g. `&#8217;` → `'`, `&amp;` → `&`) that `rss-parser` does not fully handle. The same decoder is used at ingest (`title`, `description`, `bodyText`) and at display time (FE-L5 / PIPE-M7).

### Exploration slot badges (`app/components/ArticleCard.tsx`)
- `explorationSlotType` is now passed through the feed API response (it was previously stripped).
- `ArticleCard` renders a violet badge for exploration-slot articles: **Stretch**, **Blind spot**, or **Wildcard** depending on `explorationSlotType`.

### Database migrations
- Schema lives in `lib/db/migrations/` as numbered `NNN_*.sql` files (001–020). Apply with **`npm run db:migrate`** (preview with `npm run db:migrate:status`). The runner (`scripts/migrate.mjs`) applies pending files in order — each in a transaction — and records them in a `schema_migrations` table; migrations use `IF [NOT] EXISTS`, so re-running against an already-provisioned DB is safe. Never run schema-changing SQL against the live DB by hand. **020 (`020_discovery_seen_urls.sql`, R7-2) was applied to Neon on 2026-06-23** (`npm run db:migrate`; confirmed by `db:migrate:status` — 001–020 all applied), so the durable discovery novelty memory is now live (surfaced finds are recorded permanently and never resurface).
- Migration 011 (`011_serendipity.sql`) adds the serendipity schema: the `blind_spot_clusters` table, `feedback.dwell_seconds`, and `user_aesthetic_profiles.receptivity_score` / `exploration_budget`. Its `dwell_seconds` statement originally targeted a non-existent `user_feedback` table, so that column was never created.
- Migration 012 (`012_fix_feedback_dwell.sql`) is the corrective follow-up to 011: it re-adds the missing `feedback.dwell_seconds` to the correct table (idempotent `ADD COLUMN IF NOT EXISTS`). It does **not** touch `receptivity_score` / `exploration_budget` — those are added in 011.

## Agent Pipeline
This project is developed using a four-agent system. Each agent has a defined role
and produces structured outputs that feed the next agent. Do not skip stages.

1. **BA** (Business Analyst) — converts plain English requests into requirements docs
2. **PM** (Product Manager) — converts requirements into user stories and maintains roadmap
3. **Architect** — converts PM artifacts into technical design and task breakdown
4. **Dev** — executes individual tasks assigned by the Architect

## Shared Memory
All agents read and write to the /agents directory. This is the source of truth.
Never delete files here. Append, update, or create new versioned files only.

The full product vision is at `agents/ba/vision_discovery_companion.md`. All agents
should reference this document when making design decisions to ensure alignment
with the long-term direction.

## Ground Rules
- Make incremental progress. Never try to complete large features in one pass.
- Leave clear artifacts at the end of every session so the next session can orient quickly.
- When in doubt about scope, do less and document the decision.
- All requirements, stories, designs, and tasks live in /agents before any code is written.
- Single-user is permanent (Round 7 scope lock): build opinionated for Kyle and
  **stop designing for multi-user expansion**. Keep the existing `userId`/`deviceId`
  identity plumbing as-is (harmless), but do not add new abstraction for other users.
  See the Scope section above and the permanently-closed "Future state — multi-user
  rollout" section in `agents/review/REVIEW_TRACKER.md`.
