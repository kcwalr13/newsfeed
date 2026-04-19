-- Migration 012: Corrective fix for migration 011 wrong table name
--
-- Migration 011 accidentally referenced "user_feedback" instead of the actual
-- "feedback" table, so dwell_seconds was never added. This migration adds the
-- missing column to the correct table with an IF NOT EXISTS guard so it is
-- safe to run whether or not 011 partially succeeded.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS

ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS dwell_seconds NUMERIC(7,2);
