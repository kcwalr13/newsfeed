-- Migration 004: Sessions table (DAT-H1 backfill)
--
-- Source: agents/architect/design_user_auth_v1.md. References users(user_id),
-- so it must run after migration 003. Idempotent.

CREATE TABLE IF NOT EXISTS sessions (
  session_id     TEXT        PRIMARY KEY,
  user_id        TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
