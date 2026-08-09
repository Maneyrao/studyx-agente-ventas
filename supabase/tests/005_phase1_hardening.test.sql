BEGIN;
SELECT plan(23);

SELECT has_table('public', 'channel_threads', 'provider conversation identity is durable');
SELECT has_table('public', 'channel_events', 'provider event identity is durable');
SELECT has_table('public', 'outbound_deliveries', 'outbound delivery state is durable');
SELECT has_table('public', 'outbox_events', 'transactional delivery outbox exists');
SELECT has_table('public', 'embedding_jobs', 'embedding retry work is durable');

SELECT has_column('public', 'channel_events', 'external_event_id', 'provider event id is recorded');
SELECT has_column('public', 'channel_events', 'external_message_id', 'provider message id is recorded');
SELECT has_column('public', 'channel_events', 'payload_hash', 'event payload reuse can be verified');
SELECT has_index('public', 'channel_events', 'channel_events_provider_event_uq', 'provider event identity is unique');
SELECT has_index('public', 'channel_events', 'channel_events_provider_message_uq', 'provider message redelivery is unique');
SELECT has_index('public', 'conversations', 'conversations_one_open_per_thread_uq', 'one open conversation exists per provider thread');

SELECT has_column('public', 'messages', 'source_event_id', 'inbound message links to its provider event');
SELECT has_index('public', 'messages', 'messages_source_event_uq', 'one inbound message exists per provider event');

SELECT has_column('public', 'outbound_deliveries', 'state', 'delivery has an explicit state machine');
SELECT has_column('public', 'outbound_deliveries', 'idempotency_key', 'delivery has a provider idempotency key');
SELECT has_index('public', 'outbound_deliveries', 'outbound_deliveries_retry_claim_idx', 'retryable deliveries have a claim index');

SELECT has_column('public', 'outbox_events', 'deduplication_key', 'outbox event has a deduplication key');
SELECT has_index('public', 'outbox_events', 'outbox_events_claim_idx', 'outbox workers have a claim index');

SELECT has_column('public', 'embedding_jobs', 'status', 'embedding job has an explicit state');
SELECT has_index('public', 'embedding_jobs', 'embedding_jobs_claim_idx', 'embedding workers have a claim index');
SELECT has_index('public', 'message_embeddings', 'message_embeddings_message_id_uq', 'one materialized embedding exists per message');
SELECT is(
  (SELECT count(*)::integer FROM pg_constraint
   WHERE conrelid = 'public.agent_decisions'::regclass
     AND conname = 'agent_decisions_outbound_same_turn_fk'
     AND contype = 'f'),
  1,
  'decision outbound must reply to its own inbound turn'
);
SELECT is(
  (SELECT count(*)::integer FROM pg_constraint
   WHERE conrelid = 'public.delivery_reports'::regclass
     AND conname = 'delivery_reports_delivery_message_fk'
     AND contype = 'f'),
  1,
  'delivery report cannot mix delivery and outbound message'
);

SELECT * FROM finish();
ROLLBACK;
