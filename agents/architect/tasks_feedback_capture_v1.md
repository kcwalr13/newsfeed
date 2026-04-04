# Dev Task List — Feedback Capture v1

**ID**: ARCH-TASKS-002
**Design Reference**: `agents/architect/design_feedback_capture_v1.md`
**Stories Reference**: `agents/pm/stories_feedback_capture_v1.md`
**Date**: 2026-04-04
**Status**: FB-TASK-001 through FB-TASK-005 complete. FB-TASK-006 pending manual verification.

---

## Dependency Order

```
FB-TASK-001 (Types)
  └── FB-TASK-002 (FeedbackStore module)
        └── FB-TASK-003 (FeedbackButtons component)
              ├── FB-TASK-004 (ArticleCard refactor + feed integration)
              └── FB-TASK-005 (Article detail integration)
                    ↓
              FB-TASK-006 (Manual persistence verification)
```

Work top-to-bottom. Do not start a task until all tasks above it in its chain are complete.

---

## FB-TASK-001 — Add FeedbackRecord and FeedbackStore types

**[BLOCKER — prerequisite for all other tasks]**
**Covers story**: FB-001 (partial — types only)

### What to build

Add two new exported types to `lib/types/article.ts`. No other changes to that file.

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

### Files to modify

| Action | Path |
|--------|------|
| Modify | `lib/types/article.ts` — append after the `Source` interface |

### Acceptance criteria

- [x] `FeedbackRecord` is exported from `lib/types/article.ts` with `value` and `updatedAt` fields.
- [x] `FeedbackStore` is exported as `Record<string, FeedbackRecord>`.
- [x] All existing types (`Article`, `FeedResponse`, `ArticleBatch`, `Source`) are unchanged.
- [x] `npx tsc --noEmit` passes with no new errors.

---

## FB-TASK-002 — FeedbackStore module

**[BLOCKER — prerequisite for FB-TASK-003]**
**Covers story**: FB-001 (complete)
**Prerequisites**: FB-TASK-001

### What to build

Create `lib/feedback/store.ts` — a pure TypeScript utility module with no React
dependencies. The only place in the codebase that reads from or writes to
`localStorage` for feedback.

### Files to create

| Action | Path |
|--------|------|
| Create | `lib/feedback/store.ts` |

### API surface

```typescript
export const FEEDBACK_STORE_KEY = 'dd_feedback';

export function getFeedback(articleId: string): 'like' | 'dislike' | undefined
export function setFeedback(articleId: string, value: 'like' | 'dislike'): void
export function clearFeedback(articleId: string): void
export function getAllFeedback(): FeedbackStore
```

### Implementation requirements

- All functions guard `typeof window === 'undefined'` — return safe defaults
  (`undefined`, no-op, `{}`) in SSR contexts. Never throw.
- JSON parse errors on the localStorage value are caught and treated as `{}`.
- `setFeedback` sets `updatedAt` to `new Date().toISOString()`.
- `clearFeedback` uses `delete store[articleId]` and writes the whole object back.
  Never writes a null value.
- No imports from `react`, `next`, or any server-side module.

### Acceptance criteria

- [x] `getFeedback('unknown-id')` returns `undefined` when the store is empty.
- [x] After `setFeedback('abc', 'like')`, `getFeedback('abc')` returns `'like'`.
- [x] After `setFeedback('abc', 'like')` then `setFeedback('abc', 'dislike')`, `getFeedback('abc')` returns `'dislike'`.
- [x] After `setFeedback('abc', 'like')` then `clearFeedback('abc')`, `getFeedback('abc')` returns `undefined`.
- [x] `getAllFeedback()` returns an object keyed by `articleId` with `FeedbackRecord` values.
- [x] The localStorage key used everywhere is `FEEDBACK_STORE_KEY` (`'dd_feedback'`).
- [x] The module does not import from `react`, `next`, or any server-side module.
- [x] `npx tsc --noEmit` passes with no new errors.

---

## FB-TASK-003 — FeedbackButtons component

**[BLOCKER — prerequisite for FB-TASK-004 and FB-TASK-005]**
**Covers story**: FB-002
**Prerequisites**: FB-TASK-002

### What to build

Create `app/components/FeedbackButtons.tsx` as a `'use client'` component.

### Files to create

| Action | Path |
|--------|------|
| Create | `app/components/FeedbackButtons.tsx` |

### Props

```typescript
interface Props {
  articleId: string;
}
```

### Behavior

- On mount (`useEffect`), read `getFeedback(articleId)` and set local state.
  Do NOT initialise state from localStorage in the `useState` call — this causes
  SSR hydration mismatches.
- Always render both buttons. No hover, expand, or swipe required.
- Tap inactive like → `setFeedback(articleId, 'like')`, update state.
- Tap inactive dislike → `setFeedback(articleId, 'dislike')`, update state.
- Tap active button → `clearFeedback(articleId)`, set state to `null`.
- No toast, modal, or confirmation. Button state change is the only acknowledgment.

### Visual treatment

| State | Like button | Dislike button |
|-------|-------------|----------------|
| Neither active | Outlined icon, `text-gray-400`, no background | Outlined icon, `text-gray-400`, no background |
| Like active | Filled icon, `text-white`, `bg-green-600` | Outlined icon, `text-gray-400`, no background |
| Dislike active | Outlined icon, `text-gray-400`, no background | Filled icon, `text-white`, `bg-rose-600` |

Tailwind classes per button:
- Inactive: `rounded-full p-2 text-gray-400 hover:bg-gray-100 transition-colors`
- Like active: `rounded-full p-2 text-white bg-green-600`
- Dislike active: `rounded-full p-2 text-white bg-rose-600`

Minimum touch target: `min-h-[44px] min-w-[44px]` on each button.
Wrapper: `flex items-center gap-1`.

### Accessibility

- `aria-label="Like this article"` on like button
- `aria-label="Dislike this article"` on dislike button
- `aria-pressed={feedback === 'like'}` on like button
- `aria-pressed={feedback === 'dislike'}` on dislike button
- SVG icons: `aria-hidden="true"`

Use inline SVG for thumbs-up and thumbs-down. Outlined (inactive) variant:
`fill="none" stroke="currentColor"`. Filled (active) variant: `fill="currentColor"`.

### Acceptance criteria

- [x] Both buttons render on initial load with no interaction required.
- [x] With no feedback in store, both buttons render in inactive style.
- [x] Clicking like sets like to active, dislike remains inactive.
- [x] Clicking dislike sets dislike to active, like remains inactive.
- [x] Clicking the active button returns both to inactive; store record is removed.
- [x] Clicking the opposing button while one is active swaps the active state.
- [x] `aria-pressed` reflects the current state on each button.
- [x] Clicking either button does NOT cause page navigation.
- [x] `npx tsc --noEmit` passes with no new errors.

---

## FB-TASK-004 — ArticleCard refactor and feed integration

**Covers story**: FB-003
**Prerequisites**: FB-TASK-003

### What to build

Refactor `app/components/ArticleCard.tsx` to fix the nested-button problem and
integrate `FeedbackButtons`.

**Current structure** (invalid after adding feedback):
```
<button onClick={onClick}>   ← entire card is a button
  ...content...
</button>
```

**Target structure**:
```
<div className="...card border/bg/rounded styles...">
  <button onClick={onClick} className="w-full text-left p-4 ...focus styles...">
    {/* image, sourceName, title, description */}
  </button>
  <div className="px-4 pb-3 flex justify-end">
    <FeedbackButtons articleId={article.id} />
  </div>
</div>
```

- The outer `<div>` carries visual card styles (border, background, rounded corners).
- The inner `<button>` carries the navigation hit area and hover/focus ring styles.
- `FeedbackButtons` is a sibling of the inner button, not a child.
- No change to Props interface — `onClick` remains optional.

### Files to modify

| Action | Path |
|--------|------|
| Modify | `app/components/ArticleCard.tsx` |

### Acceptance criteria

- [x] Every article card in the feed renders two feedback buttons, always visible.
- [x] Tapping the card body (title, description, image) triggers `onClick` / navigates.
- [x] Tapping either feedback button does NOT trigger navigation.
- [x] No `<button>` is nested inside another `<button>` in the rendered HTML.
- [x] Feedback state persisted from a prior session is reflected on page load.
- [x] Card layout is not broken at 375px viewport width.
- [x] `npx tsc --noEmit` passes with no new errors.

---

## FB-TASK-005 — Article detail page integration

**Covers story**: FB-004
**Prerequisites**: FB-TASK-003

### What to build

Add `FeedbackButtons` to `app/articles/[id]/page.tsx`. The page remains an async
Server Component — do NOT add `'use client'` to the page file. Next.js handles
the client boundary at the `FeedbackButtons` component level.

Placement: below the `<h1>` title, above body text.

```tsx
<h1 className="text-2xl font-bold text-gray-900 leading-snug mb-4">
  {article.title}
</h1>
<div className="mb-6">
  <FeedbackButtons articleId={article.id} />
</div>
{/* existing body text or fallback */}
```

### Files to modify

| Action | Path |
|--------|------|
| Modify | `app/articles/[id]/page.tsx` |

### Acceptance criteria

- [x] `FeedbackButtons` renders on the article detail page, visible without scrolling on mobile.
- [x] Feedback state on the detail page matches the state for the same article in the feed.
- [x] Giving feedback from the detail page is reflected when navigating back to the feed.
- [x] The page remains an async Server Component (`async function ArticlePage` unchanged).
- [x] Layout is not broken at 375px viewport width.
- [x] `npx tsc --noEmit` passes with no new errors.

---

## FB-TASK-006 — Manual persistence verification

**Covers story**: FB-005
**Prerequisites**: FB-TASK-004, FB-TASK-005

This is a verification task, not a code task. Run the checklist and fix any
failures by opening bugs against the relevant upstream task before closing this one.

### Checklist

- [ ] Like two articles and dislike one from the feed. All three cards show the correct active state.
- [ ] Hard reload (`Cmd+R`). All three states are restored.
- [ ] Close the tab completely, reopen the app. All three states are restored.
- [ ] Open the article detail view for a liked article. Like button is active.
- [ ] Change feedback to dislike from the detail view. Navigate back. Card shows dislike active.
- [ ] Click the active dislike button on a card. Both buttons return to inactive.
- [ ] Reload. The cleared article shows both buttons inactive.
- [ ] Repeat all steps on a mobile browser (Safari iOS or Chrome Android).

### Acceptance criteria

- [ ] All checklist items pass on desktop (Chrome or Firefox).
- [ ] All checklist items pass on mobile (Safari iOS or Chrome Android).

---

## Task Summary

| Task | Story | Depends On | Creates | Modifies |
|------|-------|------------|---------|----------|
| FB-TASK-001 | FB-001 | — | — | `lib/types/article.ts` |
| FB-TASK-002 | FB-001 | FB-TASK-001 | `lib/feedback/store.ts` | — |
| FB-TASK-003 | FB-002 | FB-TASK-002 | `app/components/FeedbackButtons.tsx` | — |
| FB-TASK-004 | FB-003 | FB-TASK-003 | — | `app/components/ArticleCard.tsx` |
| FB-TASK-005 | FB-004 | FB-TASK-003 | — | `app/articles/[id]/page.tsx` |
| FB-TASK-006 | FB-005 | FB-TASK-004 + 005 | — | — |
