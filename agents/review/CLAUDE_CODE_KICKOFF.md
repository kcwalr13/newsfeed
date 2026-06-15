You are working in the **Tangent** repo. We are running a systematic remediation campaign
to fix every finding from a code + UX/UI review, one finding at a time, committing and pushing
after each so we never lose progress if a session ends mid-way.

## Read these first (in order)
1. `CLAUDE.md` — project context, agent pipeline, and ground rules. Follow them.
2. `agents/review/REVIEW_TRACKER.md` — **the source of truth.** It contains every finding
   (stable IDs like `DAT-C1`, `FE-H2`), the fix-order, the campaign policy, the per-finding
   workflow, the verification gate, the hard guardrails, and the Session Log. Read the whole
   policy section before touching code.

## Your job this session
Work through findings **in tracker order**, starting at the first `TODO`
(see `RESUME AT` at the bottom of the tracker's Session Log). For each finding, run the
per-finding loop defined in the tracker:

1. Mark it `IN-PROGRESS`.
2. **Re-confirm** the issue by reading the cited files. If it's already fixed, mark `DONE`
   with a note and move on — don't change correct code.
3. Implement the **minimal** fix. No unrelated refactors; touch only what the finding needs.
4. **Verification gate — all must pass before committing:**
   `npx tsc --noEmit` && `npm run lint` && `npm run build`.
   Add a targeted check when useful (run a script, curl `npm run dev`, etc.).
5. Update `REVIEW_TRACKER.md`: flip status to `DONE`, fill Notes (what changed, files, how
   verified, follow-ups), append a **Session Log** entry, and update the **Progress summary**
   counts and the `RESUME AT` pointer.
6. **Commit the fix + tracker together**, then **push**:
   `git add -A && git commit -m "fix(<ID>): <summary>" && git push`
   (Use `chore(...)`/`refactor(...)` prefixes where more accurate.)
7. A finding that is `DONE` + committed + pushed is a **safe stopping point.** Repeat from 1.

## Policy (already decided — don't re-litigate)
- **Scope:** the entire tracker, in order — **except items marked `DEFERRED`**, which are out of
  scope (single-user project; see the tracker's *Future state — multi-user rollout* section). Skip
  them; do not re-open them. Rounds 1–4 and the main Round-5 backlog are complete (R4-15 is `BLOCKED` on Kyle's
  taste sign-off — leave it). **One verification follow-up remains — the next actionable item is `R5-C3`:**
  the personalized curator note (R5-C) is **not generating on the live feed** — the deployed `/api/feed/today`
  returns empty `curatorNote` so the card falls back to the RSS summary, even though the code is correct and
  `ANTHROPIC_API_KEY` is set. **Diagnose from the actual `/api/feed/today` Vercel function logs** (not the log
  search UI): is `generateMissingCuratorNotes` early-returning on a missing key in the route runtime, or are
  the Haiku calls throwing (`[curatorNote] Failed …` — check `taste` from `resolveDisplayedFeed` is never
  undefined into `buildUserPrompt`, rate limits, model)? Fix it; also add `export const maxDuration` to the
  feed route and consider generating notes at **pipeline time** instead of the request path (latency / the
  DAT-M1 "LLM on the read path" smell). Commit `fix(R5-C3): …`.
- **Verify the product outcome, not just the gate.** For R5-C3, confirm the deployed feed actually shows
  personalized curator notes (curl `/api/feed/today` and check `articles[].curatorNote` is populated) — a
  green build is not enough; the bug only shows at runtime.
  (a third display-diversity guarantee — re-prove it composes with C2/C3 + the source cap, R4-14 precedent)
  and **R5-D3** (the "place" item type — settle reader-routing: a place links straight out, never opens the
  in-app reader).
- **Push after every finding.** Each push deploys to Vercel and is used for live re-validation,
  so the build **must be green before you push.** Never push a red build.
- **Autonomy:** proceed using the report's recommended fix on every item. For any judgment call
  (e.g. PIPE-H3 wire-up-vs-delete, FE-H3 exact color, SEC-C1 strategy), pick the tracker's
  default, do it, and **record it in the Decisions Log** — don't stop to ask.

## Hard guardrails (the only places to NOT proceed autonomously)
- **Never run schema-changing or destructive SQL against the live Neon database.** For any
  DB-schema finding (DAT-C2, DAT-H1, DAT-H4, …): write a new numbered migration in
  `lib/db/migrations/`, make the application code backward-compatible (idempotent /
  `IF [NOT] EXISTS` / `COALESCE` / guarded) so the deploy doesn't break before the migration is
  applied, set the finding to `BLOCKED-ON-APPLY`, and add the file + exact apply SQL to the
  **"Migrations awaiting Kyle"** table. Applying to Neon is Kyle's manual step.
- **Don't push code that hard-depends on an unapplied migration.** If you can't make it
  backward-compatible, commit the migration but hold the dependent code and note it.
- **Never weaken security controls, change access scopes, or commit secrets** (`.env*` stays
  ignored). `ANTHROPIC_API_KEY`, `DATABASE_URL`, `CRON_SECRET`, etc. are referenced by name only.
- If you discover the tracker is wrong about a finding (already fixed, mis-located, or the fix
  would cause a regression), don't force it — mark it `BLOCKED` with a clear note and move to
  the next `TODO`.

## Running low on context/budget
Finish the current finding cleanly (or `git checkout -- .` to discard a half-done one so the
tree is clean), make sure the tracker is committed and pushed, then end with:
`RESUME AT: <next TODO ID>`. Never leave a half-applied, uncommitted change.

## End-of-session summary (so Kyle can verify with the reviewer)
When you stop, print a concise summary:
- Findings completed this session: `<ID>` — one line each (what changed · commit hash · how verified).
- Any `BLOCKED` / `BLOCKED-ON-APPLY` items and what's needed (esp. migrations to apply to Neon).
- New entries added to the Decisions Log.
- `RESUME AT: <next TODO ID>`.

Verification commands (recap): `npx tsc --noEmit` · `npm run lint` · `npm run build` · `npm run dev`.

Start now: open `agents/review/REVIEW_TRACKER.md`, read the **R5-C3** item in the *Round 5 — follow-ups*
subsection (currently the only actionable `TODO`), and begin the loop. It's a runtime bug — the curator note
doesn't generate on the live feed; diagnose from the deployed `/api/feed/today` function logs and verify the
fix by checking `articles[].curatorNote` is actually populated on the live endpoint, not just a green build.
