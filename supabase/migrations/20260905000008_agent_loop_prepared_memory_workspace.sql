-- P1-A (re-review 2026-09-05): contacts are global in this schema — workspace
-- membership is a join (`workspace_contacts`) — so a memory belonging to
-- workspace A could be superseded from a workspace-B conversation whenever
-- the same global contact also belongs to workspace B.
-- `record_prepared_agent_memory_v1` (20260905000006, tolerance added in
-- 20260905000007) received and validated only `p_contact_id`: it never
-- checked that a `supersedes` target actually ORIGINATED in the calling
-- workspace. This migration threads the authoritative workspace through the
-- function's own signature and validates it there — the same posture already
-- used by `commitAgentTurnV3`'s TS-side gate (20260905000007) and by
-- `prepareMemoryToolV1`'s optimistic prepare-time check, so the check is
-- authoritative at every layer, not just at the outermost one an attacker
-- could bypass.
--
-- A memory has no `workspace_id` column of its own (by design —
-- `selected_memories` is contact+conversation scoped, not workspace scoped).
-- Its origin workspace is the durable link already used everywhere else in
-- this feature: `conversation_sales_context_states_v1`, keyed by the memory's
-- OWN `conversation_id` (the conversation it was actually recorded in), not
-- by whatever workspace the CURRENT caller happens to also share a
-- `workspace_contacts` row with.
--
-- Adding a parameter changes the signature, so this is a new overload:
-- DROP the old (contact-only) one and CREATE the new one in the same
-- transaction, rather than leaving a vulnerable overload reachable. Additive
-- migration: 20260811030001, 20260905000006 and 20260905000007 are not
-- rewritten.

BEGIN;

DROP FUNCTION IF EXISTS public.record_prepared_agent_memory_v1(
  uuid, uuid[], uuid, uuid, uuid, uuid, uuid, text, text, text, text,
  double precision, text, int, uuid
);

CREATE OR REPLACE FUNCTION public.record_prepared_agent_memory_v1(
  p_memory_id            uuid,
  p_supersedes_ids       uuid[],
  p_workspace_id         uuid,
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
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Prepared memory workspace id is required';
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

  -- A requested predecessor is authorized when it is contact-scoped correctly
  -- (as before) AND originates from a conversation durably linked to THIS
  -- workspace — not merely a workspace the caller's contact also happens to
  -- have an active `workspace_contacts` row with. `pending_supersession`
  -- (20260905000007) is the in-transaction limbo state `commitAgentTurnV3`
  -- leaves an already-durable predecessor in before this worker run.
  IF (
    SELECT count(*)
    FROM public.selected_memories AS requested
    JOIN public.conversation_sales_context_states_v1 AS origin
      ON origin.conversation_id = requested.conversation_id
     AND origin.contact_id = requested.contact_id
    WHERE requested.id = ANY(v_requested_ids)
      AND requested.contact_id = p_contact_id
      AND origin.workspace_id = p_workspace_id
      AND requested.status IN ('accepted', 'active', 'pending_supersession')
  ) <> cardinality(v_requested_ids) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Prepared memory supersedes id is not active for this workspace and contact';
  END IF;

  -- Same workspace-scoped tolerance for the implicit "same slot" (type+key)
  -- supersession path.
  SELECT COALESCE(array_agg(candidate.id ORDER BY candidate.id), ARRAY[]::uuid[])
  INTO v_superseded_ids
  FROM public.selected_memories AS candidate
  JOIN public.conversation_sales_context_states_v1 AS origin
    ON origin.conversation_id = candidate.conversation_id
   AND origin.contact_id = candidate.contact_id
  WHERE candidate.contact_id = p_contact_id
    AND origin.workspace_id = p_workspace_id
    AND (
      (
        candidate.status IN ('accepted', 'active')
        AND (
          candidate.id = ANY(v_requested_ids)
          OR (candidate.memory_type = p_memory_type AND candidate.memory_key = p_memory_key)
        )
      )
      OR (
        candidate.status = 'pending_supersession'
        AND candidate.id = ANY(v_requested_ids)
      )
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
  uuid, uuid[], uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text,
  double precision, text, int, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_prepared_agent_memory_v1(
  uuid, uuid[], uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text,
  double precision, text, int, uuid
) TO orchestrator_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.record_prepared_agent_memory_v1(
      uuid, uuid[], uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text,
      double precision, text, int, uuid
    ) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.record_prepared_agent_memory_v1(
      uuid, uuid[], uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text,
      double precision, text, int, uuid
    ) FROM authenticated;
  END IF;
END
$$;

COMMENT ON FUNCTION public.record_prepared_agent_memory_v1(
  uuid, uuid[], uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text,
  double precision, text, int, uuid
) IS 'Activates one validated Agent Loop memory with its reserved UUID and links every explicit/slot predecessor atomically, after validating each predecessor originates from a conversation durably linked to the SAME workspace (conversation_sales_context_states_v1), not merely one the calling contact also happens to be an active member of.';

COMMIT;
