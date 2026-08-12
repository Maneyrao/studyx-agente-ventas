-- Fase 7b — El intento como identidad, y la pausa como estado terminal.
--
-- La revisión adversarial encontró dos caminos por los que este sistema podía
-- mandar el mismo mensaje dos veces. Los dos nacen del mismo error conceptual:
-- tratar "lo último que se supo de esta entrega" como si fuera "lo que se sabe
-- del intento que está corriendo ahora".
--
--   Fallo A — `apply_delivery_reconciliation` aceptaba `authorize_resend` sobre
--   una entrega ya marcada `ambiguous_paused`. Dos cron superpuestos alcanzan
--   para eso: la segunda pasada leyó la fila antes de que la primera escribiera
--   la pausa, y aplicó un veredicto calculado sobre un mundo que ya no existe.
--
--   Fallo B — `list_stale_outbound_deliveries` tomaba el reporte más reciente de
--   la entrega sin preguntar a qué intento pertenecía. Un `failed` del intento 1
--   quedaba entonces como evidencia sobre el intento 2, que pudo haber creado el
--   mensaje en Botpress antes de morir. El reconciliador leía "falló antes de
--   enviar" y autorizaba un reenvío encima de un envío físico.
--
-- La corrección es una sola idea aplicada en dos lugares: un reporte pertenece a
-- un intento y sólo a ese intento, y una pausa por ambigüedad no la levanta una
-- máquina. Ante incertidumbre se pausa; nunca se reenvía.
--
-- Aditiva: agrega una columna nullable, un trigger y reemplaza dos funciones
-- conservando su firma. Ninguna fila existente cambia de significado.

-- ─── El intento al que pertenece un reporte ──────────────────────────────────

ALTER TABLE delivery_reports
  ADD COLUMN delivery_attempt int
    CHECK (delivery_attempt IS NULL OR delivery_attempt >= 1);

COMMENT ON COLUMN delivery_reports.delivery_attempt IS
  'Intento de outbound_deliveries.attempt_count al que pertenece este reporte. NULL sólo en filas anteriores a la Fase 7b: se leen como evidencia de ningún intento, que pausa en vez de reenviar.';

CREATE INDEX delivery_reports_attempt_idx
  ON delivery_reports (delivery_id, delivery_attempt, reported_at DESC);

-- Un reporte no puede pertenecer a un intento que todavía no ocurrió. Si llega
-- uno, no es un reporte atrasado: es corrupción o un cliente inventando, y en
-- cualquiera de los dos casos no puede tocar la entrega.
CREATE OR REPLACE FUNCTION public.enforce_delivery_report_attempt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_current int;
BEGIN
  IF NEW.delivery_attempt IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT attempt_count INTO v_current
  FROM outbound_deliveries
  WHERE id = NEW.delivery_id;

  IF v_current IS NOT NULL AND NEW.delivery_attempt > v_current THEN
    RAISE EXCEPTION
      'delivery report claims attempt % but delivery % is on attempt %',
      NEW.delivery_attempt, NEW.delivery_id, v_current
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER delivery_reports_attempt_fence
BEFORE INSERT ON delivery_reports
FOR EACH ROW EXECUTE FUNCTION public.enforce_delivery_report_attempt();

-- ─── Candidatas a reconciliación, leídas por intento ─────────────────────────
--
-- Idéntica a la de la fase 7 salvo en una línea: el reporte que se devuelve
-- tiene que ser del intento vigente. Un reporte de un intento anterior no dice
-- nada sobre éste, y leerlo como si dijera algo es exactamente el Fallo B.
--
-- `IS NOT DISTINCT FROM` deja fuera las filas viejas con `delivery_attempt`
-- NULL. Eso es deliberado: sin intento no hay evidencia, y sin evidencia el
-- veredicto del dominio es pausar.

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
      AND r.delivery_attempt IS NOT DISTINCT FROM od.attempt_count
    ORDER BY r.reported_at DESC
    LIMIT 1
  ) AS dr ON true
  WHERE od.state IN ('pending', 'leased', 'failed_retryable')
    AND od.updated_at < now() - make_interval(secs => greatest(p_grace_seconds, 0))
    AND (od.lease_until IS NULL OR od.lease_until <= now())
    AND od.reconciliation_state IS DISTINCT FROM 'ambiguous_paused'
  ORDER BY od.updated_at
  LIMIT greatest(1, least(p_limit, 200));
$$;

-- ─── Aplicación del veredicto, con la pausa como estado terminal ─────────────
--
-- El filtro de `list_stale_outbound_deliveries` ya excluye las pausadas, pero
-- filtrar una lectura no es proteger una escritura: entre que una pasada leyó su
-- lista y escribe su veredicto, otra pasada pudo haber pausado la fila. La
-- garantía tiene que estar acá, del lado de la escritura, bajo el mismo lock que
-- decide.
--
-- Desde `ambiguous_paused` la única transición que puede hacer una máquina es
-- converger hacia un envío probado. Todo lo demás —reenviar, abandonar,
-- re-pausar— queda rechazado y auditado, porque una entrega pausada es una
-- entrega que alguien tiene que mirar, y borrarla del tablero sin que la miren
-- es perder el único registro de que algo quedó a medias.

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

  -- La pausa es adherente. Sólo una prueba física de envío la mueve.
  IF v_row.reconciliation_state = 'ambiguous_paused'
     AND NOT (p_action = 'mark_sent' AND v_row.provider_message_id IS NOT NULL) THEN
    PERFORM write_audit_log(
      'reconciler',
      'delivery.reconciliation.rejected',
      'outbound_delivery',
      p_delivery_id,
      jsonb_build_object(
        'attempted_action', p_action,
        'attempted_reason', p_reason,
        'held_reconciliation_state', v_row.reconciliation_state,
        'delivery_state', v_row.state,
        'attempt_count', v_row.attempt_count,
        'provider_message_id_present', v_row.provider_message_id IS NOT NULL
      )
    );
    RETURN QUERY SELECT false, v_row.state, v_row.reconciliation_state;
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

GRANT EXECUTE ON FUNCTION public.list_stale_outbound_deliveries(int, int) TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.apply_delivery_reconciliation(uuid, text, text) TO orchestrator_role;
