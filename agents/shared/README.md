# Agent Shared Memory

This directory contains cross-agent reference material available to all agents.

---

## Project Vision

This project is a **personalized content discovery companion** — not a news
aggregator. It surfaces genuinely interesting, original, and evergreen content
from across the internet, including the decentralized Small Web. It learns the
user's taste deeply over time.

**Scope**: Single-user first (built for Kyle). Parameterized identity throughout
for future multi-user expansion. The user supplies starter content sources to
seed discovery quality from day one.

**Vision document**: `agents/ba/vision_discovery_companion.md` — all agents
should reference this when making design decisions.

**Four pillars** (built in sequence):
1. Agentic Web Discovery (Phase 1 — complete)
2. Latent Aesthetic Space (Phase 2 — complete)
3. Graph-Enhanced Long-Term Memory (Phase 3 — complete)
4. Engineered Serendipity (Phase 4 — next)

---

## Current Project State

**Last updated**: 2026-04-04 (Phase 3 — Deep User Model — shipped)

### Foundation milestones shipped (v1 infrastructure)

| Milestone | Status |
|-----------|--------|
| 1 — Core Daily Digest | **Complete** |
| 2 — Feedback Capture (localStorage) | **Complete** |
| 2.5 — Server-Side Feedback Durability | **Complete** |
| 3 — User Authentication | **Complete** |
| 4 — Feed Personalization | **Complete** |
| 5 — Feed Refresh and Source Diversity | **Complete** |
| 7 — Proactive Content Discovery (P0 + P1) | **Complete** |
| 8 — Discovery Bug Fixes | **Complete** |

### Phases shipped (four-pillar vision)

| Phase | Status |
|-------|--------|
| Phase 1 — Agentic Content Discovery | **Complete** |
| Phase 2 — Latent Aesthetic Space | **Complete** |
| Phase 3 — Deep User Model | **Complete** |

Phase 1 delivered: Small Web / IndieWeb source seeding with blogroll expansion
(OPML + HTML patterns), article body text extraction via Mozilla Readability,
LLM-based content evaluation (Claude Haiku, structured tool-use output, 5-dimension
scoring), multi-query topic search with rotation cursor, and committed query bank
seed file. All 19 AGDISC tasks shipped.

Phase 2 delivered: Six-dimension aesthetic scoring (contemplative, concrete, personal,
playful, specialist, emotional) via Claude Haiku structured output at ingest time.
Scores stored as `vector(6)` in Neon via pgvector (`article_aesthetic_scores` table).
Per-user aesthetic centroid maintained via EMA (alpha=0.2) in `user_aesthetic_profiles`
table, updated on each feedback event. Feed ranking blends cosine similarity (30%)
with source Wilson score (70%) in `rankFeed()`.

Phase 3 delivered: Two-window preference memory system (21-day short-term centroid
blended 35/65 with long-term EMA, inverted to 65/35 during taste drift). Concept
graph (`user_concepts` + `user_concept_edges` tables) built from LLM-extracted
concept labels from liked articles, used as supplementary ranking signal via
`applyConceptBonus()`. Drift detection via cosine distance (threshold 0.25).
Implicit engagement signals: dwell time tracking via `visibilitychange` API,
passive beacon, and save/bookmark feedback value. All Phase 3 code is additive;
no Phase 2 infrastructure replaced. DDL: `lib/db/migrations/010_deep_user_model.sql`
applied in Neon (confirmed by user). All 14 DEPTH tasks Done, all 17 DEPTH stories Released.

### In progress

Nothing actively in flight. Ready to begin Phase 4 (Engineered Serendipity).

### Next action

Run the **BA agent** to produce BRD for Phase 4: Engineered Serendipity.
This phase adds serendipity scoring, active learning, structured randomness weighted
by the user's psychographic profile, and exploration/exploitation balance.

The BA agent prompt should reference `agents/ba/vision_discovery_companion.md`
Section: "Engineering Serendipity and Mapping the Unknown".

### Key files for orientation

| What | Where |
|------|-------|
| Project config (scope, vision, rules) | `CLAUDE.md` |
| Full product vision | `agents/ba/vision_discovery_companion.md` |
| Architecture overview | `agents/architect/ARCHITECTURE.md` |
| All milestones and roadmap | `agents/pm/roadmap.md` |
| Phase 2 design doc | `agents/architect/design_aesthetic_space_phase2_v1.md` |
| Phase 2 task list | `agents/architect/tasks_aesthetic_space_phase2_v1.md` |
| Phase 3 design doc | `agents/architect/design_deep_user_model_phase3_v1.md` |
| Phase 3 task list | `agents/architect/tasks_deep_user_model_phase3_v1.md` |
| Small Web starter seeds (43 URLs) | `lib/discovery/smallWeb/seeds.ts` |
| Phase 3 DB migration (applied in Neon) | `lib/db/migrations/010_deep_user_model.sql` |
