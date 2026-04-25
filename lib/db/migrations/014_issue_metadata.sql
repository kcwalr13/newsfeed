-- Migration 014: Add issue_metadata column to article_batches
--
-- Stores LLM-generated issue metadata (sequential number, theme, themeNote,
-- arrivedAt, sources list) as JSONB alongside the articles for each batch.
-- Used by the IssueCover and Colophon components.

ALTER TABLE article_batches
  ADD COLUMN IF NOT EXISTS issue_metadata JSONB;

-- reading_positions: tracks "I stopped here" paragraph-level position per article.
-- Supports the reading position bookmark feature (Task #12).
CREATE TABLE IF NOT EXISTS reading_positions (
  device_id        TEXT        NOT NULL,
  article_id       TEXT        NOT NULL,
  paragraph_index  INTEGER     NOT NULL DEFAULT 0,
  dwell_seconds    INTEGER     NOT NULL DEFAULT 0,
  paused_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  PRIMARY KEY (device_id, article_id)
);
