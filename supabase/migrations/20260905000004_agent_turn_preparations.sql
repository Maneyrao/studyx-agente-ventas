-- Preparations reserve canonical artifacts without producing an external or
-- durable business effect. Only the later atomic turn commit may consume one.
CREATE UNIQUE INDEX IF NOT EXISTS messages_id_conversation_uq
  ON messages (id, conversation_id);

CREATE TABLE IF NOT EXISTS agent_turn_preparations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id         uuid        NOT NULL,
  conversation_id uuid        NOT NULL,
  tool            text        NOT NULL,
  canonical_key   text        NOT NULL,
  canonical_data  jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  committed_at    timestamptz     NULL
);

ALTER TABLE agent_turn_preparations
  DROP CONSTRAINT IF EXISTS agent_turn_preparations_turn_conversation_fk;
ALTER TABLE agent_turn_preparations
  ADD CONSTRAINT agent_turn_preparations_turn_conversation_fk
  FOREIGN KEY (turn_id, conversation_id)
  REFERENCES messages (id, conversation_id)
  ON DELETE CASCADE;

ALTER TABLE agent_turn_preparations
  DROP CONSTRAINT IF EXISTS agent_turn_preparations_tool_check;
ALTER TABLE agent_turn_preparations
  ADD CONSTRAINT agent_turn_preparations_tool_check CHECK (tool IN (
    'prepare_payment_link',
    'prepare_call_request',
    'prepare_contact_details',
    'prepare_memory',
    'prepare_lead_projection'
  ));

ALTER TABLE agent_turn_preparations
  DROP CONSTRAINT IF EXISTS agent_turn_preparations_canonical_key_check;
ALTER TABLE agent_turn_preparations
  ADD CONSTRAINT agent_turn_preparations_canonical_key_check
  CHECK (char_length(canonical_key) BETWEEN 1 AND 512);

ALTER TABLE agent_turn_preparations
  DROP CONSTRAINT IF EXISTS agent_turn_preparations_canonical_data_check;
ALTER TABLE agent_turn_preparations
  ADD CONSTRAINT agent_turn_preparations_canonical_data_check
  CHECK (jsonb_typeof(canonical_data) = 'object');

ALTER TABLE agent_turn_preparations
  DROP CONSTRAINT IF EXISTS agent_turn_preparations_committed_at_check;
ALTER TABLE agent_turn_preparations
  ADD CONSTRAINT agent_turn_preparations_committed_at_check
  CHECK (committed_at IS NULL OR committed_at >= created_at);

CREATE UNIQUE INDEX IF NOT EXISTS agent_turn_preparations_idempotency_key
  ON agent_turn_preparations (conversation_id, tool, canonical_key);

ALTER TABLE agent_turn_preparations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON agent_turn_preparations FROM orchestrator_role;
GRANT SELECT, INSERT, UPDATE ON agent_turn_preparations TO orchestrator_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON agent_turn_preparations FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON agent_turn_preparations FROM authenticated;
  END IF;
END $$;

DROP POLICY IF EXISTS orchestrator_access ON agent_turn_preparations;
CREATE POLICY orchestrator_access ON agent_turn_preparations
  FOR ALL TO orchestrator_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE agent_turn_preparations IS
  'Canonical artifacts reserved by Agent Loop V3; inert until the atomic decision commit.';
