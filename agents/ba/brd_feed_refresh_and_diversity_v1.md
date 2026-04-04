# BRD-005: Manual Feed Refresh and Source Diversity Guarantee

| Field | Value |
|-------|-------|
| **ID** | BRD-005 |
| **Title** | Manual Feed Refresh and Source Diversity Guarantee |
| **Date** | 2026-04-04 |
| **Status** | Draft |
| **Milestone** | Milestone 5 — Feed Refresh and Diversity |
| **Depends On** | BRD-001 (core pipeline), BRD-004 (feed personalization, shipped) |

---

## Problem Statement

The content pipeline runs once per day on an automated schedule. Users have no way
to request a fresh batch of articles outside of that window. If a user opens the app
mid-day and wants updated content — for example, because breaking news has occurred
or because they have already read everything in today's feed — they are stuck with
stale content until the next scheduled run.

A second, separate problem exists within each pipeline run itself: there is currently
no guarantee that articles come from more than one source. If one source (e.g., BBC
News or NewsAPI) returns many articles and others fail or return few, a daily batch
could be composed almost entirely from a single outlet. This is poor for content
variety and undermines the multi-source value proposition of the product.

These two problems are related in that the manual refresh request should also
inherit the diversity requirement. Both are addressed here in one BRD.

---

## Goals

- Authenticated users can trigger a new pipeline run on demand via a button in the
  app UI, receiving a fresh set of articles without waiting for the next scheduled run.
- The app makes it clear whether the current feed is up to date or stale (i.e., when
  it was last refreshed).
- Every pipeline run — whether scheduled or manually triggered — guarantees that
  articles in the output batch are drawn from a minimum number of distinct active
  sources.
- If a source fails or returns no usable articles during a run, the pipeline continues
  with the remaining sources rather than aborting the run entirely.
- The number of articles contributed by any single source is capped, preventing one
  source from dominating the batch.

---

## Non-Goals

The following are explicitly out of scope for this BRD:

- **Adding new sources.** The set of active sources remains whatever is configured in
  `data/sources.json`. Source management (adding, removing, toggling sources) is a
  separate future capability.
- **Real-time streaming or live updates.** The pipeline is still a batch process.
  A manual refresh triggers a new batch run; it does not stream articles incrementally.
- **Per-source article count configuration via the UI.** Any cap on articles per
  source is a system-level configuration value, not a user-adjustable setting.
- **Unauthenticated (anonymous) users triggering a refresh.** Manual refresh is
  limited to authenticated users. Anonymous users continue to receive the last
  pipeline output.
- **Scheduled pipeline rate changes.** The once-daily automatic cadence is unchanged
  by this BRD.
- **Notifying the user when a background refresh completes.** Push notifications or
  background refresh indicators are out of scope. The user must manually check for
  new content.

---

## Feature Details

### Manual Refresh Button

A control is added to the feed UI that allows an authenticated user to request a
fresh pipeline run. The expected behavior:

- The button is visible only to authenticated users. Unauthenticated users do not
  see it.
- Tapping the button triggers a new pipeline run and then reloads the feed with the
  results. The user should see a loading state while the run is in progress.
- The pipeline run triggered by the button is the same pipeline that runs on the
  scheduled cadence — the same source fetching, deduplication, personalization, and
  diversity rules apply.
- There must be a cooldown period between manual refreshes to prevent abuse (e.g.,
  a user cannot trigger a new run more than once per some defined window). The exact
  cooldown duration is an open question (see below).
- The UI should communicate when the feed was last refreshed (e.g., "Last updated
  today at 2:34 PM") so the user can make an informed decision about whether to
  trigger a refresh.
- If the pipeline run fails (e.g., all sources are unreachable), the user sees an
  appropriate error message and the existing feed remains visible. The feed must not
  go blank on a failed refresh.

### Source Diversity Guarantee

Every pipeline run must produce a batch that meets minimum diversity requirements:

- At least a configurable minimum number of distinct active sources must contribute
  at least one article to the final batch. The suggested minimum is 2 out of however
  many active sources exist, but the exact value is an open question (see below).
- No single source may contribute more than a configurable maximum number of articles
  to the batch. This cap prevents one high-volume source from crowding out others.
- If a source fails to return any articles (network error, API limit, empty response),
  the pipeline logs the failure and continues. It does not abort the run.
- If — after fetching from all available sources — the diversity minimum cannot be
  met (e.g., only one source returned results), the pipeline should still produce a
  batch from whatever is available rather than producing an empty feed. This
  degraded-but-functional behavior should be logged as a warning for operator review.
- Diversity is measured after deduplication. An article that appears in multiple
  sources counts toward only one source's contribution.

---

## User Impact

**Who is affected:**

- **Authenticated users** gain a new capability: they can actively pull a fresh feed
  rather than waiting for the daily schedule. This is most valuable for engaged users
  who check the app multiple times per day or want to see breaking news reflected
  in their feed immediately.
- **All users** (authenticated and anonymous) benefit from the source diversity
  guarantee, as it ensures the feed consistently represents multiple perspectives
  and outlets rather than defaulting to a single dominant source.

**How they are affected:**

- The on-demand refresh gives power users more control over content freshness without
  changing the experience for casual users who are fine with the once-daily cadence.
- Source diversity makes the feed feel more varied and balanced, which supports the
  core product promise of aggregating across the internet rather than mirroring a
  single outlet.

---

## Open Questions

1. **Refresh cooldown duration.** How long must an authenticated user wait between
   manual refresh requests? Options include 15 minutes, 30 minutes, 1 hour, or a
   fixed number of refreshes per day. The PM should propose a value based on expected
   usage patterns and API cost implications. The cooldown should also be configurable
   (not hardcoded) in case it needs tuning post-launch.

2. **Minimum distinct sources per batch.** The current `data/sources.json` has 4
   active sources (BBC News, Ars Technica, The Verge, NewsAPI Top Headlines). What
   is the minimum number of sources that must contribute articles to a valid batch?
   Suggested default is 2, but the PM should confirm. This value should be
   configurable.

3. **Per-source article cap.** What is the maximum number of articles a single source
   may contribute to one batch? If the batch target is ~20 articles and there are 4
   sources, a naive even split is 5 per source. Should the cap be exactly equal
   (floor divided), or should there be a softer ceiling that allows one source to
   contribute more if others underperform? The Architect will need a clear rule here.

4. **Who can trigger a refresh: all authenticated users or only certain roles?** The
   current auth system supports authenticated users but does not have a role system.
   The assumption in this BRD is that all authenticated users can trigger a refresh.
   If an admin-only or operator-only refresh is preferred, this BRD needs revision.

5. **Interaction with personalization (BRD-004).** A manually triggered run should
   apply the same personalization logic as a scheduled run (source scoring, suppression,
   exploration budget). The PM and Architect should confirm there are no edge cases
   when a manual run and a scheduled run both execute on the same day — for example,
   how are the two resulting batch files stored and which one does the feed serve?

6. **Operator visibility into refresh activity.** Should manual refresh events be
   logged somewhere accessible to the operator (e.g., a simple log entry with
   timestamp and user ID)? This is useful for diagnosing cost spikes. Out of scope
   for this BRD but the PM should decide whether it belongs on the near-term roadmap.

7. **Anonymous user experience during a refresh.** If an anonymous user opens the
   app while an authenticated user has triggered a refresh in progress, do they see
   the old batch or the new one once it completes? The answer depends on how batch
   files are stored per-identity vs. shared — an open question from BRD-004 that may
   resurface here.

---

## Related Documents

| Document | Location |
|----------|----------|
| Prior BRD — Article Feed | `agents/ba/requirements_article_feed_v1.md` |
| Prior BRD — Feedback Capture | `agents/ba/requirements_feedback_capture_v1.md` |
| Prior BRD — Server Feedback Storage | `agents/ba/requirements_server_feedback_v1.md` |
| Prior BRD — Feed Personalization | `agents/ba/brd_feed_personalization_v1.md` |
| System Architecture | `agents/architect/ARCHITECTURE.md` |
| Source configuration | `data/sources.json` |
| Pipeline orchestrator | `lib/pipeline/run.ts` |
