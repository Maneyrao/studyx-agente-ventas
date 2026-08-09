-- Remove the legacy transferred conversation state without rewriting the
-- original migration, which may already be applied in existing environments.

UPDATE conversations
SET status = 'closed'
WHERE status = 'transferred';

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_status_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('open', 'closed'))
  NOT VALID;

ALTER TABLE conversations
  VALIDATE CONSTRAINT conversations_status_check;
