-- Phase 1 preflight.
--
-- This migration intentionally aborts before any Phase 1 DDL is applied when
-- legacy rows violate the invariants that the following migrations enforce.
-- It never repairs or merges production data automatically: those operations
-- require an explicit backup and an operator-reviewed remediation plan.

DO $$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*)
    INTO v_count
  FROM messages AS m
  JOIN conversations AS c ON c.id = m.conversation_id
  WHERE m.contact_id <> c.contact_id;

  IF v_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'Phase 1 preflight failed: %s messages reference a contact different from their conversation',
        v_count
      ),
      HINT = 'Inspect messages joined to conversations and repair contact_id before retrying the migration.';
  END IF;

  SELECT count(*)
    INTO v_count
  FROM message_embeddings AS me
  JOIN messages AS m ON m.id = me.message_id
  WHERE me.contact_id <> m.contact_id;

  IF v_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'Phase 1 preflight failed: %s embeddings reference a contact different from their message',
        v_count
      ),
      HINT = 'Repair message_embeddings.contact_id before retrying the migration.';
  END IF;

  SELECT count(*)
    INTO v_count
  FROM (
    SELECT contact_id, channel
    FROM conversations
    WHERE status = 'open'
    GROUP BY contact_id, channel
    HAVING count(*) > 1
  ) AS duplicate_open_conversations;

  IF v_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format(
        'Phase 1 preflight failed: %s contact/channel pairs have more than one open conversation',
        v_count
      ),
      HINT = 'Choose the canonical conversation for each pair and close or merge the others explicitly.';
  END IF;

  SELECT count(*)
    INTO v_count
  FROM (
    SELECT message_id
    FROM message_embeddings
    GROUP BY message_id
    HAVING count(*) > 1
  ) AS duplicate_message_embeddings;

  IF v_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format(
        'Phase 1 preflight failed: %s messages have more than one embedding row',
        v_count
      ),
      HINT = 'Keep one canonical embedding row per message before retrying the migration.';
  END IF;

  -- Legacy outbound messages without in_reply_to remain valid. Only existing
  -- non-null reply links are required to point to an inbound in the same
  -- conversation and contact.
  SELECT count(*)
    INTO v_count
  FROM messages AS reply
  LEFT JOIN messages AS inbound ON inbound.id = reply.in_reply_to
  WHERE reply.in_reply_to IS NOT NULL
    AND (
      reply.direction <> 'outbound'
      OR inbound.id IS NULL
      OR inbound.direction <> 'inbound'
      OR reply.contact_id <> inbound.contact_id
      OR reply.conversation_id <> inbound.conversation_id
    );

  IF v_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'Phase 1 preflight failed: %s existing reply links are invalid or cross conversation/contact boundaries',
        v_count
      ),
      HINT = 'Repair only the invalid non-null in_reply_to links; unlinked legacy outbounds are supported.';
  END IF;
END
$$;
