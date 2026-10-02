-- Structured, PII-free evidence for the one logical Agent A turn.
-- Immutable with the decision row; never updated after commit.

ALTER TABLE agent_decisions
  ADD COLUMN IF NOT EXISTS diagnostics jsonb;

ALTER TABLE agent_decisions
  DROP CONSTRAINT IF EXISTS agent_decisions_diagnostics_shape_check;

ALTER TABLE agent_decisions
  ADD CONSTRAINT agent_decisions_diagnostics_shape_check CHECK (
    diagnostics IS NULL OR (
      jsonb_typeof(diagnostics) = 'object'
      AND diagnostics - ARRAY[
        'schema_version',
        'generation_attempts',
        'failure_stage',
        'failure_codes',
        'action_status'
      ] = '{}'::jsonb
      AND diagnostics ->> 'schema_version' = '1'
      AND jsonb_typeof(diagnostics -> 'generation_attempts') = 'number'
      AND (diagnostics ->> 'generation_attempts')::integer BETWEEN 0 AND 2
      AND diagnostics ->> 'failure_stage' IN (
        'none',
        'provider_generation',
        'proposal_validation',
        'action_authorization',
        'backend_commit'
      )
      AND jsonb_typeof(diagnostics -> 'failure_codes') = 'array'
      AND jsonb_array_length(diagnostics -> 'failure_codes') <= 8
      AND NOT jsonb_path_exists(
        diagnostics,
        '$.failure_codes[*] ? (@.type() != "string")'
      )
      AND diagnostics ->> 'action_status' IN (
        'none',
        'authorized',
        'needs_input',
        'rejected'
      )
    )
  );

COMMENT ON COLUMN agent_decisions.diagnostics IS
  'Immutable, PII-free diagnostic classification for the logical Agent A turn.';

-- The original immutability trigger predates `diagnostics`, so extend its
-- comparison in the same migration that introduces the column. The one
-- supported post-commit transition remains attaching the outbound message.
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
     OR OLD.diagnostics IS DISTINCT FROM NEW.diagnostics
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
