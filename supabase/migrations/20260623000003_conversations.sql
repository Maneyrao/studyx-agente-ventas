CREATE TABLE conversations (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     uuid        NOT NULL REFERENCES contacts(id),
  channel        text        NOT NULL
                             CHECK (channel IN ('whatsapp', 'voice')),
  status         text        NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open', 'closed', 'transferred')),
  current_intent text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  last_turn_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conversations_contact_idx ON conversations (contact_id);
CREATE INDEX conversations_status_idx  ON conversations (status) WHERE status = 'open';
