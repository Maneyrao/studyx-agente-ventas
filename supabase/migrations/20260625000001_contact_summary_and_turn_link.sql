-- Feature 002: Agent Message Ingestion Endpoint
-- Adds summary/counter columns to contacts and turn-correlation to messages.
-- Only text/int/uuid types — no extensions.vector (see research D8).

ALTER TABLE contacts
  ADD COLUMN summary           text,
  ADD COLUMN summary_updated_at timestamptz,
  ADD COLUMN pending_turns     int NOT NULL DEFAULT 0 CHECK (pending_turns >= 0);

ALTER TABLE messages
  ADD COLUMN in_reply_to uuid REFERENCES messages(id);

-- Guarantees exactly one outbound per inbound turn (FR-007).
CREATE UNIQUE INDEX messages_in_reply_to_unique
  ON messages (in_reply_to)
  WHERE in_reply_to IS NOT NULL;
