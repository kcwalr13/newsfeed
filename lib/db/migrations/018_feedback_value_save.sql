-- 018: Allow 'save' in feedback.value (DAT-H4)
--
-- The original CHECK (migration 001) only permits ('like','dislike'), so every
-- server-side "Read later"/save write fails with a constraint violation and the
-- localStorage migration 400-loops on any saved item. Recreate the constraint to
-- include 'save'.
--
-- Idempotent: drops the old constraint by name if present, then adds the new one
-- only if absent. Safe to re-run.

ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_value_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'feedback'::regclass AND conname = 'feedback_value_check'
  ) THEN
    ALTER TABLE feedback
      ADD CONSTRAINT feedback_value_check
      CHECK (value IN ('like', 'dislike', 'save'));
  END IF;
END $$;
