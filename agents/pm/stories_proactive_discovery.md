# User Stories — Proactive Content Discovery (Milestone 7)

**Document ID**: stories_proactive_discovery.md
**Date**: 2026-04-04
**Status**: Draft
**Milestone**: 7 — Proactive Discovery
**Source BRD**: `agents/ba/brd_proactive_discovery.md` (BRD-006)
**Maintained by**: PM Agent

---

## Overview

These stories deliver a proactive content discovery layer that runs alongside the
existing RSS and NewsAPI pipeline. Each day, the discovery layer issues topic-driven
searches across a curated but broad set of topic areas, evaluates candidate articles
against quality criteria, and contributes up to 6 articles to the day's feed.

The existing fixed-source pipeline is untouched. Its contribution target shifts from
20 articles to 14 to make room for the 6 discovery slots. The split is a configurable
constant, not hardcoded.

Discovery articles are first-class citizens of the personalization system: feedback
on them feeds into the existing source-scoring ranker without any new logic, and at
the topic level, topics that produce liked articles over time are probed more often.

All stories depend on feed personalization (Milestone 4) being shipped. The topic
weighting feedback loop additionally depends on server-side feedback storage
(Milestone 2.5).

---

## Open Question Resolutions (PM Decisions)

BRD-006 had all questions resolved before reaching the PM. The following decisions
from the BRD are restated here for the Architect's reference.

### 1. Discovery Quota Split — PM Decision (from BRD)

**Decision**: 6 articles from discovery, 14 from the fixed-source pipeline, for a
combined daily target of 20. Both values are configurable constants:
`DISCOVERY_ARTICLES_PER_DAY` (default 6) and `PIPELINE_ARTICLES_PER_DAY` (default
14). The Architect determines the exact constant names and their location, consistent
with existing pipeline configuration constants.

**Rationale**: 6 of 20 (30%) is enough to shape the feed's character without
undermining the reliable news coverage the fixed pipeline provides. A configurable
split allows post-launch tuning based on user response without a code change.

### 2. Shortfall Behavior — PM Decision (from BRD)

**Decision**: If discovery produces fewer than 6 qualifying articles on a given day,
the shortfall is filled by additional articles from the fixed-source pipeline. The
total batch always reaches 20 articles. Discovery underperformance is acceptable and
expected; it does not produce a short feed.

### 3. Topic List Ownership — PM Decision (from BRD)

**Decision**: The topic list is a system configuration concern, not a user-facing
feature. Users cannot view, add, remove, or reorder topics. The Architect decides
the storage format (config file, environment variable, code constant). The PM
requires only that adding or removing topics does not require a code change to the
discovery execution logic.

### 4. Topic Weighting Mechanism — Architect Decision (Flagged)

The BRD requires that topics producing liked articles over time are probed more
frequently, and topics consistently producing disliked articles are probed less
frequently. The specific weighting mechanism (weighted random selection, score-based
sampling, frequency multiplier, etc.) is an Architect decision. The PM's behavioral
requirement is captured in DISC-009: no topic is fully eliminated by feedback alone,
and the shift in probe frequency is gradual, not sudden.

### 5. Freshness Recency Window — Architect Decision (Flagged)

The BRD requires discovery articles to be "fresh enough to feel current" and
specifies that the exact recency window is an Architect decision. The PM's
behavioral requirement is that evergreen content more than a reasonable number of
days old (the Architect defines "reasonable") is excluded from discovery candidates.
The window must be a configurable constant.

### 6. Source Credibility Heuristic — Architect Decision (Flagged)

The BRD describes source credibility as "recognizable standing in the relevant
domain" — not a whitelist. The mechanism for evaluating credibility (domain
reputation signals, known content-farm pattern exclusions, etc.) is an Architect
decision. No explicit allowlist or blocklist is required by the PM for this
milestone.

---

## Dependency Order

```
DISC-001 (Topic Configuration)
    └── DISC-002 (Daily Discovery Run — Scheduler Integration)
            └── DISC-003 (Web Search Execution per Topic)
                    └── DISC-004 (Quality Gate — Candidate Evaluation)
                            └── DISC-005 (Deduplication Against Fixed Pipeline)
                                    └── DISC-006 (Discovery Quota Enforcement)
                                            └── DISC-007 (Pipeline Quota Split)
                                                    └── DISC-008 (Discovery Articles in Feed API)

DISC-009 (Topic Weight Feedback Loop)
    └── depends on DISC-001, DISC-004, SFB-004 (Milestone 2.5 — feedback write API)

DISC-010 (Discovery Source Attribution)
    └── depends on DISC-004
    └── blocks DISC-009 (source scoring only works if sourceName is set correctly)
```

Stories marked **[BLOCKS X]** must be accepted before those stories can begin.

---

## Stories

---

### DISC-001 — Topic Configuration

**Priority**: P0
**Blocks**: DISC-002, DISC-003, DISC-009
**Depends on**: —

**As a** system operator,
**I want** the discovery topic list to be stored in a configuration file or
well-defined constant,
**so that** topics can be added, removed, or reordered without touching the
discovery execution logic and without requiring a code change to business logic.

#### Acceptance Criteria

1. A topic configuration artifact exists at a location defined by the Architect
   (e.g., `data/discovery-topics.json`, `lib/discovery/topics.ts`, or an environment
   variable). The location is documented in the Architect's design doc.
2. The topic list contains at minimum the following illustrative areas, each
   represented as a distinct topic entry: science and technology (with a bias toward
   fringe and emerging areas), music and audio culture, visual art and design,
   architecture and built environment, fashion and material culture, nature and
   ecology, mathematics and philosophy, film and visual storytelling, literature and
   language, craft and making, economics and behavioral science, history and
   archaeology. The Architect may subdivide, combine, or label these as they see fit.
3. Each topic entry carries enough information for the discovery execution logic to
   construct a search query. At minimum this means a human-readable label and a
   query string or set of query terms. The exact schema is an Architect decision.
4. The discovery execution logic reads topics from this configuration at runtime
   (or compile time if static). Changing the topic list does not require any
   modification to the discovery orchestration or quality gate logic.
5. The configuration format supports a per-topic soft weight (a numeric value
   indicating how often to probe that topic relative to others). Default weight for
   all topics at initialization is equal. This field must exist in the schema from
   the start, even if all weights are equal at launch, because DISC-009 writes to it.
6. Adding a new topic to the configuration and redeploying causes the discovery
   process to include that topic in the next run without any other code change.

---

### DISC-002 — Daily Discovery Run — Scheduler Integration

**Priority**: P0
**Blocks**: DISC-003
**Depends on**: DISC-001

**As a** system operator,
**I want** the discovery process to run once per day as part of the scheduled
pipeline execution,
**so that** the discovery batch is always available when the feed is served and
does not require separate operator intervention.

#### Acceptance Criteria

1. The discovery process executes once per day, triggered by (or immediately
   following) the existing scheduled pipeline run. The exact execution order
   (before, after, or in parallel with the fixed-source pipeline fetch) is an
   Architect decision; the requirement is that both processes complete before the
   final batch is assembled.
2. The discovery run is also triggered when a manual refresh is requested by an
   authenticated user (per REFRESH-003, Milestone 5). A manual refresh runs both
   the fixed-source pipeline and the discovery process; the output is a fresh
   combined batch.
3. The discovery run does not run more than once per scheduled pipeline cycle
   (idempotency). Calling the pipeline trigger a second time on the same day does
   not cause a second discovery fetch; it produces a fresh batch using existing
   discovery candidates or re-fetches at the Architect's discretion, with no
   duplicate API calls for the same topics already fetched that day.
4. If the discovery process fails entirely (unrecoverable error), the failure is
   logged and the fixed-source pipeline completes and writes a batch using its
   standard behavior (20 articles from the fixed pipeline). The feed is never
   empty due to a discovery failure.
5. Discovery run start and completion are logged with timestamps for operator
   visibility.

---

### DISC-003 — Web Search Execution per Topic

**Priority**: P0
**Blocks**: DISC-004
**Depends on**: DISC-001, DISC-002

**As a** system that proactively ranges across the web,
**I want** to issue a search query for each configured topic and collect a pool
of candidate article results,
**so that** the quality gate in DISC-004 has a pool of real articles to evaluate.

#### Acceptance Criteria

1. For each topic in the topic configuration, the discovery process constructs a
   search query and issues it to the configured web search provider. The choice
   of search provider and API is an Architect decision.
2. The search is topic-directed, not source-directed. The system does not request
   articles from specific domains or feeds; it issues open queries and accepts
   whatever the search provider returns.
3. Each search retrieves a candidate pool. The size of the candidate pool per topic
   (e.g., top N results per query) is a configurable constant defined by the
   Architect.
4. Topics are probed in proportion to their current soft weights from DISC-001. A
   topic with a higher weight is probed more often (or with more candidate results)
   than a topic with a lower weight. The exact sampling mechanism is an Architect
   decision. At launch, with all weights equal, all topics are probed equally.
5. The search process is tolerant of per-topic failures: if a query for one topic
   returns an error or empty results, the process logs the failure and continues
   with the remaining topics. A single-topic failure does not abort the discovery
   run.
6. The raw results from each topic query are passed to the quality gate (DISC-004)
   before any article is admitted to the candidate pool.
7. The system is permitted to surface an article from a category not explicitly in
   the topic list if the search provider's results include it and the article passes
   the quality gate. The topic list is a direction, not a constraint on admission.

---

### DISC-004 — Quality Gate — Candidate Evaluation

**Priority**: P0
**Blocks**: DISC-005, DISC-010
**Depends on**: DISC-003

**As a** system committed to surfacing genuinely interesting content,
**I want** each discovery candidate to pass a multi-criteria quality evaluation
before being admitted to the candidate pool,
**so that** the discovery layer contributes a small number of high-quality articles
rather than a large number of mediocre ones.

#### Acceptance Criteria

1. Every article returned by a topic search (DISC-003) passes through the quality
   gate before it is added to the discovery candidate pool. Articles that fail any
   criterion are discarded and do not count toward the discovery quota.
2. **Existing validator rules**: Each candidate must pass the same validation checks
   applied by `lib/pipeline/validator.ts` to fixed-pipeline articles: minimum title
   length, minimum description length, valid URL. The exact minimum lengths are
   unchanged from the existing validator.
3. **Freshness**: Each candidate must have a publication date within a recency window.
   Articles older than the window are discarded. The recency window is a configurable
   constant defined by the Architect and documented in the design doc.
4. **Source credibility heuristic**: Candidates from domains with strong content-farm
   or pure-aggregator signals are excluded. The specific heuristic (blocked domain
   patterns, third-party domain reputation service, etc.) is an Architect decision.
   The PM's requirement is that the heuristic is applied at the evaluation stage and
   does not require a manually maintained allowlist to function.
5. **Specificity bias**: The quality gate applies a preference for specific, focused
   articles over generic overviews. The mechanism (e.g., title keyword pattern
   matching, LLM-based scoring, description length heuristics) is an Architect
   decision. The requirement is that a generic "The future of X" style title is
   less likely to pass than a specific "New technique in X achieves Y" style title.
   The Architect must document the chosen approach.
6. **Clickbait / promotional filter**: Articles with titles or descriptions matching
   known clickbait or purely promotional patterns are excluded. The specific
   pattern list or detection method is an Architect decision.
7. Each discarded article is logged with the reason it failed (which criterion it
   did not meet). This log is written at debug level and is not user-visible.
8. The quality gate is implemented as an isolated, independently testable module.
   It can be unit-tested by passing in mock article objects without invoking a real
   search provider.

---

### DISC-005 — Deduplication Against Fixed Pipeline

**Priority**: P0
**Blocks**: DISC-006
**Depends on**: DISC-004

**As a** user,
**I want** discovery articles not to repeat articles already in my feed from the
fixed-source pipeline,
**so that** the same article never appears twice in the same daily batch.

#### Acceptance Criteria

1. After the quality gate (DISC-004), each surviving discovery candidate is checked
   against the article set produced by the fixed-source pipeline for the same day.
2. Deduplication is by article URL (canonical URL, ignoring query strings and
   fragments). If a discovery candidate URL matches a fixed-pipeline article URL,
   the discovery candidate is discarded.
3. The deduplication logic reuses the same URL normalization already used by the
   existing pipeline deduplication step. No new normalization logic is introduced.
4. Deduplication within the discovery candidate pool itself is also applied: if two
   topic searches return the same URL, only one instance is retained before quota
   enforcement.
5. A discovery article that is deduplicated out does not count toward the discovery
   quota. If deduplication reduces the discovery pool below 6 qualifying articles,
   the shortfall behavior in DISC-006 applies.
6. The fixed-source pipeline runs before or in parallel with the discovery process,
   and its article URL set is available to the deduplication step when it runs.
   If the pipeline ordering makes this impossible for a given run, the Architect
   documents the fallback behavior (e.g., dedup against the previous day's fixed
   pipeline output).

---

### DISC-006 — Discovery Quota Enforcement

**Priority**: P0
**Blocks**: DISC-007
**Depends on**: DISC-005

**As a** system assembling the daily batch,
**I want** the discovery layer to contribute exactly its configured quota of articles
(or fewer if the pool is too small),
**so that** the combined batch does not accidentally contain too many discovery
articles and the quota split is predictable.

#### Acceptance Criteria

1. A configuration constant `DISCOVERY_ARTICLES_PER_DAY` exists. Its default value
   is `6`. This constant is defined in the same location as the other pipeline quota
   constants (per Architect's design doc).
2. After deduplication (DISC-005), the discovery process selects up to
   `DISCOVERY_ARTICLES_PER_DAY` articles from the surviving candidate pool.
3. If the surviving pool has more than `DISCOVERY_ARTICLES_PER_DAY` articles, the
   system selects the best-quality candidates up to the quota limit. The selection
   criterion (quality score, recency, topic diversity across the selected set, etc.)
   is an Architect decision.
4. If the surviving pool has fewer than `DISCOVERY_ARTICLES_PER_DAY` articles, all
   surviving articles are included. No padding occurs. The shortfall is recorded
   (logged) so the pipeline assembler (DISC-007) can fill it from the fixed pipeline.
5. The selected discovery articles are passed to the pipeline assembler as a distinct
   set, clearly labeled as discovery-sourced. The assembler in DISC-007 does not
   need to re-evaluate quality; it trusts the output of this step.
6. If the discovery pool is entirely empty (zero qualifying articles after quality
   gate and deduplication), zero discovery articles are contributed. This is not an
   error condition. It is logged at info level.

---

### DISC-007 — Pipeline Quota Split

**Priority**: P0
**Blocks**: DISC-008
**Depends on**: DISC-006, REFRESH-009 (Milestone 5 — per-source article cap)

**As a** system assembling the daily batch,
**I want** the total 20-article batch to be assembled from a configured split
between discovery and fixed-source articles, with the fixed-source pipeline
filling any discovery shortfall,
**so that** the user always receives a full 20-article feed regardless of how
many discovery articles qualified that day.

#### Acceptance Criteria

1. A configuration constant `PIPELINE_ARTICLES_PER_DAY` exists. Its default value
   is `14`. Together with `DISCOVERY_ARTICLES_PER_DAY` (default 6), they sum to
   `ARTICLES_PER_DAY` (20). The Architect must verify these constants are
   consistent and document the relationship.
2. The fixed-source pipeline (RSS + NewsAPI fetch) targets `PIPELINE_ARTICLES_PER_DAY`
   articles as its contribution to the batch. Its existing per-source cap
   (`MAX_ARTICLES_PER_SOURCE`, Milestone 5) and minimum source diversity rules
   continue to apply to its 14-article contribution.
3. If the discovery layer contributes fewer than `DISCOVERY_ARTICLES_PER_DAY`
   articles (due to quality failures or empty pool), the fixed-source pipeline
   contribution is increased by the shortfall amount. Example: if discovery yields
   only 3 articles, the fixed pipeline targets 17 articles for that day.
4. The fixed-source pipeline's per-source cap (`MAX_ARTICLES_PER_SOURCE = 5`) does
   not increase when filling a discovery shortfall. If filling the shortfall would
   require a source to exceed its cap, the batch is assembled with whatever is
   available from sources still under their cap. The total batch may be fewer than
   20 articles if sources are exhausted.
5. The combined batch (discovery articles + fixed-source articles) is assembled and
   passed to the existing personalization and ranking step unchanged. Personalization
   (Milestone 4) runs on the combined batch; it does not treat discovery articles
   differently from fixed-pipeline articles.
6. The assembled batch composition is logged (e.g., "Batch: 17 fixed-source, 3
   discovery") at info level on each run for operator visibility.

---

### DISC-008 — Discovery Articles in Feed API

**Priority**: P0
**Blocks**: —
**Depends on**: DISC-007

**As a** frontend developer,
**I want** `GET /api/feed/today` to return discovery articles alongside fixed-source
articles with no change to the response shape,
**so that** the client requires no changes to render discovery articles and users
see a seamlessly integrated feed.

#### Acceptance Criteria

1. The `GET /api/feed/today` response shape is unchanged from today. Discovery
   articles appear in the `articles` array with the same fields as fixed-pipeline
   articles (`id`, `title`, `description`, `url`, `sourceName`, `publishedAt`,
   etc.). No new required fields are added to the response.
2. Each discovery article carries a `sourceName` derived from the publication or
   outlet where the article was found (e.g., "Wired", "The Atlantic", "Quanta
   Magazine") — not from the discovery topic category or a generic "Discovery"
   label. The `sourceName` is the outlet's name, consistent with how fixed-pipeline
   articles are attributed.
3. The client does not receive any signal indicating whether an article originated
   from discovery vs. the fixed pipeline. The distinction is invisible to the client
   and to the user.
4. Discovery articles are sorted and ranked by the personalization layer (Milestone
   4) alongside fixed-pipeline articles. A highly-scored discovery article may appear
   near the top of the feed; a low-scored one may appear near the bottom. Ranking
   is source-score-based and does not treat discovery origin as a factor.
5. Existing integration tests for `GET /api/feed/today` continue to pass without
   modification. The endpoint's contract is unchanged.

---

### DISC-009 — Topic Weight Feedback Loop

**Priority**: P1
**Blocks**: —
**Depends on**: DISC-001, DISC-004, DISC-010, SFB-004 (Milestone 2.5)

**As a** user who interacts with discovery articles over time,
**I want** the topics I engage positively with to be probed more often,
**so that** the discovery layer gradually biases toward the broad areas I find
most interesting without me having to configure anything explicitly.

#### Acceptance Criteria

1. When a user likes a discovery article, the topic category that produced that
   article has its soft weight increased. When a user dislikes a discovery article,
   the topic's soft weight is decreased. The magnitude of the adjustment per
   feedback event is a configurable constant defined by the Architect.
2. Topic weight adjustments are per-identity, consistent with the personalization
   system: authenticated users have account-level topic weights; anonymous users
   have device-level topic weights.
3. Topic weights have a floor and a ceiling. A topic that has received consistent
   dislikes does not drop to zero weight — it is probed less frequently but never
   eliminated from the rotation entirely. A topic that has received consistent likes
   does not crowd out all other topics — the ceiling prevents any single topic from
   dominating the rotation. The exact floor and ceiling values are configurable
   constants defined by the Architect.
4. Topic weight changes are gradual, not sudden. A single like or dislike does not
   meaningfully shift a topic's frequency. A consistent pattern across many feedback
   events produces a noticeable shift. This mirrors the confidence-dampening behavior
   already established in the source scoring model (PERS-001).
5. Topic weights are stored persistently (survive server restarts). The storage
   mechanism is an Architect decision.
6. The topic weight system reads the association between an article and its originating
   topic from DISC-010 (which records topic-of-origin on each discovery article).
7. Topic weight adjustments are queued and applied at the next pipeline run, not in
   real time. Feedback given during the day influences the following day's topic
   probe frequency.
8. An identity that has given no feedback on discovery articles has equal weights
   across all topics (the default state). The discovery behavior for such a user is
   identical to a fresh installation.

---

### DISC-010 — Discovery Source Attribution

**Priority**: P0
**Blocks**: DISC-009
**Depends on**: DISC-004

**As a** system that needs to feed discovery feedback back into personalization,
**I want** each discovery article to carry metadata recording which topic category
produced it and what outlet it was found on,
**so that** feedback on that article can correctly update both the source-level
score (existing ranker) and the topic-level weight (DISC-009).

#### Acceptance Criteria

1. Each article admitted by the quality gate (DISC-004) carries two attribution
   fields: `sourceName` (the outlet or publication name, as described in DISC-008)
   and `discoveryTopic` (the topic category that produced this article, as a label
   matching an entry in the topic configuration from DISC-001).
2. `sourceName` is populated from the article's publication metadata (domain name,
   outlet name field from the search result, etc.), not from the topic label.
3. `discoveryTopic` is not exposed to the client or user. It is an internal metadata
   field used only by the topic weight feedback loop (DISC-009) and pipeline
   logging. It is not included in the `GET /api/feed/today` response.
4. If the topic category cannot be determined (e.g., the article was surfaced by a
   search result outside the explicit topic list), `discoveryTopic` is set to a
   sentinel value (e.g., `"uncategorized"`) rather than null or omitted. Articles
   with `discoveryTopic = "uncategorized"` do not contribute to any topic weight
   adjustment.
5. The `discoveryTopic` field is stored alongside the article in the batch output
   (or in a separate discovery metadata store, at the Architect's discretion) so
   that when a user provides feedback on the article after the pipeline has
   completed, the association between article and topic is still available.

---

## Future Stories

The following items were explicitly excluded from BRD-006 and are not stories in
this milestone. They are recorded here so they are not lost.

| Item | Rationale for Deferral | Suggested Future Milestone |
|------|------------------------|---------------------------|
| User-configurable discovery topics | Intentionally out of scope; defeats the product's autonomy value | Not planned |
| Operator UI for managing discovery topics | Config-file concern for now | Future |
| Real-time or on-demand discovery (outside of manual refresh) | Discovery is batch, once per day | Future |
| Discovery source → fixed pipeline write-back (writing to data/sources.json) | Discovery is independent of the fixed source list | Not planned |
| Social/community-sourced discovery | Out of scope per BRD | Not planned |
| Article-level body text extraction improvements | Separate capability, not expanded here | Future |

---

## Story Summary Table

| Story ID | Title | Group | Priority | Depends On | Blocks |
|----------|-------|-------|----------|------------|--------|
| DISC-001 | Topic Configuration | Infrastructure | P0 | — | DISC-002, DISC-003, DISC-009 |
| DISC-002 | Daily Discovery Run — Scheduler Integration | Infrastructure | P0 | DISC-001 | DISC-003 |
| DISC-003 | Web Search Execution per Topic | Core Discovery | P0 | DISC-001, DISC-002 | DISC-004 |
| DISC-004 | Quality Gate — Candidate Evaluation | Core Discovery | P0 | DISC-003 | DISC-005, DISC-010 |
| DISC-005 | Deduplication Against Fixed Pipeline | Core Discovery | P0 | DISC-004 | DISC-006 |
| DISC-006 | Discovery Quota Enforcement | Batch Assembly | P0 | DISC-005 | DISC-007 |
| DISC-007 | Pipeline Quota Split | Batch Assembly | P0 | DISC-006, REFRESH-009 | DISC-008 |
| DISC-008 | Discovery Articles in Feed API | API / Client | P0 | DISC-007 | — |
| DISC-009 | Topic Weight Feedback Loop | Personalization | P1 | DISC-001, DISC-004, DISC-010, SFB-004 | — |
| DISC-010 | Discovery Source Attribution | Personalization | P0 | DISC-004 | DISC-009 |

DISC-001 through DISC-008, DISC-010 are P0. DISC-009 is P1: the feedback loop
enriches the discovery system over time but is not required for the core discovery
experience to function at launch.

---

## Definition of Done (Milestone 7)

All P0 stories are accepted when:

1. The daily feed contains at least 1 and up to 6 articles sourced from web
   discovery (not from configured RSS feeds or NewsAPI).
2. Every discovery article has a `sourceName` reflecting its outlet, not a generic
   discovery label. The attribute is indistinguishable in format from a fixed-pipeline
   article's `sourceName`.
3. No discovery article is a URL duplicate of any article contributed by the
   fixed-source pipeline in the same batch.
4. No discovery article is older than the configured recency window.
5. Discovery articles pass the existing `validator.ts` rules (minimum title length,
   minimum description length, valid URL).
6. If discovery yields fewer than 6 qualifying articles, the fixed-source pipeline
   fills the shortfall and the total batch reaches 20 articles.
7. If the discovery process fails entirely, the pipeline still completes and writes
   a 20-article batch from the fixed-source pipeline. No user-visible error occurs.
8. The `GET /api/feed/today` response shape is unchanged. Existing clients and
   integration tests require no modification.
9. Both `DISCOVERY_ARTICLES_PER_DAY` and `PIPELINE_ARTICLES_PER_DAY` are
   configurable constants with documented defaults.
10. The topic list is stored in a configuration artifact and can have topics added
    or removed without modifying discovery execution logic.

The P1 story (DISC-009 — Topic Weight Feedback Loop) is accepted when:

11. After a user consistently likes articles from a given topic category across
    multiple days, that category is probed with higher frequency in subsequent runs.
12. After a user consistently dislikes articles from a given topic, that category
    is probed less frequently but still appears in the rotation.
13. A user with no discovery feedback history has equal topic weights across all
    categories and sees topic-balanced discovery results.

---

## Notes for the Architect

- **Search provider choice**: The PM has no preference. The Architect selects the
  web search API (e.g., Brave Search, Bing Web Search, SerpAPI, Exa). Choose based
  on cost, rate limits, and quality of results for niche/long-tail content. Document
  the provider and its cost model in the design doc.
- **Topic configuration schema**: The schema must include a soft weight field from
  day one (DISC-001). Even if all weights are 1.0 at launch, DISC-009 needs to
  write to this field without a schema migration.
- **Discovery topic of origin storage**: When a user gives feedback on a discovery
  article after the pipeline has run, the system must still be able to resolve which
  topic produced that article. The Architect must decide where `discoveryTopic` is
  stored (in the article record, in a separate table, as part of the batch output
  file) and ensure it is accessible at feedback time.
- **Quota constant naming and location**: `DISCOVERY_ARTICLES_PER_DAY`,
  `PIPELINE_ARTICLES_PER_DAY`, and the recency window constant should live alongside
  existing pipeline constants (`ARTICLES_PER_DAY`, `MAX_ARTICLES_PER_SOURCE`, etc.)
  in the same config module. Document this in the design doc.
- **ARTICLES_PER_DAY interaction**: The existing `ARTICLES_PER_DAY = 20` constant
  should remain the authoritative total. `DISCOVERY_ARTICLES_PER_DAY +
  PIPELINE_ARTICLES_PER_DAY` must equal `ARTICLES_PER_DAY`. The Architect should
  add an assertion or test to verify this relationship is maintained if constants
  are changed.
- **Milestone 5 interaction**: The per-source article cap (`MAX_ARTICLES_PER_SOURCE
  = 5`) from Milestone 5 applies to the fixed-source pipeline's contribution only.
  Discovery articles are not sourced from the fixed source list and are not subject
  to this cap at the pipeline level — though the quality gate and quota enforcement
  provide analogous constraints.
- **Personalization pass-through**: The combined batch (fixed + discovery) is passed
  to the personalization ranker exactly as the current 20-article batch is. No
  changes to the Milestone 4 ranker are required. The ranker scores by `sourceName`,
  which discovery articles carry correctly.

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-04 | PM Agent | Initial draft. 10 stories written from BRD-006. Architect decisions flagged: search provider, topic weight mechanism, freshness recency window, source credibility heuristic, specificity scoring method, topic weight storage. PM decisions restated from BRD: 6/14 quota split, shortfall fill behavior, topic list as system config. |
