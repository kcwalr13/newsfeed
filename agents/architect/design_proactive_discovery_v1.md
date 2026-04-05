# Technical Design — Proactive Content Discovery (Milestone 7)

**ID**: ARCH-DESIGN-007
**Stories Reference**: `agents/pm/stories_proactive_discovery.md` (DISC-001 through DISC-010)
**BRD Reference**: `agents/ba/brd_proactive_discovery.md` (BRD-006)
**Date**: 2026-04-04
**Status**: Final
**Author**: Architect Agent

---

## Table of Contents

1. Architecture Overview
2. Search Provider Decision — Brave Search API
3. Topic Configuration Schema
4. Discovery Pipeline Entry Point and Execution Order
5. Web Search Execution and Topic Weighting
6. Quality Gate Design
7. Deduplication Strategy
8. Discovery Quota Enforcement and Batch Assembly
9. Config Constants — Location and Naming
10. discoveryTopic Storage — Article Metadata Strategy
11. Topic Weight Feedback Loop (DISC-009)
12. DB Schema — discovery_topic_weights Table
13. API Contract — No Changes to GET /api/feed/today
14. New Modules — Directory Map
15. What Does NOT Change
16. Key Decisions Table
17. External Dependencies and Environment Variables
18. Deferred Items

---

## 1. Architecture Overview

The discovery layer is a self-contained subsystem that runs alongside the existing
RSS/NewsAPI pipeline each day. Its output is a short list of high-quality
`Article` objects that are merged with the fixed-pipeline output before the
batch is written to disk. No new API routes are introduced. The feed response
shape is unchanged.

```
POST /api/pipeline/run  (or POST /api/feed/refresh)
  |
  |-- runPipeline()  ---- existing fixed-source pipeline (RSS + NewsAPI)
  |     |-- yields up to PIPELINE_ARTICLES_PER_DAY articles
  |
  |-- runDiscovery()  ---- new discovery subsystem
  |     |-- loadTopics()              lib/discovery/topics.ts
  |     |-- selectTopicsToProbe()     weighted random selection
  |     |-- searchTopic(topic)        Brave Search API  (one call per topic)
  |     |-- evaluateCandidate(a)      lib/discovery/qualityGate.ts
  |     |-- deduplicateAgainstFixed() URL-set intersection
  |     |-- enforceQuota()            top-N by quality score
  |
  |-- assembleBatch(fixedArticles, discoveryArticles)
        |-- discoveryCount = min(DISCOVERY_ARTICLES_PER_DAY, discoveryArticles.length)
        |-- fixedTarget = ARTICLES_PER_DAY - discoveryCount
        |-- combined = fixedArticles.slice(0, fixedTarget) + discoveryArticles
        |-- writeBatch(combined)
```

The discovery module lives entirely under `lib/discovery/`. It has no UI
surface. The feed API and client are completely unmodified.

---

## 2. Search Provider Decision — Brave Search API

**Choice**: Brave Search API (Web Search endpoint)

**Rationale**:

| Criterion | Brave Search | Alternatives considered |
|-----------|-------------|------------------------|
| Long-tail / niche content | Strong; Brave independently crawls and indexes without Google dependency | SerpAPI proxies Google — inherits Google's mainstream bias; Exa is strong but LLM-focused |
| Cost | Free tier: 2,000 queries/month; base plan $3/1,000 queries. 6 topics x 1 call/day x 30 days = 180 calls/month — well within free tier | Bing: metered, requires Azure account; SerpAPI: $50+/month at this volume |
| Rate limits | 1 request/second; 2,000/month free. Easily satisfied at our cadence | No blocking issue |
| No Google dependency | Yes — independent index | SerpAPI, Serper both proxy Google |
| Structured JSON response | Yes — title, description, url, age (published date string) in web.results[] | All alternatives comparable |
| Auth / setup | Single API key (BRAVE_SEARCH_API_KEY) passed as X-Subscription-Token header | Minimal integration friction |

**API call shape**:

```
GET https://api.search.brave.com/res/v1/web/search
  ?q=<encoded-query>
  &count=10
  &freshness=pw       (past week -- enforced server-side as first filter; our window is 72h, applied locally)
  &text_decorations=0
  &search_lang=en
  X-Subscription-Token: <BRAVE_SEARCH_API_KEY>
  Accept: application/json
```

`freshness=pw` (past week) is used as a coarse server-side pre-filter.
The local freshness check (`DISCOVERY_MAX_AGE_HOURS = 72`) then narrows to
exactly 3 days. This avoids fetching week-old articles only to discard them.

**Response fields used**:

| Brave field | Mapped to |
|-------------|-----------|
| `web.results[N].title` | `title` |
| `web.results[N].description` | `description` |
| `web.results[N].url` | `articleUrl` |
| `web.results[N].meta_url.hostname` | domain for credibility check and `sourceUrl` |
| `web.results[N].age` | parsed to `publishedAt` (ISO-8601) |
| `web.results[N].extra_snippets[0]` | fallback for `description` if main field empty |
| `web.results[N].profile.name` | preferred source for `sourceName` (e.g. "The Atlantic") |
| `web.results[N].meta_url.hostname` | fallback `sourceName` if `profile.name` is absent |

`sourceName` extraction priority:
1. `profile.name` (outlet name Brave already resolves, e.g. "Quanta Magazine")
2. Hostname with `www.` stripped, split on `.`, title-cased first segment
   (e.g. `theatlantic.com` -> "Theatlantic" -- prefer profile.name when available)

---

## 3. Topic Configuration Schema

**File**: `lib/discovery/topics.ts`

Topics are a static TypeScript array exported as `DISCOVERY_TOPICS`. This is a
compile-time constant, not a runtime file read, which eliminates file I/O and
parse errors. Adding or removing topics requires only an edit to this file and
a redeploy -- no changes to the discovery execution logic.

```typescript
export interface DiscoveryTopic {
  /** Unique machine-readable ID used as discoveryTopic label in article metadata. */
  id: string;
  /** Human-readable label for logging and future operator tooling. */
  label: string;
  /**
   * One or more search queries to issue for this topic.
   * Multiple queries enable the discovery logic to rotate between them
   * or issue each as a separate search call. The default behavior
   * (Milestone 7) is to use queries[0] as the primary query.
   */
  searchQueries: string[];
  /**
   * Soft weight (0.1 to 2.0). At initialization all topics have weight 1.0.
   * Updated per identity by the topic weight feedback loop (DISC-009).
   * Stored here only as the system default; per-identity overrides live
   * in the discovery_topic_weights DB table.
   */
  defaultWeight: number;
}

export const DISCOVERY_TOPICS: DiscoveryTopic[] = [
  { id: 'fringe-science',          label: 'Fringe & Emerging Science',        searchQueries: ['emerging research fringe science discoveries'],          defaultWeight: 1.0 },
  { id: 'music-audio-culture',     label: 'Music & Audio Culture',            searchQueries: ['underground music scene audio culture experimental'],     defaultWeight: 1.0 },
  { id: 'visual-art-design',       label: 'Visual Art & Design',              searchQueries: ['contemporary visual art illustration design culture'],    defaultWeight: 1.0 },
  { id: 'architecture',            label: 'Architecture & Built Environment', searchQueries: ['architecture built environment urban design innovation'], defaultWeight: 1.0 },
  { id: 'fashion-material-culture',label: 'Fashion & Material Culture',       searchQueries: ['fashion textiles material culture craft design'],         defaultWeight: 1.0 },
  { id: 'nature-ecology',          label: 'Nature & Ecology',                 searchQueries: ['ecology wildlife biology nature conservation research'],  defaultWeight: 1.0 },
  { id: 'math-philosophy',         label: 'Mathematics & Philosophy',         searchQueries: ['mathematics logic philosophy ideas research'],            defaultWeight: 1.0 },
  { id: 'film-visual-storytelling',label: 'Film & Visual Storytelling',       searchQueries: ['film cinema photography visual storytelling culture'],    defaultWeight: 1.0 },
  { id: 'literature-language',     label: 'Literature & Language',            searchQueries: ['literature writing language culture essays books'],       defaultWeight: 1.0 },
  { id: 'craft-making',            label: 'Craft & Making',                   searchQueries: ['craft making fabrication handmade artisan techniques'],   defaultWeight: 1.0 },
  { id: 'economics-behavioral',    label: 'Economics & Behavioral Science',   searchQueries: ['economics behavioral science social dynamics research'],  defaultWeight: 1.0 },
  { id: 'history-archaeology',     label: 'History & Archaeology',            searchQueries: ['history archaeology discovery ancient culture findings'], defaultWeight: 1.0 },
];
```

**Why TypeScript static array instead of JSON file?**

- Type-safe at compile time: `tsc --noEmit` catches schema drift.
- No runtime `fs.readFileSync` needed, which simplifies serverless cold starts.
- Adding a topic is a one-line edit with no JSON syntax risk.
- The `defaultWeight` field is present from day one, satisfying DISC-001 AC#5.
  Per-identity weights are stored in the DB; this field is the fallback default.

---

## 4. Discovery Pipeline Entry Point and Execution Order

**File**: `lib/discovery/run.ts`

This module exports `runDiscovery(fixedArticleUrls: Set<string>, userId?: string | null): Promise<Article[]>`.

It is called from `lib/pipeline/run.ts` immediately after the fixed-source
pipeline completes but before the batch is assembled. The fixed-pipeline URL
set is passed in so deduplication can run within `runDiscovery`. The optional
`userId` is passed through from the manual refresh trigger so that user-specific
topic weights can be applied.

Execution flow inside `runPipeline` (updated):

```
1. Fetch all fixed sources (existing behavior, unchanged).
2. Deduplicate + cap + validate fixed articles (existing behavior, unchanged).
3. Build fixedArticleUrls: Set<string> from the fixed articles' articleUrl values.
4. Call runDiscovery(fixedArticleUrls, options.userId ?? null) inside a try/catch.
   - On success: discoveryArticles = returned Article[].
   - On failure: log the error; discoveryArticles = [] (graceful fallback, full
     20 articles come from the fixed pipeline).
5. discoveryCount = discoveryArticles.length  (already capped to DISCOVERY_ARTICLES_PER_DAY)
6. fixedTarget = ARTICLES_PER_DAY - discoveryCount
7. finalFixed = fixed articles trimmed to fixedTarget.
8. combined = [...finalFixed, ...discoveryArticles]
9. Assign batchDate and IDs to combined articles (existing makeId logic applies).
10. writeBatch({ batchDate, generatedAt, articles: combined }).
11. Log batch composition: "Batch: N fixed-source, M discovery".
```

**Idempotency**: The existing guard `if (!options.forceOverwrite && readBatch(today))`
in `runPipeline` remains unchanged. If a batch already exists for today and no
force flag is set, `runPipeline` returns early -- discovery is never called
for an already-existing batch.

**Failure isolation**: `runDiscovery` is wrapped in a `try/catch` in `runPipeline`.
A total failure of discovery logs the error and falls back to a full
`ARTICLES_PER_DAY`-article batch from the fixed pipeline. The feed is never
empty. Per-topic failures within `runDiscovery` are similarly isolated (see
section 5).

---

## 5. Web Search Execution and Topic Weighting

**File**: `lib/discovery/run.ts` (topic selection + search orchestration)
**File**: `lib/discovery/braveSearch.ts` (HTTP adapter for Brave Search API)

### Topic Selection -- Weighted Random Sampling

Each pipeline run selects a subset of topics to probe. The number of topics
probed per run is `DISCOVERY_TOPICS_PER_RUN` (default: 6). The approach:

1. Load per-identity topic weights from the DB.
   - For a manual refresh triggered by a specific user (`userId` present),
     load that user's topic weights from `discovery_topic_weights`.
   - For a scheduled run (no userId), load weights averaged across all users
     (mean weight per topic). If no rows exist, all topics use `defaultWeight = 1.0`.
   - For an anonymous device-triggered run (no userId but a deviceId could be
     passed in future), use device weights. In this milestone, scheduled runs
     use the global average.

2. Normalize weights to sum to 1.0. Each topic's selection probability is
   proportional to its normalized weight.

3. Weighted random sampling without replacement for `DISCOVERY_TOPICS_PER_RUN`
   slots. Implementation: build a cumulative-weight array, generate a random
   number in [0, totalWeight), select the topic at that cumulative position,
   remove it, repeat.

4. Issue one Brave Search API call per selected topic (using `searchQueries[0]`).

**Constants** (in `lib/config/feed.ts`):

| Constant | Default | Meaning |
|----------|---------|---------|
| `DISCOVERY_TOPICS_PER_RUN` | `6` | Number of distinct topics probed per pipeline run |
| `DISCOVERY_CANDIDATES_PER_TOPIC` | `10` | Raw results fetched per topic query (Brave `count` param) |

With 12 topics and `DISCOVERY_TOPICS_PER_RUN = 6`, each run probes half the
topic list. Equal weights at launch means each topic has an equal chance per
run. This ensures variety across days.

### Per-Topic Failure Isolation

Each topic search is issued via `Promise.allSettled`. If a topic query returns
an HTTP error or throws, the failure is logged and that topic contributes zero
candidates. Remaining topics proceed normally.

### Brave Search Adapter

**File**: `lib/discovery/braveSearch.ts`

```typescript
export interface BraveSearchResult {
  title: string;
  description: string;
  url: string;
  publishedAt: string | null;  // ISO-8601; null if Brave age field is unparseable
  sourceName: string;          // from profile.name or derived from hostname
  sourceUrl: string;           // https://<hostname>
}

export async function searchBrave(
  query: string,
  count: number
): Promise<BraveSearchResult[]>
```

The adapter:
- Issues a single `fetch()` call to the Brave Search API using the env var
  `BRAVE_SEARCH_API_KEY` as `X-Subscription-Token`.
- Parses `web.results[]` from the JSON response.
- Maps each result to a `BraveSearchResult`.
- Returns an empty array on any HTTP error (logs the error).
- `publishedAt` parsing: Brave returns `age` as a relative string ("3 days ago",
  "1 week ago") or an ISO date string. The adapter converts to ISO-8601:
  - Relative strings: parse magnitude and unit, subtract from `Date.now()`.
  - Absolute date strings: `new Date(age).toISOString()`.
  - Unparseable: `publishedAt = null` (the quality gate rejects null dates).

---

## 6. Quality Gate Design

**File**: `lib/discovery/qualityGate.ts`

The quality gate is a pure function module -- zero side effects, zero I/O.
It accepts a `BraveSearchResult` and returns a `QualityGateResult`:

```typescript
export interface QualityGateResult {
  pass: boolean;
  reason?: string;         // populated only when pass === false; for debug logging
  specificityScore: number; // 0.0-1.0; always computed even when pass === false
}

export function evaluateCandidate(
  candidate: BraveSearchResult,
  nowMs?: number           // injectable for testing; defaults to Date.now()
): QualityGateResult
```

### Gate Criteria (applied in order -- fail-fast)

**Gate 1 -- Existing validator rules** (mirrors lib/pipeline/validator.ts)

- Title: must be present and non-empty (trimmed length > 0).
- URL: must be present and non-empty.
- Description: must be present and non-empty (trimmed).

Fail reasons: `"MISSING_TITLE"`, `"MISSING_URL"`, `"MISSING_DESCRIPTION"`

**Gate 2 -- Freshness**

- `publishedAt` must not be null.
- The parsed date must be within `DISCOVERY_MAX_AGE_HOURS` hours of `nowMs`.

Fail reasons: `"UNPARSEABLE_DATE"`, `"TOO_OLD"`

`DISCOVERY_MAX_AGE_HOURS = 72` (3 days). Constant in `lib/config/feed.ts`.

**Gate 3 -- Source credibility blocklist**

Check the article's domain (from `BraveSearchResult.sourceUrl`) against a
static blocklist of known content-farm and aggregator domains. The blocklist
is a `Set<string>` of exact hostname matches; suffix matching is applied
(subdomain.blocked.com matches blocked.com).

Initial blocklist:

```
buzzfeed.com, huffpost.com, msn.com, yahoo.com, aol.com, ask.com,
answers.com, about.com, ehow.com, wikihow.com, thoughtcatalog.com,
medium.com, substack.com, reddit.com, quora.com, pinterest.com,
linkedin.com, facebook.com, twitter.com, x.com, tumblr.com
```

Fail reason: `"BLOCKLISTED_DOMAIN"`

Rationale: Permissive by default. Blocklist targets only known high-noise,
low-quality aggregators. The list is intentionally short -- it is better to
let an occasional low-quality piece through than to block obscure legitimate
outlets. `medium.com` and `substack.com` are included because they aggregate
content from tens of thousands of authors with no consistent quality floor.

**Gate 4 -- Specificity score**

Compute a specificity score (0.0--1.0) for the article title using penalty
pattern matching. Reject if score < `SPECIFICITY_THRESHOLD` (default: 0.4).

Penalty patterns (each reduces score if matched; floor at 0.0):

| Pattern | Penalty |
|---------|---------|
| "Everything You Need to Know About X" | -0.3 |
| "A/The/Your Complete Guide to X" or "The Ultimate Guide to X" | -0.3 |
| "X Things About Y" where X is a number >= 8 (listicles > 7 items) | -0.2 |
| "How to X in Y Steps" where Y >= 8 | -0.2 |
| "Why X Is Y" generic construction | -0.2 |
| "What Is X? Everything You Should Know" | -0.2 |
| Title starts with "The Future of" | -0.2 |
| "X Is Changing Everything" | -0.2 |
| Clickbait signal words: "shocking", "unbelievable", "you won't believe", "mind-blowing", "this is why", "here's why", "here are", "you need to see" | -0.15 |
| Title is entirely upper case | -0.1 |
| Title ends with a question mark | -0.1 |

Score starts at 1.0. Penalties are cumulative. `score = max(0.0, score - sum_of_penalties)`.

Fail reason: `"LOW_SPECIFICITY:0.XX"` (score appended for debug visibility)

---

## 7. Deduplication Strategy

Deduplication runs in two passes inside `runDiscovery`:

**URL canonicalization function** (shared helper, used in both passes):

```typescript
function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;   // strips query string and fragment
  } catch {
    return url;  // return as-is if URL is malformed; will likely fail Gate 1 anyway
  }
}
```

**Pass 1 -- Within-discovery dedup**: After quality gate, before quota
enforcement. Use a `Set<string>` of canonical URLs. If two topic queries return
the same canonical URL, only the first-seen instance is kept.

**Pass 2 -- Against fixed pipeline**: The `fixedArticleUrls: Set<string>` passed
into `runDiscovery()` contains canonical URLs of all fixed-pipeline articles
(canonicalized using the same function above). Any discovery candidate whose
canonical URL is already in `fixedArticleUrls` is discarded.

---

## 8. Discovery Quota Enforcement and Batch Assembly

### Quota Enforcement (inside runDiscovery)

After both dedup passes:

1. Sort surviving candidates by `specificityScore` descending (highest quality first).
2. Take the top `DISCOVERY_ARTICLES_PER_DAY` candidates (or all if fewer survive).
3. Map each to a full `Article` object using the existing `makeId(sourceName, articleUrl)` logic.
4. Set `discoveryTopic` on each article (internal metadata field -- see section 10).
5. Set `batchDate`, `fetchedAt`, `sourceUrl`, `feedbackSlot: null`.
6. Return the Article array (length <= DISCOVERY_ARTICLES_PER_DAY).

If zero candidates survive all gates and dedup, return `[]` -- not an error.
Log: `[discovery] Zero candidates qualified after quality gate and dedup`.

### Batch Assembly (inside runPipeline, after calling runDiscovery)

```typescript
const discoveryCount = discoveryArticles.length;
const fixedTarget = ARTICLES_PER_DAY - discoveryCount;

// Trim fixed articles to fill remaining slots.
const finalFixed = fixedArticles.slice(0, fixedTarget);

const combined = [...finalFixed, ...discoveryArticles];

appendLog(
  `[pipeline] Batch: ${finalFixed.length} fixed-source, ` +
  `${discoveryArticles.length} discovery`
);
```

The `MAX_ARTICLES_PER_SOURCE = 5` cap applies to `fixedArticles` only
(already applied during fixed-pipeline processing). Discovery articles have
their own `DISCOVERY_ARTICLES_PER_DAY = 6` ceiling enforced within `runDiscovery`.

---

## 9. Config Constants -- Location and Naming

All discovery and pipeline quota constants live in `lib/config/feed.ts`.
This is a new file created in this milestone. It consolidates all quota and
tuning constants that span modules (pipeline + discovery). The infrastructure
constants in `lib/pipeline/config.ts` (file paths, source config) remain there
unchanged.

**`lib/config/feed.ts`**:

```typescript
/** Total articles in every daily batch. */
export const ARTICLES_PER_DAY = 20;

/** Fixed-source pipeline (RSS + NewsAPI) nominal contribution per day. */
export const PIPELINE_ARTICLES_PER_DAY = 14;

/** Discovery layer nominal contribution per day. */
export const DISCOVERY_ARTICLES_PER_DAY = 6;

// Invariant assertion -- fails at module load time if constants drift:
if (PIPELINE_ARTICLES_PER_DAY + DISCOVERY_ARTICLES_PER_DAY !== ARTICLES_PER_DAY) {
  throw new Error(
    `[config/feed] Quota mismatch: PIPELINE_ARTICLES_PER_DAY (${PIPELINE_ARTICLES_PER_DAY}) ` +
    `+ DISCOVERY_ARTICLES_PER_DAY (${DISCOVERY_ARTICLES_PER_DAY}) ` +
    `must equal ARTICLES_PER_DAY (${ARTICLES_PER_DAY})`
  );
}

/** Maximum age (hours) for a discovery candidate. Default: 72 (3 days). */
export const DISCOVERY_MAX_AGE_HOURS = 72;

/** Number of distinct topics probed per pipeline run. */
export const DISCOVERY_TOPICS_PER_RUN = 6;

/** Brave Search results fetched per topic query (count param). */
export const DISCOVERY_CANDIDATES_PER_TOPIC = 10;

/** Minimum specificity score (0.0-1.0) to pass the quality gate. */
export const SPECIFICITY_THRESHOLD = 0.4;

/** Topic weight adjustment per feedback event. */
export const TOPIC_WEIGHT_STEP = 0.1;

/** Minimum topic weight -- topics cannot be fully eliminated. */
export const TOPIC_WEIGHT_FLOOR = 0.1;

/** Maximum topic weight -- no single topic can dominate. */
export const TOPIC_WEIGHT_CEILING = 2.0;
```

**Relationship with lib/pipeline/config.ts**: The `ARTICLES_PER_DAY` constant
currently defined in `lib/pipeline/config.ts` is replaced by re-exporting it
from `lib/config/feed.ts`. `lib/pipeline/run.ts` imports `ARTICLES_PER_DAY`
from `lib/config/feed.ts` going forward. All other constants in
`lib/pipeline/config.ts` remain there unchanged.

---

## 10. discoveryTopic Storage -- Article Metadata Strategy

**Decision**: `discoveryTopic` is stored as an optional field on the `Article`
type and persisted in the batch JSON file. It is internal metadata only -- it
is never included in the `GET /api/feed/today` API response.

### Article Type Addition

In `lib/types/article.ts`, add one optional field:

```typescript
/**
 * For discovery-sourced articles only: the topic ID from DISCOVERY_TOPICS that
 * produced this article. Used by the topic weight feedback loop (DISC-009).
 * Null for fixed-pipeline articles. Never sent to the client.
 * @internal
 */
discoveryTopic?: string | null;
```

This field is:
- Set by `runDiscovery` when constructing each `Article` object.
- Stored in the batch JSON alongside all other article fields.
- Read by the topic weight update logic at the start of each pipeline run.
- **Excluded** from `GET /api/feed/today` response by stripping before serialization.

### Stripping from API response

In `app/api/feed/today/route.ts`, after ranking and before returning:

```typescript
const publicArticles = rankedArticles.map(
  ({ discoveryTopic: _dt, ...rest }) => rest
);
// Return publicArticles in the response body.
```

This ensures `discoveryTopic` never reaches the client, satisfying DISC-010 AC#3
and DISC-008 AC#3.

### Why store in batch JSON instead of a separate DB table?

The batch JSON is the system of record for articles. Storing `discoveryTopic`
there keeps article and metadata co-located, avoids a new DB join at feedback
time, and is consistent with the filesystem-first architecture. The feed route
already reads the batch; accessing `discoveryTopic` is O(1) array lookup.
The field is nullable (null for fixed-pipeline articles), so no migration
is needed for existing batch files -- `discoveryTopic` will simply be absent/null.

---

## 11. Topic Weight Feedback Loop (DISC-009, P1)

### Trigger and Timing

Topic weight adjustments are applied at the start of each pipeline run, not in
real time. Feedback given during the day influences the next run's topic
selection.

### Update Sequence (inside runDiscovery, before topic selection)

```
1. Load feedback rows written since the LAST pipeline run for the identity in scope.
   - For a user-triggered manual refresh: getFeedbackForUser(userId).
   - For a scheduled run: load all feedback rows written since yesterday's run,
     grouped by user_id/device_id.
2. For each feedback row:
   a. Look up the article's discoveryTopic by reading the most recent batch file
      and finding the article by article_id. If the article is not a discovery
      article (discoveryTopic is null/absent), skip it.
   b. Determine adjustment: like -> +TOPIC_WEIGHT_STEP; dislike -> -TOPIC_WEIGHT_STEP.
3. For each (identity, topicId) pair with a net adjustment:
   a. Read current weight from discovery_topic_weights (or use DISCOVERY_TOPICS.find(t => t.id === topicId).defaultWeight if no row exists).
   b. Apply adjustment: newWeight = clamp(current + adjustment, TOPIC_WEIGHT_FLOOR, TOPIC_WEIGHT_CEILING).
   c. Upsert into discovery_topic_weights.
4. After all updates, load the final weight table for topic selection.
```

### Identity Routing

- **Manual refresh with userId**: use that user's weights exclusively.
- **Scheduled run**: compute per-topic average across all `discovery_topic_weights`
  rows. Topics with no DB rows use `defaultWeight = 1.0`. Average is unweighted.
- **Anonymous (no userId)**: use device-level weights from `discovery_topic_weights`
  where `user_id IS NULL AND device_id = X`. For the scheduled run, these are
  included in the average.

### Weight Gradualness

`TOPIC_WEIGHT_STEP = 0.1` per event. From the default of 1.0, a topic reaches
ceiling (2.0) after 10 consecutive net-positive feedback events. A topic reaches
floor (0.1) after 9 consecutive net-negative events. This mirrors the confidence-
dampening behavior of the Wilson score ranker in `lib/pipeline/ranker.ts`.

### No Feedback = Equal Weights

An identity with no discovery feedback rows has equal topic weights (all
defaultWeight = 1.0), producing uniform topic sampling. This satisfies
DISC-009 AC#8.

---

## 12. DB Schema -- discovery_topic_weights Table

New table required for DISC-009. Create in a new migration.

```sql
CREATE TABLE IF NOT EXISTS discovery_topic_weights (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT,
  device_id   TEXT        NOT NULL,
  topic_id    TEXT        NOT NULL,
  weight      NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, device_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_disc_weights_user   ON discovery_topic_weights (user_id);
CREATE INDEX IF NOT EXISTS idx_disc_weights_device ON discovery_topic_weights (device_id);
```

**Note on UNIQUE constraint**: `user_id` can be null (anonymous devices), so
the constraint is `(user_id, device_id, topic_id)` which in Postgres treats
distinct NULLs as non-equal. For anonymous users, the unique key is effectively
`(NULL, device_id, topic_id)`. This is acceptable for the milestone; a COALESCE
workaround is deferred.

DB helper file: `lib/db/discovery.ts`

```typescript
export interface TopicWeightRow {
  user_id: string | null;
  device_id: string;
  topic_id: string;
  weight: number;
}

export async function getTopicWeightsForUser(userId: string): Promise<TopicWeightRow[]>
export async function getTopicWeightsForDevice(deviceId: string): Promise<TopicWeightRow[]>
export async function getAllTopicWeightsAveraged(): Promise<Map<string, number>>  // topic_id -> avg weight
export async function upsertTopicWeight(
  deviceId: string,
  topicId: string,
  weight: number,
  userId?: string | null
): Promise<void>
```

---

## 13. API Contract -- No Changes to GET /api/feed/today

The `GET /api/feed/today` response shape is unchanged:

```typescript
{
  batchDate: string;
  articles: Article[];    // Article without discoveryTopic field (stripped before response)
  generatedAt?: string;
}
```

Discovery articles appear in `articles[]` with the same field set as
fixed-pipeline articles. No `isDiscovery` flag, no `discoveryTopic` field,
no new envelope fields. Existing integration tests require no modification.

The only code change to `app/api/feed/today/route.ts` is the one-line strip
of `discoveryTopic` before serialization (section 10).

---

## 14. New Modules -- Directory Map

Expected file tree after all tasks are complete:

```
lib/
  config/
    feed.ts                    <- NEW: quota + discovery tuning constants
  discovery/
    topics.ts                  <- NEW: DISCOVERY_TOPICS array + DiscoveryTopic type
    braveSearch.ts             <- NEW: Brave Search API HTTP adapter
    qualityGate.ts             <- NEW: evaluateCandidate() pure function module
    run.ts                     <- NEW: runDiscovery() orchestrator
  db/
    client.ts                  (unchanged)
    auth.ts                    (unchanged)
    feedback.ts                (unchanged)
    discovery.ts               <- NEW: topic weight DB helpers
  pipeline/
    config.ts                  <- MODIFIED: ARTICLES_PER_DAY imported from lib/config/feed.ts
    run.ts                     <- MODIFIED: calls runDiscovery(), assembles combined batch
    (all other files unchanged)
  types/
    article.ts                 <- MODIFIED: add optional discoveryTopic field
app/
  api/
    feed/
      today/
        route.ts               <- MODIFIED: strip discoveryTopic before API response
.env.example                   <- MODIFIED: add BRAVE_SEARCH_API_KEY=
agents/architect/
  design_proactive_discovery_v1.md  <- this file
  tasks_proactive_discovery_v1.md   <- companion task list
```

---

## 15. What Does NOT Change

| Component | Status |
|-----------|--------|
| `lib/pipeline/validator.ts` | No changes. Quality gate mirrors its rules independently |
| `lib/pipeline/storage.ts` | No changes |
| `lib/pipeline/ranker.ts` | No changes. Ranking runs on the combined batch as-is |
| `lib/pipeline/cooldown.ts` | No changes |
| `lib/pipeline/adapters/` | No changes |
| `lib/pipeline/config.ts` | ARTICLES_PER_DAY import source updated; no other changes |
| `app/api/pipeline/run/route.ts` | No changes |
| `app/api/feed/refresh/route.ts` | No changes -- calls runPipeline() which now includes discovery |
| `app/api/feedback/` routes | No changes |
| `app/api/auth/` routes | No changes |
| `app/api/articles/[id]/route.ts` | No changes |
| `app/components/` | No changes |
| `app/page.tsx` | No changes |
| `data/sources.json` | No changes |
| `FeedResponse` public shape | No changes |
| Client-side code | No changes |

---

## 16. Key Decisions Table

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Search provider | Brave Search API | Independent index (no Google dependency), strong long-tail coverage, free tier covers ~180 calls/month at our cadence, structured JSON response with outlet name and age fields |
| Topic configuration storage | TypeScript static array in `lib/discovery/topics.ts` | Type-safe, no runtime I/O, compile-time schema validation. Adding a topic = one-line edit + redeploy. No changes to discovery execution logic. |
| Source credibility heuristic | Domain suffix blocklist in `qualityGate.ts` | Permissive by default; blocks only known high-noise domains. No allowlist maintenance burden. Extensible without logic changes. |
| Specificity scoring | Title pattern matching, penalty-based, 0.0-1.0 | No LLM dependency; deterministic; testable with mock inputs; configurable threshold |
| Freshness window | `DISCOVERY_MAX_AGE_HOURS = 72` | 3 days is current enough to feel relevant, permissive enough to surface non-daily publications. Brave freshness=pw (7 days) used as server-side pre-filter. |
| Topic weight storage | New `discovery_topic_weights` DB table | Survives server restarts; consistent with existing auth/feedback DB pattern; supports both user_id and device_id identity |
| discoveryTopic field placement | Optional field on Article type, stored in batch JSON, stripped from API response | Co-located with article data; no extra DB query at feedback time; consistent with filesystem-first architecture; never leaks to client |
| Config constants location | New `lib/config/feed.ts` | Cross-module constants (quota split, discovery tuning) need a neutral home that neither `lib/pipeline/config.ts` nor discovery modules own |
| Quota constant relationship | Startup assertion: PIPELINE + DISCOVERY === ARTICLES_PER_DAY | Prevents silent drift if one constant is changed without updating the others |
| Discovery failure behavior | try/catch in runPipeline; fall back to full fixed-source batch | Feed is never empty due to discovery failure; consistent with existing per-source isolation |
| Topic selection mechanism | Weighted random sampling without replacement | Proportional to normalized weights; all topics eligible each run; weight shift is gradual |
| Scheduled run topic weighting | Average weights across all users | No single user's preferences dominate the scheduled batch; per-user weights apply to manual refresh only |

---

## 17. External Dependencies and Environment Variables

**New npm packages**: none. `fetch` is available natively in Next.js (Node 18+).

**New environment variable**:

| Variable | Required For | Notes |
|----------|-------------|-------|
| `BRAVE_SEARCH_API_KEY` | All discovery pipeline runs | Obtain at https://api.search.brave.com. Free tier: 2,000 requests/month. Add to `.env.local`. Never commit. |

Add `BRAVE_SEARCH_API_KEY=` to `.env.example`.

---

## 18. Deferred Items

| Item | Rationale |
|------|-----------|
| User-configurable topic list | Intentionally excluded per BRD; defeats product autonomy value |
| Operator UI for managing discovery topics | Config-file concern; no admin UI in this milestone |
| Real-time or on-demand discovery outside manual refresh | Discovery is batch, once per day or on manual refresh |
| Discovery source write-back to data/sources.json | Discovery operates independently of the fixed source list |
| Social/community-sourced discovery | Out of scope per BRD |
| Body text extraction improvements for discovery articles | Brave returns description/snippet; full body extraction is a separate capability |
| Multiple query rotation per topic (searchQueries[1..N]) | queries[0] used in this milestone; multi-query rotation deferred |
| Per-topic result count tuning | Uniform DISCOVERY_CANDIDATES_PER_TOPIC for all topics; per-topic tuning deferred |
| LLM-based specificity scoring | Title heuristics sufficient for this milestone |
| Anonymous device topic weights in scheduled run average | Included in average calculation per section 11; edge-case handling of NULL uniqueness constraint deferred |

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-04 | Architect Agent | Initial draft. Milestone 7 Proactive Discovery design. Brave Search selected. Quality gate specified (4 criteria). discoveryTopic stored in batch JSON. Topic weights in new DB table. Constants in new lib/config/feed.ts. |
