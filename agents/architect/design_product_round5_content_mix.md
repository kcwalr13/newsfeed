# Design — Round 5: Content Mix, Curator Voice & Feel (Product)

**Status:** Plan — ready for implementation
**Author:** Review/PM pass (Cowork), 2026-06-14
**Source:** Kyle's hands-on feedback after using the app. Backlog: `agents/review/REVIEW_TRACKER.md` → ROUND 5.
**Decisions (Kyle):** content mix = **full treatment** (formats + "a place to explore"); curator blurb =
**personalized note that replaces the summary**.

---

## 1. What we're changing & why

Four pieces of usage feedback, in build order (quick foundations first, then the voice, then the headline):

- **A. Scroll restoration (#1):** opening an article then going back (Android swipe-back) returns to the
  *top* of the issue instead of where you were. Fix the feel.
- **B. Paywall / full-text guard (#4):** an Aquarium Drunkard item was paywalled. Don't show items whose
  full text isn't actually available.
- **C. Personalized curator note (#2):** the blurb should *sell the detour* — an editorial, second-person
  note in the companion's voice about why **you** might love this and what taste it invites — not a summary.
- **D. Content-format mix (#3 — THE HEADLINE, Kyle's "biggest and most important"):** an issue should mix
  long reads with short/fun things, potpourri, visual/art items, and occasionally **"a place to explore"**
  — a whole website to wander, not a specific article, with copy that encourages exploration.

**Guiding principle:** a quiet library has oddments and curiosities on the shelf, not just a stack of
4,000-word essays. We already added the right *sources* in Round 3 (Public Domain Review, Colossal,
Bandcamp Daily, Tedium; the Small-Web seeds: Webcurios, Cool Tools, ooh.directory) — they're just being
flattened into "articles." Round 5 gives them their natural shape.

---

## 2. Workstreams

### A. Feed scroll-position restoration  (effort: S–M)
**Problem:** `app/page.tsx` re-runs `fetchFeed()` and flips to `<FeedSkeleton/>` on every mount, so on
back-nav the list unmounts → the page height is 0 when the browser would restore → it lands at top.
`history.scrollRestoration` is unset.

**Approach (anchor by article id, re-order-resilient):**
- Set `window.history.scrollRestoration = 'manual'`.
- On card click (navigate-away), record the clicked article id (and the feed scrollY) in `sessionStorage`
  keyed by `batchDate`.
- **Suppress the skeleton on return:** keep the previous `data` rendered while a background re-fetch runs
  (only show `<FeedSkeleton/>` on the genuine first load), so the DOM height is preserved.
- After the list paints (effect on `status==='success' && data`), if returning from an article, scroll the
  saved **article id's card** into view (fallback to saved scrollY). Anchoring by id survives the per-request
  re-rank (the saved pixel offset could otherwise point at a different piece).
- **Files:** `app/page.tsx` (+ a one-line `scrollRestoration` in `app/layout.tsx`).
- **Acceptance:** open an item from mid-issue, go back → you're returned to that item's position, no top-jump,
  no skeleton flash.

### B. Paywall / full-text guard  (effort: M)
**Problem:** Substack paid posts (e.g. The Honest Broker) and member-only Aquarium Drunkard posts ship only
a teaser in RSS; nothing detects this. `qualityGate.ts` has no body/paywall check; the reader renders a
misleading 1–2-paragraph stub.

**Approach (per-item, phrase-anchored — never per-source):**
- New `lib/utils/paywall.ts` `detectPaywall(bodyText): boolean` — match a small phrase list anchored to
  short trailing lines (like the share-bar heuristic in `bodyClean.ts`): `subscribe to (read|continue)`,
  `this post is for (paid|paying) subscribers`, `members? only`, `become a (paid )?(member|subscriber)`,
  `to continue reading`, `unlock (the|this|full)`. Plus a **min-content floor** as a *secondary* signal —
  **do not** reuse `AESTHETIC_BODY_MIN_CHARS` (300); a legitimately short visual post (workstream D) is not
  paywalled. Phrase-match is primary; length is a weak secondary.
- **Fixed RSS:** after `htmlToPlainText` in `rssAdapter.ts`, if the body is paywall-flagged, drop `bodyText`
  so `fetchMissingBodyText` retries the full page; if it's *still* paywalled/teaser after backfill, **exclude
  the item in assembly before the fixed/discovery slot-fill** (`run.ts`, near `fetchMissingBodyText`) so the
  issue doesn't under-fill.
- **Discovery:** add a `'paywalled'` reason to `ExtractionFailureReason` (`bodyExtractor.ts:6-10`) + the check
  next to the existing `wordCount < 300` gate; discovery already discards on extraction failure.
- **Reader fallback:** in `app/articles/[id]/page.tsx`, show the existing "Read at source ↗" fallback when
  `paragraphs.length < ~3` (or a char floor), not only when fully empty — so a teaser never renders as a stub.
- **Acceptance:** a paywalled/teaser item is excluded from the issue; if one slips through, the reader links
  out rather than showing a stub. A genuinely short *free* visual post is **not** excluded.

### C. Personalized curator note (replaces the summary)  (effort: M)
**Problem:** the card blurb is the raw RSS `description`. The existing `rationaleGenerator.ts` only runs for
the ~2–4 exploration-slot items, sees no taste signal, and shows as a tiny sub-badge line.

**Approach:**
- Add `Article.curatorNote?: string` (`lib/types/article.ts`); confirm it survives `toPublicArticle`.
- New prompt (extend `rationaleGenerator.ts` or add `curatorNoteGenerator.ts`): editorial, persuasive,
  **second person**, companion voice — *why you'll want this and what taste it invites*, NOT a summary.
  Feed it a compact **taste digest**: the user's top concept labels (`getTopConceptNodes`) + a tone
  descriptor from the aesthetic centroid + this article's aesthetic vector. Keep it short (~1–2 sentences).
  For **place/short** items (workstream D), the note leans into invitation ("ten minutes of happy wandering").
- Generate for **all displayed items** (drop the exploration-only filter), at request time in
  `GET /api/feed/today`, and persist via the existing `after()` + `patchBatchArticleFields` cache path so
  subsequent loads are free. The taste model is already resolved in `resolveDisplayedFeed` — **return it**
  from the helper instead of re-querying.
- **Render:** in `ArticleCard.tsx`, the blurb block uses `article.curatorNote ?? cleanDesc(description)`.
- **Acceptance:** every displayed item shows a personalized, persuasive "why this is worth your time" note
  in the companion's voice; the raw RSS summary no longer appears as the blurb; subsequent loads don't
  re-call the LLM.

### D. Content-format mix — THE HEADLINE  (effort: L; phase it)
Add a `format` to every item, guarantee a mix in each issue, and introduce the "place to explore" item type.

- **D1 — Format taxonomy + derivation + mix guarantee.**
  - Add `Article.format?: 'longread' | 'short' | 'visual' | 'potpourri' | 'place'` (`lib/types/article.ts`).
  - Derive at assembly (`run.ts`, alongside `readTime`): `longread` (readTime ≥ ~10 min), `short`
    (has body but readTime small), `visual` (source category ∈ {art, design} or a curated visual set —
    Colossal/Hyperallergic/Dezeen/Public Domain Review), `potpourri` (link-roundup/curio sources — Tedium,
    Cool Tools, Recomendo, Webcurios), `place` (set explicitly by D3). No LLM needed — source allowlist +
    readTime threshold.
  - New `ensureFormatSpread()` in `lib/pipeline/displayDiversity.ts` mirroring `ensureCategorySpread`,
    invoked in `resolveDisplayedFeed` **after** C2/C3. Guarantee e.g. ≥1 short/visual/potpourri and ≤N
    longreads in the displayed 7. Config constants next to `MIN_CATEGORIES_IN_ISSUE`.
  - ⚠️ **Composition risk (R4-14 precedent):** there are now C2 (unfamiliar) + C3 (category) + the
    consecutive-source cap + this new format guarantee competing for 7 slots. Re-prove the cap can't demote a
    format-critical sole representative; run the cap in an order that preserves all floors (the R4-14 fix
    informs this). Each guarantee must degrade gracefully when the pool can't satisfy it.
  - **Acceptance:** a typical issue is not all long-reads — it includes ≥1 short and ≥1 visual/potpourri,
    and the colophon (shared `resolveDisplayedFeed`) stays in sync.
- **D2 — Card variants in `ArticleCard.tsx`.** Branch on `format`: a denser/compact card for `short`/
  `potpourri`; an image-forward card for `visual`. Read-time UI already hides when absent, so these render
  cleanly. Reuse the badge mechanism for a small format tag where it helps.
- **D3 — "A place to explore" item type + sourcing + card + routing.**
  - Sourcing (smallest viable): a curated, committed `data/places.json` of hand-picked sites to wander
    (the seed directories themselves, standout digital gardens, Webcurios/Cool Tools/ooh.directory, a great
    personal blog's homepage). Inject N of them into the candidate pool as `format:'place'` items at
    assembly: `articleUrl` = homepage, no `bodyText`/`readTime`, a bespoke invitation as the note.
  - Card: a distinct "**A place to get lost in**" treatment with an **Explore ↗** CTA (not Pass/Underline/
    Read-later), linking straight to the homepage.
  - **Routing decision (must settle before building):** a `place` item should **not** open the in-app reader
    (it has no body). Either link directly out (target=_blank), or a tiny bespoke "go explore" interstitial.
    Recommend: link straight out.
  - Guarantee ~1 place item every few issues (not every issue) so it stays special.
  - **Acceptance:** occasionally an issue includes a "place to explore" card that links to a whole site with
    an inviting note, and tapping it takes you to the site (not a broken in-app reader).
- **D4 — Editorial framing for short/place (ties to C).** The curator note for `short`/`potpourri`/`place`
  items uses the exploration-inviting register. (Folds into C's prompt.)

---

## 3. Sequencing, cross-cutting, risks

**Order:** A → B → C → D1 → D2 → D3 (→ D4 folds into C). A and B are small daily-feel wins; C establishes the
voice; D is the centerpiece and uses C's voice for its short/place framing. **D is the most important
*outcome*** even though it's sequenced after the cheap foundations — pull it earlier if you prefer.

**Cross-cutting (from the code map):**
- `toPublicArticle` (`app/api/feed/today/route.ts`) is the client-field allowlist — verify new fields
  (`curatorNote`, `format`) survive it.
- `resolveDisplayedFeed` is shared by `/api/feed/today` AND `/api/issue/meta` (R4-01) — adding the format
  reorder there keeps the colophon automatically in sync. Do **not** add reordering in the route.
- The taste model is already resolved inside `resolveDisplayedFeed` and currently discarded after ranking —
  return it for C rather than re-querying.

**Risks:** (1) over-constraining the 7 display slots (C2+C3+format+cap) can make some guarantees no-op —
acceptable if they degrade gracefully, but validate. (2) Paywall exclusion must happen before slot-fill or
the issue under-fills. (3) `place` items break reader assumptions — settle routing first. (4) Per-issue LLM
cost rises with C (curator note for the displayed 7) — bounded + cached via `after()`.

**Out of scope:** multi-modal (audio/video) items; a full CMS of place metadata; semantic-wandering graph
traversal (still a future-vision item).
