BEGIN;
SELECT plan(12);

SELECT has_table('public', 'contacts', 'contacts table exists');
SELECT has_table('public', 'conversations', 'conversations table exists');
SELECT has_table('public', 'messages', 'messages table exists');
SELECT has_table('public', 'message_embeddings', 'message_embeddings table exists');
SELECT has_table('public', 'audit_log', 'audit_log table exists');

SELECT has_column('public', 'contacts', 'phone', 'contacts have a phone identity');
SELECT has_column('public', 'contacts', 'pending_turns', 'contacts track pending turns');
SELECT has_column('public', 'messages', 'in_reply_to', 'messages correlate replies to turns');
SELECT has_column('public', 'message_embeddings', 'embedding', 'embedding vector is stored');
SELECT has_column('public', 'audit_log', 'occurred_at', 'audit events have an occurrence timestamp');

SELECT has_index('public', 'contacts', 'contacts_phone_unique', 'phone uniqueness is structural');
SELECT has_index('public', 'messages', 'messages_in_reply_to_unique', 'one reply per turn is structural');

SELECT * FROM finish();
ROLLBACK;
