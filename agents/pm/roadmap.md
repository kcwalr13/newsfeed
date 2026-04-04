# Product Roadmap

**Last Updated**: 2026-04-04 (Milestones 3 and 4 scoped; auth and personalization stories written)
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

**Status**: Released
**Shipped**: 2026-04-04
**Stories doc**: `agents/pm/stories_feedback_capture_v1.md`
**Source BRD**: `agents/ba/requirements_feedback_capture_v1.md` (BRD-002)

### P0 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| FB-001 | Feedback Store Module | Released |
| FB-002 | FeedbackButtons Component | Released |
| FB-003 | Feedback Buttons on Feed Cards | Released |
| FB-004 | Feedback Buttons on Article Detail View | Released |
| FB-005 | Feedback Persists Across Sessions | Released |

### Deferred to Later Milestones

| Story ID | Title | Status |
|----------|-------|--------|
| FUTURE-002 | Source weighting and ranking based on feedback signals | Backlog |
| FUTURE-003 | Personalized article scoring and feed reordering | Backlog |
| FUTURE-004 | Source discovery driven by feedback | Backlog |

---

## Milestone 2.5 — Feedback Durability

**Goal**: Feedback is persisted server-side so it survives browser data clears.
Each device receives a stable anonymous UUID on first visit. Existing localStorage
feedback is migrated automatically. Failed writes are queued and retried. The
FeedbackButtons UI is completely unchanged.

**Status**: Released
**Shipped**: 2026-04-04
**Stories doc**: `agents/pm/stories_server_feedback_v1.md`
**Source BRD**: `agents/ba/requirements_server_feedback_v1.md` (BRD-003)
**Prerequisite**: Milestone 2 FB stories (FB-001 through FB-005) shipped.

### P0 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| SFB-001 | Device Identity Initialization | Released |
| SFB-002 | Feedback Database Schema | Released |
| SFB-003 | GET /api/feedback Endpoint | Released |
| SFB-004 | POST /api/feedback Endpoint | Released |
| SFB-005 | DELETE /api/feedback/[articleId] Endpoint | Released |
| SFB-006 | Client: Write Feedback to Server on Tap | Released |
| SFB-007 | Offline Retry Queue | Released |
| SFB-008 | POST /api/feedback/migrate Endpoint | Released |
| SFB-009 | Client: Run One-Time Migration | Released |
| SFB-010 | Client: Load Feedback from Server on App Start | Released |

---

## Milestone 3 — User Authentication (Identity Foundation)

**Goal**: Users can create accounts with email and password, verify their email,
and log in from any device. Feedback history is associated with the account and
follows the user across devices. Existing anonymous users are unaffected. A user
who gave feedback before registering does not lose any of that history at first
login.

**Status**: Not started
**Prerequisite**: Milestone 2.5 shipped.
**Stories doc**: `agents/pm/stories_user_auth_v1.md`
**Source BRD**: `agents/ba/brd_user_auth_v1.md` (BRD-005)
**Required by**: Milestone 4 (cross-device personalization depends on this)

### P0 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| AUTH-001 | Users, Sessions, and Token Schema | Not started |
| AUTH-002 | Registration API | Not started |
| AUTH-003 | Email Verification API | Not started |
| AUTH-004 | Login API | Not started |
| AUTH-005 | Device-to-User Feedback Migration on First Login | Not started |
| AUTH-006 | Cross-Device Feedback Merge on Login | Not started |
| AUTH-007 | Password Reset Flow | Not started |
| AUTH-008 | Logout API | Not started |
| AUTH-009 | Auth UI — Header Icon and Auth Pages | Not started |
| AUTH-010 | Session Persistence — Client Integration | Not started |
| AUTH-011 | Anonymous Fallback Remains Fully Functional | Not started |

### Deferred to Later Milestones

| Story ID | Title | Status |
|----------|-------|--------|
| FUTURE-007 | Push notifications for new daily digest | Backlog |
| FUTURE-AUTH-001 | Mandatory login enforcement (grace period / hard gate) | Backlog |
| FUTURE-AUTH-002 | User-facing account management (email change, account deletion) | Backlog |

---

## Milestone 4 — Feed Personalization (Personalized Feed)

**Goal**: The daily feed is ranked by each user's feedback history. Sources
consistently liked appear near the top; sources consistently disliked drift lower
or are suppressed. A small exploration budget ensures the feed does not collapse
into a filter bubble. Personalization follows authenticated users across devices;
anonymous users are personalized by device. New users with no feedback history see
no change.

**Status**: Not started
**Prerequisite**: Milestone 3 (user authentication) shipped.
**Stories doc**: `agents/pm/stories_feed_personalization_v1.md`
**Source BRD**: `agents/ba/brd_feed_personalization_v1.md` (BRD-004)

### P0 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| PERS-001 | Source Scoring Model | Not started |
| PERS-002 | Ranked Feed Output | Not started |
| PERS-003 | Source Suppression | Not started |
| PERS-004 | Source Diversity Cap | Not started |
| PERS-005 | Exploration Budget | Not started |
| PERS-006 | Pipeline Integration | Not started |
| PERS-007 | All-Sources-Suppressed Fallback | Not started |
| PERS-008 | API Delivers Pre-Ranked Feed | Not started |
| PERS-009 | Anonymous vs. Authenticated Identity Routing | Not started |
| PERS-010 | New User Graceful Degradation | Not started |

### P1 Stories

| Story ID | Title | Status |
|----------|-------|--------|
| PERS-011 | Feedback-After-Cutoff Behavior | Not started |

### Deferred to Later Milestones

| Story ID | Title | Status |
|----------|-------|--------|
| FUTURE-PERS-001 | User-facing suppression reversal ("reset personalization") | Backlog |
| FUTURE-PERS-002 | Topic or category-level scoring (beyond source-level) | Backlog |
| FUTURE-PERS-003 | Article-level scoring (title/content similarity) | Backlog |
| FUTURE-PERS-004 | Source discovery driven by feedback (dynamic source list) | Backlog |

---

## Milestone 5 — Extended Features

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
| 2026-04-04 | PM Agent | Milestone 2.5 added. BRD-003 resolved. 10 SFB stories written (stories_server_feedback_v1.md). Covers device identity, DB schema, all four API endpoints, client integration, offline retry queue, and localStorage migration. |
| 2026-04-04 | Manual | Milestone 2 and 2.5 marked Released. All FB and SFB stories updated to Released status. Roadmap drift corrected. |
| 2026-04-04 | PM Agent | Milestone 3 (User Authentication) and Milestone 4 (Feed Personalization) added. 11 AUTH stories and 11 PERS stories written. Former Milestone 3 (Extended Features) renumbered to Milestone 5. Deferred backlog items added for future suppression reversal and mandatory login enforcement. |
