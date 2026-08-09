BEGIN;
SELECT plan(5);

INSERT INTO contacts (id, phone, channel_origin)
VALUES ('71000000-0000-4000-8000-000000000001', '+5491100000710', 'whatsapp');

INSERT INTO conversations (id, contact_id, channel)
VALUES (
  '72000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'whatsapp'
);

INSERT INTO messages (id, conversation_id, contact_id, direction, content)
VALUES (
  '73000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'inbound',
  'Mensaje de prueba'
);

SELECT has_constraint(
  'public',
  'agent_decisions',
  'agent_decisions_turn_id_uq',
  'decision concurrency uses a stable named turn constraint'
);

SELECT throws_ok(
  $$
    INSERT INTO agent_decisions (
      turn_id, trace_id, schema_version, intent, decision_kind, response,
      response_type, business_action, memory_candidates, missing_information,
      next_state, reason_code, confidence, model_provider, model_name,
      prompt_version, payload_hash
    ) VALUES (
      '73000000-0000-4000-8000-000000000001',
      '74000000-0000-4000-8000-000000000001',
      2, 'opt_out', 'suppress', NULL, NULL, NULL, '[]'::jsonb,
      ARRAY[]::text[], 'completed', 'DIRECT_INVALID', 1,
      'botpress', 'pgtap', 'v2', decode(repeat('aa', 32), 'hex')
    )
  $$,
  '23514',
  'new row for relation "agent_decisions" violates check constraint "agent_decisions_opt_out_shape_check"',
  'opt-out cannot exploit SQL NULL check semantics'
);

SELECT throws_ok(
  $$
    INSERT INTO agent_decisions (
      turn_id, trace_id, schema_version, intent, decision_kind, response,
      response_type, business_action, memory_candidates, missing_information,
      next_state, reason_code, confidence, model_provider, model_name,
      prompt_version, payload_hash
    ) VALUES (
      '73000000-0000-4000-8000-000000000001',
      '74000000-0000-4000-8000-000000000002',
      2, 'human_request', 'suppress', NULL, NULL, NULL, '[]'::jsonb,
      ARRAY[]::text[], 'waiting_user', 'DIRECT_INVALID', 1,
      'botpress', 'pgtap', 'v2', decode(repeat('bb', 32), 'hex')
    )
  $$,
  '23514',
  'new row for relation "agent_decisions" violates check constraint "agent_decisions_human_request_shape_check"',
  'human request cannot exploit SQL NULL check semantics'
);

INSERT INTO agent_decisions (
  id, turn_id, trace_id, schema_version, intent, decision_kind, response,
  response_type, business_action, memory_candidates, missing_information,
  next_state, reason_code, confidence, model_provider, model_name,
  prompt_version, payload_hash
) VALUES (
  '75000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000003',
  2, 'unknown', 'suppress', NULL, NULL, NULL, '[]'::jsonb,
  ARRAY[]::text[], 'completed', 'SUPPRESS_TEST', 1,
  'botpress', 'pgtap', 'v2', decode(repeat('cc', 32), 'hex')
);

INSERT INTO messages (
  id, conversation_id, contact_id, direction, content, in_reply_to
) VALUES (
  '73000000-0000-4000-8000-000000000002',
  '72000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'outbound',
  'No debe adjuntarse',
  '73000000-0000-4000-8000-000000000001'
);

SELECT throws_ok(
  $$
    UPDATE agent_decisions
    SET outbound_message_id = '73000000-0000-4000-8000-000000000002'
    WHERE id = '75000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'Agent decision is immutable after commit',
  'a suppress decision can never attach an outbound message'
);

SELECT throws_ok(
  $$
    UPDATE conversations
    SET status = 'transferred'
    WHERE id = '72000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'new row for relation "conversations" violates check constraint "conversations_status_check"',
  'conversation status is limited to open or closed'
);

SELECT * FROM finish();
ROLLBACK;
