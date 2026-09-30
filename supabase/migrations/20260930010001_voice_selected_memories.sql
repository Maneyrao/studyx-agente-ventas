-- Agent B qualitative memory joins the same selected-memory lifecycle as
-- WhatsApp/Telegram, while retaining auditable call-event provenance.

ALTER TABLE selected_memories
  ADD COLUMN IF NOT EXISTS source_call_event_id uuid REFERENCES call_events(id);

ALTER TABLE selected_memories
  DROP CONSTRAINT IF EXISTS selected_memories_source_required_check;

ALTER TABLE selected_memories
  ADD CONSTRAINT selected_memories_source_required_check CHECK (
    status = 'rejected'
    OR (
      (CASE WHEN source_message_id IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN source_call_event_id IS NULL THEN 0 ELSE 1 END)
    ) = 1
  );

CREATE INDEX IF NOT EXISTS selected_memories_source_call_event_idx
  ON selected_memories (source_call_event_id)
  WHERE source_call_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_selected_voice_memory_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.source_call_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.source_message_id IS NOT NULL OR NOT EXISTS (
    SELECT 1
    FROM call_events AS event
    JOIN call_sessions AS session ON session.id = event.call_id
    WHERE event.id = NEW.source_call_event_id
      AND event.event_type = 'analyzed'
      AND session.contact_id = NEW.contact_id
      AND session.conversation_id = NEW.conversation_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'Voice memory source must be an analyzed event for the same lead conversation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS selected_memories_voice_source_guard ON selected_memories;
CREATE TRIGGER selected_memories_voice_source_guard
BEFORE INSERT OR UPDATE OF source_call_event_id, source_message_id, contact_id, conversation_id
ON selected_memories
FOR EACH ROW EXECUTE FUNCTION public.enforce_selected_voice_memory_source();

CREATE OR REPLACE FUNCTION public.record_selected_voice_memory(
  p_contact_id          uuid,
  p_conversation_id     uuid,
  p_source_call_event_id uuid,
  p_memory_type         text,
  p_memory_key          text,
  p_value_normalized    text,
  p_source_quote        text,
  p_confidence          double precision,
  p_dedupe_hash         text,
  p_ttl_days            int,
  p_trace_id            uuid
)
RETURNS TABLE (
  outcome text,
  memory_id uuid,
  superseded_memory_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_existing_id uuid;
  v_new_id uuid;
  v_superseded uuid := NULL;
BEGIN
  PERFORM 1 FROM contacts WHERE id = p_contact_id FOR UPDATE;

  SELECT memory.id INTO v_existing_id
  FROM selected_memories AS memory
  WHERE memory.contact_id = p_contact_id
    AND memory.dedupe_hash = p_dedupe_hash
    AND memory.status IN ('accepted', 'active')
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE selected_memories
    SET valid_until = CASE
          WHEN p_ttl_days IS NULL THEN NULL
          ELSE now() + make_interval(days => p_ttl_days)
        END,
        confidence = GREATEST(confidence, p_confidence)
    WHERE id = v_existing_id;
    RETURN QUERY SELECT 'duplicate'::text, v_existing_id, NULL::uuid;
    RETURN;
  END IF;

  SELECT memory.id INTO v_existing_id
  FROM selected_memories AS memory
  WHERE memory.contact_id = p_contact_id
    AND memory.memory_type = p_memory_type
    AND memory.memory_key = p_memory_key
    AND memory.status = 'active'
  LIMIT 1;

  INSERT INTO selected_memories (
    contact_id, conversation_id, source_call_event_id,
    status, memory_type, memory_key, value_normalized, source_quote, confidence,
    acceptance_reason, dedupe_hash, valid_until,
    supersedes_memory_id, embedding_state, trace_id, created_by
  ) VALUES (
    p_contact_id, p_conversation_id, p_source_call_event_id,
    'accepted', p_memory_type, p_memory_key, p_value_normalized, p_source_quote, p_confidence,
    CASE WHEN v_existing_id IS NULL THEN 'VOICE_STRUCTURALLY_VALIDATED' ELSE 'VOICE_SUPERSEDES_PREVIOUS' END,
    p_dedupe_hash,
    CASE WHEN p_ttl_days IS NULL THEN NULL ELSE now() + make_interval(days => p_ttl_days) END,
    v_existing_id, 'pending', p_trace_id, 'agent_b_voice'
  )
  RETURNING id INTO v_new_id;

  IF v_existing_id IS NOT NULL THEN
    UPDATE selected_memories
    SET status = 'superseded',
        superseded_by_memory_id = v_new_id,
        resolved_at = now(),
        embedding = NULL,
        embedding_state = 'skip'
    WHERE id = v_existing_id;
    v_superseded := v_existing_id;
  END IF;

  UPDATE selected_memories SET status = 'active' WHERE id = v_new_id;
  RETURN QUERY SELECT 'recorded'::text, v_new_id, v_superseded;
END
$$;

GRANT EXECUTE ON FUNCTION public.record_selected_voice_memory(
  uuid, uuid, uuid, text, text, text, text, double precision, text, int, uuid
) TO orchestrator_role;

COMMENT ON COLUMN selected_memories.source_call_event_id IS
  'Agent B provenance: analyzed call event whose transcript grounded the accepted qualitative memory.';
