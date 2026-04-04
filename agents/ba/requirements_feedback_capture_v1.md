# BRD-002: Feedback Capture and Storage

| Field | Value |
|-------|-------|
| **ID** | BRD-002 |
| **Title** | Feedback Capture and Storage |
| **Date** | 2026-04-04 |
| **Status** | Resolved |
| **Milestone** | Milestone 2 — Feedback System (v2) |

---

## Problem Statement

Daily Digest currently shows the same feed to every user with no way to signal what
is interesting or irrelevant. Without capturing explicit feedback, the app cannot
improve over time. This BRD closes the first gap in that loop: giving users a way
to record a like or dislike on any article, and ensuring that signal is durably
stored on the device so it is available when personalization is introduced in a
later milestone.

The `feedbackSlot` field already exists in the `Article` type — it was reserved
for exactly this purpose. This BRD defines what the user experience looks like and
where the data lives. It does not define how feedback is used to reorder the feed.

---

## Goals

- Users can record a like or dislike on any article card directly from the feed.
- Feedback is reversible: a user can change a like to a dislike (or vice versa), or
  clear their feedback entirely.
- The current feedback state for each article is visible when the user returns to
  the feed (the selected thumb stays highlighted).
- Feedback is stored per-device, without requiring an account.
- Feedback records are kept separate from the daily batch files; they must not
  modify `data/batches/YYYY-MM-DD.json`.
- The stored feedback record contains the minimum information needed to support
  future personalization: article ID, feedback value, and a timestamp.
- Feedback survives a page reload and a full browser close/reopen on the same
  device.

---

## Non-Goals

The following are explicitly deferred to future BRDs and must not be included in
this milestone:

- **Personalization and feed reordering** — using feedback to change the order or
  composition of the feed is a separate future BRD (see FUTURE-002 and FUTURE-003
  in the roadmap).
- **Source or topic weighting** — aggregating feedback signals to score sources or
  categories is out of scope here.
- **User accounts** — there are no accounts; feedback is per-device only. Cross-
  device sync is not addressed here.
- **Analytics or reporting** — no dashboards or aggregate views of feedback data.
- **Feedback on the article detail view** — ~~deferred~~ **included**: feedback controls appear on both the article card in the feed and on the article reading view (`/articles/[id]`). See Decisions below.
- **Server-side feedback storage** — no server endpoint is required to receive or
  persist feedback. Storage is client-side in this milestone.

---

## User-Facing Behavior

### Where feedback appears

Feedback controls appear in two places:
1. On each article card in the feed — always visible, no hover or expand required.
2. On the article reading view (`/articles/[id]`) — always visible alongside the
   article content.

Both surfaces share the same underlying feedback state for a given article. Giving
feedback from either location updates the same record.

### Tapping a feedback button

- If no feedback has been given for that article, tapping thumbs up marks it as
  liked. Tapping thumbs down marks it as disliked. The tapped button becomes
  visually active (highlighted or filled); the other button remains inactive.
- If the user taps the already-active button a second time, the feedback is cleared
  and both buttons return to their inactive state.
- If the user taps the opposing button (e.g., taps thumbs down when thumbs up is
  active), the feedback switches to the new value. The previously active button
  deactivates; the newly tapped button activates.

### Persistence across sessions

When the user closes and reopens the app (or reloads the page), each article card
reflects the feedback state that was previously recorded. There is no "undo" prompt
or confirmation — feedback changes take effect immediately on tap.

### No account required

The app does not prompt the user to sign in. Feedback is silently stored on the
device. No notification, toast, or confirmation is shown after a feedback action
(the button state change is the only acknowledgment).

---

## Data Requirements

### What to store per feedback record

A minimal feedback record must contain:

| Field | Description |
|-------|-------------|
| `articleId` | The article's `id` value (e.g., `bbc-news-a1b2c3d4`) |
| `value` | `'like'` or `'dislike'` |
| `updatedAt` | ISO-8601 timestamp of when the feedback was last set or changed |

No other article metadata (title, source, URL, etc.) needs to be duplicated in the
feedback store. The article ID is sufficient to join back to the article if needed.

### Granularity

Feedback is recorded at the individual article level. There is no rollup into
source-level or topic-level signals in this milestone — that aggregation is
downstream work.

### What "cleared" feedback looks like in storage

When a user clears their feedback (taps the active button a second time), the
record for that article should be removed entirely from the store rather than kept
with a null value. The absence of a record means "no feedback given."

---

## Persistence Requirements

### Storage location

Feedback must be stored in the browser's `localStorage` on the client device. This
satisfies the per-device, no-account requirement and survives page reloads and
browser restarts without any server infrastructure.

### Storage format

All feedback records for a device are stored together as a single JSON object keyed
by `articleId`. This allows O(1) lookup by article ID when rendering cards.

Example shape (illustrative, not prescriptive for implementation):

```
{
  "bbc-news-a1b2c3d4": { "value": "like",    "updatedAt": "2026-04-04T10:22:00Z" },
  "ars-technica-e5f6a7b8": { "value": "dislike", "updatedAt": "2026-04-04T11:05:00Z" }
}
```

### Relationship to batch files

Feedback records must never be written into `data/batches/YYYY-MM-DD.json`. The
batch files are server-side, append-only, and shared across all users of a given
deployment. Feedback is purely client-side.

The `feedbackSlot` field on the `Article` type is already reserved for this purpose.
At read time (when the feed is rendered), the UI layer merges the device's stored
feedback into the article objects before display. The batch files themselves remain
unchanged.

### Durability expectations

`localStorage` persistence is sufficient for this milestone. There is no expectation
of backup, export, or recovery. If a user clears their browser data, their feedback
history is lost — this is acceptable at this stage of the product.

### Storage limits

There is no cap on the number of feedback records. Feedback is intended to be
cumulative over time — the full history is the signal. Over many months at 20
articles/day, the total record count remains well within `localStorage` capacity
(a few hundred KB at most). Old feedback records are never pruned; they accumulate
indefinitely to build the richest possible personalization signal over time.

---

## Decisions (Resolved 2026-04-04)

1. **Feedback on article detail view**: Yes — thumbs up/down appear on both the
   feed card and the `/articles/[id]` reading view. Both surfaces share the same
   feedback state for a given article.

2. **Always visible**: Thumbs buttons are visible at all times on both surfaces.
   No hover, swipe, or expand gesture required.

3. **No pruning, ever**: Old feedback records are never pruned. Feedback accumulates
   indefinitely. The full history is valuable — it builds an increasingly rich
   personalization signal over time.

4. **No storage cap**: There is no limit on how many feedback records can accumulate
   in localStorage.

## Open Questions

1. **Visual design of active/inactive states**: The BRD specifies that tapped
   buttons become "visually active" but does not prescribe colors or iconography.
   The PM and designer should confirm the intended treatment (e.g., filled vs.
   outlined icons, color change) before the Architect specifies components.

2. **Feedback store key in localStorage**: Should the localStorage key be a fixed
   constant (e.g., `dd_feedback`) or namespaced by app version? Implementation
   detail, but if the schema may change before launch the Architect should build in
   a migration path.

---

## Related Documents

| Document | Location |
|----------|----------|
| Roadmap (Milestone 2) | `agents/pm/roadmap.md` |
| Article type definition | `lib/types/article.ts` |
| System architecture | `agents/architect/ARCHITECTURE.md` |
| Prior BRD (article feed) | `agents/ba/requirements_article_feed_v1.md` |
