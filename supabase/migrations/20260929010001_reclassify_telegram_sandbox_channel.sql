-- Reclassify the historical Telegram sandbox rows that were deliberately
-- stored as WhatsApp before Telegram became a first-class canonical channel.
--
-- Positive evidence is mandatory: a contact/thread enters this migration only
-- through sandbox_identities(provider = telegram_sandbox) or a channel thread
-- with that provider. Real WhatsApp rows are never selected by phone shape.

BEGIN;

CREATE TEMP TABLE telegram_sandbox_contacts ON COMMIT DROP AS
SELECT DISTINCT identity.contact_id
FROM sandbox_identities AS identity
WHERE identity.provider = 'telegram_sandbox'
UNION
SELECT DISTINCT thread.contact_id
FROM channel_threads AS thread
WHERE thread.provider = 'telegram_sandbox';

CREATE UNIQUE INDEX telegram_sandbox_contacts_pk
  ON telegram_sandbox_contacts (contact_id);

CREATE TEMP TABLE telegram_sandbox_threads ON COMMIT DROP AS
SELECT thread.id, thread.contact_id
FROM channel_threads AS thread
WHERE thread.provider = 'telegram_sandbox';

CREATE UNIQUE INDEX telegram_sandbox_threads_pk
  ON telegram_sandbox_threads (id);

-- A partial rollout can already have a Telegram permission beside the old
-- WhatsApp projection. Preserve the most recently changed projection, then
-- rebuild one Telegram row. consent_events remains the append-only evidence.
CREATE TEMP TABLE telegram_merged_permissions ON COMMIT DROP AS
SELECT DISTINCT ON (permission.contact_id)
  permission.contact_id,
  permission.consent_status,
  permission.consent_source,
  permission.evidence_event_id,
  permission.reply_window_expires_at,
  permission.changed_at,
  permission.created_at,
  permission.updated_at
FROM contact_channel_permissions AS permission
JOIN telegram_sandbox_contacts AS target
  ON target.contact_id = permission.contact_id
WHERE permission.channel IN ('whatsapp', 'telegram')
ORDER BY
  permission.contact_id,
  permission.changed_at DESC,
  permission.updated_at DESC,
  (permission.channel = 'telegram') DESC;

-- These compound references include channel, so the parent and children must
-- move together. They are restored and validated before commit.
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_channel_thread_contact_fk;
ALTER TABLE channel_events
  DROP CONSTRAINT IF EXISTS channel_events_thread_contact_fk;
ALTER TABLE contact_channel_permissions
  DROP CONSTRAINT IF EXISTS contact_permissions_evidence_same_contact_channel_fk;
ALTER TABLE outbound_deliveries
  DROP CONSTRAINT IF EXISTS outbound_deliveries_conversation_contact_channel_fk;

-- The production triggers correctly make provider identity immutable. This
-- one-time canonical correction is the only controlled exception.
DROP TRIGGER IF EXISTS channel_threads_enforce_identity_immutable ON channel_threads;
DROP TRIGGER IF EXISTS channel_events_enforce_invariants ON channel_events;

-- Avoid the partial unique index on one open conversation per contact/channel
-- when a partial rollout already created a Telegram conversation. Keep the
-- most recently active conversation open and retain every older transcript as
-- a closed conversation.
WITH ranked AS (
  SELECT
    conversation.id,
    row_number() OVER (
      PARTITION BY conversation.contact_id
      ORDER BY conversation.last_turn_at DESC NULLS LAST,
               conversation.created_at DESC,
               conversation.id DESC
    ) AS position
  FROM conversations AS conversation
  JOIN telegram_sandbox_contacts AS target
    ON target.contact_id = conversation.contact_id
  WHERE conversation.status = 'open'
    AND conversation.channel IN ('whatsapp', 'telegram')
)
UPDATE conversations AS conversation
SET status = 'closed', last_turn_at = COALESCE(conversation.last_turn_at, now())
FROM ranked
WHERE ranked.id = conversation.id
  AND ranked.position > 1;

UPDATE conversations AS conversation
SET channel = 'telegram'
FROM telegram_sandbox_threads AS target
WHERE conversation.channel_thread_id = target.id
  AND conversation.contact_id = target.contact_id
  AND conversation.channel = 'whatsapp';

UPDATE channel_events AS event
SET channel = 'telegram'
FROM telegram_sandbox_threads AS target
WHERE event.channel_thread_id = target.id
  AND event.contact_id = target.contact_id
  AND event.channel = 'whatsapp';

UPDATE channel_threads AS thread
SET channel = 'telegram'
FROM telegram_sandbox_threads AS target
WHERE thread.id = target.id
  AND thread.contact_id = target.contact_id
  AND thread.provider = 'telegram_sandbox'
  AND thread.channel = 'whatsapp';

UPDATE consent_events AS event
SET channel = 'telegram'
FROM telegram_sandbox_contacts AS target
WHERE event.contact_id = target.contact_id
  AND event.channel = 'whatsapp';

DELETE FROM contact_channel_permissions AS permission
USING telegram_sandbox_contacts AS target
WHERE permission.contact_id = target.contact_id
  AND permission.channel IN ('whatsapp', 'telegram');

INSERT INTO contact_channel_permissions (
  contact_id,
  channel,
  consent_status,
  consent_source,
  evidence_event_id,
  reply_window_expires_at,
  changed_at,
  created_at,
  updated_at
)
SELECT
  contact_id,
  'telegram',
  consent_status,
  consent_source,
  evidence_event_id,
  reply_window_expires_at,
  changed_at,
  created_at,
  updated_at
FROM telegram_merged_permissions;

UPDATE contacts AS contact
SET channel_origin = 'telegram'
FROM telegram_sandbox_contacts AS target
WHERE contact.id = target.contact_id
  AND contact.channel_origin = 'whatsapp';

UPDATE workspace_contacts AS membership
SET source_channel = 'telegram', updated_at = now()
FROM telegram_sandbox_contacts AS target
WHERE membership.contact_id = target.contact_id
  AND membership.source_channel = 'whatsapp';

ALTER TABLE conversations
  ADD CONSTRAINT conversations_channel_thread_contact_fk
  FOREIGN KEY (channel_thread_id, contact_id, channel)
  REFERENCES channel_threads (id, contact_id, channel)
  NOT VALID;
ALTER TABLE conversations
  VALIDATE CONSTRAINT conversations_channel_thread_contact_fk;

ALTER TABLE channel_events
  ADD CONSTRAINT channel_events_thread_contact_fk
  FOREIGN KEY (channel_thread_id, contact_id, channel)
  REFERENCES channel_threads (id, contact_id, channel)
  NOT VALID;
ALTER TABLE channel_events
  VALIDATE CONSTRAINT channel_events_thread_contact_fk;

ALTER TABLE contact_channel_permissions
  ADD CONSTRAINT contact_permissions_evidence_same_contact_channel_fk
  FOREIGN KEY (evidence_event_id, contact_id, channel)
  REFERENCES consent_events (id, contact_id, channel)
  NOT VALID;
ALTER TABLE contact_channel_permissions
  VALIDATE CONSTRAINT contact_permissions_evidence_same_contact_channel_fk;

-- A delivery's channel is historical evidence of the route that was actually
-- attempted. It must not be rewritten when the conversation identity is
-- corrected later, so this relationship enforces conversation ownership
-- without falsely requiring historical and current channel labels to match.
ALTER TABLE outbound_deliveries
  ADD CONSTRAINT outbound_deliveries_conversation_contact_channel_fk
  FOREIGN KEY (conversation_id, contact_id)
  REFERENCES conversations (id, contact_id)
  NOT VALID;
ALTER TABLE outbound_deliveries
  VALIDATE CONSTRAINT outbound_deliveries_conversation_contact_channel_fk;

CREATE TRIGGER channel_threads_enforce_identity_immutable
BEFORE UPDATE ON channel_threads
FOR EACH ROW EXECUTE FUNCTION public.enforce_channel_thread_identity_immutable();

CREATE TRIGGER channel_events_enforce_invariants
BEFORE UPDATE ON channel_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_channel_event_invariants();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM channel_threads
    WHERE provider = 'telegram_sandbox'
      AND channel = 'whatsapp'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Telegram sandbox channel reconciliation incomplete';
  END IF;
END
$$;

COMMIT;
