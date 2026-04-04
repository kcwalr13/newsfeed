# Dev Task List — Feed Personalization (Milestone 4)

**ID**: ARCH-TASKS-005
**Design Reference**: `agents/architect/design_feed_personalization_v1.md`
**Stories Reference**: `agents/pm/stories_feed_personalization_v1.md`
**Date**: 2026-04-04
**Status**: Not started — @agent-dev queued to implement PERS-TASK-001 through PERS-TASK-005 next session

---

## Dependency Order

```
PERS-TASK-001  (lib/pipeline/ranker.ts — pure rankFeed function)
  └── PERS-TASK-002  (GET /api/feed/today route update)
        └── PERS-TASK-003  (Integration verification — identity routing + new user path)
              └── PERS-TASK-004  (Edge-case verification — suppression, fallback, diversity cap)
                    └── PERS-TASK-005  (ARCHITECTURE.md update)
```

PERS-TASK-001 has no prerequisites — it is a pure module with no external
dependencies beyond the existing `Article` and `DbFeedbackRow` types.
PERS-TASK-002 requires PERS-TASK-001 to exist.
PERS-TASK-003 and PERS-TASK-004 are verification tasks that run after PERS-TASK-002.
PERS-TASK-005 is documentation and runs last.

---

## PERS-TASK-001 — Create lib/pipeline/ranker.ts

**[BLOCKER — prerequisite for PERS-TASK-002]**
**Covers stories**: PERS-001, PERS-002, PERS-003, PERS-004, PERS-005, PERS-007, PERS-010

### What to build

Create `lib/pipeline/ranker.ts` — a pure function module that takes an
unranked article list and a flat array of feedback rows and returns a ranked
article list. Zero DB calls, zero filesystem access, zero side effects inside
this module. All external data is passed as arguments.

### Files to create

| Action | Path |
|--------|------|
| Create | `lib/pipeline/ranker.ts` |

### Exported constants

```typescript
export const SUPPRESSION_MIN_EVENTS    = 5;
export const SUPPRESSION_DISLIKE_RATIO = 0.80;
export const EXPLORATION_SLOTS         = 3;
export const EXPLORATION_POSITIONS     = [2, 9, 16]; // 0-indexed
export const SOURCE_CONSECUTIVE_CAP    = 3;
export const MIN_FEED_ARTICLES         = 5;
```

### Exported function signature

```typescript
import type { Article } from '@/lib/types/article';
import type { DbFeedbackRow } from '@/lib/db/feedback';

export function rankFeed(
  articles: Article[],
  feedbackRows: DbFeedbackRow[]
): Article[]
```

### Internal helper signatures

```typescript
// Wilson score lower bound for a binomial proportion.
// Returns 0.5 when total === 0 (neutral, no feedback).
function wilsonLowerBound(likes: number, total: number): number

// Derives the source slug from a sourceName string, matching the makeId() logic in run.ts.
// s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
function slugify(name: string): string

// Post-processing pass: enforces no more than `cap` consecutive articles from the same source.
// Does not drop articles. Appends deferred articles at the end.
function applyDiversityCap(articles: Article[], cap: number): Article[]
```

### Algorithm — implement rankFeed in this exact order

**Step 1** — Build `sourceSlugMap: Map<string, string>` from article ID to
source slug. Derive slug using `slugify(article.sourceName)` to match the
`makeId()` function in `lib/pipeline/run.ts`.

**Step 2** — Aggregate feedback rows into per-source stats. Iterate
`feedbackRows`; for each row, look up the source slug in the batch via
`sourceSlugMap`. Skip rows whose `article_id` does not appear in the map
(feedback for articles not in today's batch — valid, just ignored). Accumulate
`likes`, `dislikes`, `total` per slug.

**Step 3** — Compute `sourceScores: Map<string, SourceStats>` for every
unique source slug present in the batch. Call `wilsonLowerBound(likes, total)`.
Set `suppressed = total >= SUPPRESSION_MIN_EVENTS && dislikes/total >= SUPPRESSION_DISLIKE_RATIO`.

**Step 4** — Sort non-suppressed articles by `(score DESC, publishedAt DESC)`.
This produces the primary ranked list.

**Step 5** — Identify exploration candidates: articles from sources where
`total === 0` (zero feedback events for that source) AND `!suppressed`.
Shuffle the pool of unique unseen source slugs randomly. Select at most
`EXPLORATION_SLOTS` distinct unseen sources. Pick the first (highest-scoring)
article from each selected unseen source as the exploration article for that
slot.

**Step 6** — All-sources-suppressed fallback: if the count of non-suppressed
articles is less than `MIN_FEED_ARTICLES`, append articles from suppressed
sources sorted by their Wilson score descending (least-disliked first) until
the total reaches `MIN_FEED_ARTICLES`.

**Step 7** — Remove the selected exploration articles from the ranked list
(they will be inserted at fixed positions).

**Step 8** — Insert exploration articles at `EXPLORATION_POSITIONS` (0-indexed).
Process positions in ascending order. For each position, if an exploration
article is available, splice it in. If no exploration article remains for a
position (fewer unseen sources than `EXPLORATION_SLOTS`), skip the splice and
the ranked article at that position stays.

**Step 9** — Apply `applyDiversityCap(output, SOURCE_CONSECUTIVE_CAP)`.

**Step 10** — Return the final article array.

### Acceptance criteria

- [ ] `lib/pipeline/ranker.ts` is created and exports `rankFeed` and all six constants.
- [ ] `rankFeed(articles, [])` (empty feedback) returns articles sorted by `publishedAt` descending. No articles dropped.
- [ ] `rankFeed` with all-like feedback for one source places that source's articles first.
- [ ] `rankFeed` with 5+ dislikes at ≥80% ratio suppresses that source (no articles from it in output, unless fallback).
- [ ] With fewer than 4 events, a source with all dislikes is NOT suppressed.
- [ ] Exploration articles appear at 0-indexed positions 2, 9, 16 in the output when three unseen sources are present.
- [ ] If zero unseen sources, no exploration slots and no empty positions in output.
- [ ] If all sources are suppressed, output contains at least `MIN_FEED_ARTICLES` articles (from least-disliked suppressed sources).
- [ ] No more than 3 consecutive articles from the same source in any output.
- [ ] Diversity cap does not reduce total article count.
- [ ] Running `rankFeed` twice with the same `articles` and `feedbackRows` (and same random seed for exploration, or mocked) produces the same result for the scored ranking portion.
- [ ] `npx tsc --noEmit` passes with no new type errors.

---

## PERS-TASK-002 — Update GET /api/feed/today Route

**[BLOCKER — prerequisite for PERS-TASK-003]**
**Covers stories**: PERS-006, PERS-007, PERS-008, PERS-009, PERS-010, PERS-011
**Prerequisites**: PERS-TASK-001

### What to build

Update `app/api/feed/today/route.ts` to:
1. Resolve identity from cookies (`dd_session` → user_id, else `dd_device_id`).
2. Fetch feedback rows from the DB using existing helpers.
3. Call `rankFeed` with the batch articles and feedback rows.
4. Return the ranked articles in the `FeedResponse` envelope.
5. Degrade gracefully if the DB call fails (return unranked batch, log error).
6. Copy the refreshed session cookie from `resolveSession` onto the final response.

### Files to modify

| Action | Path |
|--------|------|
| Modify | `app/api/feed/today/route.ts` |

### Implementation

Replace the existing `GET` handler body with:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { readBatch, readLatestBatch } from '@/lib/pipeline/storage';
import { resolveSession } from '@/lib/auth/session';
import { getFeedbackForUser, getFeedbackForDevice, DbFeedbackRow } from '@/lib/db/feedback';
import { rankFeed } from '@/lib/pipeline/ranker';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const today = new Date().toISOString().slice(0, 10);
  const batch = readBatch(today) ?? readLatestBatch();

  if (!batch) {
    return NextResponse.json(
      { batchDate: '', articles: [] },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // Create a temporary response object so resolveSession can attach a
  // refreshed Set-Cookie header to it. We will copy that header to the
  // final response.
  const tempRes = new NextResponse();
  let feedbackRows: DbFeedbackRow[] = [];
  let setCookieHeader: string | null = null;

  try {
    const session = await resolveSession(req, tempRes);
    setCookieHeader = tempRes.headers.get('Set-Cookie');

    if (session) {
      feedbackRows = await getFeedbackForUser(session.userId);
    } else {
      const deviceId = req.cookies.get('dd_device_id')?.value;
      if (deviceId) {
        feedbackRows = await getFeedbackForDevice(deviceId);
      }
    }
  } catch (err) {
    console.error('[feed/today] identity/feedback fetch failed, returning unranked:', err);
    return NextResponse.json(
      { batchDate: batch.batchDate, articles: batch.articles },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const rankedArticles = rankFeed(batch.articles, feedbackRows);

  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (setCookieHeader) headers['Set-Cookie'] = setCookieHeader;

  return NextResponse.json(
    { batchDate: batch.batchDate, articles: rankedArticles },
    { headers }
  );
}
```

### Acceptance criteria

- [ ] `GET /api/feed/today` with no cookies returns unranked articles (same as before).
- [ ] `GET /api/feed/today` with a valid `dd_session` cookie calls `getFeedbackForUser` (not `getFeedbackForDevice`) and returns ranked articles.
- [ ] `GET /api/feed/today` with no session but a valid `dd_device_id` cookie calls `getFeedbackForDevice` and returns ranked articles.
- [ ] If the DB query throws an error, the route returns the unranked batch with HTTP 200 (no 500 error).
- [ ] Response shape is unchanged: `{ batchDate: string, articles: Article[] }`.
- [ ] The `dd_session` refreshed cookie from `resolveSession` is present on the response `Set-Cookie` header when a session exists.
- [ ] `npx tsc --noEmit` passes.
- [ ] `curl -s http://localhost:3000/api/feed/today | jq '.articles | length'` returns 20 (or available count).

---

## PERS-TASK-003 — Integration Verification: Identity Routing and New User Path

**Covers stories**: PERS-008, PERS-009, PERS-010
**Prerequisites**: PERS-TASK-002

### What to verify

This is a manual verification task. No new code is written. Confirm
end-to-end behavior across the three identity cases.

### Verification steps

**Case A — New / anonymous user with no feedback**

1. Clear all cookies in the browser (or use a fresh incognito window).
2. Load `GET /api/feed/today` directly.
3. Confirm: response is `{ batchDate, articles: [...] }` with 20 articles in
   publication-date order (no personalization applied). No errors.
4. Confirm the response is identical to the raw batch file on disk.

**Case B — Anonymous user with device feedback history**

1. Using a device that has liked/disliked several articles (at least 5 from
   one source), call `GET /api/feed/today` with the `dd_device_id` cookie set.
2. Confirm: articles from the liked source appear near the top of the response.
3. Confirm: `dd_session` cookie is absent from the response (no auth).

**Case C — Authenticated user**

1. Log in with a test account that has feedback history associated with its
   `user_id`.
2. Call `GET /api/feed/today` with the `dd_session` cookie present.
3. Confirm: articles are ranked according to the account-level feedback, not
   the device's feedback.
4. Confirm: `dd_session` cookie is refreshed in the response (`Set-Cookie`
   header present with updated `Max-Age`).

**Case D — Authenticated user on new device**

1. Log in with the test account from Case C on a device with no prior
   `dd_device_id` feedback history.
2. Confirm: feed is ranked by account-level feedback, not the new device's
   empty history.

### Acceptance criteria

- [ ] Case A: unranked feed returned, no errors, response matches batch file.
- [ ] Case B: liked source articles appear at top of feed.
- [ ] Case C: account-level ranking applied, session cookie refreshed.
- [ ] Case D: account-level ranking applied on new device immediately after login.
- [ ] All four cases return HTTP 200 with valid `FeedResponse` shape.

---

## PERS-TASK-004 — Edge-Case Verification: Suppression, Fallback, Diversity Cap

**Covers stories**: PERS-003, PERS-004, PERS-005, PERS-007, PERS-011
**Prerequisites**: PERS-TASK-002

### What to verify

This is a manual verification task with optional unit test construction.
Verify the edge cases of the ranking algorithm by calling `rankFeed` directly
with crafted inputs, or by seeding the database and calling the API.

### Verification steps

**Suppression test**

1. Create or simulate a device that has disliked 5+ articles from source
   `bbc-news` (≥80% dislike ratio for that source).
2. Call `rankFeed(batchArticles, feedbackRows)` where `feedbackRows` contains
   those dislike records.
3. Confirm: no articles with `sourceName === 'BBC News'` appear in the output.

**Suppression not triggered at low event count**

1. Create feedback rows with 4 dislikes from one source (below `SUPPRESSION_MIN_EVENTS = 5`).
2. Call `rankFeed`.
3. Confirm: that source's articles still appear in the output.

**All-sources-suppressed fallback**

1. Construct `feedbackRows` that triggers suppression for every source in the
   batch (≥5 events each, ≥80% dislikes each).
2. Call `rankFeed`.
3. Confirm: output contains ≥ `MIN_FEED_ARTICLES` (5) articles, drawn from the
   least-disliked suppressed sources.
4. Confirm: output is not empty.

**Exploration slot placement**

1. Construct `feedbackRows` that covers all-but-one source (so exactly one
   source has zero feedback).
2. Call `rankFeed`.
3. Confirm: articles from the unseen source appear at 0-indexed positions 2, 9,
   and/or 16 (positions that fall within the output length). Since only one
   unseen source, at most one exploration slot is filled; remaining exploration
   positions contain ranked articles.

**Source diversity cap**

1. Construct a batch and `feedbackRows` where one source has a very high score
   and many articles (e.g., a batch with 8 articles from the same source, all
   with high scores).
2. Call `rankFeed`.
3. Confirm: no more than 3 consecutive articles in the output come from that
   source. Confirm total article count is unchanged.

**Feedback-after-cutoff (PERS-011)**

1. Give a like or dislike to an article via `POST /api/feedback` after the
   pipeline has run for today.
2. Call `GET /api/feed/today`.
3. Confirm: today's feed reflects the feedback (because `GET /api/feed/today`
   ranks at request time using the current feedback state — new feedback is
   immediately incorporated into the next call's ranking).
4. Note: this is actually *better* than the PM's stated requirement (which only
   required feedback to affect tomorrow's feed). API-time ranking means feedback
   is reflected on the next page load. Document this as expected behavior.

### Acceptance criteria

- [ ] A source with ≥5 events and ≥80% dislikes is absent from the output.
- [ ] A source with <5 events is never suppressed, regardless of dislike ratio.
- [ ] Fallback produces non-empty feed when all sources are suppressed.
- [ ] Exploration articles appear at positions 2, 9, 16 (0-indexed) when unseen sources exist.
- [ ] Diversity cap produces no more than 3 consecutive same-source articles.
- [ ] Diversity cap never drops articles (total count preserved).
- [ ] Feedback given after pipeline run is reflected in the next `GET /api/feed/today` call.

---

## PERS-TASK-005 — Update ARCHITECTURE.md

**Covers stories**: (documentation)
**Prerequisites**: PERS-TASK-003, PERS-TASK-004

### What to update

Update `agents/architect/ARCHITECTURE.md` with the Milestone 4 additions.

### Files to modify

| Action | Path |
|--------|------|
| Modify | `agents/architect/ARCHITECTURE.md` |

### Changes

**1. Add to Repository Structure** under `lib/pipeline/`:

```
│   │   ├── ranker.ts             ← Feed personalization ranker (pure function)
```

**2. Add to Key Architectural Decisions table**:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Feed personalization | API-time ranking in `rankFeed()` | Avoids per-identity batch file proliferation; ranking is O(20 articles) in memory; single shared batch on disk unchanged; graceful DB failure degrades to unranked feed |

**3. Add to Design Documents table**:

| Milestone | Design Doc | Task List |
|-----------|-----------|-----------|
| Milestone 4 — Feed Personalization | `agents/architect/design_feed_personalization_v1.md` | `agents/architect/tasks_feed_personalization_v1.md` |

**4. Add to "What Has Been Built" table** (status: Not started):

| Layer | Status | Notes |
|-------|--------|-------|
| Feed ranker module (`lib/pipeline/ranker.ts`) | **Not started** | PERS-TASK-001 |
| Personalized `GET /api/feed/today` route | **Not started** | PERS-TASK-002 |
| Integration + edge-case verification | **Not started** | PERS-TASK-003, PERS-TASK-004 |
| ARCHITECTURE.md Milestone 4 update | **Not started** | PERS-TASK-005 |

**5. Update changelog**:

```
| 2026-04-04 | Architect Agent | Milestone 4 design complete. API-time feed personalization. Wilson score lower bound scoring. One new module (ranker.ts), one modified route (feed/today). 5 tasks, all Not started. |
```

### Acceptance criteria

- [ ] `Key Architectural Decisions` table includes the personalization row.
- [ ] `Design Documents` table includes Milestone 4 row with correct paths.
- [ ] `What Has Been Built` table includes 4 new Milestone 4 rows, all "Not started".
- [ ] `Repository Structure` shows `ranker.ts` under `lib/pipeline/`.
- [ ] Changelog entry dated 2026-04-04 added.
- [ ] `npx tsc --noEmit` passes (ARCHITECTURE.md is not TypeScript, but verify no regressions).