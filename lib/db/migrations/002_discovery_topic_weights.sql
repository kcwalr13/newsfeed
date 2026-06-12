-- Migration 002: Per-identity discovery topic weights (DAT-H1 backfill)
--
-- Source: agents/architect/design_proactive_discovery_v1.md. Applied by hand
-- before the migration runner existed. The last_processed_at column added later
-- by lib/db/discovery.ts::migrateDiscoverySchema() is included here so a fresh
-- database matches production.
--
-- The UNIQUE(user_id, device_id, topic_id) constraint is later upgraded to
-- NULLS NOT DISTINCT by migration 016 (DAT-C2). Idempotent.

CREATE TABLE IF NOT EXISTS discovery_topic_weights (
  id          SERIAL       PRIMARY KEY,
  user_id     TEXT,
  device_id   TEXT         NOT NULL,
  topic_id    TEXT         NOT NULL,
  weight      NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_processed_at TIMESTAMPTZ,
  UNIQUE (user_id, device_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_disc_weights_user   ON discovery_topic_weights (user_id);
CREATE INDEX IF NOT EXISTS idx_disc_weights_device ON discovery_topic_weights (device_id);
