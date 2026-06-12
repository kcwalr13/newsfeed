-- Migration 003: Users table (DAT-H1 backfill)
--
-- Source: agents/architect/design_user_auth_v1.md. Applied by hand before the
-- migration runner existed. user_id is a TEXT UUID (crypto.randomUUID()),
-- matching the TEXT device_id convention. Idempotent.

CREATE TABLE IF NOT EXISTS users (
  user_id           TEXT        PRIMARY KEY,
  email             TEXT        NOT NULL UNIQUE,
  hashed_password   TEXT        NOT NULL,
  email_verified_at TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);
