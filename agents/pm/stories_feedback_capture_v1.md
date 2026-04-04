# User Stories — Feedback Capture and Storage (v1)

**Milestone**: Milestone 2 — Feedback System (v2)
**Source BRD**: `agents/ba/requirements_feedback_capture_v1.md` (BRD-002)
**Last Updated**: 2026-04-04
**Maintained by**: PM Agent

---

## Overview

This document covers the five stories required to ship BRD-002: a client-side
like/dislike feedback system. Stories are ordered by dependency — the FeedbackStore
and FeedbackButtons stories must be complete before integration work begins.

Two open questions from BRD-002 are forwarded to the Architect:
- Visual treatment of active vs. inactive button states (color, fill, icon style)
- The localStorage key name and whether a migration path is needed if the schema
  changes before launch

Neither question blocks story writing or ordering, but both must be resolved in the
Architect's design doc before FB-002 is implemented.

---

## Dependency Order

```
FB-001 (FeedbackStore)
  └── FB-002 (FeedbackButtons)
        ├── FB-003 (Feed Card Integration)
        └── FB-004 (Article Detail Integration)

FB-005 (Persistence) — tests FB-001 end-to-end; depends on FB-001
```

Stories marked **PREREQUISITE** must be accepted before dependent stories begin.

---

## Stories

---

### FB-001 — Feedback Store Module

**PREREQUISITE** for FB-002 and FB-005.

**As a** user who has liked or disliked an article,
**I want** my feedback to be saved immediately on my device,
**so that** it is available the next time I open the app.

#### Acceptance Criteria

1. A client-side module (hook or utility) exists that other components can call to
   read, write, and clear feedback for a given article ID.
2. Reading feedback for an article returns `'like'`, `'dislike'`, or `undefined` (no
   feedback recorded).
3. Setting feedback for an article stores a record containing: `articleId`, `value`
   (`'like'` or `'dislike'`), and `updatedAt` (ISO-8601 timestamp).
4. Setting feedback on an article that already has feedback overwrites the existing
   record — only one record per article ID exists at any time.
5. Clearing feedback for an article removes its record entirely from the store. No
   record with a null value is left behind.
6. All records are stored in `localStorage` as a single JSON object keyed by
   `articleId`.
7. The module never reads from or writes to `data/batches/YYYY-MM-DD.json` or any
   server-side file.
8. The store key used in `localStorage` is a single defined constant; it is not
   hardcoded inline in multiple places.

---

### FB-002 — FeedbackButtons Component

**PREREQUISITE** for FB-003 and FB-004.
**Depends on**: FB-001.

**As a** user reading an article card or article detail page,
**I want** to see thumbs-up and thumbs-down buttons that reflect my current feedback
state,
**so that** I can give or change feedback with a single tap and immediately see the
result.

#### Acceptance Criteria

1. A reusable `FeedbackButtons` component exists that accepts an `articleId` prop.
2. The component displays two buttons: thumbs up and thumbs down. Both are always
   visible — they do not require hover, swipe, or any expand gesture.
3. On first render for an article with no feedback, both buttons are in their inactive
   state.
4. When the user taps thumbs up on an article with no feedback, the thumbs-up button
   becomes visually active and thumbs down remains inactive. Feedback is written to
   the store as `'like'`.
5. When the user taps thumbs down on an article with no feedback, the thumbs-down
   button becomes visually active and thumbs up remains inactive. Feedback is written
   to the store as `'dislike'`.
6. When the user taps the already-active button, both buttons return to their inactive
   state and the record is removed from the store (feedback cleared).
7. When the user taps the opposing button (e.g., taps thumbs down while thumbs up is
   active), the active state transfers to the tapped button and the store record is
   updated to the new value.
8. No toast, modal, snackbar, or confirmation message is shown after any feedback
   action. The button state change is the only acknowledgment.
9. The component does not modify or re-fetch article batch data. It reads and writes
   exclusively through the FeedbackStore module (FB-001).
10. The visual distinction between active and inactive button states is noticeable
    without relying on color alone (i.e., accessible to colorblind users). Exact
    treatment is defined by the Architect.

---

### FB-003 — Feedback Buttons on Feed Cards

**Depends on**: FB-002.

**As a** user browsing the feed,
**I want** thumbs-up and thumbs-down buttons on every article card,
**so that** I can give feedback without opening the article.

#### Acceptance Criteria

1. The `FeedbackButtons` component is rendered on every `ArticleCard` in the feed.
2. The buttons are always visible on the card — no interaction is required to reveal
   them.
3. The feedback button area does not interfere with tapping the card to open the
   article detail view. Tapping the card body (outside the buttons) still navigates
   to `/articles/[id]`.
4. On initial feed load, each card's feedback buttons reflect whatever state is
   already in the store for that article (persisted from a previous session if any).
5. The addition of feedback buttons does not break the existing card layout on mobile
   screen widths.

---

### FB-004 — Feedback Buttons on Article Detail View

**Depends on**: FB-002.

**As a** user reading an article,
**I want** thumbs-up and thumbs-down buttons on the article reading page,
**so that** I can give feedback after reading without going back to the feed.

#### Acceptance Criteria

1. The `FeedbackButtons` component is rendered on the `/articles/[id]` page.
2. The buttons are always visible on the page — no scroll position or interaction is
   required to reveal them.
3. The feedback state shown on the article detail page matches the state shown for the
   same article in the feed. If a user likes an article from the detail page and then
   navigates back to the feed, the card shows the thumbs-up as active.
4. Giving feedback from the detail page writes to the same store as giving feedback
   from the card — there is no separate or duplicate store.
5. The buttons render correctly on mobile screen widths without overlapping article
   content.

---

### FB-005 — Feedback Persists Across Sessions

**Depends on**: FB-001.

**As a** user who gave feedback in a previous session,
**I want** my feedback to still be there when I reopen the app,
**so that** I do not have to re-rate articles I have already evaluated.

#### Acceptance Criteria

1. After a user gives feedback on one or more articles and then closes the browser
   tab completely, reopening the app on the same device shows those articles with
   their feedback states intact (active thumb matches the recorded value).
2. After a hard page reload (`Cmd+R` / `Ctrl+R`), feedback states are restored
   correctly for all articles on the feed.
3. Feedback for an article that no longer appears in the current daily batch is
   retained in the store silently — it does not cause an error and does not surface
   in the UI (it simply has no card to render against).
4. No feedback record is lost or corrupted after normal browser operation. Feedback
   is only removed when the user explicitly clears it (taps the active button) or
   when they clear their browser's local storage manually.
5. This story is verified by manual test on at least one mobile browser (e.g., Safari
   on iOS or Chrome on Android) in addition to a desktop browser.

---

## Story Summary Table

| Story ID | Title | Priority | Depends On | Prerequisite For |
|----------|-------|----------|------------|-----------------|
| FB-001 | Feedback Store Module | P0 | — | FB-002, FB-005 |
| FB-002 | FeedbackButtons Component | P0 | FB-001 | FB-003, FB-004 |
| FB-003 | Feedback Buttons on Feed Cards | P0 | FB-002 | — |
| FB-004 | Feedback Buttons on Article Detail View | P0 | FB-002 | — |
| FB-005 | Feedback Persists Across Sessions | P0 | FB-001 | — |

All five stories are P0. None are deferrable — together they form the minimum
shippable slice of BRD-002.

---

## Out of Scope (This Milestone)

The following items appear in the roadmap but are explicitly deferred beyond this
stories document, consistent with BRD-002's Non-Goals:

- Source weighting based on feedback signals (FUTURE-002)
- Personalized feed reordering (FUTURE-003)
- Source discovery driven by feedback (FUTURE-004)
- User accounts or cross-device sync (Milestone 3)
