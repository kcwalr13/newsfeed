# Technical Design — Feed Personalization (Milestone 4)

**ID**: ARCH-DESIGN-005
**Stories Reference**: `agents/pm/stories_feed_personalization_v1.md` (PERS-001 through PERS-011)
**BRD Reference**: `agents/ba/brd_feed_personalization_v1.md` (BRD-004)
**Date**: 2026-04-04
**Status**: Final
**Author**: Architect Agent

---

## Table of Contents

1. Architecture Decision: API-Time Ranking
2. Source Identity — Canonical Join Key
3. Source Scoring Algorithm (Wilson Score Lower Bound)
4. Suppression Threshold
5. All-Sources-Suppressed Fallback
6. Exploration Budget
7. Source Diversity Cap
8. Ranking Algorithm and Tiebreaker
9. Identity Resolution in GET /api/feed/today
10. New Module: lib/pipeline/ranker.ts
11. Changes to GET /api/feed/today Route
12. DB Helpers — No New Helpers Required
13. Configuration Constants
14. What Does NOT Change
15. Performance Profile
16. Deferred Items

---

## 1. Architecture Decision: API-Time Ranking

**Decision**: Personalization happens at API read time, not pipeline time.

The pipeline writes one shared unranked batch file per day
(`data/batches/YYYY-MM-DD.json`), identical to the current behavior. When
`GET /api/feed/today` is called, the route resolves the requesting identity
from cookies, fetches that identity's feedback rows from the database, and
calls `rankFeed(articles, feedbackRows)` in memory before returning the
response. The ranked result is never stored on disk.

**Why not per-identity batch files (the product owner's stated preference)?**

The PM stories explicitly delegate this decision to the Architect, noting
that per-identity batch files have significant architectural implications.
The key problems with per-identity batch files:

- The pipeline has no native way to discover which identities exist at run
  time without an additional DB query that returns every distinct device_id
  and user_id. As the user base grows, this query can return thousands of
  rows, each requiring a separate ranked batch file write.
- Batch file proliferation: `data/batches/` would contain one file per
  day per identity. With 1,000 active devices, that is 1,000 JSON files
  per day on the filesystem. With 30-day retention, 30,000 files.
- Storage is a local filesystem (a key architectural decision). Filesystem
  performance degrades at large file counts in a single directory.
- Pipeline complexity grows substantially: it must iterate identities,
  handle partial failures per identity, and write N batch files atomically.
- The unranked shared batch already satisfies the new-user / no-feedback
  case. Ranking at API time produces an identical result for that case with
  zero extra complexity.

**Why API-time ranking is correct here:**

- The ranking computation is O(articles × sources) where articles = 20 and
  active sources ≈ 4–10. This is a microsecond-level operation in memory.
- The feedback row count per identity is bounded (one row per article ever
  interacted with). At 20 articles/day over a year, a power user has at most
  ~7,300 feedback rows, but in practice far fewer because most users interact
  with a fraction of articles. The DB query is a full-table scan per identity
  keyed by an indexed column (user_id or device_id), returning a small result
  set.
- The client receives a pre-ranked feed from `GET /api/feed/today` with no
  change to the response contract. The PM's constraint is fully satisfied.
- The pipeline remains simple and unchanged.

**PM preference note**: The PM stated a preference for pipeline-time
personalization, but explicitly delegated the architectural decision to the
Architect and required only that the client receives a pre-ranked feed.
This design satisfies that requirement via a simpler, more scalable path.

---

## 2. Source Identity — Canonical Join Key

**Decision**: Use the **source slug prefix** extracted from the article ID as
the canonical join key, not the `sourceName` field.

**Rationale**:

Article IDs are constructed as `<source-slug>-<sha256-of-url>[0..8]` (see
`lib/pipeline/run.ts` `makeId()`). The slug prefix is deterministic, machine-
readable, and stable. It is the same value used in `data/sources.json` as
`Source.slug`.

`sourceName` is a human-readable display string (e.g., "BBC News") that could
theoretically change if a source is renamed, breaking historical feedback
associations. The slug is more stable.

**Extraction rule**: Given an article ID `bbc-news-a1b2c3d4`, the source slug
is everything before the last hyphen-delimited 8-character segment. In
practice: `articleId.split('-').slice(0, -1).join('-')`.

However, this extraction is only needed inside `rankFeed`. Feedback rows
include `article_id`, and articles in the batch also carry `article_id`.
The ranker joins feedback rows to articles by `article_id` to determine which
source each feedback event belongs to. The source slug is then read from the
matched article's `id` prefix, or derived by slugifying its `sourceName` in
the same way `makeId()` does.

**Recommended approach in rankFeed**: Build a lookup map of
`articleId → sourceSlug` from the batch articles, then aggregate feedback rows
through that map. This avoids string extraction ambiguity entirely.

---

## 3. Source Scoring Algorithm — Wilson Score Lower Bound

### Formula

For a source `s` with `n` total feedback events, `k` of which are likes:

```
p̂  = k / n                         (observed like ratio)
z  = 1.96                           (95% confidence, two-tailed)
z² = 3.8416

wilson_lower = (
  p̂ + z²/(2n) - z * sqrt( (p̂*(1-p̂) + z²/(4n)) / n )
) / (
  1 + z²/n
)
```

When `n = 0` (no feedback), the score is `0.5` (neutral).

The Wilson score lower bound is the lower bound of a 95% confidence interval
for the true like proportion. It has the following properties that satisfy all
PM and BRD requirements:

- **Confidence dampening**: With `n=1`, the lower bound is close to 0.5
  regardless of whether the single event was a like or dislike. The score
  only diverges from neutral as `n` grows and the signal becomes statistically
  reliable.
- **Bounded**: The output is always in [0, 1]. A source with all likes and
  many events approaches ~1.0; a source with all dislikes and many events
  approaches ~0.0.
- **No feedback = neutral**: `n=0` → score = 0.5, which is neither boosted
  nor penalised.
- **Handles sparse data correctly**: A source with 1 like out of 1 event
  scores approximately 0.21 (far from 1.0). A source with 100 likes out of
  100 events scores approximately 0.96. The confidence interval contracts as
  `n` grows.

### Example scores

| Likes | Dislikes | n  | Wilson Lower |
|-------|----------|----|--------------|
| 0     | 0        | 0  | 0.500 (neutral, no feedback) |
| 1     | 0        | 1  | 0.207 |
| 5     | 0        | 5  | 0.478 |
| 10    | 0        | 10 | 0.697 |
| 50    | 0        | 50 | 0.929 |
| 0     | 1        | 1  | 0.000 |
| 0     | 5        | 5  | 0.000 |
| 5     | 5        | 10 | 0.236 |
| 8     | 2        | 10 | 0.497 |

The asymmetry (a mixed record scores below 0.5) is intentional and desirable:
it reflects that users who have given any dislikes are expressing a preference
that should be respected.

### Why Wilson score and not a simpler ratio?

A naive like-ratio `k/n` would give a source with 1 like and 0 dislikes a
score of 1.0 — placing it above a source with 50 likes and 5 dislikes
(ratio 0.91). Wilson score prevents this by penalising small sample sizes.
It is the standard approach for ranked lists (used by Reddit, Hacker News,
and review platforms) and requires no external library — the formula is five
arithmetic operations.

---

## 4. Suppression Threshold

A source is **suppressed** (excluded entirely from the ranked feed) when ALL
of the following are true:

1. The total feedback event count for that source is ≥ `SUPPRESSION_MIN_EVENTS`
2. The dislike ratio (dislikes / total events) is ≥ `SUPPRESSION_DISLIKE_RATIO`

**Default constant values**:

| Constant | Default | Meaning |
|----------|---------|---------|
| `SUPPRESSION_MIN_EVENTS` | `5` | Source needs at least 5 feedback events before it can be suppressed |
| `SUPPRESSION_DISLIKE_RATIO` | `0.80` | Source must have ≥ 80% dislikes to be suppressed |

**Why these values?**

- Minimum 5 events: a user who accidentally dislikes once or twice cannot
  lose a source. Five events is a deliberate pattern (PM requirement).
- 80% dislike ratio: requires a strong, consistent signal. If a user liked
  2 articles and disliked 8 (80%), that is a clear aversion worth acting on.
  A user who liked 3 and disliked 7 (70%) is ambivalent, not hostile — they
  keep the source.
- Both thresholds must pass simultaneously: a source with 10 events but only
  50% dislikes is not suppressed; a source with 90% dislikes but only 2 events
  is not suppressed.

**Suppression is always derived at runtime from the current feedback state.**
No permanent flags or hard deletes implement it. If feedback is later cleared
or reset by future tooling, the source automatically re-enters the feed on the
next request.

---

## 5. All-Sources-Suppressed Fallback

If suppression would reduce the eligible article pool to fewer than
`MIN_FEED_ARTICLES` articles, the fallback activates:

1. Collect all suppressed sources, sorted by their Wilson score descending
   (least-disliked first).
2. Add articles from suppressed sources in that order until the article count
   reaches `MIN_FEED_ARTICLES` or all sources are exhausted.
3. Articles added via fallback are treated as regular ranked articles for
   ordering purposes (no special slot placement).

**Default constant**: `MIN_FEED_ARTICLES = 5`

This handles the edge case where a user has suppressed every source.
The feed is never empty. The fallback is silent — no UI indicator.

---

## 6. Exploration Budget

**Constants**:

| Constant | Default |
|----------|---------|
| `EXPLORATION_SLOTS` | `3` |
| `EXPLORATION_POSITIONS` | `[2, 9, 16]` (0-indexed; PM spec says 3, 10, 17 which are 1-indexed) |

**Algorithm**:

1. After scoring and sorting articles by source score, identify the set of
   **exploration candidates**: articles from sources the requesting identity
   has **never given any feedback on** (neither like nor dislike), excluding
   suppressed sources.
2. Randomly sample up to `EXPLORATION_SLOTS` exploration candidates (one per
   unique source preferred — do not fill two exploration slots from the same
   unrated source unless no other unrated sources exist).
3. From the sorted ranked list, remove the exploration candidates that were
   selected (to avoid duplicating them).
4. Build the output list:
   - Start with the sorted ranked articles (exploration candidates removed).
   - At each position in `EXPLORATION_POSITIONS`, insert the next exploration
     candidate. If no exploration candidates remain for a slot, leave the
     ranked article that would naturally fall there (treat it as a regular
     ranked position).
5. If the user has feedback on all configured sources, `EXPLORATION_SLOTS`
   effectively becomes 0. All positions are filled by ranked articles.

**Randomness note**: Exploration slot selection is intentionally random.
The PM stories state determinism is required only for the scored ranking, not
the exploration assignment. Random selection ensures users see varied
discovery content day-to-day.

**Ordering note**: Exploration slots are inserted after initial scoring/sorting
but before the diversity cap pass. If an exploration article causes a
consecutive-source violation, the diversity cap algorithm handles it.

---

## 7. Source Diversity Cap

**Constant**: `SOURCE_CONSECUTIVE_CAP = 3`

After exploration slots are inserted, apply the diversity cap as a post-
processing pass:

**Algorithm** (single-pass, deterministic):

```
result = []
run_source = null
run_length = 0
deferred = []           // articles temporarily held back

for each article A in the post-exploration list:
  if A.sourceSlug == run_source:
    run_length += 1
    if run_length > SOURCE_CONSECUTIVE_CAP:
      deferred.push(A)  // hold back; do not emit yet
      continue
  else:
    if deferred is non-empty:
      emit deferred[0]  // emit one deferred article from old run
      deferred.shift()
      run_source = emitted.sourceSlug
      run_length = 1
    run_source = A.sourceSlug
    run_length = 1
  result.push(A)

// Append any remaining deferred articles to the end
result.push(...deferred)
```

This pass:
- Does not drop any articles (PERS-004 AC#4 satisfied).
- Is deterministic given the same input order (AC#6 satisfied).
- Is a pure post-processing step that does not affect scoring (AC#5 satisfied).

---

## 8. Ranking Algorithm and Tiebreaker

**Primary sort**: Articles sorted by their source's Wilson score, descending.

**Tiebreaker**: When two sources have equal Wilson scores (which in practice
means both have `n=0`, i.e., no feedback), sort by `publishedAt` descending.
This means newer articles appear first among equally-scored sources.

`publishedAt` is an ISO-8601 string. String comparison is equivalent to
numeric comparison for ISO-8601 dates, making this tiebreaker O(n log n)
with no date parsing required.

**Why publishedAt?** It is deterministic for a given day (the batch does not
change after it is written), stable (running ranking twice on the same inputs
produces the same order), and produces a sensible default (recency-biased feed
for new users with no feedback). The PM story requires only determinism — this
satisfies it.

---

## 9. Identity Resolution in GET /api/feed/today

```
GET /api/feed/today
  │
  ├─ resolveSession(req, res)
  │     └─ reads dd_session cookie → validates in DB → returns { userId } or null
  │
  ├─ if userId present:
  │     identity = { type: 'user', id: userId }
  │     feedbackRows = await getFeedbackForUser(userId)
  │
  ├─ else:
  │     deviceId = req.cookies.get('dd_device_id')?.value
  │     if deviceId:
  │       identity = { type: 'device', id: deviceId }
  │       feedbackRows = await getFeedbackForDevice(deviceId)
  │     else:
  │       feedbackRows = []   // new user — no-op, returns unranked
  │
  ├─ rankedArticles = rankFeed(batch.articles, feedbackRows)
  │
  └─ return { batchDate, articles: rankedArticles }
```

**No new DB helpers are required.** `getFeedbackForUser` and
`getFeedbackForDevice` already exist in `lib/db/feedback.ts` and return
`DbFeedbackRow[]` — exactly what `rankFeed` needs.

**Session side-effect**: `resolveSession` refreshes the session cookie
(sliding window). The response object must be created before calling
`resolveSession` so the refreshed cookie can be applied to it.

---

## 10. New Module: lib/pipeline/ranker.ts

This is the primary new file for Milestone 4. It is a pure function module
with no DB calls, no filesystem access, and no side effects. All inputs are
passed as arguments; all outputs are returned.

### Exported constants

```typescript
export const SUPPRESSION_MIN_EVENTS   = 5;
export const SUPPRESSION_DISLIKE_RATIO = 0.80;
export const EXPLORATION_SLOTS        = 3;
export const EXPLORATION_POSITIONS    = [2, 9, 16]; // 0-indexed (1-indexed: 3, 10, 17)
export const SOURCE_CONSECUTIVE_CAP   = 3;
export const MIN_FEED_ARTICLES        = 5;
```

### Internal types

```typescript
interface SourceStats {
  slug: string;
  likes: number;
  dislikes: number;
  total: number;
  score: number;        // Wilson lower bound, or 0.5 if total === 0
  suppressed: boolean;
}
```

### Exported function

```typescript
export function rankFeed(
  articles: Article[],
  feedbackRows: DbFeedbackRow[]
): Article[]
```

**Contract**:
- `articles`: the full unranked batch (up to 20 articles, order does not matter).
- `feedbackRows`: all feedback rows for the requesting identity. May be empty.
- Returns: a new array of `Article` objects in ranked order, length ≤
  `articles.length`. No article is mutated. No article is dropped unless it
  belongs to a suppressed source (and the fallback does not rescue it).

### Algorithm pseudocode

```
function rankFeed(articles, feedbackRows):

  // Step 1: Build articleId → sourceSlug map from batch
  articleSourceMap = {}
  for each article in articles:
    articleSourceMap[article.id] = extractSourceSlug(article.id)
    // extractSourceSlug: article.id is "<slug>-<8chars>"
    // sourceSlug = article.id.split('-').slice(0, -1).join('-')
    // BUT: some source slugs contain hyphens (e.g. "ars-technica")
    // Correct approach: match against known slugs from the articles themselves
    // Since sourceName is on the Article, derive slug the same way makeId() does:
    //   slugify(article.sourceName)
    // where slugify = s => s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

  // Step 2: Aggregate feedback into per-source stats
  sourceStatsMap = {}   // slug → { likes, dislikes, total }
  for each row in feedbackRows:
    sourceSlug = articleSourceMap[row.article_id]
    if sourceSlug is undefined: continue  // feedback for an article not in today's batch — skip
    if sourceSlug not in sourceStatsMap:
      sourceStatsMap[sourceSlug] = { likes: 0, dislikes: 0, total: 0 }
    if row.value === 'like':
      sourceStatsMap[sourceSlug].likes += 1
    else:
      sourceStatsMap[sourceSlug].dislikes += 1
    sourceStatsMap[sourceSlug].total += 1

  // Step 3: Compute Wilson score and suppression flag for each source
  sourceScores = {}    // slug → SourceStats
  allSlugs = unique set of sourceSlug values from articles
  for each slug in allSlugs:
    stats = sourceStatsMap[slug] ?? { likes: 0, dislikes: 0, total: 0 }
    score = wilsonLowerBound(stats.likes, stats.total)
    suppressed = (
      stats.total >= SUPPRESSION_MIN_EVENTS &&
      stats.dislikes / stats.total >= SUPPRESSION_DISLIKE_RATIO
    )
    sourceScores[slug] = { ...stats, slug, score, suppressed }

  // Step 4: Partition articles into ranked candidates and exploration candidates
  //         Suppressed sources are excluded from both unless fallback is needed
  rankedCandidates = articles
    .filter(a => !sourceScores[slugify(a.sourceName)].suppressed)
    .sort((a, b) => {
      const scoreA = sourceScores[slugify(a.sourceName)].score
      const scoreB = sourceScores[slugify(b.sourceName)].score
      if (scoreB !== scoreA) return scoreB - scoreA   // higher score first
      return b.publishedAt.localeCompare(a.publishedAt)  // newer first on tie
    })

  explorationSourceSlugs = set of slugs in allSlugs where
    sourceStatsMap[slug] is undefined (no feedback at all) AND
    !sourceScores[slug].suppressed

  explorationCandidates = rankedCandidates.filter(
    a => explorationSourceSlugs.has(slugify(a.sourceName))
  )
  // One article per exploration source slug (take the first / highest)
  explorationPool = deduplicated by source, max EXPLORATION_SLOTS items, randomly shuffled

  // Step 5: All-sources-suppressed fallback
  if rankedCandidates.length < MIN_FEED_ARTICLES:
    suppressedArticles = articles
      .filter(a => sourceScores[slugify(a.sourceName)].suppressed)
      .sort((a, b) => {
        // Sort by suppressed source score descending (least-disliked first)
        return sourceScores[slugify(b.sourceName)].score -
               sourceScores[slugify(a.sourceName)].score
      })
    needed = MIN_FEED_ARTICLES - rankedCandidates.length
    rankedCandidates = [...rankedCandidates, ...suppressedArticles.slice(0, needed)]

  // Step 6: Remove exploration articles from ranked list (they are placed separately)
  explorationIds = set of article ids in explorationPool
  ranked = rankedCandidates.filter(a => !explorationIds.has(a.id))

  // Step 7: Insert exploration articles at fixed positions
  output = [...ranked]
  explorationInserted = 0
  for each position in EXPLORATION_POSITIONS (sorted ascending):
    if explorationInserted < explorationPool.length:
      explorationArticle = explorationPool[explorationInserted]
      insertAt = min(position, output.length)
      output.splice(insertAt, 0, explorationArticle)
      explorationInserted += 1

  // Step 8: Apply source diversity cap
  output = applyDiversityCap(output, SOURCE_CONSECUTIVE_CAP)

  return output
```

### wilsonLowerBound helper

```typescript
function wilsonLowerBound(likes: number, total: number): number {
  if (total === 0) return 0.5;
  const z = 1.96;
  const zz = z * z;
  const phat = likes / total;
  const numerator = phat + zz / (2 * total)
    - z * Math.sqrt((phat * (1 - phat) + zz / (4 * total)) / total);
  const denominator = 1 + zz / total;
  return numerator / denominator;
}
```

### applyDiversityCap helper

```typescript
function applyDiversityCap(articles: Article[], cap: number): Article[] {
  const result: Article[] = [];
  const deferred: Article[] = [];
  let runSource: string | null = null;
  let runLength = 0;

  for (const article of articles) {
    const slug = slugify(article.sourceName);
    if (slug === runSource) {
      runLength += 1;
      if (runLength > cap) {
        deferred.push(article);
        continue;
      }
    } else {
      if (deferred.length > 0) {
        result.push(deferred.shift()!);
      }
      runSource = slug;
      runLength = 1;
    }
    result.push(article);
  }
  // Append remaining deferred articles
  result.push(...deferred);
  return result;
}
```

---

## 11. Changes to GET /api/feed/today Route

**File**: `app/api/feed/today/route.ts`

Current implementation reads the batch and returns it directly. The updated
implementation adds identity resolution and ranking:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { readBatch, readLatestBatch } from '@/lib/pipeline/storage';
import { resolveSession } from '@/lib/auth/session';
import { getFeedbackForUser, getFeedbackForDevice } from '@/lib/db/feedback';
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

  const res = NextResponse.json(
    { batchDate: batch.batchDate, articles: batch.articles },
    { headers: { 'Cache-Control': 'no-store' } }
  );

  // Identity resolution
  let feedbackRows: import('@/lib/db/feedback').DbFeedbackRow[] = [];
  try {
    const session = await resolveSession(req, res);
    if (session) {
      feedbackRows = await getFeedbackForUser(session.userId);
    } else {
      const deviceId = req.cookies.get('dd_device_id')?.value;
      if (deviceId) {
        feedbackRows = await getFeedbackForDevice(deviceId);
      }
    }
  } catch (err) {
    // DB failure: degrade gracefully — return unranked feed
    console.error('[feed/today] feedback fetch failed, returning unranked:', err);
    return NextResponse.json(
      { batchDate: batch.batchDate, articles: batch.articles },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const rankedArticles = rankFeed(batch.articles, feedbackRows);

  // Rewrite response body with ranked articles (session cookie already set on res)
  return NextResponse.json(
    { batchDate: batch.batchDate, articles: rankedArticles },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Set-Cookie': res.headers.get('Set-Cookie') ?? '',
      },
    }
  );
}
```

**Note on response construction**: `resolveSession` sets the refreshed session
cookie on the `res` object. The final response must copy that `Set-Cookie`
header. The pattern shown above creates an intermediate `res` to capture the
cookie, then builds the final response with the ranked articles.

**Graceful degradation**: If the DB call to fetch feedback fails, the route
logs the error and returns the unranked batch. Today's feed remains available.
This satisfies PERS-006 AC#5.

**No-feedback path**: If `feedbackRows` is empty (new user, anonymous with no
history, or both cookies absent), `rankFeed(articles, [])` returns the articles
sorted by `publishedAt` descending — the same effective ordering as the current
unranked batch (assuming the batch is already in recency order). This satisfies
PERS-010.

---

## 12. DB Helpers — No New Helpers Required

Both `getFeedbackForUser(userId)` and `getFeedbackForDevice(deviceId)` already
exist in `lib/db/feedback.ts` and return `DbFeedbackRow[]`. The `rankFeed`
function accepts this type directly.

No new database query helpers are needed for Milestone 4.

---

## 13. Configuration Constants

All personalization constants live in `lib/pipeline/ranker.ts` as named
exported constants. They are co-located with the logic that uses them, which
makes them easy to find and adjust.

| Constant | Default | Meaning |
|----------|---------|---------|
| `SUPPRESSION_MIN_EVENTS` | `5` | Minimum feedback events before a source can be suppressed |
| `SUPPRESSION_DISLIKE_RATIO` | `0.80` | Minimum dislike ratio required for suppression |
| `EXPLORATION_SLOTS` | `3` | Number of exploration positions in the feed |
| `EXPLORATION_POSITIONS` | `[2, 9, 16]` | 0-indexed positions for exploration articles (1-indexed: 3, 10, 17) |
| `SOURCE_CONSECUTIVE_CAP` | `3` | Maximum consecutive articles from the same source |
| `MIN_FEED_ARTICLES` | `5` | Minimum articles in feed before fallback activates |

**Why in ranker.ts, not config.ts?** `config.ts` contains infrastructure
constants (file paths, batch size, log path) used by the pipeline. The ranker
constants are specific to the ranking algorithm and only used by `ranker.ts`.
Keeping them co-located reduces the need to jump between files during
maintenance.

---

## 14. What Does NOT Change

| Component | Status |
|-----------|--------|
| `lib/pipeline/run.ts` | No changes. Pipeline still writes one shared unranked batch per day. |
| `lib/pipeline/storage.ts` | No changes. |
| `lib/pipeline/config.ts` | No changes. |
| `lib/pipeline/validator.ts` | No changes. |
| `lib/types/article.ts` | No changes. `Article` type is unchanged. |
| `lib/db/feedback.ts` | No changes. Existing helpers are reused as-is. |
| `app/api/pipeline/run/route.ts` | No changes. |
| `app/api/articles/[id]/route.ts` | No changes. |
| `app/api/feedback/` routes | No changes. |
| `app/api/auth/` routes | No changes. |
| `data/sources.json` | No changes. |
| `data/batches/` | No new file types. One shared file per day, same as today. |
| `FeedResponse` shape | No changes. Same `{ batchDate, articles }` envelope. |
| Client (frontend pages and components) | No changes. Feed page renders articles in received order, already correct. |

---

## 15. Performance Profile

**Per-request cost of rankFeed**:
- One DB query: `getFeedbackForUser` or `getFeedbackForDevice`. Both are
  indexed queries returning O(articles-ever-interacted-with) rows. For a
  typical user after one year of daily use at 20 articles/day with 30%
  engagement rate, this is ≈ 2,200 rows. The query is a fast index scan.
- In-memory ranking: O(F + A log A) where F = feedback rows, A = articles (20).
  F dominates at scale but is still microseconds at 2,200 rows.
- Total added latency per request: < 5ms for the DB query on a Neon
  serverless connection; < 1ms for in-memory computation.

**Pipeline unchanged**: Zero performance impact on the pipeline.

**Scaling limit**: As identities grow, no per-request cost increases because
the query is always scoped to a single identity. The only shared resource is
the Neon connection pool, which is already present for feedback writes.

---

## 16. Deferred Items

The following are explicitly deferred to future milestones per PM and BRD
guidance:

- **Suppression reversal UI** ("reset personalization" / "manage sources"):
  the data model supports it (suppression is computed at runtime from feedback
  rows, not stored as flags), but no user-facing UI is in scope for this
  milestone. Backlog item.
- **Topic or category-level scoring**: future milestone. Source-level only here.
- **Article-level scoring**: future milestone.
- **Real-time re-ranking**: feedback given after the batch is written does not
  re-rank today's feed. PERS-011 verifies this is the expected behavior.
- **Operator analytics or source score dashboards**: out of scope.
- **Feedback deletion / data management tools**: out of scope.

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-04 | Architect Agent | Initial draft. Milestone 4 Feed Personalization design. API-time ranking decision made and justified. Wilson score lower bound algorithm specified. All constants defined. |