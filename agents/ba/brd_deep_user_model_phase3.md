# BRD-009: Deep User Model — Phase 3

| Field | Value |
|-------|-------|
| **ID** | BRD-009 |
| **Title** | Deep User Model — Phase 3 |
| **Date** | 2026-04-04 |
| **Status** | Resolved |
| **Phase** | Phase 3 — Deep User Model |
| **Depends On** | BRD-008 (Latent Aesthetic Space — Phase 2, shipped) |

---

## Problem Statement

Phase 2 gave the system a vocabulary for how writing feels and a single running centroid
that tracks the user's aesthetic taste. That centroid is a meaningful step forward, but
it has two structural limitations that become more visible the longer the system runs.

First, the centroid is temporally flat. A feedback event from three years ago counts
exactly as much as one from yesterday. If the user's interests shift — they go through
a period of deep focus on climate policy, then pivot to music history — the centroid
blurs the before and after together. The system cannot tell the difference between a
stable long-term preference and a recent burst of contextual curiosity. Both compress
into the same number.

Second, the centroid is dimensionally blind. It captures aesthetic texture well, but it
has no representation of what the user is intellectually engaged with — the ideas,
concepts, and themes that they repeatedly seek out. There is no record of the fact that
the user has liked eight articles touching on urban infrastructure design over the past
four months, or that every time cellular biology appears in an article, engagement is
unusually high. The system can feel the aesthetic shape of the user's taste; it cannot
see the conceptual terrain underneath it.

Together, these gaps mean that ranking decisions in Phase 2 are memoryless about time
and memoryless about ideas. The feed produces articles that feel like what the user
liked, but it cannot distinguish what the user liked last week from what they liked two
years ago, and it cannot use the recurring pattern of which ideas draw the user back to
prioritize those ideas in the future.

Phase 3 addresses both of these gaps by building a deeper, more structured user model
on top of the existing Phase 2 infrastructure — without replacing it.

---

## Goals

- The system separates recent preference signals from long-term stable preferences and
  maintains them as two distinct representations, blending them at ranking time in a
  configurable ratio.
- The system builds and maintains a concept graph: a lightweight map of the ideas,
  themes, and topics the user repeatedly engages with, and the relationships between
  them, derived from liked articles.
- The system detects when the user's recent engagement pattern has meaningfully shifted
  from their historical baseline (taste drift) and automatically weights recent signals
  more heavily during those periods.
- The system infers additional engagement quality signals beyond the binary like/dislike
  — specifically, time-on-page as a proxy for re-reading, and save/bookmark actions —
  and incorporates them into the preference model with appropriate weighting.
- All Phase 3 changes are additive. The existing EMA centroid, source-score ranker,
  aesthetic proximity ranker, and feedback endpoints are preserved without modification.
- Periods of user silence (days or weeks without any feedback) are handled gracefully:
  neither the short-term representation nor the drift detector misinterprets absence of
  data as a signal.

---

## Non-Goals

- **Replacing the Phase 2 EMA centroid.** The single centroid computed in Phase 2
  continues to exist and function. Phase 3 adds a separate short-term centroid and
  enriches the model alongside it; it does not swap out the existing infrastructure.
- **Multi-user concerns.** This is a single-user system optimized for Kyle. Identity
  is parameterized throughout for future expansion, but no Phase 3 design decision is
  constrained by multi-user scalability requirements.
- **Graph database infrastructure.** The concept graph is stored in Postgres, which is
  already in use. No graph database (Neo4j, etc.) is introduced.
- **User-visible profiles, graphs, or drift indicators.** All Phase 3 signals are
  internal ranking and discovery inputs only. No new UI surfaces them.
- **Phase 4 serendipity engineering.** Using the concept graph to deliberately inject
  unexpected discoveries at the graph's perimeter is Phase 4 work. Phase 3 builds the
  graph and uses it for relevance; structured exploration is the next phase.
- **Psychographic profiling or natural language feedback.** Full psychographic modeling
  is a future consideration, not part of this phase.
- **Real-time updates.** Phase 3 model updates run at pipeline time (once daily) and
  at feedback time (on each like/dislike event), consistent with Phase 2 behavior.
  Sub-second model convergence is not required.

---

## Feature Details

### 1. Short-Term vs. Long-Term Preference Memory

#### The Problem with a Single Centroid

The Phase 2 EMA centroid with alpha = 0.2 produces a stable long-term aesthetic
profile. However, it cannot represent contextual surges: a week-long period where the
user reads intensively about a specific topic produces a centroid pull that persists
long after the interest has passed. Conversely, a stable interest that the user has
held for years is diluted by recent noise.

The solution is to maintain two separate centroids and blend them.

#### Two Windows

**Short-term window: 21 days.**

The short-term centroid is recomputed from feedback events within the trailing 21-day
window only. 21 days was chosen because it is long enough to capture a meaningful
multi-article engagement burst without being dominated by a single day's activity, and
short enough to reflect genuinely current interest rather than last month's curiosity.
Three weeks also aligns naturally with how topical interest cycles work: a user drawn
into a topic by a news event will typically engage with it intensively for one to three
weeks before returning to baseline.

**Long-term window: all feedback history (no cutoff).**

The long-term centroid is the existing Phase 2 EMA centroid, computed across all
feedback events since the user began giving feedback. No change is made to how it is
computed. It continues to be updated incrementally via EMA at feedback time.

#### Storage

The short-term centroid is stored as a new column on the existing
`user_aesthetic_profiles` table: `short_term_centroid vector(6)`, alongside
`short_term_feedback_count` (feedback events in the current window) and
`short_term_window_start` (ISO-8601 timestamp marking the beginning of the active
21-day window). The existing `centroid` column continues to hold the long-term value.

The short-term centroid is not computed via EMA. It is recomputed from scratch by
fetching all qualifying feedback events (those with aesthetic scores on the associated
article) from the database within the 21-day window, then averaging the liked vectors
and subtracting the mirrored disliked vectors, weighted equally. Full recompute is
acceptable here because the window is bounded: at most 21 days of events, at a rate
consistent with single-user casual browsing, this is a trivially small set. The
recompute runs at feedback time (after each like or dislike) and at pipeline time
(at the start of each daily run, to roll the window forward naturally).

#### Handling Silence

If fewer than three feedback events fall within the 21-day window, the short-term
centroid is considered unreliable. In this case, the blend (see below) treats the
short-term weight as zero and falls back entirely to the long-term centroid. Three
events is the minimum required to avoid a single outlier dominating the short-term
signal. If no feedback has been given at all (new user), both centroids are absent and
ranking degrades to the pre-Phase-2 source-score-only behavior, unchanged.

Silence is not the same as preference change. If the user simply stops giving feedback
for two weeks, the window rolls forward, the short-term event count drops below the
threshold, and the short-term signal is suppressed. The feed continues to rank using
the long-term centroid only. No decay or penalty is applied to the long-term centroid
during silence periods.

#### Blending at Ranking Time

The blended aesthetic centroid used at ranking time is:

```
blended_centroid = short_term_weight * short_term_centroid
                 + (1 - short_term_weight) * long_term_centroid
```

Under normal conditions (no drift detected), `short_term_weight = 0.35`. This means
recent preferences contribute 35% of the aesthetic proximity signal and long-term
stable taste contributes 65%. This ratio reflects the intuition that most of the time,
a user's long-term aesthetic is the dominant signal, but recent activity should exert
meaningful influence.

During detected drift periods (see Feature 3), `short_term_weight` rises to 0.65,
inverting the dominance to weight recent behavior more heavily.

Both weights are named constants, adjustable without architectural change.

The `blended_centroid` replaces the direct use of the Phase 2 `centroid` in the
ranking formula. The ranking formula structure (`0.7 * source_score + 0.3 *
aesthetic_proximity`) is unchanged; only the centroid used to compute `aesthetic_proximity`
changes.

---

### 2. Concept Graph

#### What It Is

The concept graph is a lightweight, emergent map of the user's intellectual terrain.
It captures which ideas, themes, and concepts the user repeatedly engages with — and
how those concepts relate to each other — derived entirely from liked articles. It is
not a topic taxonomy or a category tree. It is built bottom-up from the user's actual
reading, not imposed top-down from a predefined ontology.

The graph has two components:

**Nodes** represent concepts. Each node is a short concept label (two to five words)
extracted from a liked article by an LLM. Examples: "urban heat islands," "distributed
cognition," "brutalist architecture," "fermentation science," "marginal gains theory."
Each node records: the concept label, an extraction count (how many liked articles
have contributed this concept), a last-seen timestamp, and a cumulative engagement
weight (see below).

**Edges** represent conceptual proximity between nodes. An edge is created or
strengthened when two concepts appear in the same liked article. Edge weight represents
co-occurrence frequency. Edges are undirected.

#### Concept Extraction

When a user likes an article that has body text, an LLM call extracts five to eight
concept labels from the article. The model is prompted to identify the specific ideas
the article engages with, not its broad category. "Technology" is not a concept label.
"Human-computer interaction design" is. "Politics" is not a concept label.
"Deliberative democracy theory" is.

The same model used elsewhere in the pipeline (`claude-haiku-4-5-20251001`) is used
here. The extraction is a structured output call returning an array of concept label
strings. This runs synchronously inside `POST /api/feedback` after the primary
feedback write, consistent with how the Phase 2 EMA update is handled.

Concept extraction only runs on likes, not dislikes. A dislike signals aesthetic or
intellectual rejection; adding its concepts to the graph would conflate avoidance with
engagement. Dislikes continue to influence the aesthetic centroid via the existing
mirror mechanism, but they do not touch the concept graph.

Concept extraction only runs when the article has body text. Articles without
`bodyText` contribute no concepts. This is acceptable given that body text is already
required for aesthetic scoring; the same articles that enrich the aesthetic profile
enrich the concept graph.

#### Graph Storage

The graph is stored in two new Postgres tables:

`user_concepts` — one row per concept node per user.
- `id` (SERIAL PK), `user_id` (TEXT, nullable), `device_id` (TEXT NOT NULL),
  `label` (TEXT), `extraction_count` (INTEGER), `engagement_weight` (FLOAT),
  `last_seen_at` (TIMESTAMPTZ), `created_at` (TIMESTAMPTZ)
- Unique constraint on `(user_id, device_id, label)` — the same concept extracted from
  multiple articles increments `extraction_count` rather than creating a new row.

`user_concept_edges` — one row per edge between two concepts for a given user.
- `id` (SERIAL PK), `user_id` (TEXT, nullable), `device_id` (TEXT NOT NULL),
  `concept_a` (TEXT), `concept_b` (TEXT), `co_occurrence_count` (INTEGER),
  `last_seen_at` (TIMESTAMPTZ)
- `concept_a` and `concept_b` are stored in alphabetical order to ensure undirected
  uniqueness. Unique constraint on `(user_id, device_id, concept_a, concept_b)`.

#### Graph Size Cap and Pruning

The graph is capped at 300 concept nodes. This cap was chosen to be large enough that
a user with years of varied reading history can represent the full breadth of their
interests, while small enough that graph queries remain fast without an index strategy
beyond standard Postgres B-tree.

When a new concept extraction would push the node count past 300, pruning runs before
the insert. The pruning strategy removes the 30 lowest-scoring nodes by a composite
score:

```
node_score = engagement_weight * log(1 + extraction_count)
           * recency_factor(last_seen_at)
```

Where `recency_factor` applies a half-life decay: a node last seen more than 90 days
ago scores at 50% of its base value; more than 180 days ago at 25%. This ensures that
concepts the user engaged with intensely but has not returned to in months are pruned
before concepts that remain freshly active, even if the older ones have higher raw
extraction counts.

Pruning removes the concept rows and all associated edge rows for those concepts.
Removing 30 nodes at once (rather than one at a time) prevents pruning from running on
every single concept extraction once the cap is reached, and gives the graph room to
accept a natural influx of new concepts during an exploratory period.

#### Engagement Weight

The engagement weight on each concept node is not simply the extraction count. It
incorporates implicit signal richness (see Feature 4): a concept extracted from an
article with a long dwell time contributes more weight than one from an article that
was liked but not read deeply. The default contribution per extraction is 1.0, modified
by implicit signals if available. This is described further in Feature 4.

#### Using the Graph at Ranking Time

At ranking time, the concept graph is used in two ways:

**Concept match boost.** For each article being ranked, the LLM extraction step that
would normally run at pipeline time is replaced by a lighter check: the article's
title and description are compared against the top 20 most-weighted concept nodes from
the user's graph. If two or more concepts from the user's graph appear in the article
(by label substring match or semantic proximity via the article's existing aesthetic
score, not a new LLM call), the article receives a concept resonance bonus. This bonus
is a small additive term on the final rank score, not a multiplier, to avoid
overwhelming the source-score and aesthetic signals.

The formula becomes:

```
final_score = 0.7 * source_score
            + 0.3 * aesthetic_proximity
            + concept_bonus
```

Where `concept_bonus` is 0.05 per matched concept node, capped at 0.10 (i.e., two or
more matches produce the same cap). This is intentionally modest: the concept graph
is a supplementary signal, not a topic filter.

**Filter bubble prevention.** To prevent the graph from creating a closed loop where
the user only ever sees articles matching their existing concepts, the concept match
boost is applied only to articles that do not already rank in the top 30% by source
and aesthetic score alone. High-confidence recommendations from the existing signals
are not further amplified by concept match. The boost specifically helps surface
lesser-known articles on familiar ideas that would otherwise rank mid-pack — not to
lock the top of the feed into a fixed set of concepts.

---

### 3. Taste Drift Detection

#### What Drift Is

Drift is the condition where the user's recent engagement pattern has meaningfully
shifted from their long-term baseline. It is not inherently negative: drift may
represent genuine intellectual evolution, a new life context, or a period of focused
exploration. The system does not try to resist drift or push the user back toward
their baseline. It detects drift as a signal that recent preferences deserve more
weight, and adjusts accordingly.

Drift is a system-internal state. It is not surfaced in the UI and does not generate
notifications.

#### Measurement

Drift is measured by comparing the short-term centroid to the long-term centroid using
cosine similarity. Cosine similarity is already in use in the system (`lib/utils/
cosineSimilarity.ts`) and is the natural metric for comparing two vectors in the same
aesthetic space.

```
drift_score = 1 - cosine_similarity(short_term_centroid, long_term_centroid)
```

A drift_score of 0 means perfect alignment (recent taste is identical to historical
taste). A drift_score of 1 means complete orthogonality (recent taste is unrelated to
historical taste in this vector space).

**Drift threshold: 0.25.**

When `drift_score >= 0.25`, the system enters a drift period. This threshold was
chosen by reasoning about the aesthetic vector space: a cosine similarity of 0.75
between two six-dimensional vectors in the 1–5 range represents a meaningful departure
— roughly the difference between a user who has historically preferred contemplative,
serious, specialist writing suddenly engaging primarily with playful, personal,
generalist writing. Below 0.25, the difference between short-term and long-term taste
can be attributed to normal variance in a small sample. Above 0.25, the departure is
consistent enough to warrant treating recent behavior as a genuine signal shift.

This threshold is a named constant, adjustable without architectural change.

#### Drift Can Only Be Measured When the Short-Term Window Is Reliable

Drift detection is suppressed when the short-term centroid is unreliable (fewer than
three feedback events in the 21-day window, as described in Feature 1). This prevents
the system from declaring drift during silence periods. If the user has not given
feedback recently, the drift state defaults to not-drifting and the standard blend
ratio applies.

#### Drift Period Duration

A drift period begins when `drift_score >= 0.25` on any feedback event computation
and the short-term window has at least three events. It ends when one of the following
conditions is met:

1. The `drift_score` falls below 0.25 on a subsequent computation (the short-term and
   long-term centroids have re-converged), or
2. The short-term window drops below three events (the burst of different behavior has
   passed without enough density to remain reliable).

There is no fixed maximum duration for a drift period. If the user's taste has
genuinely evolved, the drift period will naturally end as the long-term centroid
gradually incorporates the new feedback via EMA and catches up with the short-term
centroid.

#### Behavior During Drift

During a drift period, `short_term_weight` in the blend formula rises from 0.35 to
0.65, as described in Feature 1. This is the only behavioral change. All other
ranking mechanisms are unchanged.

The drift state (`is_drifting: boolean`, `drift_detected_at: TIMESTAMPTZ`) is stored
on the `user_aesthetic_profiles` table as two new columns.

---

### 4. Feedback Richness Signals

#### The Limits of Binary Feedback

A like or dislike is an explicit, deliberate act. It captures approval or rejection but
nothing about the quality or depth of engagement. Two liked articles are treated
identically even if the user skimmed one in fifteen seconds and spent twelve minutes
re-reading the other.

Phase 3 infers additional engagement signals without requiring explicit user input.
These signals are used to modulate the weight of a feedback event's contribution to
the concept graph (the `engagement_weight` on concept nodes). They do not directly
alter the aesthetic centroid — the EMA mechanism for the centroid remains unchanged —
but they do influence which concepts from a liked article receive higher weight in the
graph.

#### What Is Feasible in a PWA

A PWA running in a mobile browser has no access to native OS signals (background time,
system-level session tracking, push delivery receipts). It operates within the browser
tab and can only observe what JavaScript can observe during an active browser session.
The following is an honest assessment of what is and is not feasible.

**Feasible:**

**Time-on-page (dwell time proxy).** When a user navigates to an article's reading
view (`/articles/[id]`), the client can record a timestamp. When the user navigates
away (via `visibilitychange` or `beforeunload` events), it records a second timestamp.
The delta is a proxy for reading time. This is imperfect — a tab left open in the
background inflates the number — but the `visibilitychange` event (which fires when a
tab becomes hidden or visible) substantially mitigates this: time is only accumulated
while the tab is the active foreground tab. This is implementable entirely in the
browser with no native app access.

The dwell time is sent to the server as metadata alongside the feedback event, or as
a separate lightweight beacon POST when the user leaves the article page (whether or
not they gave explicit feedback). No new endpoint is required; the existing
`POST /api/feedback` is extended to accept an optional `dwellSeconds` field.

**Save/bookmark action.** A save or bookmark button can be added to the article
reading view. Unlike a like, a save signals "I want to return to this" rather than
"I approve of this aesthetically." Saves are stored as a third feedback value type
(`'save'`) on the existing feedback schema, treated as a positive signal for concept
graph weighting but not used in the aesthetic centroid update (they do not move the
aesthetic centroid, because saving an article is not the same aesthetic endorsement as
liking it).

**Not feasible (explicitly excluded):**

**Scroll depth as engagement proxy.** Scroll position tracking on article body text
would require instrumenting a long-form content layout with scroll listeners, storing
scroll state, and dealing with the significant variance between reading styles (some
users scroll ahead, some read in sections). The noise-to-signal ratio is high, and it
adds meaningful client-side complexity for a signal that dwell time already
approximates. Out of scope for Phase 3.

**Reading completion detection.** There is no reliable way in a browser to detect
whether a user has actually read to the end of an article (as opposed to scrolled to
the bottom). Excluded for the same reasons as scroll depth.

**Background session time.** PWA service workers can run in the background, but they
cannot meaningfully measure user attention. A tab open in the background is not the
same as a tab being actively read. Excluded.

#### How Implicit Signals Are Weighted

Each feedback event's contribution to the concept graph is assigned an `engagement_weight`
using the following logic:

| Condition | engagement_weight |
|-----------|-------------------|
| Save (no explicit like) | 1.2 |
| Like + dwell time >= 180 seconds | 1.5 |
| Like + dwell time 60–179 seconds | 1.2 |
| Like + dwell time < 60 seconds or no dwell data | 1.0 |
| Like + save | 1.8 (cap) |

Dwell time is measured as active foreground seconds on the article reading view. These
weights apply to the concept graph only. The aesthetic centroid update via EMA is
unaffected; every like is treated equally for that purpose.

The 180-second and 60-second thresholds for dwell time reflect the approximate reading
time for a 1,000-word and 300-word piece respectively at average reading pace. An
article with 180+ seconds of dwell was likely read substantially from beginning to end.
An article with under 60 seconds of dwell was likely sampled or skimmed.

These thresholds and weights are named constants, adjustable without architectural
change.

---

## User Impact

**Who is affected:** All system behavior changes are internal. The user (Kyle) will
not see new UI controls, explanations, or indicators as a result of Phase 3. The
impact is felt through the quality of the feed over time.

**How the experience changes:**

In the short term, the feed will behave nearly identically to Phase 2. Short-term
vs. long-term blending requires several weeks of usage to produce a meaningful
short-term centroid; the concept graph requires a meaningful number of liked articles
before it influences ranking. Neither signal does anything harmful during the bootstrap
period — they simply contribute nothing until the data is there.

Over weeks and months, the feed becomes contextually aware in two new ways. First,
when the user goes through an active period of interest in a new area, the feed will
lean into that interest during the period without abandoning long-term preferences
once it passes. A two-week deep dive into fermentation science will produce a feed
that reflects that focus, then gradually return to the user's long-term baseline as
the short-term window advances. Second, the feed will begin to recognize recurring
intellectual terrain: articles that touch concepts the user returns to repeatedly will
rise in the ranking even if they come from unfamiliar sources with no source-score
history.

The save action gives the user a low-friction way to flag articles that felt
important enough to return to, even on days when liking does not fully capture the
sentiment. This is a new intentional interaction, but it requires no explanation —
a save button is a familiar affordance.

The most significant long-term effect is that the user model begins to look like an
actual cognitive map rather than a running average. The concept graph, in particular,
is the foundation for the Phase 4 serendipity engineering work: the graph's edges
are what the Phase 4 system will traverse to find genuinely surprising but relevant
discoveries at the user's intellectual perimeter.

---

## Decisions

The following questions were raised during BRD drafting and resolved here. No open
questions remain.

**1. What are the short-term and long-term window lengths?**

Decision: Short-term window is 21 days (rolling). Long-term window is all feedback
history (no cutoff).

Rationale: 21 days is long enough to represent a genuine period of focused interest
(a multi-article deep dive typically runs one to three weeks) without blending in
activity from prior months. The long-term window has no cutoff because the Phase 2 EMA
centroid already handles long-term stability via its alpha parameter — adding an
arbitrary cutoff would remove feedback that is still relevant to the user's baseline
aesthetic identity.

**2. How are short-term and long-term centroids blended? Fixed ratio or dynamic?**

Decision: Dynamic. The blend ratio is 35% short-term / 65% long-term under normal
conditions and inverts to 65% short-term / 35% long-term during drift periods. The
ratio is controlled by named constants.

Rationale: A fixed ratio would be too blunt. During periods of exploration or genuine
taste shift, recent signals deserve more weight. During stable periods, long-term
signals should dominate. A dynamic ratio that responds to measured drift achieves this
without requiring user intervention or manual configuration. The two ratios (0.35 and
0.65) are symmetric around 0.5 by design: the same split applies in both directions,
just inverted, which makes the system's behavior intuitive and the constants easy to
reason about.

**3. How many concept nodes should the graph cap at before pruning? What is the pruning strategy?**

Decision: Cap at 300 nodes. Prune the 30 lowest-scoring nodes when the cap is reached,
using a composite score of engagement weight, log-scaled extraction count, and recency
decay with a 90-day half-life. Pruning removes associated edges simultaneously.

Rationale: 300 nodes represents roughly three to five years of varied reading at a
pace of five likes per week across diverse topics, with natural churn from topics the
user no longer engages with. The batch size of 30 for pruning prevents the graph from
triggering pruning on every new extraction once it reaches the cap, while keeping the
graph well below any query performance concern. Recency decay in the pruning score
ensures the graph reflects current intellectual terrain rather than a static archive
of past curiosity.

**4. What similarity metric detects drift? What threshold?**

Decision: Cosine similarity between the short-term and long-term aesthetic centroids,
with drift declared when `1 - cosine_similarity >= 0.25`.

Rationale: Cosine similarity is already in use in the system (`lib/utils/
cosineSimilarity.ts`) and is the natural metric for comparing vectors in the same
aesthetic space. The 0.25 threshold (cosine similarity of 0.75) was chosen as the
boundary between normal variance in a small sample and a meaningful, consistent
directional shift. A threshold too low would declare drift during normal week-to-week
variation; a threshold too high would fail to detect genuine evolution until it is
very pronounced. 0.25 corresponds to a departure that would be perceptible to the
user if they could see both centroids side by side.

**5. Which implicit signals are feasible in a PWA without native app access?**

Decision: Two implicit signals are feasible and included: dwell time (active foreground
seconds on the article reading view, measured via `visibilitychange`) and save/bookmark
action (a new button in the article reading view). Scroll depth, reading completion
detection, and background session time are not feasible within PWA constraints and are
explicitly excluded.

Rationale: Dwell time via `visibilitychange` is the highest-fidelity engagement proxy
available in a browser environment without native access. It is a well-established
technique, requires no permission grants, and the foreground-only accumulation
substantially mitigates the open-tab inflation problem. A save button is a standard
affordance that users understand intuitively and that captures a meaningfully different
intent from a like. Scroll depth and completion detection carry high implementation
cost and noise for marginal additional signal that dwell time already approximates.
Background session time is technically inaccessible from a PWA service worker in any
reliable form.

---

## Related Documents

| Document | Location |
|----------|----------|
| Product Vision | `agents/ba/vision_discovery_companion.md` |
| Prior BRD — Latent Aesthetic Space (Phase 2) | `agents/ba/brd_aesthetic_space_phase2.md` |
| Prior BRD — Agentic Discovery (Phase 1) | `agents/ba/brd_agentic_discovery_phase1.md` |
| System Architecture | `agents/architect/ARCHITECTURE.md` |
| Product Roadmap | `agents/pm/roadmap.md` |
| Aesthetic type definitions | `lib/types/aesthetic.ts` |
| Article type definition | `lib/types/article.ts` |
| Cosine similarity utility | `lib/utils/cosineSimilarity.ts` |
| Aesthetic DB helpers | `lib/db/aesthetics.ts` |
| Feed ranker | `lib/pipeline/ranker.ts` |
