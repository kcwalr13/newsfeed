-- 020: Durable discovery novelty/dedup memory (R7-2)
--
-- A permanent, URL-granular record of every one-off the discovery engine has
-- surfaced, plus its novelty key (domain / shared-host), so a find is never
-- resurfaced and the digest always feels fresh.
--
-- Today novelty is derived on the fly from the last NOVELTY_LOOKBACK_ISSUES
-- batch JSONs only (lib/discovery/novelty.ts), so an item older than that window
-- can reappear. This table makes novelty PERMANENT: the discovery read path
-- unions these keys into the seen-set, and the write path records surfaced item
-- URLs after each run.
--
-- The application code is backward-compatible: until this table exists,
-- loadSeenNoveltyKeys()/loadSeenCanonicalUrls() return empty sets and
-- recordSeenUrls() is a no-op (all swallow the missing-relation error), so the
-- deploy is safe BEFORE this migration is applied. Idempotent (IF NOT EXISTS),
-- so re-running against an already-provisioned database is safe.

CREATE TABLE IF NOT EXISTS discovery_seen_urls (
  url_canonical    TEXT PRIMARY KEY,
  novelty_key      TEXT NOT NULL,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  discovery_source TEXT
);

-- Domain/host-level novelty lookups (the seen-set union on read).
CREATE INDEX IF NOT EXISTS idx_discovery_seen_urls_novelty_key
  ON discovery_seen_urls (novelty_key);
