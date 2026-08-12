-- Fase 4 — Memoria histórica seleccionada.
--
-- Hasta acá la "memoria de largo plazo" era el embedding de todo mensaje no
-- trivial: barata de escribir y imposible de auditar. Un dato inventado por el
-- modelo entraba al índice y volvía como verdad en cada turno siguiente.
--
-- `selected_memories` invierte la carga de la prueba. Nada se recuerda salvo
-- que sobreviva a una validación estructural: la cita tiene que existir en el
-- lote reclamado, la fuente tiene que ser un inbound del MISMO contacto, el
-- tipo tiene que estar en una lista cerrada, y sólo lo aceptado y activo puede
-- vectorizarse.
--
-- Los rechazos también se guardan. Son la materia prima del piloto: sin ellos
-- "el agente inventó un dato" es una anécdota en vez de una fila con motivo.
--
-- Migración aditiva. No reescribe migraciones aplicadas.

-- ─── Tabla ───────────────────────────────────────────────────────────────────

CREATE TABLE selected_memories (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  contact_id             uuid        NOT NULL REFERENCES contacts (id),
  conversation_id        uuid        NOT NULL,

  -- Mensaje inbound del que salió la cita. NULL sólo para rechazos cuya cita
  -- no pudo resolverse: guardar el intento sigue siendo evidencia.
  source_message_id      uuid,
  -- Columna generada al sólo efecto de que la FK compuesta exija que la fuente
  -- sea un inbound (mismo recurso que usan `agent_decisions` e `inbound_batches`).
  source_direction       text        GENERATED ALWAYS AS ('inbound'::text) STORED,
  source_batch_id        uuid        REFERENCES inbound_batches (id),
  decision_id            uuid        REFERENCES agent_decisions (id),

  -- proposed  : el modelo la propuso, todavía no se resolvió.
  -- accepted  : pasó todas las validaciones; aún no ganó el slot de su clave.
  -- rejected  : terminal, con `rejection_reason`.
  -- active    : es el valor autoritativo de (contacto, tipo, clave).
  -- superseded: la reemplazó una memoria posterior.
  -- expired   : venció su vigencia.
  status                 text        NOT NULL DEFAULT 'proposed'
                                     CHECK (status IN (
                                       'proposed', 'accepted', 'rejected',
                                       'active', 'superseded', 'expired'
                                     )),

  memory_type            text        NOT NULL CHECK (memory_type IN (
                                       'study_goal',
                                       'study_context',
                                       'preference',
                                       'constraint',
                                       'objection',
                                       'timeline',
                                       'contact_preference'
                                     )),
  memory_key             text        NOT NULL CHECK (memory_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  value_normalized       text        NOT NULL CHECK (btrim(value_normalized) <> ''
                                                     AND length(value_normalized) <= 512),
  -- Cita textual tal como la escribió el cliente. Es lo que hace verificable
  -- el dato: sin ella no se puede probar que no fue inventado.
  source_quote           text        NOT NULL CHECK (btrim(source_quote) <> ''
                                                     AND length(source_quote) <= 2048),

  confidence             double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),

  acceptance_reason      text,
  rejection_reason       text,
  -- Campo estructurado con el que chocó, cuando el rechazo fue por contradicción.
  contradicts_field      text,

  -- sha256 hex sobre contacto + tipo + clave + valor normalizado.
  dedupe_hash            text        NOT NULL CHECK (dedupe_hash ~ '^[0-9a-f]{64}$'),

  valid_from             timestamptz NOT NULL DEFAULT now(),
  valid_until            timestamptz,

  supersedes_memory_id   uuid        REFERENCES selected_memories (id),
  superseded_by_memory_id uuid       REFERENCES selected_memories (id),

  -- El embedding es derivado y degradable: puede quedar en 'failed' para
  -- siempre sin que la conversación se detenga.
  embedding              extensions.vector(768),
  embedding_state        text        NOT NULL DEFAULT 'skip'
                                     CHECK (embedding_state IN ('skip', 'pending', 'ready', 'failed')),
  embedding_attempts     int         NOT NULL DEFAULT 0 CHECK (embedding_attempts >= 0),
  embedding_last_error   text,
  embedding_updated_at   timestamptz,

  trace_id               uuid,
  created_by             text        NOT NULL DEFAULT 'orchestrator',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at            timestamptz,

  -- Una memoria no puede cruzar la frontera de contacto ni de conversación.
  CONSTRAINT selected_memories_conversation_contact_fk
    FOREIGN KEY (conversation_id, contact_id)
    REFERENCES conversations (id, contact_id),

  -- La fuente citada pertenece al mismo contacto Y a la misma conversación Y es
  -- inbound. Es la parte del aislamiento que no depende de que el código acierte.
  CONSTRAINT selected_memories_source_fk
    FOREIGN KEY (source_message_id, conversation_id, contact_id, source_direction)
    REFERENCES messages (id, conversation_id, contact_id, direction),

  CONSTRAINT selected_memories_source_required_check
    CHECK (status = 'rejected' OR source_message_id IS NOT NULL),

  CONSTRAINT selected_memories_rejection_shape_check
    CHECK ((status = 'rejected') = (rejection_reason IS NOT NULL)),

  CONSTRAINT selected_memories_superseded_shape_check
    CHECK ((status = 'superseded') = (superseded_by_memory_id IS NOT NULL)),

  CONSTRAINT selected_memories_resolved_shape_check
    CHECK ((status IN ('rejected', 'superseded', 'expired')) = (resolved_at IS NOT NULL)),

  -- Invariante central de la fase: sólo lo aceptado y activo se vectoriza.
  CONSTRAINT selected_memories_embedding_scope_check
    CHECK (
      (embedding IS NULL AND embedding_state IN ('skip', 'pending', 'failed'))
      OR (embedding IS NOT NULL AND embedding_state = 'ready'
          AND status IN ('accepted', 'active'))
    ),

  CONSTRAINT selected_memories_embedding_state_scope_check
    CHECK (embedding_state = 'skip' OR status IN ('accepted', 'active')),

  CONSTRAINT selected_memories_validity_check
    CHECK (valid_until IS NULL OR valid_until > valid_from)
);

-- Un solo valor activo por (contacto, tipo, clave). Es lo que convierte el
-- reemplazo en una operación verificable: no se puede insertar el nuevo sin
-- haber sacado al anterior de 'active'.
CREATE UNIQUE INDEX selected_memories_active_slot_uq
  ON selected_memories (contact_id, memory_type, memory_key)
  WHERE status = 'active';

-- Deduplicación: el mismo hecho, del mismo contacto, no se guarda dos veces
-- mientras siga vigente. Un duplicado posterior refresca, no acumula.
CREATE UNIQUE INDEX selected_memories_dedupe_uq
  ON selected_memories (contact_id, dedupe_hash)
  WHERE status IN ('accepted', 'active');

CREATE INDEX selected_memories_contact_status_idx
  ON selected_memories (contact_id, status);

CREATE INDEX selected_memories_embedding_pending_idx
  ON selected_memories (embedding_state, created_at)
  WHERE embedding_state = 'pending';

CREATE INDEX selected_memories_expiry_idx
  ON selected_memories (valid_until)
  WHERE status = 'active' AND valid_until IS NOT NULL;

CREATE INDEX selected_memories_embedding_hnsw_idx
  ON selected_memories
  USING hnsw (embedding extensions.vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE TRIGGER selected_memories_set_updated_at
BEFORE UPDATE ON selected_memories
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

COMMENT ON TABLE selected_memories IS
  'Memoria histórica seleccionada. Sólo entra lo que supera la validación estructural; sólo lo activo se vectoriza y se recupera.';

-- ─── Registro de una memoria aceptada ────────────────────────────────────────
--
-- Una sola función para que dedupe, reemplazo y activación ocurran bajo el
-- mismo lock de fila. Hacerlo desde la aplicación abriría la ventana en la que
-- dos turnos concurrentes del mismo contacto activan dos valores para la misma
-- clave, y el índice parcial los rechazaría con un 23505 que el llamador
-- tendría que interpretar a ciegas.

CREATE OR REPLACE FUNCTION public.record_selected_memory(
  p_contact_id        uuid,
  p_conversation_id   uuid,
  p_source_message_id uuid,
  p_source_batch_id   uuid,
  p_decision_id       uuid,
  p_memory_type       text,
  p_memory_key        text,
  p_value_normalized  text,
  p_source_quote      text,
  p_confidence        double precision,
  p_dedupe_hash       text,
  p_ttl_days          int,
  p_trace_id          uuid
)
RETURNS TABLE (
  outcome            text,
  memory_id          uuid,
  superseded_memory_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
#variable_conflict use_column
DECLARE
  v_existing_id     uuid;
  v_existing_hash   text;
  v_new_id          uuid;
  v_superseded      uuid := NULL;
BEGIN
  -- Serializa a los concurrentes del mismo contacto sobre la misma clave.
  PERFORM 1 FROM contacts WHERE id = p_contact_id FOR UPDATE;

  -- ¿Ya está guardado este mismo hecho?
  SELECT sm.id INTO v_existing_id
  FROM selected_memories AS sm
  WHERE sm.contact_id = p_contact_id
    AND sm.dedupe_hash = p_dedupe_hash
    AND sm.status IN ('accepted', 'active')
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Un duplicado no crea una fila nueva: refresca la vigencia del original.
    UPDATE selected_memories
    SET
      valid_until = CASE
        WHEN p_ttl_days IS NULL THEN NULL
        ELSE now() + make_interval(days => p_ttl_days)
      END,
      confidence = GREATEST(confidence, p_confidence)
    WHERE id = v_existing_id;

    RETURN QUERY SELECT 'duplicate'::text, v_existing_id, NULL::uuid;
    RETURN;
  END IF;

  -- ¿Hay un valor activo distinto para la misma clave? Entonces esto es un
  -- reemplazo, y el anterior deja de estar activo en la misma transacción.
  SELECT sm.id, sm.dedupe_hash INTO v_existing_id, v_existing_hash
  FROM selected_memories AS sm
  WHERE sm.contact_id = p_contact_id
    AND sm.memory_type = p_memory_type
    AND sm.memory_key = p_memory_key
    AND sm.status = 'active'
  LIMIT 1;

  -- El orden es forzado por dos restricciones que no se pueden diferir: el
  -- índice parcial deja UN solo 'active' por clave, y la FK de reemplazo exige
  -- que la fila nueva ya exista para poder apuntarle. Por eso la nueva entra
  -- primero como 'accepted' (que no ocupa el slot), después se degrada la
  -- anterior, y recién entonces la nueva se promueve. Los tres pasos ocurren
  -- bajo el mismo lock de `contacts`, así que ningún lector concurrente ve el
  -- intermedio con cero memorias activas para la clave.
  INSERT INTO selected_memories (
    contact_id, conversation_id, source_message_id, source_batch_id, decision_id,
    status, memory_type, memory_key, value_normalized, source_quote, confidence,
    acceptance_reason, dedupe_hash, valid_until,
    supersedes_memory_id, embedding_state, trace_id
  )
  VALUES (
    p_contact_id, p_conversation_id, p_source_message_id, p_source_batch_id, p_decision_id,
    'accepted', p_memory_type, p_memory_key, p_value_normalized, p_source_quote, p_confidence,
    CASE WHEN v_existing_id IS NULL THEN 'STRUCTURALLY_VALIDATED' ELSE 'SUPERSEDES_PREVIOUS' END,
    p_dedupe_hash,
    CASE WHEN p_ttl_days IS NULL THEN NULL ELSE now() + make_interval(days => p_ttl_days) END,
    v_existing_id, 'pending', p_trace_id
  )
  RETURNING id INTO v_new_id;

  IF v_existing_id IS NOT NULL THEN
    UPDATE selected_memories
    SET
      status = 'superseded',
      superseded_by_memory_id = v_new_id,
      resolved_at = now(),
      -- Un vector que ya no es autoritativo no puede seguir siendo recuperable.
      embedding = NULL,
      embedding_state = 'skip'
    WHERE id = v_existing_id;
    v_superseded := v_existing_id;
  END IF;

  UPDATE selected_memories SET status = 'active' WHERE id = v_new_id;

  RETURN QUERY SELECT 'recorded'::text, v_new_id, v_superseded;
END;
$$;

-- ─── Registro de un rechazo ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_rejected_memory(
  p_contact_id        uuid,
  p_conversation_id   uuid,
  p_source_message_id uuid,
  p_source_batch_id   uuid,
  p_decision_id       uuid,
  p_memory_type       text,
  p_memory_key        text,
  p_value_normalized  text,
  p_source_quote      text,
  p_confidence        double precision,
  p_dedupe_hash       text,
  p_rejection_reason  text,
  p_contradicts_field text,
  p_trace_id          uuid
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
AS $$
  INSERT INTO selected_memories (
    contact_id, conversation_id, source_message_id, source_batch_id, decision_id,
    status, memory_type, memory_key, value_normalized, source_quote, confidence,
    rejection_reason, contradicts_field, dedupe_hash,
    embedding_state, resolved_at, trace_id
  )
  VALUES (
    p_contact_id, p_conversation_id, p_source_message_id, p_source_batch_id, p_decision_id,
    'rejected',
    -- Un tipo fuera de la lista blanca no puede violar el CHECK del enum sólo
    -- por dejar constancia del intento: se archiva bajo un tipo neutro.
    CASE WHEN p_memory_type IN (
      'study_goal', 'study_context', 'preference',
      'constraint', 'objection', 'timeline', 'contact_preference'
    ) THEN p_memory_type ELSE 'preference' END,
    CASE WHEN p_memory_key ~ '^[a-z][a-z0-9_]{0,63}$' THEN p_memory_key ELSE 'rejected_candidate' END,
    left(coalesce(nullif(btrim(p_value_normalized), ''), '[vacio]'), 512),
    left(coalesce(nullif(btrim(p_source_quote), ''), '[sin_cita]'), 2048),
    p_confidence,
    p_rejection_reason, p_contradicts_field, p_dedupe_hash,
    'skip', now(), p_trace_id
  )
  RETURNING id;
$$;

-- ─── Expiración ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expire_selected_memories(
  p_limit int DEFAULT 500
)
RETURNS TABLE (memory_id uuid, contact_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT sm.id
    FROM selected_memories AS sm
    WHERE sm.status = 'active'
      AND sm.valid_until IS NOT NULL
      AND sm.valid_until <= now()
    ORDER BY sm.valid_until
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE selected_memories AS sm
  SET
    status = 'expired',
    resolved_at = now(),
    -- Expirar sin borrar el vector dejaría la memoria recuperable después de
    -- haber dejado de ser cierta.
    embedding = NULL,
    embedding_state = 'skip'
  FROM due
  WHERE sm.id = due.id
  RETURNING sm.id, sm.contact_id;
END;
$$;

-- ─── Recuperación ────────────────────────────────────────────────────────────
--
-- Contact-scoped en SQL, igual que `search_contact_memory`: el aislamiento no
-- depende de que el llamador se acuerde de filtrar.

CREATE OR REPLACE FUNCTION public.search_selected_memories(
  p_contact_id      uuid,
  p_query_embedding extensions.vector(768),
  p_limit           int DEFAULT 5,
  p_min_similarity  double precision DEFAULT 0.75
)
RETURNS TABLE (
  memory_id    uuid,
  memory_type  text,
  memory_key   text,
  value_text   text,
  source_quote text,
  similarity   float,
  recorded_at  timestamptz
)
LANGUAGE sql STABLE
SECURITY INVOKER
AS $$
  SELECT
    sm.id,
    sm.memory_type,
    sm.memory_key,
    sm.value_normalized,
    sm.source_quote,
    1 - (sm.embedding OPERATOR(extensions.<=>) p_query_embedding) AS similarity,
    sm.created_at
  FROM selected_memories AS sm
  WHERE sm.contact_id = p_contact_id
    AND sm.status = 'active'
    AND sm.embedding IS NOT NULL
    AND (sm.valid_until IS NULL OR sm.valid_until > now())
    AND 1 - (sm.embedding OPERATOR(extensions.<=>) p_query_embedding) >= p_min_similarity
  ORDER BY sm.embedding OPERATOR(extensions.<=>) p_query_embedding
  LIMIT greatest(1, least(p_limit, 20));
$$;

-- ─── Cola de vectorización ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_memory_embeddings(
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  memory_id  uuid,
  contact_id uuid,
  value_text text,
  attempts   int
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT sm.id
    FROM selected_memories AS sm
    WHERE sm.embedding_state = 'pending'
      AND sm.status IN ('accepted', 'active')
    ORDER BY sm.created_at
    LIMIT greatest(1, least(p_limit, 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE selected_memories AS sm
  SET embedding_attempts = sm.embedding_attempts + 1
  FROM due
  WHERE sm.id = due.id
  RETURNING sm.id, sm.contact_id, sm.value_normalized, sm.embedding_attempts;
END;
$$;

-- ─── Privilegios ─────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON selected_memories TO orchestrator_role;

GRANT EXECUTE ON FUNCTION public.record_selected_memory(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text,
  double precision, text, int, uuid
) TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.record_rejected_memory(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text,
  double precision, text, text, text, uuid
) TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.expire_selected_memories(int) TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.search_selected_memories(
  uuid, extensions.vector, int, double precision
) TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.claim_memory_embeddings(int) TO orchestrator_role;
