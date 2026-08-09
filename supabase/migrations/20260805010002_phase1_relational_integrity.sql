-- Phase 1 relational invariants.
-- All changes are additive and preserve legacy outbound messages that do not
-- have an in_reply_to value.

-- A message contact must be the same contact that owns its conversation.
CREATE UNIQUE INDEX conversations_id_contact_uq
  ON conversations (id, contact_id);

ALTER TABLE messages
  ADD CONSTRAINT messages_conversation_contact_fk
  FOREIGN KEY (conversation_id, contact_id)
  REFERENCES conversations (id, contact_id)
  NOT VALID;

ALTER TABLE messages
  VALIDATE CONSTRAINT messages_conversation_contact_fk;

-- At most one open conversation exists for a contact on a channel. The
-- application must use INSERT ... ON CONFLICT with this exact predicate.
CREATE UNIQUE INDEX conversations_one_open_per_channel_uq
  ON conversations (contact_id, channel)
  WHERE status = 'open';

-- Support compound references that cannot cross a contact or conversation.
CREATE UNIQUE INDEX messages_id_contact_uq
  ON messages (id, contact_id);

CREATE UNIQUE INDEX messages_id_conversation_contact_direction_uq
  ON messages (id, conversation_id, contact_id, direction);

ALTER TABLE messages
  ADD COLUMN reply_target_direction text
  GENERATED ALWAYS AS ('inbound'::text) STORED;

-- A non-null reply link is only valid on an outbound. A historical outbound
-- may remain unlinked, so this does not require every outbound to have a link.
ALTER TABLE messages
  ADD CONSTRAINT messages_reply_direction_check
  CHECK (in_reply_to IS NULL OR direction = 'outbound')
  NOT VALID;

ALTER TABLE messages
  VALIDATE CONSTRAINT messages_reply_direction_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_reply_same_turn_fk
  FOREIGN KEY (
    in_reply_to,
    conversation_id,
    contact_id,
    reply_target_direction
  )
  REFERENCES messages (
    id,
    conversation_id,
    contact_id,
    direction
  )
  NOT VALID;

ALTER TABLE messages
  VALIDATE CONSTRAINT messages_reply_same_turn_fk;

-- An embedding cannot claim a contact different from its source message, and
-- a source message has at most one materialized embedding.
CREATE UNIQUE INDEX message_embeddings_message_id_uq
  ON message_embeddings (message_id);

ALTER TABLE message_embeddings
  ADD CONSTRAINT message_embeddings_message_contact_fk
  FOREIGN KEY (message_id, contact_id)
  REFERENCES messages (id, contact_id)
  NOT VALID;

ALTER TABLE message_embeddings
  VALIDATE CONSTRAINT message_embeddings_message_contact_fk;

-- Enforce normalized identity at the database boundary for all new writes.
-- NOT VALID keeps any legacy phone requiring manual review from blocking the
-- rollout; PostgreSQL still enforces the constraint for new/updated rows.
ALTER TABLE contacts
  ADD CONSTRAINT contacts_phone_e164_check
  CHECK (phone ~ '^\+[1-9][0-9]{7,14}$')
  NOT VALID;

-- Deterministic indexes for recent-memory scans and stable tie-breaking.
CREATE INDEX messages_conversation_recent_stable_idx
  ON messages (conversation_id, created_at DESC, id DESC);

CREATE INDEX conversations_contact_channel_open_lookup_idx
  ON conversations (contact_id, channel, created_at DESC)
  WHERE status = 'open';

COMMENT ON CONSTRAINT messages_conversation_contact_fk ON messages IS
  'Prevents a message from crossing the contact boundary of its conversation.';

COMMENT ON CONSTRAINT messages_reply_same_turn_fk ON messages IS
  'A non-null in_reply_to points to an inbound in the same contact and conversation.';

COMMENT ON INDEX conversations_one_open_per_channel_uq IS
  'Database-level serialization point for get-or-create open conversation.';
