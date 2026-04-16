# BRD-008: Latent Aesthetic Space — Phase 2

| Field | Value |
|-------|-------|
| **ID** | BRD-008 |
| **Title** | Latent Aesthetic Space — Phase 2 |
| **Date** | 2026-04-04 |
| **Status** | Resolved |
| **Phase** | Phase 2 — Latent Aesthetic Space |
| **Depends On** | BRD-007 (Agentic Content Discovery — Phase 1, shipped) |

---

## Problem Statement

The current personalization system ranks articles by source quality: sources the user
has liked before rise; sources they have disliked fall. This is a blunt instrument.
A user might love a specific kind of writing — introspective, conceptually dense,
lightly written — regardless of whether it appears in The Atlantic, a personal blog,
or a specialist academic outlet. Conversely, they might dislike breathless, anxious
prose even when it comes from a source they generally trust.

Source-level scoring cannot capture this. Two articles from the same source can feel
completely different to read. Two articles from completely different domains — a
materials science essay and a piece of literary criticism — can feel nearly identical
in their rhythm, register, and intellectual texture.

The system currently has no vocabulary for how writing *feels*. It knows what sources
a user tends to like. It does not know what kind of writing the user gravitates toward
across the full range of content it surfaces. This means personalization plateaus
quickly: once a user's source preferences stabilize, the ranking signal stops
evolving. The feed gets locally optimized but never globally understood.

Phase 2 introduces a new layer of understanding. Rather than categorizing content by
topic or source, the system will embed every article along a set of subjective
aesthetic dimensions — tone, pacing, intellectual density, emotional register, and
writing register. This creates a latent space in which articles that *feel* similar
sit near each other, regardless of subject matter. The system then learns where in
this space the user spends time, builds a running taste profile, and ranks future
articles by how close they sit to that profile.

---

## Goals

- Every article that enters the system — whether from fixed RSS sources, NewsAPI,
  Brave Search discovery, or Small Web crawls — is scored along a defined set of
  aesthetic dimensions by an LLM at ingestion time.
- The system maintains a running aesthetic profile for each user: a weighted centroid
  in the aesthetic space, updated incrementally each time the user likes or dislikes
  an article.
- Feed ranking incorporates aesthetic proximity to the user's profile as a signal,
  blended with the existing source-score ranking. Neither signal fully replaces the
  other.
- A user encountering the system for the first time, before any feedback exists,
  experiences a fully functional feed with no degradation. The aesthetic profile
  bootstraps gracefully from early interactions.
- The aesthetic scoring pipeline is resilient: failures to score an article do not
  block the pipeline and do not remove the article from the feed. Unscored articles
  are treated as neutral in the ranking step.
- The system is designed so that the aesthetic dimensions can be tuned or extended
  in the future without requiring a full re-architecture.

---

## Non-Goals

- **Phase 3 and Phase 4 features.** Natural language feedback, psychographic
  profiling, short-term versus long-term preference fusion, graph-enhanced memory,
  and serendipity engineering are explicitly out of scope.
- **Cross-modal aesthetics.** Phase 2 covers written articles only. Extending the
  aesthetic space to audio, video, or images is not in scope.
- **Real-time aesthetic profile updates.** The user's aesthetic centroid is updated
  when the pipeline runs or when feedback is processed, not in real time as the user
  reads. Sub-second profile updates are not required.
- **User-visible aesthetic profiles.** There is no UI exposing the aesthetic
  dimensions, scores, or the user's profile vector. This is an internal ranking
  signal only.
- **Replacing the existing source-score ranker.** The current `rankFeed()` logic
  and Wilson score source weighting remain in place. Aesthetic proximity is added
  as a blended signal, not a replacement.
- **Retroactive scoring of historical batches.** Only articles processed after Phase
  2 ships will have aesthetic scores. Past batch files on disk are not re-processed.
- **Operator tooling for managing dimension definitions.** Changing the dimensions
  requires a code change and redeployment, not a UI.

---

## Feature Details

### 1. Aesthetic Dimension Schema

The system will embed each article along six aesthetic dimensions. Six dimensions
provide sufficient resolution to discriminate meaningfully between different kinds of
writing without making the LLM prompt so complex that scoring reliability degrades.
The dimensions are designed to be orthogonal: they capture different qualities, so
knowing an article's score on one dimension tells you little about its score on
another.

Each dimension is scored on a continuous scale from 1.0 to 5.0, where 1 and 5
represent the poles described below and 3 represents a neutral midpoint. Decimal
precision to one place (e.g., 3.5, 4.0) is sufficient.

---

**Dimension 1: Contemplative vs. Propulsive**
*Scale: 1 = highly propulsive; 5 = deeply contemplative*

This captures pacing and narrative drive. A propulsive piece moves quickly through
information, builds urgency, and propels the reader forward — news analysis, fast-
paced essays, tightly argued op-eds. A contemplative piece lingers, reflects, circles
back, and invites the reader to slow down — meditative long-form essays, personal
reflections, philosophical inquiries.

Justification: This is often the most immediately felt quality of a piece of writing.
A reader who finds propulsive writing exhausting and contemplative writing nourishing
will have a strong, consistent reaction to this dimension across all subject matter.
It is also a dimension that source-level scoring cannot capture: the same source can
publish both propulsive news analysis and slow meditative essays.

---

**Dimension 2: Concrete vs. Abstract**
*Scale: 1 = highly concrete; 5 = highly abstract*

This captures the ratio of specific, material, sensory detail to general, theoretical,
or conceptual argument. A concrete piece is grounded in examples, cases, objects,
people, and places. An abstract piece deals in ideas, systems, principles, and
frameworks with few or sparse concrete anchors.

Justification: This dimension cleanly separates two very different reading experiences
that often cut across subject matter. A concrete essay about philosophy (Montaigne-
style) and a concrete essay about materials science feel more similar to read than a
concrete philosophy essay and an abstract philosophy essay. This is the dimension that
most enables cross-domain discovery: it surfaces the underlying texture of the writing
independent of topic.

---

**Dimension 3: Personal vs. Universal**
*Scale: 1 = highly personal and first-person; 5 = highly universal and impersonal*

This captures the degree to which the author is present in the text as a subject.
Personal writing draws heavily on the author's own experience, perspective, memory, or
emotional state. Universal writing is written from a position of removed authority or
shared human concern — research, journalism, and argumentative essays tend toward this
pole; memoir, personal essay, and diary-form writing tend toward the personal.

Justification: Many readers have a strong and stable preference here. Some gravitate
toward writing that foregrounds the author's subjectivity; others prefer writing that
effaces the author in favor of the subject. This dimension also predicts genre in a
useful way: knowing a user gravitates toward personal writing helps the system favor
essay and memoir-form pieces even when they appear on sources the user has never
interacted with.

---

**Dimension 4: Playful vs. Serious**
*Scale: 1 = highly playful; 5 = highly serious*

This captures tonal register. Playful writing uses humor, irony, unexpected
juxtapositions, wit, and lightness. Serious writing maintains gravity, earnestness,
and weight — it is not necessarily somber, but it does not use levity as a mode.
Most writing sits in the middle; the extremes are distinctive.

Justification: Tonal register is the quality most immediately conveyed by a headline
and opening paragraph, and it powerfully predicts whether a reader will enjoy the
full piece. Including this dimension allows the system to learn whether a user
consistently gravitates toward wit-forward writing or toward writing that takes itself
seriously, and rank accordingly.

---

**Dimension 5: Specialist vs. Generalist**
*Scale: 1 = highly generalist; 5 = highly specialist*

This captures the assumed prior knowledge of the reader. Generalist writing is
accessible to a curious non-expert. Specialist writing assumes fluency in a domain
and does not explain its foundational vocabulary, methods, or debates. A popular
science essay is generalist. A review article aimed at researchers in a field is
specialist. A piece that uses technical vocabulary but explains it accessibly sits
in the middle.

Justification: This dimension directly captures the intellectual density question
raised in the vision document. It is distinct from the Concrete/Abstract dimension:
a piece can be highly concrete and highly specialist (a detailed technical tutorial)
or highly abstract and highly generalist (a philosophical essay for a lay audience).
The system cannot infer this from source alone: a publication like Quanta Magazine
publishes at many levels of specialist depth depending on the piece.

---

**Dimension 6: Emotionally Resonant vs. Emotionally Neutral**
*Scale: 1 = emotionally neutral; 5 = emotionally resonant*

This captures the degree to which the writing actively invites or produces emotional
engagement — beauty, melancholy, wonder, unease, warmth. Emotionally neutral writing
communicates information or argument with little emotional texture. Emotionally
resonant writing operates on the reader's feeling state as well as their intellect.

Justification: This dimension captures the quality that distinguishes writing people
remember from writing they merely consume. The vision document describes aesthetic
value as including "emotional resonance (evoking nostalgia, inspiration, or
existential tension)." This dimension operationalizes that quality. It is also one
that varies sharply within genres: some science journalism is purely informational;
some is written to evoke the feeling of awe that drives scientific curiosity.

---

### 2. LLM-Based Aesthetic Scoring

Every article that completes the pipeline — whether from fixed sources, Brave Search,
or Small Web discovery — is scored along the six aesthetic dimensions by an LLM
before the article enters the batch file.

**Model:** `claude-haiku-4-5-20251001` (the same model used in Phase 1 for content
evaluation). This is a classification task on short text. Haiku is fast, low-cost,
and sufficiently capable for structured multi-dimensional scoring.

**Input:** The first 3,000 characters of `bodyText`, if available. If `bodyText` is
absent or shorter than 300 characters, the `title` and `description` fields are used
instead. Using a text floor prevents the scorer from treating metadata-only articles
as if they had been read.

**Output format:** The LLM is called with structured output (tool use, consistent
with the approach established in Phase 1) using a `score_aesthetic` tool that returns
a JSON object with six fields, one per dimension, each a float from 1.0 to 5.0. This
eliminates parsing ambiguity.

**Prompt structure:** The prompt instructs the model to score as a thoughtful editor
who has read widely and is sensitive to the texture of prose — not as a classifier
pattern-matching on keywords. Each dimension is defined in the prompt with a brief
description of its poles. The model is told to use 3.0 as a midpoint for writing
that is neither particularly one thing nor the other, and to reserve 1.0 and 5.0 for
clearly extreme cases.

**Storage:** Aesthetic scores are stored as a six-element float array in a new
`aesthetic_scores` column in Postgres using pgvector (`vector(6)` type), keyed by
`article_id`. The `article_id` is the same deterministic hash used on the `Article`
type. This table is separate from the batch JSON files: scores live in the database
and are looked up at ranking time. The batch files on disk are not modified.

**Scoring failures:** If the LLM call fails, times out, or returns a malformed
response, the article is still written to the batch. A `NULL` score is stored (or the
row is absent from the scores table). During ranking, articles with no aesthetic
score are treated as having a score of zero aesthetic proximity contribution — they
are ranked by source score only, as they would have been before Phase 2. A scoring
failure never removes an article from the feed.

---

### 3. User Aesthetic Profile

For each user (or device, for anonymous users), the system maintains an aesthetic
profile: a six-element vector representing the centroid of the aesthetic space the
user has inhabited based on their feedback history.

**What the centroid represents:** The centroid is a weighted average of the aesthetic
scores of all articles the user has liked, minus a weighted contribution from articles
the user has disliked. It is not a simple average of all articles seen — it is driven
by explicit feedback only.

**How it is updated:** The centroid is updated incrementally using an exponential
moving average (EMA) rather than recomputing from scratch on each feedback event.

When the user likes an article with aesthetic score vector `v`:

```
centroid = (1 - alpha) * centroid + alpha * v
```

When the user dislikes an article with aesthetic score vector `v`:

```
centroid = (1 - alpha) * centroid + alpha * (6 - v)
```

The dislike update moves the centroid away from the disliked article's aesthetic
position by applying the mirror score across the 1–5 scale. This is a deliberate
simplification: it means a dislike for a highly contemplative piece nudges the profile
toward propulsive, which may or may not be correct. This heuristic is adequate for
Phase 2 and can be refined in Phase 3 when the user model becomes more sophisticated.

**Alpha (adaptation rate):** Alpha is set to 0.2. This means each new feedback event
contributes 20% weight, and the accumulated prior contributes 80%. At this rate:

- After 5 likes, the centroid has shifted substantially toward the user's emerging
  preference.
- After 20 likes, the centroid is stable and represents a genuine long-term taste.
- The profile adapts meaningfully to early feedback while resisting overreaction to
  any single data point.

Alpha is stored as a named constant and can be tuned without architectural change.

**Storage:** The centroid vector is stored in a new `user_aesthetic_profiles` table
in Postgres using pgvector (`vector(6)` type), alongside a `feedback_count` integer
(the total number of feedback events incorporated) and an `updated_at` timestamp. The
key is `user_id` for authenticated users and `device_id` for anonymous users,
consistent with the identity routing pattern established in Milestone 3.

**Initialization:** A new row is created the first time a user gives feedback on an
article that has an aesthetic score. Users who give feedback on unscored articles do
not get an aesthetic profile entry for those events.

---

### 4. Aesthetic-Aware Ranking

The feed ranking step in `lib/pipeline/ranker.ts` currently scores each article using
a Wilson score lower bound on the source's like/dislike history, applies a suppression
check, an exploration budget, and a per-source diversity cap. Phase 2 adds aesthetic
proximity as an additional signal blended into the article score before sorting.

**Proximity measure:** Cosine similarity between the user's aesthetic centroid vector
and the article's aesthetic score vector. Cosine similarity is chosen over Euclidean
distance for two reasons: it is scale-invariant (a user who likes slightly
contemplative and moderately contemplative pieces will score them both as close to
their profile, rather than penalizing the less-extreme one), and it is well-suited to
the normalized 1–5 range these vectors occupy. The result is a value from -1 to 1.

**Blending weight:** The final article rank score is:

```
final_score = 0.7 * source_score + 0.3 * aesthetic_proximity
```

Source score (Wilson lower bound, already normalized 0–1) continues to dominate. This
reflects the reality that early in Phase 2, the aesthetic profile will be sparse and
imprecise. A 30% weight gives the aesthetic signal meaningful influence once the
profile has 10+ feedback events, while ensuring that a user with a well-established
source history does not see their feed disrupted by a nascent aesthetic profile.

Both weights (0.7 and 0.3) are named constants. They can be adjusted without code
changes to the blending logic itself.

**When aesthetic data is absent:** If the user has no aesthetic profile (new user or
no qualifying feedback yet), `aesthetic_proximity` is treated as 0 and the blend
collapses to 100% source score — identical to the pre-Phase-2 behavior. If an article
has no aesthetic score, its contribution to the aesthetic term is also 0. This means
partially scored batches rank coherently: scored articles compete on both signals;
unscored articles compete on source score only.

**No changes to suppression, diversity cap, or exploration budget:** These mechanisms
in `rankFeed()` operate after the score is computed. Phase 2 changes only how the
score is assembled; the downstream logic is untouched.

---

### 5. Cold-Start Handling

A new user has no feedback, no aesthetic profile, and no source history. The system
handles this through three stages:

**Stage 1: Zero feedback (first session, no interactions yet)**

The feed is served exactly as it was before Phase 2: unranked or minimally ranked by
source score defaults, with no aesthetic influence. The experience is unchanged from
Milestone 1. This is correct behavior: a system that does not know anything about the
user should not pretend to.

**Stage 2: Sparse feedback (1–9 feedback events)**

The first like or dislike that touches an aesthetically scored article creates the
user's profile centroid, initialized to that article's score vector (for a like) or
its mirror (for a dislike). Subsequent feedback events update via EMA as described
above. The 0.3 aesthetic weight applies from the first update. At this stage the
centroid is a rough estimate; the blend weight ensures it influences but does not
dominate ranking.

No special handling or damping is applied during this bootstrap phase. The EMA
mechanism naturally stabilizes the centroid as more data arrives: an early single
outlier like contributes at most 20% once the second feedback event arrives. The
centroid is unlikely to be meaningfully misleading after 3–4 interactions because the
alpha rate is conservative.

**Stage 3: Established profile (10+ feedback events)**

By 10 feedback events the centroid has incorporated enough signal to reflect genuine
aesthetic preferences. The full 0.3 weight operates normally. The experience
transition from Stage 2 to Stage 3 is seamless — there is no threshold flip, just
the continuous EMA evolution.

This approach requires no seed data, no onboarding survey, no manual preference
declaration, and no special-case code path for cold start. The same update mechanism
that handles the thousandth feedback event handles the first.

---

## User Impact

**Who is affected:** All users, from the day Phase 2 ships. For the current single-
user deployment, this means Kyle directly.

**How the experience changes:**

In the short term, the feed will feel similar. A user with established source
preferences will continue to see those preferences reflected in ranking. The aesthetic
signal needs a few dozen feedback events before it meaningfully differentiates.

Over time, the feed will begin to find and surface content that *feels right* even
when it comes from unknown sources. A user who gravitates toward contemplative,
personal, emotionally resonant writing will find that new discovery articles — from
sources they have never seen before — cluster around that quality. The system will
learn the *texture* of what the user likes, not just the *origin*.

The most significant change is cross-domain coherence. Articles from completely
different topics will begin to feel consistent with each other in the way they read.
This is the core promise of the Latent Aesthetic Space concept from the product
vision: the system can recommend an emerging essay on ecological architecture because
it shares the exact aesthetic profile as a philosophy piece the user loved — not
because they are the same topic, but because they feel the same to read.

The change is invisible infrastructurally. No new UI surfaces aesthetic scores,
profile data, or dimension labels. The ranking just gets better, more cohesive, and
more accurate over time.

---

## Decisions

The following questions were raised during BRD drafting and resolved here. No open
questions remain.

**1. What are the exact aesthetic dimensions? How many?**

Decision: Six dimensions — Contemplative/Propulsive, Concrete/Abstract,
Personal/Universal, Playful/Serious, Specialist/Generalist, and Emotionally
Resonant/Neutral — each scored 1.0 to 5.0.

Rationale: Six was chosen as the number that covers the meaningful spectrum of
aesthetic variation in long-form writing without exceeding what an LLM can reliably
score in a single prompt. Fewer than five would collapse important distinctions (the
five dimensions from the vision document are illustrative; six is the number that
separates Playful/Serious and Emotionally Resonant as distinct, non-redundant axes).
More than seven or eight begins to introduce correlation between dimensions —
"lyrical" and "emotionally resonant" would overlap, as would "dense" and "specialist"
— which degrades the discriminating value of the space. The six dimensions chosen
are as orthogonal as the domain allows, validated by the following test: knowing an
article's score on any one dimension provides weak prediction of its scores on the
others. An article can be contemplative and concrete, or contemplative and abstract;
serious and generalist, or serious and specialist; personal and playful, or personal
and serious. The dimensions do not gang up on each other.

**2. How is the user centroid updated — batch recompute vs. incremental EMA?**

Decision: Incremental exponential moving average (EMA) with alpha = 0.2.

Rationale: Batch recompute requires storing every historical like and dislike score
vector and recomputing from scratch on each update. This grows in cost linearly with
feedback history length and introduces a seam: the profile can only be accurate if
all historical articles still have aesthetic scores, which will not be true for
pre-Phase-2 feedback. The EMA is O(1) per update regardless of history length,
requires only the current centroid vector and the incoming score, handles the missing-
score problem naturally (events on unscored articles simply do not update the
centroid), and is robust to sparse early data. Alpha = 0.2 was chosen to balance
adaptability (a new preference pattern is meaningfully incorporated within 5–10
events) against stability (a single outlier does not swing the centroid dramatically).

**3. What is the blending weight between aesthetic proximity and source-score ranking?**

Decision: 70% source score, 30% aesthetic proximity.

Rationale: The source-score signal (Wilson lower bound) is well-established and
proven. The aesthetic signal is new, will be sparse for most users initially, and
its LLM-generated scores carry inherent noise. Weighting it at 30% allows it to
meaningfully influence ranking once the profile has sufficient data while preventing
it from overriding source preferences during the early bootstrap period. If Phase 2
validation shows the aesthetic signal to be more reliable than expected, the weight
can be increased by changing a single constant. The 70/30 split is also a natural
reading of the design intent: source preferences are the primary signal; aesthetic
texture is a refinement.

**4. How does a completely new user experience the feed before any aesthetic data exists?**

Decision: No change from current behavior. A user with no feedback sees the feed
ranked by source score defaults (equivalent to all source scores equal), with the
exploration and diversity rules applied as today. The aesthetic term contributes zero
when there is no profile. No special cold-start pathway is needed; the system simply
has nothing to blend until the user gives feedback.

Rationale: The existing system already handles new users gracefully (PERS-010,
released in Milestone 4). Adding a special cold-start case for aesthetics would
introduce complexity and a potential seam. The EMA approach naturally produces
smooth bootstrap behavior: the first like initializes the centroid, and every
subsequent feedback event refines it. There is no point at which the system flips
from "cold" to "warm" mode with a discontinuous behavior change.

**5. How are scoring failures handled?**

Decision: Silent degradation. An article with no aesthetic score is ranked by source
score alone. The pipeline is never blocked or degraded by a scoring failure. Scoring
errors are logged but not surfaced to the user.

Rationale: Consistent with the failure isolation philosophy applied throughout the
pipeline (Milestone 5, Phase 1). The value of any individual article's aesthetic
score is incremental. The cost of a missing score is a slightly less informed ranking
for that article on that day. That tradeoff strongly favors resilience over
correctness.

---

## Related Documents

| Document | Location |
|----------|----------|
| Product Vision | `agents/ba/vision_discovery_companion.md` |
| Prior BRD — Agentic Discovery (Phase 1) | `agents/ba/brd_agentic_discovery_phase1.md` |
| Prior BRD — Feed Personalization | `agents/ba/brd_feed_personalization_v1.md` |
| System Architecture | `agents/architect/ARCHITECTURE.md` |
| Product Roadmap | `agents/pm/roadmap.md` |
| Feed ranker | `lib/pipeline/ranker.ts` |
| Article type definition | `lib/types/article.ts` |
| LLM content evaluator (Phase 1) | `lib/discovery/llmEvaluator.ts` |
| Feedback DB helpers | `lib/db/feedback.ts` |
| Discovery DB helpers | `lib/db/discovery.ts` |
