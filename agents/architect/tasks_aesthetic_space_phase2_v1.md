# Dev Task List — Latent Aesthetic Space, Phase 2

**ID**: ARCH-TASKS-AESTH-001
**Design Reference**: `agents/architect/design_aesthetic_space_phase2_v1.md`
**Stories Reference**: `agents/pm/stories_aesthetic_space_phase2.md`
**Date**: 2026-04-04
**Status**: Ready for Dev

---

## Dependency Order

```
AESTH-TASK-001  [BLOCKER] lib/types/aesthetic.ts — AestheticScoreVector + AestheticProfile types
  |
  +-- AESTH-TASK-002  [BLOCKER] lib/config/aesthetic.ts — dimension constants, utilities, startup assertion
  |     |
  |     +-- AESTH-TASK-003  [BLOCKER] lib/db/migrations/009_aesthetic_scores.sql — DDL (FLAG: run manually in Neon)
  |     |     |
  |     |     +-- AESTH-TASK-004  [BLOCKER] lib/db/aesthetics.ts — all DB helper functions
  |     |           |
  |     |           +-- AESTH-TASK-005  lib/discovery/aestheticScorer.ts — LLM scorer module
  |     |           |     |
  |     |           |     +-- AESTH-TASK-006  lib/pipeline/run.ts — scoreArticlesAesthetic() integration
  |     |           |
  |     |           +-- AESTH-TASK-007  lib/utils/cosineSimilarity.ts — utility function
  |     |                 |
  |     |                 +-- AESTH-TASK-008  lib/pipeline/ranker.ts — blended score extension
  |     |                       |
  |     |                       +-- AESTH-TASK-009  app/api/feed/today/route.ts — aesthetic profile + score reads
  |     |                             |
  |     |                             +-- AESTH-TASK-010  app/api/feedback/route.ts — EMA profile update
  |     |
  |     +-- (AESTH-TASK-003 also unblocks AESTH-TASK-004 in parallel with AESTH-TASK-005)

AESTH-TASK-011  End-to-end verification
AESTH-TASK-012  ARCHITECTURE.md update
```

### Parallelism Notes

- AESTH-TASK-001 and AESTH-TASK-002 must be done first; they block everything.
- AESTH-TASK-003 (DDL) depends only on AESTH-TASK-002. **The user must apply the SQL manually in Neon before AESTH-TASK-004 can be completed.**
- AESTH-TASK-004 (DB helpers) depends on AESTH-TASK-003 (table must exist).
- AESTH-TASK-005 (scorer) and AESTH-TASK-007 (cosine utility) can be built in
  parallel once AESTH-TASK-004 is complete.
- AESTH-TASK-006 (pipeline integration) depends on both AESTH-TASK-004 and AESTH-TASK-005.
- AESTH-TASK-008 (ranker extension) depends on AESTH-TASK-007.
- AESTH-TASK-009 (feed route) depends on AESTH-TASK-004 and AESTH-TASK-008.
- AESTH-TASK-010 (feedback route) depends on AESTH-TASK-004.
- AESTH-TASK-011 (verification) and AESTH-TASK-012 (docs) are the final tasks.

---

## AESTH-TASK-001 — TypeScript types: AestheticScoreVector and AestheticProfile

**[BLOCKER — prerequisite for all other tasks]**
**Covers stories**: AESTH-002

### What to build

Create `lib/types/aesthetic.ts` with the two shared TypeScript types used
throughout Phase 2. This file is the type source of truth — imported by the
scorer, DB helpers, ranker, and route handlers.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/types/aesthetic.ts` |

### Implementation

Create the file with exactly the following content:

```typescript
/**
 * Named-field representation of a six-dimension aesthetic score vector.
 * Canonical index order: [contemplative, concrete, personal, playful, specialist, emotional]
 * All values are in the range 1.0–5.0.
 */
export interface AestheticScoreVector {
  contemplative: number;  // index 0 — 1=propulsive, 5=contemplative
  concrete:      number;  // index 1 — 1=concrete,   5=abstract
  personal:      number;  // index 2 — 1=personal,   5=universal
  playful:       number;  // index 3 — 1=playful,    5=serious
  specialist:    number;  // index 4 — 1=generalist, 5=specialist
  emotional:     number;  // index 5 — 1=neutral,    5=emotionally resonant
}

/**
 * A user's stored aesthetic profile: a centroid in the six-dimension aesthetic
 * space, maintained via EMA across qualifying feedback events.
 */
export interface AestheticProfile {
  user_id:        string | null;  // null for anonymous (device-only) sessions
  device_id:      string;         // always present; matches dd_device_id cookie value
  centroid:       AestheticScoreVector;
  feedback_count: number;         // total qualifying feedback events incorporated
  updated_at:     string;         // ISO-8601 timestamp of last centroid update
}
```

### Acceptance criteria

- [x] `lib/types/aesthetic.ts` exists with `AestheticScoreVector` and `AestheticProfile` exported.
- [x] `AestheticScoreVector` has exactly six named numeric fields with the inline index comments.
- [x] `AestheticProfile` matches the shape above exactly.
- [x] `npx tsc --noEmit` passes with no new errors.
- [x] No other files are modified in this task.

---

## AESTH-TASK-002 — Aesthetic config: constants, dimension definitions, vector utilities

**[BLOCKER — prerequisite for all scorer, DB, and ranker tasks]**
**Covers stories**: AESTH-001, AESTH-003

### What to build

Create `lib/config/aesthetic.ts`. This file exports:
1. All numeric tuning constants with inline documentation.
2. A startup assertion that `SOURCE_SCORE_WEIGHT + AESTHETIC_WEIGHT === 1.0`.
3. `vectorToArray()` — converts a named-field `AestheticScoreVector` to a positional `number[]`.
4. `arrayToVector()` — inverse: converts a positional `number[]` to `AestheticScoreVector`.
5. A `DIMENSION_KEYS` constant that lists the canonical key order.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/config/aesthetic.ts` |

### Implementation

```typescript
import type { AestheticScoreVector } from '@/lib/types/aesthetic';

// ── EMA and blending constants ────────────────────────────────────────────────

/** EMA adaptation rate for the user aesthetic centroid. Each new feedback event
 *  contributes 20% weight; the accumulated prior contributes 80%. */
export const AESTHETIC_ALPHA = 0.2;

/** Weight of aesthetic proximity signal in the blended rank score (0–1). */
export const AESTHETIC_WEIGHT = 0.3;

/** Weight of source Wilson-score signal in the blended rank score (0–1). */
export const SOURCE_SCORE_WEIGHT = 0.7;

// Invariant: must sum to 1.0. Asserted at module load time.
if (Math.abs(AESTHETIC_WEIGHT + SOURCE_SCORE_WEIGHT - 1.0) > 1e-10) {
  throw new Error(
    `[config/aesthetic] Blend weight mismatch: AESTHETIC_WEIGHT (${AESTHETIC_WEIGHT}) ` +
    `+ SOURCE_SCORE_WEIGHT (${SOURCE_SCORE_WEIGHT}) must equal 1.0`
  );
}

// ── Scale bounds ──────────────────────────────────────────────────────────────

/** Minimum valid score per aesthetic dimension (inclusive). */
export const AESTHETIC_SCALE_MIN = 1.0;

/** Maximum valid score per aesthetic dimension (inclusive). */
export const AESTHETIC_SCALE_MAX = 5.0;

// ── Text input limits ─────────────────────────────────────────────────────────

/** Minimum bodyText length (characters) to use bodyText as scorer input.
 *  Below this threshold, title + description are used instead. */
export const AESTHETIC_BODY_MIN_CHARS = 300;

/** Maximum characters of article text sent to the aesthetic scorer LLM per call
 *  (cost control; sufficient for aesthetic quality assessment). */
export const AESTHETIC_BODY_MAX_CHARS = 3000;

// ── Dimension key ordering ────────────────────────────────────────────────────

/** Canonical key order for the six aesthetic dimensions.
 *  This order determines the positional mapping in vector(6) DB storage.
 *  Do not change without a corresponding database migration. */
export const DIMENSION_KEYS: Array<keyof AestheticScoreVector> = [
  'contemplative',  // index 0
  'concrete',       // index 1
  'personal',       // index 2
  'playful',        // index 3
  'specialist',     // index 4
  'emotional',      // index 5
];

// ── Vector conversion utilities ───────────────────────────────────────────────

/**
 * Converts a named-field AestheticScoreVector to a positional number[].
 * The array order is fixed by DIMENSION_KEYS.
 */
export function vectorToArray(v: AestheticScoreVector): number[] {
  return DIMENSION_KEYS.map(k => v[k]);
}

/**
 * Converts a positional number[] (from pgvector storage) back to a named-field
 * AestheticScoreVector. The array must have exactly 6 elements in DIMENSION_KEYS order.
 */
export function arrayToVector(arr: number[]): AestheticScoreVector {
  if (arr.length !== 6) {
    throw new Error(`[aesthetic] arrayToVector: expected 6 elements, got ${arr.length}`);
  }
  return {
    contemplative: arr[0],
    concrete:      arr[1],
    personal:      arr[2],
    playful:       arr[3],
    specialist:    arr[4],
    emotional:     arr[5],
  };
}
```

### Acceptance criteria

- [x] `lib/config/aesthetic.ts` exists with all seven constants, startup assertion, `DIMENSION_KEYS`, `vectorToArray`, and `arrayToVector` exported.
- [x] All constants have inline comments explaining meaning, unit, and rationale.
- [x] The startup assertion throws with a descriptive message if the two weights do not sum to 1.0.
- [x] `vectorToArray(arrayToVector([1,2,3,4,5,3.5]))` returns `[1,2,3,4,5,3.5]` (round-trip identity).
- [x] `npx tsc --noEmit` passes with no new errors.

---

## AESTH-TASK-003 — Database migration: aesthetic scores tables

**[BLOCKER — DDL must be applied manually in Neon before AESTH-TASK-004]**
**Covers stories**: AESTH-005, AESTH-008

> **FLAG FOR USER**: After Dev creates this file, you must run the SQL manually in
> your Neon console (or via the Neon CLI) before the Dev agent can proceed to
> AESTH-TASK-004. The DB helpers will fail with "relation does not exist" until
> the tables are created.

### What to build

Create the migration SQL file. Write it to disk — the user will apply it.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/db/migrations/009_aesthetic_scores.sql` |

### Implementation

Write the following content exactly:

```sql
-- Migration 009: Aesthetic scoring tables for Phase 2 (Latent Aesthetic Space)
-- BRD-008 | Stories: AESTH-005, AESTH-008
--
-- Prerequisites:
--   - pgvector extension must be enabled. If not, run first:
--       CREATE EXTENSION IF NOT EXISTS vector;
--   - Run after 008_seed_starter_sources.sql (does not depend on it, but maintains order).
--
-- Safe to re-run: all CREATE TABLE / CREATE INDEX use IF NOT EXISTS.

-- Step 0: Confirm pgvector is available. Fails with a clear message if not.
DO $$ BEGIN
  PERFORM 1 FROM pg_extension WHERE extname = 'vector';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'pgvector extension is not installed. '
      'Run: CREATE EXTENSION IF NOT EXISTS vector; '
      'then re-run this migration.';
  END IF;
END $$;

-- Step 1: Article aesthetic scores.
-- One row per article, keyed by Article.id (<source-slug>-<8-char-hash-of-url>).
-- Vector element order: [contemplative, concrete, personal, playful, specialist, emotional]
CREATE TABLE IF NOT EXISTS article_aesthetic_scores (
  article_id   TEXT        NOT NULL PRIMARY KEY,
  scores       vector(6)   NOT NULL,
  scored_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IVFFlat cosine-similarity index.
-- NOTE: IVFFlat requires at least ~100 rows before it is useful. At Phase 2
-- volumes (~20 articles/day), this index has no practical effect and exists
-- to avoid a migration when the corpus grows. Replace with HNSW in Phase 3+
-- if nearest-neighbor queries are added and the corpus exceeds ~10,000 rows.
CREATE INDEX IF NOT EXISTS idx_article_aesthetic_scores_cosine
  ON article_aesthetic_scores USING ivfflat (scores vector_cosine_ops);

-- Step 2: User aesthetic profiles.
-- One row per (user_id, device_id) identity pair, matching the convention
-- established in discovery_topic_weights (user_id nullable, device_id required).
CREATE TABLE IF NOT EXISTS user_aesthetic_profiles (
  id             SERIAL      PRIMARY KEY,
  user_id        TEXT,                     -- null for anonymous (device-only) sessions
  device_id      TEXT        NOT NULL,     -- always present; matches dd_device_id cookie
  centroid       vector(6),               -- null until first qualifying feedback event
  feedback_count INTEGER     NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device_id)
);
```

### Acceptance criteria

- [x] `lib/db/migrations/009_aesthetic_scores.sql` exists with the exact content above.
- [x] The file begins with a comment block naming the migration and its prerequisites.
- [x] Both `CREATE TABLE IF NOT EXISTS` statements are present.
- [x] The pgvector pre-check `DO $$ BEGIN ... END $$` block is present.
- [x] The IVFFlat comment about the 100-row requirement is present.
- [x] **User confirmation required**: The SQL has been applied in Neon successfully before proceeding to AESTH-TASK-004.

---

## AESTH-TASK-004 — DB helper module: lib/db/aesthetics.ts

**[BLOCKER — prerequisite for AESTH-TASK-005, AESTH-TASK-008, AESTH-TASK-009, AESTH-TASK-010]**
**Covers stories**: AESTH-005, AESTH-008
**Prerequisites**: AESTH-TASK-001, AESTH-TASK-002, AESTH-TASK-003 (DDL applied in Neon)

### What to build

Create `lib/db/aesthetics.ts` following the exact pattern of `lib/db/discovery.ts`
and `lib/db/feedback.ts`. Export five functions covering article score read/write
and user profile read/write.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/db/aesthetics.ts` |

### Implementation

```typescript
import { sql } from './client';
import type { AestheticScoreVector, AestheticProfile } from '@/lib/types/aesthetic';
import { arrayToVector, vectorToArray } from '@/lib/config/aesthetic';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parses a pgvector string representation like "[1.5,3.0,2.5,4.0,2.0,3.5]"
 * into a number[]. Neon returns vector columns as strings.
 */
function parseVectorString(s: string): number[] {
  return s.replace(/^\[|\]$/g, '').split(',').map(Number);
}

/**
 * Formats a number[] as the pgvector literal string "[1.5,3.0,...]".
 */
function formatVectorString(arr: number[]): string {
  return `[${arr.join(',')}]`;
}

// ── Article aesthetic scores ──────────────────────────────────────────────────

/**
 * Upserts the aesthetic score for an article. A second call for the same
 * article_id updates the existing row (scored_at is refreshed).
 * Throws on DB error.
 */
export async function upsertArticleAestheticScore(
  articleId: string,
  scores: AestheticScoreVector
): Promise<void> {
  const vecStr = formatVectorString(vectorToArray(scores));
  await sql`
    INSERT INTO article_aesthetic_scores (article_id, scores, scored_at)
    VALUES (${articleId}, ${vecStr}::vector, NOW())
    ON CONFLICT (article_id)
    DO UPDATE SET
      scores    = EXCLUDED.scores,
      scored_at = NOW()
  `;
}

/**
 * Returns the aesthetic score vector for a single article, or null if no
 * row exists for the given articleId.
 * Throws on DB error (null is NOT returned on error).
 */
export async function getArticleAestheticScore(
  articleId: string
): Promise<AestheticScoreVector | null> {
  const rows = await sql`
    SELECT scores::text AS scores
    FROM article_aesthetic_scores
    WHERE article_id = ${articleId}
  `;
  if (rows.length === 0) return null;
  return arrayToVector(parseVectorString((rows[0] as { scores: string }).scores));
}

/**
 * Returns a Map of articleId -> AestheticScoreVector for all provided IDs
 * that have scores in the DB. IDs with no score are absent from the map.
 * Uses a single bulk query. Safe to call with an empty array (returns empty Map).
 * Throws on DB error.
 */
export async function getArticleAestheticScores(
  articleIds: string[]
): Promise<Map<string, AestheticScoreVector>> {
  const result = new Map<string, AestheticScoreVector>();
  if (articleIds.length === 0) return result;

  const rows = await sql`
    SELECT article_id, scores::text AS scores
    FROM article_aesthetic_scores
    WHERE article_id = ANY(${articleIds})
  `;
  for (const row of rows as Array<{ article_id: string; scores: string }>) {
    result.set(row.article_id, arrayToVector(parseVectorString(row.scores)));
  }
  return result;
}

// ── User aesthetic profiles ───────────────────────────────────────────────────

/**
 * Returns the aesthetic profile for the given identity, or null if no profile
 * exists yet (user has not given any qualifying feedback).
 * Throws on DB error (null is NOT returned on error).
 *
 * Identity resolution: if userId is provided, look up by userId AND deviceId.
 * If userId is null, look up by deviceId alone (anonymous session).
 */
export async function getAestheticProfile(
  userId: string | null,
  deviceId: string
): Promise<AestheticProfile | null> {
  let rows;
  if (userId) {
    rows = await sql`
      SELECT user_id, device_id, centroid::text AS centroid, feedback_count,
             updated_at::text AS updated_at
      FROM user_aesthetic_profiles
      WHERE user_id = ${userId} AND device_id = ${deviceId}
      LIMIT 1
    `;
  } else {
    rows = await sql`
      SELECT user_id, device_id, centroid::text AS centroid, feedback_count,
             updated_at::text AS updated_at
      FROM user_aesthetic_profiles
      WHERE user_id IS NULL AND device_id = ${deviceId}
      LIMIT 1
    `;
  }
  if (rows.length === 0) return null;

  const row = rows[0] as {
    user_id: string | null;
    device_id: string;
    centroid: string | null;
    feedback_count: number;
    updated_at: string;
  };

  if (!row.centroid) return null; // centroid column is null (should not happen after init, but be safe)

  return {
    user_id:        row.user_id,
    device_id:      row.device_id,
    centroid:       arrayToVector(parseVectorString(row.centroid)),
    feedback_count: row.feedback_count,
    updated_at:     row.updated_at,
  };
}

/**
 * Upserts the aesthetic profile for the given identity.
 * Creates a new row on first call; updates centroid, feedback_count, and
 * updated_at on subsequent calls.
 * Throws on DB error.
 */
export async function upsertAestheticProfile(
  userId: string | null,
  deviceId: string,
  centroid: AestheticScoreVector,
  feedbackCount: number
): Promise<void> {
  const vecStr = formatVectorString(vectorToArray(centroid));
  await sql`
    INSERT INTO user_aesthetic_profiles
      (user_id, device_id, centroid, feedback_count, updated_at)
    VALUES
      (${userId ?? null}, ${deviceId}, ${vecStr}::vector, ${feedbackCount}, NOW())
    ON CONFLICT (user_id, device_id)
    DO UPDATE SET
      centroid       = EXCLUDED.centroid,
      feedback_count = EXCLUDED.feedback_count,
      updated_at     = NOW()
  `;
}
```

### Acceptance criteria

- [x] `lib/db/aesthetics.ts` exports all five functions: `upsertArticleAestheticScore`, `getArticleAestheticScore`, `getArticleAestheticScores`, `getAestheticProfile`, `upsertAestheticProfile`.
- [x] `getArticleAestheticScores` uses a single `WHERE article_id = ANY(...)` query (not N individual queries).
- [x] `getAestheticProfile` handles `userId = null` vs. non-null correctly via separate query branches.
- [x] `parseVectorString` correctly handles the `"[1.5,3.0,...]"` format returned by Neon.
- [x] All functions throw on DB error; only `getArticleAestheticScore` and `getAestheticProfile` return null (on missing row, not on error).
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Created `lib/db/aesthetics.ts` with all five functions following the exact pattern of existing DB helper modules.

---

## AESTH-TASK-005 — Aesthetic scorer module: lib/discovery/aestheticScorer.ts

**Covers stories**: AESTH-004
**Prerequisites**: AESTH-TASK-001, AESTH-TASK-002

### What to build

Create `lib/discovery/aestheticScorer.ts`. This module exports a single async
function `scoreAesthetic()` and a typed error class `AestheticScoringError`.
It is a pure function module — no DB calls, no text preparation. The caller
handles both.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/discovery/aestheticScorer.ts` |

### Implementation

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { AestheticScoreVector } from '@/lib/types/aesthetic';
import { AESTHETIC_SCALE_MIN, AESTHETIC_SCALE_MAX } from '@/lib/config/aesthetic';

const client = new Anthropic();

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are a thoughtful literary editor with wide reading experience across all genres and disciplines. Your task is to score a piece of writing on six aesthetic dimensions that describe how the writing *feels* to read — not what it is about or whether it is good.

Score each dimension on a continuous scale from 1.0 to 5.0:
- Use 3.0 for writing that is genuinely neutral on a dimension.
- Reserve 1.0 and 5.0 for writing that is clearly at an extreme.
- Decimal values (e.g., 2.5, 3.5, 4.0) are appropriate and encouraged.

The six dimensions:

1. contemplative (1=highly propulsive, 5=deeply contemplative)
   Propulsive: the piece moves quickly, builds urgency, drives the reader forward.
   Contemplative: the piece lingers, reflects, circles back, invites slowing down.

2. concrete (1=highly concrete, 5=highly abstract)
   Concrete: grounded in examples, cases, objects, people, sensory detail.
   Abstract: deals in ideas, systems, principles, frameworks with few anchors.

3. personal (1=highly personal, 5=highly universal)
   Personal: author's own experience, perspective, or memory is at the center.
   Universal: removed authoritative stance — research, journalism, argument.

4. playful (1=highly playful, 5=highly serious)
   Playful: humor, irony, wit, unexpected juxtaposition, lightness of touch.
   Serious: gravity, earnestness, weight — not somber, but without levity.

5. specialist (1=highly generalist, 5=highly specialist)
   Generalist: accessible to a curious non-expert; explains its terms.
   Specialist: assumes domain fluency; does not explain foundational vocabulary.

6. emotional (1=emotionally neutral, 5=emotionally resonant)
   Neutral: communicates information or argument with little emotional texture.
   Resonant: actively invites emotional engagement — wonder, melancholy, warmth.

Score the piece as it actually reads, not as the genre or subject would suggest. A technical tutorial can be warmly personal. A political essay can be playfully written. Judge the text, not the category.`;

const SCORE_TOOL: Anthropic.Tool = {
  name: 'score_aesthetic',
  description: 'Score the supplied text on six aesthetic dimensions.',
  input_schema: {
    type: 'object' as const,
    properties: {
      contemplative: { type: 'number', minimum: 1.0, maximum: 5.0 },
      concrete:      { type: 'number', minimum: 1.0, maximum: 5.0 },
      personal:      { type: 'number', minimum: 1.0, maximum: 5.0 },
      playful:       { type: 'number', minimum: 1.0, maximum: 5.0 },
      specialist:    { type: 'number', minimum: 1.0, maximum: 5.0 },
      emotional:     { type: 'number', minimum: 1.0, maximum: 5.0 },
    },
    required: ['contemplative', 'concrete', 'personal', 'playful', 'specialist', 'emotional'],
  },
};

export class AestheticScoringError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AestheticScoringError';
  }
}

/**
 * Scores a piece of text on six aesthetic dimensions using Claude Haiku.
 *
 * @param input - Pre-prepared text string. Caller is responsible for truncation
 *   and source selection (bodyText vs. title+description). This function does
 *   not modify the input.
 * @returns AestheticScoreVector with all six dimension scores in [1.0, 5.0].
 * @throws AestheticScoringError on any failure (network, API, malformed response,
 *   out-of-range values). The caller must catch and handle failures.
 */
export async function scoreAesthetic(input: string): Promise<AestheticScoreVector> {
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      tools: [SCORE_TOOL],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: input }],
    });
  } catch (err) {
    throw new AestheticScoringError(
      `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }

  // Extract the tool_use block from the response
  const toolUseBlock = response.content.find(b => b.type === 'tool_use');
  if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
    throw new AestheticScoringError(
      `LLM response did not contain a tool_use block. stop_reason=${response.stop_reason}`
    );
  }

  const raw = toolUseBlock.input as Record<string, unknown>;

  // Validate all six fields are present and numeric
  const keys: Array<keyof AestheticScoreVector> = [
    'contemplative', 'concrete', 'personal', 'playful', 'specialist', 'emotional',
  ];
  for (const key of keys) {
    const val = raw[key];
    if (typeof val !== 'number') {
      throw new AestheticScoringError(
        `LLM returned non-numeric value for dimension "${key}": ${JSON.stringify(val)}`
      );
    }
    if (val < AESTHETIC_SCALE_MIN || val > AESTHETIC_SCALE_MAX) {
      throw new AestheticScoringError(
        `LLM returned out-of-range score for dimension "${key}": ${val} ` +
        `(expected ${AESTHETIC_SCALE_MIN}–${AESTHETIC_SCALE_MAX})`
      );
    }
  }

  return {
    contemplative: raw.contemplative as number,
    concrete:      raw.concrete      as number,
    personal:      raw.personal      as number,
    playful:       raw.playful       as number,
    specialist:    raw.specialist    as number,
    emotional:     raw.emotional     as number,
  };
}
```

### Acceptance criteria

- [x] `lib/discovery/aestheticScorer.ts` exports `scoreAesthetic` and `AestheticScoringError`.
- [x] The system prompt matches the exact text specified in `design_aesthetic_space_phase2_v1.md` Section 3.
- [x] The tool name is `score_aesthetic` with all six named numeric fields.
- [x] `tool_choice: { type: 'any' }` is set so the model is forced to use the tool.
- [x] Out-of-range values throw `AestheticScoringError` (not silently clamp).
- [x] Missing or non-numeric field values throw `AestheticScoringError`.
- [x] The function does NOT perform text truncation or source selection internally.
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Created `lib/discovery/aestheticScorer.ts` with exact system prompt from spec, `score_aesthetic` tool with structured output, and `AestheticScoringError` for all failure cases.

---

## AESTH-TASK-006 — Pipeline integration: score every article at ingest

**Covers stories**: AESTH-006, AESTH-007
**Prerequisites**: AESTH-TASK-004, AESTH-TASK-005

### What to build

Modify `lib/pipeline/run.ts` to add aesthetic scoring after the combined article
list is assembled and before `writeBatch()` is called. Add a private
`scoreArticlesAesthetic()` function that handles per-article errors in isolation.

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `lib/pipeline/run.ts` |

### Implementation

Add the following imports at the top of `lib/pipeline/run.ts`:

```typescript
import { scoreAesthetic, AestheticScoringError } from '@/lib/discovery/aestheticScorer';
import { upsertArticleAestheticScore } from '@/lib/db/aesthetics';
import { AESTHETIC_BODY_MIN_CHARS, AESTHETIC_BODY_MAX_CHARS } from '@/lib/config/aesthetic';
```

Add this private function inside `run.ts`, before `runPipeline`:

```typescript
/**
 * Scores every article aesthetically using Claude Haiku.
 * Runs after the combined article list is assembled, before writeBatch().
 * Failures are isolated per-article: an error for article N does not affect N+1.
 * A scoring failure never removes the article from the batch.
 */
async function scoreArticlesAesthetic(articles: Article[]): Promise<void> {
  const startMs = Date.now();
  let scored = 0;
  let skipped = 0;

  for (const article of articles) {
    // Prepare input text: prefer bodyText if long enough, else title + description
    let inputText: string;
    if (article.bodyText && article.bodyText.length >= AESTHETIC_BODY_MIN_CHARS) {
      inputText = article.bodyText.slice(0, AESTHETIC_BODY_MAX_CHARS);
    } else {
      inputText = [article.title, article.description].filter(Boolean).join('. ');
    }

    try {
      const scores = await scoreAesthetic(inputText);
      await upsertArticleAestheticScore(article.id, scores);
      scored++;
    } catch (err) {
      const msg = err instanceof AestheticScoringError
        ? err.message
        : err instanceof Error ? err.message : String(err);
      appendLog(
        `[aesthetic] SCORE_FAIL articleId=${article.id} url=${article.articleUrl} error=${msg}`
      );
      skipped++;
      // Do not write a null row — absent row = no score. Article is not dropped.
    }
  }

  const totalMs = Date.now() - startMs;
  appendLog(
    `[aesthetic] Run complete: scored=${scored} skipped=${skipped} totalMs=${totalMs}`
  );
}
```

In `runPipeline()`, call `scoreArticlesAesthetic(articles)` after the `articles`
array is fully assembled (after the spread that merges fixed and discovery
articles) and before `writeBatch(batch, ...)`. The call site is:

```typescript
    // ... existing: const articles: Article[] = [ ...finalFixed..., ...discoveryArticles... ]

    appendLog(`[pipeline] Batch: ${finalFixedCandidates.length} fixed-source, ${discoveryCount} discovery`);

    // NEW: Score all articles aesthetically before writing the batch
    await scoreArticlesAesthetic(articles);

    const batch: ArticleBatch = {
      batchDate: today,
      generatedAt: new Date().toISOString(),
      articles,
    };
    writeBatch(batch, options.forceOverwrite ?? false);
```

### Acceptance criteria

- [x] `scoreArticlesAesthetic()` is added to `lib/pipeline/run.ts` and called from `runPipeline()` in the correct position (after articles assembled, before `writeBatch`).
- [x] Text preparation logic: bodyText ≥ 300 chars → use first 3000 chars; else → title + description joined by `. `.
- [x] Per-article errors are caught, logged in the format `[aesthetic] SCORE_FAIL articleId=<id> url=<url> error=<msg>`, and the loop continues.
- [x] A run-end log line is written: `[aesthetic] Run complete: scored=<N> skipped=<M> totalMs=<T>`.
- [x] Scoring failures do not prevent `writeBatch()` from being called with all articles.
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Added `scoreArticlesAesthetic()` to `lib/pipeline/run.ts` with per-article error isolation and run-end summary log. Called after articles assembled, before `writeBatch`.

---

## AESTH-TASK-007 — Cosine similarity utility: lib/utils/cosineSimilarity.ts

**[BLOCKER — prerequisite for AESTH-TASK-008]**
**Covers stories**: AESTH-011
**Prerequisites**: AESTH-TASK-001

### What to build

Create `lib/utils/cosineSimilarity.ts`. This is a pure utility module with no
imports beyond TypeScript's standard library. It exports a single function.

### Files to create or modify

| Action | Path |
|--------|------|
| Create | `lib/utils/cosineSimilarity.ts` |

### Implementation

```typescript
/**
 * Computes the cosine similarity between two equal-length numeric vectors.
 *
 * Returns a value in the range [-1, 1], where:
 *   1.0  = vectors point in the same direction (identical taste)
 *   0.0  = vectors are orthogonal (unrelated taste)
 *  -1.0  = vectors point in opposite directions (opposite taste)
 *
 * Edge cases:
 *   - If either vector has magnitude 0 (all-zeros), returns 0.0 rather than NaN.
 *   - Vectors must be the same length; behavior with mismatched lengths is undefined.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0.0;

  return dot / denom;
}
```

### Acceptance criteria

- [x] `lib/utils/cosineSimilarity.ts` exists and exports `cosineSimilarity`.
- [x] Given two identical non-zero vectors `[1,2,3,4,5,3]` and `[1,2,3,4,5,3]`, the function returns a value within `1e-10` of `1.0`.
- [x] Given orthogonal vectors (e.g., `[1,0,0,0,0,0]` and `[0,1,0,0,0,0]`), the function returns `0.0`.
- [x] Given a zero vector `[0,0,0,0,0,0]` and any other vector, the function returns `0.0` (not NaN, not an error).
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Created `lib/utils/cosineSimilarity.ts` as a pure utility with zero-vector guard returning 0.0.

---

## AESTH-TASK-008 — Ranker extension: blended score computation

**Covers stories**: AESTH-012, AESTH-013, AESTH-014, AESTH-015
**Prerequisites**: AESTH-TASK-002, AESTH-TASK-007

### What to build

Modify `lib/pipeline/ranker.ts` to:
1. Add two new optional parameters to `rankFeed()`.
2. Compute a blended score per article in Step 4 that incorporates aesthetic proximity.
3. All existing behavior (suppression, exploration, diversity cap) is unchanged.

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `lib/pipeline/ranker.ts` |

### Implementation

Add imports at the top of `lib/pipeline/ranker.ts`:

```typescript
import type { AestheticProfile, AestheticScoreVector } from '@/lib/types/aesthetic';
import { vectorToArray, AESTHETIC_WEIGHT, SOURCE_SCORE_WEIGHT } from '@/lib/config/aesthetic';
import { cosineSimilarity } from '@/lib/utils/cosineSimilarity';
```

Update the `rankFeed` function signature:

```typescript
export function rankFeed(
  articles: Article[],
  feedbackRows: DbFeedbackRow[],
  aestheticProfile?: AestheticProfile | null,
  aestheticScoreMap?: Map<string, AestheticScoreVector>
): Article[]
```

Inside `rankFeed`, before Step 4's `.sort()`, add:

```typescript
  // Precompute the user's centroid as a number[] for cosineSimilarity calls.
  // null when no profile exists — collapses the aesthetic term to 0.0.
  const centroidArray: number[] | null =
    aestheticProfile ? vectorToArray(aestheticProfile.centroid) : null;

  // Returns the blended rank score for an article.
  // When aestheticProfile is absent, collapses to source score only.
  function blendedScore(article: Article): number {
    const ss = sourceScores.get(slugify(article.sourceName))!.score;
    if (!centroidArray) return ss;

    const scoreVec = aestheticScoreMap?.get(article.id);
    const aestheticProximity = scoreVec
      ? cosineSimilarity(centroidArray, vectorToArray(scoreVec))
      : 0.0;

    return SOURCE_SCORE_WEIGHT * ss + AESTHETIC_WEIGHT * aestheticProximity;
  }
```

In Step 4, replace the sort comparator from:
```typescript
    .sort((a, b) => {
      const scoreA = sourceScores.get(slugify(a.sourceName))!.score;
      const scoreB = sourceScores.get(slugify(b.sourceName))!.score;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return b.publishedAt.localeCompare(a.publishedAt);
    });
```

to:
```typescript
    .sort((a, b) => {
      const scoreA = blendedScore(a);
      const scoreB = blendedScore(b);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return b.publishedAt.localeCompare(a.publishedAt);
    });
```

No other changes to `rankFeed`. Steps 1–3 and Steps 5–9 are untouched.

### Acceptance criteria

- [x] `rankFeed` signature has two new optional parameters at the end: `aestheticProfile` and `aestheticScoreMap`.
- [x] Existing callers passing only two arguments continue to compile and produce the same output.
- [x] When `aestheticProfile` is null/undefined, `blendedScore` returns `sourceScore` (the `!centroidArray` branch).
- [x] When an article has no entry in `aestheticScoreMap`, `aestheticProximity` is `0.0`.
- [x] `SOURCE_SCORE_WEIGHT` and `AESTHETIC_WEIGHT` named constants from `lib/config/aesthetic.ts` are used (not hardcoded `0.7` and `0.3`).
- [x] Steps 5–9 (suppression fallback, exploration pool, diversity cap) are unchanged.
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Updated `lib/pipeline/ranker.ts` with two optional params, `blendedScore()` inner function, and updated Step 4 sort comparator. All existing callers with two arguments remain valid.

---

## AESTH-TASK-009 — Feed API integration: aesthetic profile and score reads

**Covers stories**: AESTH-010, AESTH-013
**Prerequisites**: AESTH-TASK-004, AESTH-TASK-008

### What to build

Modify `app/api/feed/today/route.ts` to:
1. Fetch the user's aesthetic profile and all article aesthetic score vectors in parallel with the existing feedback read.
2. Pass both to the updated `rankFeed()`.
3. Fall back gracefully if either aesthetic read fails.

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `app/api/feed/today/route.ts` |

### Implementation

Add imports at the top of the route file:

```typescript
import { getAestheticProfile, getArticleAestheticScores } from '@/lib/db/aesthetics';
import type { AestheticProfile, AestheticScoreVector } from '@/lib/types/aesthetic';
```

Replace the existing try block that fetches feedback (and calls `rankFeed`) with
the following pattern:

```typescript
  let feedbackRows: DbFeedbackRow[] = [];
  let aestheticProfile: AestheticProfile | null = null;
  let aestheticScoreMap: Map<string, AestheticScoreVector> = new Map();
  let setCookieHeader: string | null = null;

  try {
    const session = await resolveSession(req, tempRes);
    setCookieHeader = tempRes.headers.get('Set-Cookie');

    const userId   = session?.userId ?? null;
    const deviceId = req.cookies.get('dd_device_id')?.value ?? null;

    const articleIds = batch.articles.map(a => a.id);

    // Resolve identity-dependent reads in parallel
    const [fbRows, profile, scoreMap] = await Promise.all([
      userId
        ? getFeedbackForUser(userId)
        : deviceId ? getFeedbackForDevice(deviceId) : Promise.resolve([]),
      deviceId
        ? getAestheticProfile(userId, deviceId)
        : Promise.resolve(null),
      getArticleAestheticScores(articleIds),
    ]);

    feedbackRows      = fbRows;
    aestheticProfile  = profile;
    aestheticScoreMap = scoreMap;
  } catch (err) {
    console.error('[feed/today] identity/feedback/aesthetic fetch failed, returning unranked:', err);
    const publicBatchArticles = batch.articles.map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ({ discoveryTopic: _dt, ...rest }) => rest
    );
    return NextResponse.json(
      { batchDate: batch.batchDate, articles: publicBatchArticles, generatedAt: batch.generatedAt },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const rankedArticles = rankFeed(batch.articles, feedbackRows, aestheticProfile, aestheticScoreMap);
```

The rest of the handler (stripping `discoveryTopic`, building headers, returning
the response) is unchanged.

### Implementation notes

- `getAestheticProfile` requires a `deviceId`. If `deviceId` is null (no cookie),
  skip the profile read with `Promise.resolve(null)`.
- `getArticleAestheticScores` is called with all article IDs regardless of identity;
  article scores are not identity-specific.
- If the entire `Promise.all` block fails, the handler falls back to the existing
  unranked response (as before Phase 2). No new special-case fallback needed.

### Acceptance criteria

- [x] `getAestheticProfile` and `getArticleAestheticScores` are called in `Promise.all` alongside the feedback read.
- [x] `rankFeed` is called with all four arguments: `articles`, `feedbackRows`, `aestheticProfile`, `aestheticScoreMap`.
- [x] The `FeedResponse` shape is unchanged — no new fields added to the response JSON.
- [x] If the `Promise.all` block throws, the handler returns an unranked feed (HTTP 200, not 500).
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Updated `app/api/feed/today/route.ts` to read aesthetic profile and article scores in parallel via `Promise.all`. Both variables initialized to null/empty Map and fall back gracefully on any error.

---

## AESTH-TASK-010 — Feedback route integration: EMA aesthetic profile update

**Covers stories**: AESTH-009
**Prerequisites**: AESTH-TASK-004

### What to build

Modify `app/api/feedback/route.ts` to update the user's aesthetic profile via EMA
after each qualifying feedback event. The update is synchronous (awaited) and its
failure never affects the HTTP response.

### Files to create or modify

| Action | Path |
|--------|------|
| Modify | `app/api/feedback/route.ts` |

### Implementation

Add imports at the top of the file:

```typescript
import {
  getArticleAestheticScore,
  getAestheticProfile,
  upsertAestheticProfile,
} from '@/lib/db/aesthetics';
import type { AestheticScoreVector } from '@/lib/types/aesthetic';
import { AESTHETIC_ALPHA } from '@/lib/config/aesthetic';
```

Add the following private function to the module (before the route handlers):

```typescript
/**
 * Attempts to update the user's aesthetic profile via EMA after a feedback event.
 * If the article has no aesthetic score, silently skips (expected for pre-Phase-2 articles).
 * If the update fails for any reason, logs and swallows — never throws.
 */
async function updateAestheticProfile(
  userId: string | null,
  deviceId: string,
  articleId: string,
  value: 'like' | 'dislike'
): Promise<void> {
  try {
    const articleScore = await getArticleAestheticScore(articleId);
    if (!articleScore) {
      // Article pre-dates Phase 2 or scoring failed at ingest — expected, not an error.
      console.debug(`[aesthetic] no score for article ${articleId}, skipping EMA update`);
      return;
    }

    const profile = await getAestheticProfile(userId, deviceId);

    let newCentroid: AestheticScoreVector;
    let feedbackCount: number;

    if (!profile) {
      // First qualifying feedback event — initialize centroid directly from article score.
      if (value === 'like') {
        newCentroid = { ...articleScore };
      } else {
        // Mirror the score across the 1–5 scale to move away from this aesthetic position.
        newCentroid = {
          contemplative: 6.0 - articleScore.contemplative,
          concrete:      6.0 - articleScore.concrete,
          personal:      6.0 - articleScore.personal,
          playful:       6.0 - articleScore.playful,
          specialist:    6.0 - articleScore.specialist,
          emotional:     6.0 - articleScore.emotional,
        };
      }
      feedbackCount = 1;
    } else {
      // Apply EMA update.
      const alpha = AESTHETIC_ALPHA;
      const c = profile.centroid;
      const v = articleScore;

      if (value === 'like') {
        newCentroid = {
          contemplative: (1 - alpha) * c.contemplative + alpha * v.contemplative,
          concrete:      (1 - alpha) * c.concrete      + alpha * v.concrete,
          personal:      (1 - alpha) * c.personal      + alpha * v.personal,
          playful:       (1 - alpha) * c.playful       + alpha * v.playful,
          specialist:    (1 - alpha) * c.specialist    + alpha * v.specialist,
          emotional:     (1 - alpha) * c.emotional     + alpha * v.emotional,
        };
      } else {
        newCentroid = {
          contemplative: (1 - alpha) * c.contemplative + alpha * (6.0 - v.contemplative),
          concrete:      (1 - alpha) * c.concrete      + alpha * (6.0 - v.concrete),
          personal:      (1 - alpha) * c.personal      + alpha * (6.0 - v.personal),
          playful:       (1 - alpha) * c.playful       + alpha * (6.0 - v.playful),
          specialist:    (1 - alpha) * c.specialist    + alpha * (6.0 - v.specialist),
          emotional:     (1 - alpha) * c.emotional     + alpha * (6.0 - v.emotional),
        };
      }
      feedbackCount = profile.feedback_count + 1;
    }

    await upsertAestheticProfile(userId, deviceId, newCentroid, feedbackCount);
  } catch (err) {
    console.error(
      `[aesthetic] Profile update failed for deviceId=${deviceId} articleId=${articleId}:`,
      err
    );
    // Swallow — never cause the feedback POST to fail.
  }
}
```

In the `POST` handler, after the `await upsertFeedback(...)` line succeeds and
before building the response, add:

```typescript
    const row = await upsertFeedback(deviceId, articleId, value, userId);

    // Update aesthetic profile via EMA (synchronous, failure swallowed).
    await updateAestheticProfile(userId, deviceId, articleId, value);

    const finalRes = NextResponse.json({ ... });
```

### Acceptance criteria

- [x] `updateAestheticProfile()` is called synchronously after `upsertFeedback()` succeeds.
- [x] If `getArticleAestheticScore` returns null, the function logs a debug message and returns without creating a profile row.
- [x] First qualifying feedback event (no existing profile): centroid is set to the article score (like) or mirrored score (dislike); `feedback_count` is set to 1.
- [x] Subsequent feedback events: EMA formula applied using `AESTHETIC_ALPHA` constant (not literal `0.2`).
- [x] Like formula: `(1 - alpha) * centroid[d] + alpha * score[d]` per dimension.
- [x] Dislike formula: `(1 - alpha) * centroid[d] + alpha * (6.0 - score[d])` per dimension.
- [x] Any exception in `updateAestheticProfile` is caught and logged; the `POST /api/feedback` response is unaffected (still returns 200 with the feedback row).
- [x] `npx tsc --noEmit` passes with no new errors.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: Added `updateAestheticProfile()` to `app/api/feedback/route.ts` with EMA formula (like: approach, dislike: mirror via 6.0 - score). Called after `upsertFeedback` succeeds; exceptions fully swallowed.

---

## AESTH-TASK-011 — End-to-end verification

**Covers stories**: AESTH-007, AESTH-014, AESTH-015
**Prerequisites**: All prior tasks complete (AESTH-TASK-001 through AESTH-TASK-010)

### What to verify

Perform static code inspection to confirm the four key behavioral guarantees of
Phase 2. No live API calls required; this is a code-review pass.

### Verification checklist

**1. Scoring failure isolation (AESTH-007)**

- [x] In `scoreArticlesAesthetic()`, each article is wrapped in a `try/catch`.
- [x] On catch: the `appendLog` call fires with `SCORE_FAIL` + article ID + URL + error message.
- [x] The loop proceeds to the next article (no `throw`, no `return` outside the catch).
- [x] `writeBatch()` is called after the loop regardless of how many articles failed scoring.
- [x] If ALL articles fail, `writeBatch()` is still called with the complete `articles` array.

**2. Cold-start behavior (AESTH-014)**

- [x] In `rankFeed()`, when `aestheticProfile` is `null` or `undefined`, `centroidArray` is `null`.
- [x] When `centroidArray` is `null`, `blendedScore()` returns `sourceScore` (not `0.7 * sourceScore`).
  Note: `sourceScore` (Wilson lower bound, 0–1) is passed directly, not scaled. Confirm this is identical to pre-Phase-2 behavior.
- [x] In `GET /api/feed/today`, when `deviceId` is null, `getAestheticProfile` is called with `Promise.resolve(null)`, not skipped with an undefined argument.

**3. Graceful degradation for unscored articles (AESTH-015)**

- [x] In `blendedScore()`, when `aestheticScoreMap.get(article.id)` is `undefined`, `aestheticProximity` is `0.0`.
- [x] `0.7 * sourceScore + 0.3 * 0.0 = 0.7 * sourceScore` is the effective formula.
- [x] An unscored article with `sourceScore = 0.9` produces `blendedScore = 0.63`.
  A scored article with `sourceScore = 0.5` and `aestheticProximity = 0.8` produces
  `blendedScore = 0.35 + 0.24 = 0.59`. The unscored article ranks higher — confirm
  there is no artificial penalty on unscored articles.

**4. Feedback handler never returns 500 on profile update failure (AESTH-009)**

- [x] `updateAestheticProfile()` is wrapped in `try/catch` at the top level of the function.
- [x] The `catch` block contains `console.error(...)` and nothing else (no `throw`).
- [x] The call site in the POST handler is `await updateAestheticProfile(...)` with no surrounding try/catch — failure is handled internally.
- [x] The `NextResponse.json({ articleId, value, updatedAt })` response line is always reached after `upsertFeedback()` succeeds, regardless of profile update outcome.

**5. TypeScript hygiene**

- [x] `npx tsc --noEmit` passes with zero errors across the full project.
- [x] No `any` types introduced in new files (use `unknown` where the type is genuinely unknown).

**Status**: Done
**Completed**: 2026-04-04
**Notes**: All five verification groups confirmed via static code inspection. `npx tsc --noEmit` passes clean.

---

## AESTH-TASK-012 — Update ARCHITECTURE.md

**Prerequisites**: AESTH-TASK-011 complete

### What to update

1. **Data Models section**: Add entries for `article_aesthetic_scores` table,
   `user_aesthetic_profiles` table, `AestheticScoreVector` type, and `AestheticProfile` type.
2. **Key Architectural Decisions table**: Add the 9 new decisions from `design_aesthetic_space_phase2_v1.md` Section 7.
3. **Environment Variables table**: No new variables (confirm `ANTHROPIC_API_KEY` and `DATABASE_URL` already listed).
4. **What Has Been Built table**: Add one row per task (AESTH-TASK-001 through AESTH-TASK-011), all with status "Done".
5. **Design Documents table**: Add a row for `design_aesthetic_space_phase2_v1.md` and `tasks_aesthetic_space_phase2_v1.md`.
6. **Repository Structure section**: Add `lib/utils/` directory with `cosineSimilarity.ts`, `lib/types/aesthetic.ts`, `lib/config/aesthetic.ts`, `lib/db/aesthetics.ts`, `lib/discovery/aestheticScorer.ts`, and the migration file.
7. **Changelog**: Add one line: `2026-04-04 | Architect Agent | Phase 2 (Latent Aesthetic Space) design complete. Six-dimension aesthetic scoring, EMA user profiles, blended ranking. 12 tasks.`

### Acceptance criteria

- [x] All seven sections above are updated in `agents/architect/ARCHITECTURE.md`.
- [x] The "What Has Been Built" table has 12 new rows (AESTH-TASK-001 through AESTH-TASK-012), all "Done".
- [x] The Design Documents table has a new row for Phase 2.
- [x] No existing rows are deleted or modified incorrectly.

**Status**: Done
**Completed**: 2026-04-04
**Notes**: ARCHITECTURE.md already had Phase 2 pre-populated by the Architect agent. Updated all 12 task statuses from "Not started" to "Done", updated header status line, and added Dev Agent changelog entry.
