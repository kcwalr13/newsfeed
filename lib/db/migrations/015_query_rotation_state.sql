-- 015: Query rotation cursor state (DAT-C1)
-- Replaces data/query_rotation_state.json, which cannot be written on the
-- read-only serverless filesystem. One row per discovery topic; the cursor
-- is the index of the last query issued from that topic's query bank.

CREATE TABLE IF NOT EXISTS query_rotation_state (
  topic_id   TEXT PRIMARY KEY,
  cursor     INTEGER NOT NULL DEFAULT -1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
