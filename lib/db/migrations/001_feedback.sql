-- Migration 001: Server-side feedback table (DAT-H1 backfill)
--
-- This DDL existed only in agents/architect/design_server_feedback_v1.md and was
-- applied by hand in the Neon console before a migration runner existed. Backfilled
-- here so a fresh database can be provisioned from lib/db/migrations alone.
--
-- Notes:
--   * The original CHECK allowed only ('like','dislike'). Later work added 'save'
--     (see migration handling DAT-H4) and dwell_seconds / receptivity columns
--     (migration 011). Those are applied by their own migrations, not here, so
--     this file reflects the ORIGINAL shape and the runner layers the rest on top.
--   * Idempotent: safe to run against the already-provisioned production database.

CREATE TABLE IF NOT EXISTS feedback (
  id          SERIAL      PRIMARY KEY,
  device_id   TEXT        NOT NULL,
  user_id     TEXT        NULL,
  article_id  TEXT        NOT NULL,
  value       TEXT        NOT NULL CHECK (value IN ('like', 'dislike')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT feedback_device_article_unique UNIQUE (device_id, article_id)
);

CREATE INDEX IF NOT EXISTS feedback_device_id_idx ON feedback (device_id);
