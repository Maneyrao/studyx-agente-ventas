BEGIN;
SELECT plan(3);

INSERT INTO contacts (id, phone, channel_origin)
VALUES
  ('91000000-0000-0000-0000-000000000001', '+5491100000001', 'whatsapp'),
  ('91000000-0000-0000-0000-000000000002', '+5491100000002', 'whatsapp');

INSERT INTO conversations (id, contact_id, channel)
VALUES
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'whatsapp'),
  ('92000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000002', 'whatsapp');

INSERT INTO messages (id, conversation_id, contact_id, direction, content)
VALUES
  ('93000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'inbound', 'Curso de Python nocturno'),
  ('93000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000002', 'inbound', 'Curso de Python nocturno'),
  ('93000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'inbound', 'Embedding todavía pendiente');

INSERT INTO message_embeddings (message_id, contact_id, embedding, embedding_epoch, status)
VALUES
  ('93000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', (ARRAY[1] || array_fill(0, ARRAY[767]))::extensions.vector, 'gemini-embedding-2:768:retrieval-v1', 'indexed'),
  ('93000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000002', (ARRAY[1] || array_fill(0, ARRAY[767]))::extensions.vector, 'gemini-embedding-2:768:retrieval-v1', 'indexed'),
  ('93000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000001', array_fill(0, ARRAY[768])::extensions.vector, NULL, 'pending');

SELECT is(
  (SELECT count(*) FROM search_contact_memory(
    '91000000-0000-0000-0000-000000000001',
    (ARRAY[1] || array_fill(0, ARRAY[767]))::extensions.vector,
    10
  )),
  1::bigint,
  'search returns only the indexed memory for the requested contact'
);

SELECT is(
  (SELECT count(*) FROM search_contact_memory(
    '91000000-0000-0000-0000-000000000001',
    (ARRAY[1] || array_fill(0, ARRAY[767]))::extensions.vector,
    10
  ) WHERE contact_id <> '91000000-0000-0000-0000-000000000001'),
  0::bigint,
  'search never crosses the contact boundary'
);

SELECT is(
  (SELECT count(*) FROM search_contact_memory(
    '91000000-0000-0000-0000-000000000099',
    (ARRAY[1] || array_fill(0, ARRAY[767]))::extensions.vector,
    10
  )),
  0::bigint,
  'unknown contact returns no memory'
);

SELECT * FROM finish();
ROLLBACK;
