-- Applied immediately before 20260821010001 by pg-native-up.sh when the
-- focused migration fixture is enabled. These are valid legacy rows: before
-- the epoch migration selected_memories had no max-attempts column and allowed
-- any non-negative embedding_attempts value.
INSERT INTO contacts (id, phone, channel_origin)
VALUES ('e1000000-0000-4000-8000-000000000001', '+5491199000001', 'whatsapp');

INSERT INTO conversations (id, contact_id, channel)
VALUES (
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'whatsapp'
);

INSERT INTO messages (id, conversation_id, contact_id, direction, content)
VALUES
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'inbound', 'legacy attempts five'),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'inbound', 'legacy attempts seven');

INSERT INTO selected_memories (
  id, contact_id, conversation_id, source_message_id, status, memory_type,
  memory_key, value_normalized, source_quote, confidence, dedupe_hash,
  embedding_state, embedding_attempts
) VALUES
  (
    'e4000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'active', 'constraint', 'legacy_five', 'legacy five', 'legacy attempts five',
    1, repeat('5', 64), 'pending', 5
  ),
  (
    'e4000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000002',
    'active', 'constraint', 'legacy_seven', 'legacy seven', 'legacy attempts seven',
    1, repeat('7', 64), 'pending', 7
  );
