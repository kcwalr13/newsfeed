-- Migration 013: Store article batches in the database
--
-- Previously batches were written as JSON files to data/batches/ on the
-- local filesystem. That pattern breaks on Vercel (read-only filesystem).
-- This table replaces the file-based store so that the pipeline and feed
-- endpoint work correctly in a serverless environment.

CREATE TABLE IF NOT EXISTS article_batches (
  batch_date  TEXT        PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL,
  articles    JSONB       NOT NULL
);
