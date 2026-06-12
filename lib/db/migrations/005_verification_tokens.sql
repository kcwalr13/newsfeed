-- Migration 005: Email-verification / password-reset tokens (DAT-H1 backfill)
--
-- Source: agents/architect/design_user_auth_v1.md. A single table serves both
-- flows, discriminated by `purpose`. References users(user_id), so it must run
-- after migration 003. Idempotent.

CREATE TABLE IF NOT EXISTS verification_tokens (
  token      TEXT        PRIMARY KEY,
  user_id    TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  purpose    TEXT        NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS verification_tokens_user_id_idx ON verification_tokens (user_id);
