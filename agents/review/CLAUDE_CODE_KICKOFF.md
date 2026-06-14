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
  them; do not re-open them. We are now on the **ROUND 2 backlog** — the next actionable finding is
  **R2-01** (Round-1 items are all DONE/VERIFIED/DEFERRED/SKIPPED). Don't skip ahead otherwise or
  batch unrelated findings into one commit. (Trivial Low items — the R2-L band — may share one
  `chore(R2-L)` commit.)
- **S-01 is NOT a code task.** It's an operational reminder for Kyle to rotate secrets; do not touch
  `.env.local` or attempt any rotation. Mark it `SKIPPED` with a note "owner action — rotate keys + update Vercel env" and move on.
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

Start now: open `agents/review/REVIEW_TRACKER.md`, read the **ROUND 2** section, find the first
`TODO` (currently **R2-01**), and begin the loop. Note: R2-01 through R2-05 are the High-severity
regressions — several are one-line fixes (e.g. R2-01 adds a `::float8` cast). Re-confirm each against
current code before changing it.
