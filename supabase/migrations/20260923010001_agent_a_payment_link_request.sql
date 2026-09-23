-- Pedido durable de link, separado de la pregunta conversacional pendiente.
-- Permite conservar el consentimiento mientras llegan datos y consumirlo una
-- sola vez en la misma transacción que crea la decisión y el outbound.

BEGIN;

ALTER TABLE conversation_sales_context_states_v1
  ADD COLUMN IF NOT EXISTS payment_link_request jsonb;

ALTER TABLE conversation_sales_context_states_v1
  DROP CONSTRAINT IF EXISTS conversation_sales_context_states_v1_payment_link_request_check;

ALTER TABLE conversation_sales_context_states_v1
  ADD CONSTRAINT conversation_sales_context_states_v1_payment_link_request_check CHECK (
    payment_link_request IS NULL OR (
      jsonb_typeof(payment_link_request) = 'object'
      AND COALESCE(payment_link_request ->> 'status' IN ('pending', 'withdrawn', 'consumed'), false)
      AND COALESCE(length(payment_link_request ->> 'offering_code') > 0, false)
      AND COALESCE(payment_link_request ->> 'payment_plan' IN ('monthly_12', 'monthly_6', 'one_time'), false)
      AND COALESCE(jsonb_typeof(payment_link_request -> 'requested_by_turn_id') IN ('string', 'null'), false)
      AND COALESCE(jsonb_typeof(payment_link_request -> 'resolved_by_decision_id') IN ('string', 'null'), false)
    )
  );

ALTER TABLE conversation_sales_context_state_events_v1
  ADD COLUMN IF NOT EXISTS payment_link_request jsonb;

COMMENT ON COLUMN conversation_sales_context_states_v1.payment_link_request IS
  'Pedido explícito de link: selección autorizada, turno de origen y decisión que lo retiró o consumió. No reemplaza awaiting_reply.';

COMMIT;
