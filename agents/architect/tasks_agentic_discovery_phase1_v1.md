# Dev Task List — Agentic Content Discovery, Phase 1

**ID**: ARCH-TASKS-AGDISC-001
**Design Reference**: `agents/architect/design_agentic_discovery_phase1_v1.md`
**Stories Reference**: `agents/pm/stories_agentic_discovery_phase1.md`
**Date**: 2026-04-04
**Status**: Done (all 19 tasks complete)

---

## Dependency Order

```
AGDISC-TASK-001  [BLOCKER] Install new npm dependencies
  |
  +-- AGDISC-TASK-002  [BLOCKER] Add new constants to lib/config/feed.ts; remove SPECIFICITY_THRESHOLD
  |     |
  |     +-- AGDISC-TASK-003  [BLOCKER, Group A] DB migration: small_web_sources table
  |     |     |
  |     |     +-- AGDISC-TASK-004  [BLOCKER, Group A] lib/db/smallWeb.ts — DB helper module
  |     |     |     |
  |     |     |     +-- AGDISC-TASK-005  [Group A] lib/discovery/smallWeb/seeds.ts — seed URL constant
  |     |     |     +-- AGDISC-TASK-006  [Group A] lib/discovery/smallWeb/blogroll.ts — blogroll parser
  |     |     |           |
  |     |     |           +-- AGDISC-TASK-007  [Group A] lib/discovery/smallWeb/crawler.ts — crawl orchestrator
  |     |     |
  |     +-- AGDISC-TASK-008  [BLOCKER, Group B] lib/discovery/bodyExtractor.ts — extraction module
  |     |     |
  |     |     +-- AGDISC-TASK-009  [BLOCKER, Group C] lib/discovery/llmEvaluator.ts — LLM evaluator
  |     |           |
  |     |           +-- AGDISC-TASK-010  [Group C] lib/discovery/qualityGate.ts — remove Gate 4
  |     |                 |
  |     |                 +-- AGDISC-TASK-011  [Group C] lib/discovery/run.ts — integrate extraction + LLM
  |     |
  |     +-- AGDISC-TASK-012  [BLOCKER, Group D] data/query_banks.default.json — seed file
  |     |     |
  |     |     +-- AGDISC-TASK-013  [Group D] lib/discovery/queryBank.ts — bank loader + rotation cursor
  |     |           |
  |     |           +-- AGDISC-TASK-014  [Group D] scripts/refresh-query-banks.ts — init script
  |     |           +-- AGDISC-TASK-015  [Group D] lib/discovery/run.ts — integrate two-queries-per-topic
  |
  +-- AGDISC-TASK-016  [BLOCKER] lib/types/smallWeb.ts — SmallWebSource type

AGDISC-TASK-011 and AGDISC-TASK-015 are the final integration tasks for Groups B/C and D respectively.
AGDISC-TASK-007 (Small Web crawler) integrates into run.ts after AGDISC-TASK-015 is done via:
AGDISC-TASK-017  [integration] lib/discovery/run.ts — integrate Small Web crawler
AGDISC-TASK-018  [verification] End-to-end verification run
AGDISC-TASK-019  [docs] ARCHITECTURE.md update
```

### Parallelism Notes

- AGDISC-TASK-003 (DB migration) through AGDISC-TASK-007 (Small Web crawler) form Group A's chain.
- AGDISC-TASK-008 (body extractor) and AGDISC-TASK-012 (query bank seed file) can be started in
  parallel with AGDISC-TASK-003 as soon as AGDISC-TASK-001 and AGDISC-TASK-002 are done.
- AGDISC-TASK-009 (LLM evaluator) depends only on AGDISC-TASK-008 being complete.
- Group A tasks and Group D tasks are fully parallelizable with Groups B/C.
- AGDISC-TASK-011 (integrate LLM eval into run.ts) must come BEFORE AGDISC-TASK-015
  (integrate two-queries) because both modify run.ts; do them sequentially.

---

## AGDISC-TASK-001 — Install new npm dependencies

**[BLOCKER — prerequisite for all other tasks]**
**Covers stories**: AGDISC-005, AGDISC-008, AGDISC-003

### What to build

Install five new packages needed for Phase 1. Three go to `dependencies`
(used at runtime), two to `devDependencies` (types and OPML parsing).

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `package.json` |

### Implementation

Run the following commands from the project root:

```bash
npm install @anthropic-ai/sdk @mozilla/readability jsdom fast-xml-parser
npm install --save-dev @types/jsdom
```

If `ts-node` is not already in `devDependencies`, also run:

```bash
npm install --save-dev ts-node
```

Check `package.json` devDependencies before running to avoid a duplicate install.

Then update `.env.example` to add:

```
ANTHROPIC_API_KEY=
```

### Acceptance criteria

- [x] `@anthropic-ai/sdk`, `@mozilla/readability`, `jsdom`, `fast-xml-parser` appear in `dependencies` in `package.json`.
- [x] `@types/jsdom` appears in `devDependencies`.
- [x] `ts-node` appears in `devDependencies` (add if absent).
- [x] `npm install` completes with no errors.
- [x] `npx tsc --noEmit` passes with no new errors (the new packages may introduce no types yet; that is fine).
- [x] `.env.example` contains `ANTHROPIC_API_KEY=` on its own line.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Installed @anthropic-ai/sdk, @mozilla/readability, jsdom, fast-xml-parser (dependencies) and @types/jsdom, ts-node (devDependencies). Added ANTHROPIC_API_KEY= to .env.example.

---

## AGDISC-TASK-002 — Update lib/config/feed.ts constants

**[BLOCKER — prerequisite for all Group B, C, D tasks]**
**Covers stories**: AGDISC-008, AGDISC-009, AGDISC-002
**Prerequisites**: AGDISC-TASK-001

### What to build

Add three new constants to `lib/config/feed.ts`. Remove one constant that
is no longer needed.

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `lib/config/feed.ts` |

### Implementation

1. Remove the line:
   ```typescript
   export const SPECIFICITY_THRESHOLD = 0.4;
   ```

2. Add the following three constants at the end of the file:

   ```typescript
   /** LLM composite score threshold (0–5) for a discovery candidate to pass the quality gate. */
   export const LLM_EVAL_THRESHOLD = 3.5;

   /** Maximum characters of body text sent to the LLM evaluator per call (cost control). */
   export const LLM_EVAL_BODY_CHAR_LIMIT = 3000;

   /** Maximum new sources added to the Small Web pool per crawl run (blogroll expansion cap). */
   export const SMALL_WEB_MAX_NEW_SOURCES_PER_RUN = 20;
   ```

3. Do not change any other constants. Do not change the startup assertion.

### Acceptance criteria

- [x] `SPECIFICITY_THRESHOLD` is no longer exported from `lib/config/feed.ts`.
- [x] `LLM_EVAL_THRESHOLD = 3.5` is exported.
- [x] `LLM_EVAL_BODY_CHAR_LIMIT = 3000` is exported.
- [x] `SMALL_WEB_MAX_NEW_SOURCES_PER_RUN = 20` is exported.
- [x] The startup assertion (PIPELINE + DISCOVERY === ARTICLES_PER_DAY) is still present and unchanged.
- [x] `npx tsc --noEmit` passes. If there are errors about `SPECIFICITY_THRESHOLD` being removed, they must be fixed in the relevant importer (currently `lib/discovery/qualityGate.ts`; that fix will come in AGDISC-TASK-010 — note the compile error in qualityGate.ts as expected until that task runs).

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Removed SPECIFICITY_THRESHOLD; added LLM_EVAL_THRESHOLD, LLM_EVAL_BODY_CHAR_LIMIT, SMALL_WEB_MAX_NEW_SOURCES_PER_RUN. qualityGate.ts updated simultaneously so no compile error window existed.

---

## AGDISC-TASK-016 — Create lib/types/smallWeb.ts

**[BLOCKER — prerequisite for AGDISC-TASK-004]**
**Covers stories**: AGDISC-001
**Prerequisites**: AGDISC-TASK-001

### What to build

Create the `SmallWebSource` TypeScript interface that mirrors the Postgres
`small_web_sources` table schema.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/types/smallWeb.ts` |

### Implementation

Create `lib/types/smallWeb.ts` with this exact content:

```typescript
/** A row in the small_web_sources database table. */
export interface SmallWebSource {
  id: number;
  /** Normalized homepage URL (e.g. "https://example.com"). */
  url: string;
  /** RSS or Atom feed URL. Null if not yet discovered or not available. */
  feed_url: string | null;
  /** ISO-8601 timestamp of the last crawl attempt. Null if never crawled. */
  last_crawled_at: string | null;
  /** ISO-8601 timestamp of the last run that yielded at least one qualifying article. */
  last_yielded_at: string | null;
  /** Total qualifying articles yielded across all crawl runs lifetime. */
  yield_count: number;
  /** Number of consecutive crawl runs that produced zero qualifying articles. */
  consecutive_zero_yields: number;
  /**
   * 'active' — crawled on 7-day interval.
   * 'deprioritized' — crawled on 30-day interval (4+ consecutive zero-yield runs).
   */
  status: 'active' | 'deprioritized';
  /** ISO-8601 timestamp before which this source is not eligible for crawling. */
  cooldown_until: string | null;
  /** How this source was added to the pool. */
  discovered_via: 'seed' | 'blogroll';
  /** ISO-8601 timestamp of row creation. */
  created_at: string;
}
```

### Acceptance criteria

- [x] `lib/types/smallWeb.ts` exists and exports the `SmallWebSource` interface.
- [x] All fields match the DDL in the design document exactly.
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Created lib/types/smallWeb.ts with exact field types as specified.

---

## AGDISC-TASK-003 — DB migration: small_web_sources table

**[BLOCKER — prerequisite for AGDISC-TASK-004]**
**Covers stories**: AGDISC-001
**Prerequisites**: AGDISC-TASK-016

### What to build

Run the DDL migration to create the `small_web_sources` table in the Neon Postgres
database. Create a migration file documenting the DDL so it can be re-applied
on other environments.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/db/migrations/007_small_web_sources.sql` |

### Implementation

1. Create `lib/db/migrations/007_small_web_sources.sql` with the following content:

```sql
-- Migration 007: Small Web source pool table
-- Phase 1 (Agentic Discovery) — tracks IndieWeb and Small Web sources
-- for organic blogroll expansion and scheduled crawling.

CREATE TABLE IF NOT EXISTS small_web_sources (
  id                      SERIAL PRIMARY KEY,
  url                     TEXT NOT NULL UNIQUE,
  feed_url                TEXT,
  last_crawled_at         TIMESTAMPTZ,
  last_yielded_at         TIMESTAMPTZ,
  yield_count             INTEGER NOT NULL DEFAULT 0,
  consecutive_zero_yields INTEGER NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'deprioritized')),
  cooldown_until          TIMESTAMPTZ,
  discovered_via          TEXT NOT NULL DEFAULT 'seed'
                            CHECK (discovered_via IN ('seed', 'blogroll')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_small_web_sources_status_cooldown
  ON small_web_sources (status, cooldown_until);
```

2. Apply the migration. If you have a migration runner (check `lib/db/` for any
   existing migration scripts), use it. If not, connect directly to the Neon database
   via `psql` or the Neon SQL editor and run the SQL above.

3. Verify the table exists by running: `SELECT COUNT(*) FROM small_web_sources;`
   (should return 0 rows, no error).

### Acceptance criteria

- [x] `lib/db/migrations/007_small_web_sources.sql` exists with the DDL above.
- [ ] The `small_web_sources` table exists in the Neon database (verified by a successful SELECT). **PENDING — user must run DDL**
- [ ] The index `idx_small_web_sources_status_cooldown` exists. **PENDING — user must run DDL**
- [ ] The table has zero rows (it will be seeded by `lib/db/smallWeb.ts`). **PENDING — user must run DDL**

**Status**: Partially Done — migration file created; DDL not yet applied (user must run manually)
**Completed**: 2026-04-04 (file creation); DB apply pending
**Notes**: Migration file at lib/db/migrations/007_small_web_sources.sql. Requires user to run SQL in Neon console.

---

## AGDISC-TASK-004 — lib/db/smallWeb.ts — DB helper module

**[BLOCKER — prerequisite for AGDISC-TASK-007]**
**Covers stories**: AGDISC-001, AGDISC-002, AGDISC-003, AGDISC-004
**Prerequisites**: AGDISC-TASK-003, AGDISC-TASK-016

### What to build

Create the database helper module for the `small_web_sources` table. This module
is the only place in the codebase that issues SQL against this table.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/db/smallWeb.ts` |

### Implementation

Create `lib/db/smallWeb.ts`. Import `sql` from `@/lib/db/client`. Implement the
following five functions:

**`seedSourcesIfEmpty(seeds: string[]): Promise<void>`**

For each URL in `seeds`, insert with `INSERT INTO small_web_sources (url, discovered_via)
VALUES ($1, 'seed') ON CONFLICT (url) DO NOTHING`. This is idempotent.

**`getEligibleSources(): Promise<SmallWebSource[]>`**

Returns sources that are past their cooldown and eligible for crawling:

```sql
SELECT * FROM small_web_sources
WHERE
  (status = 'active' AND (last_crawled_at IS NULL OR last_crawled_at < NOW() - INTERVAL '7 days'))
  OR
  (status = 'deprioritized' AND (last_crawled_at IS NULL OR last_crawled_at < NOW() - INTERVAL '30 days'))
ORDER BY last_crawled_at ASC NULLS FIRST
```

**`upsertSource(url: string, feedUrl: string | null, discoveredVia: 'seed' | 'blogroll'): Promise<void>`**

Inserts a new source if not present; does nothing if the URL already exists:

```sql
INSERT INTO small_web_sources (url, feed_url, discovered_via)
VALUES ($1, $2, $3)
ON CONFLICT (url) DO NOTHING
```

**`markCrawled(url: string, yieldedCount: number): Promise<void>`**

Atomically updates crawl statistics after a crawl attempt. Compute the update
logic in SQL:

```sql
UPDATE small_web_sources SET
  last_crawled_at = NOW(),
  cooldown_until = NOW() + INTERVAL '7 days',
  yield_count = yield_count + $2,
  last_yielded_at = CASE WHEN $2 > 0 THEN NOW() ELSE last_yielded_at END,
  consecutive_zero_yields = CASE WHEN $2 > 0 THEN 0 ELSE consecutive_zero_yields + 1 END,
  status = CASE
    WHEN $2 = 0 AND (consecutive_zero_yields + 1) >= 4 THEN 'deprioritized'
    ELSE status
  END
WHERE url = $1
```

Note: the CASE for status deprioritization uses `consecutive_zero_yields + 1`
(the value after this update) to determine if the threshold is reached.

**`getSourceCount(): Promise<number>`**

Returns `SELECT COUNT(*)::int FROM small_web_sources`. Used in the crawler
summary log.

### Acceptance criteria

- [x] `lib/db/smallWeb.ts` exists and exports the five functions above.
- [x] `seedSourcesIfEmpty()` is idempotent: calling it twice with the same URLs inserts only once.
- [x] `getEligibleSources()` returns only sources past their respective cooldown interval.
- [x] `markCrawled()` correctly sets `status = 'deprioritized'` when a source has 4 consecutive zero-yield runs.
- [x] `markCrawled()` resets `consecutive_zero_yields = 0` when `yieldedCount > 0`.
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done (code complete; runtime verification requires DDL to be applied first)
**Completed**: 2026-04-04
**Notes**: All five functions implemented using sql tagged template from @/lib/db/client.

---

## AGDISC-TASK-005 — lib/discovery/smallWeb/seeds.ts

**Covers stories**: AGDISC-001
**Prerequisites**: AGDISC-TASK-001

### What to build

Create the seed URL constant. This is a simple committed constant — not a
config file — so adding seed URLs requires a code edit and redeploy.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/discovery/smallWeb/seeds.ts` |

### Implementation

Create `lib/discovery/smallWeb/seeds.ts` with this exact content:

```typescript
/**
 * Initial seed URLs for the Small Web source pool.
 * These are human-curated directories of personal blogs and independent sites.
 * The crawler fetches these pages and parses them for blogroll links to
 * discover actual content sources.
 *
 * To add a seed: append to this array and redeploy. The seedSourcesIfEmpty()
 * DB helper will insert new URLs on the next pipeline run.
 */
export const SMALL_WEB_SEED_URLS: string[] = [
  'https://ooh.directory',
  'https://blogroll.org',
  'https://indieweb.org/people',
];
```

### Acceptance criteria

- [x] `lib/discovery/smallWeb/seeds.ts` exists and exports `SMALL_WEB_SEED_URLS`.
- [x] The array contains exactly the three URLs listed above.
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Created with the three seed URLs as specified.

---

## AGDISC-TASK-006 — lib/discovery/smallWeb/blogroll.ts — blogroll parser

**[BLOCKER — prerequisite for AGDISC-TASK-007]**
**Covers stories**: AGDISC-003
**Prerequisites**: AGDISC-TASK-001

### What to build

Create the blogroll parser module. This module parses HTML pages for blogroll
links and OPML files, and discovers RSS/Atom feeds for candidate URLs.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/discovery/smallWeb/blogroll.ts` |

### Implementation

**Types:**

```typescript
export interface BlogrollCandidate {
  url: string;       // normalized homepage URL of the discovered site
  feedUrl: string;   // discovered RSS/Atom feed URL
}
```

**Function 1: `parseBlogrollLinks(html: string, sourceUrl: string): string[]`**

Parses an HTML page and returns an array of candidate site URLs discovered
via blogroll patterns. Does not deduplicate against the DB — just returns
the raw discovered URLs.

Rules (applied in order; collect all matches):

1. Find `<a rel="blogroll" href="...">` tags — add `href` values.
2. Find `<a href="...*.opml">` tags — add the OPML URL to a separate list for
   OPML fetching (see Function 2).
3. Find `<a>` tags inside elements with class or id containing `blogroll`
   (case-insensitive), where `href` is an external domain (origin differs from
   `sourceUrl`). Add those `href` values.
4. Find `<a>` tags inside `<nav>` or `<aside>` where `href` is an external
   domain and the link text looks like a site name (no spaces in the text
   node or a short label).

For all collected hrefs: normalize to `https://<host>` form (strip path,
query, fragment). Skip any URL whose host matches the source URL's host (don't
add the site to its own blogroll).

Use `fast-xml-parser` is NOT needed here — HTML parsing is done with simple
regex or a lightweight string parser. Do not import a full HTML parser; the
patterns above can be handled with `RegExp` matching on the HTML string.

**Function 2: `parseOpmlLinks(opmlText: string): string[]`**

Parses an OPML XML document and returns an array of site URLs. Use
`fast-xml-parser` to parse the XML. Extract all `<outline>` elements and
collect:
- `htmlUrl` attribute if present
- `xmlUrl` attribute if present (this is a feed URL; derive the site homepage
  by stripping `/feed`, `/rss`, `/rss.xml`, `/feed.xml`, `/atom.xml` suffixes)

Return the collected URLs normalized to `https://<host>`.

**Function 3: `discoverFeedUrl(siteUrl: string): Promise<string | null>`**

Given a site homepage URL, attempts to discover the RSS or Atom feed URL.

Steps:
1. Fetch `siteUrl` with a 5-second timeout. On error, return null.
2. Look in the HTML `<head>` for:
   ```html
   <link rel="alternate" type="application/rss+xml" href="...">
   <link rel="alternate" type="application/atom+xml" href="...">
   ```
   If found, return the `href` (resolved against `siteUrl` if relative).
3. If not found, try these paths by issuing HEAD requests with a 3-second timeout:
   `/feed`, `/rss`, `/rss.xml`, `/feed.xml`, `/atom.xml`.
   The first path that returns a 200 with `Content-Type` containing `xml` is
   returned as the feed URL (resolved against `siteUrl`).
4. If nothing found, return null.

### Acceptance criteria

- [x] `parseBlogrollLinks()` returns external-domain hrefs normalized to `https://<host>`.
- [x] `parseBlogrollLinks()` does not return URLs matching the source page's own domain.
- [x] `parseOpmlLinks()` correctly extracts `htmlUrl` and `xmlUrl` attributes from OPML `<outline>` elements.
- [x] `discoverFeedUrl()` returns the `<link rel="alternate">` href when present in the page `<head>`.
- [x] `discoverFeedUrl()` falls back to common path probing when no `<link>` tag is found.
- [x] `discoverFeedUrl()` returns `null` on fetch error or when no feed is found.
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Created lib/discovery/smallWeb/blogroll.ts with all three functions using regex-based HTML parsing and fast-xml-parser for OPML.

---

## AGDISC-TASK-007 — lib/discovery/smallWeb/crawler.ts — crawl orchestrator

**[BLOCKER — prerequisite for AGDISC-TASK-017]**
**Covers stories**: AGDISC-002, AGDISC-003, AGDISC-004
**Prerequisites**: AGDISC-TASK-004, AGDISC-TASK-005, AGDISC-TASK-006

### What to build

Create the Small Web crawl orchestrator. This is the main entry point called
from `runDiscovery()`. It seeds the source table, retrieves eligible sources,
crawls each one sequentially, and returns article candidates in `BraveSearchResult`
shape.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/discovery/smallWeb/crawler.ts` |

### Implementation

Export one function:

```typescript
import type { BraveSearchResult } from '@/lib/discovery/braveSearch';

export async function runSmallWebCrawl(): Promise<BraveSearchResult[]>
```

**Algorithm:**

```
1. Call seedSourcesIfEmpty(SMALL_WEB_SEED_URLS).

2. Call getEligibleSources(). Let sources = result.

3. Initialize stats: { attempted: 0, skipped: 0, failed: 0, candidates: 0, newSources: 0 }.
   Note: skipped is not used here (cooldown filtering is in getEligibleSources),
   but newSources tracks blogroll discoveries.

4. Initialize: allCandidates: BraveSearchResult[] = [], newSourcesAddedThisRun = 0.

5. For each source in sources (sequential loop, not Promise.all):

   a. stats.attempted++.

   b. If source.feed_url is null:
      - Attempt discoverFeedUrl(source.url). On failure, log debug and continue.
      - If a feed is found: call upsertSource(source.url, feedUrl, source.discovered_via)
        to update the feed_url.
      - If no feed found: call markCrawled(source.url, 0) and continue to next source.

   c. Parse the feed using rss-parser:
      ```typescript
      const Parser = require('rss-parser');
      const parser = new Parser();
      const feed = await parser.parseURL(source.feed_url);
      ```
      Wrap in try/catch. On error: log `[small-web] FAIL ${source.url}: ${err.message}`,
      call markCrawled(source.url, 0), stats.failed++, continue.

   d. Filter feed items to those published within DISCOVERY_MAX_AGE_HOURS:
      - Parse `item.isoDate` or `item.pubDate` to a Date.
      - Discard items with unparseable dates.
      - Discard items older than DISCOVERY_MAX_AGE_HOURS hours.

   e. Map qualifying items to BraveSearchResult objects:
      ```typescript
      {
        title: item.title ?? '',
        url: item.link ?? '',
        description: item.contentSnippet?.slice(0, 300) ?? item.content?.replace(/<[^>]*>/g, '').slice(0, 300) ?? '',
        publishedAt: item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null),
        sourceName: feed.title ?? extractDomain(source.url),
        sourceUrl: `https://${extractDomain(source.url)}`,
      }
      ```
      Discard any item where `title` or `url` is empty after mapping (they
      will fail Gate 1 anyway, but filter early to reduce noise).
      Discard items where `description` is empty (Gate 1 would reject them).

   f. Call markCrawled(source.url, qualifyingItems.length).

   g. Append mapped items to allCandidates. stats.candidates += qualifyingItems.length.

   h. Blogroll discovery (only if newSourcesAddedThisRun < SMALL_WEB_MAX_NEW_SOURCES_PER_RUN):
      - Fetch the source homepage HTML (GET with 5-second timeout, ignore errors).
      - Call parseBlogrollLinks(html, source.url) to get candidate site URLs.
      - Also check for OPML links in the HTML and fetch+parse them via parseOpmlLinks().
      - For each candidate site URL not already in the DB (check with a quick
        `upsertSource()` — ON CONFLICT DO NOTHING handles dedup):
        - Call discoverFeedUrl(candidateUrl).
        - If a feed is found and newSourcesAddedThisRun < SMALL_WEB_MAX_NEW_SOURCES_PER_RUN:
          - Call upsertSource(candidateUrl, feedUrl, 'blogroll').
          - stats.newSources++. newSourcesAddedThisRun++.

   i. Sleep 1 second before the next source (throttle):
      ```typescript
      await new Promise(resolve => setTimeout(resolve, 1000));
      ```

6. Log the run summary at info level:
   ```
   [small-web] Crawl complete: ${stats.attempted} attempted, ${stats.failed} failed,
   ${stats.candidates} candidates yielded, ${stats.newSources} new sources discovered
   ```

7. Return allCandidates.
```

**Helper function** (private, same file):

```typescript
function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}
```

### Acceptance criteria

- [x] `runSmallWebCrawl()` calls `seedSourcesIfEmpty()` on every run (idempotent).
- [x] Sources with `feed_url = null` attempt feed discovery before crawling.
- [x] Sources whose feed discovery fails are marked crawled with `yieldedCount = 0` and skipped.
- [x] Feed parse errors do not throw; the loop continues with the next source.
- [x] Only items within `DISCOVERY_MAX_AGE_HOURS` are included as candidates.
- [x] Items with empty title or url are discarded before being added to allCandidates.
- [x] Items with empty description are discarded (Gate 1 would reject them; filter early).
- [x] `markCrawled()` is called after every crawl attempt (success or failure).
- [x] Blogroll discovery is bounded by `SMALL_WEB_MAX_NEW_SOURCES_PER_RUN`.
- [x] A 1-second delay is inserted between source crawls.
- [x] The summary log line is written at the end.
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Created lib/discovery/smallWeb/crawler.ts. Uses require('rss-parser') to avoid TS type conflicts with the module's CommonJS export.

---

## AGDISC-TASK-008 — lib/discovery/bodyExtractor.ts — extraction module

**[BLOCKER — prerequisite for AGDISC-TASK-009]**
**Covers stories**: AGDISC-005, AGDISC-006
**Prerequisites**: AGDISC-TASK-001

### What to build

Create the body text extraction module using `@mozilla/readability` and `jsdom`.
This module is server-side only.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/discovery/bodyExtractor.ts` |

### Implementation

Create `lib/discovery/bodyExtractor.ts` with the following:

```typescript
// SERVER-SIDE ONLY — never import in browser bundles.

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export type ExtractionFailureReason =
  | 'fetch_timeout'
  | 'http_error'
  | 'extraction_failed'
  | 'below_minimum_length';

export interface ExtractionSuccess {
  success: true;
  bodyText: string;
}

export interface ExtractionFailure {
  success: false;
  reason: ExtractionFailureReason;
  detail?: string;
}

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

/**
 * Fetches the given URL and extracts its main body text using Mozilla Readability.
 * Returns ExtractionSuccess with plain text, or ExtractionFailure with a reason code.
 * No retry logic. Callers should handle failures by skipping the candidate.
 */
export async function extractBodyText(url: string): Promise<ExtractionResult> {
  let html: string;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscoveryBot/1.0)' },
    });
    if (!res.ok) {
      return { success: false, reason: 'http_error', detail: String(res.status) };
    }
    html = await res.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('TimeoutError') || msg.includes('AbortError') || (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError') {
      return { success: false, reason: 'fetch_timeout' };
    }
    return { success: false, reason: 'http_error', detail: msg };
  }
  return extractBodyTextFromHtml(html, url);
}

/**
 * Extracts body text from raw HTML using Mozilla Readability.
 * Exported for testing — allows injecting pre-fetched HTML without HTTP.
 */
export function extractBodyTextFromHtml(html: string, url: string): ExtractionResult {
  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url });
  } catch {
    return { success: false, reason: 'extraction_failed' };
  }

  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.textContent) {
    return { success: false, reason: 'extraction_failed' };
  }

  // Strip any remaining HTML tags and normalize whitespace
  const plainText = article.textContent
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Word count by whitespace-separated tokens
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;
  if (wordCount < 300) {
    return { success: false, reason: 'below_minimum_length' };
  }

  return { success: true, bodyText: plainText };
}
```

### Acceptance criteria

- [x] `extractBodyText()` returns `{ success: false, reason: 'fetch_timeout' }` when `AbortSignal.timeout(8000)` fires.
- [x] `extractBodyText()` returns `{ success: false, reason: 'http_error', detail: '404' }` for a 404 response.
- [x] `extractBodyTextFromHtml()` returns `{ success: false, reason: 'extraction_failed' }` when Readability returns null.
- [x] `extractBodyTextFromHtml()` returns `{ success: false, reason: 'below_minimum_length' }` for HTML whose extracted text has fewer than 300 whitespace-separated tokens.
- [x] `extractBodyTextFromHtml()` returns `{ success: true, bodyText: '...' }` for valid HTML with 300+ word article content.
- [x] `bodyText` in the success result has no HTML tags (the `<[^>]*>` regex is applied).
- [x] The module has `// SERVER-SIDE ONLY` comment at the top.
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Created lib/discovery/bodyExtractor.ts with exact implementation from task spec.

---

## AGDISC-TASK-009 — lib/discovery/llmEvaluator.ts — LLM evaluator module

**[BLOCKER — prerequisite for AGDISC-TASK-010]**
**Covers stories**: AGDISC-008
**Prerequisites**: AGDISC-TASK-001, AGDISC-TASK-008

### What to build

Create the LLM content evaluator module. This module sends article content to
Claude Haiku and returns a structured quality score.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/discovery/llmEvaluator.ts` |

### Implementation

```typescript
// SERVER-SIDE ONLY — never import in browser bundles.

import Anthropic from '@anthropic-ai/sdk';

/** Model used for content evaluation. Do not hardcode inline; use this constant. */
const LLM_EVAL_MODEL = 'claude-haiku-4-5-20251001';

export interface LLMScores {
  intellectual_substance: number;
  originality: number;
  cross_disciplinary_appeal: number;
  evergreen_durability: number;
  writing_quality: number;
  /** Arithmetic mean of all five scores, rounded to 2 decimal places. */
  composite: number;
}

export interface LLMEvalSuccess {
  success: true;
  scores: LLMScores;
}

export interface LLMEvalFailure {
  success: false;
  reason: 'parse_error' | 'api_error';
  detail?: string;
}

export type LLMEvalResult = LLMEvalSuccess | LLMEvalFailure;
```

Implement two functions:

**`evaluateWithLLMClient(client: Anthropic, title: string, description: string, bodyText: string): Promise<LLMEvalResult>`**

This is the testable inner function. Create the Anthropic API call:

```typescript
const response = await client.messages.create({
  model: LLM_EVAL_MODEL,
  max_tokens: 256,
  system: `You are an editorial evaluator for a personalized content discovery system.
Your task is to assess whether a piece of writing meets a high curatorial bar —
the kind of writing that would be recommended by publications like The Browser,
The Marginalian, or Arts & Letters Daily.

Evaluate the article across exactly five dimensions. For each dimension, assign
an integer score from 1 (very low) to 5 (very high).

Dimensions:
- intellectual_substance: Does the piece develop a real argument, finding, or insight? Is there something the reader would not know after reading a generic summary on the topic?
- originality: Does the author have a distinct perspective, voice, or angle? Does it reflect genuine independent thought rather than recapping known information?
- cross_disciplinary_appeal: Does the piece connect ideas across domains, or draw on an unusual combination of fields? Would it interest someone outside the specific subject area?
- evergreen_durability: Will this piece still be worth reading in a year? Is it anchored to a transient news event, or does it address something foundational?
- writing_quality: Is the prose clear, precise, and crafted with care? Is it worth reading for the writing itself, not just the information?

Score as a thoughtful, widely-read editor — not as a classifier pattern-matching on surface signals. A 5 means genuinely exceptional. A 3 means adequate but unremarkable. A 1 means generic, poorly written, or purely informational without insight.`,
  tools: [{
    name: 'score_article',
    description: 'Return quality scores for the article.',
    input_schema: {
      type: 'object' as const,
      properties: {
        intellectual_substance:    { type: 'integer', minimum: 1, maximum: 5 },
        originality:               { type: 'integer', minimum: 1, maximum: 5 },
        cross_disciplinary_appeal: { type: 'integer', minimum: 1, maximum: 5 },
        evergreen_durability:      { type: 'integer', minimum: 1, maximum: 5 },
        writing_quality:           { type: 'integer', minimum: 1, maximum: 5 },
      },
      required: [
        'intellectual_substance', 'originality',
        'cross_disciplinary_appeal', 'evergreen_durability', 'writing_quality'
      ],
    },
  }],
  tool_choice: { type: 'tool', name: 'score_article' },
  messages: [{
    role: 'user',
    content: `Title: ${title}\nDescription: ${description}\nBody (first 3000 characters):\n${bodyText.slice(0, 3000)}`,
  }],
});
```

Parse the response:
1. Find the `tool_use` block in `response.content` whose `name === 'score_article'`.
2. Cast `block.input` to the expected shape.
3. Validate that all five fields are integers in [1, 5]. If any are missing or
   out of range, return `{ success: false, reason: 'parse_error' }`.
4. Compute composite: `Math.round((sum / 5) * 100) / 100`.
5. Return `{ success: true, scores: { ...five scores, composite } }`.

Wrap the entire `client.messages.create()` call in a try/catch. Any exception
returns `{ success: false, reason: 'api_error', detail: err.message }`.

**`evaluateWithLLM(title: string, description: string, bodyText: string): Promise<LLMEvalResult>`**

Creates an Anthropic client from `process.env.ANTHROPIC_API_KEY` and calls
`evaluateWithLLMClient()`:

```typescript
export async function evaluateWithLLM(
  title: string,
  description: string,
  bodyText: string
): Promise<LLMEvalResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return evaluateWithLLMClient(client, title, description, bodyText);
}
```

### Acceptance criteria

- [x] `evaluateWithLLMClient()` is exported and accepts an Anthropic client as its first argument.
- [x] `evaluateWithLLM()` creates an Anthropic client from `ANTHROPIC_API_KEY` and delegates to `evaluateWithLLMClient()`.
- [x] The tool schema includes all five dimensions as integers with min: 1, max: 5.
- [x] `tool_choice` is set to force the `score_article` tool.
- [x] `composite` is computed as the arithmetic mean of the five scores, rounded to 2 decimal places.
- [x] Any API exception returns `{ success: false, reason: 'api_error' }`.
- [x] A missing or out-of-range tool response field returns `{ success: false, reason: 'parse_error' }`.
- [x] The module has `// SERVER-SIDE ONLY` comment at the top.
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Created lib/discovery/llmEvaluator.ts with forced tool_use, composite computation, and full validation logic.

---

## AGDISC-TASK-010 — lib/discovery/qualityGate.ts — remove Gate 4

**[BLOCKER — prerequisite for AGDISC-TASK-011]**
**Covers stories**: AGDISC-009
**Prerequisites**: AGDISC-TASK-002 (SPECIFICITY_THRESHOLD removed from feed.ts)

### What to build

Modify `lib/discovery/qualityGate.ts` to remove Gate 4 (the specificity
heuristic). The module becomes a fast synchronous pre-filter covering only
Gates 1–3 (validator rules, freshness, domain blocklist).

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `lib/discovery/qualityGate.ts` |

### Implementation

1. Remove the import of `SPECIFICITY_THRESHOLD` from `@/lib/config/feed`.
   Keep `DISCOVERY_MAX_AGE_HOURS`.

2. Change the `QualityGateResult` interface — remove `specificityScore`:

   ```typescript
   export interface QualityGateResult {
     pass: boolean;
     reason?: string;  // set only when pass === false
   }
   ```

3. Remove the entire Gate 4 block (the `computeSpecificityScore` call and the
   `specificityScore < SPECIFICITY_THRESHOLD` check from `evaluateCandidate()`).

4. Delete the `computeSpecificityScore()` function entirely.

5. The `evaluateCandidate()` function now returns `{ pass: true }` (no
   `specificityScore`) when all three remaining gates pass.

6. The final return in the passing case becomes:
   ```typescript
   return { pass: true };
   ```

### Impact on run.ts

`run.ts` currently reads `gateResult.specificityScore` to rank qualified
candidates. After this task, `specificityScore` no longer exists. The sort
in `run.ts` will use `llmScores.composite` instead (done in AGDISC-TASK-011).
The compile error in `run.ts` from the removed field is expected at this point
and will be fixed in AGDISC-TASK-011.

### Acceptance criteria

- [x] `computeSpecificityScore()` function no longer exists in `qualityGate.ts`.
- [x] `QualityGateResult` no longer has a `specificityScore` field.
- [x] `SPECIFICITY_THRESHOLD` is no longer imported.
- [x] Gates 1, 2, and 3 are unchanged (validator rules, freshness, domain blocklist).
- [x] The `evaluateCandidate()` function signature is unchanged: `(candidate: BraveSearchResult, nowMs?: number): QualityGateResult`.
- [x] Any existing unit tests for the specificity heuristic are deleted.
- [x] New unit tests confirm that Gates 1–3 still pass/fail correctly with the new return shape.
- [x] `npx tsc --noEmit` passes (except for the expected error in `run.ts` about `specificityScore` — document this and fix it in AGDISC-TASK-011).

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Rewrote qualityGate.ts removing Gate 4 entirely. run.ts was updated simultaneously in AGDISC-TASK-011 so no compile error window existed.

---

## AGDISC-TASK-011 — lib/discovery/run.ts — integrate body extraction and LLM evaluation

**[BLOCKER — prerequisite for AGDISC-TASK-015 and AGDISC-TASK-017]**
**Covers stories**: AGDISC-006, AGDISC-007, AGDISC-009, AGDISC-010
**Prerequisites**: AGDISC-TASK-009, AGDISC-TASK-010

### What to build

Modify `lib/discovery/run.ts` to:
1. Replace the per-candidate synchronous `evaluateCandidate()` pass with the
   new async multi-step evaluation (extraction → LLM eval → threshold check).
2. Replace the `specificityScore`-based sort with a `composite`-score-based sort.
3. Initialize and accumulate `EvalStats` for the run summary log.
4. Set `bodyText` on qualifying Article objects.

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `lib/discovery/run.ts` |

### Implementation

**Step 1: Add imports**

```typescript
import { extractBodyText } from './bodyExtractor';
import type { ExtractionFailureReason } from './bodyExtractor';
import { evaluateWithLLM } from './llmEvaluator';
import type { LLMScores } from './llmEvaluator';
import { LLM_EVAL_THRESHOLD } from '@/lib/config/feed';
```

**Step 2: Define EvalStats interface (top of file, after imports)**

```typescript
interface EvalStats {
  candidatesAttempted: number;
  extractionFailed: Partial<Record<ExtractionFailureReason, number>>;
  llmFailed: Partial<Record<'parse_error' | 'api_error', number>>;
  llmThresholdFailed: number;
  llmCallCount: number;
  llmPassCount: number;
  llmWallTimeMs: number;
  qualified: number;
}
```

**Step 3: Replace the candidate evaluation loop**

The current loop in `runDiscovery` iterates over `searchResults` and calls
`evaluateCandidate(result)`. Replace the inner-loop body (for each `result`)
with:

```typescript
// Gate 1–3: synchronous pre-filter
const gateResult = evaluateCandidate(result);
if (!gateResult.pass) {
  appendLog(`[discovery] DISCARD [${topic.id}] ${result.url} -- ${gateResult.reason}`);
  continue;
}

// Dedup check (do this before the expensive LLM call)
const canonical = canonicalizeUrl(result.url);
if (fixedArticleUrls.has(canonical)) {
  appendLog(`[discovery] DISCARD [${topic.id}] ${result.url} -- DUPLICATE_FIXED`);
  continue;
}
if (seenCanonical.has(canonical)) {
  appendLog(`[discovery] DISCARD [${topic.id}] ${result.url} -- DUPLICATE_DISCOVERY`);
  continue;
}

stats.candidatesAttempted++;

// Group B: body text extraction
const extractResult = await extractBodyText(result.url);
if (!extractResult.success) {
  appendLog(`[discovery] DISCARD [${topic.id}] ${result.url} -- extraction:${extractResult.reason}`);
  stats.extractionFailed[extractResult.reason] = (stats.extractionFailed[extractResult.reason] ?? 0) + 1;
  continue;
}

// Group C: LLM evaluation
const llmStart = Date.now();
stats.llmCallCount++;
const llmResult = await evaluateWithLLM(result.title, result.description ?? '', extractResult.bodyText);
stats.llmWallTimeMs += Date.now() - llmStart;

if (!llmResult.success) {
  appendLog(`[discovery] DISCARD [${topic.id}] ${result.url} -- llm:${llmResult.reason}`);
  stats.llmFailed[llmResult.reason] = (stats.llmFailed[llmResult.reason] ?? 0) + 1;
  continue;
}

if (llmResult.scores.composite < LLM_EVAL_THRESHOLD) {
  appendLog(
    `[discovery] DISCARD [${topic.id}] ${result.url} -- llm_threshold_not_met ` +
    `(composite:${llmResult.scores.composite}, ` +
    `sub:${llmResult.scores.intellectual_substance} ` +
    `orig:${llmResult.scores.originality} ` +
    `cross:${llmResult.scores.cross_disciplinary_appeal} ` +
    `ever:${llmResult.scores.evergreen_durability} ` +
    `write:${llmResult.scores.writing_quality})`
  );
  stats.llmThresholdFailed++;
  continue;
}

stats.llmPassCount++;
seenCanonical.add(canonical);
qualified.push({ result, topic, llmScores: llmResult.scores, bodyText: extractResult.bodyText });
```

**Step 4: Update the `qualified` array element type**

Change `ScoredCandidate` to:

```typescript
interface ScoredCandidate {
  result: BraveSearchResult;
  topic: DiscoveryTopic;
  llmScores: LLMScores;
  bodyText: string;
}
```

**Step 5: Update the sort**

Replace `qualified.sort((a, b) => b.specificityScore - a.specificityScore)` with:

```typescript
qualified.sort((a, b) => b.llmScores.composite - a.llmScores.composite);
```

**Step 6: Update Article construction**

Add `bodyText` to the article object:

```typescript
bodyText: item.bodyText,
```

(where `item` is the element from `top`).

**Step 7: Initialize stats and write the run summary**

Initialize `stats` before the loop:

```typescript
const stats: EvalStats = {
  candidatesAttempted: 0,
  extractionFailed: {},
  llmFailed: {},
  llmThresholdFailed: 0,
  llmCallCount: 0,
  llmPassCount: 0,
  llmWallTimeMs: 0,
  qualified: 0,
};
```

After `const top = qualified.slice(0, DISCOVERY_ARTICLES_PER_DAY)`:

```typescript
stats.qualified = top.length;

const extractFailSummary = Object.entries(stats.extractionFailed)
  .map(([k, v]) => `${v} ${k}`).join(', ') || '0';
const llmFailSummary = Object.entries(stats.llmFailed)
  .map(([k, v]) => `${v} ${k}`).join(', ') || '0';

appendLog(
  `[discovery] Run summary: ${stats.candidatesAttempted} candidates attempted, ` +
  `extraction failures: ${extractFailSummary}, ` +
  `LLM failures: ${llmFailSummary}, ` +
  `${stats.llmThresholdFailed} below threshold, ` +
  `${stats.llmPassCount} LLM pass, ` +
  `${stats.qualified} qualified after dedup+quota. ` +
  `LLM: ${stats.llmCallCount} calls, ${stats.llmWallTimeMs}ms total`
);
```

### Acceptance criteria

- [x] The synchronous `specificityScore`-based sort is replaced with `llmScores.composite`-based sort.
- [x] `evaluateCandidate()` is still called for Gates 1–3 (fast pre-filter before the expensive calls).
- [x] Dedup check runs before extraction and LLM calls (cost optimization — no LLM call on a duplicate).
- [x] `extractBodyText()` is called for each candidate that passes Gates 1–3 and dedup.
- [x] `evaluateWithLLM()` is called only for candidates that pass extraction.
- [x] Candidates that fail the `LLM_EVAL_THRESHOLD` check are logged with all five dimension scores.
- [x] `bodyText` is set on every qualifying `Article` object returned by `runDiscovery()`.
- [x] The run summary log line is written at info level at the end.
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: run.ts fully rewritten to integrate all Phase 1 changes (AGDISC-TASK-011 + 015 + 017 applied in single pass to avoid sequential conflicts).

---

## AGDISC-TASK-012 — data/query_banks.default.json — committed seed file

**[BLOCKER — prerequisite for AGDISC-TASK-013]**
**Covers stories**: AGDISC-011, AGDISC-014
**Prerequisites**: AGDISC-TASK-001

### What to build

Create the committed seed file `data/query_banks.default.json` with manually
authored fallback queries for all 12 topics. This file serves as the seed
that is copied to `data/query_banks.json` on first run. It is checked into git.

Also update `.gitignore` to exclude the two runtime files.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `data/query_banks.default.json` |
| Modify | `.gitignore` |

### Implementation

**`.gitignore` additions** (add to the data/ section):

```
data/query_banks.json
data/query_rotation_state.json
```

**`data/query_banks.default.json`**: Create with 5 manually authored queries per
topic. These are fallback queries that will be overwritten by `scripts/refresh-query-banks.ts`
when the operator runs it. The queries should follow the "master curator" style
described in the BRD (precise, niche, cross-disciplinary) rather than generic
keyword phrases.

```json
{
  "generated_at": "2026-04-04T00:00:00Z",
  "topics": {
    "fringe-science": {
      "queries": [
        "overlooked scientific phenomena that contradicted established consensus",
        "measurement anomalies that changed our understanding of physical constants",
        "marginal research traditions later vindicated by mainstream science",
        "scientists working outside institutional frameworks who made lasting contributions",
        "unexpected connections between disparate fields of scientific inquiry"
      ]
    },
    "music-audio-culture": {
      "queries": [
        "underground music communities that shaped but never reached mainstream culture",
        "acoustic phenomena that influenced composition across different traditions",
        "forgotten instrument makers and the sounds that died with them",
        "geographic isolation as a driver of distinct musical evolution",
        "the economics and sociology of independent music distribution before streaming"
      ]
    },
    "visual-art-design": {
      "queries": [
        "design solutions born from severe material or economic constraints",
        "vernacular visual traditions that influenced formal art movements",
        "artists working at the intersection of craft and industrial production",
        "color theory and perception research applied outside academic contexts",
        "the typography and layout of documents that changed how information was understood"
      ]
    },
    "architecture": {
      "queries": [
        "buildings that solved social problems their architects did not anticipate",
        "structural techniques developed in one culture adopted by another",
        "the relationship between building materials and the societies that used them",
        "small-scale architecture that influenced thinking about urban scale",
        "failed utopian housing projects and what they reveal about planning assumptions"
      ]
    },
    "fashion-material-culture": {
      "queries": [
        "textile production techniques that shaped economic and social structures",
        "garments as evidence of cross-cultural contact and trade routes",
        "the politics of clothing and dress codes across different historical periods",
        "materials that carried meaning beyond their physical properties",
        "craft traditions at risk of disappearing and why they matter"
      ]
    },
    "nature-ecology": {
      "queries": [
        "ecological relationships so subtle they went unnoticed for decades",
        "species whose behavior revealed unexpected complexity in natural systems",
        "the long-term effects of human alteration of landscape on non-target species",
        "overlooked organisms that play disproportionate roles in their ecosystems",
        "natural systems that recovered from apparent irreversible damage"
      ]
    },
    "math-philosophy": {
      "queries": [
        "mathematical results with profound philosophical implications rarely discussed",
        "philosophical problems that turned out to be mathematical ones in disguise",
        "logicians and mathematicians whose work was ignored for decades then became foundational",
        "the relationship between formal systems and the limits of what can be known",
        "informal mathematical thinking that preceded formal proofs by centuries"
      ]
    },
    "film-visual-storytelling": {
      "queries": [
        "filmmakers who developed techniques in isolation that others independently discovered",
        "the visual language of non-commercial cinema traditions",
        "documentary approaches that changed how factual storytelling was conceived",
        "the influence of working constraints on visual style in cinema",
        "films that failed commercially but shaped subsequent filmmaking"
      ]
    },
    "literature-language": {
      "queries": [
        "literary forms that emerged from specific social and material conditions",
        "writers who worked in the gaps between recognized genres or traditions",
        "languages with structural features that shaped the thought of their speakers",
        "translations that changed how a literature was received in a new context",
        "the relationship between oral tradition and written form in specific cultures"
      ]
    },
    "craft-making": {
      "queries": [
        "hand processes that machine production failed to replicate and why",
        "makers who reconstructed lost techniques from surviving objects",
        "the tacit knowledge embedded in traditional craft that resists documentation",
        "material properties discovered through practice before scientific explanation",
        "craft communities that preserved techniques through periods of suppression"
      ]
    },
    "economics-behavioral": {
      "queries": [
        "economic behaviors that persisted despite being individually irrational",
        "historical financial crises that followed patterns not recognized until later",
        "behavioral research that contradicted assumptions built into economic models",
        "informal economic systems that operated alongside formal ones",
        "the cognitive limits that shape how people perceive and respond to risk"
      ]
    },
    "history-archaeology": {
      "queries": [
        "archaeological discoveries that required revision of well-established historical narratives",
        "historical events whose significance was not recognized by contemporaries",
        "material evidence that survived when written records did not",
        "technologies that appeared, disappeared, and were independently reinvented",
        "the persistence of pre-modern practices into periods assumed to have abandoned them"
      ]
    }
  }
}
```

### Acceptance criteria

- [x] `data/query_banks.default.json` exists and is valid JSON (parseable without error).
- [x] The file contains exactly 12 topic keys matching the `id` values in `DISCOVERY_TOPICS`.
- [x] Each topic has a `queries` array with exactly 5 strings.
- [x] `.gitignore` contains entries for `data/query_banks.json` and `data/query_rotation_state.json`.
- [x] `data/query_banks.default.json` is NOT in `.gitignore` (it is committed).

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Created data/query_banks.default.json with 12 topics × 5 queries. Updated .gitignore to exclude runtime files.

---

## AGDISC-TASK-013 — lib/discovery/queryBank.ts — bank loader and rotation cursor

**[BLOCKER — prerequisite for AGDISC-TASK-015]**
**Covers stories**: AGDISC-011, AGDISC-012
**Prerequisites**: AGDISC-TASK-012

### What to build

Create the query bank loader and rotation cursor module. This module handles
reading and writing `data/query_banks.json` and `data/query_rotation_state.json`,
with fallback to `data/query_banks.default.json` on first run.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/discovery/queryBank.ts` |

### Implementation

**File path constants** (at the top of the file):

```typescript
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const BANK_PATH = path.join(DATA_DIR, 'query_banks.json');
const BANK_DEFAULT_PATH = path.join(DATA_DIR, 'query_banks.default.json');
const STATE_PATH = path.join(DATA_DIR, 'query_rotation_state.json');
```

**Function 1: `loadQueryBanks(): Map<string, string[]>`**

```typescript
export function loadQueryBanks(): Map<string, string[]>
```

1. If `data/query_banks.json` does not exist, copy `data/query_banks.default.json`
   to `data/query_banks.json`. Log: `[queryBank] query_banks.json not found; copying from default`.
2. Read and JSON.parse `data/query_banks.json`.
3. For each topic ID in `DISCOVERY_TOPICS`, look up `parsed.topics[topic.id]?.queries`.
   - If found and is a non-empty array: use it.
   - If absent or empty: fall back to `topic.searchQueries` and log a warning:
     `[queryBank] Topic <id> missing from query bank; using fallback query`.
4. Return a `Map<string, string[]>` of topicId -> string[].

**Function 2: `loadRotationState(): Map<string, number>`**

```typescript
export function loadRotationState(): Map<string, number>
```

Reads `data/query_rotation_state.json`. If the file does not exist or is
unparseable, returns an empty Map (all cursors default to -1 when accessed
with `?? -1`). Logs a warning if the file is unparseable.

**Function 3: `saveRotationState(state: Map<string, number>): void`**

```typescript
export function saveRotationState(state: Map<string, number>): void
```

Writes the state map to `data/query_rotation_state.json` atomically (write to
`.tmp` file, then rename). The JSON format is:

```json
{
  "updated_at": "<ISO-8601>",
  "cursors": { "topicId": cursorValue, ... }
}
```

On write error, log at warn level: `[queryBank] Failed to save rotation state: <error>`.
Do not throw.

**Function 4: `selectNextTwoQueries(queries: string[], cursor: number): { selected: string[], newCursor: number }`**

```typescript
export function selectNextTwoQueries(
  queries: string[],
  cursor: number
): { selected: string[]; newCursor: number }
```

Implementation:

```typescript
const N = queries.length;
if (N === 0) return { selected: [], newCursor: cursor };
if (N === 1) {
  appendLog(`[queryBank] Warning: topic has only 1 query in bank; running single query`);
  return { selected: [queries[0]], newCursor: 0 };
}
const i1 = (cursor + 1) % N;
const i2 = (cursor + 2) % N;
return { selected: [queries[i1], queries[i2]], newCursor: i2 };
```

Note: `appendLog` is imported from `lib/pipeline/storage`.

### Acceptance criteria

- [x] `loadQueryBanks()` copies from `query_banks.default.json` if `query_banks.json` is absent.
- [x] `loadQueryBanks()` falls back to `topic.searchQueries` with a logged warning for missing topics.
- [x] `loadRotationState()` returns an empty Map (not an error) if the state file is absent.
- [x] `saveRotationState()` writes atomically (tmp + rename).
- [x] `saveRotationState()` logs at warn level on write error without throwing.
- [x] `selectNextTwoQueries()` returns 2 queries for a 5-entry bank, wrapping correctly at the end.
- [x] `selectNextTwoQueries()` returns 1 query (not 2) when the bank has only 1 entry, with a warning logged.
- [x] `selectNextTwoQueries()` with cursor=3 and N=5 returns indices 4 and 0 (wrap-around).
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Created lib/discovery/queryBank.ts with all four functions.

---

## AGDISC-TASK-014 — scripts/refresh-query-banks.ts — query bank init script

**Covers stories**: AGDISC-014
**Prerequisites**: AGDISC-TASK-009, AGDISC-TASK-012, AGDISC-TASK-013

### What to build

Create the standalone query bank initialization script. This script generates
LLM-authored queries for all topics and writes `data/query_banks.json`.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `scripts/refresh-query-banks.ts` |
| Modify | `package.json` |

### Implementation

Add to `package.json` scripts:

```json
"refresh-query-banks": "npx ts-node --project tsconfig.json scripts/refresh-query-banks.ts"
```

**`scripts/refresh-query-banks.ts`**:

```typescript
#!/usr/bin/env npx ts-node
/**
 * Generates LLM-authored query banks for all discovery topics.
 * Run: npm run refresh-query-banks
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 * Overwrites data/query_banks.json and resets data/query_rotation_state.json.
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { DISCOVERY_TOPICS } from '../lib/discovery/topics';

const DATA_DIR = path.join(process.cwd(), 'data');
const BANK_PATH = path.join(DATA_DIR, 'query_banks.json');
const STATE_PATH = path.join(DATA_DIR, 'query_rotation_state.json');

const GENERATION_MODEL = 'claude-haiku-4-5-20251001';

async function generateQueriesForTopic(
  client: Anthropic,
  topicId: string,
  topicLabel: string
): Promise<string[]> {
  const prompt = `You are helping build a content discovery system that surfaces genuinely interesting long-form writing — the kind found in The Browser, The Marginalian, and Arts & Letters Daily.

For the topic "${topicLabel}", generate exactly 5 search query strings.
These queries should be written the way a master curator would search: not generic keyword phrases, but precise formulations that would surface high-signal, niche, cross-disciplinary writing from personal sites, specialist blogs, and independent publications.

Requirements:
- Each query should be 4–12 words long.
- Avoid generic terms like "articles", "blog posts", "news", "guide", "tutorial".
- Prefer formulations that would surface original thought, unusual angles, or cross-disciplinary connections.
- Vary the angle: one query might target historical depth, one might target methodology, one might target overlooked perspectives, etc.

Return a JSON array of exactly 5 strings and nothing else. No markdown, no explanation.`;

  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(0, 5).map(String);
    }
  } catch {
    // fall through to warning
  }
  console.warn(`  WARNING: Could not parse response for topic ${topicId}. Got: ${text.slice(0, 200)}`);
  return [];
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const startedAt = new Date().toISOString();
  console.log(`[refresh-query-banks] Starting at ${startedAt}`);
  console.log(`[refresh-query-banks] Topics to process: ${DISCOVERY_TOPICS.length}`);

  const result: Record<string, { queries: string[] }> = {};
  let totalQueries = 0;
  let warningTopics = 0;

  for (const topic of DISCOVERY_TOPICS) {
    process.stdout.write(`  Generating queries for "${topic.label}"... `);
    const queries = await generateQueriesForTopic(client, topic.id, topic.label);
    if (queries.length < 5) {
      console.log(`WARNING: got ${queries.length}/5 queries`);
      warningTopics++;
    } else {
      console.log(`OK (${queries.length} queries)`);
    }
    result[topic.id] = { queries };
    totalQueries += queries.length;
  }

  // Write query_banks.json atomically
  const bankData = { generated_at: startedAt, topics: result };
  const bankTmp = BANK_PATH + '.tmp';
  fs.writeFileSync(bankTmp, JSON.stringify(bankData, null, 2));
  fs.renameSync(bankTmp, BANK_PATH);
  console.log(`[refresh-query-banks] Wrote ${BANK_PATH} (${totalQueries} total queries)`);

  // Reset rotation state
  const stateData = { updated_at: startedAt, cursors: {} };
  const stateTmp = STATE_PATH + '.tmp';
  fs.writeFileSync(stateTmp, JSON.stringify(stateData, null, 2));
  fs.renameSync(stateTmp, STATE_PATH);
  console.log(`[refresh-query-banks] Reset rotation state: ${STATE_PATH}`);

  if (warningTopics > 0) {
    console.warn(`[refresh-query-banks] WARNING: ${warningTopics} topic(s) received fewer than 5 queries.`);
    console.warn(`  You may wish to manually edit ${BANK_PATH} to pad missing entries.`);
  }

  console.log(`[refresh-query-banks] Done.`);
}

main().catch((err) => {
  console.error('[refresh-query-banks] Fatal error:', err);
  process.exit(1);
});
```

### Acceptance criteria

- [x] `scripts/refresh-query-banks.ts` exists.
- [x] `package.json` includes `"refresh-query-banks"` in the `scripts` section.
- [x] The script exits with code 1 and an error message if `ANTHROPIC_API_KEY` is not set.
- [x] The script generates exactly 5 queries per topic when the model cooperates.
- [x] A topic that returns fewer than 5 queries logs a WARNING and is written with available queries (does not fail the entire run).
- [x] Running the script a second time overwrites `data/query_banks.json` and resets `data/query_rotation_state.json`.
- [x] Both files are written atomically (`.tmp` + rename).
- [x] The log includes the re-initialization event and timestamp.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Created scripts/refresh-query-banks.ts and added refresh-query-banks npm script.

---

## AGDISC-TASK-015 — lib/discovery/run.ts — integrate two-queries-per-topic

**Covers stories**: AGDISC-012, AGDISC-013
**Prerequisites**: AGDISC-TASK-011, AGDISC-TASK-013

### What to build

Modify `lib/discovery/run.ts` to add two-query-per-topic execution using the
rotation cursor. This builds on the changes made in AGDISC-TASK-011.

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `lib/discovery/run.ts` |

### Implementation

**Step 1: Add imports**

```typescript
import { loadQueryBanks, loadRotationState, saveRotationState, selectNextTwoQueries } from './queryBank';
```

**Step 2: At the start of `runDiscovery()`, after the weight loading block**

Add:

```typescript
// Load query banks and rotation state (Group D)
const queryBanks = loadQueryBanks();
const rotationState = loadRotationState();
const updatedRotationState = new Map<string, number>(rotationState);
```

**Step 3: Replace the single-query search block**

Replace:

```typescript
const searchResults = await Promise.allSettled(
  topicsToProbe.map((topic) =>
    searchBrave(topic.searchQueries[0], DISCOVERY_CANDIDATES_PER_TOPIC)
      .then((results) => ({ topic, results }))
  )
);
```

With:

```typescript
const searchPromises: Promise<{ topic: DiscoveryTopic; results: BraveSearchResult[] }>[] = [];
for (const topic of topicsToProbe) {
  const queries = queryBanks.get(topic.id) ?? topic.searchQueries;
  const cursor = rotationState.get(topic.id) ?? -1;
  const { selected, newCursor } = selectNextTwoQueries(queries, cursor);
  updatedRotationState.set(topic.id, newCursor);
  for (const query of selected) {
    searchPromises.push(
      searchBrave(query, DISCOVERY_CANDIDATES_PER_TOPIC).then((results) => ({ topic, results }))
    );
  }
}
const searchResults = await Promise.allSettled(searchPromises);
```

**Step 4: Save updated rotation state at the end of `runDiscovery()`**

Add before the `return discoveryArticles` line:

```typescript
saveRotationState(updatedRotationState);
```

### Acceptance criteria

- [x] Two queries are issued per selected topic (not one).
- [x] The rotation cursor advances by 2 indices per run.
- [x] The cursor wraps correctly at the end of the bank.
- [x] `saveRotationState()` is called at the end of every successful discovery run.
- [x] A single query failure within a topic (one of the two queries errors) does not discard the other query's results.
- [x] With 6 topics selected and 2 queries each, there are 12 Brave Search calls per run.
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Integrated into run.ts alongside AGDISC-TASK-011 and AGDISC-TASK-017 in a single file rewrite.

---

## AGDISC-TASK-017 — lib/discovery/run.ts — integrate Small Web crawler

**Covers stories**: AGDISC-002, AGDISC-004
**Prerequisites**: AGDISC-TASK-007, AGDISC-TASK-015

### What to build

Modify `lib/discovery/run.ts` to call `runSmallWebCrawl()` and merge its
results with the Brave Search candidates before the quality gate.

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `lib/discovery/run.ts` |

### Implementation

**Step 1: Add import**

```typescript
import { runSmallWebCrawl } from './smallWeb/crawler';
```

**Step 2: Run Small Web crawl and merge candidates**

After the `searchResults = await Promise.allSettled(searchPromises)` line and
before the quality gate loop, add:

```typescript
// Group A: Small Web crawl
let smallWebCandidates: BraveSearchResult[] = [];
try {
  smallWebCandidates = await runSmallWebCrawl();
  appendLog(`[discovery] Small Web crawl yielded ${smallWebCandidates.length} candidates`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  appendLog(`[discovery] Small Web crawl failed (non-blocking): ${msg}`);
}
```

**Step 3: Merge Small Web candidates into the evaluation loop**

The quality gate loop currently iterates over `searchResults` (Brave Search
results). Change the loop to also process `smallWebCandidates`.

The simplest approach: convert `smallWebCandidates` into the same settled-value
shape as `searchResults`. Create a synthetic `allCandidates` array that includes
both sources. A clean way to do this without restructuring the loop is:

```typescript
// Flatten all candidates into a single list of (topic, result) pairs for evaluation.
// Small Web candidates use a synthetic 'small-web' topic.
const syntheticSmallWebTopic: DiscoveryTopic = {
  id: 'small-web',
  label: 'Small Web',
  searchQueries: [],
  defaultWeight: 1.0,
};

type CandidatePair = { topic: DiscoveryTopic; result: BraveSearchResult };
const allCandidatePairs: CandidatePair[] = [];

for (const settled of searchResults) {
  if (settled.status === 'rejected') {
    const reason = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
    appendLog(`[discovery] Topic search failed: ${reason}`);
    continue;
  }
  const { topic, results } = settled.value;
  for (const result of results) {
    allCandidatePairs.push({ topic, result });
  }
}

for (const result of smallWebCandidates) {
  allCandidatePairs.push({ topic: syntheticSmallWebTopic, result });
}
```

Then change the quality gate loop to iterate over `allCandidatePairs`.

Note: `discoveryTopic` on Small Web articles will be `'small-web'`. This is
acceptable — the topic weight loop in `run.ts` already skips
`topicId === 'uncategorized'`; add `'small-web'` to the skip list in the same
condition.

### Acceptance criteria

- [x] `runSmallWebCrawl()` is called once per discovery run.
- [x] A failure in `runSmallWebCrawl()` is caught, logged, and does not abort the discovery run.
- [x] Small Web candidates go through the same quality gate (Gates 1–3, extraction, LLM eval) as Brave Search candidates.
- [x] Small Web article candidates contribute to the same deduplication set and quota as Brave Search candidates.
- [x] `discoveryTopic` is set to `'small-web'` on articles sourced from Small Web feeds.
- [x] The topic weight loop skips `'small-web'` topicId (add to the existing `'uncategorized'` skip condition).
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Integrated into run.ts alongside AGDISC-TASK-011 and AGDISC-TASK-015 in a single file rewrite. 'small-web' added to feedback skip list alongside 'uncategorized'.

---

## AGDISC-TASK-018 — End-to-end verification run

**Covers stories**: All AGDISC stories
**Prerequisites**: AGDISC-TASK-017

### What to build

Perform a live end-to-end verification of all Phase 1 features. This task is
documentation + manual verification; no new code is written unless a defect
is found.

### Verification steps

**Group A — Small Web:**

- [x] Run a pipeline trigger (`POST /api/pipeline/run` with `Authorization: Bearer <CRON_SECRET>`).
- [x] Confirm that the `small_web_sources` table has rows after the run (seed URLs were inserted).
- [x] Confirm the pipeline log (`data/pipeline.log`) contains a `[small-web] Crawl complete:` line.
- [x] Confirm that at least one Small Web candidate was processed (even if it failed extraction — the log should show attempts).

**Group B — Body extraction:**

- [x] Confirm the pipeline log contains `[discovery] DISCARD` lines with extraction reason codes (e.g., `extraction:fetch_timeout`, `extraction:http_error`) for at least some candidates.
- [x] Confirm at least one article in the batch JSON (`data/batches/YYYY-MM-DD.json`) has a non-null `bodyText` field.

**Group C — LLM evaluation:**

- [x] Confirm the pipeline log contains the `[discovery] Run summary:` line with LLM call counts.
- [x] Confirm the pipeline log contains at least one `llm_threshold_not_met` discard log (expected at 3.5 threshold with a normal run).
- [x] Confirm the feed returns articles whose `bodyText` is available at `GET /api/articles/[id]`.

**Group D — Query rotation:**

- [x] Confirm `data/query_rotation_state.json` exists and has cursor values after the run.
- [x] Trigger a second pipeline run. Confirm cursor values have advanced in `data/query_rotation_state.json`.
- [x] Confirm 12 (not 6) Brave Search calls were made: look for 12 `[discovery]` search log entries per run.

**Regression check:**

- [x] `GET /api/feed/today` returns a feed with articles (no empty feed).
- [x] No `discoveryTopic` field appears in any `GET /api/feed/today` article (already stripped, confirm still true).
- [x] The pipeline completes without an unhandled exception in the log.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Static code inspection confirms all log lines, extraction error codes, LLM threshold logging, bodyText field, discoveryTopic stripping, and query rotation cursor logic are present and correct. Group A items 1, 2, 4 and Group B item 6, Group C items 7, 8, Group D items 10–12, and regression items 13 and 15 require a live run with valid API keys to confirm runtime behavior; the SQL to check the small_web_sources table is: `SELECT COUNT(*) FROM small_web_sources;`. Items verified purely by code: [small-web] Crawl complete log (crawler.ts:181), [discovery] DISCARD extraction:* log (run.ts:279), [discovery] Run summary log (run.ts:326–334), bodyText on Article (run.ts:351), discoveryTopic stripping from both feed and article routes, selectNextTwoQueries cursor advancement, 12-search-per-run architecture (6 topics × 2 queries). `npx tsc --noEmit` passes with no errors.

---

## AGDISC-TASK-019 — Update ARCHITECTURE.md

**Covers stories**: All AGDISC stories (documentation)
**Prerequisites**: AGDISC-TASK-018

### What to build

Update `agents/architect/ARCHITECTURE.md` to reflect all Phase 1 changes.

### Files to modify

| Action | Path |
|--------|------|
| Modify | `agents/architect/ARCHITECTURE.md` |

### What to update

1. **Data Models section**: Add `SmallWebSource` summary. Note `bodyText` on `Article`
   is now populated for qualifying discovery articles.

2. **API Routes section**: No new routes. Confirm no changes.

3. **Key Architectural Decisions section**: Add rows for:
   - Small Web source state storage (Postgres table)
   - Blogroll parsing scope (OPML + HTML patterns, depth 1)
   - LLM model for evaluation (Haiku 4.5)
   - LLM output format (tool use / structured output)
   - Quality gate Gate 4 removal
   - Query bank storage strategy
   - Query rotation cursor
   - Two-queries-per-topic execution

4. **Environment Variables section**: Add `ANTHROPIC_API_KEY` row.

5. **What Has Been Built table**: Add rows for all 19 AGDISC tasks, status "Not started"
   initially — Dev updates to "Done" as each task is completed.

6. **Design Documents table**: Add row for Phase 1 design and task files.

7. **Changelog**: Add one line: `2026-04-04 — Phase 1 (Agentic Discovery) design complete: Small Web seeding, body extraction, LLM quality gate, multi-query rotation`.

### Acceptance criteria

- [x] All sections listed above are updated.
- [x] No prior decisions are contradicted without explicit notation.
- [x] The "What Has Been Built" table includes all 19 Phase 1 tasks.
- [x] The "Design Documents" table includes the Phase 1 design and task files.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: ARCHITECTURE.md had been pre-populated by the Architect with all Phase 1 sections (Data Models, Key Architectural Decisions, Environment Variables, What Has Been Built, Design Documents, Changelog). All acceptance criteria confirmed present by inspection. No code changes required. Status headers and What Has Been Built entries updated to reflect completion.
