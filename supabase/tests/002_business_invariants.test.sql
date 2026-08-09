BEGIN;
SELECT plan(8);

SELECT is(
  (SELECT count(*)::integer FROM pg_constraint
   WHERE conrelid = 'public.contacts'::regclass
     AND conname = 'contacts_phone_unique'
     AND contype = 'u'),
  1,
  'contact phone has one unique constraint'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_constraint
   WHERE conrelid = 'public.conversations'::regclass
     AND conname = 'conversations_contact_id_fkey'
     AND contype = 'f'),
  1,
  'conversation belongs to an existing contact'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_constraint
   WHERE conrelid = 'public.messages'::regclass
     AND conname = 'messages_conversation_id_fkey'
     AND contype = 'f'),
  1,
  'message belongs to an existing conversation'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_constraint
   WHERE conrelid = 'public.messages'::regclass
     AND conname = 'messages_contact_id_fkey'
     AND contype = 'f'),
  1,
  'message belongs to an existing contact'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_constraint
   WHERE conrelid = 'public.messages'::regclass
     AND conname = 'messages_direction_check'
     AND contype = 'c'),
  1,
  'message direction has a check constraint'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_constraint
   WHERE conrelid = 'public.message_embeddings'::regclass
     AND conname = 'message_embeddings_message_id_fkey'
     AND contype = 'f'),
  1,
  'embedding belongs to an existing message'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_constraint
   WHERE conrelid = 'public.message_embeddings'::regclass
     AND conname = 'message_embeddings_contact_id_fkey'
     AND contype = 'f'),
  1,
  'embedding belongs to an existing contact'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'messages'
     AND indexname = 'messages_in_reply_to_unique'
     AND indexdef LIKE 'CREATE UNIQUE INDEX%'),
  1,
  'reply correlation uses a unique partial index'
);

SELECT * FROM finish();
ROLLBACK;
