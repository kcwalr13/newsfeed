-- Migration 011: Engineered Serendipity — Phase 4
-- BRD-010 | Stories: SEREN-006–012, SEREN-019, SEREN-021
--
-- Adds:
--   blind_spot_clusters table
--   dwell_seconds column on user_feedback
--   receptivity_score + exploration_budget columns on user_aesthetic_profiles
--
-- Prerequisites:
--   - Migration 010 must already be applied
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS; ADD COLUMN IF NOT EXISTS

-- ── Step 1: Blind spot cluster tracking ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS blind_spot_clusters (
  id               SERIAL       PRIMARY KEY,
  user_id          TEXT,
  device_id        TEXT         NOT NULL,
  cluster_label    TEXT         NOT NULL,
  status           TEXT         NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'suppressed', 'promoted')),
  suppress_until   TIMESTAMPTZ,
  promote_until    TIMESTAMPTZ,
  probe_count      INTEGER      NOT NULL DEFAULT 0,
  like_count       INTEGER      NOT NULL DEFAULT 0,
  dislike_count    INTEGER      NOT NULL DEFAULT 0,
  ignore_count     INTEGER      NOT NULL DEFAULT 0,
  last_probed_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device_id, cluster_label)
);

CREATE INDEX IF NOT EXISTS idx_blind_spot_clusters_device_status
  ON blind_spot_clusters(device_id, status);

-- ── Step 2: Dwell time persistence on user_feedback ──────────────────────────

ALTER TABLE user_feedback
  ADD COLUMN IF NOT EXISTS dwell_seconds NUMERIC(7,2);

-- ── Step 3: Receptivity columns on user_aesthetic_profiles ───────────────────

ALTER TABLE user_aesthetic_profiles
  ADD COLUMN IF NOT EXISTS receptivity_score   NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS exploration_budget  INTEGER NOT NULL DEFAULT 4;
