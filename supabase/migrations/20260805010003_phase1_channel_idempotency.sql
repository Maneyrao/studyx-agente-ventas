-- Phase 1 channel identity and idempotency ledger.
-- Provider event/message identifiers are scoped by integration_id because IDs
-- can legitimately collide across WhatsApp numbers, Botpress bots or tenants.

CREATE OR REPLACE FUNCTION public.phase1_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TABLE channel_threads (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id               uuid        NOT NULL REFERENCES contacts(id),
  provider                 text        NOT NULL CHECK (btrim(provider) <> ''),
  integration_id           text        NOT NULL CHECK (btrim(integration_id) <> ''),
  channel                  text        NOT NULL CHECK (channel IN ('whatsapp', 'voice')),
  external_conversation_id text        NOT NULL CHECK (btrim(external_conversation_id) <> ''),
  metadata                 jsonb,
  first_seen_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at             timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT channel_threads_provider_conversation_uq
    UNIQUE (provider, integration_id, external_conversation_id),
  CONSTRAINT channel_threads_id_contact_uq
    UNIQUE (id, contact_id),
  CONSTRAINT channel_threads_id_contact_channel_uq
    UNIQUE (id, contact_id, channel)
);

CREATE INDEX channel_threads_contact_lookup_idx
  ON channel_threads (contact_id, channel, last_seen_at DESC);

CREATE TRIGGER channel_threads_set_updated_at
BEFORE UPDATE ON channel_threads
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

ALTER TABLE conversations
  ADD COLUMN channel_thread_id uuid;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_channel_thread_contact_fk
  FOREIGN KEY (channel_thread_id, contact_id, channel)
  REFERENCES channel_threads (id, contact_id, channel)
  NOT VALID;

ALTER TABLE conversations
  VALIDATE CONSTRAINT conversations_channel_thread_contact_fk;

CREATE UNIQUE INDEX conversations_one_open_per_thread_uq
  ON conversations (channel_thread_id)
  WHERE status = 'open' AND channel_thread_id IS NOT NULL;

CREATE TABLE channel_events (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                 text        NOT NULL CHECK (btrim(provider) <> ''),
  integration_id           text        NOT NULL CHECK (btrim(integration_id) <> ''),
  channel                  text        NOT NULL CHECK (channel IN ('whatsapp', 'voice')),
  event_kind               text        NOT NULL DEFAULT 'inbound_message'
                                      CHECK (event_kind IN (
                                        'inbound_message',
                                        'delivery_update',
                                        'conversation_update'
                                      )),
  direction                text        CHECK (direction IN ('inbound', 'outbound')),
  external_event_id        text        NOT NULL CHECK (btrim(external_event_id) <> ''),
  external_message_id      text,
  external_conversation_id text,
  payload_hash             bytea       NOT NULL CHECK (octet_length(payload_hash) = 32),
  payload                  jsonb,
  contact_id               uuid        REFERENCES contacts(id),
  channel_thread_id        uuid,
  status                   text        NOT NULL DEFAULT 'received'
                                      CHECK (status IN (
                                        'received',
                                        'processing',
                                        'processed',
                                        'failed_retryable',
                                        'dead_letter'
                                      )),
  attempt_count            integer     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code          text,
  last_error_detail        text,
  next_attempt_at          timestamptz,
  lease_until              timestamptz,
  leased_by                text,
  received_at              timestamptz NOT NULL DEFAULT now(),
  processed_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT channel_events_provider_event_uq
    UNIQUE (provider, integration_id, external_event_id),
  CONSTRAINT channel_events_inbound_identity_check
    CHECK (
      event_kind <> 'inbound_message'
      OR (
        direction = 'inbound'
        AND external_message_id IS NOT NULL
        AND btrim(external_message_id) <> ''
        AND external_conversation_id IS NOT NULL
        AND btrim(external_conversation_id) <> ''
      )
    ),
  CONSTRAINT channel_events_thread_requires_contact_check
    CHECK (channel_thread_id IS NULL OR contact_id IS NOT NULL),
  CONSTRAINT channel_events_processed_timestamp_check
    CHECK (status <> 'processed' OR processed_at IS NOT NULL),
  CONSTRAINT channel_events_thread_contact_fk
    FOREIGN KEY (channel_thread_id, contact_id, channel)
    REFERENCES channel_threads (id, contact_id, channel)
);

-- Some providers generate a new webhook event ID while redelivering the same
-- inbound message. This second key prevents that case from duplicating turns.
CREATE UNIQUE INDEX channel_events_provider_message_uq
  ON channel_events (provider, integration_id, external_message_id)
  WHERE event_kind = 'inbound_message' AND external_message_id IS NOT NULL;

CREATE INDEX channel_events_retry_claim_idx
  ON channel_events (next_attempt_at, lease_until, received_at)
  WHERE status IN ('received', 'processing', 'failed_retryable');

CREATE INDEX channel_events_external_conversation_idx
  ON channel_events (provider, integration_id, external_conversation_id, received_at DESC)
  WHERE external_conversation_id IS NOT NULL;

CREATE TRIGGER channel_events_set_updated_at
BEFORE UPDATE ON channel_events
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_channel_thread_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.contact_id IS DISTINCT FROM NEW.contact_id
     OR OLD.provider IS DISTINCT FROM NEW.provider
     OR OLD.integration_id IS DISTINCT FROM NEW.integration_id
     OR OLD.channel IS DISTINCT FROM NEW.channel
     OR OLD.external_conversation_id IS DISTINCT FROM NEW.external_conversation_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Channel thread identity is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER channel_threads_enforce_identity_immutable
BEFORE UPDATE ON channel_threads
FOR EACH ROW EXECUTE FUNCTION public.enforce_channel_thread_identity_immutable();

CREATE OR REPLACE FUNCTION public.enforce_channel_event_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.provider IS DISTINCT FROM NEW.provider
     OR OLD.integration_id IS DISTINCT FROM NEW.integration_id
     OR OLD.channel IS DISTINCT FROM NEW.channel
     OR OLD.event_kind IS DISTINCT FROM NEW.event_kind
     OR OLD.direction IS DISTINCT FROM NEW.direction
     OR OLD.external_event_id IS DISTINCT FROM NEW.external_event_id
     OR OLD.external_message_id IS DISTINCT FROM NEW.external_message_id
     OR OLD.external_conversation_id IS DISTINCT FROM NEW.external_conversation_id
     OR OLD.payload_hash IS DISTINCT FROM NEW.payload_hash
     OR OLD.payload IS DISTINCT FROM NEW.payload THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Channel event identity and canonical payload are immutable';
  END IF;

  IF OLD.contact_id IS NOT NULL AND OLD.contact_id IS DISTINCT FROM NEW.contact_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Resolved channel event contact is immutable';
  END IF;

  IF OLD.channel_thread_id IS NOT NULL
     AND OLD.channel_thread_id IS DISTINCT FROM NEW.channel_thread_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Resolved channel event thread is immutable';
  END IF;

  IF OLD.status IN ('processed', 'dead_letter')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('Channel event status %s is terminal', OLD.status);
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status
     AND NOT (
       (OLD.status = 'received' AND NEW.status IN ('processing', 'processed', 'failed_retryable', 'dead_letter'))
       OR (OLD.status = 'processing' AND NEW.status IN ('processed', 'failed_retryable', 'dead_letter'))
       OR (OLD.status = 'failed_retryable' AND NEW.status IN ('processing', 'dead_letter'))
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('Invalid channel event transition: %s -> %s', OLD.status, NEW.status);
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER channel_events_enforce_invariants
BEFORE UPDATE ON channel_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_channel_event_invariants();

ALTER TABLE messages
  ADD COLUMN source_event_id uuid REFERENCES channel_events(id);

CREATE UNIQUE INDEX messages_source_event_uq
  ON messages (source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_message_source_event_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event_contact_id uuid;
  v_event_thread_id  uuid;
  v_event_direction  text;
  v_conversation_thread_id uuid;
BEGIN
  IF NEW.source_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ce.contact_id, ce.channel_thread_id, ce.direction
    INTO v_event_contact_id, v_event_thread_id, v_event_direction
  FROM public.channel_events AS ce
  WHERE ce.id = NEW.source_event_id
  FOR KEY SHARE;

  SELECT c.channel_thread_id
    INTO v_conversation_thread_id
  FROM public.conversations AS c
  WHERE c.id = NEW.conversation_id;

  IF v_event_contact_id IS NULL OR v_event_thread_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Channel event must be resolved to a contact and thread before creating its message';
  END IF;

  IF v_event_contact_id <> NEW.contact_id
     OR v_event_thread_id IS DISTINCT FROM v_conversation_thread_id
     OR v_event_direction IS DISTINCT FROM NEW.direction THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Message and source event cross contact, thread or direction boundaries';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER messages_enforce_source_event_context
BEFORE INSERT OR UPDATE OF source_event_id, conversation_id, contact_id, direction ON messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_message_source_event_context();

CREATE OR REPLACE FUNCTION public.enforce_channel_event_message_context()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_message_contact_id uuid;
  v_message_direction  text;
  v_message_thread_id  uuid;
BEGIN
  SELECT m.contact_id, m.direction, c.channel_thread_id
    INTO v_message_contact_id, v_message_direction, v_message_thread_id
  FROM public.messages AS m
  JOIN public.conversations AS c ON c.id = m.conversation_id
  WHERE m.source_event_id = NEW.id;

  IF v_message_contact_id IS NOT NULL
     AND (
       NEW.contact_id IS DISTINCT FROM v_message_contact_id
       OR NEW.channel_thread_id IS DISTINCT FROM v_message_thread_id
       OR NEW.direction IS DISTINCT FROM v_message_direction
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Resolved channel event cannot be moved away from its message context';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER channel_events_enforce_message_context
BEFORE UPDATE OF contact_id, channel_thread_id, direction ON channel_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_channel_event_message_context();

-- Atomic reservation primitive. Call this inside the same transaction that
-- resolves the contact/conversation and inserts the inbound message. A caller
-- must return HTTP 409 when was_created=false and payload_matches=false.
CREATE OR REPLACE FUNCTION public.reserve_inbound_channel_event(
  p_provider                 text,
  p_integration_id           text,
  p_channel                  text,
  p_external_event_id        text,
  p_external_message_id      text,
  p_external_conversation_id text,
  p_payload_hash             bytea,
  p_payload                  jsonb DEFAULT NULL
)
RETURNS TABLE (
  event_id        uuid,
  was_created     boolean,
  payload_matches boolean,
  event_status    text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event_id     uuid;
  v_status       text;
  v_payload_hash bytea;
BEGIN
  INSERT INTO public.channel_events (
    provider,
    integration_id,
    channel,
    event_kind,
    direction,
    external_event_id,
    external_message_id,
    external_conversation_id,
    payload_hash,
    payload
  )
  VALUES (
    p_provider,
    p_integration_id,
    p_channel,
    'inbound_message',
    'inbound',
    p_external_event_id,
    p_external_message_id,
    p_external_conversation_id,
    p_payload_hash,
    p_payload
  )
  ON CONFLICT DO NOTHING
  RETURNING id, status, payload_hash
    INTO v_event_id, v_status, v_payload_hash;

  IF FOUND THEN
    RETURN QUERY SELECT v_event_id, true, true, v_status;
    RETURN;
  END IF;

  SELECT ce.id, ce.status, ce.payload_hash
    INTO v_event_id, v_status, v_payload_hash
  FROM public.channel_events AS ce
  WHERE ce.provider = p_provider
    AND ce.integration_id = p_integration_id
    AND (
      ce.external_event_id = p_external_event_id
      OR (
        ce.event_kind = 'inbound_message'
        AND ce.external_message_id = p_external_message_id
      )
    )
  ORDER BY (ce.external_event_id = p_external_event_id) DESC
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Channel event reservation conflicted with an unknown unique constraint';
  END IF;

  RETURN QUERY
    SELECT v_event_id, false, v_payload_hash = p_payload_hash, v_status;
END
$$;

GRANT SELECT, INSERT, UPDATE ON channel_threads TO orchestrator_role;
GRANT SELECT, INSERT, UPDATE ON channel_events TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON channel_threads, channel_events FROM orchestrator_role;

GRANT EXECUTE ON FUNCTION public.reserve_inbound_channel_event(
  text, text, text, text, text, text, bytea, jsonb
) TO orchestrator_role;
REVOKE EXECUTE ON FUNCTION public.reserve_inbound_channel_event(
  text, text, text, text, text, text, bytea, jsonb
) FROM PUBLIC;

COMMENT ON TABLE channel_events IS
  'Append-oriented provider event ledger and structural idempotency boundary.';

COMMENT ON COLUMN channel_events.payload_hash IS
  'SHA-256 of the application canonical payload; same key with another hash is a conflict.';

COMMENT ON COLUMN messages.source_event_id IS
  'Unique provider event that created this message; NULL is allowed for legacy rows.';
