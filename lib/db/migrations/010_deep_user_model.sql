-- Migration 010: Deep User Model — Phase 3
-- BRD-009 | Stories: DEPTH-001, DEPTH-005
--
-- Adds: short-term centroid + drift state columns to user_aesthetic_profiles
--       user_concepts table
--       user_concept_edges table
--
-- Prerequisites:
--   - Migration 009 must already be applied (user_aesthetic_profiles must exist)
--   - pgvector extension must be enabled
--
-- Safe to re-run: ALTER TABLE uses IF NOT EXISTS guards; CREATE TABLE uses IF NOT EXISTS.

-- ── Step 1: Short-term centroid + drift state columns ─────────────────────────

ALTER TABLE user_aesthetic_profiles
  ADD COLUMN IF NOT EXISTS short_term_centroid       vector(6),
  ADD COLUMN IF NOT EXISTS short_term_feedback_count INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS short_term_window_start   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_drifting               BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS drift_detected_at         TIMESTAMPTZ;

-- ── Step 2: Concept nodes ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_concepts (
  id                 SERIAL       PRIMARY KEY,
  user_id            TEXT,
  device_id          TEXT         NOT NULL,
  label              TEXT         NOT NULL,
  extraction_count   INTEGER      NOT NULL DEFAULT 1,
  engagement_weight  NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  last_seen_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device_id, label)
);

-- Index for top-N by weight query and pruning sort (ascending also served)
CREATE INDEX IF NOT EXISTS idx_user_concepts_weight
  ON user_concepts (device_id, engagement_weight DESC);

-- ── Step 3: Concept edges ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_concept_edges (
  id                  SERIAL      PRIMARY KEY,
  user_id             TEXT,
  device_id           TEXT        NOT NULL,
  concept_a           TEXT        NOT NULL,
  concept_b           TEXT        NOT NULL,
  co_occurrence_count INTEGER     NOT NULL DEFAULT 1,
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device_id, concept_a, concept_b)
);

CREATE INDEX IF NOT EXISTS idx_user_concept_edges_lookup
  ON user_concept_edges (device_id, concept_a, concept_b);
