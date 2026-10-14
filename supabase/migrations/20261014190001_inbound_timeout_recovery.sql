-- Recover unanswered inbound windows and ambiguous HTTP claim responses.
-- Existing fencing, completion and external message deduplication stay in force.

CREATE OR REPLACE FUNCTION public.open_or_join_inbound_batch(
  p_conversation_id  uuid,
  p_contact_id       uuid,
  p_message_id       uuid,
  p_window_ms        integer DEFAULT 2000,
  p_hard_deadline_ms integer DEFAULT 4000
)
RETURNS TABLE (
  batch_id         uuid,
  joined           boolean,
  state            text,
  due_at           timestamptz,
  hard_deadline_at timestamptz,
  conversation_seq bigint,
  message_count    integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_batch    inbound_batches%ROWTYPE;
  v_message  messages%ROWTYPE;
  v_seq      bigint;
  v_joined   boolean := false;
  v_window   interval := make_interval(secs => p_window_ms::numeric / 1000);
  v_deadline interval := make_interval(secs => p_hard_deadline_ms::numeric / 1000);
BEGIN
  IF p_window_ms <= 0 OR p_hard_deadline_ms < p_window_ms THEN
    RAISE EXCEPTION 'INVALID_BATCH_WINDOW' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_message
  FROM messages
  WHERE id = p_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_MESSAGE_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
  IF v_message.direction <> 'inbound' THEN
    RAISE EXCEPTION 'BATCH_MESSAGE_NOT_INBOUND' USING ERRCODE = '23514';
  END IF;
  IF v_message.conversation_id <> p_conversation_id OR v_message.contact_id <> p_contact_id THEN
    RAISE EXCEPTION 'BATCH_MESSAGE_IDENTITY_MISMATCH' USING ERRCODE = '23514';
  END IF;

  -- Reentrada: un replay del mismo mensaje devuelve el lote que ya lo contiene
  -- sin volver a contarlo ni mover la ventana.
  IF v_message.batch_id IS NOT NULL THEN
    SELECT * INTO v_batch FROM inbound_batches WHERE id = v_message.batch_id;
    RETURN QUERY SELECT
      v_batch.id, true, v_batch.state, v_batch.due_at, v_batch.hard_deadline_at,
      v_message.conversation_seq, v_batch.message_count;
    RETURN;
  END IF;

  -- Serializa a los inbounds de la misma conversación. El índice parcial es el
  -- respaldo duro; este lock evita que dos ingestas compitan por crearlo.
  PERFORM 1 FROM conversations WHERE id = p_conversation_id FOR UPDATE;

  SELECT * INTO v_batch
  FROM inbound_batches
  WHERE conversation_id = p_conversation_id AND state = 'waiting'
  FOR UPDATE;

  IF FOUND THEN
    -- A hard deadline makes unanswered input due; it does not discard it.
    -- Preserve expired due/deadline values so recovery can claim immediately.
    UPDATE inbound_batches
    SET due_at        = CASE WHEN v_batch.hard_deadline_at > now()
                             THEN LEAST(hard_deadline_at, now() + v_window)
                             ELSE due_at END,
        message_count = message_count + 1,
        version       = version + 1,
        updated_at    = now()
    WHERE id = v_batch.id
    RETURNING * INTO v_batch;
    v_joined := true;
  ELSE
    INSERT INTO inbound_batches (
      conversation_id, contact_id, due_at, hard_deadline_at,
      representative_turn_id, message_count
    )
    VALUES (
      p_conversation_id, p_contact_id, now() + v_window, now() + v_deadline,
      p_message_id, 1
    )
    RETURNING * INTO v_batch;
  END IF;

  SELECT COALESCE(MAX(m.conversation_seq), 0) + 1 INTO v_seq
  FROM messages AS m
  WHERE m.conversation_id = p_conversation_id;

  UPDATE messages
  SET batch_id = v_batch.id, conversation_seq = v_seq
  WHERE id = p_message_id;

  RETURN QUERY SELECT
    v_batch.id, v_joined, v_batch.state, v_batch.due_at, v_batch.hard_deadline_at,
    v_seq, v_batch.message_count;
END;
$$;

-- ─── Reclamar la ventana ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_inbound_batch(
  p_batch_id   uuid,
  p_claimed_by text,
  p_lease_ms   integer DEFAULT 120000
)
RETURNS TABLE (
  outcome          text,
  batch_id         uuid,
  claim_token      uuid,
  conversation_id  uuid,
  contact_id       uuid,
  due_at           timestamptz,
  hard_deadline_at timestamptz,
  lease_until      timestamptz,
  retry_after_ms   integer,
  message_count    integer,
  stolen           boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_batch  inbound_batches%ROWTYPE;
  v_stolen boolean := false;
BEGIN
  IF btrim(COALESCE(p_claimed_by, '')) = '' THEN
    RAISE EXCEPTION 'CLAIMER_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_lease_ms <= 0 THEN
    RAISE EXCEPTION 'INVALID_LEASE' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_batch
  FROM inbound_batches AS b
  WHERE b.id = p_batch_id
  FOR UPDATE;

  -- An HTTP response can disappear after the claim committed. Only that same
  -- durable workflow may recover its live token, without renewing the lease,
  -- incrementing attempts or taking ownership from another workflow.
  IF FOUND AND v_batch.state = 'claimed'
    AND v_batch.claimed_by = p_claimed_by AND v_batch.lease_until > now() THEN
    RETURN QUERY SELECT
      'claimed'::text, v_batch.id, v_batch.claim_token, v_batch.conversation_id,
      v_batch.contact_id, v_batch.due_at, v_batch.hard_deadline_at, v_batch.lease_until,
      0, v_batch.message_count, false;
    RETURN;
  END IF;

  v_stolen := FOUND AND v_batch.state = 'claimed';

  -- Un único UPDATE con predicado. Cinco reclamantes simultáneos se serializan
  -- en el lock de fila; los perdedores reevalúan el WHERE contra la fila ya
  -- actualizada, no coinciden, y caen al SELECT de abajo como `absorbed`.
  UPDATE inbound_batches AS b
  SET state               = 'claimed',
      claim_token         = gen_random_uuid(),
      claimed_by          = p_claimed_by,
      claimed_at          = now(),
      lease_until         = now() + make_interval(secs => p_lease_ms::numeric / 1000),
      claim_attempt_count = b.claim_attempt_count + 1,
      version             = b.version + 1,
      updated_at          = now()
  WHERE b.id = p_batch_id
    AND (
      (b.state = 'waiting' AND now() >= b.due_at)
      -- Robo de lease vencido: el dueño anterior murió sin completar.
      OR (b.state = 'claimed' AND b.lease_until <= now())
    )
  RETURNING b.* INTO v_batch;

  IF FOUND THEN
    RETURN QUERY SELECT
      'claimed'::text, v_batch.id, v_batch.claim_token, v_batch.conversation_id,
      v_batch.contact_id, v_batch.due_at, v_batch.hard_deadline_at, v_batch.lease_until,
      0, v_batch.message_count, v_stolen;
    RETURN;
  END IF;

  SELECT * INTO v_batch FROM inbound_batches WHERE id = p_batch_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'not_found'::text, p_batch_id, NULL::uuid, NULL::uuid, NULL::uuid,
      NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, 0, 0, false;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    CASE v_batch.state
      WHEN 'waiting'   THEN 'waiting'
      WHEN 'claimed'   THEN 'absorbed'
      WHEN 'completed' THEN 'completed'
      ELSE                  'abandoned'
    END,
    v_batch.id,
    NULL::uuid,
    v_batch.conversation_id,
    v_batch.contact_id,
    v_batch.due_at,
    v_batch.hard_deadline_at,
    v_batch.lease_until,
    CASE
      WHEN v_batch.state = 'waiting'
      THEN GREATEST(0, ceil(extract(epoch FROM (v_batch.due_at - now())) * 1000))::integer
      ELSE 0
    END,
    v_batch.message_count,
    false;
END;
$$;

