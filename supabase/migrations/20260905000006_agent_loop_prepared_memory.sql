-- Materialize Agent Loop memory reservations without changing their identity.
-- Validation stays in the worker; activation and explicit supersession are one
-- PostgreSQL operation so readers never observe the old memory removed before
-- the validated successor exists.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_prepared_agent_memory_v1(
  p_memory_id            uuid,
  p_supersedes_ids       uuid[],
  p_contact_id           uuid,
  p_conversation_id      uuid,
  p_source_message_id    uuid,
  p_source_batch_id      uuid,
  p_decision_id          uuid,
  p_memory_type          text,
  p_memory_key           text,
  p_value_normalized     text,
  p_source_quote         text,
  p_confidence           double precision,
  p_dedupe_hash          text,
  p_ttl_days             int,
  p_trace_id             uuid
)
RETURNS TABLE (
  outcome                 text,
  memory_id               uuid,
  superseded_memory_ids   uuid[]
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_requested_ids uuid[] := ARRAY(
    SELECT DISTINCT requested_id
    FROM unnest(COALESCE(p_supersedes_ids, ARRAY[]::uuid[])) AS requested(requested_id)
    ORDER BY requested_id
  );
  v_superseded_ids uuid[];
  v_existing record;
BEGIN
  IF p_memory_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Prepared memory id is required';
  END IF;
  IF cardinality(v_requested_ids) <> cardinality(COALESCE(p_supersedes_ids, ARRAY[]::uuid[])) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Duplicate supersedes ids are not allowed';
  END IF;

  PERFORM 1 FROM public.contacts WHERE id = p_contact_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Prepared memory contact not found';
  END IF;

  SELECT
    stored.contact_id,
    stored.conversation_id,
    stored.decision_id,
    stored.memory_type,
    stored.memory_key,
    stored.value_normalized,
    stored.source_quote
  INTO v_existing
  FROM public.selected_memories AS stored
  WHERE stored.id = p_memory_id;

  IF FOUND THEN
    IF v_existing.contact_id IS DISTINCT FROM p_contact_id
       OR v_existing.conversation_id IS DISTINCT FROM p_conversation_id
       OR v_existing.decision_id IS DISTINCT FROM p_decision_id
       OR v_existing.memory_type IS DISTINCT FROM p_memory_type
       OR v_existing.memory_key IS DISTINCT FROM p_memory_key
       OR v_existing.value_normalized IS DISTINCT FROM p_value_normalized
       OR v_existing.source_quote IS DISTINCT FROM p_source_quote THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Prepared memory id belongs to different content';
    END IF;
    SELECT COALESCE(array_agg(previous.id ORDER BY previous.id), ARRAY[]::uuid[])
    INTO v_superseded_ids
    FROM public.selected_memories AS previous
    WHERE previous.superseded_by_memory_id = p_memory_id;
    RETURN QUERY SELECT 'duplicate'::text, p_memory_id, v_superseded_ids;
    RETURN;
  END IF;

  IF (
    SELECT count(*)
    FROM public.selected_memories AS requested
    WHERE requested.id = ANY(v_requested_ids)
      AND requested.contact_id = p_contact_id
      AND requested.status IN ('accepted', 'active')
  ) <> cardinality(v_requested_ids) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Prepared memory supersedes id is not active for this contact';
  END IF;

  SELECT COALESCE(array_agg(candidate.id ORDER BY candidate.id), ARRAY[]::uuid[])
  INTO v_superseded_ids
  FROM public.selected_memories AS candidate
  WHERE candidate.contact_id = p_contact_id
    AND candidate.status IN ('accepted', 'active')
    AND (
      candidate.id = ANY(v_requested_ids)
      OR (candidate.memory_type = p_memory_type AND candidate.memory_key = p_memory_key)
    );

  INSERT INTO public.selected_memories (
    id, contact_id, conversation_id, source_message_id, source_batch_id, decision_id,
    status, memory_type, memory_key, value_normalized, source_quote, confidence,
    acceptance_reason, dedupe_hash, valid_until, supersedes_memory_id,
    embedding_state, trace_id
  ) VALUES (
    p_memory_id, p_contact_id, p_conversation_id, p_source_message_id,
    p_source_batch_id, p_decision_id, 'proposed', p_memory_type, p_memory_key,
    p_value_normalized, p_source_quote, p_confidence,
    CASE WHEN cardinality(v_superseded_ids) = 0
      THEN 'STRUCTURALLY_VALIDATED' ELSE 'SUPERSEDES_PREVIOUS' END,
    p_dedupe_hash,
    CASE WHEN p_ttl_days IS NULL THEN NULL ELSE now() + make_interval(days => p_ttl_days) END,
    v_superseded_ids[1], 'skip', p_trace_id
  );

  UPDATE public.selected_memories AS previous
  SET
    status = 'superseded',
    superseded_by_memory_id = p_memory_id,
    resolved_at = now(),
    embedding = NULL,
    embedding_state = 'skip',
    embedding_updated_at = now()
  WHERE previous.id = ANY(v_superseded_ids);

  UPDATE public.selected_memories
  SET status = 'active', embedding_state = 'pending'
  WHERE id = p_memory_id;

  RETURN QUERY SELECT 'recorded'::text, p_memory_id, v_superseded_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.record_prepared_agent_memory_v1(
  uuid, uuid[], uuid, uuid, uuid, uuid, uuid, text, text, text, text,
  double precision, text, int, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_prepared_agent_memory_v1(
  uuid, uuid[], uuid, uuid, uuid, uuid, uuid, text, text, text, text,
  double precision, text, int, uuid
) TO orchestrator_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.record_prepared_agent_memory_v1(
      uuid, uuid[], uuid, uuid, uuid, uuid, uuid, text, text, text, text,
      double precision, text, int, uuid
    ) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.record_prepared_agent_memory_v1(
      uuid, uuid[], uuid, uuid, uuid, uuid, uuid, text, text, text, text,
      double precision, text, int, uuid
    ) FROM authenticated;
  END IF;
END
$$;

COMMENT ON FUNCTION public.record_prepared_agent_memory_v1(
  uuid, uuid[], uuid, uuid, uuid, uuid, uuid, text, text, text, text,
  double precision, text, int, uuid
) IS 'Activates one validated Agent Loop memory with its reserved UUID and links every explicit/slot predecessor atomically.';

COMMIT;
