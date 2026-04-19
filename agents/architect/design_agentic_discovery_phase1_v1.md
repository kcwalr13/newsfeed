# Technical Design — Agentic Content Discovery, Phase 1

**ID**: ARCH-DESIGN-AGDISC-001
**Stories Reference**: `agents/pm/stories_agentic_discovery_phase1.md` (AGDISC-001 through AGDISC-014)
**BRD Reference**: `agents/ba/brd_agentic_discovery_phase1.md` (BRD-007)
**Date**: 2026-04-04
**Status**: Final
**Author**: Architect Agent

---

## Table of Contents

1. Architecture Overview
2. Group A — Small Web Source State Store
3. Group A — Blogroll Parsing Scope and Feed Discovery
4. Group A — Crawl Scheduler and Throttle Strategy
5. Group A — Small Web Article Fetching
6. Group B — Article Body Text Extraction Module
7. Group C — LLM Content Evaluator Module
8. Group C — Quality Gate Replacement
9. Group D — Multi-Query Topic Bank Schema and Storage
10. Group D — Query Rotation Cursor
11. Group D — Two-Queries-Per-Topic Execution
12. Group D — Query Bank Initialization Script
13. New Constants in lib/config/feed.ts
14. Discovery Orchestrator Integration Points
15. Key Decisions Table
16. External Dependencies and Environment Variables
17. Deferred Items
18. Directory Map

---

## 1. Architecture Overview

Phase 1 augments the existing discovery layer with four parallel improvements.
None of them change the downstream pipeline, feed API, or client. The
`runDiscovery()` signature and return type are unchanged. The pipeline
orchestrator in `lib/pipeline/run.ts` is not touched.

```
POST /api/pipeline/run
  |
  |-- runPipeline()
  |     |-- fixed sources (RSS + NewsAPI) [unchanged]
  |
  |-- runDiscovery(fixedArticleUrls, userId, deviceId)  [extended, not replaced]
  |     |
  |     |-- Group D: loadQueryBanks()          data/query_banks.json
  |     |-- Group D: loadRotationState()       data/query_rotation_state.json
  |     |-- Group D: selectTwoQueriesPerTopic() cursor-based selection
  |     |-- existing: selectTopics()           weighted random
  |     |-- Group D: searchBrave(q1) + searchBrave(q2) per selected topic
  |     |-- Group A: runSmallWebCrawl()        lib/discovery/smallWeb/crawler.ts
  |     |         |-- checkCooldowns()         reads small_web_sources table
  |     |         |-- fetchFeed(source)        rss-parser
  |     |         |-- parseBlogrolls(html)     lib/discovery/smallWeb/blogroll.ts
  |     |         |-- discoverNewSources()     writes small_web_sources table
  |     |
  |     |-- candidates = [braveResults..., smallWebResults...]
  |     |
  |     |-- for each candidate:
  |     |     |-- Gate 1-3: validator, freshness, blocklist [unchanged, fast]
  |     |     |-- Group B: extractBodyText(url) lib/discovery/bodyExtractor.ts
  |     |     |-- Group C: evaluateWithLLM(title, desc, body) lib/discovery/llmEvaluator.ts
  |     |     |-- composite score >= LLM_EVAL_THRESHOLD => pass
  |     |
  |     |-- dedup (existing URL canonicalization)
  |     |-- quota enforcement (existing DISCOVERY_ARTICLES_PER_DAY)
  |     |-- Group D: saveRotationState()
  |     |-- return Article[]

scripts/refresh-query-banks.ts  [standalone, not called by pipeline]
  |-- generates 5 queries per topic via Claude Haiku
  |-- writes data/query_banks.json
  |-- resets data/query_rotation_state.json
```

The Small Web crawler runs inside `runDiscovery()` and its results are merged
with Brave Search results before the quality gate. This is the natural
integration point because `runDiscovery` already owns candidate collection,
deduplication, and quota enforcement.

---

## 2. Group A — Small Web Source State Store

**Decision**: Postgres table (not a JSON file).

### Rationale

The PM flagged this as an Architect decision. A Postgres table is chosen over a
JSON file for the following reasons:

- Cooldown enforcement requires querying by `cooldown_until < NOW()`, which is a
  natural SQL predicate and awkward with file I/O.
- Atomic upsert semantics are built into Postgres (`INSERT ... ON CONFLICT DO UPDATE`).
  JSON file atomicity requires a tmp-file-rename pattern on every write.
- The source pool will grow organically via blogroll expansion. A 500-row JSON file
  is inspectable; a 5,000-row file is not. Postgres handles both sizes transparently.
- Neon (already in use) is available; no new infrastructure is added.

### DDL

```sql
CREATE TABLE small_web_sources (
  id               SERIAL PRIMARY KEY,
  url              TEXT NOT NULL UNIQUE,          -- normalized homepage URL
  feed_url         TEXT,                          -- RSS/Atom feed URL (null until discovered)
  last_crawled_at  TIMESTAMPTZ,                   -- null if never crawled
  last_yielded_at  TIMESTAMPTZ,                   -- null if never yielded a qualifying article
  yield_count      INTEGER NOT NULL DEFAULT 0,    -- total qualifying articles yielded lifetime
  consecutive_zero_yields INTEGER NOT NULL DEFAULT 0, -- reset to 0 on any qualifying yield
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprioritized')),
  cooldown_until   TIMESTAMPTZ,                   -- null = no active cooldown
  discovered_via   TEXT NOT NULL DEFAULT 'seed'   CHECK (discovered_via IN ('seed', 'blogroll')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_small_web_sources_status_cooldown
  ON small_web_sources (status, cooldown_until);
```

### TypeScript Type

```typescript
// lib/types/smallWeb.ts
export interface SmallWebSource {
  id: number;
  url: string;
  feed_url: string | null;
  last_crawled_at: string | null;     // ISO-8601
  last_yielded_at: string | null;     // ISO-8601
  yield_count: number;
  consecutive_zero_yields: number;
  status: 'active' | 'deprioritized';
  cooldown_until: string | null;      // ISO-8601
  discovered_via: 'seed' | 'blogroll';
  created_at: string;                 // ISO-8601
}
```

### Seed Data Strategy

Seed URLs are stored in `lib/discovery/smallWeb/seeds.ts` as a committed
TypeScript constant — not hardcoded in crawler logic. At first run, the crawler
calls `seedSourcesIfEmpty()` in `lib/db/smallWeb.ts`, which inserts seed URLs
with `INSERT ... ON CONFLICT DO NOTHING`. Subsequent runs do nothing.

Initial seed list (three curated directories as specified in BRD-007):

```typescript
export const SMALL_WEB_SEED_URLS: string[] = [
  'https://ooh.directory',
  'https://blogroll.org',
  'https://indieweb.org/people',
];
```

These three directories are the entry points. The crawler fetches their pages,
parses them for blogroll/member links, and adds discovered sites to the source
table. The directory pages themselves are not crawled for articles.

### DB Helper Module

**File**: `lib/db/smallWeb.ts`

```typescript
export async function seedSourcesIfEmpty(): Promise<void>
export async function getEligibleSources(): Promise<SmallWebSource[]>
export async function upsertSource(url: string, feedUrl: string | null, discoveredVia: 'seed' | 'blogroll'): Promise<void>
export async function markCrawled(url: string, yieldedCount: number): Promise<void>
export async function deprioritizeSource(url: string): Promise<void>
```

`getEligibleSources()` returns sources where either:
- `status = 'active'` AND (`last_crawled_at IS NULL` OR `last_crawled_at < NOW() - INTERVAL '7 days'`)
- `status = 'deprioritized'` AND (`last_crawled_at IS NULL` OR `last_crawled_at < NOW() - INTERVAL '30 days'`)

`markCrawled()` updates `last_crawled_at = NOW()`, increments
`consecutive_zero_yields` if `yieldedCount = 0` (resets it to 0 otherwise),
updates `last_yielded_at` and `yield_count` if `yieldedCount > 0`, and sets
`cooldown_until = NOW() + INTERVAL '7 days'`. If `consecutive_zero_yields`
reaches 4 after this update, it also calls `deprioritizeSource()`.

---

## 3. Group A — Blogroll Parsing Scope and Feed Discovery

### What Counts as a Blogroll

The parser (`lib/discovery/smallWeb/blogroll.ts`) recognizes two formats:

**Format 1: OPML files** — `<a href="*.opml">` links found anywhere in the page.
The OPML file is fetched and parsed using `fast-xml-parser`. All `<outline>`
elements with a `htmlUrl` or `xmlUrl` attribute are treated as linked sites.
Maximum depth: 1. OPML files found inside an OPML file are not followed.

**Format 2: HTML blogroll links** — `<a rel="blogroll" href="...">` anchor tags.
These may point to individual sites or to OPML files; the parser handles both.

**Format 3: Common blogroll link patterns** — `<a>` tags inside elements with
class/id containing `blogroll`, or inside a `<nav>` element or `<aside>` element,
where the href is an external domain (different origin from the source page). This
is heuristic and covers the majority of handcrafted IndieWeb blogrolls.

### Feed Discovery

For each candidate URL found in a blogroll:

1. Fetch the site's HTML `<head>` (using a HEAD or GET request with a short timeout).
2. Look for `<link rel="alternate" type="application/rss+xml">` or
   `<link rel="alternate" type="application/atom+xml">`.
3. If found, record `feed_url`.
4. If not found in `<head>`, try common paths: `/feed`, `/rss`, `/feed.xml`,
   `/atom.xml`, `/rss.xml`. Issue a HEAD request to each; the first 200 response
   with a content-type containing `xml` is accepted.
5. If no feed is found, the site is not added to the source pool.

### Pool Expansion Cap

A maximum of **20 new sources per crawl run** are added to the source pool. If a
single blogroll or crawl run discovers more than 20 candidates with valid feeds,
only the first 20 (by order of discovery) are inserted. This prevents a single
unusually large OPML file from flooding the pool.

This constant is `SMALL_WEB_MAX_NEW_SOURCES_PER_RUN = 20` in `lib/config/feed.ts`.

---

## 4. Group A — Crawl Scheduler and Throttle Strategy

### Integration Point

`runSmallWebCrawl()` is called inside `runDiscovery()`, before the Brave Search
queries, so that Small Web article candidates are available for the same quality
gate pass as Brave Search candidates.

```typescript
// Inside runDiscovery():
const smallWebCandidates = await runSmallWebCrawl();
// smallWebCandidates is BraveSearchResult-shaped (same interface)
```

### Per-Source Throttle

All requests to a single domain are sequential (not concurrent). This is
enforced by running source crawls in a `for...of` loop (not `Promise.all`).
A 1-second delay is inserted between sources to avoid appearing as a DDoS to
small personal sites.

This means the Small Web crawl is not parallelized across sources. At 20 active
sources per run (first run with a fresh pool), with 2 HTTP requests per source
(feed fetch + blogroll check) at ~1 second per request plus 1-second throttle,
this adds roughly 60 seconds to a pipeline run. This is acceptable for an
offline, once-daily run. If the pool grows large, only sources past their
cooldown are crawled; most sources are skipped most days.

### Failure Isolation

Each source crawl is wrapped in a `try/catch`. A failure logs the source URL
and error, and the loop continues with the next source.

### Crawl Run Summary Log

At the end of `runSmallWebCrawl()`, a single `[small-web]` log line is written
at info level:

```
[small-web] Crawl complete: 8 attempted, 2 skipped (cooldown), 1 failed, 12 candidates yielded, 3 new sources discovered
```

---

## 5. Group A — Small Web Article Fetching

### Return Shape

`runSmallWebCrawl()` returns `BraveSearchResult[]`. This is the same type used
by the Brave Search adapter. This means the quality gate, deduplication, and
quota logic receive a single merged candidate list with no awareness of origin.

The mapping from an RSS feed item to `BraveSearchResult`:

| RSS field | BraveSearchResult field |
|-----------|------------------------|
| `item.title` | `title` |
| `item.link` | `url` |
| `item.contentSnippet` or `item.content` (truncated to 300 chars) | `description` |
| `item.isoDate` or `item.pubDate` (parsed) | `publishedAt` |
| Feed `channel.title` or domain name | `sourceName` |
| `https://<domain>` of feed URL | `sourceUrl` |

`description` is required by Gate 1 of the quality gate (`MISSING_DESCRIPTION`).
If neither `contentSnippet` nor `content` is available, use the first 300
characters of the article's title repeated — no, actually: skip the item and
log `MISSING_DESCRIPTION`. Do not invent descriptions.

### Freshness Filter

The existing `DISCOVERY_MAX_AGE_HOURS = 72` constant applies. Articles older
than 72 hours are discarded after parsing, before being added to the candidate
list. The quality gate will re-apply this check, but pre-filtering reduces noise
in the logs.

---

## 6. Group B — Article Body Text Extraction Module

**File**: `lib/discovery/bodyExtractor.ts`

### Dependencies

```
@mozilla/readability  ^0.5.x   (latest stable as of 2026-04-04)
jsdom                 ^24.x    (latest stable as of 2026-04-04)
```

Both packages run server-side only. They must never be imported from any
client component or client-side module. The `bodyExtractor.ts` module
must include a comment at the top: `// SERVER-SIDE ONLY — never import in browser bundles`.

jsdom v24 is compatible with Node.js 20 (the LTS used by Next.js 14+). No known
incompatibilities with the current runtime.

### Interface

```typescript
export type ExtractionFailureReason =
  | 'fetch_timeout'
  | 'http_error'
  | 'extraction_failed'
  | 'below_minimum_length';

export interface ExtractionSuccess {
  success: true;
  bodyText: string;       // plain text, HTML stripped, not truncated
}

export interface ExtractionFailure {
  success: false;
  reason: ExtractionFailureReason;
  detail?: string;        // e.g. HTTP status code for http_error
}

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

export async function extractBodyText(url: string): Promise<ExtractionResult>
```

### Algorithm

1. Issue `fetch(url, { signal: AbortSignal.timeout(8000) })`.
   - `AbortSignal.timeout(8000)` is built into Node.js 18+. On abort, catch the
     `AbortError` and return `{ success: false, reason: 'fetch_timeout' }`.
2. Check response status. If not 2xx, return
   `{ success: false, reason: 'http_error', detail: String(response.status) }`.
3. Read the response as text. Pass to `new JSDOM(html, { url })`.
4. Pass `dom.window.document` to `new Readability(document).parse()`.
5. If `parse()` returns null or `result.textContent` is falsy, return
   `{ success: false, reason: 'extraction_failed' }`.
6. Strip any remaining HTML tags from `result.textContent` using a simple regex
   (`/<[^>]*>/g`, `''`). Normalize whitespace.
7. Count whitespace-separated tokens. If token count < 300, return
   `{ success: false, reason: 'below_minimum_length' }`.
8. Return `{ success: true, bodyText: text }`. Do not truncate here; the LLM
   caller truncates to 3,000 characters before the API call.

### Testability

The module is testable via dependency injection. Export a second function:

```typescript
export async function extractBodyTextFromHtml(
  html: string,
  url: string
): Promise<ExtractionResult>
```

This allows tests to pass raw HTML strings without making real HTTP requests.
The main `extractBodyText()` fetches the URL and calls `extractBodyTextFromHtml()`
with the response body.

---

## 7. Group C — LLM Content Evaluator Module

**File**: `lib/discovery/llmEvaluator.ts`

### Model

`claude-haiku-4-5-20251001` (Claude Haiku 4.5). This model ID is stored as a
named constant:

```typescript
const LLM_EVAL_MODEL = 'claude-haiku-4-5-20251001';
```

This constant is local to `llmEvaluator.ts`. It is not exported to
`lib/config/feed.ts` because it is an implementation detail of the evaluator
module, not a tuning constant for the operator.

### Dependency

```
@anthropic-ai/sdk   ^0.39.x  (latest stable as of 2026-04-04; supports claude-haiku-4-5)
```

This is a new `dependencies` entry in `package.json` (not devDependencies).

### Cost Estimate

At 30–60 candidates/day after pre-filtering:

- Input: ~3,000 characters body + ~200 characters title/description + ~500 characters system prompt ≈ 3,700 characters ≈ ~1,000 tokens per call.
- Output: ~100 tokens (structured JSON with 5 scores and brief rationale).
- Haiku 4.5 pricing: $0.80/MTok input, $4.00/MTok output (approximate).
- Per call: ($0.80 × 1,000 / 1,000,000) + ($4.00 × 100 / 1,000,000) = $0.00080 + $0.00040 = $0.00120.
- At 60 calls/day × 30 days = 1,800 calls/month: $2.16/month.

This is within acceptable bounds for a single-user app.

### Prompt Design

The evaluator uses the Anthropic tool use / structured output feature to enforce
JSON output. A single tool named `score_article` is defined with the expected
output schema. This eliminates fragile response parsing.

**System prompt** (approximate — Dev must implement exactly this intent):

```
You are an editorial evaluator for a personalized content discovery system.
Your task is to assess whether a piece of writing meets a high curatorial bar —
the kind of writing that would be recommended by publications like The Browser,
The Marginalian, or Arts & Letters Daily.

Evaluate the article across exactly five dimensions. For each dimension, assign
an integer score from 1 (very low) to 5 (very high).

Dimensions:
- intellectual_substance: Does the piece develop a real argument, finding, or
  insight? Is there something the reader would not know after reading a generic
  summary on the topic?
- originality: Does the author have a distinct perspective, voice, or angle?
  Does it reflect genuine independent thought rather than recapping known information?
- cross_disciplinary_appeal: Does the piece connect ideas across domains, or draw
  on an unusual combination of fields? Would it interest someone outside the
  specific subject area?
- evergreen_durability: Will this piece still be worth reading in a year?
  Is it anchored to a transient news event, or does it address something foundational?
- writing_quality: Is the prose clear, precise, and crafted with care?
  Is it worth reading for the writing itself, not just the information?

Score as a thoughtful, widely-read editor — not as a classifier pattern-matching
on surface signals. A 5 means genuinely exceptional. A 3 means adequate but
unremarkable. A 1 means generic, poorly written, or purely informational without
insight.
```

**Tool schema** (the `score_article` tool):

```typescript
{
  name: 'score_article',
  description: 'Return quality scores for the article.',
  input_schema: {
    type: 'object',
    properties: {
      intellectual_substance: { type: 'integer', minimum: 1, maximum: 5 },
      originality:            { type: 'integer', minimum: 1, maximum: 5 },
      cross_disciplinary_appeal: { type: 'integer', minimum: 1, maximum: 5 },
      evergreen_durability:   { type: 'integer', minimum: 1, maximum: 5 },
      writing_quality:        { type: 'integer', minimum: 1, maximum: 5 },
    },
    required: [
      'intellectual_substance', 'originality',
      'cross_disciplinary_appeal', 'evergreen_durability', 'writing_quality'
    ]
  }
}
```

**User message** (built at call time):

```
Title: <title>
Description: <description>
Body (first 3000 characters): <bodyText.slice(0, 3000)>
```

### Interface

```typescript
export interface LLMScores {
  intellectual_substance: number;
  originality: number;
  cross_disciplinary_appeal: number;
  evergreen_durability: number;
  writing_quality: number;
  composite: number;   // arithmetic mean, rounded to 2 decimal places
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

export async function evaluateWithLLM(
  title: string,
  description: string,
  bodyText: string
): Promise<LLMEvalResult>
```

### Composite Score Computation

```typescript
const scores = [
  result.intellectual_substance,
  result.originality,
  result.cross_disciplinary_appeal,
  result.evergreen_durability,
  result.writing_quality,
];
const composite = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
```

### Error Handling

- Network error or non-2xx from Anthropic API: catch, return
  `{ success: false, reason: 'api_error', detail: err.message }`.
- Tool use response missing expected fields or containing out-of-range values:
  return `{ success: false, reason: 'parse_error' }`.
- No retry logic in Phase 1.

### Testability

Export a second function for testing:

```typescript
export async function evaluateWithLLMClient(
  client: Anthropic,
  title: string,
  description: string,
  bodyText: string
): Promise<LLMEvalResult>
```

`evaluateWithLLM()` creates the Anthropic client from `process.env.ANTHROPIC_API_KEY`
and calls `evaluateWithLLMClient()`. Tests inject a mock client.

---

## 8. Group C — Quality Gate Replacement

### What Changes in qualityGate.ts

Gate 4 (the specificity heuristic, `computeSpecificityScore()`) is **removed**.
The `QualityGateResult` type loses `specificityScore` (it was only meaningful for
Gate 4). The `evaluateCandidate()` function remains a synchronous pure function
covering Gates 1–3 only.

The new `evaluateCandidate()` signature:

```typescript
export interface QualityGateResult {
  pass: boolean;
  reason?: string;
}

export function evaluateCandidate(
  candidate: BraveSearchResult,
  nowMs?: number
): QualityGateResult
```

Note: `computeSpecificityScore()` is also deleted. Existing test coverage of
the specificity heuristic is removed and replaced with tests for the new flow.

### Quality Gate Orchestration in runDiscovery

The quality gate evaluation is now a multi-step async operation. The gating
logic is moved into a private helper inside `run.ts`:

```typescript
async function evaluateCandidateFull(
  candidate: BraveSearchResult,
  topic: DiscoveryTopic,
  stats: EvalStats
): Promise<{ qualified: boolean; article?: Article }>
```

Execution order:
1. Call `evaluateCandidate(candidate)` (Gates 1–3, synchronous). If fail, log and return.
2. Call `extractBodyText(candidate.url)`. If failure, log with reason code, increment `stats.extractionFailed[reason]`, return.
3. Call `evaluateWithLLM(candidate.title, candidate.description, bodyExtracted.bodyText)`. If failure, log with reason, increment `stats.llmFailed[reason]`, return.
4. If `scores.composite < LLM_EVAL_THRESHOLD`, log debug with all five scores and `"llm_threshold_not_met"`, return.
5. Build the full `Article` object. Set `bodyText = bodyExtracted.bodyText`. Return qualified.

### EvalStats for Observability (AGDISC-010)

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

At the end of `runDiscovery()`, one info-level log line is written:

```
[discovery] Run summary: 45 candidates, 8 extraction failures (3 fetch_timeout, 2 http_error, 2 extraction_failed, 1 below_minimum_length), 2 LLM failures (1 parse_error, 1 api_error), 12 below threshold, 23 passed, 6 qualified after dedup+quota. LLM: 25 calls, 23 pass, 12 fail, 4210ms total
```

---

## 9. Group D — Multi-Query Topic Bank Schema and Storage

### Two Runtime Files

Both files live in `data/` and are gitignored:

**`data/query_banks.json`** — authoritative query content at runtime.
**`data/query_rotation_state.json`** — per-topic cursor state.

**`data/query_banks.default.json`** is committed to git as the seed. It is
copied to `data/query_banks.json` on first run if the latter is absent.

### query_banks.json Schema

```json
{
  "generated_at": "2026-04-04T00:00:00Z",
  "topics": {
    "fringe-science": {
      "queries": [
        "query string 1",
        "query string 2",
        "query string 3",
        "query string 4",
        "query string 5"
      ]
    },
    "music-audio-culture": { "queries": [...] }
  }
}
```

Keys in `topics` are the `id` values from `DISCOVERY_TOPICS`. Any topic ID
absent from the file is treated as missing; the system falls back to
`searchQueries[0]` from `topics.ts` for that topic and logs a warning.

### query_rotation_state.json Schema

```json
{
  "updated_at": "2026-04-04T12:00:00Z",
  "cursors": {
    "fringe-science": 2,
    "music-audio-culture": 0
  }
}
```

`cursors[topicId]` is the index of the last query executed for that topic.
If a topic's cursor is absent, it defaults to -1 (meaning "start from index 0
on the next run").

### Relationship Between topics.ts and query_banks.json

`lib/discovery/topics.ts` remains the source of truth for topic metadata (id,
label, defaultWeight). The `searchQueries` field on `DiscoveryTopic` is retained
but its role changes: it is the fallback query array used when `query_banks.json`
is absent or a topic is missing from the bank. The bank file overrides it at
runtime.

A new function `loadQueryBanks()` in `lib/discovery/queryBank.ts` merges the
two sources:

```typescript
export function loadQueryBanks(): Map<string, string[]>
// Returns topicId -> string[] of queries.
// For each topic, uses query_banks.json if present and non-empty;
// falls back to topic.searchQueries otherwise.
// Creates data/query_banks.json from data/query_banks.default.json if absent.
```

### Atomic Writes

Both JSON files are written using the tmp-file-rename pattern:
write to `<path>.tmp`, then `fs.renameSync(tmp, target)`. This is the file
atomicity equivalent required because Postgres is not used for these state files.

---

## 10. Group D — Query Rotation Cursor

### Selection Algorithm

Given a topic's query bank of size N and cursor value C (last index executed):

```typescript
function selectNextTwoQueries(queries: string[], cursor: number): { selected: string[], newCursor: number } {
  const N = queries.length;
  if (N === 0) return { selected: [], newCursor: cursor };
  if (N === 1) {
    return { selected: [queries[0]], newCursor: 0 };  // warn and use only query
  }
  const i1 = (cursor + 1) % N;
  const i2 = (cursor + 2) % N;
  return { selected: [queries[i1], queries[i2]], newCursor: i2 };
}
```

If the bank has fewer than 2 queries, a warning is logged:
`[discovery] Topic <id> has fewer than 2 queries in bank; running <n> query/queries`.

### State Persistence

Cursor state is saved to `data/query_rotation_state.json` at the end of each
discovery run, after all queries have been issued. The write uses the atomic
tmp-file-rename pattern. A write failure is logged at warn level but does not
fail the discovery run.

When a topic's bank is replaced (by `scripts/refresh-query-banks.ts`), all
cursors for that topic are reset to -1 in the state file.

---

## 11. Group D — Two-Queries-Per-Topic Execution

### Changes in runDiscovery

Replace the single `searchBrave(topic.searchQueries[0], ...)` call per topic
with two calls using the rotation-selected queries:

```typescript
const queryBanks = loadQueryBanks();
const rotationState = loadRotationState();

const searchPromises = topicsToProbe.flatMap((topic) => {
  const queries = queryBanks.get(topic.id) ?? topic.searchQueries;
  const { selected, newCursor } = selectNextTwoQueries(queries, rotationState.get(topic.id) ?? -1);
  rotationState.set(topic.id, newCursor);
  return selected.map((q) =>
    searchBrave(q, DISCOVERY_CANDIDATES_PER_TOPIC).then((r) => ({ topic, results: r }))
  );
});

const searchResults = await Promise.allSettled(searchPromises);
```

Both queries for a topic are issued concurrently (they are different queries,
not the same domain). Results from both are combined and deduplicated before
the quality gate.

### Brave Search API Call Budget

With 12 topics, `DISCOVERY_TOPICS_PER_RUN = 6` topics selected per run, and
2 queries per topic: 12 calls per run × 30 days = 360 calls/month.
This is well within the Brave Search free tier of 2,000 calls/month.

---

## 12. Group D — Query Bank Initialization Script

**File**: `scripts/refresh-query-banks.ts`

**npm script**: add `"refresh-query-banks": "npx ts-node scripts/refresh-query-banks.ts"` to `package.json`.

### What the Script Does

1. Read `DISCOVERY_TOPICS` from `lib/discovery/topics.ts`.
2. For each topic, call Claude Haiku via the Anthropic SDK with a prompt that
   generates 5 search query strings.
3. Collect results into the `query_banks.json` schema.
4. Write atomically to `data/query_banks.json`.
5. Write a fresh `data/query_rotation_state.json` with all cursors reset to -1.
6. Log a summary: total topics processed, total queries generated, any topics
   with fewer than 5 queries (with warning).

### Generation Prompt

```
You are helping build a content discovery system that surfaces genuinely
interesting long-form writing — the kind found in The Browser, The Marginalian,
and Arts & Letters Daily.

For the topic "<topicLabel>", generate exactly 5 search query strings.
These queries should be written the way a master curator would search:
not generic keyword phrases, but precise formulations that would surface
high-signal, niche, cross-disciplinary writing from personal sites, specialist
blogs, and independent publications.

Requirements:
- Each query should be 4–12 words long.
- Avoid generic terms like "articles", "blog posts", "news", "guide", "tutorial".
- Prefer formulations that would surface original thought, unusual angles, or
  cross-disciplinary connections.
- Vary the angle: one query might target historical depth, one might target
  methodology, one might target overlooked perspectives, etc.

Return a JSON array of exactly 5 strings. No other text.
Example for "materials science":
["overlooked properties of materials that changed how something was made",
 "unexpected material behavior discovered outside laboratory conditions",
 "craft traditions that anticipated industrial material science",
 "materials that failed spectacularly and what changed as a result",
 "the cultural meaning of a material beyond its engineering properties"]
```

### Re-initialization Behavior

Running the script a second time overwrites `data/query_banks.json` and resets
all cursors in `data/query_rotation_state.json`. A log entry records the
re-initialization event and timestamp.

### Monthly Refresh

This is a manual operator action or an external cron trigger. The operator runs
`npm run refresh-query-banks` monthly. No automated trigger inside the pipeline.
The PM was informed of this choice (aligns with Decision 5 in the Architect
decisions list).

---

## 13. New Constants in lib/config/feed.ts

The following constants are added to the existing `lib/config/feed.ts`:

```typescript
/** LLM composite score threshold (0–5) for a candidate to pass the quality gate. */
export const LLM_EVAL_THRESHOLD = 3.5;

/** Maximum characters of body text sent to the LLM evaluator (cost control). */
export const LLM_EVAL_BODY_CHAR_LIMIT = 3000;

/** Maximum new sources added to the Small Web pool per crawl run. */
export const SMALL_WEB_MAX_NEW_SOURCES_PER_RUN = 20;
```

The `SPECIFICITY_THRESHOLD` constant is **removed** from `lib/config/feed.ts`
(it was the threshold for the deleted Gate 4 specificity heuristic).

---

## 14. Discovery Orchestrator Integration Points

### runDiscovery() Signature — No Change

The signature `runDiscovery(fixedArticleUrls, userId, deviceId)` is unchanged.
This is critical: `lib/pipeline/run.ts` calls `runDiscovery` and must not be
modified.

### Internal Flow Changes in run.ts

1. Add `loadQueryBanks()` and `loadRotationState()` calls before topic selection.
2. Change per-topic search from 1 query to 2 queries using the cursor.
3. Add `runSmallWebCrawl()` call; merge results with Brave candidates.
4. Replace the synchronous `evaluateCandidate()` gate with the async
   `evaluateCandidateFull()` helper that chains extraction + LLM eval.
5. Initialize and accumulate `EvalStats`.
6. Write rotation state and log run summary at the end.

The `sortBySpecificityScore` descending sort is replaced by `sortByLLMCompositeScore`
descending sort (using `scores.composite`). This is the natural replacement:
the LLM composite score serves the same role as the specificity score did —
ranking qualified candidates so the best ones fill the quota.

### Article Object Construction

When a candidate passes, `bodyText` is set from the extraction result:

```typescript
{
  ...existingFields,
  bodyText: bodyExtracted.bodyText,   // new: set for discovery articles
  discoveryTopic: topic.id,
}
```

This satisfies AGDISC-007 AC#1: the `bodyText` field is populated for every
discovery article that passes the quality gate.

---

## 15. Key Decisions Table

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Small Web source state storage | Postgres table (`small_web_sources`) | Cooldown queries, upsert atomicity, handles pool growth; Neon already in use |
| Blogroll parsing scope | OPML files (via fast-xml-parser), `<a rel="blogroll">` links, heuristic class/id/nav patterns | Covers canonical IndieWeb formats plus the majority of hand-crafted blogrolls; depth limit 1 |
| Blogroll follow depth | 1 level only (do not follow blogrolls found inside blogrolls) | Prevents exponential expansion; seed + 1-level is sufficient for high-signal source seeding |
| Pool expansion cap | 20 new sources per crawl run | Prevents a single large OPML from overwhelming the pool; tunable constant |
| LLM model for evaluation | `claude-haiku-4-5-20251001` | Fast, cheap, sufficient for classification task; ~$2/month at expected volume |
| LLM output format | Tool use (structured output) with `score_article` tool | Eliminates fragile response parsing; JSON schema enforced by the API |
| LLM body text truncation | First 3,000 characters | Cost control; sufficient for quality assessment of article-length prose |
| Extraction library | `@mozilla/readability` + `jsdom` | Battle-tested on editorial/blog layouts (Firefox Reader Mode); no browser rendering needed |
| Extraction failure handling | Skip-and-continue, no retry | Consistent with existing pipeline failure isolation philosophy |
| Quality gate Gate 4 | Removed (specificity heuristic deleted) | LLM evaluation supersedes it; keeping both would be redundant and would double-filter |
| Body text inclusion in Article | Set `bodyText` on qualifying discovery articles | Populates existing optional field; no type change required |
| Query bank storage | `data/query_banks.json` (runtime, gitignored) + `data/query_banks.default.json` (committed seed) | Inspectable by operator; editable without redeploy; default seed prevents cold-start failure |
| Rotation state storage | `data/query_rotation_state.json` (separate from bank) | Decouples query content from cursor state; bank can be refreshed without corrupting cursor |
| Query rotation | Simple sequential cursor wrapping | Deterministic, auditable, zero external state beyond a counter |
| Queries per topic per run | 2 | Stays within Brave free tier (360 calls/month vs. 2,000 limit); meaningful rotation |
| Query bank refresh trigger | `scripts/refresh-query-banks.ts` standalone script | Not auto-called in pipeline; monthly refresh is a manual/cron operator action |
| Small Web crawl throttle | Sequential with 1s inter-source delay | Protects small personal sites from being mistaken for DDoS |
| Small Web integration point | Inside `runDiscovery()`, before Brave Search | Natural: same quality gate, same dedup, same quota; no new orchestration layer needed |
| `SPECIFICITY_THRESHOLD` constant | Removed from lib/config/feed.ts | Gate 4 deleted; constant has no remaining consumer |

---

## 16. External Dependencies and Environment Variables

### New npm Dependencies

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `@anthropic-ai/sdk` | `^0.39.x` | Anthropic API client for LLM evaluation and query generation | `dependencies` (not devDependencies) |
| `@mozilla/readability` | `^0.5.x` | Article body text extraction (Firefox Reader Mode algorithm) | `dependencies` |
| `jsdom` | `^24.x` | DOM parsing for Readability; server-side only | `dependencies` |
| `@types/jsdom` | `^21.x` | TypeScript types for jsdom | `devDependencies` |
| `fast-xml-parser` | `^4.x` | OPML file parsing for blogroll discovery | `dependencies` |

### New Environment Variables

| Variable | Required For | Notes |
|----------|-------------|-------|
| `ANTHROPIC_API_KEY` | LLM evaluator (AGDISC-008), query bank generation (AGDISC-014) | Obtain at console.anthropic.com. Never commit. |

The `.env.example` file must be updated to include:

```
ANTHROPIC_API_KEY=
```

---

## 17. Deferred Items

| Item | Rationale | Future Phase |
|------|-----------|-------------|
| Headless browser rendering for JS-heavy sites | `@mozilla/readability` + jsdom handles the majority of targeted personal sites and editorial blogs. JS-only sites fail extraction gracefully. | Phase 2 |
| Retry logic for extraction and LLM failures | Intentionally out of scope for Phase 1; skip-and-continue is the established pattern. | Phase 2 |
| User-facing Small Web source management | Internal system concern; no product UI needed at current scale. | Not planned |
| Operator dashboard for source pool / query bank | Config-file and database concern; no UI needed. | Phase 3+ |
| Paywall bypass or authenticated article fetching | Explicitly excluded per BRD. Hard paywalls yield below-minimum-length results and are skipped. | Not planned |
| Real-time or continuous Small Web crawling | Once-daily cadence is sufficient; continuous crawling adds infrastructure complexity without clear benefit at this scale. | Phase 2+ |
| Vector embedding of extracted body text | Phase 2 (Latent Aesthetic Space pillar). Body text is now available and stored; embedding can be added without re-extraction. | Phase 2 |
| Article-level LLM scoring feeding into the personalization ranker | Ranker currently uses source-level scoring only; article-level scoring requires ranker redesign. | Phase 3+ |
| `ts-node` dependency for the refresh script | If `ts-node` is not in devDependencies, Dev must add it. Check during task execution. | Immediate (AGDISC-TASK-016) |

---

## 18. Directory Map

Expected file tree after all Phase 1 tasks are complete. New files are marked `[NEW]`. Modified files are marked `[MOD]`.

```
tangent/
├── agents/
│   ├── architect/
│   │   ├── design_agentic_discovery_phase1_v1.md  [NEW]
│   │   ├── tasks_agentic_discovery_phase1_v1.md   [NEW]
│   │   └── ARCHITECTURE.md                        [MOD]
│   └── pm/
│       └── roadmap.md                             [MOD]
├── data/
│   ├── query_banks.default.json                   [NEW] — committed seed
│   ├── query_banks.json                           [NEW, gitignored] — runtime
│   └── query_rotation_state.json                  [NEW, gitignored] — runtime
├── lib/
│   ├── config/
│   │   └── feed.ts                                [MOD] — add LLM_EVAL_THRESHOLD, LLM_EVAL_BODY_CHAR_LIMIT, SMALL_WEB_MAX_NEW_SOURCES_PER_RUN; remove SPECIFICITY_THRESHOLD
│   ├── db/
│   │   └── smallWeb.ts                            [NEW] — Small Web DB helpers
│   ├── discovery/
│   │   ├── bodyExtractor.ts                       [NEW] — Readability + jsdom extraction
│   │   ├── llmEvaluator.ts                        [NEW] — Claude Haiku evaluation module
│   │   ├── queryBank.ts                           [NEW] — query bank loader + rotation cursor
│   │   ├── qualityGate.ts                         [MOD] — remove Gate 4 specificity heuristic
│   │   ├── run.ts                                 [MOD] — integrate body extraction, LLM eval, Small Web, multi-query
│   │   └── smallWeb/
│   │       ├── crawler.ts                         [NEW] — Small Web crawl orchestrator
│   │       ├── blogroll.ts                        [NEW] — blogroll parser (OPML + HTML)
│   │       └── seeds.ts                           [NEW] — SMALL_WEB_SEED_URLS constant
│   └── types/
│       └── smallWeb.ts                            [NEW] — SmallWebSource interface
├── scripts/
│   └── refresh-query-banks.ts                     [NEW] — standalone query bank generator
├── .env.example                                   [MOD] — add ANTHROPIC_API_KEY=
└── package.json                                   [MOD] — add new dependencies
```
