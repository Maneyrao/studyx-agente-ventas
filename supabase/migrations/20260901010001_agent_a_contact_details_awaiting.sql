-- El intake de los seis datos comerciales necesita una pregunta pendiente
-- propia: sin ella, pedir nombre/apellido/correo antes del link no sobrevive
-- al turno y el cliente vuelve a recibir la misma pregunta.

BEGIN;

ALTER TABLE conversation_sales_context_states_v1
  DROP CONSTRAINT IF EXISTS conversation_sales_context_states_v1_awaiting_check;

ALTER TABLE conversation_sales_context_states_v1
  ADD CONSTRAINT conversation_sales_context_states_v1_awaiting_check
  CHECK (awaiting_reply IN (
    'none', 'area_choice', 'course_choice', 'call_or_chat',
    'payment_plan', 'payment_confirmation', 'contact_details'
  ));

COMMIT;
