-- Immutable, source-quoted agent observations. Separate from PII-free diagnostics.
ALTER TABLE public.agent_decisions ADD COLUMN negotiation_observations jsonb;

CREATE FUNCTION public.agent_negotiation_observations_valid_v1(payload jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, public AS $$
DECLARE item jsonb; field text;
BEGIN
  IF payload IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(payload) <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(payload) > 10 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(payload) LOOP
    IF jsonb_typeof(item) <> 'object'
      OR NOT item ?& ARRAY['status','offering_code','source_turn_id','source_message_id','source_quote',
        'interpretation_source','workspace_id','conversation_id','contact_id']
      OR item - ARRAY['status','offering_code','source_turn_id','source_message_id','source_quote',
        'interpretation_source','workspace_id','conversation_id','contact_id'] <> '{}'::jsonb
      THEN RETURN false; END IF;
    FOREACH field IN ARRAY ARRAY['workspace_id','conversation_id','contact_id','source_turn_id','source_message_id'] LOOP
      IF jsonb_typeof(item->field) IS DISTINCT FROM 'string'
        OR (item->>field) !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN RETURN false; END IF;
    END LOOP;
    IF jsonb_typeof(item->'status') IS DISTINCT FROM 'string'
      OR item->>'status' NOT IN ('confirmed','other_barriers_reported')
      OR item->>'interpretation_source' IS DISTINCT FROM 'committed_agent_observation'
      OR jsonb_typeof(item->'source_quote') IS DISTINCT FROM 'string'
      OR length(btrim(item->>'source_quote')) NOT BETWEEN 1 AND 2048
      OR jsonb_typeof(item->'offering_code') NOT IN ('null','string')
      OR (jsonb_typeof(item->'offering_code')='string' AND length(item->>'offering_code') NOT BETWEEN 1 AND 160)
      THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

ALTER TABLE public.agent_decisions ADD CONSTRAINT agent_decisions_negotiation_observations_shape_check
  CHECK (public.agent_negotiation_observations_valid_v1(negotiation_observations));
COMMENT ON COLUMN public.agent_decisions.negotiation_observations IS
  'Server-anchored interpretations from the committed proposal, with literal inbound evidence. Context only; never bonus eligibility.';

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
     OR OLD.negotiation_observations IS DISTINCT FROM NEW.negotiation_observations
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
