# Design — Round 7: Agentic One-Off Discovery (personal "best of the internet" engine)

**Status:** Plan — ready for implementation (rev 2, 2026-06-23 — supersedes the RSS-palette rev 1)
**Author:** Review/PM pass (Cowork), 2026-06-23
**Source:** Kyle, after extended use: the feed is *"still just long articles in a similar pattern."* He wants a wide
variety of item **types** AND, critically, **truly unique one-off items** — e.g. `https://www.moltbook.com/`, an
interesting standalone site that is *not* an ongoing content source, surfaced as a single item in his digest.
**"A mix of the best of the things on the internet, not just straight articles every day. It specifically shouldn't
be an aggregator of just other sources."**

**Decisions (Kyle, scoping Q&A 2026-06-23):**
- **Scope is now definitively PERSONAL, single-user, forever.** No multi-user, no extensibility-for-others.
- **Types (all four families):** music & audio, websites/web-toys/games, video & clips, threads & finds.
- **Mix = rebalance hard** — cap articles (≤3/issue), guarantee varied types.
- **Curation = blend** — a curated base + a "what's good right now" wildcard pulse.
- **Discovery = blend: index-mining + LLM agentic hunt** — mine the human link-collections where gems get shared
  for their **outbound links**, plus an LLM layer that proposes obscure finds and **verifies each is real/live**.
- **Drop content feeds entirely.** The digest is built from agent-discovered **one-off items**, not subscriptions.
  RSS/index pages are at most a *crawl seed* for harvesting outbound destinations — never a feed-of-items.

Backlog: `agents/review/REVIEW_TRACKER.md` → ROUND 7. (Rev 1's "tagged RSS source palette" approach is retired:
it was, underneath, an aggregator-of-sources — exactly what Kyle is rejecting. moltbook has no feed.)

---

## 0. The reframe

Tangent stops being a **feed reader** and becomes a **discovery agent**: each day it hunts down a handful of
individual remarkable things from anywhere on the internet and assembles them into a small digest. **The unit is the
*find*, not the source.** An index like Hacker News, are.na, or r/InternetIsBeautiful is mined for the **outbound
links it points at** (moltbook is what Webcurios *linked to*) — the index's own posts never become items.

This is **Pillar 1 of the original vision** ("Agentic Web Discovery from the Small Web / IndieWeb"), which the
current app under-built and then strangled with an essay-only quality gate. Round 7 resurrects and generalizes it to
every content type and orients it around **one-off gems + novelty** rather than recurring sources.

**What this retires:** `data/sources.json` as the digest's content supply, the RSS-feed ingestion path as the
primary pipeline, and the essay-only evaluator as the universal gate.
**What survives (from rev 1 / Round 5):** the `place`-style **link-out item** pattern (no body/reader/LLM
enrichment; curator note as blurb; links straight out), the generalized **content-type** item model, **type
cards**, and the **hard-rebalance mix**.

---

## 1. Personal-use scope lock (what it simplifies)

Single-user forever changes the economics and removes whole categories of work:

- **One global taste model.** No per-user isolation, no privacy walls, no identity abstraction to maintain. Keep the
  existing `userId`/`deviceId` plumbing as-is (harmless), but **stop designing for expansion** and **permanently
  close the "Future state — multi-user rollout" / DEFERRED backlog** in the tracker.
- **Be opinionated.** Hardcode to Kyle's taste; use his accounts/keys freely; no generalization tax.
- **Economics flip — the big one.** One person, one daily digest of ~7 items means we can **spend a lot of effort
  per item** (fetch + verify + LLM-judge each candidate) to find a *few genuinely great one-offs*, instead of
  cheaply ingesting volume. Quality over throughput becomes the correct trade. The R6 Gemini free-tier limiter +
  wall-clock deadline still bound a run, but personal-use (one cron/day) makes a slower, more thorough hunt fine.
- **R7-1 records the scope decision** in `CLAUDE.md` (Scope section) and adds a note to
  `agents/ba/vision_discovery_companion.md` that the product is deliberately broadened from "evergreen essays" to
  "agent-discovered best-of-the-internet, one-off gems," personal-use only.

---

## 2. Generalized item model (unchanged from rev 1)

Add a first-class content type; non-article items are link-out (the `place` pattern).

```ts
// lib/types/article.ts
export type ContentType = 'article' | 'music' | 'video' | 'website' | 'thread' | 'find';
export interface Article {
  // … existing …
  contentType?: ContentType;        // default 'article' (back-compat)
  media?: ItemMedia;                // thumbnailUrl?/embedUrl?/durationSec?/creator?/platform?/score?
  discoverySource?: string;         // provenance: which index/stream found it (telemetry only, NOT shown as a "source")
}
```

- `place` → `contentType:'website'` (keep `data/places.json` as a hand-seed; loader becomes type-aware).
- Non-article items: no `bodyText`/`readTime`/reader; `curatorNote` is the blurb; `media.thumbnailUrl` the image;
  card links straight out.
- `toPublicArticle` allowlist gains `contentType` + `media`.

---

## 3. The discovery engine (the heart)

A **candidate-generation → funnel → assembly** pipeline. Replaces feed ingestion. Lives in `lib/discovery/`
(extends the existing Brave + Small-Web scaffolding).

### 3a. Candidate streams (produce a large pool of one-off URLs per run)

1. **Index/link-collection mining (the reliable base).** Crawl a curated, rotating set of *gem-index pages* and
   harvest their **outbound destination links** (discard the index's own chrome/self-links). Seed list in a new
   `data/discovery_indexes.json` (Kyle curates): Hacker News (front page + Show HN), are.na (channels/blocks),
   r/InternetIsBeautiful + a curated subreddit set (top/links), Webcurios, Kottke, Waxy links, ooh.directory,
   Marginalia, "awesome-X" GitHub lists, IndieWeb blogrolls/webrings. These pages are read **as crawl seeds** (HTML
   or their API) purely to extract outbound URLs — they are *not* feeds-of-items. Naturally yields multi-type
   candidates (a subreddit points at music/sites/threads; HN at sites/tools; are.na at anything).
   **Curate BROADLY and eclectically — the named platforms (Reddit, YouTube, etc.) are illustrative, not a required
   set (Kyle, 2026-06-23).** Reddit specifically is optional and not important (and 403s from datacenter IPs, §9);
   the engine should range across all sorts of gem-indexes (newsletters' link sections, "X of the day" sites,
   webrings, curated GitHub awesome-lists, museum/archive collections, niche directories, personal blogrolls, etc.)
   rather than over-fit to any one platform. Breadth of *kinds of places* is a feature; keep adding new index kinds.
2. **LLM-proposed gems (the agentic wildcard layer).** Per rotating theme/interest (drawn from Kyle's taste
   profile + structured randomness), prompt the LLM to propose lesser-known, genuinely interesting **destinations**
   across the type families. **Every proposed URL is fetched and verified** (§4) before it can advance — the model
   hallucinates URLs and skews popular/stale, so verification is load-bearing. This is where true wildcards
   (moltbook-class) come from.
3. **Creative web search (Brave, already integrated).** Rotating evocative queries ("strange beautiful websites,"
   "best new ambient release," "web toy of the month"). Skews mainstream/SEO → weighted lower, leans on the §4
   quality judge.
4. **Graph-follow (Small-Web traversal).** From a verified gem, follow its outbound / "links" / blogroll page to
   adjacent gems. Cheap amplifier on a good find.

### 3b. The funnel (candidate URL → eligible item) — cheap rule-filters first, LLM last

- **Dedup + permanent novelty memory.** A persistent store (DB) of every URL + domain ever surfaced or seen, with a
  long lookback, so **nothing repeats** and it always feels fresh. Extends the existing
  `novelty.ts`/`loadSeenSourceDomains` to item-URL granularity and makes it durable.
- **Liveness / realness verification (rule-based, no LLM).** Fetch each surviving candidate: confirm it's a real,
  working page — not 404 / parked-domain / login-wall / obvious SEO-farm / placeholder. Mandatory for stream 2.
- **Type classification (rule-based).** Detect `contentType` from URL + page signals (youtube/vimeo → `video`;
  bandcamp/spotify/soundcloud → `music`; reddit/HN → `thread`; a commerce/product page → `find`; long prose →
  `article`; else → `website`). Sets the card + which enrichment runs.
- **Interestingness / taste judgment (LLM — the one expensive step, type-aware).** A single LLM call per surviving
  candidate: *"Is this a genuinely interesting, surprising, worth-Kyle's-time one-off — not generic, not spam, not
  just popular?"* → a 1–5 score + one-line reason, **with type-appropriate criteria** (a web toy isn't judged on
  prose), **fed Kyle's taste profile** for fit. **Replaces the 5 essay dimensions.** Gated by the R6 Gemini limiter;
  run only on the top-K rule-survivors needed to fill the digest + a buffer (budget control, §7).
- **Safety/quality filters.** NSFW / spam / malware-ish / dead / hard-paywall guards before an item can be shown.

### 3c. Assembly

Survivors (with scores + types) → the **hard-rebalance mix** (§6) → the ~7-item daily digest, written to the batch
exactly as today (the storage/feed layer is unchanged; only the *supply* changed).

---

## 4. Quality, verification & safety (the genuinely hard part)

Agent-discovered, one-off content has no "trust the source" backstop, so the funnel's guards are load-bearing:

- **Hallucinated/dead URLs (stream 2)** — every LLM-proposed URL is fetched; non-200 / parked / empty → dropped. Never
  surface a URL the engine hasn't successfully loaded.
- **Spam / SEO sludge / content farms** — cheap heuristics (domain reputation lists, ad-density, boilerplate) + the
  LLM interestingness judge, which is explicitly told to reject generic/SEO/AI-slop pages.
- **NSFW / unsafe** — a safety check before display; when unsure, drop (a personal digest should never surface
  something jarring).
- **Prompt-injection invariant** — any fetched page text sent to the interestingness judge or curator-note generator
  is wrapped with `UNTRUSTED_CONTENT_NOTICE` + `wrapUntrusted(...)` (R2-M4), same as the existing in-app LLM sites.
  This matters *more* now: we're feeding the LLM arbitrary discovered web pages.
- **Graceful degradation** — if a run finds too few verified gems (slow rate / thin crawl), the digest is smaller
  rather than padded with junk; the batch always writes (R6 deadline). A short digest of real gems beats a full one
  of filler.

---

## 5. Cross-type taste (personal, simple v1)

The 6-dim prose-tone model applies only to `article`s. For everything else:

- **One global profile** (personal-use). Track like/skip/save/dwell **per `contentType`** and per domain.
- **Per-type affinity** nudges discovery + ranking (types/domains Kyle engages with surface more; ignored ones fade,
  never to zero — keep serendipity). Feeds the LLM interestingness judge as context ("Kyle leans toward X, away
  from Y").
- **Cheap tags** (domain, type, detected topic) into the concept graph — no essay concept-extractor needed.
- Honest: v1 = *variety that slowly tilts toward what he likes*, not a precise multi-modal taste engine. Expect to
  iterate after he lives with it. Don't over-filter early.

---

## 6. Hard-rebalance mix + cards + curator notes (kept from rev 1)

- **Mix assembler** (`ensureTypeSpread` in `displayDiversity.ts`, composed in `resolveDisplayedFeed`): cap articles
  (`MAX_ARTICLES_IN_ISSUE`=3), guarantee ≥`MIN_DISTINCT_CONTENT_TYPES_IN_ISSUE`=4 types, and a wildcard slot for the
  agentic/LLM-found gem. **Re-prove composition by the R5-D1 simulation harness** (with C2/C3 + the source cap;
  graceful degradation). Don't ship on a green build alone.
- **Link-out cards** per type in `ArticleCard.tsx` (music: cover + artist + Listen ↗; video: thumb + duration +
  Watch ↗; website: the existing "place to get lost in" card; thread: platform + score + Read the thread ↗; find:
  image + Check it out ↗). All link straight out; none open the in-app reader (only `article` does). **Every link-out
  card MUST carry the standard feedback row (dislike/like/save) alongside its CTA — never a feedback-less card again
  (§10a); the R5 `place` card omitted it and that's reversed.**
- **Curator note** (R5-C) extends to every type with a type-aware register; folds into the existing generator.

---

## 7. Budget reality (free-tier bounded)

This is heavier per item than feed-ingestion (fetch + verify + judge). Bound it:
- **Cheap rule-filters first** (dedup, liveness, type) prune the pool with **zero LLM**; spend the LLM
  interestingness judge only on the **top-K survivors** needed to fill ~7 slots + a small buffer.
- The **R6 shared Gemini limiter (~15 RPM ceiling) + wall-clock deadline** already protect the daily cron; the
  candidate-pool size and K are provider-aware knobs (like `DISCOVERY_MAX_EVAL_CANDIDATES` today).
- Personal-use = **one run/day**, so a thorough, slightly slow hunt is fine. Avoid gratuitous `forceOverwrite`
  refreshes (each re-spends the daily cap).

---

## 8. Workstream / sequencing

Ordered so the digest **becomes one-off gems fast**, then gains wildcards, types, mix, and taste.

- **R7-1 — Personal-use scope lock + item model.** Close multi-user scope (CLAUDE.md + vision-doc note + close the
  DEFERRED tracker section); add `ContentType`/`ItemMedia`/`discoverySource` to `Article` (prose fields optional);
  migrate `place`→`website`; generalize `toPublicArticle`. **Behavior-preserving** (no supply change yet); gate green.
- **R7-2 — Discovery engine v1: index-mining + the funnel.** New `lib/discovery/` candidate stream that crawls
  `data/discovery_indexes.json` gem-indexes and harvests **outbound links**; the funnel's **rule-filters**
  (permanent novelty/dedup memory [new DB table], liveness/realness verify, type classify); produce link-out
  **website + thread** items; **retire `data/sources.json` as the digest supply.** Link-out cards.
  **This is the milestone where the digest becomes one-off gems (moltbook-class), not feed articles.**
- **R7-3 — LLM agentic stream + interestingness judge.** Add stream 2 (LLM-proposed gems, per rotating theme) with
  **fetch-and-verify**, and the **type-aware interestingness/taste judge** that replaces the essay evaluator + the
  safety/spam/NSFW guards (§4). Adds true wildcards + the real quality bar.
- **R7-4 — Multi-type coverage (music + video + finds).** Type detection + enrichment + cards for `music`/`video`/
  `find`; ensure the streams surface them (music/video indexes, LLM hunt, search) — **discovered, not fed**.
- **R7-5 — Hard-rebalance assembler.** `ensureTypeSpread` + caps/floors + per-type candidate targets; compose in
  `resolveDisplayedFeed`; **re-prove by the R5-D1 simulation harness.** Delivers "every issue is a varied mix."
- **R7-6 — Cross-type taste v1 + creative search + graph-follow + polish.** Per-type affinity tracking + judge
  context; add streams 3 & 4; per-type curator-note registers; the curated/wildcard blend guarantee.
- **R7-7 — (Optional, phase 2)** richer media/embeds (Bandcamp/YouTube players), deeper agentic crawling, true
  platform-trending via APIs, within-type taste (genre/creator). Defer; the round delivers full value without it.

---

## 9. Risks & caveats

- **Quality control is now the whole game.** With no trusted feeds, the funnel's verify/judge/safety guards are
  load-bearing — a weak judge = a junky digest. Invest the per-item LLM spend here (personal-use affords it).
- **Hallucinated/dead URLs** from the LLM stream — mandatory fetch-verify; never surface an unloaded URL.
- **Prompt-injection surface grows** — we now feed the LLM arbitrary discovered pages; the `wrapUntrusted` fence is
  non-negotiable on every such call.
- **Index pages move/break** — crawl them best-effort with per-source isolation (`allSettled`); a dead index never
  thins the digest below real gems.
- **Cross-type taste is coarse in v1** — expect iteration; favor variety over precision at first.
- **Over-constrained mix** — article cap + type spread + wildcard + C2/C3 + novelty compete for 7 slots; each must
  degrade gracefully — validate with the simulation harness, not a green build.
- **"Finds/deals" commercial drift** — curated cool-things only, no affiliate links / transactional scraping; lowest
  priority, easy to cut.
- **Latency/budget** — heavier per item; bounded by cheap-filters-first + top-K LLM + the R6 limiter/deadline + one
  run/day.

---

## 10. Feedback → taste loop (the unit you *teach*, not just the unit you read)

Two gaps surfaced in use (Kyle, 2026-06-23, after a seeded `place` gem — ciechanowski — landed and delighted him):

**(a) Link-out items have no feedback controls — near-term fix, fold into R7-2(d).** The R5 `place` card renders only
"Explore ↗"; there is no dislike/like/save row, so a genuinely loved gem can't be rated. That was a defensible R5
call (a place was a rare side-curiosity) but it's now actively harmful: these gems are the **main event**, and the
taste model can only learn "find more of *that shape*" if the shape can be rated. **Fix:** every link-out card carries
the standard feedback row alongside its CTA (the existing `lib/feedback/store` + `/api/feedback` path already update
centroid/concepts/Wilson). Re-include link-out items in the like/dislike signal (they stay out of the *read*-count —
not "read," but rateable). **Build it into the new link-out cards from the start so the no-feedback decision never
propagates,** and sequence it **before R7-5** (taste learning) so there is signal to learn from. Without this, the
items Kyle cares most about are exactly the ones the model is blind to.

**(b) Rich feedback → taste (R7-8) — decided shape (Kyle, 2026-06-23): "quick by default, optional depth,"** capturing
**shape/format · style/voice/craft · topic · a free-text "why."** Today's like/dislike/save is too coarse to tell
"I love this *because* it's interactive/explorable" from "I love the topic." For an app of one, richer feedback is
*signal we want*, not friction to minimize.
- **UI:** one-tap dislike/like/save stays the zero-friction default; a subtle "why?" / expand affordance reveals an
  optional panel — quick **chips** for shape/style/topic (a fixed palette + per-item LLM-suggested chips) and a
  **free-text "why"** box. Never required; depth is opt-in, per item.
- **Data:** extend the feedback record (new migration) with optional, nullable `aspects` (shape/style/topic tags,
  JSONB) + `note` (free text). The `like|dislike|save` verb is unchanged → backward-compatible.
- **Taste integration (the powerful part):** the free-text "why" is **LLM-distilled** (`wrapUntrusted`) into
  concept-graph tags + aesthetic-dimension nudges — Kyle literally says *why* and the model updates. Structured chips
  feed a new **shape/style affinity** axis so the model learns "loves interactive, hand-built, explorable sites" as a
  *shape-level* preference independent of topic — exactly the ciechanowski/moltbook generalization. Extends Pillar 2
  (latent aesthetic space → +shape/style axes) and Pillar 3 (graph memory → an LLM-in-the-loop "why" distiller).
  Personal-use makes the heavier UI + a per-detailed-feedback LLM call a feature, not a cost.
- **Sequence:** land R7-8 with/just before **R7-5** so cross-type taste consumes the richer signal from day one.

**Out of scope:** in-app media playback beyond simple embeds; a CMS for index curation (seeds stay in
`data/discovery_indexes.json` + `data/places.json`); multi-user anything (now permanently out of scope).
