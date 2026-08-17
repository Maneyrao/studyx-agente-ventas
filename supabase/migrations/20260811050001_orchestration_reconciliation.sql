-- Fase 7 — Reconciliador durable.
--
-- Todo lo que puede quedar a medias en este sistema queda a medias en una fila:
-- un lote reclamado por un workflow que murió, una entrega arrendada que nunca
-- reportó, una decisión sin outbound. El reconciliador es el único proceso que
-- puede tocar esas filas, y su regla es una sola:
--
--   sólo se autoriza un reenvío si hay evidencia AFIRMATIVA de que no hubo
--   envío físico.
--
-- No la ausencia de evidencia de que sí lo hubo. Por eso el estado ambiguo
-- —arrendado, lease vencido, sin reporte— tiene su propio destino terminal:
-- `ambiguous_paused`, que ninguna pasada posterior puede convertir en reenvío.
--
-- Migración aditiva: agrega columnas nullable y funciones nuevas. No reescribe
-- el CHECK de `state`, así que ninguna fila existente cambia de significado.

ALTER TABLE outbound_deliveries
  ADD COLUMN reconciliation_state text
    CHECK (reconciliation_state IN (
      'ambiguous_paused',
      'resend_authorized',
      'confirmed_sent',
      'abandoned'
    )),
  ADD COLUMN reconciliation_reason text,
  ADD COLUMN reconciled_at timestamptz,
  ADD COLUMN reconciliation_count int NOT NULL DEFAULT 0
    CHECK (reconciliation_count >= 0);

ALTER TABLE outbound_deliveries
  ADD CONSTRAINT outbound_deliveries_reconciliation_shape_check
    CHECK ((reconciliation_state IS NULL) = (reconciled_at IS NULL));

-- Una entrega pausada por ambigüedad no vuelve sola: es el estado que un
-- humano tiene que mirar.
CREATE INDEX outbound_deliveries_reconciliation_idx
  ON outbound_deliveries (reconciliation_state, reconciled_at)
  WHERE reconciliation_state IS NOT NULL;

CREATE INDEX outbound_deliveries_stale_idx
  ON outbound_deliveries (state, lease_until)
  WHERE state IN ('pending', 'leased', 'failed_retryable');

COMMENT ON COLUMN outbound_deliveries.reconciliation_state IS
  'Veredicto del reconciliador. ambiguous_paused es terminal para la máquina: sólo una persona lo saca de ahí.';

-- ─── Candidatas a reconciliación ─────────────────────────────────────────────
--
-- Devuelve los hechos que necesita `decideDeliveryReconciliation`, no una
-- decisión: la regla vive en el dominio, en TypeScript, donde se puede probar
-- exhaustivamente sin una base de datos.

CREATE OR REPLACE FUNCTION public.list_stale_outbound_deliveries(
  p_limit int DEFAULT 50,
  p_grace_seconds int DEFAULT 60
)
RETURNS TABLE (
  delivery_id           uuid,
  outbound_id           uuid,
  conversation_id       uuid,
  contact_id            uuid,
  state                 text,
  provider_message_id   text,
  attempt_count         int,
  max_attempts          int,
  lease_until           timestamptz,
  reported_status       text,
  reconciliation_state  text,
  outbox_id             uuid,
  outbox_state          text
)
LANGUAGE sql STABLE
SECURITY INVOKER
AS $$
  SELECT
    od.id,
    od.message_id,
    od.conversation_id,
    od.contact_id,
    od.state,
    od.provider_message_id,
    od.attempt_count,
    od.max_attempts,
    od.lease_until,
    dr.report_status,
    od.reconciliation_state,
    oe.id,
    oe.state
  FROM outbound_deliveries AS od
  JOIN outbox_events AS oe ON oe.delivery_id = od.id
  LEFT JOIN LATERAL (
    SELECT report_status
    FROM delivery_reports AS r
    WHERE r.outbound_message_id = od.message_id
    ORDER BY r.reported_at DESC
    LIMIT 1
  ) AS dr ON true
  WHERE od.state IN ('pending', 'leased', 'failed_retryable')
    -- La gracia evita pelear con un workflow que todavía está en vuelo.
    AND od.updated_at < now() - make_interval(secs => greatest(p_grace_seconds, 0))
    AND (od.lease_until IS NULL OR od.lease_until <= now())
    AND od.reconciliation_state IS DISTINCT FROM 'ambiguous_paused'
  ORDER BY od.updated_at
  LIMIT greatest(1, least(p_limit, 200));
$$;

-- ─── Aplicación del veredicto ────────────────────────────────────────────────
--
-- Una sola función para que el veredicto y el estado de la entrega no puedan
-- separarse. El predicado vuelve a comprobar `provider_message_id`: entre que
-- se leyó la fila y se escribe, un reporte tardío pudo confirmar el envío, y en
-- ese caso el reenvío deja de estar autorizado.

CREATE OR REPLACE FUNCTION public.apply_delivery_reconciliation(
  p_delivery_id uuid,
  p_action      text,
  p_reason      text
)
RETURNS TABLE (applied boolean, new_state text, new_reconciliation_state text)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
#variable_conflict use_column
DECLARE
  v_row outbound_deliveries%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM outbound_deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF p_action = 'authorize_resend' THEN
    -- Última verificación antes de autorizar: si apareció un id de mensaje, el
    -- envío ocurrió y este camino queda cerrado para siempre.
    IF v_row.provider_message_id IS NOT NULL THEN
      UPDATE outbound_deliveries
      SET reconciliation_state = 'confirmed_sent',
          reconciliation_reason = 'PROVIDER_MESSAGE_ID_APPEARED',
          reconciled_at = now(),
          reconciliation_count = reconciliation_count + 1
      WHERE id = p_delivery_id;
      RETURN QUERY SELECT true, v_row.state, 'confirmed_sent'::text;
      RETURN;
    END IF;

    -- `pending` y `failed_retryable` YA son los estados desde los que un worker
    -- puede tomar la entrega: la máquina de estados de la fase 1 sólo permite
    -- salir de ellos hacia `leased`. Autorizar un reenvío no es entonces mover
    -- el estado —eso sería pelearse con la máquina— sino soltar el lease muerto
    -- y adelantar el reloj de reintento. El veredicto queda en
    -- `reconciliation_state`, que es donde una persona lo puede auditar.
    UPDATE outbound_deliveries
    SET lease_until = NULL,
        leased_by = NULL,
        next_attempt_at = now(),
        reconciliation_state = 'resend_authorized',
        reconciliation_reason = p_reason,
        reconciled_at = now(),
        reconciliation_count = reconciliation_count + 1
    WHERE id = p_delivery_id;

    UPDATE outbox_events
    SET lease_until = NULL, leased_by = NULL, available_at = now()
    WHERE delivery_id = p_delivery_id AND state IN ('pending', 'failed_retryable');

    RETURN QUERY SELECT true, v_row.state, 'resend_authorized'::text;
    RETURN;
  END IF;

  IF p_action = 'pause_ambiguous' THEN
    UPDATE outbound_deliveries
    SET lease_until = NULL,
        leased_by = NULL,
        reconciliation_state = 'ambiguous_paused',
        reconciliation_reason = p_reason,
        reconciled_at = now(),
        reconciliation_count = reconciliation_count + 1
    WHERE id = p_delivery_id;
    RETURN QUERY SELECT true, v_row.state, 'ambiguous_paused'::text;
    RETURN;
  END IF;

  IF p_action = 'mark_sent' THEN
    -- `submitted` sólo es alcanzable desde `leased`. Pasar por ahí no es un
    -- rodeo: es exactamente lo que pasó —alguien tomó la entrega y la envió—
    -- y deja la transición registrada en `version` en vez de saltearla.
    IF v_row.state IN ('pending', 'failed_retryable') THEN
      UPDATE outbound_deliveries
      SET state = 'leased',
          leased_by = 'reconciler',
          lease_until = now() + interval '1 minute'
      WHERE id = p_delivery_id AND state = v_row.state;
    END IF;

    UPDATE outbound_deliveries
    SET state = CASE WHEN state IN ('submitted', 'delivered') THEN state ELSE 'submitted' END,
        submitted_at = COALESCE(submitted_at, now()),
        lease_until = NULL,
        leased_by = NULL,
        reconciliation_state = 'confirmed_sent',
        reconciliation_reason = p_reason,
        reconciled_at = now(),
        reconciliation_count = reconciliation_count + 1
    WHERE id = p_delivery_id;

    UPDATE outbox_events
    SET state = 'leased', leased_by = 'reconciler', lease_until = now() + interval '1 minute'
    WHERE delivery_id = p_delivery_id AND state IN ('pending', 'failed_retryable');

    UPDATE outbox_events
    SET state = 'published', published_at = COALESCE(published_at, now()),
        lease_until = NULL, leased_by = NULL
    WHERE delivery_id = p_delivery_id AND state = 'leased';

    RETURN QUERY SELECT true, 'submitted'::text, 'confirmed_sent'::text;
    RETURN;
  END IF;

  IF p_action = 'abandon' THEN
    UPDATE outbound_deliveries
    SET state = 'dead_letter',
        lease_until = NULL,
        leased_by = NULL,
        reconciliation_state = 'abandoned',
        reconciliation_reason = p_reason,
        reconciled_at = now(),
        reconciliation_count = reconciliation_count + 1
    WHERE id = p_delivery_id;

    UPDATE outbox_events
    SET state = 'dead_letter', lease_until = NULL, leased_by = NULL
    WHERE delivery_id = p_delivery_id AND state NOT IN ('published', 'dead_letter', 'cancelled');

    RETURN QUERY SELECT true, 'dead_letter'::text, 'abandoned'::text;
    RETURN;
  END IF;

  -- 'wait' y cualquier acción desconocida no tocan nada.
  RETURN QUERY SELECT false, v_row.state, v_row.reconciliation_state;
END;
$$;

-- ─── Decisiones sin outbound ─────────────────────────────────────────────────
--
-- Una decisión con respuesta pero sin `outbound_message_id` significa que la
-- transacción de commit se partió al medio, que no debería poder pasar: está
-- toda en una serializable. Se detecta igual, porque el día que pase hay que
-- verlo, no descubrirlo por un cliente sin respuesta.

CREATE OR REPLACE FUNCTION public.list_orphaned_decisions(
  p_limit int DEFAULT 50,
  p_grace_seconds int DEFAULT 300
)
RETURNS TABLE (
  decision_id uuid,
  turn_id     uuid,
  trace_id    uuid,
  created_at  timestamptz
)
LANGUAGE sql STABLE
SECURITY INVOKER
AS $$
  SELECT ad.id, ad.turn_id, ad.trace_id, ad.created_at
  FROM agent_decisions AS ad
  WHERE ad.decision_kind IN ('reply', 'clarify')
    AND ad.response IS NOT NULL
    AND ad.outbound_message_id IS NULL
    AND ad.created_at < now() - make_interval(secs => greatest(p_grace_seconds, 0))
  ORDER BY ad.created_at
  LIMIT greatest(1, least(p_limit, 200));
$$;

-- ─── Privilegios ─────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.list_stale_outbound_deliveries(int, int) TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.apply_delivery_reconciliation(uuid, text, text) TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.list_orphaned_decisions(int, int) TO orchestrator_role;
