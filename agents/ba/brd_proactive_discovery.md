# BRD-006: Proactive Daily Content Discovery

| Field | Value |
|-------|-------|
| **ID** | BRD-006 |
| **Title** | Proactive Daily Content Discovery |
| **Date** | 2026-04-04 |
| **Status** | Resolved |
| **Milestone** | Milestone 7 — Proactive Discovery |
| **Depends On** | BRD-001 (core pipeline, shipped), BRD-004 (feed personalization, shipped) |

---

## Problem Statement

The existing content pipeline is entirely reactive: it fetches from a fixed list of
explicitly configured RSS feeds and a NewsAPI query. It can only surface what those
sources publish. A source that was not added to `data/sources.json` does not exist,
no matter how extraordinary its content. A topic that no configured source covers
simply never appears.

This creates a hard ceiling on the product's core promise. The app is meant to feel
like a curious, well-read friend who ranges widely across human knowledge and
culture — materials science, obscure music scenes, counterintuitive economic papers,
remarkable street photography. That friend cannot be simulated by a list of a dozen
pre-approved outlets publishing in their regular cadence.

The problem is not volume. The existing pipeline already delivers 20 articles per
day, and simply adding more RSS feeds would only produce more of the same kind of
content. The gap is the character of what is surfaced: the existing pipeline
optimizes for recency and source familiarity. There is no mechanism to find the
niche, the cross-disciplinary, the genuinely surprising — content worth reading that
the user would not have found on their own.

This BRD defines a proactive discovery layer: a daily process that actively ranges
across a broad and intentionally eclectic set of topics, finds content of genuine
quality, and contributes a portion of each day's feed. It works alongside the
existing RSS and NewsAPI pipeline — it does not replace it.

---

## Goals

- Each day's feed contains a portion of articles sourced from active, topic-driven
  web discovery rather than from the fixed configured source list.
- The discovery layer ranges across a wide set of domains: science and technology
  (including fringe and emerging areas), music, visual art and design, architecture,
  fashion and material culture, nature and biology, mathematics and philosophy, film
  and literature, craft and making, economics and social dynamics — among others. The
  list is intentionally non-exhaustive.
- The discovery layer is explicitly biased toward the niche, the cross-disciplinary,
  and the unexpected. Politics, breaking news, and mainstream news aggregation are a
  small dose, not the focus.
- Quality is enforced rather than volume: a small number of genuinely interesting
  articles is always preferred over a large number of mediocre ones.
- Discovery results feed into the same personalization system already in place.
  Like/dislike feedback on discovery articles influences future discovery behavior,
  not only the existing source-ranking system.
- The existing RSS and NewsAPI pipeline continues to run unchanged alongside this new
  layer. Neither pipeline replaces the other.
- Users are occasionally surprised by content from categories they did not expect or
  explicitly request. Genuine eclecticism is a design goal, not a side effect.

---

## Non-Goals

The following are explicitly out of scope for this BRD:

- **Replacing or modifying the existing RSS or NewsAPI pipeline.** The fixed-source
  pipeline ships exactly as it does today. This BRD adds a new layer, it does not
  change the existing one.
- **User-configurable topic lists.** Users cannot add, remove, or prioritize topics
  for the discovery layer. The system has genuine autonomy to range wherever it finds
  quality content. (See Decisions section for rationale.)
- **Real-time or event-driven discovery.** Discovery runs once per day alongside the
  scheduled pipeline. There is no continuous or on-demand discovery crawl.
- **Full-text article archiving or scraping.** Discovery finds articles; it surfaces
  title, source, and description to the same standard as the existing pipeline. Deep
  body-text extraction is a separate, existing best-effort capability and is not
  expanded here.
- **Operator tooling for managing discovery topics.** There is no admin UI or CMS for
  editing topics. Topic configuration is a code-level or config-file concern, not a
  product feature in this milestone.
- **Guaranteed coverage of any specific topic per day.** The system may not find
  quality content in every category every day. Sparse or empty results in some
  categories on some days is acceptable and expected.
- **Discovery of sources to add to the existing fixed-source pipeline.** The dynamic
  discovery layer operates independently; it does not write back to `data/sources.json`.
- **Social or community-sourced discovery.** No bookmarking, sharing, or
  recommendation from other users influences this layer.

---

## Feature Details

### How Discovery Works

Once per day, at the same time as (or immediately following) the regular pipeline
run, a discovery process executes a set of topic-directed searches across the open
web. For each search, it retrieves a candidate pool of results and evaluates them
against quality criteria before including them as candidates for the day's batch.

The discovery process is not an RSS reader and is not a news aggregator. It is a
search-driven process: it issues a query, receives results, filters them, and
contributes qualifying articles to the day's pool.

### Quality Enforcement

Volume is not the goal. The following principles define what qualifies an article as
a discovery candidate:

- **Specificity over generality.** A piece about a specific technique in printmaking,
  or a particular finding in mycelium research, is preferred over a broad overview of
  "the future of printing" or "why biology matters."
- **Source credibility signals.** Articles from outlets, journals, blogs, or
  publications with recognizable standing in their domain are preferred over
  content-farm or aggregator output. This is a heuristic, not a whitelist.
- **Freshness within a reasonable window.** Discovery articles should be recent
  enough to feel current. A reasonable window (exact value for the Architect to
  determine) prevents surfacing evergreen content that is years old.
- **No duplication with the fixed pipeline.** An article already captured by the RSS
  or NewsAPI pipeline on the same day is excluded from discovery results, using the
  same deduplication logic already in place (by article URL).
- **No clickbait or purely promotional content.** The discovery process applies the
  same validation rules as the existing pipeline's `validator.ts`: minimum title
  length, minimum description length, valid URL, etc.

Quality is enforced at the evaluation stage, before articles enter the candidate
pool. The discovery layer should produce fewer articles of higher quality, not
more articles at lower quality.

### Topic Coverage and Autonomy

The discovery layer operates from a topic list that is broad, curated, and
maintained as a configuration concern (not a user-facing setting). The list is
intended to inspire discovery, not constrain it: the system may surface content
from categories not explicitly on the list if quality signals are strong.

Illustrative topic areas (not exhaustive):

- Science and technology (with explicit weight toward fringe, emerging, and
  interdisciplinary areas — not mainstream tech news)
- Music, sound, and audio culture
- Visual art, illustration, and design
- Architecture and built environment
- Fashion, textiles, and material culture
- Nature, ecology, and biology
- Mathematics, logic, and philosophy
- Film, photography, and visual storytelling
- Literature, writing, and language
- Craft, making, and fabrication
- Economics, sociology, and behavioral science
- History and archaeology

The explicit bias is away from politics, breaking news, and general-purpose news
aggregation. Those categories are already served by the existing pipeline. Discovery
is for the rest of the internet.

### Contribution Quota: How Many Articles Come from Discovery

Each day's batch of 20 articles is split between the existing fixed-source pipeline
and the new discovery layer. The allocation is:

- **Fixed-source pipeline (RSS + NewsAPI):** 14 articles
- **Proactive discovery layer:** 6 articles

Rationale: 6 out of 20 (30%) is enough to meaningfully shift the character of the
feed without overwhelming the reliable news coverage that the existing pipeline
provides. It is also a large enough allocation that on any given day, multiple
distinct discovery topics can be represented. If the discovery layer produces fewer
than 6 qualifying articles on a given day, the shortfall is filled by additional
articles from the fixed pipeline — the feed is never short of content due to
discovery underperformance.

The 14/6 split is a configurable constant, not a hardcoded value. The Architect
should implement it as a named configuration constant so it can be tuned without a
code change.

### Interaction with Personalization

Discovery articles are treated identically to RSS and NewsAPI articles by the
personalization system:

- Each discovery article carries a `sourceName` (derived from the publication or
  outlet where the article was found, not from a discovery category label).
- Like/dislike feedback on discovery articles contributes to source-level scoring
  in the existing ranker, exactly as feedback on any other article does.
- Over time, if a user consistently likes articles sourced from a particular outlet
  discovered via this layer, that outlet's score rises and its articles rank higher.
  If a user consistently dislikes, the outlet drifts toward suppression. This is the
  same mechanism already in place — no new personalization logic is required.
- Discovery does not require a separate feedback loop or a new personalization model.
  The existing source-scoring system handles it.

One additional behavior: the topic list used by the discovery layer should gradually
shift toward topics that have produced liked articles in the past, and away from
topics that have consistently produced disliked articles. This is a soft bias — it
does not eliminate any topic, but increases or decreases the frequency with which
a topic is queried. The Architect will determine the mechanism; the behavioral
requirement is that feedback eventually influences which categories are probed more
often.

---

## Decisions

The following questions were raised during BRD drafting and resolved here. No open
questions remain.

**1. What makes something "interesting" enough to include? How does quality get
enforced rather than just volume?**

Decision: Quality is enforced through a multi-criteria evaluation at the candidate
stage, before articles enter the batch pool. The criteria are: specificity of the
piece (not a broad overview), source credibility signals (recognizable standing in
the relevant domain), freshness within a defined recency window, no URL duplication
with the fixed pipeline output, and passage of the existing validator rules (minimum
title, minimum description, valid URL). Articles that do not meet these criteria are
discarded before they are counted toward the discovery quota. The system is
explicitly instructed to prefer a small number of high-quality results over a large
number of borderline ones. If a given day's discovery run yields only 3 qualifying
articles instead of 6, those 3 are included and the shortfall is filled by the fixed
pipeline. Quality wins over quota fulfillment.

**2. How many of the daily 20 articles should come from active discovery vs. existing
feeds?**

Decision: 6 articles from discovery, 14 from the fixed RSS/NewsAPI pipeline. This
30% allocation is large enough to meaningfully shape the character of the feed while
leaving the reliable news coverage from the existing pipeline intact. The split is
a named configurable constant — not hardcoded — so it can be adjusted based on
real usage. If discovery underperforms on a given day, the shortfall is filled by
the fixed pipeline, ensuring the total batch always reaches 20 articles.

**3. Should the topic list be configurable by the user, or should the system have
genuine autonomy to range wherever it finds quality content?**

Decision: The topic list is not user-configurable. The system has genuine autonomy.
Rationale: The product's value proposition is specifically that it acts like a
well-read friend who finds things you did not know you were looking for. Letting
users configure topics would turn it into a conventional interest-tracker — something
many other products already do well. The discovery layer is valuable precisely
because it is not driven by the user's self-declared preferences. The topic list is
maintained as a configuration concern (a code-level or config-file list), and the
system is explicitly permitted to surface content from outside that list if quality
signals are strong. Users influence discovery indirectly, through feedback on
articles, not by editing a topic list.

**4. How does this interact with the personalization system — does feedback on
discovery articles influence future discovery behavior?**

Decision: Yes, in two ways. First, feedback on discovery articles feeds into the
existing source-scoring system — the outlet where the article was found gets a
higher or lower score based on user response, exactly as with any other article.
This is handled by the existing ranker with no new logic required. Second, at the
topic level, the discovery layer maintains a soft topic weight: topics that have
historically produced liked articles are probed more frequently; topics that have
consistently produced disliked articles are probed less frequently. This is a bias,
not an elimination — no topic is fully removed from the rotation based on feedback.
The Architect will determine the implementation mechanism for topic-level weighting.

---

## User Impact

**Who is affected**: All users, from the first day this feature ships.

**How they are affected**: The daily feed will feel noticeably different in character
from the current experience. Where today's feed reflects the output of a fixed set of
well-known sources, the new feed will routinely contain articles from outlets and on
topics the user has never encountered through this app. The experience change is
immediate — users do not need to build up a feedback history for discovery to work.
For new users, this means a more varied and surprising first experience. For
returning users, this means the feed continues to expand its range rather than
settling into familiar territory.

The change should feel like an enrichment, not a disruption. 14 of 20 articles still
come from the reliable fixed-source pipeline, providing a continuity anchor. The 6
discovery articles add the new dimension.

Feedback mechanics are unchanged. Users like and dislike articles the same way they
always have. The personalization system quietly uses that feedback to improve both
the existing pipeline's ranking and the discovery layer's topic weighting over time.

---

## Related Documents

| Document | Location |
|----------|----------|
| Prior BRD — Article Feed (core pipeline) | `agents/ba/requirements_article_feed_v1.md` |
| Prior BRD — Feedback Capture | `agents/ba/requirements_feedback_capture_v1.md` |
| Prior BRD — Server Feedback Storage | `agents/ba/requirements_server_feedback_v1.md` |
| Prior BRD — Feed Personalization | `agents/ba/brd_feed_personalization_v1.md` |
| Prior BRD — Manual Refresh and Source Diversity | `agents/ba/brd_feed_refresh_and_diversity_v1.md` |
| System Architecture | `agents/architect/ARCHITECTURE.md` |
| Product Roadmap | `agents/pm/roadmap.md` |
| Pipeline orchestrator | `lib/pipeline/run.ts` |
| Pipeline validator | `lib/pipeline/validator.ts` |
| Source configuration | `data/sources.json` |
