# Product Roadmap

**Last Updated**: 2026-04-04 (Milestone 2 in progress)
**Maintained by**: PM Agent

---

## How to Read This Roadmap

- **Released**: In production.
- **In Progress**: Actively being designed or built.
- **Planned**: Scoped and ready for the Architect to pick up.
- **Backlog**: Identified but not yet scoped; prerequisites may be unmet.

Stories are linked to their source documents. The Architect picks up items with
status "Planned" and breaks them into technical tasks.

---

## Milestone 1 — Core Daily Digest (v1)

**Goal**: A user can open the app, see 20 articles curated from the web, read each
article inside the app, and tap through to the original source. The feed refreshes
once daily. The app is installable as a PWA on mobile.

**Status**: Released
**Shipped**: 2026-04-04
**Stories doc**: `agents/pm/stories_article_feed_v1.md`

### P0 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| FEED-002 | Article Data Model | Released |
| FEED-001 | Daily Article Fetch Job | Released |
| FEED-003 | Content Validation and Fallback | Released |
| FEED-004 | Today's Feed Endpoint | Released |
| FEED-005 | Article Detail Endpoint | Released |
| FEED-006 | Feed Page — Article Card List | Released |
| FEED-007 | Feed Page — Loading State | Released |
| FEED-010 | Article Reading View — Layout and Content | Released |
| FEED-011 | Article Reading View — View Source Link | Released |
| FEED-013 | Mobile Responsive Layout | Released |

### P1 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| FEED-008 | Feed Page — Error State | Released |
| FEED-009 | Feed Page — Batch Date Label | Released |
| FEED-012 | PWA Installability | Released |

---

## Milestone 2 — Feedback System (v2)

**Goal**: Users can like or dislike articles. These signals are stored and begin
feeding back into source weighting and article scoring.

**Status**: In Progress
**Stories doc**: `agents/pm/stories_feedback_capture_v1.md`
**Source BRD**: `agents/ba/requirements_feedback_capture_v1.md` (BRD-002)

### P0 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| FB-001 | Feedback Store Module | Planned |
| FB-002 | FeedbackButtons Component | Planned |
| FB-003 | Feedback Buttons on Feed Cards | Planned |
| FB-004 | Feedback Buttons on Article Detail View | Planned |
| FB-005 | Feedback Persists Across Sessions | Planned |

### Deferred to Later Milestones

| Story ID | Title | Status |
|----------|-------|--------|
| FUTURE-002 | Source weighting and ranking based on feedback signals | Backlog |
| FUTURE-003 | Personalized article scoring and feed reordering | Backlog |
| FUTURE-004 | Source discovery driven by feedback | Backlog |

---

## Milestone 3 — Accounts and Persistence (v3)

**Goal**: Users can create accounts so their preferences and feedback history persist
across devices.

**Status**: Backlog
**Prerequisite**: Milestone 2 shipped; Auth BRD written by BA.

| Story ID | Title | Status |
|----------|-------|--------|
| FUTURE-005 | User accounts and saved preferences | Backlog |
| FUTURE-007 | Push notifications for new daily digest | Backlog |

---

## Milestone 4 — Extended Features (v4+)

**Goal**: Quality-of-life features once the core loop is proven.

**Status**: Backlog

| Story ID | Title | Status |
|----------|-------|--------|
| FUTURE-006 | Offline reading / article caching | Backlog |
| FUTURE-008 | Search and filter by topic or category | Backlog |
| FUTURE-009 | Pull-to-refresh or mid-day manual refresh | Backlog |
| FUTURE-010 | Article sharing | Backlog |

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-04 | PM Agent | Initial roadmap created. Milestone 1 scoped from BRD-001. |
| 2026-04-04 | PM Agent | Milestone 1 marked Released. All 13 FEED stories shipped. Milestone 2 unblocked pending Feedback BRD. |
| 2026-04-04 | PM Agent | Milestone 2 moved to In Progress. BRD-002 resolved. 5 FB stories written (stories_feedback_capture_v1.md). FUTURE-001 replaced by FB-001 through FB-005. FUTURE-002/003/004 remain backlog. |
