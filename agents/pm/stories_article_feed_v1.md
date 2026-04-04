# User Stories — Article Feed v1

**ID**: PM-STORIES-001
**BRD Reference**: BRD-001 (Article Feed — Core Feed View)
**Date**: 2026-04-04
**Status**: Draft

---

## Overview

These stories cover the first shippable version of the article feed. They are scoped
to delivering the core daily digest experience: a user opens the app, sees 20 articles
curated from across the web, can read each one inside the app, and can navigate to
the original source. Stories that are explicitly out of scope for v1 are listed at the
bottom with a FUTURE tag.

Stories are grouped by functional area and ordered by dependency. Each story is
independently deliverable within its group.

---

## Group 1 — Content Pipeline

These stories establish the backend mechanism that fetches, validates, and stores the
daily batch of articles. They are foundational; nothing else ships without them.

---

### FEED-001 — Daily Article Fetch Job

**As a** system operator,
**I want** an automated job that fetches 20 articles per day from a configured set of
sources,
**so that** the feed is populated with fresh content each day without manual
intervention.

**Acceptance Criteria**:
- A job runs once per day at a configurable time (default: midnight UTC).
- The job collects exactly `ARTICLES_PER_DAY` articles (constant, default 20; not
  hardcoded in multiple places).
- Sources include at least one RSS feed and at least one web search discovery
  mechanism in v1; additional source types can be added later.
- The job stores the resulting article batch with a date key (YYYY-MM-DD) so
  historical batches are addressable.
- If a fetch run fails entirely, the previous day's batch remains visible to the
  user rather than showing an empty feed.
- The job is observable: it logs success/failure and article count to a persistent
  log or console output.

**Out of Scope**: Dynamic source weighting based on feedback (FUTURE). Source
reputation scoring (FUTURE).

---

### FEED-002 — Article Data Model

**As a** developer,
**I want** a well-defined article data schema,
**so that** all parts of the system (pipeline, API, UI) work from a single consistent
structure and the schema can accommodate future fields without breaking changes.

**Acceptance Criteria**:
- The schema is defined as a TypeScript type or interface in a shared location.
- Required fields: `id`, `title`, `sourceName`, `sourceUrl`, `articleUrl`,
  `publishedAt`, `fetchedAt`, `batchDate`.
- Optional fields: `description`, `imageUrl`, `bodyText` (for in-app reading view).
- All optional fields use explicit optional typing (not `undefined` via omission).
- A field `feedbackSlot` (or equivalent reserved key) exists as an optional nullable
  field to hold a future like/dislike signal; it must be present in the schema but
  unused in v1 logic.
- The schema is documented with inline comments explaining the purpose of each field.

**Notes**: The `feedbackSlot` field is intentionally a placeholder. Its presence
ensures that when the feedback system is built, no schema migration is needed on
stored article records.

---

### FEED-003 — Content Validation and Fallback

**As a** system,
**I want** articles with incomplete or broken content to be handled gracefully,
**so that** the feed never shows malformed cards and a text-only article is always
preferable to a broken one.

**Acceptance Criteria**:
- During the fetch job, each article is validated against the schema before being
  stored.
- Articles missing `title` or `articleUrl` are discarded and do not count toward the
  20-article quota (the job fetches extras to compensate).
- Articles missing `description` or `imageUrl` are stored as-is; the UI renders them
  text-only without a placeholder image or error state.
- Articles missing `bodyText` display a message in the reading view ("Full text not
  available") and the "View Source" link is made prominent.
- No article record is stored with null or empty `title`.

---

## Group 2 — Feed API

These stories expose the daily batch to the frontend. They depend on Group 1.

---

### FEED-004 — Today's Feed Endpoint

**As a** frontend developer,
**I want** a single API endpoint that returns today's article batch,
**so that** the feed page can fetch and display the current day's 20 articles with
one request.

**Acceptance Criteria**:
- Endpoint: `GET /api/feed/today`
- Returns an array of article objects matching the schema defined in FEED-002.
- Returns today's batch if it exists; falls back to the most recent available batch
  if today's has not yet been generated.
- Returns HTTP 200 with an empty array `[]` only if no batch exists at all (cold
  start scenario); never returns a 404 for a missing day.
- Response includes a `batchDate` field at the envelope level indicating which day's
  batch is being returned, so the UI can display "Today's digest" vs. "Yesterday's
  digest" accurately.
- The response is JSON.
- The endpoint does not require authentication.

---

### FEED-005 — Article Detail Endpoint

**As a** frontend developer,
**I want** an API endpoint that returns a single article by ID,
**so that** the in-app reading view can fetch the full article content without
passing all fields through client-side routing.

**Acceptance Criteria**:
- Endpoint: `GET /api/articles/[id]`
- Returns the full article object for the given ID.
- Returns HTTP 404 with a JSON error body if the article ID is not found.
- The endpoint does not require authentication.

---

## Group 3 — Feed UI

These stories cover the feed list page. They depend on Group 2.

---

### FEED-006 — Feed Page — Article Card List

**As a** user,
**I want** to open the app and immediately see a list of today's articles,
**so that** I can scan headlines and decide what I want to read.

**Acceptance Criteria**:
- The default route (`/`) renders the daily feed.
- The page fetches from `GET /api/feed/today` on load.
- Each article is displayed as a card showing: headline, source name, and description
  (if available).
- Cards are rendered in the order returned by the API; no client-side reordering.
- If the description is absent, the card renders without a description field (no
  "undefined" or empty string is shown).
- If `imageUrl` is present, the card displays it. If absent, no image or placeholder
  is shown.
- The number of cards displayed matches exactly the number of articles in the
  response (up to 20).
- The page is responsive and usable on both desktop viewport widths and mobile
  viewport widths (320px minimum).

---

### FEED-007 — Feed Page — Loading State

**As a** user,
**I want** to see a loading indicator while the feed is being fetched,
**so that** I know the app is working and I am not staring at a blank screen.

**Acceptance Criteria**:
- A loading state is displayed immediately on page load before the API response
  arrives.
- The loading state is visually distinct (skeleton cards, spinner, or similar — exact
  design is at developer discretion in v1).
- The loading state resolves to the article list on success.
- The loading state resolves to an error state on failure (see FEED-008).
- The transition between loading and loaded states does not cause layout shift that
  moves the user's scroll position.

---

### FEED-008 — Feed Page — Error State

**As a** user,
**I want** to see a clear message if the feed fails to load,
**so that** I understand something went wrong and the app has not just silently broken.

**Acceptance Criteria**:
- If the API call fails (network error or non-2xx response), an error message is
  displayed in place of the feed.
- The error message is human-readable (not a raw exception or stack trace).
- The error state offers a retry action (e.g., a "Try again" button that re-fetches).
- The error state does not show partially loaded content alongside the error.

---

### FEED-009 — Feed Page — Batch Date Label

**As a** user,
**I want** to see a label indicating which day's digest I am viewing,
**so that** I know whether I am looking at today's content or yesterday's because
today's has not been generated yet.

**Acceptance Criteria**:
- The feed page displays a label derived from the `batchDate` field in the API
  response envelope.
- If `batchDate` equals today's date: label reads "Today's Digest" (or equivalent).
- If `batchDate` is a prior date: label reads "Latest Digest — [human-readable date]"
  (or equivalent) to signal the content is not from today.
- The label is visible without scrolling (above the first article card).

---

## Group 4 — In-App Reading View

These stories cover the article detail page. They depend on Group 2.

---

### FEED-010 — Article Reading View — Layout and Content

**As a** user,
**I want** to tap an article card and read the article inside the app,
**so that** I can consume content without being immediately thrown to an external browser
tab.

**Acceptance Criteria**:
- Tapping or clicking any article card navigates to `/articles/[id]`.
- The reading view displays: headline, source name, published date, and body text.
- If `bodyText` is available, it is rendered as the primary content.
- If `bodyText` is unavailable, a message ("Full text not available — view the
  original source") is displayed in its place.
- The page is responsive at the same breakpoints as the feed page.
- The browser back button (or equivalent in-app back navigation) returns the user
  to the feed page.

---

### FEED-011 — Article Reading View — View Source Link

**As a** user,
**I want** a clear and easy way to open the original article source,
**so that** I can read the authoritative version, share it, or verify the content.

**Acceptance Criteria**:
- The reading view displays a "View Source" link (or equivalent) that opens
  `articleUrl` in a new browser tab.
- The link is visible without scrolling (pinned to a header/footer or placed
  prominently near the top of the article).
- The link is present regardless of whether `bodyText` is available or not.
- The link renders `sourceName` alongside or as part of its label so the user
  knows where they are going (e.g., "View on [Source Name]").
- Tapping the link does not navigate away from the reading view within the app.

---

## Group 5 — PWA and Baseline Quality

These stories are not UI features but are required for the app to meet its stated
platform targets and quality bar.

---

### FEED-012 — PWA Installability

**As a** user on mobile,
**I want** to install the app to my home screen like a native app,
**so that** I can launch the daily digest without opening a browser and navigating
to the URL.

**Acceptance Criteria**:
- The app has a valid `manifest.json` with name, short name, start URL, display
  mode (`standalone`), and at least one icon.
- A service worker is registered.
- Lighthouse PWA audit passes installability checks (no blocking failures).
- The app can be installed on iOS Safari and Android Chrome via their respective
  "Add to Home Screen" flows.

**Notes**: This story is a baseline for the PWA platform requirement. It does not
require offline support (that is a FUTURE story).

---

### FEED-013 — Mobile Responsive Layout

**As a** user on a mobile device,
**I want** the feed and reading view to be fully usable on a small screen,
**so that** I can read my daily digest from my phone without horizontal scrolling or
layout breakage.

**Acceptance Criteria**:
- Feed page and article reading view render correctly at 320px, 375px, and 390px
  viewport widths.
- No horizontal overflow or scrollbar appears at any of these widths.
- Tap targets (cards, links, buttons) are at least 44x44px per WCAG guidelines.
- Text is legible without zooming (minimum 16px body text on mobile).

---

## Future Stories (Out of Scope for v1)

The following are explicitly out of scope for this release. They are tracked here so
they are not forgotten and can be promoted to an active sprint when prerequisites are
met.

| ID | Story Summary | Prerequisite |
|----|---------------|--------------|
| FUTURE-001 | Like/dislike feedback controls on article cards | Feedback system BRD |
| FUTURE-002 | Source weighting and ranking based on feedback signals | FUTURE-001 |
| FUTURE-003 | Personalized article scoring and feed reordering | FUTURE-001, FUTURE-002 |
| FUTURE-004 | Source discovery driven by feedback (drop/add sources dynamically) | FUTURE-002 |
| FUTURE-005 | User accounts and saved preferences | Auth BRD |
| FUTURE-006 | Offline reading / article caching for offline use | Service worker expansion |
| FUTURE-007 | Push notifications for new daily digest | FUTURE-005 |
| FUTURE-008 | Search and filter by topic or category | Feed v2 |
| FUTURE-009 | Pull-to-refresh or mid-day manual refresh | Product decision required |
| FUTURE-010 | Article sharing (share sheet / copy link) | Feed v1 shipped |

---

## Story Summary Table

| ID | Title | Group | Priority |
|----|-------|-------|----------|
| FEED-001 | Daily Article Fetch Job | Content Pipeline | P0 |
| FEED-002 | Article Data Model | Content Pipeline | P0 |
| FEED-003 | Content Validation and Fallback | Content Pipeline | P0 |
| FEED-004 | Today's Feed Endpoint | Feed API | P0 |
| FEED-005 | Article Detail Endpoint | Feed API | P0 |
| FEED-006 | Feed Page — Article Card List | Feed UI | P0 |
| FEED-007 | Feed Page — Loading State | Feed UI | P0 |
| FEED-008 | Feed Page — Error State | Feed UI | P1 |
| FEED-009 | Feed Page — Batch Date Label | Feed UI | P1 |
| FEED-010 | Article Reading View — Layout and Content | Reading View | P0 |
| FEED-011 | Article Reading View — View Source Link | Reading View | P0 |
| FEED-012 | PWA Installability | PWA / Quality | P1 |
| FEED-013 | Mobile Responsive Layout | PWA / Quality | P0 |
