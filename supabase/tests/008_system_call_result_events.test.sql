-- Spec 007: el reconciliador post-llamada sintetiza un channel_event de
-- sistema (event_kind='system_call_result') para cerrar el loop B→A sin
-- abrir un camino paralelo a agent_decisions. Estos tests fijan el contrato
-- de esa constraint: idempotente por call_id, exige contacto/thread
-- resueltos, y nunca carga identidad de proveedor real.

BEGIN;
SELECT plan(6);

INSERT INTO contacts (id, phone, channel_origin)
VALUES ('81000000-0000-4000-8000-000000000001', '+5491100000810', 'whatsapp');

INSERT INTO channel_threads (id, contact_id, provider, integration_id, channel, external_conversation_id)
VALUES (
  '82000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  'whatsapp_meta',
  'studyx-test-integration',
  'whatsapp',
  'wa-conv-spec-007'
);

-- 1) un evento inbound_message real sigue funcionando sin cambios (regresión)
INSERT INTO channel_events (
  provider, integration_id, channel, event_kind, direction,
  external_event_id, external_message_id, external_conversation_id,
  payload_hash, contact_id, channel_thread_id
) VALUES (
  'whatsapp_meta', 'studyx-test-integration', 'whatsapp', 'inbound_message', 'inbound',
  'evt-regression-1', 'msg-regression-1', 'wa-conv-spec-007',
  decode(repeat('ab', 32), 'hex'),
  '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001'
);

SELECT ok(
  EXISTS (SELECT 1 FROM channel_events WHERE external_event_id = 'evt-regression-1'),
  'a real inbound_message event still inserts unchanged'
);

-- 2) un system_call_result válido: contacto + thread resueltos, sin identidad de proveedor
INSERT INTO channel_events (
  provider, integration_id, channel, event_kind, direction,
  external_event_id, payload_hash, contact_id, channel_thread_id
) VALUES (
  'whatsapp_meta', 'studyx-test-integration', 'whatsapp', 'system_call_result', 'inbound',
  'system:call_result:83000000-0000-4000-8000-000000000001',
  decode(repeat('cd', 32), 'hex'),
  '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM channel_events
    WHERE external_event_id = 'system:call_result:83000000-0000-4000-8000-000000000001'
      AND external_message_id IS NULL
      AND external_conversation_id IS NULL
  ),
  'a system_call_result event inserts with no provider message/conversation identity'
);

-- 3) un segundo intento sobre la misma llamada es idempotente (UNIQUE existente, sin lógica nueva)
SELECT throws_ok(
  $$
    INSERT INTO channel_events (
      provider, integration_id, channel, event_kind, direction,
      external_event_id, payload_hash, contact_id, channel_thread_id
    ) VALUES (
      'whatsapp_meta', 'studyx-test-integration', 'whatsapp', 'system_call_result', 'inbound',
      'system:call_result:83000000-0000-4000-8000-000000000001',
      decode(repeat('ef', 32), 'hex'),
      '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001'
    )
  $$,
  '23505',
  NULL,
  'a second attempt on the same call_id is rejected by the existing provider/event UNIQUE'
);

-- 4) un system_call_result sin contacto/thread resuelto es rechazado (fail-closed)
SELECT throws_ok(
  $$
    INSERT INTO channel_events (
      provider, integration_id, channel, event_kind, direction,
      external_event_id, payload_hash
    ) VALUES (
      'whatsapp_meta', 'studyx-test-integration', 'whatsapp', 'system_call_result', 'inbound',
      'system:call_result:84000000-0000-4000-8000-000000000001',
      decode(repeat('01', 32), 'hex')
    )
  $$,
  '23514',
  NULL,
  'a system_call_result without a resolved contact/thread is rejected'
);

-- 5) un system_call_result que carga external_message_id es rechazado (nunca finge ser un webhook real)
SELECT throws_ok(
  $$
    INSERT INTO channel_events (
      provider, integration_id, channel, event_kind, direction,
      external_event_id, external_message_id, payload_hash, contact_id, channel_thread_id
    ) VALUES (
      'whatsapp_meta', 'studyx-test-integration', 'whatsapp', 'system_call_result', 'inbound',
      'system:call_result:85000000-0000-4000-8000-000000000001', 'should-not-be-here',
      decode(repeat('02', 32), 'hex'),
      '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001'
    )
  $$,
  '23514',
  NULL,
  'a system_call_result carrying a provider message id is rejected'
);

-- 6) el mensaje inbound sintético cuelga del evento y agent_decisions lo acepta sin cambios de FK
INSERT INTO conversations (id, contact_id, channel, channel_thread_id, status)
VALUES (
  '86000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  'whatsapp',
  '82000000-0000-4000-8000-000000000001',
  'open'
);

INSERT INTO messages (id, conversation_id, contact_id, direction, content, source_event_id)
SELECT
  '87000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  'inbound',
  '[system:call_result]',
  id
FROM channel_events
WHERE external_event_id = 'system:call_result:83000000-0000-4000-8000-000000000001';

INSERT INTO agent_decisions (
  turn_id, trace_id, schema_version, intent, decision_kind, response, response_type,
  next_state, reason_code, confidence, model_provider, model_name, prompt_version, payload_hash
) VALUES (
  '87000000-0000-4000-8000-000000000001', gen_random_uuid(), 2, 'commercial', 'reply',
  'Che, ¿cómo quedaste con la llamada?', 'commercial_reply',
  'waiting_user', 'FOLLOWUP_SCHEDULED', 0.99, 'botpress', 'system:post-call-reconciler',
  'post-call-followup-v1', decode(repeat('99', 32), 'hex')
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM agent_decisions ad
    JOIN messages m ON m.id = ad.turn_id
    JOIN channel_events ce ON ce.id = m.source_event_id
    WHERE ce.event_kind = 'system_call_result'
  ),
  'a decision commits on a synthesized system turn with zero changes to the existing FK/immutability rules'
);

SELECT * FROM finish();
ROLLBACK;
