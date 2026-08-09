BEGIN;
SELECT plan(7);

CREATE TEMP TABLE test_reservations AS
SELECT attempt, reservation.*
FROM generate_series(1, 10) AS attempt
CROSS JOIN LATERAL public.reserve_inbound_channel_event(
  'botpress',
  'studyx-test-integration',
  'whatsapp',
  'event-replayed-ten-times',
  'message-replayed-ten-times',
  'conversation-for-replay',
  decode(repeat('ab', 32), 'hex'),
  jsonb_build_object('content', 'hola', 'stable', attempt * 0)
) AS reservation;

SELECT is((SELECT count(*) FROM test_reservations), 10::bigint, 'all ten callers receive a reservation result');
SELECT is((SELECT count(*) FROM public.channel_events WHERE external_message_id = 'message-replayed-ten-times'), 1::bigint, 'ten deliveries persist one channel event');
SELECT is((SELECT count(*) FROM test_reservations WHERE was_created), 1::bigint, 'only one caller creates the event');
SELECT is((SELECT count(DISTINCT event_id) FROM test_reservations), 1::bigint, 'all callers receive the same event id');
SELECT ok((SELECT bool_and(payload_matches) FROM test_reservations), 'identical replay payloads all match');

CREATE TEMP TABLE test_payload_conflict AS
SELECT *
FROM public.reserve_inbound_channel_event(
  'botpress',
  'studyx-test-integration',
  'whatsapp',
  'event-replayed-ten-times',
  'message-replayed-ten-times',
  'conversation-for-replay',
  decode(repeat('cd', 32), 'hex'),
  '{"content":"different payload"}'::jsonb
);

SELECT ok(
  (SELECT NOT was_created AND NOT payload_matches FROM test_payload_conflict),
  'same external identity with another payload is exposed as a conflict'
);

CREATE TEMP TABLE test_provider_redelivery AS
SELECT *
FROM public.reserve_inbound_channel_event(
  'botpress',
  'studyx-test-integration',
  'whatsapp',
  'new-provider-event-id',
  'message-replayed-ten-times',
  'conversation-for-replay',
  decode(repeat('ab', 32), 'hex'),
  '{"content":"hola","stable":0}'::jsonb
);

SELECT ok(
  (SELECT NOT was_created AND payload_matches FROM test_provider_redelivery),
  'a provider redelivery with a new event id but the same message id is deduplicated'
);

SELECT * FROM finish();
ROLLBACK;
