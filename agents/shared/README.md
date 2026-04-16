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

**Last updated**: 2026-04-16 (Phase 1 Agentic Content Discovery complete; all 19 tasks shipped)

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

### Phase 1 shipped (Pillar 1 — Agentic Web Discovery)

| Phase | Status |
|-------|--------|
| Phase 1 — Agentic Content Discovery | **Complete** |

Phase 1 delivered: Small Web / IndieWeb source seeding with blogroll expansion
(OPML + HTML patterns), article body text extraction via Mozilla Readability,
LLM-based content evaluation (Claude Haiku, structured tool-use output, 5-dimension
scoring), multi-query topic search with rotation cursor, and committed query bank
seed file. All 19 AGDISC tasks shipped. DDL: `lib/db/migrations/007_small_web_sources.sql`
must be applied to Neon (confirmed by user).

### In progress

Nothing actively in flight. Ready to begin Phase 2.

### Next action

Run the **BA agent** to produce BRD for Phase 2: Latent Aesthetic Space.
This phase embeds content along subjective dimensions (tone, pacing, complexity,
emotional resonance), builds an embedding pipeline using pgvector in Neon, and
enables cross-domain discovery based on aesthetic similarity.

The BA agent prompt should reference `agents/ba/vision_discovery_companion.md`
Section: "Mapping Latent Aesthetic Spaces".

### Key files for orientation

| What | Where |
|------|-------|
| Project config (scope, vision, rules) | `CLAUDE.md` |
| Full product vision | `agents/ba/vision_discovery_companion.md` |
| Architecture overview | `agents/architect/ARCHITECTURE.md` |
| All milestones and roadmap | `agents/pm/roadmap.md` |
| Phase 1 design doc | `agents/architect/design_agentic_discovery_phase1_v1.md` |
| Phase 1 task list | `agents/architect/tasks_agentic_discovery_phase1_v1.md` |
