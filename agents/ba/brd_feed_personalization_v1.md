# BRD-004: Feed Personalization via Feedback-Driven Article Ranking

| Field | Value |
|-------|-------|
| **ID** | BRD-004 |
| **Title** | Feed Personalization via Feedback-Driven Article Ranking |
| **Date** | 2026-04-04 |
| **Status** | Draft |
| **Milestone** | Milestone 3 — Personalized Feed |
| **Depends On** | BRD-003 (server-side feedback storage, shipped), BRD-005 (user accounts and authentication — required for cross-device personalization) |

---

## Problem Statement

Tangent fetches and stores a daily batch of articles, but every user sees the
exact same 20 articles in the same order. The app has been collecting explicit
like/dislike feedback from users since Milestone 2, and that data is now durably
stored server-side in Postgres keyed by device ID. None of it has any effect on
the feed.

This is the gap: the feedback loop is broken. Users are investing effort in rating
content, but that investment produces no visible improvement in what they see. Over
time, a user who consistently dislikes political articles and consistently likes
science and tech content will continue to see a generic, unranked mix. The product
cannot learn.

This BRD defines what it means for the feed to "get smarter" — how feedback signals
are aggregated into source-level weights, how those weights influence the ordering
of the daily article batch at pipeline time, and how the system avoids creating a
closed filter bubble that starves the user of new content over time.

---

## Goals

- Articles the user is more likely to enjoy appear higher in their feed.
- Sources the user has consistently liked are weighted up, increasing the likelihood
  their articles rank near the top of the feed.
- Sources the user has consistently disliked are weighted down, pushing their
  articles lower in the feed.
- Sources with a very strong and sustained pattern of dislikes are eventually
  suppressed — their articles do not appear in the feed at all.
- New or unseen sources always have a chance to appear in the feed, preventing the
  user from being locked into an increasingly narrow filter bubble.
- Personalization happens at pipeline time, not at read time. The ranked and filtered
  article batch is written to disk as the daily output. The client receives a
  pre-ranked feed; no client-side reordering is performed.
- The feed degrades gracefully: a new user with no feedback history receives the
  same unranked feed as today, with no visible difference or error.
- When a user is authenticated, personalization is scoped to their user account
  and follows them across any device they log into. For unauthenticated users,
  personalization remains scoped to the device. Cross-device personalization
  requires BRD-005 (user accounts) to ship first.

---

## Non-Goals

The following are explicitly out of scope for this BRD:

> **Note (updated 2026-04-04):** "Cross-device personalization" and "User accounts
> or login" were originally listed as non-goals. The product owner has clarified
> that both are intended goals. They have been moved to BRD-005 (user accounts and
> authentication), which is now a declared dependency of this BRD. Once BRD-005
> ships, personalization will follow the authenticated user across devices.

- **Topic or category-level scoring.** This BRD scopes personalization to
  source-level signals only. Inferring topic preferences from article-level content
  (e.g., "user likes 'science' articles regardless of source") is a future
  capability.
- **Article-level scoring.** Individual article scores (e.g., based on title
  similarity to liked articles) are out of scope. The unit of personalization here
  is the source, not the individual article.
- **Real-time or mid-day feed updates.** The daily cadence is unchanged. The
  pipeline runs once per day and produces one ranked batch. There is no
  re-ranking triggered by feedback given after that day's batch is already written.
- **User-facing explanations of ranking.** No "why am I seeing this?" UI. Ranking
  is invisible to the user.
- **Operator-facing analytics or dashboards.** No views of aggregate source scores
  or user feedback trends.
- **Removing articles from the feed for reasons other than source suppression.**
  Individual article filtering (e.g., hiding a specific article the user has already
  read) is out of scope.
- **Source discovery or dynamic source addition.** The pipeline continues to draw
  from the configured `data/sources.json` list. Adding new sources based on
  feedback is a separate future capability.
- **Feedback deletion or data management tools.** No user-facing tools to reset
  personalization or review feedback history.

---

## How Personalization Works

### Unit of personalization: the source

Feedback is recorded at the article level (article ID + like/dislike). For the
purposes of ranking, individual article feedback is aggregated up to the source
level. The source (as identified by the article's `sourceName` or a source slug)
is the unit that receives a score.

This is the right level of granularity for the current product stage:
- Users tend to like or dislike sources as a whole (e.g., they enjoy a specific
  tech blog but dislike a certain tabloid).
- Article-level patterns require far more data to be statistically meaningful.
- Source-level scores are stable, interpretable, and easy to reason about.

### Source scoring model

Each source's score is derived from the ratio of likes to total feedback events
recorded for articles from that source. The precise formula is an implementation
detail for the Architect; the behavior requirements are:

- A source with more likes than dislikes should score higher than a source with
  an even split.
- A source with more dislikes than likes should score lower than an untouched source.
- A source with no feedback at all is treated as neutral — it neither benefits nor
  suffers from the absence of signal.
- The score should require a minimum number of feedback events before deviating
  significantly from neutral. A single like on one article should not permanently
  elevate a source to the top; a single dislike should not suppress it. Small
  sample sizes should produce scores close to neutral. (This is a confidence
  dampening concept — the Architect will determine the implementation.)
- Scores are bounded. There is a maximum possible score (a consistently loved
  source cannot rank infinitely above others) and a minimum possible score (a
  consistently disliked source reaches a suppression floor rather than going
  arbitrarily negative).

### Suppression threshold

A source that crosses a suppression threshold — defined as a sufficiently high
ratio of dislikes combined with a sufficient number of total feedback events — is
excluded entirely from that user's (or device's, for anonymous users) daily feed. Its articles do not appear,
regardless of rank.

The specific threshold values (minimum event count, minimum dislike ratio) are
implementation decisions for the Architect. The behavioral requirement is:

- Suppression must require more than one or two signals. A user who accidentally
  taps dislike once should not permanently lose a source.
- Suppression should be reversible in principle (if the user later clears or
  changes their feedback, the source can come back). Whether this reversal is
  surfaced as a user-facing feature is deferred, but the data model must not
  make it structurally impossible.

### Filter bubble prevention: the exploration budget

To prevent the feed from collapsing into an echo chamber of already-known sources,
a fixed number of articles per daily feed must be reserved for exploration. These
slots are filled by sources the user has either never seen or has given no feedback
on. Sources that would otherwise be ranked lower due to neutral or slightly negative
scores can still appear in these exploration slots.

Behavioral requirements:
- The exploration budget is a small, fixed number of article slots per daily feed
  (the exact number is an implementation decision for the Architect, suggested
  range: 2–4 out of 20 total articles).
- Suppressed sources are excluded even from exploration slots. A suppressed source
  is suppressed unconditionally.
- If there are no unseen or neutral sources to fill exploration slots (e.g., the
  user has given feedback on every configured source), the exploration budget is
  simply not filled and the remaining slots go to ranked sources as normal.
- Exploration slots should not cluster at the bottom of the feed. They should be
  distributed across the feed (e.g., one near the top, others scattered) so that
  new sources are discoverable without the user having to scroll to the end.

### Pipeline integration

Personalization happens entirely within the content pipeline, at the time the daily
batch is generated and written to disk. The ranked article list that gets stored in
`data/batches/YYYY-MM-DD.json` is the final output, already ordered for that device.

Wait — this reveals a structural constraint: the current pipeline produces one batch
file per day, shared across all users. If personalization is per-user (or per-device
for anonymous users), a single shared batch file cannot serve different users
differently.

**This is the key architectural question this BRD surfaces.** The two plausible
approaches are:

1. **Per-identity batch files**: The pipeline produces one batch file per identity
   (user ID for authenticated users, device ID for anonymous users) that has an
   existing feedback history. Users with no feedback share a default batch. This
   matches the stated goal of "personalization at pipeline time" but requires pipeline
   changes to know which identities to generate batches for.

2. **Ranking at API read time**: The `GET /api/feed/today` endpoint looks up the
   requesting identity's feedback history from Postgres and re-ranks the shared
   batch in memory before responding. The file on disk is unranked; the ranked
   result is ephemeral and never stored.

The product owner has stated a preference for approach 1 (pipeline time). The open
question is how the pipeline discovers which identities to personalize for. This BRD
flags this as a decision the Architect must resolve. Note: with authenticated users
in scope (per BRD-005), the pipeline must handle both user-ID-keyed personalization
(for logged-in users) and device-ID-keyed personalization (for anonymous users).

Either way, the client-facing requirement is unchanged: the client calls
`GET /api/feed/today`, and the articles it receives are already ranked for that
device. The client does not perform any reordering.

---

## Edge Cases

### New user with no feedback history

A user who has never given any feedback has no source scores. The pipeline (or API,
depending on the architectural approach) must detect this case and return the
standard unranked batch. No error, no empty feed, no visible difference from the
current experience. The app behaves exactly as it does today until the first
feedback is given.

### Sparse feedback (very few signals)

A user who has given only one or two feedback events has a small, potentially
unrepresentative sample. The confidence dampening described in the source scoring
model handles this: scores stay close to neutral until enough signals accumulate.
The feed will be only slightly personalized — this is correct behavior.

### All sources suppressed

If a user manages to suppress every configured source (an extreme edge case, but
theoretically possible), the feed would be empty. This must not happen. The
pipeline must enforce a minimum number of articles in the daily feed by including
the least-disliked sources even if they have crossed the suppression threshold,
rather than returning an empty or near-empty feed. The exact fallback policy is an
implementation decision for the Architect.

### Score ties

Multiple sources may have the same score. The tiebreaker is an implementation
decision (e.g., random shuffle, alphabetical, recency of last feedback). The
behavioral requirement is only that ties are broken deterministically for a given
day so that the feed is stable — running the pipeline twice on the same day
produces the same article order.

### Articles from the same source occupying the top of the feed

If a user's highest-scored source has many articles in the batch, they could end
up ranked consecutively at the top. This may produce a poor experience (the feed
feels dominated by one outlet). Whether to enforce source diversity in the ranked
output (e.g., no more than N consecutive articles from the same source) is an
open question flagged below.

### Feedback given after today's pipeline run

If a user gives feedback after the pipeline has already written today's batch, that
feedback has no effect on today's feed. It will be incorporated in tomorrow's
pipeline run. This is acceptable and requires no special handling — it is a direct
consequence of the "once-daily batch" product philosophy.

---

## User Impact

**Who is affected**: All returning users who have given at least some like/dislike
feedback. New users with no feedback history are unaffected — their experience is
identical to today.

**How they are affected**: Returning users will notice, over time, that the feed
feels more relevant. Sources they enjoy appear more prominently; sources they
find uninteresting drift toward the bottom or disappear entirely. The effect grows
stronger as more feedback accumulates. The experience improvement is gradual and
passive — the user does not need to take any new action; their existing feedback
history begins working for them automatically once this feature ships.

The filter bubble prevention mechanism ensures that users are not completely
isolated from new content, preserving the serendipity that is part of the Daily
Digest value proposition.

---

## Open Questions

1. **Pipeline architecture — per-device batches vs. API-time ranking.** The product
   owner prefers personalization at pipeline time, but the current pipeline writes
   a single shared batch file. How does the pipeline discover which device IDs to
   generate ranked batches for? Does it read all distinct device IDs from the
   Postgres feedback table? What is the performance implication as the number of
   devices grows? The Architect must decide the approach and document the tradeoffs.

2. **Suppression threshold values.** What minimum dislike ratio and minimum event
   count should trigger suppression? These numbers have a direct effect on user
   experience and should be validated against real usage patterns before being
   treated as permanent. Should they be configurable constants (like the article
   count cap in BRD-001) rather than hardcoded?

3. **Source diversity cap.** Should the pipeline enforce a maximum number of
   consecutive or total articles from the same source in the ranked feed, even if
   that source has the highest score? This prevents the feed from feeling dominated
   by a single outlet. The PM should weigh in before the Architect specifies ranking
   logic.

4. **Exploration budget placement.** Should exploration slots be placed at specific
   positions in the feed (e.g., position 3, 10, 17) or distributed randomly within
   a range? The product owner should confirm the intended discovery experience.

5. **Suppression reversal as a user-facing feature.** If a source is suppressed, can
   the user ever get it back without a support intervention? Is there a "reset
   personalization" action planned? This BRD defers this to a future milestone but
   the data model must not foreclose it. The PM should note it on the roadmap.

6. **Source identity: name vs. slug.** The feedback records store `articleId` values
   like `bbc-news-a1b2c3d4`, where the prefix is the source slug. The scoring logic
   must reliably extract and match source slugs. The Architect should confirm whether
   `sourceName` on the Article type or the slug prefix on the article ID is the
   correct join key, and ensure consistency in the data model.

---

## Related Documents

| Document | Location |
|----------|----------|
| Prior BRD — Article Feed | `agents/ba/requirements_article_feed_v1.md` |
| Prior BRD — Feedback Capture | `agents/ba/requirements_feedback_capture_v1.md` |
| Prior BRD — Server Feedback Storage | `agents/ba/requirements_server_feedback_v1.md` |
| System Architecture | `agents/architect/ARCHITECTURE.md` |
| Article type definition | `lib/types/article.ts` |
| Source configuration | `data/sources.json` |
