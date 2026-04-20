# Project: Tangent (Discovery Companion)

## What This Is
A personalized content discovery application that acts as a trusted companion,
surfacing genuinely interesting, original, and evergreen content from across the
internet — including the decentralized Small Web (digital gardens, IndieWeb,
independent blogs). This is not a news aggregator. The goal is to help the user
encounter ideas, essays, and perspectives they would never find on their own, and
to learn their taste deeply over time.

## Scope
**Single-user first.** The app is built for one person (Kyle) as the sole user.
All personalization, taste modeling, and discovery is optimized for a single deep
relationship rather than a multi-user platform. The codebase uses parameterized
identity (userId, deviceId) throughout so that multi-user expansion is possible
later without rearchitecting.

**Starter sources provided.** The user will supply an initial set of trusted content
sources (blogs, newsletters, digital gardens, authors) to seed the discovery
system and calibrate quality. The system is not starting from a cold blank slate.

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
- Framework: Next.js (App Router) with TypeScript
- Styling: Tailwind CSS
- Database: Neon serverless Postgres (with pgvector for future embeddings)
- LLM: Claude API (for content evaluation, taste modeling, agent orchestration)
- Deployment target: Progressive Web App (PWA)
- Package manager: npm
- Version control: GitHub
- Platform: Web (desktop browser) + installable on mobile via PWA — no app stores

## Required Environment Variables
- `ANTHROPIC_API_KEY` — **required**. Used by the aesthetic scorer, concept extractor, and LLM content evaluator. Without it, aesthetic scoring silently skips and articles are ranked by source score only.
- `DATABASE_URL` — Neon serverless Postgres connection string.
- `BRAVE_SEARCH_API_KEY` — Used by the proactive discovery pipeline.
- See `.env.local.example` (if present) for the full list.

## Key Implementation Notes

### RSS Adapter helpers (`lib/pipeline/adapters/rssAdapter.ts`)
- `htmlToPlainText(html)` — strips HTML tags from RSS `content:encoded` fields before storing as `bodyText`. Required because RSS feeds often embed raw HTML.
- `decodeEntities(str)` — decodes numeric HTML entities (e.g. `&#8217;` → `'`) that `rss-parser` does not handle. Applied to `title`, `description`, and `bodyText` at ingest time.

### Exploration slot badges (`app/components/ArticleCard.tsx`)
- `explorationSlotType` is now passed through the feed API response (it was previously stripped).
- `ArticleCard` renders a violet badge for exploration-slot articles: **Stretch**, **Blind spot**, or **Wildcard** depending on `explorationSlotType`.

### Database migrations
- Migration 011 (`lib/db/migrations/011_serendipity.sql`) — fixed a typo that referenced `user_feedback` instead of `feedback`. This caused every feedback upsert to fail with HTTP 500.
- Migration 012 (`lib/db/migrations/012_fix_feedback_dwell.sql`) — safe `IF NOT EXISTS` corrective migration. Apply this to any already-deployed database to add the missing `dwell_seconds` and `receptivity_score` / `exploration_budget` columns.

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

## Environment Variables
- `CRON_SECRET` — must be set in Vercel environment variables to authenticate the daily cron trigger at `/api/pipeline/run`. Generate with `openssl rand -hex 32`.

## Ground Rules
- Make incremental progress. Never try to complete large features in one pass.
- Leave clear artifacts at the end of every session so the next session can orient quickly.
- When in doubt about scope, do less and document the decision.
- All requirements, stories, designs, and tasks live in /agents before any code is written.
- Design for single-user now, but keep identity parameterized for future expansion.
