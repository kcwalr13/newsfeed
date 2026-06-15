# Tangent — a discovery companion

Tangent is a personalized content-discovery app that acts as a trusted companion,
surfacing genuinely interesting, original, and evergreen writing from across the
internet — including the decentralized **Small Web** (digital gardens, the
IndieWeb, independent blogs). It is **not** a news aggregator: the goal is to help
you encounter ideas, essays, and perspectives you'd never find on your own, and to
learn your taste deeply over time.

It is a **single-user** project (built for one reader) but the codebase keeps
identity parameterized (`userId` / `deviceId`) so multi-user is possible later.

The full product vision lives in
[`agents/ba/vision_discovery_companion.md`](agents/ba/vision_discovery_companion.md).
Architecture and design notes are in [`ARCHITECTURE.md`](agents/architect/ARCHITECTURE.md); working
conventions and the agent pipeline are in [`CLAUDE.md`](CLAUDE.md).

## How it works (one paragraph)

A daily pipeline pulls candidates from **23 trusted RSS sources** — spanning science,
philosophy, ideas, economics, psychology, culture, music, art, design, film, and
literature — plus an agentic discovery pass (Brave Search + a Small Web crawl). A
**novelty filter** drops discovered candidates whose domain is already a fixed source
or has appeared in recent issues, so discovery surfaces genuinely unfamiliar sources.
Candidates are screened through a quality gate, evaluated with Claude, scored along
subjective aesthetic dimensions, and ranked against your evolving taste model with an
**adaptive blend** that trusts source reputation early and your learned taste as
feedback accumulates. The pipeline writes a dated **batch** of 20 articles to Postgres;
the app shows the top **7** as the day's issue, guaranteeing at least 2 unfamiliar
sources and at least 4 distinct categories. The app records your feedback
(like / save / pass + reading position + dwell), feeds it back into the taste model, and
reports the whole system's health on a **`/dashboard`** page (discovery share, distinct
sources this week, category mix, exploration acceptance, taste-model maturity). A
first-run **taste calibration** seeds the model from a few choices so it learns you
faster.

## Tech stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript
- **Styling:** Tailwind CSS v4
- **Database:** Neon serverless Postgres (pgvector-ready for embeddings)
- **LLM:** provider-abstracted (`lib/llm/`) — Claude API (committed default) or Gemini free-tier, selected by `LLM_PROVIDER` (**production runs Gemini 2.5 Flash-Lite, free tier**); powers content evaluation, aesthetic scoring, concept extraction, and theme + curator-note generation
- **Delivery:** Progressive Web App (installable; no app stores)
- **Hosting:** Vercel (daily cron triggers the pipeline)

## Prerequisites

- **Node.js 22+** (the migration runner uses `process.loadEnvFile` and a global `WebSocket`)
- **npm**
- A **Neon** Postgres database (connection string)
- An **LLM API key** for the active provider — **Anthropic** (`ANTHROPIC_API_KEY`, the default) or **Gemini** (`GEMINI_API_KEY`, when `LLM_PROVIDER=gemini`). Without a valid key, aesthetic scoring / concept extraction / curator notes are skipped and articles rank by source score only.
- A **Brave Search API key** (for the proactive discovery pipeline)

## Getting started

```bash
npm install

# Configure environment
cp .env.example .env.local
# …then fill in the values (see the table below)

# Create / update the database schema (applies lib/db/migrations/*.sql in order)
npm run db:migrate          # use `npm run db:migrate:status` to preview first

# Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

To populate the first issue, trigger a pipeline run (the in-app refresh button, or
`POST /api/feed/refresh`). In production the daily cron does this automatically.

## Environment variables

Copy `.env.example` to `.env.local` and set:

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `ANTHROPIC_API_KEY` | Yes, unless `LLM_PROVIDER=gemini` | Aesthetic scorer, concept extractor, content evaluator, theme + curator-note generator (the default provider). |
| `LLM_PROVIDER` | Optional | Active LLM backend: `anthropic` (default) or `gemini`. |
| `GEMINI_API_KEY` | If `LLM_PROVIDER=gemini` | Google AI Studio (Gemini) free-tier key. See the LLM-provider notes below. |
| `DATABASE_URL` | **Yes** | Neon serverless Postgres connection string. |
| `BRAVE_SEARCH_API_KEY` | For discovery | Proactive Small-Web / web discovery pass. |
| `CRON_SECRET` | For cron | Bearer token authenticating the daily `/api/pipeline/run` trigger. Generate with `openssl rand -hex 32`. |
| `OWNER_EMAIL` | Optional | Owner email shown in the account menu (single-user). Server-only — never hardcode in source. |
| `NEWSAPI_KEY` | Optional | Dormant NewsAPI adapter (not used by default). |
| `NEXTAUTH_URL` | Auth/email only | Base URL used to build verification / reset links. |
| `ALLOWED_BASE_URLS` | Optional | Comma-separated allowlist of origins permitted in email links; when set, `NEXTAUTH_URL`'s origin must be a member or email sending fails. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | Auth/email only | Transactional email (the auth system is currently **off**). |

> The auth system ships but is disabled; the deployment should sit behind external
> access control (e.g. Vercel password protection) while it is off. See
> [`CLAUDE.md`](CLAUDE.md) and the review tracker for details.

### LLM provider (Round 6)

All LLM work goes through a provider abstraction in [`lib/llm/`](lib/llm) (`getLlm()`),
so the backend is chosen by config rather than hardcoded:

- **`anthropic` (default)** — Claude Haiku via `@anthropic-ai/sdk`, key `ANTHROPIC_API_KEY`.
- **`gemini`** — Gemini 2.5 Flash-Lite (free tier) via `@google/genai`, key `GEMINI_API_KEY`.
  Switch with `LLM_PROVIDER=gemini` in the environment (no code change). **This is the
  active production provider (since 2026-06-15).** The earlier Round-6 pick
  `gemini-2.0-flash` was deprecated and shut down 2026-06-01 (free-tier quota → 0), so the
  active model is `gemini-2.5-flash-lite` (stable, free-tier, "thinking" off by default).

A shared rate limiter ([`lib/llm/limiter.ts`](lib/llm/limiter.ts)) spaces every LLM
call to the active provider's RPM (a no-op for Anthropic; metered to a conservative
~15 RPM ceiling for Gemini — free-tier RPM/RPD are account-specific and no longer
published per-model, so this is a self-imposed safe ceiling, tunable in `PROVIDER_CONFIG`). Under Gemini the pipeline lowers its discovery-evaluation cap and the per-article
scoring phase is bounded by a wall-clock deadline, so a daily run fits the free-tier
rate **and** the function's time budget — and the batch is always written even if some
articles end up unscored (they fall back to source-score ranking).

Caveats when running on the Gemini **free tier**:

- **Training-data privacy.** Google may use free-tier prompts to improve its products.
  The app sends public article text plus a compact taste digest (your concept labels /
  tone) to scoring and curator-note calls. Acceptable for a private single-user app, but
  noted; keep `LLM_PROVIDER=anthropic` (a paid tier) for anything sensitive.
- **Taste-model drift.** Aesthetic scores already in the DB were produced by Claude Haiku;
  Gemini scores on a slightly different internal scale, so the taste centroid sits in a
  *mixed* space for a while. Default: accept the drift (old scores age out as feedback
  accrues). A one-time re-score of recent articles is optional if rankings feel off.
- **Daily request cap.** The free tier has a daily request ceiling; one cron run/day is
  fine, but avoid repeated `forceOverwrite` refreshes (each re-spends the cap).
- **Per-instance limiter.** The rate limiter is per serverless instance (one cron run =
  one instance, metered correctly); it does not coordinate across concurrent instances.

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Start the dev server. |
| `npm run build` | Production build (`next build`). |
| `npm run start` | Serve the production build. |
| `npm run lint` | ESLint. |
| `npm run db:migrate` | Apply pending SQL migrations in `lib/db/migrations/`, recording them in `schema_migrations`. Idempotent. |
| `npm run db:migrate:status` | List applied / pending migrations without applying anything. |
| `npm run refresh-query-banks` | Regenerate the discovery query banks. |

## Database migrations

Schema lives in [`lib/db/migrations/`](lib/db/migrations) as numbered `NNN_*.sql`
files. The runner (`scripts/migrate.mjs`) applies pending files in order, each
inside a transaction, and records them in a `schema_migrations` table; migrations
use `IF [NOT] EXISTS`, so re-running against an already-provisioned database is
safe. Run `npm run db:migrate` after pulling new migrations. Requires
`DATABASE_URL` (read from the environment or `.env.local`).

## Deployment

Deployed on **Vercel**. A daily cron (`vercel.json`) calls `POST /api/pipeline/run`
at **08:00 UTC** to assemble the day's issue; the route authenticates the caller
with `CRON_SECRET`. Set all required environment variables in the Vercel project
settings, and apply any new migrations with `npm run db:migrate` against the
production database before relying on dependent code.

## Project conventions

This repo is developed with a four-agent workflow (BA → PM → Architect → Dev) whose
artifacts live under [`agents/`](agents). Start with [`CLAUDE.md`](CLAUDE.md) for the
ground rules and [`ARCHITECTURE.md`](agents/architect/ARCHITECTURE.md) for the system design.
