CREATE TABLE message_embeddings (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid         NOT NULL REFERENCES messages(id),
  contact_id  uuid         NOT NULL REFERENCES contacts(id),
  embedding   extensions.vector(1536) NOT NULL,
  status      text         NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'indexed')),
  created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX message_embeddings_contact_idx ON message_embeddings (contact_id) WHERE status = 'indexed';
CREATE INDEX message_embeddings_pending_idx ON message_embeddings (created_at) WHERE status = 'pending';
