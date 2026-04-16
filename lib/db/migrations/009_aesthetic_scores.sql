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
