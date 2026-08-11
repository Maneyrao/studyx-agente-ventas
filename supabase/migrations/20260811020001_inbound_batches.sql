-- Fase 2 — Batching durable de inbounds en PostgreSQL (sin Redis).
--
-- Un cliente que escribe tres mensajes seguidos debe recibir UNA respuesta, no
-- tres. La ventana vive en una fila de `inbound_batches`; los miembros son las
-- filas existentes de `messages` a través de `messages.batch_id`, así que no
-- hace falta una tabla de membresía.
--
-- Garantía de concurrencia: exactamente un workflow reclama un lote. El resto
-- recibe `absorbed` y nunca llama al modelo ni envía. Se apoya en el bloqueo de
-- fila de un único UPDATE con predicado, no en locks de aplicación.
--
-- Migración aditiva. No reescribe migraciones aplicadas.

-- ─── Tabla ───────────────────────────────────────────────────────────────────

CREATE TABLE inbound_batches (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id        uuid        NOT NULL,
  contact_id             uuid        NOT NULL,

  -- waiting   : la ventana sigue abierta o venció y nadie reclamó todavía.
  -- claimed   : un workflow es dueño del lote y tiene lease vigente.
  -- completed : el lote produjo su decisión.
  -- abandoned : el lote quedó sin dueño de forma terminal; lo mira el reconciliador.
  state                  text        NOT NULL DEFAULT 'waiting'
                                     CHECK (state IN ('waiting', 'claimed', 'completed', 'abandoned')),

  due_at                 timestamptz NOT NULL,
  hard_deadline_at       timestamptz NOT NULL,

  claim_token            uuid,
  claimed_by             text,
  claimed_at             timestamptz,
  lease_until            timestamptz,
  claim_attempt_count    int         NOT NULL DEFAULT 0 CHECK (claim_attempt_count >= 0),

  representative_turn_id uuid        NOT NULL,
  -- Columna generada al sólo efecto de que la FK compuesta exija que el turno
  -- representativo sea inbound (mismo recurso que usa agent_decisions).
  representative_direction text      GENERATED ALWAYS AS ('inbound'::text) STORED,

  message_count          int         NOT NULL DEFAULT 1 CHECK (message_count >= 1),
  last_error_code        text,
  version                bigint      NOT NULL DEFAULT 1 CHECK (version >= 1),

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,

  -- Un lote no puede cruzar la frontera de contacto ni de conversación.
  CONSTRAINT inbound_batches_conversation_contact_fk
    FOREIGN KEY (conversation_id, contact_id)
    REFERENCES conversations (id, contact_id),

  -- Permite que `messages` referencie el lote con su propia identidad completa.
  CONSTRAINT inbound_batches_identity_uq
    UNIQUE (id, conversation_id, contact_id),

  CONSTRAINT inbound_batches_representative_fk
    FOREIGN KEY (representative_turn_id, conversation_id, contact_id, representative_direction)
    REFERENCES messages (id, conversation_id, contact_id, direction),

  CONSTRAINT inbound_batches_window_check
    CHECK (hard_deadline_at >= due_at),

  -- El estado y los campos de claim no pueden desincronizarse.
  CONSTRAINT inbound_batches_claim_shape_check
    CHECK (
      (
        state = 'waiting'
        AND claim_token IS NULL
        AND claimed_by IS NULL
        AND claimed_at IS NULL
        AND lease_until IS NULL
      )
      OR (
        state = 'claimed'
        AND claim_token IS NOT NULL
        AND claimed_by IS NOT NULL
        AND claimed_at IS NOT NULL
        AND lease_until IS NOT NULL
      )
      OR state IN ('completed', 'abandoned')
    ),

  CONSTRAINT inbound_batches_terminal_check
    CHECK ((state IN ('completed', 'abandoned')) = (completed_at IS NOT NULL))
);

-- Invariante 3 aplicada al batching: a lo sumo un lote abierto por conversación.
CREATE UNIQUE INDEX inbound_batches_one_waiting_per_conversation_uq
  ON inbound_batches (conversation_id)
  WHERE state = 'waiting';

CREATE INDEX inbound_batches_due_idx
  ON inbound_batches (due_at)
  WHERE state = 'waiting';

CREATE INDEX inbound_batches_lease_idx
  ON inbound_batches (lease_until)
  WHERE state = 'claimed';

CREATE INDEX inbound_batches_conversation_idx
  ON inbound_batches (conversation_id, created_at DESC);

-- ─── Membresía y orden estable ───────────────────────────────────────────────

ALTER TABLE messages
  ADD COLUMN batch_id         uuid,
  ADD COLUMN conversation_seq bigint;

ALTER TABLE messages
  ADD CONSTRAINT messages_batch_inbound_check
    CHECK (batch_id IS NULL OR direction = 'inbound'),
  ADD CONSTRAINT messages_conversation_seq_check
    CHECK (conversation_seq IS NULL OR conversation_seq >= 1),
  ADD CONSTRAINT messages_batch_identity_fk
    FOREIGN KEY (batch_id, conversation_id, contact_id)
    REFERENCES inbound_batches (id, conversation_id, contact_id);

-- El orden dentro del lote es determinista y no depende de `created_at`, que
-- puede empatar cuando dos mensajes llegan en el mismo milisegundo.
CREATE UNIQUE INDEX messages_conversation_seq_uq
  ON messages (conversation_id, conversation_seq)
  WHERE conversation_seq IS NOT NULL;

CREATE INDEX messages_batch_order_idx
  ON messages (batch_id, conversation_seq)
  WHERE batch_id IS NOT NULL;

-- ─── Abrir o unirse a la ventana ─────────────────────────────────────────────

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

  IF FOUND AND v_batch.hard_deadline_at > now() THEN
    -- La ventana móvil se extiende, pero nunca más allá del deadline duro.
    UPDATE inbound_batches
    SET due_at        = LEAST(hard_deadline_at, now() + v_window),
        message_count = message_count + 1,
        version       = version + 1,
        updated_at    = now()
    WHERE id = v_batch.id
    RETURNING * INTO v_batch;
    v_joined := true;
  ELSE
    -- Un lote cuya ventana venció sin que nadie lo reclamara no puede absorber
    -- mensajes nuevos: se cierra como abandonado y el reconciliador lo ve.
    IF FOUND THEN
      UPDATE inbound_batches
      SET state           = 'abandoned',
          completed_at    = now(),
          last_error_code = 'WINDOW_EXPIRED_UNCLAIMED',
          claim_token     = NULL,
          claimed_by      = NULL,
          claimed_at      = NULL,
          lease_until     = NULL,
          version         = version + 1,
          updated_at      = now()
      WHERE id = v_batch.id;
    END IF;

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

  SELECT (b.state = 'claimed') INTO v_stolen
  FROM inbound_batches AS b
  WHERE b.id = p_batch_id;

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

-- ─── Cerrar la ventana ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.complete_inbound_batch(
  p_batch_id        uuid,
  p_claim_token     uuid,
  p_last_error_code text DEFAULT NULL
)
RETURNS TABLE (outcome text, batch_id uuid, state text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_batch inbound_batches%ROWTYPE;
BEGIN
  UPDATE inbound_batches AS b
  SET state           = 'completed',
      completed_at    = now(),
      lease_until     = NULL,
      last_error_code = p_last_error_code,
      version         = b.version + 1,
      updated_at      = now()
  WHERE b.id = p_batch_id
    AND b.state = 'claimed'
    AND b.claim_token = p_claim_token
  RETURNING b.* INTO v_batch;

  IF FOUND THEN
    RETURN QUERY SELECT 'completed'::text, v_batch.id, v_batch.state;
    RETURN;
  END IF;

  SELECT * INTO v_batch FROM inbound_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, p_batch_id, NULL::text;
    RETURN;
  END IF;

  -- Cerrar dos veces con el mismo token es idempotente; hacerlo con un token
  -- ajeno es un conflicto real y el llamador tiene que enterarse.
  IF v_batch.state = 'completed' AND v_batch.claim_token = p_claim_token THEN
    RETURN QUERY SELECT 'duplicate'::text, v_batch.id, v_batch.state;
  ELSE
    RETURN QUERY SELECT 'stale_claim'::text, v_batch.id, v_batch.state;
  END IF;
END;
$$;

-- ─── Reconciliación de claims vencidos ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expire_inbound_batch_claims(
  p_max_claim_attempts integer DEFAULT 3,
  p_limit              integer DEFAULT 100
)
RETURNS TABLE (
  batch_id            uuid,
  conversation_id     uuid,
  claim_attempt_count integer,
  action              text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
BEGIN
  -- Un lote cuyo lease venció sigue siendo reclamable por robo (ver
  -- claim_inbound_batch). Sólo cuando agotó los intentos pasa a terminal, y
  -- nunca se lo devuelve a 'waiting': eso chocaría con el índice parcial si la
  -- conversación ya abrió un lote nuevo.
  RETURN QUERY
  WITH stale AS (
    SELECT b.id
    FROM inbound_batches AS b
    WHERE b.state = 'claimed'
      AND b.lease_until <= now()
    ORDER BY b.lease_until
    LIMIT GREATEST(1, p_limit)
    FOR UPDATE SKIP LOCKED
  ),
  abandoned AS (
    UPDATE inbound_batches AS b
    SET state           = 'abandoned',
        completed_at    = now(),
        last_error_code = 'CLAIM_LEASE_EXHAUSTED',
        lease_until     = NULL,
        version         = b.version + 1,
        updated_at      = now()
    FROM stale
    WHERE b.id = stale.id
      AND b.claim_attempt_count >= p_max_claim_attempts
    RETURNING b.id, b.conversation_id, b.claim_attempt_count
  )
  SELECT a.id, a.conversation_id, a.claim_attempt_count, 'abandoned'::text FROM abandoned a
  UNION ALL
  SELECT b.id, b.conversation_id, b.claim_attempt_count, 'reclaimable'::text
  FROM inbound_batches AS b
  JOIN stale ON stale.id = b.id
  WHERE b.claim_attempt_count < p_max_claim_attempts;
END;
$$;

-- ─── Privilegios ─────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON inbound_batches TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON inbound_batches FROM orchestrator_role;

GRANT EXECUTE ON FUNCTION public.open_or_join_inbound_batch(uuid, uuid, uuid, integer, integer)
  TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.claim_inbound_batch(uuid, text, integer)
  TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.complete_inbound_batch(uuid, uuid, text)
  TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.expire_inbound_batch_claims(integer, integer)
  TO orchestrator_role;

REVOKE EXECUTE ON FUNCTION public.open_or_join_inbound_batch(uuid, uuid, uuid, integer, integer)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_inbound_batch(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_inbound_batch(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_inbound_batch_claims(integer, integer) FROM PUBLIC;
