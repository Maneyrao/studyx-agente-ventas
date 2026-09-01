-- Dos N3 consecutivos no producen un tercer fallback: producen una derivación
-- durable a revisión del equipo.
--
-- Idempotencia: `human_review_requested_at` se escribe sólo si es NULL, así
-- que hay como máximo una derivación activa por conversación por más veces que
-- se repita el turno. La condición vive en SQL y no en TypeScript a propósito:
-- se evalúa contra la fila bloqueada, así que dos turnos concurrentes de la
-- misma conversación no pueden producir dos derivaciones.
--
-- No es `stage = 'handoff'`. `handoff` es terminal, y la conversación tiene
-- que poder seguir: una entrada nueva vuelve a intentar el modelo. Esto es una
-- marca para el equipo, no un cierre.
--
-- No hay constraint que ate la marca al contador. Sería tentador exigir
-- `human_review_requested_at IS NULL OR consecutive_technical_fallbacks >= 2`,
-- pero contradice la regla de reinicio: un turno exitoso posterior pone el
-- contador en 0 y la marca sigue escrita, porque el equipo ya fue avisado y
-- ese aviso es histórico. La garantía de que la marca no exista sin su commit
-- la da la transacción (O2), no un CHECK.
--
-- Aditiva: ninguna columna se borra (R3).

BEGIN;

ALTER TABLE conversation_sales_context_states_v1
  ADD COLUMN IF NOT EXISTS human_review_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_technical_fallbacks integer NOT NULL DEFAULT 0;

ALTER TABLE conversation_sales_context_states_v1
  DROP CONSTRAINT IF EXISTS conversation_sales_context_states_v1_fallback_count_check;

ALTER TABLE conversation_sales_context_states_v1
  ADD CONSTRAINT conversation_sales_context_states_v1_fallback_count_check
  CHECK (consecutive_technical_fallbacks BETWEEN 0 AND 2);

ALTER TABLE conversation_sales_context_state_events_v1
  ADD COLUMN IF NOT EXISTS human_review_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_technical_fallbacks integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN conversation_sales_context_states_v1.human_review_requested_at IS
  'Cuándo la conversación quedó registrada para revisión tras dos fallos técnicos consecutivos. Se escribe una sola vez: no promete atención inmediata ni transferencia en vivo.';

COMMENT ON COLUMN conversation_sales_context_states_v1.consecutive_technical_fallbacks IS
  'Fallbacks técnicos seguidos. Un turno exitoso lo reinicia a 0. Tope 2: en el segundo se deriva.';

-- Índice de la consulta del operador: las derivaciones pendientes por
-- workspace, en orden de llegada. Parcial, porque la inmensa mayoría de las
-- filas nunca se deriva.
CREATE INDEX IF NOT EXISTS conversation_sales_context_states_v1_pending_review_idx
  ON conversation_sales_context_states_v1 (workspace_id, human_review_requested_at)
  WHERE human_review_requested_at IS NOT NULL;

COMMIT;
