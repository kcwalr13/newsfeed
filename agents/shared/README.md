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
1. Agentic Web Discovery (Phase 1 — next)
2. Latent Aesthetic Space (Phase 2)
3. Graph-Enhanced Long-Term Memory (Phase 3)
4. Engineered Serendipity (Phase 4)

---

## Current Project State

**Last updated**: 2026-04-04 (Phase 2 Latent Aesthetic Space complete; all 15 AESTH stories released)

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

Phase 1 delivered: Small Web / IndieWeb source seeding with blogroll expansion
(OPML + HTML patterns), article body text extraction via Mozilla Readability,
LLM-based content evaluation (Claude Haiku, structured tool-use output, 5-dimension
scoring), multi-query topic search with rotation cursor, and committed query bank
seed file. All 19 AGDISC tasks shipped. DDL: `lib/db/migrations/007_small_web_sources.sql`
must be applied to Neon (confirmed by user).

Phase 2 delivered: Six-dimension aesthetic scoring (contemplative, concrete, personal,
playful, specialist, emotional) via Claude Haiku structured output at ingest time.
Scores stored as `vector(6)` in Neon via pgvector (`article_aesthetic_scores` table).
Per-user aesthetic centroid maintained via EMA (alpha=0.2) in `user_aesthetic_profiles`
table, updated on each feedback event. Feed ranking blends cosine similarity (30%)
with source Wilson score (70%) in `rankFeed()`. Full cold-start and graceful
degradation to source-score-only ranking when profile or article scores are absent.
DDL: `lib/db/migrations/009_aesthetic_scores.sql` applied in Neon (confirmed by user).

### In progress

Nothing actively in flight. Ready to begin Phase 3.

### Next action

Run the **BA agent** to produce BRD for Phase 3: Deep User Model.
This phase builds a persistent cognitive model of the user's evolving taste, replaces
topic weights with vector-based taste profiles, and adds natural language feedback.

The BA agent prompt should reference `agents/ba/vision_discovery_companion.md`
Section: "Longitudinal Dynamics and Memory Architectures".

### Key files for orientation

| What | Where |
|------|-------|
| Project config (scope, vision, rules) | `CLAUDE.md` |
| Full product vision | `agents/ba/vision_discovery_companion.md` |
| Architecture overview | `agents/architect/ARCHITECTURE.md` |
| All milestones and roadmap | `agents/pm/roadmap.md` |
| Phase 2 design doc | `agents/architect/design_aesthetic_space_phase2_v1.md` |
| Phase 2 task list | `agents/architect/tasks_aesthetic_space_phase2_v1.md` |
