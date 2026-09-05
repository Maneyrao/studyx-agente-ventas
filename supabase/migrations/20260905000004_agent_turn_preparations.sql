-- Preparations reserve canonical artifacts without producing an external or
-- durable business effect. Only the later atomic turn commit may consume one.
-- Concurrent index builds cannot run inside a transaction block. A short lock
-- timeout makes an unexpected catalog lock fail the deploy instead of stalling
-- the hot messages table. The invalid-index guard makes an interrupted first
-- build retryable without rebuilding a healthy index.
SET lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class AS class
    JOIN pg_index AS index ON index.indexrelid = class.oid
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname = 'messages_id_conversation_uq'
      AND NOT index.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX public.messages_id_conversation_uq';
  END IF;
END
$$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS messages_id_conversation_uq
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
  ON DELETE CASCADE NOT VALID;
ALTER TABLE agent_turn_preparations
  VALIDATE CONSTRAINT agent_turn_preparations_turn_conversation_fk;

ALTER TABLE agent_turn_preparations
  DROP CONSTRAINT IF EXISTS agent_turn_preparations_tool_check;
ALTER TABLE agent_turn_preparations
  ADD CONSTRAINT agent_turn_preparations_tool_check CHECK (tool IN (
    'prepare_payment_link',
    'prepare_call_request',
    'prepare_contact_details',
    'prepare_memory',
    'prepare_lead_projection'
  )) NOT VALID;
ALTER TABLE agent_turn_preparations
  VALIDATE CONSTRAINT agent_turn_preparations_tool_check;

ALTER TABLE agent_turn_preparations
  DROP CONSTRAINT IF EXISTS agent_turn_preparations_canonical_key_check;
ALTER TABLE agent_turn_preparations
  ADD CONSTRAINT agent_turn_preparations_canonical_key_check
  CHECK (char_length(canonical_key) BETWEEN 1 AND 512) NOT VALID;
ALTER TABLE agent_turn_preparations
  VALIDATE CONSTRAINT agent_turn_preparations_canonical_key_check;

ALTER TABLE agent_turn_preparations
  DROP CONSTRAINT IF EXISTS agent_turn_preparations_canonical_data_check;
ALTER TABLE agent_turn_preparations
  ADD CONSTRAINT agent_turn_preparations_canonical_data_check
  CHECK (jsonb_typeof(canonical_data) = 'object') NOT VALID;
ALTER TABLE agent_turn_preparations
  VALIDATE CONSTRAINT agent_turn_preparations_canonical_data_check;

ALTER TABLE agent_turn_preparations
  DROP CONSTRAINT IF EXISTS agent_turn_preparations_committed_at_check;
ALTER TABLE agent_turn_preparations
  ADD CONSTRAINT agent_turn_preparations_committed_at_check
  CHECK (committed_at IS NULL OR committed_at >= created_at) NOT VALID;
ALTER TABLE agent_turn_preparations
  VALIDATE CONSTRAINT agent_turn_preparations_committed_at_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class AS class
    JOIN pg_index AS index ON index.indexrelid = class.oid
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname = 'agent_turn_preparations_idempotency_key'
      AND NOT index.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX public.agent_turn_preparations_idempotency_key';
  END IF;
END
$$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS agent_turn_preparations_idempotency_key
  ON agent_turn_preparations (conversation_id, tool, canonical_key);

ALTER TABLE agent_turn_preparations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON agent_turn_preparations FROM orchestrator_role;
GRANT SELECT, INSERT ON agent_turn_preparations TO orchestrator_role;
GRANT UPDATE (canonical_key, committed_at) ON agent_turn_preparations TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON agent_turn_preparations FROM orchestrator_role;

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

-- Expiration is the only supported delete path. The caller must name a
-- workspace, and a preparation is eligible only when its conversation has
-- exactly one authoritative workspace state which belongs to that workspace.
-- The orchestrator never receives DELETE on the table itself.
CREATE OR REPLACE FUNCTION public.expire_agent_turn_preparations_v1(
  p_workspace_id uuid,
  p_older_than_ms bigint
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_workspace_id IS NULL
     OR p_older_than_ms IS NULL
     OR p_older_than_ms <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'workspace and positive expiration age are required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces WHERE id = p_workspace_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'workspace does not exist';
  END IF;

  WITH owned_conversations AS (
    SELECT state.conversation_id
    FROM public.conversation_sales_context_states_v1 AS state
    JOIN public.workspace_contacts AS workspace_contact
      ON workspace_contact.workspace_id = state.workspace_id
     AND workspace_contact.contact_id = state.contact_id
    WHERE state.workspace_id = p_workspace_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.conversation_sales_context_states_v1 AS other_state
        WHERE other_state.conversation_id = state.conversation_id
          AND other_state.workspace_id <> state.workspace_id
      )
  ), expired AS (
    DELETE FROM public.agent_turn_preparations AS preparation
    USING owned_conversations AS owned
    WHERE preparation.conversation_id = owned.conversation_id
      AND preparation.committed_at IS NULL
      AND preparation.created_at < clock_timestamp()
        - (p_older_than_ms * interval '1 millisecond')
    RETURNING preparation.id
  )
  SELECT count(*)::int INTO v_deleted FROM expired;

  RETURN v_deleted;
END
$$;

REVOKE ALL ON FUNCTION public.expire_agent_turn_preparations_v1(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_agent_turn_preparations_v1(uuid, bigint)
  TO orchestrator_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.expire_agent_turn_preparations_v1(uuid, bigint) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.expire_agent_turn_preparations_v1(uuid, bigint) FROM authenticated;
  END IF;
END $$;

COMMENT ON TABLE agent_turn_preparations IS
  'Canonical artifacts reserved by Agent Loop V3; inert until the atomic decision commit.';

RESET lock_timeout;
