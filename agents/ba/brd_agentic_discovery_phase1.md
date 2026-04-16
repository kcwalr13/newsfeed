# BRD-007: Agentic Content Discovery — Phase 1

| Field | Value |
|-------|-------|
| **ID** | BRD-007 |
| **Title** | Agentic Content Discovery — Phase 1 |
| **Date** | 2026-04-04 |
| **Status** | Resolved |
| **Phase** | Phase 1 — Agentic Content Discovery |
| **Depends On** | BRD-006 (Proactive Content Discovery, shipped as Milestone 7/8) |

---

## Problem Statement

The current discovery layer uses Brave Search with single keyword queries per topic
and evaluates candidates only by title and a one-sentence description. This approach
surfaces content the same way a generic search engine does: keyword matches on
recency-optimized, SEO-tuned pages. It cannot find the kind of writing that defines
publications like The Browser, The Marginalian, or Arts & Letters Daily — pieces
with genuine intellectual depth, enduring value, and cross-disciplinary reach,
often published on personal sites, digital gardens, and independent outlets that
never appear in commercial search results.

Three specific gaps drive this BRD:

1. The source pool is narrow. Brave Search queries only surface what ranks well in
   a commercial index. The most interesting writing on the internet — personal essays,
   digital gardens, specialist blogs, IndieWeb publications — is structurally invisible
   to this approach because those sources do not optimize for search engines.

2. The quality gate is shallow. Evaluating a candidate by its title alone cannot
   distinguish a genuinely insightful piece from a well-titled piece of SEO filler.
   Real quality assessment requires reading the actual content.

3. The search strategy is repetitive. One query formulation per topic, run on the
   same schedule, produces diminishing returns. The same sources keep winning the
   same keyword matches. The feed stops expanding its range.

This BRD defines Phase 1 of the Agentic Discovery upgrade: four concrete improvements
that together replace keyword-driven mediocrity with a system capable of genuine
curation.

---

## Goals

- The system discovers and indexes a new class of source — IndieWeb sites, personal
  blogs, and digital gardens — by crawling seed directories and following blogrolls
  organically, without requiring manual source additions.
- Candidate articles are evaluated against a meaningful definition of intellectual
  quality: substance, originality, cross-disciplinary reach, enduring relevance, and
  writing quality. Evaluation is based on actual article content, not just title and
  description.
- Article body text is fetched and extracted reliably enough to power LLM evaluation,
  with graceful degradation when extraction fails.
- The search strategy diversifies across multiple query formulations per topic, rotates
  queries across runs to prevent repetition, and uses LLM-generated queries that
  capture curatorial intent — not just keyword matching.
- The discovery layer continues to feed into the existing personalization and ranking
  system with no changes to downstream behavior.
- The existing RSS, NewsAPI, and Brave Search pipelines are not broken or modified
  as a consequence of this work; Phase 1 augments the discovery layer, it does not
  replace it wholesale.

---

## Non-Goals

- **Phase 2, 3, or 4 features.** Latent aesthetic space modeling, psychographic
  profiling, vector embeddings, and serendipity engineering are out of scope.
- **Real-time or continuous crawling.** The Small Web crawler runs on the same
  scheduled cadence as the existing pipeline — once per day. There is no continuous
  background indexing.
- **Full website archiving.** The system fetches individual article pages on demand
  for evaluation. It does not build a local mirror or persistent index of entire sites.
- **User-facing source management.** Users cannot add, edit, or view the Small Web
  source pool. Source discovery is an internal system concern.
- **Paywall bypass.** If an article is behind a hard paywall, the system gracefully
  skips it. No authentication, cookie injection, or circumvention is attempted.
- **Operator tooling for the source pool or query library.** Managing seed directories,
  query rotation, and LLM-generated query caches is a configuration and code concern,
  not a product UI feature.
- **Changes to the fixed-source pipeline** (RSS and NewsAPI adapters). Those remain
  exactly as shipped in Milestones 1 through 8.
- **Replacing Brave Search entirely.** Brave Search remains one input to discovery.
  Phase 1 improves how queries are formed and adds new source classes alongside it.

---

## Feature Details

### 1. IndieWeb and Small Web Source Seeding

The current discovery layer has no awareness of the decentralized Small Web. The most
intellectually interesting content on the internet is often published on personal
sites, digital gardens, and independent blogs that are invisible to commercial search
indexes because they do not optimize for SEO.

Phase 1 introduces a new source class — Small Web feeds — alongside the existing RSS,
NewsAPI, and Brave Search sources. The system seeds this class from a curated list of
known IndieWeb directories and blogroll aggregators, then expands organically by
following blogroll links discovered during crawls.

**How seeding works:** The system begins from a small, hand-curated list of seed
directories — places like the OPML blogroll exports published by known high-signal
curators, directories such as Ooh.directory (a human-curated index of personal blogs
with RSS feeds), Blogroll.org, and the IndieWeb wiki's directory of personal sites.
These directories provide a structured starting point without requiring the system to
crawl the open web blindly.

**How organic discovery works:** When the system crawls a site from the seed pool, it
parses the page for blogroll links (lists of links to other sites the author follows
or recommends). Any linked site that has a valid RSS or Atom feed is added to the
candidate source pool for future runs. This is the same mechanism that made blogrolls
the IndieWeb's decentralized discovery algorithm: one trusted starting point naturally
expands into a network of related, curated sources.

**How repetition is avoided:** Each source URL is recorded after its first successful
crawl, with a timestamp. The system will not re-crawl a source more frequently than
once every seven days. Sources that consistently produce zero qualifying articles over
four consecutive crawls are deprioritized but not deleted — they remain eligible for
periodic re-checking in case the site becomes active again.

### 2. LLM-Based Content Evaluation

The current quality gate in `lib/discovery/qualityGate.ts` applies four ordered
criteria: basic validator rules, a 72-hour freshness window, a domain blocklist, and
a title specificity heuristic (regex-based scoring). None of these criteria actually
read the article. A well-titled piece of SEO padding passes; a modestly titled
masterwork of long-form writing fails.

Phase 1 replaces the specificity heuristic — the final, most judgment-dependent
criterion — with an LLM-based content evaluation that operates on the actual article
body text. The mechanical criteria (validator rules, freshness, domain blocklist) are
retained as a pre-filter, since they are cheap and catch obvious disqualifiers without
requiring an LLM call.

**Evaluation dimensions:** The LLM evaluator scores each candidate article across
five dimensions:

- **Intellectual substance:** Does the piece develop a real argument, finding, or
  insight? Is there something the reader would not know after reading a generic
  summary on the topic?
- **Originality:** Does the author have a distinct perspective, voice, or angle?
  Is this something you could find with a generic search, or does it reflect genuine
  independent thought?
- **Cross-disciplinary reach:** Does the piece connect ideas across domains, or draw
  on an unusual combination of fields? Would it interest someone who does not already
  follow this specific subject?
- **Evergreen durability:** Will this piece still be worth reading in a year? Is it
  anchored to a transient news event, or does it address something more foundational?
- **Writing quality:** Is the prose clear, precise, and crafted with care? Is it
  worth reading for the writing itself, not just the information?

Each dimension is scored on a 1–5 scale. The composite score is the average across
all five dimensions. An article must score 3.5 or higher to pass the quality gate.
The prompt instructs the model to evaluate as a thoughtful, widely-read editor would
— not as a classifier pattern-matching on surface signals.

**What this replaces:** The specificity heuristic in `qualityGate.ts` is removed.
The LLM evaluation step is inserted in its place, after the mechanical pre-filters
have already run. This keeps LLM calls to a minimum: only candidates that pass the
cheap checks (valid metadata, freshness, not blocklisted) are sent to the LLM.

### 3. Article Body Text Extraction

LLM-based evaluation requires reading the article. Currently, discovery candidates
arrive as title plus a one-sentence description from Brave Search — there is no body
text to evaluate. This feature makes article body text extraction a prerequisite step
in the discovery pipeline, run before the LLM evaluator is called.

**Extraction approach:** The system fetches the article URL and extracts the main
body text using a library-based extraction approach (Mozilla Readability, or a
comparable server-side equivalent). This approach works well on standard article
pages — it strips navigation, ads, and boilerplate, leaving prose text. It does not
require browser rendering or JavaScript execution for the majority of independent
and editorial sites targeted by this discovery layer.

**Graceful degradation:** Extraction will not succeed in every case. The following
failure modes are handled without crashing the pipeline:

- **Hard paywall:** The fetched page contains no extractable body text (only a
  teaser or a login prompt). The article is skipped. It does not proceed to LLM
  evaluation.
- **Extraction yields too little text:** If the extracted body is shorter than a
  minimum threshold (300 words), the article is skipped. A 300-word minimum is
  enough to distinguish a real article from a stub or a page-not-found redirect.
- **Fetch timeout or network error:** The article is skipped after a short timeout
  (8 seconds). Pipeline run time is not held hostage by unresponsive servers.
- **JavaScript-only rendering required:** If the fetched HTML has no readable body
  content, the article is skipped. Headless browser rendering is not in scope for
  Phase 1.

Skipped articles are logged with the reason. The discovery run continues with
remaining candidates. Extraction failures do not count against the discovery quota:
if 10 candidates are evaluated and 4 fail extraction, the remaining 6 are evaluated
and may contribute to the quota.

**Feed presentation:** Extracted body text is stored in the `bodyText` field on the
Article type (already defined in `lib/types/article.ts`). This means discovery
articles arrive in the feed with full body text already available, improving the
reading experience in the article detail view for articles sourced through this path.

### 4. Expanded Search Strategy

The current discovery run issues one query per topic per run. The same query text is
reused on every run. This means the same sources win the same keyword matches day
after day, and the discovery layer stops expanding.

Phase 1 replaces single-query-per-topic execution with a richer search strategy:

**Multiple query formulations per topic:** Each topic in `lib/discovery/topics.ts`
will carry a bank of query formulations rather than a single query string. On each
run, the system selects a subset of queries from the bank for execution — not all of
them, to stay within API call budgets. The recommended starting size is three to five
distinct formulations per topic, with two queries executed per topic per run.

**Query rotation:** The system tracks which queries have been executed recently and
preferentially selects queries that have not run in the longest time. This ensures
the full bank is cycled through over time rather than falling into a fixed rotation.
Rotation state is persisted between runs so it survives server restarts.

**LLM-generated query formulations:** Rather than requiring a human to write all
query variants manually, the system uses an LLM to generate the query bank for each
topic on first use, and refreshes the bank periodically (monthly, or on demand). The
generation prompt instructs the LLM to write queries the way a master curator would
search — not generic keyword phrases, but precise formulations that would surface
high-signal, niche, cross-disciplinary writing. Example: for the topic "materials
science," a manually authored query might be "materials science articles." An
LLM-generated query might be "overlooked properties of materials that changed how
something was made" or "materials that behave unexpectedly at scale." The LLM-
generated bank is cached and not regenerated on every run. When regeneration runs,
the new bank replaces the old one and rotation state resets.

---

## User Impact

**Who is affected:** All users of the discovery feed, from the day Phase 1 ships.
For the current single-user deployment, this means Kyle directly.

**How the experience changes:**

The feed will begin surfacing writing that could not appear before: long-form essays
from personal sites, pieces from specialist independent publications, and writing from
authors who operate entirely outside the commercial web. The character of the
discovery portion of the feed will shift from "interesting search results" toward
"what a genuinely curious, well-read editor would recommend." This is the qualitative
leap the product vision is built around.

The change will be noticeable but not disruptive. The 14/6 split between fixed-source
and discovery articles remains in place. Feedback mechanics are unchanged. The
personalization system continues to operate exactly as it does today.

Users may notice occasional articles without images (common on personal sites and
digital gardens). This is expected and acceptable — content quality is the priority,
not visual polish.

---

## Decisions

The following questions were raised during BRD drafting and resolved here. No open
questions remain.

**1. What seed directories and lists does the Small Web crawler start from? How does it
discover new sources organically? How does it avoid indexing the same sources
repeatedly?**

Decision: The system seeds from three publicly available, human-curated directories:
Ooh.directory (a manually reviewed index of personal and independent blogs, most
with RSS feeds), Blogroll.org (a community-maintained blogroll aggregator), and
the IndieWeb wiki's directory of personal sites. These three directories cover a
large swath of the active Small Web without requiring the system to crawl the open
web blindly, and all three are maintained by communities with curatorial sensibilities
aligned with the product's goals.

Organic expansion works by parsing blogroll links from any site in the pool during a
scheduled crawl. Any linked site that has a valid RSS or Atom feed is added to the
candidate source pool. This mirrors the way the IndieWeb already works as a
decentralized network.

Repetition is controlled by a per-source crawl timestamp. Sources are not re-crawled
more often than once every seven days. Sources that return no qualifying articles
across four consecutive crawls are deprioritized (crawl interval extended to 30 days)
but not permanently removed. This is a lightweight state record — a small JSON file
or database table, consistent with the filesystem-first architecture already in place.

Rationale: Starting from curated directories rather than open-web crawling keeps the
initial source pool high-signal. The blogroll expansion mechanism is how the IndieWeb
has always worked; it is the right tool for this topology. The cooldown and
deprioritization logic prevents the system from wasting API calls and LLM evaluations
on dead or low-yield sources.

**2. What LLM model evaluates content quality? What is the pass threshold? How does
this interact with the existing quality gate pipeline?**

Decision: Use Claude Haiku (or the cheapest available Anthropic model at the time of
implementation) for content evaluation. At the volume of discovery candidates
processed per run — estimated at 30 to 60 candidates per day after pre-filtering —
Haiku is cost-effective and fast enough to keep pipeline run time acceptable.

The pass threshold is a composite score of 3.5 out of 5.0, averaged across all five
evaluation dimensions. This threshold is intentionally moderate: it should let through
genuinely good writing without requiring perfection on every dimension. A piece that
scores 5 on intellectual substance and 3 on evergreen durability (e.g., an excellent
analysis of a recent event that is still broadly valuable) should pass. A piece that
scores 2 on originality (a generic explainer) should not, even if it scores higher on
other dimensions.

The threshold is a named configurable constant. It should be easy to tune up or down
based on observed quality of output.

The existing quality gate pipeline is modified as follows: the mechanical pre-filters
(validator rules, freshness window, domain blocklist) remain as the first stage. They
are cheap and catch obvious disqualifiers without spending an LLM call. Only candidates
that pass these pre-filters proceed to body text extraction and LLM evaluation. The
title specificity heuristic (regex scoring) is removed entirely, as it is superseded
by the LLM evaluation.

Rationale: Haiku is the right model for this use case — it is a classification and
scoring task on short-to-medium text, not a generation task requiring frontier
reasoning. The 3.5 threshold was chosen to match the qualitative bar described in the
vision document: "would a thoughtful editor recommend this to a well-read friend?"
A score below 3.5 fails that test; a score at or above it passes. The pre-filter
structure preserves efficiency and keeps LLM costs proportionate to actual need.

**3. What extraction approach handles article body text? How are paywalls and
extraction failures handled gracefully?**

Decision: Use Mozilla Readability (via the `@mozilla/readability` package, which runs
server-side in Node.js with jsdom) as the primary extraction library. Readability is
the same algorithm powering Firefox Reader Mode; it is battle-tested on a wide range
of editorial and blog page layouts, which is exactly the source class targeted by
this phase.

Failure modes are handled with a strict skip-and-continue policy:

- Fetch timeout (8 seconds) → skip, log reason, continue with remaining candidates.
- Extracted text below 300 words → skip, log reason, continue.
- Readability returns null or empty → skip, log reason, continue.
- HTTP error (4xx, 5xx) → skip, log reason, continue.

No retry logic is added in Phase 1. A candidate that fails extraction is gone for
that run. It may re-appear as a candidate on a future run if it is re-discovered.

Rationale: Readability is the standard tool for this problem and has no runtime
infrastructure requirements. The 300-word minimum cleanly separates real articles
from stubs, login walls, and redirects without requiring content classification.
The 8-second timeout keeps pipeline run time bounded. The skip-and-continue policy
is consistent with the existing pipeline's failure isolation philosophy (established
in Milestone 5): one bad candidate does not abort the run.

**4. How many queries run per topic per run? How is rotation managed? How are
LLM-generated queries cached and refreshed?**

Decision: Each topic carries a bank of five query formulations. Two queries are
executed per topic per run. This yields up to 24 search API calls per run across
12 topic areas (existing topic count) — within the Brave Search free tier of 2,000
calls per month given a once-daily cadence.

Rotation is managed by a simple cursor: a per-topic record of the last query index
executed. On each run, the system selects the next two queries in sequence,
wrapping around when the end of the bank is reached. The rotation cursor is stored
in the same per-source state record used for Small Web crawl timestamps, keeping
state management in one place.

LLM-generated query banks are generated once per topic via a one-time initialization
step (run as part of the deployment task for this phase), and refreshed monthly via
a separate scheduled job or on-demand trigger. The bank is stored as a JSON file at
a config path (e.g., `data/query_banks.json`) so it can be inspected and manually
edited if needed. When the bank is refreshed, the rotation cursor for that topic
resets to zero.

Rationale: Five formulations per topic gives enough variety to meaningfully rotate
without requiring constant LLM calls for generation. Two executions per topic per
run stays within the API budget and keeps the pipeline run time reasonable. Monthly
refresh keeps the query bank from going stale as the web evolves. Storing the bank
as a plain JSON file is consistent with the project's filesystem-first architecture
and makes it inspectable without a database query.

---

## Related Documents

| Document | Location |
|----------|----------|
| Product Vision | `agents/ba/vision_discovery_companion.md` |
| Prior BRD — Proactive Discovery (Milestone 7) | `agents/ba/brd_proactive_discovery.md` |
| Prior BRD — Feed Personalization | `agents/ba/brd_feed_personalization_v1.md` |
| System Architecture | `agents/architect/ARCHITECTURE.md` |
| Product Roadmap | `agents/pm/roadmap.md` |
| Discovery orchestrator | `lib/discovery/run.ts` |
| Quality gate | `lib/discovery/qualityGate.ts` |
| Topic configuration | `lib/discovery/topics.ts` |
| Brave Search adapter | `lib/discovery/braveSearch.ts` |
| Article type definition | `lib/types/article.ts` |
