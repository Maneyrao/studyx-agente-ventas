-- El cliente diciendo "ya pagué" es un hecho durable y distinto de un pago
-- verificado. Se guarda como afirmación fechada, nunca como verificación:
-- no existe ni existirá aquí una columna que diga que el dinero llegó.
--
-- Es lo que habilita la fila operativa de revisión humana, junto con los seis
-- datos del contrato comercial. El envío del link no la habilita.

BEGIN;

ALTER TABLE conversation_sales_context_states_v1
  ADD COLUMN IF NOT EXISTS payment_reported_at timestamptz;

ALTER TABLE conversation_sales_context_state_events_v1
  ADD COLUMN IF NOT EXISTS payment_reported_at timestamptz;

COMMENT ON COLUMN conversation_sales_context_states_v1.payment_reported_at IS
  'Cuándo el cliente afirmó haber pagado. Es su declaración, no evidencia de acreditación.';

COMMIT;
