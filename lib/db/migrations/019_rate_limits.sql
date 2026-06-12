-- 019: Fixed-window rate limiting (SEC-H2)
--
-- Backs lib/rateLimit.ts. One row per (limiter key + time bucket); the count is
-- incremented atomically via ON CONFLICT. Expired rows are harmless and can be
-- swept by a periodic job (DELETE WHERE expires_at < NOW()).
--
-- Idempotent. Until applied, the limiter fails open (see lib/rateLimit.ts).

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key  TEXT        PRIMARY KEY,   -- "<name>:<identity>:<windowBucket>"
  count       INTEGER     NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limits_expires_at_idx ON rate_limits (expires_at);
