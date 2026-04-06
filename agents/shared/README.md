# Agent Shared Memory

This directory contains cross-agent reference material available to all agents.

---

## Current Project State

**Last updated**: 2026-04-05 (M7 fully complete; M8 bug-fix pass next)

### Milestones shipped

| Milestone | Status |
|-----------|--------|
| 1 — Core Daily Digest | **Complete** |
| 2 — Feedback Capture (localStorage) | **Complete** |
| 2.5 — Server-Side Feedback Durability | **Complete** |
| 3 — User Authentication | **Complete** |
| 4 — Feed Personalization | **Complete** |
| 5 — Feed Refresh and Source Diversity | **Complete** |
| 7 — Proactive Content Discovery (P0 + P1) | **Complete** |

### In progress

Nothing actively in flight. Next: M8 bug-fix pass (see below).

### Next action

Three known defects from the M7 review need to be fixed before new features. Hand
this list directly to the **Architect** agent — no BA/PM pass needed for bug fixes.

**Defect 1 — Topic weight double-counting (Critical)**
`runDiscovery` processes ALL historical feedback rows on every pipeline run, causing
topic weights to drift upward/downward unboundedly over time. Fix: add a
`last_processed_at TIMESTAMPTZ` column to `discovery_topic_weights`; only process
feedback rows where `feedback.updated_at > last_processed_at`; update the column
after processing. Requires a DDL migration and changes to `lib/discovery/run.ts`
and `lib/db/discovery.ts`.

**Defect 2 — `discoveryTopic` leaks to client**
`Article.discoveryTopic` is an internal field (marked `@internal`) but is returned
verbatim in `GET /api/feed/today`. Strip it from each article before serializing
the response in `app/api/feed/today/route.ts`.

**Defect 3 — `deviceId`/`userId` confusion in topic weight upsert**
In `lib/discovery/run.ts`, `upsertTopicWeight` is called with `userId` as the first
argument, which is the `deviceId` parameter. This means device-scoped lookups
(`getTopicWeightsForDevice`) will never find user-triggered weight rows. Fix:
thread the actual `deviceId` through `runDiscovery` and use it correctly.

### Key files for orientation

| What | Where |
|------|-------|
| Architecture overview | `agents/architect/ARCHITECTURE.md` |
| All milestones and roadmap | `agents/pm/roadmap.md` |
| M7 task list (reference) | `agents/architect/tasks_proactive_discovery_v1.md` |
| M7 design doc (reference) | `agents/architect/design_proactive_discovery_v1.md` |
