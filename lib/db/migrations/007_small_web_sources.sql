-- Migration 007: Small Web source pool table
-- Phase 1 (Agentic Discovery) — tracks IndieWeb and Small Web sources
-- for organic blogroll expansion and scheduled crawling.

CREATE TABLE IF NOT EXISTS small_web_sources (
  id                      SERIAL PRIMARY KEY,
  url                     TEXT NOT NULL UNIQUE,
  feed_url                TEXT,
  last_crawled_at         TIMESTAMPTZ,
  last_yielded_at         TIMESTAMPTZ,
  yield_count             INTEGER NOT NULL DEFAULT 0,
  consecutive_zero_yields INTEGER NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'deprioritized')),
  cooldown_until          TIMESTAMPTZ,
  discovered_via          TEXT NOT NULL DEFAULT 'seed'
                            CHECK (discovered_via IN ('seed', 'blogroll')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_small_web_sources_status_cooldown
  ON small_web_sources (status, cooldown_until);
