# Design — Round 3: Vision Alignment (Product)

**Status:** Plan — ready for implementation
**Author:** Review/PM pass (Cowork), 2026-06-13
**Implements:** the PM product evaluation. Source of the work items: `agents/review/REVIEW_TRACKER.md` → *ROUND 3 — Product*.
**Vision reference:** `agents/ba/vision_discovery_companion.md`.

---

## 1. Problem statement

Tangent's *taste criteria* are excellent (the LLM editorial bar — substance, originality, cross-disciplinary
appeal, evergreen durability, writing quality — benchmarked to The Browser / Marginalian / A&L Daily; a
six-dimension **tonal** aesthetic model). But the lived product under-delivers the vision on three axes,
and all three trace to the **supply layer**, not the taste model:

1. **Discovery surfaces ~nothing.** The pipeline reserves 6 of 20 slots for discovery
   (`DISCOVERY_ARTICLES_PER_DAY = 6`), but in every observed run discovery contributed **0** — candidates
   fall below `LLM_EVAL_THRESHOLD` (3.5, floor 3.0), Brave yields are thin, and the Small-Web crawl
   under-produces. So ~20/20 articles come from the fixed feeds. The core promise ("find sources you don't
   know") is effectively unmet.
2. **The fixed palette is monochrome.** The 12 fixed sources are the smart science / rationalist /
   econ / philosophy blogosphere. There is **no music, visual art, film, design, or fashion source** —
   even though `lib/discovery/topics.ts` lists all of those as discovery topics.
3. **It leans comforting, rarely surprising.** Ranking is 70% source reputation / 30% taste; exploration
   is 2–6 of 20 slots with a single wildcard, all drawn from the same narrow fixed pool.

The taste-learning machinery (aesthetic EMA, concept graph, drift, blind-spot probe, receptivity) is
sound but only just became functional (Round 1/2 fixes) and is starved of breadth and of early signal.

**Goal of Round 3:** make the *experience* match the *taste* — a feed that is broad, novel, surfaces
unfamiliar sources, leans esoteric/cultural/zeitgeist, mixes culture/music/art/science/opinion, and is
surprising as often as it is comforting — and make the taste model converge faster and observable.

**Guiding principle:** *fix the supply, not the brain.* The model is fine; it is being fed from a narrow pipe.

---

## 2. Workstreams (priority order)

### A. Discovery actually surfaces — *highest leverage*
**Objective:** every run fills its discovery quota with articles from **genuinely unfamiliar** sources,
or logs precisely why it can't.

- **A1 — Hard-floor the discovery quota.** After scoring all candidates, if fewer than
  `DISCOVERY_ARTICLES_PER_DAY` clear `LLM_EVAL_THRESHOLD`, backfill from the next-best by composite score
  down to a `LLM_EVAL_FLOOR` (already exists) — and if *still* short, take the top remaining by composite
  rather than shipping an empty quota. An imperfect discovered piece beats a 7th article from Nautilus.
  Emit a structured yield log: `candidatesFound`, `gatePassed`, `scored`, `slotsFilled`, `belowFloor`.
  *Files:* `lib/discovery/run.ts`, `lib/pipeline/run.ts`, `lib/config/feed.ts`.
  *Acceptance:* on a normal run, discovery contributes `min(6, novelCandidatesAvailable)` articles; the
  log line states the yield; a run that genuinely finds nothing logs at warn/error, not silently.

- **A2 — Strengthen candidate supply.** Confirm the Small-Web crawler (`lib/discovery/smallWeb/*`) actually
  runs in the pipeline and that the seed list is fetched (several seeds are exactly the esoteric vein we
  want — Webcurios, b3ta, Aldaily, Cool Tools, 3QD). Widen Brave (more results per query; rotate the full
  12-topic query bank, not 2). Raise the candidate cap so the gate has real choice.
  *Acceptance:* candidate pool ≥ ~40/run (log it); Small-Web seeds appear among candidates.

- **A3 — Novelty filter (the actual promise).** Before ranking discovered candidates, drop any whose
  registrable domain is in the fixed-source set **or** has appeared in the last `K` issues (K≈14). This is
  what makes discovery surface *unfamiliar* sources rather than re-finding Aeon. Keep a rolling
  `seen_source_domains` view (compute from recent `article_batches`; no new table needed).
  *Acceptance:* discovered articles' domains ∉ fixed set and ∉ last-K-issue domains.

- **A4 — Record yield in batch metadata.** Persist `discoveryCount` and the list of discovered source
  domains on the batch (batch JSON / issue metadata) to power Workstream D.
  *Acceptance:* `/api/feed/today` (or issue meta) exposes discovery count + sources for the day.

### B. Broaden the fixed palette — *do now, don't wait for discovery*
**Objective:** the fixed backbone itself spans the promised domains.

- **B1 — Add 11 verified sources** (table in §3) to `data/sources.json` using the existing schema
  (`slug, name, url, type:"rss", feedUrl, active, category`). All feeds were verified to return RSS/Atom
  on 2026-06-13 (re-verify at build time; the RSS adapter already isolates a dead feed — PIPE-H6).
  *Files:* `data/sources.json`.
  *Acceptance:* `npm run dev` pipeline run ingests articles from the new sources (spot-check 3).

- **B2 — Add `category` to every source** (old + new) — `science | philosophy | ideas | economics |
  psychology | culture | music | art | design | film | literature`. Extend the `Source` type
  (`lib/types/article.ts`) and thread `category` onto `Article` (or resolve via source slug at rank time).
  *Acceptance:* every article can report its source category.

- **B3 — Per-source / per-domain caps for diversity.** With 23 sources, ensure the 14 fixed-pipeline
  articles span many sources and categories (don't let 3 prolific feeds dominate). Tune
  `MAX_ARTICLES_PER_SOURCE` and add a soft per-category cap in selection.
  *Acceptance:* a normal issue's fixed portion spans ≥6 distinct sources and ≥4 categories.

### C. Surprise rebalance
**Objective:** as often surprising as comforting, without making early days feel random.

- **C1 — Adaptive aesthetic weight.** Replace the fixed 0.70/0.30 source/aesthetic blend with a schedule
  that trusts the source early (sparse feedback) and the learned taste later: e.g. aesthetic weight ramps
  `0.30 → 0.50` as `feedback_count` grows past thresholds. Keep the blend-weight startup assertion.
  *Files:* `lib/config/aesthetic.ts`, `lib/pipeline/ranker.ts`.
  *Acceptance:* with 0 feedback, weights ≈ today; with ample feedback, aesthetic ≥ 0.45.

- **C2 — Guarantee unfamiliar-source slots.** Ensure ≥2 of the 7 displayed pieces come from a source the
  user has **never been shown** (prefer discovered/novel; fall back to least-recently-shown fixed source).
  Wire into the exploration assembler / display selection.
  *Acceptance:* the displayed 7 include ≥2 never-before-seen sources whenever the pool allows.

- **C3 — Domain diversity in the issue.** The displayed 7 should span ≥4 categories (no all-science issue).
  Add a diversity constraint to the final display selection.
  *Acceptance:* displayed issues span ≥4 distinct categories whenever the pool allows.

### D. Instrumentation & dashboard
**Objective:** the core promise can't fail silently again.

- **D1 — Metrics computation** (compute on the fly from `article_batches` + `feedback`; **no migration**):
  % discovery vs fixed (today + trailing 7/30d), distinct sources/week, category distribution, exploration
  acceptance rate (probe/stretch/wildcard likes ÷ shown), taste-model maturity (`feedback_count`,
  `is_drifting`, short-term event count).
  *Files:* new `lib/metrics/*` or `lib/db/metrics.ts`.

- **D2 — `GET /api/metrics`** behind the existing solo gate; returns the metrics JSON.
  *Acceptance:* returns well-formed metrics; cheap (projected SQL, not full-batch reads).

- **D3 — `/dashboard` page** in the editorial style: discovery-share gauge, sources-this-week, category
  bar, exploration-acceptance, taste-maturity. Server component reading D1 directly (or D2).
  *Acceptance:* renders the five metrics; reachable from the account menu / colophon.

- **D4 — (Optional) daily metrics snapshot table** for trend lines — **migration → `BLOCKED-ON-APPLY`**.
  Defer unless trends are wanted; D1–D3 work without it.

### E. Onboarding taste calibration (cold-start) — *largest lift, do last*
**Objective:** cross the model's ≥3-signal thresholds on day one so "it learns me" is true immediately.

- **E1 — Calibration set.** ~16 deliberately contrasting sample pieces spanning categories *and* tonal
  poles (contemplative↔propulsive, playful↔serious, specialist↔generalist, etc.) — drawn live from the
  first assembled batch (preferred; always fresh) or a small committed seed file as fallback.

- **E2 — First-run flow.** A calibration UI (title · dek · source · category) with like / pass, and an
  optional tone preference. Gated by the existing `tangent_onboarding_dismissed` localStorage flag.
  *Files:* `app/onboarding/*` or a modal; `app/components/*`.

- **E3 — Seed the model.** Feed calibration responses through the existing feedback path so the aesthetic
  EMA, concept graph, and source Wilson scores are populated — pushing `feedback_count` and short-term
  event counts past the `SHORT_TERM_MIN_EVENTS = 3` / receptivity `≥3` thresholds before the first real
  issue. Reuse the `feedback` table (**no migration**).
  *Acceptance:* completing onboarding yields a non-trivial aesthetic centroid + ≥3 short-term events; the
  first post-onboarding issue is visibly shaped by the choices.

---

## 3. Verified source additions (curated 2026-06-13)

All feed URLs returned valid RSS/Atom (`application/rss+xml` or `application/xml`) when checked, except
where noted. Bold & eclectic per the brief; re-verify at build time (the adapter isolates dead feeds).

| slug | name | category | feedUrl | note |
|------|------|----------|---------|------|
| the-quietus | The Quietus | music | https://thequietus.com/feed | ✓ esoteric music/culture |
| aquarium-drunkard | Aquarium Drunkard | music | https://aquariumdrunkard.com/feed | ✓ crate-digging/eclectic |
| the-honest-broker | The Honest Broker | music | https://www.honest-broker.com/feed | ✓ Ted Gioia, music+culture crit |
| bandcamp-daily | Bandcamp Daily | music | https://daily.bandcamp.com/feed | ✓ returned content — re-verify type |
| colossal | Colossal | art | https://www.thisiscolossal.com/feed | ✓ visual art |
| hyperallergic | Hyperallergic | art | https://hyperallergic.com/rss | ✓ art criticism |
| dezeen | Dezeen | design | https://www.dezeen.com/feed | ✓ design/architecture |
| senses-of-cinema | Senses of Cinema | film | https://www.sensesofcinema.com/feed | ✓ film essays |
| public-domain-review | The Public Domain Review | culture | https://publicdomainreview.org/rss.xml | ✓ esoteric history/curiosities |
| paris-review | The Paris Review | literature | https://www.theparisreview.org/blog/feed | ✓ literary |
| tedium | Tedium | culture | https://tedium.co/feed | ✓ esoteric internet/tech history |

Dropped after verification: It's Nice That, MUBI Notebook, Dirt, Places Journal (all returned empty),
Real Life Magazine (live feed but the publication is defunct), MetaFilter, The Creative Independent (empty).
This takes the fixed palette **12 → 23** and adds music ×4, visual art ×2, design/architecture ×1, film ×1,
literary ×1, esoteric/zeitgeist ×2.

Existing-source categories to backfill (B2): Quanta=science, Aeon=philosophy, Nautilus=science,
Astral Codex Ten=ideas, Ribbonfarm=ideas, LessWrong=ideas, Marginal Revolution=economics,
The Marginalian=culture, Psyche=psychology, The Baffler=culture, Noema=ideas, Works in Progress=science.

---

## 4. Sequencing, dependencies, verification

**Order:** A → B → C → D → E (priority + dependency). B is independent and can land first for instant
visible breadth; A is the highest-leverage; C depends on B2 (categories) + A3 (novelty); D depends on A4 +
B2; E depends on the feedback path (unchanged) and benefits from B (breadth in the calibration set).

**Per-item:** follow the standard campaign workflow (atomic commit, gate `tsc + lint + build` green,
push). DB-schema items (only D4, optional) go through `BLOCKED-ON-APPLY`. Everything else is config/logic/
UI with no migration.

**How to verify product impact (not just the gate):** after A+B land, trigger a refresh and confirm the
new batch (a) draws from ≥10 distinct sources across ≥5 categories, (b) includes ≥3 articles from sources
not in the original 12, and (c) the discovery yield log shows a filled quota. After C, confirm the
displayed 7 span ≥4 categories and include ≥2 unfamiliar sources. After D, the dashboard reports these
numbers. After E, completing onboarding produces a measurable centroid + ≥3 short-term events.

**Risks / watch-items:**
- A1's backfill must not let low-quality items through indefinitely — keep `LLM_EVAL_FLOOR` as a real
  floor; "fill the quota" means *down to the floor*, then top-by-composite only as a last resort, logged.
- A2 must respect the wall-clock budget (DAT-H2) — more candidates × sequential body+LLM could blow 300s;
  R2-18 made the eval loop concurrent, so keep it bounded.
- C1 must not make early issues feel random — ramp aesthetic weight *up* with maturity, not down.
- B1 feeds vary in quality; rely on the LLM editorial bar + per-source Wilson score to self-correct.

**Out of scope (future):** multi-modal discovery (audio/video), semantic-wandering graph traversal
(vision §"semantic wandering"), embeddings/pgvector ranking, and any multi-user concern (see
*Future state — multi-user rollout*).
