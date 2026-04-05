# Agent Shared Memory

This directory contains cross-agent reference material available to all agents.

---

## Current Project State

**Last updated**: 2026-04-04 (M7 P0 shipped; DISC-009 topic weights next)

### Milestones shipped

| Milestone | Status |
|-----------|--------|
| 1 — Core Daily Digest | **Complete** |
| 2 — Feedback Capture (localStorage) | **Complete** |
| 2.5 — Server-Side Feedback Durability | **Complete** |
| 3 — User Authentication | **Complete** |
| 4 — Feed Personalization | **Complete** |
| 5 — Feed Refresh and Source Diversity | **Complete** |
| 7 — Proactive Content Discovery (P0) | **Complete** |

### In progress

| Milestone | Story | Status |
|-----------|-------|--------|
| 7 — Proactive Content Discovery | DISC-009 Topic Weight Feedback Loop | **Planned** |

### Next action

DISC-009 is the next task. It requires:
1. A new `discovery_topic_weights` DB table (DDL to run in Neon)
2. Weight load/update logic wired into `runDiscovery` (userId is already accepted)
3. Feedback handler to adjust topic weights when a discovery article is liked/disliked

Run @agent-dev with the task list at `agents/architect/tasks_proactive_discovery_v1.md`.

### Key files for orientation

| What | Where |
|------|-------|
| Architecture overview | `agents/architect/ARCHITECTURE.md` |
| All milestones and roadmap | `agents/pm/roadmap.md` |
| Active task list (M7) | `agents/architect/tasks_proactive_discovery_v1.md` |
| Active design doc (M7) | `agents/architect/design_proactive_discovery_v1.md` |
