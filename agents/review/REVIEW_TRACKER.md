# Review Remediation Tracker

Source of truth for the code + UX/UI review remediation campaign. Every Claude Code
session reads this file, picks the next `TODO` in order, fixes it, and updates this file
**in the same commit** as the fix. If a session dies mid-way, the next one resumes from here.

Full findings report (authored 2026-06-12): `Tangent_Code_and_UX_Review.docx`
(in Kyle's Cowork outputs folder — not in this repo). All findings are reproduced below
so this tracker is self-contained.

---

## Campaign policy (decided by Kyle)

- **Scope:** the entire report — all findings — in the report's fix-order (Now → Next → Later).
- **Git:** **one atomic commit per finding**, and **push after each commit**. Commit message
  format: `fix(<ID>): <short summary>`. Each push triggers a Vercel deploy used for live
  re-validation — so the verification gate below **must be green before every push**.
- **Autonomy:** proceed autonomously using the report's recommended fix on every item, and
  **record the decision** in the Decisions Log (below) for any item that involved a judgment
  call. Do **not** stop to ask Kyle except for the hard guardrails below.
- **Tracker:** this file (`agents/review/REVIEW_TRACKER.md`), git-tracked.

### Hard guardrails (the only things to stop / not do autonomously)
- **Never run destructive or schema-changing SQL against the live Neon database.** Write a new
  numbered migration file under `lib/db/migrations/` and mark the finding `BLOCKED-ON-APPLY`
  with the exact SQL + apply instructions in Notes. Applying to Neon is Kyle's manual step.
- **Do not push code that hard-depends on an unapplied migration.** For DB-schema findings,
  make the code backward-compatible (idempotent / `IF [NOT] EXISTS` / `COALESCE` / guarded), or
  hold the dependent code change until Kyle confirms the migration is applied. A broken schema
  dependency would break the live deploy on push.
- **Do not weaken or remove security controls**, change access scopes, or commit secrets.
- If a finding is **already fixed** in the current code, mark it `DONE` with a note "already
  resolved — verified by reading X" and move on. Re-confirm every finding against the code
  before changing anything; the report may be slightly stale.

### Per-finding workflow (the loop)
1. Open this tracker, find the **first** finding with Status `TODO` in document order.
2. Set it `IN-PROGRESS` (commit not required for this flip; just edit locally).
3. **Re-confirm** the issue by reading the cited files. If already fixed → `DONE` + note, skip to 1.
4. Implement the **minimal** fix. No unrelated refactors. Touch only what the finding needs.
5. **Verification gate (all must pass):** `npx tsc --noEmit` && `npm run lint` && `npm run build`.
   Add a targeted check where it makes sense (a script run, a curl against `npm run dev`, etc.).
6. Update this tracker: flip to `DONE`, fill Commit (leave as `pending` — see below), Notes
   (what changed, files, how verified, any follow-up), and append a Session Log entry.
7. **Commit** fix + tracker together: `fix(<ID>): <summary>`. Then **push**. Then edit the
   tracker's Commit field to the real hash in the *next* commit's tracker update (or amend).
8. A finding that is `DONE` + committed + pushed is a **safe stopping point.** Repeat from 1.

### Running low on session budget?
Finish the current finding cleanly (or revert it so the tree is clean), ensure the tracker is
committed and pushed, then print a final line: `RESUME AT: <next TODO ID>`. Never leave a
half-applied fix uncommitted.

### Status legend
`TODO` · `IN-PROGRESS` · `DONE` · `BLOCKED-ON-APPLY` (migration awaiting Kyle) ·
`BLOCKED` (needs Kyle decision/info) · `SKIPPED` (with reason) · `VERIFIED` (Kyle + reviewer signed off)

### Verification commands
```
npx tsc --noEmit      # typecheck (no dedicated script; tsconfig.json present)
npm run lint          # eslint
npm run build         # next build — must succeed before any push
npm run dev           # for manual/browser spot-checks
```

---

## Progress summary

- Total findings: 47 (+ cross-referenced duplicates noted inline)
- DONE: 3 · IN-PROGRESS: 0 · BLOCKED-ON-APPLY: 2 · BLOCKED: 0 · TODO: 42
- Current branch expected: `main` · Last resume point: PIPE-H1

---

## TIER 1 — NOW (restore the core product)

- [x] **DAT-C1** · 🔴 Critical · Discovery dead in prod: load-time write to read-only FS throws
  - Where: `lib/discovery/queryBank.ts:18-21` (the un-try/caught `fs.copyFileSync`), `lib/discovery/run.ts:183-184`, fallback at `lib/pipeline/run.ts:248-252`
  - Fix: never write in the load path. If `query_banks.json` is absent, read `query_banks.default.json` straight into memory. Move the rotation cursor out of `query_rotation_state.json` into Postgres (small table) so it persists and never writes to disk in prod.
  - Verify: after deploy, the feed contains discovered / Small-Web sources (not only Nautilus/ACX/Quanta/Aeon); rotation cursor advances across runs.
  - Status: BLOCKED-ON-APPLY · Commit: 651c62f (+ lint baseline 05dac66) · Notes: Code fix complete and deploy-safe.
    `loadQueryBanks()` is now read-only (tries `query_banks.json` → `query_banks.default.json` →
    built-in `DISCOVERY_TOPICS` queries; never copies/writes). Rotation cursor moved to Postgres
    table `query_rotation_state` (migration `015_query_rotation_state.sql`); `loadRotationState`/
    `saveRotationState` are async and degrade gracefully (log + empty Map / no-op) until the
    migration is applied, so the deploy does NOT hard-depend on it. The critical prod-crash fix is
    live regardless; only cursor persistence waits on migration 015. Verified: tsc + lint + build
    green. Live re-validation after deploy: feed should again contain discovered/Small-Web sources.

- [x] **DAT-C2** · 🔴 Critical · NULL-keyed upserts never converge (NULL ≠ NULL in UNIQUE)
  - Where: `lib/db/aesthetics.ts:188-198`, `lib/db/concepts.ts:19-47`, `lib/db/blindSpots.ts:81-88`, `lib/db/discovery.ts:62-67`; constraints in migrations `009`,`010`,`011` + `discovery_topic_weights`
  - Fix: new migration recreating the unique constraints as `UNIQUE NULLS NOT DISTINCT (...)` (Neon/PG≥15) **after de-duplicating existing rows**, or sentinel `user_id=''`. Also add `ORDER BY updated_at DESC` to the `LIMIT 1` profile read in `aesthetics.ts:123-136`.
  - ⚠️ DB-schema + requires de-dup → write migration file, make reads defensive, mark `BLOCKED-ON-APPLY`, give Kyle the de-dup + constraint SQL.
  - Verify: a repeated like updates one profile row (feedback_count increments) instead of inserting duplicates.
  - Status: BLOCKED-ON-APPLY · Commit: ff5ccef · Notes: Migration
    `016_nulls_not_distinct_unique.sql` written: de-dups all five identity tables
    (keep-newest for full-state tables, SUM-merge for concept/edge increments, keep-oldest +
    reconstructed probe_count for blind_spot_clusters), then drops the old unique constraints
    (catalog-driven, name-agnostic) and recreates them as `UNIQUE NULLS NOT DISTINCT`. Code
    change: anonymous profile read in `aesthetics.ts` now `ORDER BY updated_at DESC LIMIT 1`
    (deterministic newest row pre-apply; harmless post-apply). No other code changes needed —
    existing `ON CONFLICT` clauses start converging the moment the constraints are replaced.
    No hard schema dependency in the deploy. Verified: tsc + lint + build green.

- [x] **DAT-H3 / FE-C1** · 🟠 High · Archive/shelf links 404 for any article not in the latest batch
  - Where: `app/api/articles/[id]/route.ts:11-21`, `app/articles/[id]/page.tsx:46-52`; links from `app/archive/page.tsx:302-304`
  - Fix: resolve an article ID across all stored batches (JSONB containment query on `article_batches.articles` + GIN index, or carry `?batch=YYYY-MM-DD` from the shelf and `readBatch(batchDate)`). Add a styled `app/not-found.tsx` (and `app/articles/[id]/not-found` if needed) matching the editorial theme, with a link back to the archive / source.
  - Verify: open a shelf item from an older issue → article renders (not the black default 404).
  - Status: DONE · Commit: pending · Notes: Added `findArticleAcrossBatches(id)` to
    `lib/pipeline/storage.ts` (JSONB `@>` containment, newest containing batch wins); both
    `app/api/articles/[id]/route.ts` and `app/articles/[id]/page.tsx` now use it. Folio/total
    fall back to the article's position in its own batch. Added styled editorial
    `app/not-found.tsx` (links to today's issue + archive) — also satisfies the not-found half
    of FE-M6. Migration `017_article_batches_gin.sql` adds the GIN index (performance-only;
    query verified correct without it). Verified: gate green + live dev-DB test — article id
    from the 2026-04-20 batch resolves, nonexistent id returns empty → 404 page. Commit: 9499a92.

- [x] **FE-H2** · 🟠 High · Tailwind v4 CSS-variable syntax broken app-wide → focus rings never render
  - Where: ~17 occurrences: `app/layout.tsx:51`, `app/page.tsx:311`, `app/archive/page.tsx`, `app/articles/[id]/page.tsx`, `app/components/ArticleCard.tsx`, `ArticleInteractions.tsx`, `ArticleBodyClient.tsx`, `EditorLetterModal.tsx`
  - Fix: global replace v3 bracket var syntax with v4 paren syntax — `bg-[--bg]`→`bg-(--bg)`, `text-[--fg]`→`text-(--fg)`, `ring-[--accent]`→`ring-(--accent)`, etc. Grep `\[--` to find all.
  - Verify: Tab through feed/archive → terracotta focus ring is visible; computed `--tw-ring-color` resolves to a real color, not the literal string `--accent`.
  - Status: DONE · Commit: pending · Notes: sed-replaced all 17 occurrences (`[--var]`→`(--var)`)
    across the 8 files; grep `\[--` now returns 0 in app/ and lib/. Verified in the production
    build CSS: `.focus-visible\:ring-\(--accent\):focus-visible{--tw-ring-color:var(--accent)}`
    is emitted (previously no color rule was generated at all). Gate green.

- [x] **DAT-H2** · 🟠 High · No `maxDuration` on pipeline routes → killed mid-run, no batch written
  - Where: `app/api/pipeline/run/route.ts`, `app/api/feed/refresh/route.ts`
  - Fix: `export const maxDuration = 300` (or 800 on Pro). Parallelize per-article LLM loops with bounded concurrency (`lib/pipeline/run.ts:132-166,287-298`). Add a wall-clock budget that short-circuits discovery and still writes the assembled batch.
  - Verify: a full run completes within the limit and always writes `article_batches` even if discovery is slow.
  - Status: DONE · Commit: pending · Notes: `maxDuration = 300` on both routes. Aesthetic
    scoring + concept extraction now run via `forEachWithConcurrency` (chunks of
    `PIPELINE_LLM_CONCURRENCY = 4`, same idiom as the existing body-fetch loop). Wall-clock
    budget: `PIPELINE_WALL_CLOCK_BUDGET_MS = 270s` minus a `120s` post-discovery reserve —
    discovery is skipped if no budget remains, or raced against a timeout (cut short → fixed-only
    batch, late rejection absorbed). Constants in `lib/config/feed.ts`. The batch write can no
    longer be starved by slow discovery. Gate green. Live verify after deploy: cron run completes
    and writes `article_batches`.

- [ ] **PIPE-H1** · 🟠 High · Total LLM failure degrades silently into a junk batch (`ok:true`)
  - Where: `lib/pipeline/run.ts`; evidence in `data/pipeline.log` (04-17→04-20: `scored=0 skipped=20`, auth failures)
  - Fix: use the failure counts already computed; if `skipped === articles.length` or api-error count exceeds a threshold, fail the run (so the cron surfaces it) and/or flag the batch `degraded:true` and log at error level. Make `aestheticScorer.ts:7` / `conceptExtractor.ts:6` guard a missing `ANTHROPIC_API_KEY` like the lazy modules do.
  - Verify: simulate a missing key locally → run fails loudly / marks degraded instead of returning success.
  - Status: TODO · Commit: — · Notes: —

---

## TIER 2 — NEXT (quality & correctness)

- [ ] **PIPE-Q1** · 🟠 High (UX-validated) · Body-extraction noise pollutes the reader
  - Where: `lib/discovery/bodyExtractor.ts`, `lib/pipeline/adapters/rssAdapter.ts`
  - Fix: strip page chrome from extracted bodies — repeated title/byline/timestamp, `Share on Facebook/X/Reddit/Email/Bluesky`, "Featured Video", and trailing related-article lists. Prefer main-content extraction; drop boilerplate blocks before storing `bodyText`.
  - Verify: open today's lead article → real prose starts at paragraph 1, no share-bar/related junk.
  - Status: TODO · Commit: — · Notes: —

- [ ] **PIPE-Q2** · 🟠 High (UX-validated) · Quality gate lets housekeeping/video posts into the curated feed
  - Where: `lib/discovery/qualityGate.ts`, fixed-RSS path in `lib/pipeline/run.ts` (fixed sources bypass the LLM eval)
  - Fix: screen fixed-RSS items through the quality gate too; filter housekeeping/announcement posts ("Open Thread", "Hidden Open Thread", "Meetup", "Links for…") and pure-video items, or down-rank them out of the displayed 7.
  - Verify: feed no longer surfaces "Open Thread 437" / "Berkeley Meetup" / 1-min Aeon videos.
  - Status: TODO · Commit: — · Notes: —

- [ ] **PIPE-Q3** · 🟡 Medium (UX-validated) · Read-time collapses to "1 MIN" for most pieces
  - Where: read-time computation (downstream of `bodyText` length)
  - Fix: likely resolved by PIPE-Q1 (fuller bodies). Confirm read-time is computed from cleaned body word-count; add a floor/heuristic if body extraction failed.
  - Verify: long Quanta/essay pieces show realistic multi-minute read times.
  - Status: TODO · Commit: — · Notes: — (may be a no-op after PIPE-Q1)

- [ ] **PIPE-H6** · 🟠 High · One bad RSS pubDate drops the whole source; no parser timeout/UA
  - Where: `lib/pipeline/adapters/rssAdapter.ts:6-10,92`
  - Fix: guard the date (`const d=new Date(pubDate); isNaN(d)?now:d.toISOString()`), and construct the parser with `{ timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TangentBot/1.0)' } }`.
  - Verify: a feed with one malformed item still yields its other articles.
  - Status: TODO · Commit: — · Notes: —

- [ ] **PIPE-H5** · 🟠 High · Brave: 12 concurrent queries, no timeout/429 handling; 100% eval-reject
  - Where: `lib/discovery/run.ts:188-200`, `lib/discovery/braveSearch.ts:39-53`, threshold `lib/config/feed.ts:41`
  - Fix: serialize Brave queries ~1.1s apart (or p-limit 1) with `AbortSignal.timeout(10000)` and one 429 retry w/ backoff. Make `LLM_EVAL_THRESHOLD` adaptive (take top-N by composite) and log loudly when pass-rate is 0%.
  - Verify: discovery returns >0 candidates; logs show queries spaced and 429s retried.
  - Status: TODO · Commit: — · Notes: —

- [ ] **PIPE-H2** · 🟠 High · Cosine on raw 1–5 vectors is inert; drift unreachable
  - Where: `lib/pipeline/ranker.ts:224-229`, `lib/utils/driftScore.ts:25`, `lib/config/aesthetic.ts:70`
  - Fix: center each dimension to [-1,1] via `(v-3)/2` before cosine (or scaled Euclidean). Re-tune `DRIFT_THRESHOLD` afterward.
  - Verify: opposite profiles produce low similarity; likes visibly reorder the feed beyond source effects.
  - Status: TODO · Commit: — · Notes: —

- [ ] **PIPE-H4** · 🟠 High · `computeDiversityScore` always saturates at 1.0
  - Where: `lib/pipeline/receptivity.ts:63`
  - Fix: normalize by total extracted concepts, e.g. `distinct / totalConceptOccurrences`, so overlap actually lowers the score.
  - Verify: diversity score varies with concept overlap across liked articles.
  - Status: TODO · Commit: — · Notes: —

- [ ] **PIPE-H3** · 🟠 High · Blind-spot prober is dead code (never imported)
  - Where: `lib/pipeline/blindSpotProber.ts` (no importers)
  - Decision (report default): **wire it up.** Call `identifyBlindSpotClusters` + `selectProbeArticle` in `runPipeline` after concept extraction, and `processPriorDayProbeIgnores` at run start. (If wiring proves large, fall back to deleting the module + its probe-slot allocation and document that choice.)
  - Verify: feed shows a blind-spot (◐) slot type; `probeInfo` populated; probe-acceptance no longer pinned at 0.5.
  - Status: TODO · Commit: — · Notes: — (log decision in Decisions Log)

- [ ] **FE-H3** · 🟠 High · `--dim` functional text fails contrast (~2.47:1) at 8–9px
  - Where: `app/globals.css:10` (`--dim:#A49B88` on `--bg:#F6F2EA`)
  - Fix: darken `--dim` to ~`#857B66` (≈4.5:1), or move functional labels (folios, dates, tabs, progress count) to `--muted` (#6B645A ≈5.2:1) and keep `--dim` for ornament only. Consider 10–11px for mono labels. (Brand-color tweak — log in Decisions Log.)
  - Verify: contrast ≥4.5:1 on functional labels (DevTools / axe).
  - Status: TODO · Commit: — · Notes: —

- [ ] **FE-M4** · 🟡 Medium · Overlays lack focus management (no trap/Escape/scroll-lock)
  - Where: `app/components/EditorLetterModal.tsx:22-28`, victory overlay `app/components/ArticleBodyClient.tsx:124-199`, `app/components/IssueCover.tsx:62-66`
  - Fix: on open move focus into the dialog, trap Tab, close on Escape, restore focus on close, `overflow:hidden` on body. Add Space handling to IssueCover; show the letter only after the cover is dismissed.
  - Verify: Escape closes the victory overlay; Tab stays within open modals; page behind doesn't scroll.
  - Status: TODO · Commit: — · Notes: —

- [ ] **FE-M7** · 🟡 Medium · Clickable cards are `<button>`s wrapping `<h2>`/`<p>` (invalid; no link behavior)
  - Where: `app/components/ArticleCard.tsx:145-194,92-127`, `app/archive/page.tsx:302-329`
  - Fix: use Next `<Link href>` styled as a block for navigation (keeps Cmd/middle-click, new-tab, prefetch, valid HTML). Keep the separate verb controls as `<button>`s.
  - Verify: Cmd/middle-click a card opens it in a new tab; HTML validates.
  - Status: TODO · Commit: — · Notes: —

- [ ] **FE-H1** · 🟠 High · ReadingPositionTracker leaks a `visibilitychange` listener per article; inflates dwell
  - Where: `app/components/ReadingPositionTracker.tsx:134-148` (+ uncleared `saveTimerRef`)
  - Fix: hoist the handler to a named function and remove it in cleanup; clear the debounce timer on unmount; pause the dwell timer while the tab is hidden.
  - Verify: navigating across several articles then hiding the tab POSTs one position with sane dwell, not one per prior article.
  - Status: TODO · Commit: — · Notes: —

- [ ] **DAT-H1** · 🟠 High · Migrations 001–006 missing; no migration runner
  - Where: `lib/db/migrations/` (starts at 007); DDL only in `agents/architect/*` docs
  - Fix: backfill `001`–`006` `.sql` from the architecture docs (DDL for `users`, `sessions`, `verification_tokens`, `feedback`, `discovery_topic_weights`, etc.); add `scripts/migrate.ts` applying files in order and recording in a `schema_migrations` table; add an npm script. ⚠️ Don't run against prod — mark `BLOCKED-ON-APPLY` for Kyle to run.
  - Verify: runner applies cleanly to a fresh local DB; idempotent on re-run.
  - Status: TODO · Commit: — · Notes: —

- [ ] **DAT-H4** · 🟠 High · `feedback.value='save'` likely violates original CHECK; migrate route rejects 'save' forever
  - Where: `app/api/feedback/route.ts:168`, `app/api/feedback/migrate/route.ts:31`, `lib/feedback/store.ts:233-237`
  - Fix: migration to drop/recreate the `feedback` CHECK to include `'save'`; accept `'save'` in the migrate route validation. ⚠️ DB-schema → migration file + `BLOCKED-ON-APPLY`.
  - Verify: a server-side save persists (200, row written); the localStorage migration stops 400-looping.
  - Status: TODO · Commit: — · Notes: —

---

## TIER 3 — LATER (hardening, security, polish)

### Security
- [ ] **SEC-C1** · 🔴 Critical (single-user-mitigated) · Auth disabled; owner email in client bundle
  - Where: `app/api/auth/me/route.ts:5-8`, `app/components/AuthContext.tsx:16-37`, no `middleware.ts`
  - Fix (report default for single-user): read the email from an env var (stop shipping it in source); document that the deployment should sit behind Vercel password protection. Leave the auth system off but coherent (or hide `/auth`). Don't build multi-user gating now.
  - Status: TODO · Commit: — · Notes: — (log decision)
- [ ] **SEC-H2** · 🟠 High · No rate limiting on auth / feedback / refresh (cost + email-bomb)
  - Fix: add IP+account rate limiting (e.g. Upstash) on auth routes, `POST /api/feedback` (LLM-triggering), and `/api/feed/refresh`. Adds a dependency — log in Decisions Log.
  - Status: TODO · Commit: — · Notes: —
- [ ] **SEC-H1** · 🟠 High · Data routes trust client-supplied `deviceId` as identity
  - Where: `lib/auth/session.ts:57-59` + feedback/reading-position/migrate routes
  - Fix: treat `X-Device-ID`/`dd_device_id` as untrusted; bind device→identity server-side or key off session. (Limited impact while single-user; document.)
  - Status: TODO · Commit: — · Notes: —
- [ ] **SEC-H3** · 🟠 High · `feedback/migrate` unauthenticated; cron secret compared non-constant-time
  - Fix: require a session on `feedback/migrate` (or remove once migration done); use `crypto.timingSafeEqual` in `app/api/pipeline/run/route.ts:9`; stop echoing `err.message` to callers.
  - Status: TODO · Commit: — · Notes: —
- [ ] **SEC-M1** · 🟡 Medium · Email links built from `NEXTAUTH_URL` (open-redirect/phishing if it drifts)
  - Fix: derive base URL from an allowlisted constant or validate at startup. (`lib/email/send.ts:27,36`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **SEC-M2** · 🟡 Medium · No CSRF protection on cookie-authenticated writes
  - Fix: verify Origin/Referer against an allowlist (or double-submit token) on state-changing routes.
  - Status: TODO · Commit: — · Notes: —
- [ ] **SEC-M3** · 🟡 Medium · Token lookups not constant-time; verify→delete non-atomic
  - Fix: low priority — optionally collapse verify+consume into one transactional statement (`lib/db/auth.ts:99-109`, `verify-email`). Tokens are 256-bit so practical risk is low.
  - Status: TODO · Commit: — · Notes: —
- [ ] **SEC-L1** · 🟢 Low · Login user-enumeration (403 unverified vs 401 unknown; timing)
  - Fix: return a generic 401 for bad-password and unverified; run a dummy bcrypt compare when user not found. (`app/api/auth/login/route.ts:26-40`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **SEC-L2** · 🟢 Low · SMTP TLS only auto-enabled on port 465
  - Fix: make TLS explicit / `requireTLS:true` for 587. (`lib/email/send.ts:3-11`)
  - Status: TODO · Commit: — · Notes: —

### Data / API — mediums
- [ ] **DAT-M1** · 🟡 Medium · Fire-and-forget async dropped on serverless (concept extraction, rationale patch)
  - Fix: use `after()`/`waitUntil` or await. (`app/api/feedback/route.ts:260-293`, `app/api/feed/today/route.ts:123-126`) Generate rationales at pipeline time so they aren't recomputed per feed load.
  - Status: TODO · Commit: — · Notes: —
- [ ] **DAT-M2** · 🟡 Medium · `patchBatchArticleFields` read-modify-write can clobber a refreshed batch
  - Fix: single-statement `jsonb_set` update, or guard `WHERE generated_at = ...`. (`lib/pipeline/storage.ts:74-98`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **DAT-M3** · 🟡 Medium · `/api/issue/meta` no try/catch; unvalidated `date` param
  - Fix: wrap in try/catch → JSON 500; validate `^\d{4}-\d{2}-\d{2}$`. (`app/api/issue/meta/route.ts:17-57`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **DAT-M4** · 🟡 Medium · `/api/reading-position` accepts NaN/Infinity/float/garbage → 500
  - Fix: `Number.isInteger`/clamp ≥0; validate ISO timestamp; type-check `dwellSeconds`. Same class in `/api/feedback` (`Infinity` survives `Math.floor`).
  - Status: TODO · Commit: — · Notes: —
- [ ] **DAT-M5** · 🟡 Medium · Every feedback POST reads the full batch JSONB twice (w/ bodyText)
  - Fix: select just the one article via JSONB path, or persist probeInfo/concepts in a slim side table. (`app/api/feedback/route.ts:191-201,262-265`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **DAT-M6** · 🟡 Medium · Oversized payloads: feed ships full `bodyText`; archive pulls 30 full batches
  - Fix: project fields in SQL (`jsonb_build_object` over `jsonb_array_elements`); strip `bodyText` from `/api/feed/today`. (`app/api/archive/route.ts:28-33`, `app/api/feed/today/route.ts:130-134`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **DAT-M7** · 🟡 Medium · `migrateFeedbackRecords`: unbounded parallel writes, unvalidated timestamps, no txn
  - Fix: cap `records.length` (~500), validate timestamps, chunk sequentially or `sql.transaction`. (`lib/db/feedback.ts:119-133`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **DAT-M8** · 🟡 Medium · "Transactions" that aren't (multi-statement invariants non-atomic)
  - Fix: use `sql.transaction([...])` for node+edge delete (`lib/db/concepts.ts:109-141`) and `associateFeedbackToUser` (`feedback.ts:82-107`).
  - Status: TODO · Commit: — · Notes: —
- [ ] **DAT-M9** · 🟡 Medium · `data/sources.json` runtime read may not be traced into the Vercel bundle
  - Fix: add `outputFileTracingIncludes` for `data/sources.json` + `query_banks.default.json` in `next.config.ts`, or move sources to DB. (`lib/pipeline/config.ts:38-42`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **DAT-H5** · 🟠 High · `/api/feed/refresh` unauthenticated + in-memory cooldown (cost / clobber)
  - Fix: require session/secret; persist cooldown in Postgres atomically; take an advisory lock before running. (`app/api/feed/refresh/route.ts:9-15`, `lib/pipeline/cooldown.ts:5`) Overlaps SEC-H2 / PIPE-M3.
  - Status: TODO · Commit: — · Notes: —

### Data / API — lows (may be grouped into one `chore(DAT-L): cleanup` commit if trivial)
- [ ] **DAT-L1** · 🟢 · `updateDriftState` compares two untyped params as text → cast `::float8`. (`aesthetics.ts:308-323`)
- [ ] **DAT-L2** · 🟢 · N+1 upserts in `upsertConceptGraph`; batch with `unnest`. (`concepts.ts:237-248`)
- [ ] **DAT-L3** · 🟢 · EMA read-modify-write race in feedback; single SQL statement. (`feedback/route.ts:48-105`) (moot after DAT-C2)
- [ ] **DAT-L4** · 🟢 · `GET /api/feedback` swallows DB errors as `{}` 200 → return 500. (`feedback/route.ts:144-147`)
- [ ] **DAT-L5** · 🟢 · Delete is device-scoped only; `getFeedbackForUser` resurrects other-device rows. (`feedback.ts:69-74`)
- [ ] **DAT-L6** · 🟢 · Non-constant-time secret compare + raw `err.message` leak. (`pipeline/run/route.ts:9,26`) (≈SEC-H3)
- [ ] **DAT-L7** · 🟢 · Delete dead legacy artifacts: `data/refresh_cooldowns.json`, `data/pipeline.log`, `data/batches/*.json`, dead `BATCH_DIR`/`LOG_PATH` consts.
- [ ] **DAT-L8** · 🟢 · `getBatchCount()` returns 0 on empty table ("Issue № 0"). (`issueMeta.ts:11-15`)
- [ ] **DAT-L9** · 🟢 · `drainQueue` lost-write race (client, rare). (`store.ts:163-186`)

### Frontend — mediums
- [ ] **FE-M1** · 🟡 Medium · Hydration mismatch: localStorage read in `useState` initializer on SSR'd page
  - Fix: init to null, sync in `useEffect`. (`app/components/ArticleInteractions.tsx:54-56`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **FE-M2** · 🟡 Medium · Feedback retry queue wedged by a 4xx poison-pill; retried forever
  - Fix: only enqueue on network/5xx/429; drop on 4xx; add max-attempts/TTL. (`lib/feedback/store.ts:126-190`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **FE-M3** · 🟡 Medium · New-device feedback sync race: dot-strip seeded before server feedback loads
  - Fix: set a `feedbackReady` state after `loadFromServer`; include in the seeding effect deps. (`app/page.tsx:89-134`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **FE-M5** · 🟡 Medium · UTC/local date confusion mislabels "TODAY"/"days ago" west of UTC
  - Fix: derive `today` from local date parts; use the noon trick in `daysAgo`. (`app/archive/page.tsx:84,46-53`, `app/articles/[id]/page.tsx:46`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **FE-M6** · 🟡 Medium · Archive conflates network error with empty; no global error/not-found/loading pages
  - Fix: add error state + retry to archive; differentiate offline vs 500 copy; add `app/error.tsx`, `app/not-found.tsx`, `app/articles/[id]/loading.tsx`.
  - Status: TODO · Commit: — · Notes: — (not-found overlaps DAT-H3)
- [ ] **FE-M8** · 🟡 Medium · Raw `<img>` no dimensions → layout shift; eager, unoptimized
  - Fix: add `aspect-ratio` + `loading="lazy" decoding="async"`, or `next/image` w/ `remotePatterns`. (`ArticleCard.tsx:99-104`, `articles/[id]/page.tsx:125-130`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **FE-M9** · 🟡 Medium · Fetches lack AbortController; results race on fast navigation
  - Fix: per-effect `AbortController`, pass `signal`, abort in cleanup; clear the ArticleBodyClient timers. (`app/page.tsx:71-151`, `archive/page.tsx:68-74`, `ReadingPositionTracker.tsx:80-101`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **FE-M10** · 🟡 Medium · Tap targets <44px on error/nav controls
  - Fix: `min-height:44px`/larger hit area on "Try again", "Run pipeline", archive tabs, header links, colophon links.
  - Status: TODO · Commit: — · Notes: —

### Frontend — lows
- [ ] **FE-L1** · 🟢 · Delete 8 dead components + dead `countRead`, `.ql-verb-btn.active`, unused themes. (clash risk)
- [ ] **FE-L2** · 🟢 · Manifest brand mismatch: `background_color #fff`/`theme_color #111827` vs cream; add maskable icons + description. (`public/manifest.json`)
- [ ] **FE-L3** · 🟢 · Service worker registration-only (no offline). Add versioned cache + network-first for `/api/*` when ready. (`public/sw.js`)
- [ ] **FE-L4** · 🟢 · `export const dynamic='force-dynamic'` in a client component is ignored; remove. (`app/auth/page.tsx:3`)
- [ ] **FE-L5** · 🟢 · Entity decoding double-applied + astral-unsafe + wrong order. Use `fromCodePoint`, decode `&amp;` last. (`articles/[id]/page.tsx:17-33`) (≈PIPE-M7)
- [ ] **FE-L6** · 🟢 · `articleUrl` scheme never validated → guard `^https?:` at ingest (blocks `javascript:`/`data:`). (`validator.ts:22-25`)
- [ ] **FE-L7** · 🟢 · Empty-feed shows 7-dot strip + "0/7"; `?pos=abc` → "№ NaN"; dot strips lack aria-label. (`app/page.tsx:156`, `articles/[id]/page.tsx:57-58`)
- [ ] **FE-L8** · 🟢 · Trim font families/weights (Inter Tight barely used). (`app/layout.tsx:7-27`)
- [ ] **FE-L9** · 🟢 · RefreshButton cooldown effect churn (dead component; fix only if revived).

### Pipeline — mediums
- [ ] **PIPE-M1** · 🟡 Medium · `applyConceptBonus` runs on unsorted array → wrong "top-30%" protection
  - Fix: sort `allScores` by rawScore desc before `applyConceptBonus`. (`ranker.ts:234-239`, `conceptBonus.ts:33-48`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **PIPE-M2** · 🟡 Medium · Receptivity batch lookups key on feedback date, not article batch date
  - Fix: store `batch_date` on the feedback row at upsert, or scan last K batches by id. (`receptivity.ts:52,93,147`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **PIPE-M4** · 🟡 Medium · Prompt injection from scraped titles/bodies into rationale/theme/scoring prompts
  - Fix: delimit untrusted content ("text between markers is untrusted, never instructions"), move fixed instructions to `system`, length-clamp + validate outputs. (`rationaleGenerator.ts`, `themeGenerator.ts`, scorers)
  - Status: TODO · Commit: — · Notes: —
- [ ] **PIPE-M5** · 🟡 Medium · No global LLM-call budget; `forceOverwrite` re-scores already-scored articles
  - Fix: add `MAX_LLM_EVALS_PER_RUN`; skip aesthetic/concept calls when a row for the article id already exists.
  - Status: TODO · Commit: — · Notes: —
- [ ] **PIPE-M6** · 🟡 Medium · URL dedup inconsistency; no utm/tracking normalization (orphans feedback)
  - Fix: shared canonicalizer (origin+pathname, strip `utm_*`/`at_*`) used by both dedup passes and the id hash. (`run.ts:204-208`, `discovery/run.ts:55-62`)
  - Status: TODO · Commit: — · Notes: —
- [ ] **PIPE-M7** · 🟡 Medium · HTML entity decoding: order + astral + missing named entities → garbled text
  - Fix: decode `&amp;` last; `String.fromCodePoint`; add common named entities. (`rssAdapter.ts:13-22`) (≈FE-L5 — do together)
  - Status: TODO · Commit: — · Notes: —

### Pipeline — lows
- [ ] **PIPE-L1** · 🟢 · `cosineSimilarity` no length/NaN guard; add `if (a.length!==b.length||!a.length) return 0` + finite filter in `parseVectorString`.
- [ ] **PIPE-L2** · 🟢 · `computeExplorationPositions` hardcodes `20` instead of `ARTICLES_PER_DAY`. (`explorationAssembler.ts:155`)
- [ ] **PIPE-L3** · 🟢 · `themeGenerator` `max_tokens:80` can truncate JSON → use a tool schema or raise to ~160. (`themeGenerator.ts:40-52`)
- [ ] **PIPE-L4** · 🟢 · `refresh-query-banks.ts` bare `JSON.parse` w/o fence-strip → 0 queries on fenced reply.
- [ ] **PIPE-L5** · 🟢 · `serendipityScorer` bidirectional substring over-matches short labels; require token-boundary/min length. (`:63-68`)
- [ ] **PIPE-L7** · 🟢 · `newsApiAdapter` puts API key in query string + no timeout; use `X-Api-Key` header. (currently moot — all RSS)
- [ ] **PIPE-L9** · 🟢 · Centralize the hardcoded model name `claude-haiku-4-5-20251001` (7 files) into one `LLM_MODEL` constant.

---

## Decisions Log
_Append one entry per judgment call (autonomy = "use report default + document")._

| Date | Finding | Decision | Rationale |
|------|---------|----------|-----------|
| 2026-06-12 | (infra) | Added `.claude/**` to eslint `globalIgnores` and fixed 8 pre-existing lint errors (5 unescaped JSX entities escaped properly; 2 `set-state-in-effect` + 1 `react-hooks/purity` silenced with justified `eslint-disable-next-line`) in a separate `chore(lint)` commit | `npm run lint` had never been green: it scanned stale `.claude/worktrees/*/.next` build artifacts (1951 errors) and 8 real pre-existing errors. The campaign's verification gate requires lint green before every push, so this baseline was a prerequisite. The three disabled sites are mount-time localStorage reads / a mount timestamp ref — legit patterns; the components get properly reworked later by FE-M3/FE-M4/FE-H1. |
| 2026-06-12 | DAT-C1 | Rotation cursor table `query_rotation_state` is global (keyed by `topic_id` only), not per-user | Matches the semantics of the JSON file it replaces; app is single-user. Re-key by identity later if multi-user needs it. |
| 2026-06-12 | DAT-C2 | Chose `UNIQUE NULLS NOT DISTINCT` (not the `user_id=''` sentinel); de-dup strategy per table: keep-newest for `user_aesthetic_profiles`/`discovery_topic_weights`, SUM-merge for `user_concepts`/`user_concept_edges`, keep-oldest + `probe_count = duplicates − 1` for `blind_spot_clusters` | Sentinel would require touching every read/write path. De-dup mirrors each upsert's write style: full-state rewrites → newest row is truth; increment-style upserts scattered +1s across duplicate rows → SUM restores accumulated taste data; blind-spot status UPDATEs matched all duplicates so the oldest row saw every update, and the on-conflict probe increment never fired so row-count reconstructs it. |

---

## Migrations awaiting Kyle (apply to Neon)
_List each new migration file + the exact apply step. Code must NOT apply these to prod._

| Migration file | For finding | Apply note |
|----------------|-------------|------------|
| `lib/db/migrations/015_query_rotation_state.sql` | DAT-C1 | Run the file's SQL against Neon (psql or console). Idempotent (`CREATE TABLE IF NOT EXISTS`). Until applied, discovery works but the query-rotation cursor resets each run (logged as a warning, non-fatal). After applying, flip DAT-C1 to DONE. |
| `lib/db/migrations/016_nulls_not_distinct_unique.sql` | DAT-C2 | Requires PG ≥ 15 (`SHOW server_version` to confirm; Neon qualifies). Runs in one transaction: de-dups the five identity tables, then swaps the unique constraints to `UNIQUE NULLS NOT DISTINCT`. Idempotent — safe to re-run. Until applied, anonymous upserts keep duplicating (current prod behavior, no worse). After applying, verify: repeat a like → `SELECT COUNT(*) FROM user_aesthetic_profiles WHERE user_id IS NULL` stays constant and `feedback_count` increments; then flip DAT-C2 to DONE. |
| `lib/db/migrations/017_article_batches_gin.sql` | DAT-H3 (perf only) | Optional/low-urgency: GIN index for the cross-batch article lookup. The feature works without it; apply whenever convenient. Idempotent. |

---

## Session Log
_Append-only. One block per session so the next session (and Kyle) can orient fast._

### Session 0 — 2026-06-12 — tracker created (by reviewer, in Cowork)
- Created this tracker from the combined review report. No code changed yet.
- RESUME AT: **DAT-C1**

### Session 1 — 2026-06-12 — Claude Code (campaign start)
- Prerequisite `chore(lint)` commit: eslint now ignores `.claude/**` (stale worktrees with their
  own `.next` builds were producing ~1951 phantom errors); fixed the 8 real pre-existing lint
  errors (see Decisions Log). Gate is green for the first time.
- **DAT-C1** → BLOCKED-ON-APPLY: removed the load-time `fs.copyFileSync` crash (read-only fallback
  chain), moved rotation cursor to Postgres via migration 015 with graceful degradation until
  applied. Files: `lib/discovery/queryBank.ts`, `lib/discovery/run.ts`,
  `lib/db/migrations/015_query_rotation_state.sql`. Verified: tsc + lint + build green.
  Commits: 05dac66 (chore), 651c62f (fix).
- **DAT-C2** → BLOCKED-ON-APPLY: migration `016_nulls_not_distinct_unique.sql` (de-dup + NULLS
  NOT DISTINCT constraints on the five identity tables); defensive `ORDER BY updated_at DESC` on
  the anonymous profile read in `lib/db/aesthetics.ts`. Verified: tsc + lint + build green.
  Commit: ff5ccef.
- **DAT-H3 / FE-C1** → DONE: cross-batch article resolution via JSONB containment
  (`findArticleAcrossBatches` in storage.ts; API route + article page now use it); styled
  editorial `app/not-found.tsx`; optional GIN index migration 017. Verified against live dev DB
  (54 batches): old-batch id resolves, missing id 404s. Commit: 9499a92.
- **FE-H2** → DONE: Tailwind v4 paren syntax for CSS-var utilities, all 17 occurrences; ring
  color rule confirmed in built CSS. Commit: 597b1e1.
- **DAT-H2** → DONE: maxDuration=300 on both pipeline routes; LLM loops at concurrency 4;
  270s wall-clock budget with 120s post-discovery reserve (skip / cut-short discovery, always
  write the batch).
- RESUME AT: **PIPE-H1**
