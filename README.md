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

A daily pipeline pulls candidates from a set of trusted RSS sources plus an agentic
discovery pass (Brave Search + a Small Web crawl), screens them through a quality
gate, evaluates each with Claude, scores them along subjective aesthetic dimensions,
ranks them against your evolving taste model, and writes a dated **batch** (a daily
"issue" of ~7 pieces) to Postgres. The web app reads the latest batch, records your
feedback (like / save / pass + reading position + dwell), and feeds that back into
the taste model.

## Tech stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript
- **Styling:** Tailwind CSS v4
- **Database:** Neon serverless Postgres (pgvector-ready for embeddings)
- **LLM:** Claude API (content evaluation, aesthetic scoring, concept extraction, theme generation)
- **Delivery:** Progressive Web App (installable; no app stores)
- **Hosting:** Vercel (daily cron triggers the pipeline)

## Prerequisites

- **Node.js 22+** (the migration runner uses `process.loadEnvFile` and a global `WebSocket`)
- **npm**
- A **Neon** Postgres database (connection string)
- An **Anthropic API key** (required — without it, aesthetic scoring/concept extraction are skipped and articles rank by source score only)
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
| `ANTHROPIC_API_KEY` | **Yes** | Aesthetic scorer, concept extractor, LLM content evaluator, theme generator. |
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
