-- Migration 006: Reading positions ("I stopped here") (DAT-H1 backfill)
--
-- Reconstructed from lib/db/readingPositions.ts (upsert/select shape). Tracks
-- paragraph-level reading progress and dwell per device + article. Applied by
-- hand before the migration runner existed. Idempotent.

CREATE TABLE IF NOT EXISTS reading_positions (
  device_id       TEXT        NOT NULL,
  article_id      TEXT        NOT NULL,
  paragraph_index INTEGER     NOT NULL DEFAULT 0,
  dwell_seconds   INTEGER     NOT NULL DEFAULT 0,
  paused_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  PRIMARY KEY (device_id, article_id)
);
