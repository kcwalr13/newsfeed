# BRD-010: Engineered Serendipity — Phase 4

| Field | Value |
|-------|-------|
| **ID** | BRD-010 |
| **Title** | Engineered Serendipity — Phase 4 |
| **Date** | 2026-04-04 |
| **Status** | Resolved |
| **Phase** | Phase 4 — Engineered Serendipity |
| **Depends On** | BRD-009 (Deep User Model — Phase 3, shipped) |

---

## Problem Statement

Phases 1 through 3 have built a system that knows what the user likes and gets
reliably better at serving it. That is precisely the problem Phase 4 is designed
to solve.

A feed that optimizes purely for known taste will converge on a narrowing band of
familiar ideas. The user sees more of what they already like, becomes less likely to
like things outside that band, and the system learns to narrow further. This is the
classical filter bubble collapse — not from any single bad decision, but from a good
feedback loop running in only one direction.

The deeper problem is that the most valuable discoveries the system could make for
the user are, by definition, not in its current model. The concept graph built in
Phase 3 maps what the user has engaged with. The blank space around that graph —
domains the user has never touched, concepts with no connection to any existing node —
is where the genuinely surprising and potentially transformative finds live. The
system has no mechanism to navigate that space. It can tell the user exactly what
they already know they like; it cannot surface what they would love but have never
thought to look for.

Phase 4 directly addresses this. It introduces a deliberate, structured, and
psychographically modulated exploration layer on top of the Phase 3 ranking system.
Its goal is not to inject randomness — that would just produce noise — but to
compute and deliver genuine intellectual surprise: articles the user would find
fascinating and that they would never have found on their own.

---

## Goals

- The system computes a serendipity score for every article that combines measured
  surprise (how far the article's concepts sit from the user's existing concept
  graph) with quality (how well the article meets the system's content quality bar),
  producing a signal that distinguishes valuable surprise from mere irrelevance.
- A fixed portion of each day's 20-article feed is explicitly reserved for
  exploration — articles selected specifically to expand the user's intellectual
  territory rather than reinforce it.
- Those exploration slots are allocated across three distinct categories of surprise:
  semantic stretch (adjacent to the concept graph's perimeter), blind spot probe
  (deliberately targeting areas absent from the graph), and complete wildcard
  (unconstrained by the graph entirely).
- The system periodically generates and injects blind spot probe articles — content
  targeting conceptual areas the user has never engaged with — and learns from the
  user's response to them, whether positive, negative, or silent.
- A receptivity signal is computed from the user's recent engagement pattern and
  used to modulate the exploration budget: more conservative when the user is in a
  familiar-content-seeking mode, more adventurous when signals suggest openness.
- The exploration system has a floor: it will never reduce exploration below a
  minimum threshold, ensuring the user is always gently challenged even during low-
  receptivity periods.
- All Phase 4 signals and behaviors are internal ranking and discovery inputs.
  No new UI surfaces them.
- All Phase 4 changes are additive. The Phase 3 concept graph, aesthetic centroids,
  source-score ranker, and feedback endpoints are preserved without modification.

---

## Non-Goals

- **Replacing or modifying Phase 3 ranking signals.** Serendipity scoring is an
  additional layer applied to feed assembly. The existing formula
  (`source_score`, `aesthetic_proximity`, `concept_bonus`) is unchanged for the
  exploitation slots. Exploration slots draw from a separate ranked pool.
- **User-visible exploration controls.** The user does not see exploration budgets,
  serendipity scores, receptivity levels, or blind spot classifications. All of this
  is system-internal.
- **Multi-user concerns.** This is a single-user system optimized for Kyle. Identity
  is parameterized throughout for future expansion.
- **Psychographic profiling via natural language interviews.** The receptivity signal
  is derived entirely from observable engagement behavior — no explicit user
  questionnaires, personality tests, or conversational prompts are introduced.
- **Discovery source expansion.** Phase 4 works with the content already fetched by
  the existing pipeline (Phase 1 Agentic Discovery). Sourcing more or different
  content to feed the serendipity layer is not in scope.
- **Explaining discoveries to the user.** The system does not generate
  "why you might like this" explanations or surface the reasoning behind serendipity
  placements in the UI. That is a future consideration.
- **Real-time or sub-daily model updates.** All Phase 4 computations run at pipeline
  time (once daily) and at feedback time, consistent with the cadence established in
  prior phases.

---

## Feature Details

### 1. Surprise Scoring via Semantic Distance from the Concept Graph

#### What Surprise Means

An article's surprise value is a measure of how far its conceptual content sits from
the user's existing concept graph. An article whose concepts are already well-
represented as high-weight nodes in the graph is not surprising — it is familiar. An
article whose concepts have no connection to any existing node in the graph is
maximally surprising.

Surprise alone is not serendipity. An article about a subject the user has never
encountered is surprising. If it is also poorly written, trivially shallow, or
aesthetically misaligned with the user's sensibility, it is just noise. Serendipity
requires that the surprise be coupled with genuine quality — the same quality bar the
system has maintained since Phase 1.

#### How Surprise Score Is Computed

Each article that has been through the quality gate and aesthetic scorer has body text
available. At pipeline time, the same LLM call that currently extracts concepts for
liked articles is repurposed here: for every candidate article (before feed selection),
an LLM call extracts three to five concept labels from the article's body text or, if
body text is absent, from the title and description combined.

These extracted concepts are compared against the user's concept graph. For each
extracted concept label, the system checks whether a node with that label (or a
close substring match, using the same normalization already in use for concept matching
in Phase 3 ranking) exists in the user's graph.

- If a matching node exists, the concept is "known." Its contribution to surprise is
  zero.
- If no matching node exists, the system checks whether any of the article's concepts
  are connected by a direct edge to a known node. A concept that is one hop away from
  the graph is "adjacent." Its contribution is partial.
- A concept with no node match and no edge connection to any known node is "unknown."
  Its contribution is full.

The **raw surprise score** for an article is:

```
raw_surprise = (unknown_count * 1.0 + adjacent_count * 0.5) / total_concept_count
```

Where `total_concept_count` is the number of concepts extracted from the article.
This normalizes across articles with different numbers of extracted concepts, producing
a value in [0.0, 1.0]. An article where all extracted concepts are unknown scores 1.0;
one where all are already in the graph scores 0.0.

The raw surprise score is computed at pipeline time for every article in the candidate
pool and stored transiently in memory during feed assembly (not persisted to the
database). The concept graph queried is the same `user_concepts` / `user_concept_edges`
data already in Postgres from Phase 3.

#### How Serendipity Score Is Computed

The serendipity score combines raw surprise with the article's quality signal. The
quality signal already exists: the LLM quality gate in Phase 1 produces a numeric
quality score for every article that passes evaluation. That score is stored in the
batch JSON.

```
serendipity_score = raw_surprise * quality_weight
```

Where `quality_weight` is the article's quality score normalized to [0.5, 1.0]. The
lower bound of 0.5 (rather than 0.0) ensures that even a minimally passing article
retains some serendipity potential; the upper bound of 1.0 caps quality's influence
so that an exceptional article about a topic the user already knows thoroughly does
not outrank a good article about something entirely new.

The quality score normalization maps the existing LLM quality score range to [0.5, 1.0]
using a linear transformation. The exact mapping depends on the quality gate's output
range, which the Architect will confirm from `lib/discovery/qualityGate.ts`.

#### How Serendipity Score Integrates with Feed Ranking

The 20 daily articles are divided into exploitation slots and exploration slots (see
Feature 3). This division happens at feed assembly time in `rankFeed()`.

**Exploitation slots** are filled using the existing Phase 3 ranking formula,
unchanged:

```
final_score = 0.7 * source_score + 0.3 * aesthetic_proximity + concept_bonus
```

**Exploration slots** are filled from a separate ranked pool. Articles are ranked
for exploration by their serendipity score alone. The highest-serendipity articles
that also meet quality threshold are selected for exploration slots, subject to the
slot type allocations described in Feature 3. An article cannot appear in both an
exploitation slot and an exploration slot.

This separation is intentional. Mixing serendipity into a single global ranking
formula risks having high-quality familiar articles always outcompete surprising
articles. Keeping the two pools separate guarantees that exploration slots are
actually filled with surprising content, and exploitation slots are actually filled
with high-confidence recommendations.

---

### 2. Active Learning — Blind Spot Probing

#### What a Blind Spot Is

A blind spot is a conceptual domain that is absent from the user's concept graph —
not merely underrepresented, but completely unconnected to any existing node. Because
the graph is built entirely from liked articles, a blank area in the graph could mean:
the user has never encountered content from that domain, the user has seen such content
but not liked it, or the user has simply not had access to good content in that area.
The system cannot distinguish these cases without probing.

Blind spot identification works as follows: at pipeline time, the system identifies
the set of concept labels extracted from all candidate articles that have zero nodes
or edges in the user's concept graph. These are grouped into thematic clusters by
the LLM (a single batch call asking the model to group a list of concept labels into
broad thematic areas). Clusters with three or more concept labels from distinct
candidate articles are designated active blind spot candidates for that day's run.
This ensures that a blind spot probe is always backed by real candidate content, not
a hypothetical.

#### How Probes Are Injected

One blind spot probe slot is included in the exploration budget each day (see Feature
3 for exact allocation). The article selected for the blind spot probe slot is the
highest-serendipity-scoring article from the most underrepresented active blind spot
cluster — the cluster that contains concept labels most distant from any existing
node, and for which the user has the least historical exposure.

Probe injection frequency is not separately configurable from the exploration budget.
It is always one slot per day when the exploration budget includes a blind spot probe
slot, subject to the adaptive budget mechanism in Feature 4. The minimum floor
(see Feature 3) ensures at least one probe reaches the user per day regardless of
receptivity.

#### How User Response to Probes Is Interpreted

Probe articles are tracked internally by storing a `probe_type: 'blind_spot'` flag
on the article's batch JSON entry (similar to how `discoveryTopic` is stored — never
sent to the client, stripped at API time). When feedback arrives on a probe article,
the system interprets the signal as follows:

**Like on a probe:** The probed conceptual area is a discovered preference. The
concept labels from the article are added to the concept graph via the standard Phase
3 concept extraction pipeline, with full engagement weight. Additionally, the blind
spot cluster that produced this probe is promoted — future articles from that cluster
are eligible for exploration slots at higher priority for the following 14 days.

**Dislike on a probe:** The probed conceptual area is actively unwelcome. The concept
labels from the article are not added to the graph. The blind spot cluster that
produced this probe is suppressed — it is ineligible for probe selection for 30 days.
A dislike on a probe is not a signal to stop probing; it is a signal to probe elsewhere.

**No feedback on a probe (ignore):** The most ambiguous outcome. Ignore means the
article was either seen and found uninteresting enough not to engage with, or not
seen at all (the user did not scroll far enough). After two consecutive ignores of
probes from the same blind spot cluster, that cluster's priority is reduced but not
eliminated. It becomes eligible for probe selection again after 14 days at lower
priority. Ignore does not trigger the 30-day suppression that a dislike triggers,
because absence of engagement is not the same as rejection.

All probe suppression and promotion state is stored in a new `blind_spot_state` table
(details for the Architect to design in the Phase 4 design document).

#### Does the System Ever Stop Probing?

No. However, it learns from dislike patterns to redirect probing. If the user
consistently dislikes or ignores probes from multiple clusters, no single cluster
accumulates enough dislike events to trigger permanent suppression — the 30-day
cooling period ensures the cluster returns for re-evaluation rather than being
permanently retired. There is always a minimum floor of one probe per day (subject
to the receptivity floor in Feature 4), because the purpose of probing is to find
unknown preferences. Stopping entirely because early probes were rejected would
reproduce exactly the filter bubble that Phase 4 is designed to escape.

The floor is the protection against over-conservatism. The cooling period is the
protection against hammering the user with content they have already rejected.

---

### 3. Structured Exploration Budget

#### How Many of the 20 Daily Articles Are Exploration Slots

Under baseline conditions (no adaptive adjustment), **4 of the 20 daily articles are
exploration slots** (20%). The remaining 16 are exploitation slots filled by the
Phase 3 ranking formula.

4 slots was chosen for the following reasons: fewer than 3 produces a feed that is
indistinguishable from Phase 3 in daily experience; more than 5 risks the feed
feeling incoherent to a user in a low-receptivity state. 4 represents a deliberate
but not dominant presence — roughly one in every five articles the user encounters
is designed to expand their territory.

This baseline is a named constant, adjustable without architectural change.

#### How the 4 Exploration Slots Are Allocated

The 4 baseline exploration slots are divided across three surprise types:

| Slot Type | Count (Baseline) | Description |
|-----------|-----------------|-------------|
| Semantic stretch | 2 | Articles whose concepts sit at the perimeter of the concept graph — not in the graph, but one or two hops from known nodes. High serendipity score, moderate surprise. |
| Blind spot probe | 1 | One article from a conceptual area entirely absent from the graph (see Feature 2). Maximum surprise. |
| Complete wildcard | 1 | One article selected with no reference to the concept graph. Ranked solely by quality score. The system's equivalent of a curator's personal pick — something that would not rank highly under any personalization signal but is simply excellent. |

The wildcard slot exists because the concept graph, however well-built, is a map of
past engagement. It cannot represent areas the user has no vocabulary for. The
wildcard bypasses all personalization and selects purely on quality, giving
extraordinary content a guaranteed path into the feed regardless of conceptual fit.

Each slot type's count is a named constant, adjustable without architectural change.

#### Fixed vs. Adaptive Budget

The exploration budget is adaptive, bounded by a floor and a ceiling:

- **Floor: 2 exploration slots per day** (minimum regardless of receptivity).
  Below this, the feed has insufficient variety to function as a discovery companion.
- **Ceiling: 6 exploration slots per day** (maximum regardless of receptivity).
  Above this, the feed loses coherence for users with strong established preferences.
- **Baseline: 4 exploration slots per day** (the starting value and the value
  returned to after a period of low or high receptivity resolves).

When the receptivity signal (see Feature 4) is high, the budget increases toward the
ceiling. When receptivity is low, it decreases toward the floor. The floor ensures
the system never becomes so conservative that it stops challenging the user. The
ceiling ensures the system never becomes so aggressive that it undermines the core
value of a reliably excellent feed.

The slot type allocation scales proportionally when the budget changes: at 2 slots,
the distribution is 1 semantic stretch, 0 blind spot, 1 wildcard. At 6 slots, the
distribution is 3 semantic stretch, 2 blind spot, 1 wildcard. The wildcard count
is always capped at 1, regardless of budget level.

---

### 4. Psychographic Modulation via Receptivity Signal

#### The Underlying Principle

The user's willingness to be surprised is not constant. A user who has been reading
intensively and liking familiar content for several days is signaling a preference for
depth within known territory — a "hunter" mode (as described in the vision document).
A user who is sampling broadly, spending variable time on articles across different
topic areas, may be in an exploratory state — open to range. The system should read
these signals and adjust how aggressively it explores.

This modulation must not become a mechanism for the system to avoid challenging the
user. The floor exists precisely to prevent that. Modulation makes the exploration
experience feel natural rather than jarring — it adapts to the user's cognitive state
without eliminating the exploration mandate.

#### What Signals Constitute the Receptivity Indicator

The receptivity indicator is a composite of three observable signals from the
trailing 7-day window:

**Signal 1: Topic diversity of recent liked articles.**
Computed as the number of distinct concept graph clusters represented in liked
articles over the past 7 days, normalized by the total number of liked articles.
High diversity (the user is liking articles across many topic areas) suggests
openness. Low diversity (all recent likes cluster in one or two areas) suggests
focused mode.

Diversity score: `distinct_clusters / liked_count`, bounded to [0.0, 1.0].
If fewer than 3 liked articles in the 7-day window, this component defaults to 0.5
(neutral) rather than inferring anything from sparse data.

**Signal 2: Probe acceptance rate.**
Of the blind spot probe articles shown in the past 14 days, what fraction received
a like (not a dislike or ignore)? Higher acceptance rate indicates demonstrated
openness to surprise.

Probe acceptance rate: `probe_likes / probes_shown`, bounded to [0.0, 1.0].
If fewer than 3 probes have been shown in the 14-day window, this component defaults
to 0.5 (neutral).

**Signal 3: Average dwell time on exploration slot articles vs. exploitation slot
articles.**
If the user is spending comparable or more time on exploration articles than
exploitation articles, they are engaging with the unexpected content. If they are
consistently spending much less time on exploration articles, they are tolerating
but not engaging with the exploration.

Dwell ratio: `avg_dwell_exploration / avg_dwell_exploitation`, capped at 1.5.
If either pool has fewer than 3 data points, this component defaults to 0.75
(slightly below neutral, reflecting the general baseline that exploration content
typically earns less dwell time than familiar content).

#### Receptivity Score Formula

```
receptivity = (0.40 * diversity_score)
            + (0.35 * probe_acceptance_rate)
            + (0.25 * min(dwell_ratio, 1.5) / 1.5)
```

The weights reflect the relative reliability of each signal. Topic diversity is the
most stable signal (it is observable across all liked articles, not just probes or
exploration slots). Probe acceptance is the most direct measure of openness to
surprise but has lower sample volume. Dwell ratio is a useful corroborating signal
but is noisier than the other two. The weights are named constants, adjustable
without architectural change.

The resulting receptivity score is in [0.0, 1.0].

#### Threshold Values and Behavioral Adjustments

| Receptivity Range | Label | Exploration Budget |
|-------------------|-------|--------------------|
| 0.0 – 0.30 | Low | 2 slots (floor) |
| 0.31 – 0.55 | Moderate-low | 3 slots |
| 0.56 – 0.70 | Baseline | 4 slots |
| 0.71 – 0.85 | Moderate-high | 5 slots |
| 0.86 – 1.00 | High | 6 slots (ceiling) |

The receptivity score is computed at feed assembly time, using data already available
in the database (feedback history, dwell time metadata, probe tracking). It is not
persisted — it is computed fresh on each `rankFeed()` call. This is consistent with
how Phase 3 blend weights are computed.

#### Avoiding Permanent Conservatism

Several mechanisms work together to prevent the system from settling permanently into
the floor state:

1. The floor of 2 exploration slots is absolute. Even at minimum receptivity, 2
   exploration articles reach the user every day.
2. The probe acceptance rate component of receptivity is computed over a rolling
   14-day window. If the system is in floor mode and consistently serving uninspiring
   exploration articles (because the blind spot probes are all being ignored), the
   probe acceptance rate will be low, which keeps receptivity low — but the wildcard
   slot at floor level provides quality-first exploration that can break the pattern
   without requiring graph-adjacent content.
3. If the user's exploration slot dwell time begins to rise (Signal 3 improving), the
   receptivity score will naturally increase even if explicit likes on probes remain
   sparse.
4. Dislike-driven suppression of individual blind spot clusters (Feature 2) means
   the system continuously rotates probe targets. A user who dislikes a probe does
   not get the same probe repeated; they get a probe from a different cluster the
   next day. This prevents repeated rejection of the same content type from masking
   genuine openness to other types of surprise.

---

## User Impact

**Who is affected:** Kyle. All Phase 4 changes are system-internal. No new UI
controls, settings, or visible indicators are introduced.

**How the experience changes:**

In the short term, the feed will look very similar to Phase 3. The concept graph
needs a meaningful number of nodes (accumulated through normal Phase 3 operation)
before serendipity scoring and blind spot identification are meaningful. During the
first weeks, the wildcard slot will provide the most visible impact — one article per
day chosen purely for quality with no personalization constraint.

Over weeks and months, the feed begins to feel less like a mirror and more like a
companion. The user will occasionally encounter articles on subjects they have never
thought about, written in a style that feels familiar and trustworthy, on topics that
turn out to be fascinating. When a probe lands well, the concept graph expands
naturally, and the system starts finding more content in that new territory — producing
a compounding discovery effect that no single ranked feed could generate.

The receptivity modulation means the exploration experience adapts without the user
noticing the adaptation. On days when the user is reading intensively in a focused
area, the feed does not aggressively interrupt with unrelated content. On days when
engagement patterns suggest openness, the feed leans further into the unknown. The
overall experience is of a system that reads the room without being asked to.

The most significant long-term effect is that the system begins to function as a
genuine intellectual companion rather than a sophisticated filter. The concept graph
expands beyond its initial footprint. The user encounters ideas they would never have
searched for. Some of those ideas become long-term interests that feed back into the
graph, creating new areas for future exploration at their own perimeter. The companion
relationship becomes self-sustaining and genuinely surprising over time.

---

## Decisions

The following questions were raised during BRD drafting and resolved here. No open
questions remain.

**1. How is semantic distance from the concept graph computed? What embedding approach?**

Decision: Semantic distance is computed at the concept label level, not via dense
vector embeddings. Article concepts are extracted by the existing LLM call and
matched against concept graph nodes using the same label normalization already in use
in Phase 3 (lowercase, punctuation-stripped substring matching). Unknown concepts are
those with no node match and no edge connection to any existing node. Adjacent concepts
are those connected by one hop. This produces the `raw_surprise` score.

Rationale: Dense embedding comparison (e.g., computing cosine similarity between
article concept embeddings and the centroid of all graph node embeddings) would require
storing embeddings for every graph node and every candidate article concept — significant
infrastructure for a single-user system where the graph has at most 300 nodes. The
label-based hop-distance approach leverages the graph structure already built in Phase 3
without new infrastructure, and produces an interpretable and auditable surprise score.
The hop-distance model also naturally distinguishes adjacent-but-new (one hop) from
truly unknown (zero connections), which is a meaningful distinction for slot allocation.
If the system is extended to multi-user scale or the graph grows substantially, a
transition to vector embeddings can be made without changing the serendipity framework.

**2. What is the serendipity score formula (combining surprise and quality)?**

Decision: `serendipity_score = raw_surprise * quality_weight`, where `quality_weight`
is the article's LLM quality score normalized to [0.5, 1.0].

Rationale: Multiplicative combination means that either factor being low substantially
reduces the serendipity score: a highly surprising but low-quality article scores at
most 0.5, and a high-quality article the user already knows well scores near 0.0.
The 0.5 floor on quality weight (rather than a full [0.0, 1.0] normalization) ensures
that a good-but-not-great article can still be selected for an exploration slot if
its surprise value is high enough. A [0.0, 1.0] normalization would let the quality
gate's minimum-passing articles score near zero serendipity regardless of surprise,
which would bias exploration toward the highest-quality articles only — partially
defeating the purpose of the wildcard slot (which bypasses the concept graph
entirely and ranks on quality alone).

**3. How many of the 20 daily articles are reserved for exploration? Is this fixed or adaptive?**

Decision: 4 exploration slots under baseline conditions. Adaptive, bounded to a floor
of 2 and a ceiling of 6 based on the receptivity signal.

Rationale: 4 slots (20%) is enough to make discovery a meaningful and consistent part
of the daily experience without compromising the reliability of the other 16 slots.
The adaptive range of 2 to 6 gives the system enough flexibility to respond to the
user's engagement state without producing a feed that feels unpredictable. The floor
of 2 is the minimum that fulfills Phase 4's core mandate; dropping below 2 would
reduce exploration to a token presence that the user would not notice and that would
have negligible effect on concept graph expansion.

**4. How are the exploration slots divided across the three surprise types?**

Decision: Baseline allocation is 2 semantic stretch, 1 blind spot probe, 1 complete
wildcard. At the floor (2 slots), allocation is 1 semantic stretch, 0 blind spot,
1 wildcard. At the ceiling (6 slots), allocation is 3 semantic stretch, 2 blind spot,
1 wildcard. The wildcard count is always exactly 1.

Rationale: Semantic stretch slots are the most frequently occurring because they are
the least cognitively disruptive — they are surprising but not entirely disconnected
from the user's territory. They are the most likely to be liked, which drives concept
graph expansion toward the graph's perimeter over time. Blind spot probes are more
aggressive and appear less frequently; their role is to periodically test entirely new
territory rather than to dominate the exploration budget. The wildcard always gets
exactly one slot because its function (quality-first, graph-agnostic selection) is
categorical, not scalar — it does not benefit from more slots and does not scale with
receptivity.

**5. What signals constitute the receptivity indicator, and what are the threshold values?**

Decision: Three signals: topic diversity of recent liked articles (7-day window,
weight 0.40), probe acceptance rate (14-day window, weight 0.35), and dwell ratio
of exploration vs. exploitation articles (weight 0.25). Thresholds for budget
adjustment: [0.0–0.30] = 2 slots, [0.31–0.55] = 3 slots, [0.56–0.70] = 4 slots,
[0.71–0.85] = 5 slots, [0.86–1.00] = 6 slots.

Rationale: These three signals cover the three primary observable dimensions of
openness: what the user is liking broadly (diversity), how they respond to deliberate
surprise (probe acceptance), and how deeply they engage with non-familiar content
(dwell ratio). Using a 7-day window for diversity captures current mode without being
dominated by a single day's activity. The 14-day window for probe acceptance is
longer because probe volume is lower than general like volume; a 7-day window would
frequently hit the sparse-data neutral default. Dwell ratio uses whatever data exists
without a fixed window because exploration slot volume is low enough that a fixed
window would frequently produce defaults. The weight allocation favors diversity
(40%) over probe acceptance (35%) because diversity is observable every day and is
not dependent on the probe infrastructure itself being well-calibrated; it is a more
robust signal during early Phase 4 operation.

**6. How does the system handle a user who always dislikes probes — does it eventually stop probing?**

Decision: No. The system never stops probing. Dislike-driven suppression applies to
individual blind spot clusters for 30 days, not to probing as a whole. The floor of
2 exploration slots always includes at least 1 wildcard (which is not a blind spot
probe), and when the budget is at floor level, the blind spot probe slot is replaced
by an additional semantic stretch slot. The system rotates to other blind spot
clusters as each one is suppressed. After 30 days, suppressed clusters become
eligible again for probe consideration at lower priority.

Rationale: A user who consistently dislikes probes is telling the system which
specific conceptual areas are unwelcome, not that they want no exploration. The
cooling mechanism ensures that specific rejected content areas are not repeatedly
pushed, while the probe infrastructure continues to identify and test new areas.
Permanently retiring probing would be the system accepting a permanent filter bubble,
which contradicts Phase 4's core purpose. The wildcard slot at floor level continues
to deliver genuinely surprising content even when blind spot probes are at minimum
frequency, maintaining the exploration mandate without requiring the user to accept
content they have explicitly rejected.

---

## Related Documents

| Document | Location |
|----------|----------|
| Product Vision | `agents/ba/vision_discovery_companion.md` |
| Prior BRD — Deep User Model (Phase 3) | `agents/ba/brd_deep_user_model_phase3.md` |
| Prior BRD — Latent Aesthetic Space (Phase 2) | `agents/ba/brd_aesthetic_space_phase2.md` |
| Prior BRD — Agentic Discovery (Phase 1) | `agents/ba/brd_agentic_discovery_phase1.md` |
| System Architecture | `agents/architect/ARCHITECTURE.md` |
| Product Roadmap | `agents/pm/roadmap.md` |
| Concept graph type definitions | `lib/types/concepts.ts` |
| Aesthetic profile type definitions | `lib/types/aesthetic.ts` |
| Feed ranker | `lib/pipeline/ranker.ts` |
| Quality gate | `lib/discovery/qualityGate.ts` |
| Aesthetic DB helpers | `lib/db/aesthetics.ts` |
| Concept graph DB helpers | `lib/db/concepts.ts` |
