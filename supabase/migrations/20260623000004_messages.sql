CREATE TABLE messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES conversations(id),
  contact_id      uuid        NOT NULL REFERENCES contacts(id),
  direction       text        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content         text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4096),
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- SC-005: composite index for recent memory retrieval (< 100 ms p95)
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at DESC);
CREATE INDEX messages_contact_idx      ON messages (contact_id, created_at DESC);
