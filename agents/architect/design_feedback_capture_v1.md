# Technical Design — Feedback Capture v1

**ID**: ARCH-DESIGN-002
**Stories Reference**: PM-STORIES-002 (FB-001 through FB-005)
**Date**: 2026-04-04
**Status**: Draft
**Author**: Architect Agent

---

## Table of Contents

1. Architecture Overview
2. localStorage Schema
3. TypeScript Type Additions
4. FeedbackStore Module
5. FeedbackButtons Component
6. ArticleCard Refactor
7. Feed Page Integration
8. Article Detail Page Integration
9. Open Questions — Resolved
10. Deferred Items

---

## 1. Architecture Overview

Feedback capture is entirely client-side. No new API routes are required. No
server-side files are touched. No changes are made to `data/batches/`.

The existing system architecture gains one new module and one new component:

```
localStorage
    ↕  (read/write)
lib/feedback/store.ts               ← new: pure storage module
    ↑  (called by)
app/components/FeedbackButtons.tsx  ← new: 'use client' component
    ↑  (rendered by)
app/components/ArticleCard.tsx      ← modified: card layout refactored
app/articles/[id]/page.tsx          ← modified: FeedbackButtons added
```

The `Article.feedbackSlot` field is NOT written at fetch time. It remains
`undefined` in every Article object that comes from the API. At render time,
components read directly from the FeedbackStore, not from `article.feedbackSlot`.
The `feedbackSlot` field continues to be reserved for a future milestone where
it may be used differently. Batch files are never modified.

No migration path is needed for the localStorage schema in this milestone. If the
schema changes before launch the Dev agent will add a migration step at that time.

---

## 2. localStorage Schema

### Key constant

```
FEEDBACK_STORE_KEY = 'dd_feedback'
```

Short, prefixed with the app namespace (`dd_` for the original "Daily Digest" brand), unlikely to
collide with other libraries. Defined once in `lib/feedback/store.ts` and never
hardcoded elsewhere.

### Record shape

```typescript
interface FeedbackRecord {
  value: 'like' | 'dislike';
  updatedAt: string; // ISO-8601 timestamp
}
```

The `articleId` is the key in the top-level object, not a field inside the record.
This enables O(1) lookup and update by article ID.

### Full example

Key: `dd_feedback`

Value (JSON-serialised string):
```json
{
  "bbc-news-a1b2c3d4": {
    "value": "like",
    "updatedAt": "2026-04-04T10:22:00.000Z"
  },
  "ars-technica-e5f6a7b8": {
    "value": "dislike",
    "updatedAt": "2026-04-04T11:05:33.412Z"
  }
}
```

When a record is cleared, the key for that `articleId` is deleted from the object
and the object is re-serialised. No key with a `null` value is ever written.

When no feedback has been recorded, the entry either does not exist or contains
`{}`. Both are treated identically.

---

## 3. TypeScript Type Additions

Add to `lib/types/article.ts`:

```typescript
/** A single feedback record stored per article in localStorage. */
export interface FeedbackRecord {
  /** The feedback value. */
  value: 'like' | 'dislike';
  /** ISO-8601 timestamp of the last set or change operation. */
  updatedAt: string;
}

/**
 * The full shape of the localStorage value stored under FEEDBACK_STORE_KEY.
 * Keys are article IDs.
 */
export type FeedbackStore = Record<string, FeedbackRecord>;
```

No change to `Article.feedbackSlot`. It already has the right type and continues
to be absent from all batch-fetched Article objects.

---

## 4. FeedbackStore Module

**File**: `lib/feedback/store.ts`

Pure TypeScript utility module, no React dependencies. The only place in the
codebase that reads from or writes to localStorage for feedback.

### API surface

```typescript
export const FEEDBACK_STORE_KEY = 'dd_feedback';

export function getFeedback(articleId: string): 'like' | 'dislike' | undefined
export function setFeedback(articleId: string, value: 'like' | 'dislike'): void
export function clearFeedback(articleId: string): void
export function getAllFeedback(): FeedbackStore
```

### Implementation requirements

- All functions guard `typeof window === 'undefined'` and return safe defaults
  (undefined, no-op, {}) in SSR contexts.
- JSON parse errors on the localStorage value are caught and treated as `{}`.
- `setFeedback` sets `updatedAt` to `new Date().toISOString()`.
- `clearFeedback` uses `delete store[articleId]` and writes back — never writes null.

### No React hook wrapper in this milestone

`FeedbackButtons` calls store functions directly. A hook abstraction is the right
extraction point when multiple components need to share reactive feedback state —
that arrives in Milestone 3 (personalization).

---

## 5. FeedbackButtons Component

**File**: `app/components/FeedbackButtons.tsx`
**Directive**: `'use client'`

### Props

```typescript
interface Props {
  articleId: string;
}
```

### State

```typescript
const [feedback, setFeedbackState] = useState<'like' | 'dislike' | null>(null);
```

Initialised via `useEffect` (not `useState` initialiser) to avoid SSR hydration
mismatches. The `useEffect` runs only after mount:

```typescript
useEffect(() => {
  setFeedbackState(getFeedback(articleId) ?? null);
}, [articleId]);
```

### Interaction logic

```
handleLike():
  if feedback === 'like':  clearFeedback(articleId); setFeedbackState(null)
  else:                    setFeedback(articleId, 'like'); setFeedbackState('like')

handleDislike():
  if feedback === 'dislike':  clearFeedback(articleId); setFeedbackState(null)
  else:                       setFeedback(articleId, 'dislike'); setFeedbackState('dislike')
```

### Visual treatment (resolved)

Active state = filled icon + accent background. Inactive = outlined icon +
transparent background. Two visual dimensions change (icon fill + background),
satisfying colorblind-accessibility without relying on hue alone.

| State | Like button | Dislike button |
|-------|-------------|----------------|
| Neither active | Outlined icon, `text-gray-400`, `bg-transparent` | Outlined icon, `text-gray-400`, `bg-transparent` |
| Like active | Filled icon, `text-white`, `bg-green-600` | Outlined icon, `text-gray-400`, `bg-transparent` |
| Dislike active | Outlined icon, `text-gray-400`, `bg-transparent` | Filled icon, `text-white`, `bg-rose-600` |

Minimum touch target: `min-h-[44px] min-w-[44px]` on each button.

**Tailwind classes**:
- Inactive: `rounded-full p-2 text-gray-400 hover:bg-gray-100 transition-colors`
- Like active: `rounded-full p-2 text-white bg-green-600`
- Dislike active: `rounded-full p-2 text-white bg-rose-600`

### Accessibility

- `aria-label="Like this article"` / `"Dislike this article"`
- `aria-pressed={feedback === 'like'}` / `aria-pressed={feedback === 'dislike'}`
- SVG icons: `aria-hidden="true"`

No toast, snackbar, or confirmation. The button state change is the only
acknowledgment.

---

## 6. ArticleCard Refactor

**File**: `app/components/ArticleCard.tsx`

**Problem**: The current card is a single `<button>`. Placing `FeedbackButtons`
(which contains `<button>` elements) inside it produces nested buttons — invalid
HTML that breaks keyboard and tap behavior.

**Solution**: Replace the outer `<button>` with a `<div>` carrying card visual
styles. The content area (image, title, description) becomes an inner `<button>`
for navigation. The feedback row is a sibling `<div>` below it, outside the
navigation hit area.

```
<div className="...card border/rounded/bg styles...">
  <button onClick={onClick} className="w-full text-left p-4">
    {/* image, sourceName, title, description */}
  </button>
  <div className="px-4 pb-3 flex justify-end">
    <FeedbackButtons articleId={article.id} />
  </div>
</div>
```

No change to the Props interface. `onClick` remains optional.

---

## 7. Feed Page Integration

**File**: `app/page.tsx`
**Change required**: None.

`ArticleCard` internally renders `FeedbackButtons` with `article.id`. The feed
page does not need to know about feedback. Each `FeedbackButtons` instance reads
its own key from localStorage on mount — no bulk read or prop-passing required
at the feed level. At n=20 articles/day this is not a performance concern.

---

## 8. Article Detail Page Integration

**File**: `app/articles/[id]/page.tsx`

The page remains an async Server Component. `FeedbackButtons` is `'use client'`;
Next.js handles the boundary automatically. No `'use client'` directive is added
to the page file.

Placement: below the `<h1>`, above the body text — visible without scrolling.

```tsx
<h1 className="text-2xl font-bold text-gray-900 leading-snug mb-4">
  {article.title}
</h1>
<div className="mb-6">
  <FeedbackButtons articleId={article.id} />
</div>
{/* body text or fallback */}
```

---

## 9. Open Questions — Resolved

**Q1: Visual treatment of active/inactive states**
Active = filled icon + accent background (`bg-green-600` like, `bg-rose-600`
dislike). Two visual dimensions change. See section 5.

**Q2: localStorage key constant**
`dd_feedback`. Single exported constant in `lib/feedback/store.ts`. No version
suffix this milestone — add migration step at point of need.

---

## 10. Deferred Items

| Item | Reason |
|------|--------|
| `useFeedback` hook | Not needed until multiple components share reactive state |
| Bulk store read at feed page level | No measurable perf issue at n=20; revisit if needed |
| Schema versioning / migration | No planned schema changes before launch |
| Source weighting from feedback | FUTURE-002, downstream of Milestone 2 |
| Feed reordering from feedback | FUTURE-003, downstream of Milestone 2 |
| Cross-device sync | Milestone 3 (requires accounts) |
