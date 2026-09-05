-- Concurrent replacement keeps the hot state-event table readable/writable
-- while the supporting index is built. This migration must remain outside an
-- explicit transaction block. The timeout fails closed on catalog contention.
SET lock_timeout = '5s';

-- Agent Loop V3 declares which durable memories informed the answer. Keep the
-- identifiers on the immutable decision instead of losing them at render time.
ALTER TABLE agent_decisions
  ADD COLUMN IF NOT EXISTS used_memory_ids text[] NOT NULL DEFAULT ARRAY[]::text[];

-- One turn may produce two state versions: the immediate customer-declared
-- half and the visibility-gated half after channel acceptance. Version is the
-- event identity; source_turn_id remains causal provenance and is intentionally
-- allowed to repeat for those two phases.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class AS class
    JOIN pg_index AS index ON index.indexrelid = class.oid
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname = 'conversation_sales_context_events_v1_source_idx'
      AND NOT index.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX public.conversation_sales_context_events_v1_source_idx';
  END IF;
END
$$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS conversation_sales_context_events_v1_source_idx
  ON conversation_sales_context_state_events_v1 (
    workspace_id,
    conversation_id,
    source_turn_id,
    state_version
  )
  WHERE source_turn_id IS NOT NULL;

DROP INDEX CONCURRENTLY IF EXISTS conversation_sales_context_events_v1_source_unique;

COMMENT ON COLUMN agent_decisions.used_memory_ids IS
  'Immutable memory identifiers explicitly used by an Agent Loop V3 decision.';

-- Replacing the trigger function is required when immutable decision columns
-- are added: table-level UPDATE remains available for the one legal transition
-- that binds outbound_message_id after message creation.
CREATE OR REPLACE FUNCTION public.enforce_agent_decision_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.turn_id IS DISTINCT FROM NEW.turn_id
     OR OLD.trace_id IS DISTINCT FROM NEW.trace_id
     OR OLD.schema_version IS DISTINCT FROM NEW.schema_version
     OR OLD.intent IS DISTINCT FROM NEW.intent
     OR OLD.decision_kind IS DISTINCT FROM NEW.decision_kind
     OR OLD.response IS DISTINCT FROM NEW.response
     OR OLD.response_type IS DISTINCT FROM NEW.response_type
     OR OLD.business_action IS DISTINCT FROM NEW.business_action
     OR OLD.retrieval_used IS DISTINCT FROM NEW.retrieval_used
     OR OLD.memory_candidates IS DISTINCT FROM NEW.memory_candidates
     OR OLD.used_memory_ids IS DISTINCT FROM NEW.used_memory_ids
     OR OLD.missing_information IS DISTINCT FROM NEW.missing_information
     OR OLD.next_state IS DISTINCT FROM NEW.next_state
     OR OLD.reason_code IS DISTINCT FROM NEW.reason_code
     OR OLD.confidence IS DISTINCT FROM NEW.confidence
     OR OLD.model_provider IS DISTINCT FROM NEW.model_provider
     OR OLD.model_name IS DISTINCT FROM NEW.model_name
     OR OLD.prompt_version IS DISTINCT FROM NEW.prompt_version
     OR OLD.payload_hash IS DISTINCT FROM NEW.payload_hash
     OR OLD.release_manifest IS DISTINCT FROM NEW.release_manifest
     OR (
       OLD.outbound_message_id IS DISTINCT FROM NEW.outbound_message_id
       AND NOT (
         OLD.outbound_message_id IS NULL
         AND NEW.outbound_message_id IS NOT NULL
         AND OLD.decision_kind IN ('reply', 'clarify')
         AND OLD.response IS NOT NULL
         AND btrim(OLD.response) <> ''
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Agent decision is immutable after commit';
  END IF;
  RETURN NEW;
END
$$;

RESET lock_timeout;
