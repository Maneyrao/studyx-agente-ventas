-- Phase 1 transactional outbox and provider delivery state.
-- Creating an outbound message, outbound_deliveries row and outbox_events row
-- must happen in one application transaction. Network calls happen only after
-- commit and always reuse the same provider-scoped idempotency key.

CREATE UNIQUE INDEX messages_id_contact_direction_uq
  ON messages (id, contact_id, direction);

CREATE UNIQUE INDEX conversations_id_contact_channel_uq
  ON conversations (id, contact_id, channel);

CREATE TABLE outbound_deliveries (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id            uuid        NOT NULL UNIQUE,
  conversation_id       uuid        NOT NULL,
  contact_id            uuid        NOT NULL REFERENCES contacts(id),
  message_direction     text        GENERATED ALWAYS AS ('outbound'::text) STORED,
  provider              text        NOT NULL CHECK (btrim(provider) <> ''),
  integration_id        text        NOT NULL CHECK (btrim(integration_id) <> ''),
  channel               text        NOT NULL CHECK (channel IN ('whatsapp', 'voice')),
  purpose               text        NOT NULL DEFAULT 'conversational'
                                  CHECK (purpose IN (
                                    'commercial',
                                    'conversational',
                                    'transactional',
                                    'support',
                                    'consent_confirmation'
                                  )),
  destination           text        NOT NULL CHECK (btrim(destination) <> ''),
  idempotency_key       text        NOT NULL CHECK (btrim(idempotency_key) <> ''),
  provider_message_id   text,
  state                 text        NOT NULL DEFAULT 'pending'
                                  CHECK (state IN (
                                    'pending',
                                    'leased',
                                    'submitted',
                                    'delivered',
                                    'failed_retryable',
                                    'dead_letter',
                                    'cancelled'
                                  )),
  attempt_count         integer     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts          integer     NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_at       timestamptz NOT NULL DEFAULT now(),
  lease_until           timestamptz,
  leased_by             text,
  last_error_code       text,
  last_error_detail     text,
  version               integer     NOT NULL DEFAULT 0 CHECK (version >= 0),
  submitted_at          timestamptz,
  delivered_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT outbound_deliveries_message_contact_direction_fk
    FOREIGN KEY (message_id, conversation_id, contact_id, message_direction)
    REFERENCES messages (id, conversation_id, contact_id, direction),
  CONSTRAINT outbound_deliveries_conversation_contact_channel_fk
    FOREIGN KEY (conversation_id, contact_id, channel)
    REFERENCES conversations (id, contact_id, channel),
  CONSTRAINT outbound_deliveries_provider_idempotency_uq
    UNIQUE (provider, integration_id, idempotency_key),
  CONSTRAINT outbound_deliveries_attempt_bounds_check
    CHECK (attempt_count <= max_attempts),
  CONSTRAINT outbound_deliveries_delivered_timestamp_check
    CHECK (state <> 'delivered' OR delivered_at IS NOT NULL)
);

CREATE UNIQUE INDEX outbound_deliveries_provider_message_uq
  ON outbound_deliveries (provider, integration_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX outbound_deliveries_retry_claim_idx
  ON outbound_deliveries (next_attempt_at, created_at)
  WHERE state IN ('pending', 'failed_retryable');

CREATE INDEX outbound_deliveries_contact_pending_idx
  ON outbound_deliveries (contact_id, channel, created_at)
  WHERE state IN ('pending', 'leased', 'failed_retryable');

CREATE TABLE outbox_events (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic                 text        NOT NULL CHECK (btrim(topic) <> ''),
  aggregate_type        text        NOT NULL CHECK (btrim(aggregate_type) <> ''),
  aggregate_id          uuid        NOT NULL,
  delivery_id           uuid        UNIQUE REFERENCES outbound_deliveries(id),
  deduplication_key     text        NOT NULL UNIQUE CHECK (btrim(deduplication_key) <> ''),
  payload               jsonb       NOT NULL,
  state                 text        NOT NULL DEFAULT 'pending'
                                  CHECK (state IN (
                                    'pending',
                                    'leased',
                                    'published',
                                    'failed_retryable',
                                    'dead_letter',
                                    'cancelled'
                                  )),
  attempt_count         integer     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts          integer     NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at          timestamptz NOT NULL DEFAULT now(),
  lease_until           timestamptz,
  leased_by             text,
  last_error_code       text,
  last_error_detail     text,
  published_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT outbox_events_attempt_bounds_check
    CHECK (attempt_count <= max_attempts),
  CONSTRAINT outbox_events_published_timestamp_check
    CHECK (state <> 'published' OR published_at IS NOT NULL)
);

CREATE INDEX outbox_events_claim_idx
  ON outbox_events (available_at, lease_until, created_at)
  WHERE state IN ('pending', 'leased', 'failed_retryable');

CREATE TRIGGER outbound_deliveries_set_updated_at
BEFORE UPDATE ON outbound_deliveries
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

CREATE TRIGGER outbox_events_set_updated_at
BEFORE UPDATE ON outbox_events
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_outbox_event_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.topic IS DISTINCT FROM NEW.topic
     OR OLD.aggregate_type IS DISTINCT FROM NEW.aggregate_type
     OR OLD.aggregate_id IS DISTINCT FROM NEW.aggregate_id
     OR OLD.delivery_id IS DISTINCT FROM NEW.delivery_id
     OR OLD.deduplication_key IS DISTINCT FROM NEW.deduplication_key
     OR OLD.payload IS DISTINCT FROM NEW.payload THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Outbox event identity and payload are immutable';
  END IF;

  IF OLD.state IN ('published', 'dead_letter', 'cancelled')
     AND OLD.state IS DISTINCT FROM NEW.state THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('Outbox state %s is terminal', OLD.state);
  END IF;

  IF OLD.state IS DISTINCT FROM NEW.state
     AND NOT (
       (OLD.state = 'pending' AND NEW.state IN ('leased', 'dead_letter', 'cancelled'))
       OR (OLD.state = 'leased' AND NEW.state IN ('published', 'failed_retryable', 'dead_letter', 'cancelled'))
       OR (OLD.state = 'failed_retryable' AND NEW.state IN ('leased', 'dead_letter', 'cancelled'))
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('Invalid outbox transition: %s -> %s', OLD.state, NEW.state);
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER outbox_events_enforce_invariants
BEFORE UPDATE ON outbox_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_outbox_event_invariants();

-- Enforce contactability even when a caller bypasses the enqueue helper and
-- inserts directly with the application role.
CREATE OR REPLACE FUNCTION public.enforce_outbound_delivery_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lifecycle_status text;
  v_legacy_status text;
  v_deleted_at timestamptz;
  v_consent_status text;
BEGIN
  SELECT c.lifecycle_status, c.status, c.deleted_at
    INTO v_lifecycle_status, v_legacy_status, v_deleted_at
  FROM public.contacts AS c
  WHERE c.id = NEW.contact_id
  FOR KEY SHARE;

  SELECT ccp.consent_status
    INTO v_consent_status
  FROM public.contact_channel_permissions AS ccp
  WHERE ccp.contact_id = NEW.contact_id
    AND ccp.channel = NEW.channel
  FOR SHARE;

  IF NEW.purpose <> 'consent_confirmation'
     AND (
       v_legacy_status = 'inactivo'
       OR v_lifecycle_status IN ('blocked', 'deleted')
       OR v_deleted_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Contact is blocked or deleted for this delivery purpose';
  END IF;

  IF NEW.purpose IN ('commercial', 'conversational')
     AND v_consent_status = 'revoked' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Channel consent is revoked for this delivery purpose';
  END IF;

  IF NEW.purpose = 'commercial'
     AND v_consent_status IS DISTINCT FROM 'granted' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Proactive commercial delivery requires granted channel consent';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER outbound_deliveries_enforce_policy
BEFORE INSERT ON outbound_deliveries
FOR EACH ROW EXECUTE FUNCTION public.enforce_outbound_delivery_policy();

CREATE OR REPLACE FUNCTION public.enforce_outbound_delivery_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.message_id IS DISTINCT FROM NEW.message_id
     OR OLD.conversation_id IS DISTINCT FROM NEW.conversation_id
     OR OLD.contact_id IS DISTINCT FROM NEW.contact_id
     OR OLD.provider IS DISTINCT FROM NEW.provider
     OR OLD.integration_id IS DISTINCT FROM NEW.integration_id
     OR OLD.channel IS DISTINCT FROM NEW.channel
     OR OLD.purpose IS DISTINCT FROM NEW.purpose
     OR OLD.destination IS DISTINCT FROM NEW.destination
     OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Outbound delivery identity is immutable';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER outbound_deliveries_enforce_identity_immutable
BEFORE UPDATE ON outbound_deliveries
FOR EACH ROW EXECUTE FUNCTION public.enforce_outbound_delivery_identity_immutable();

-- Terminal delivery states cannot move backwards. Reconciliation may advance
-- submitted to delivered, but delivered/dead-letter/cancelled are terminal.
CREATE OR REPLACE FUNCTION public.enforce_outbound_delivery_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.state = OLD.state THEN
    NEW.version := OLD.version;
    RETURN NEW;
  END IF;

  IF OLD.state IN ('delivered', 'dead_letter', 'cancelled') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('Delivery state %s is terminal', OLD.state);
  END IF;

  IF NOT (
    (OLD.state = 'pending' AND NEW.state IN ('leased', 'dead_letter', 'cancelled'))
    OR (OLD.state = 'leased' AND NEW.state IN ('submitted', 'failed_retryable', 'dead_letter', 'cancelled'))
    OR (OLD.state = 'submitted' AND NEW.state IN ('delivered', 'failed_retryable', 'dead_letter'))
    OR (OLD.state = 'failed_retryable' AND NEW.state IN ('leased', 'dead_letter', 'cancelled'))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('Invalid delivery transition: %s -> %s', OLD.state, NEW.state);
  END IF;

  NEW.version := OLD.version + 1;
  RETURN NEW;
END
$$;

CREATE TRIGGER outbound_deliveries_enforce_transition
BEFORE UPDATE OF state ON outbound_deliveries
FOR EACH ROW EXECUTE FUNCTION public.enforce_outbound_delivery_transition();

-- Idempotently creates the delivery and its outbox job. This function must be
-- called in the same transaction as the outbound message/audit insertion.
CREATE OR REPLACE FUNCTION public.enqueue_outbound_delivery(
  p_message_id       uuid,
  p_provider         text,
  p_integration_id   text,
  p_channel          text,
  p_purpose          text,
  p_destination      text,
  p_idempotency_key  text,
  p_payload          jsonb,
  p_max_attempts     integer DEFAULT 3
)
RETURNS TABLE (
  delivery_id uuid,
  outbox_id   uuid,
  was_created boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_delivery_id uuid;
  v_conversation_id uuid;
  v_contact_id  uuid;
  v_outbox_id   uuid;
  v_created     boolean := false;
  v_existing_delivery public.outbound_deliveries%ROWTYPE;
  v_existing_payload jsonb;
  v_lifecycle_status text;
  v_legacy_status text;
  v_deleted_at timestamptz;
  v_consent_status text;
BEGIN
  SELECT m.conversation_id, m.contact_id
    INTO v_conversation_id, v_contact_id
  FROM public.messages AS m
  WHERE m.id = p_message_id
    AND m.direction = 'outbound'
  FOR UPDATE;

  IF v_contact_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'Outbound message does not exist';
  END IF;

  -- Serialize enqueue against blocking/deletion. Legacy status='inactivo'
  -- remains fail-closed until those records are explicitly classified.
  SELECT c.lifecycle_status, c.status, c.deleted_at
    INTO v_lifecycle_status, v_legacy_status, v_deleted_at
  FROM public.contacts AS c
  WHERE c.id = v_contact_id
  FOR UPDATE;

  SELECT ccp.consent_status
    INTO v_consent_status
  FROM public.contact_channel_permissions AS ccp
  WHERE ccp.contact_id = v_contact_id
    AND ccp.channel = p_channel
  FOR SHARE;

  IF p_purpose <> 'consent_confirmation'
     AND (
       v_legacy_status = 'inactivo'
       OR v_lifecycle_status IN ('blocked', 'deleted')
       OR v_deleted_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Contact is blocked or deleted for this delivery purpose';
  END IF;

  IF p_purpose IN ('commercial', 'conversational')
     AND v_consent_status = 'revoked' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Channel consent is revoked for this delivery purpose';
  END IF;

  IF p_purpose = 'commercial'
     AND v_consent_status IS DISTINCT FROM 'granted' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Proactive commercial delivery requires granted channel consent';
  END IF;

  INSERT INTO public.outbound_deliveries (
    message_id,
    conversation_id,
    contact_id,
    provider,
    integration_id,
    channel,
    purpose,
    destination,
    idempotency_key,
    max_attempts
  )
  VALUES (
    p_message_id,
    v_conversation_id,
    v_contact_id,
    p_provider,
    p_integration_id,
    p_channel,
    p_purpose,
    p_destination,
    p_idempotency_key,
    p_max_attempts
  )
  ON CONFLICT (message_id) DO NOTHING
  RETURNING id INTO v_delivery_id;

  IF FOUND THEN
    v_created := true;
  ELSE
    SELECT od.*
      INTO v_existing_delivery
    FROM public.outbound_deliveries AS od
    WHERE od.message_id = p_message_id;

    IF v_existing_delivery.id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Provider idempotency key is already bound to another outbound message';
    END IF;

    IF v_existing_delivery.provider IS DISTINCT FROM p_provider
       OR v_existing_delivery.integration_id IS DISTINCT FROM p_integration_id
       OR v_existing_delivery.channel IS DISTINCT FROM p_channel
       OR v_existing_delivery.purpose IS DISTINCT FROM p_purpose
       OR v_existing_delivery.destination IS DISTINCT FROM p_destination
       OR v_existing_delivery.idempotency_key IS DISTINCT FROM p_idempotency_key THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Outbound message is already bound to different delivery data',
        CONSTRAINT = 'outbound_deliveries_message_id_key';
    END IF;

    v_delivery_id := v_existing_delivery.id;
  END IF;

  INSERT INTO public.outbox_events (
    topic,
    aggregate_type,
    aggregate_id,
    delivery_id,
    deduplication_key,
    payload,
    max_attempts
  )
  VALUES (
    'outbound.delivery.requested',
    'outbound_delivery',
    v_delivery_id,
    v_delivery_id,
    'outbound_delivery:' || v_delivery_id::text,
    p_payload,
    p_max_attempts
  )
  ON CONFLICT ON CONSTRAINT outbox_events_delivery_id_key DO NOTHING
  RETURNING id INTO v_outbox_id;

  IF v_outbox_id IS NULL THEN
    SELECT oe.id, oe.payload
      INTO v_outbox_id, v_existing_payload
    FROM public.outbox_events AS oe
    WHERE oe.delivery_id = v_delivery_id;

    IF v_existing_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Outbound delivery is already bound to a different outbox payload',
        CONSTRAINT = 'outbox_events_delivery_id_key';
    END IF;
  END IF;

  RETURN QUERY SELECT v_delivery_id, v_outbox_id, v_created;
END
$$;

-- Multiple workers can safely claim independent jobs. A worker must update the
-- related delivery state in the same transaction before performing network IO.
CREATE OR REPLACE FUNCTION public.claim_outbox_events(
  p_worker_id     text,
  p_limit         integer DEFAULT 20,
  p_lease_seconds integer DEFAULT 60
)
RETURNS SETOF public.outbox_events
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH exhausted AS (
    UPDATE public.outbox_events AS stale
    SET
      state = 'dead_letter',
      lease_until = NULL,
      leased_by = NULL,
      last_error_code = COALESCE(stale.last_error_code, 'MAX_ATTEMPTS_EXHAUSTED')
    WHERE stale.state = 'leased'
      AND (stale.lease_until IS NULL OR stale.lease_until <= now())
      AND stale.attempt_count >= stale.max_attempts
    RETURNING stale.delivery_id
  ), exhausted_deliveries AS (
    UPDATE public.outbound_deliveries AS od
    SET
      state = 'dead_letter',
      lease_until = NULL,
      leased_by = NULL,
      last_error_code = COALESCE(od.last_error_code, 'MAX_ATTEMPTS_EXHAUSTED')
    FROM exhausted AS ex
    WHERE od.id = ex.delivery_id
      AND od.state IN ('pending', 'leased', 'failed_retryable')
    RETURNING od.id
  ), candidates AS (
    SELECT oe.id
    FROM public.outbox_events AS oe
    WHERE oe.state IN ('pending', 'leased', 'failed_retryable')
      AND oe.available_at <= now()
      AND (
        oe.state <> 'leased'
        OR oe.lease_until IS NULL
        OR oe.lease_until <= now()
      )
      AND oe.attempt_count < oe.max_attempts
    ORDER BY oe.available_at, oe.created_at, oe.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.outbox_events AS oe
  SET
    state = 'leased',
    leased_by = p_worker_id,
    lease_until = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 5), 900)),
    attempt_count = oe.attempt_count + 1
  FROM candidates AS c
  WHERE oe.id = c.id
  RETURNING oe.*;
$$;

-- A block or explicit consent revocation cancels queued commercial delivery.
-- Workers must still re-check permission immediately before network IO because
-- a request already submitted to a provider cannot be recalled transactionally.
CREATE OR REPLACE FUNCTION public.cancel_queued_commercial_deliveries(
  p_contact_id uuid,
  p_channel    text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.outbox_events AS oe
  SET state = 'cancelled', lease_until = NULL, leased_by = NULL
  FROM public.outbound_deliveries AS od
  WHERE oe.delivery_id = od.id
    AND od.contact_id = p_contact_id
    AND (p_channel IS NULL OR od.channel = p_channel)
    AND od.purpose = 'commercial'
    AND oe.state IN ('pending', 'leased', 'failed_retryable');

  UPDATE public.outbound_deliveries AS od
  SET state = 'cancelled', lease_until = NULL, leased_by = NULL
  WHERE od.contact_id = p_contact_id
    AND (p_channel IS NULL OR od.channel = p_channel)
    AND od.purpose = 'commercial'
    AND od.state IN ('pending', 'leased', 'failed_retryable');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

CREATE OR REPLACE FUNCTION public.cancel_commercial_on_contact_block()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (
       NEW.lifecycle_status IN ('blocked', 'deleted')
       OR NEW.status = 'inactivo'
       OR NEW.deleted_at IS NOT NULL
     )
     AND (
       OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
     ) THEN
    PERFORM public.cancel_queued_commercial_deliveries(NEW.id, NULL);
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.cancel_commercial_on_consent_revoke()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.consent_status = 'revoked' THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.cancel_queued_commercial_deliveries(NEW.contact_id, NEW.channel);
    ELSIF OLD.consent_status IS DISTINCT FROM NEW.consent_status THEN
      PERFORM public.cancel_queued_commercial_deliveries(NEW.contact_id, NEW.channel);
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER contacts_cancel_commercial_on_block
AFTER UPDATE OF lifecycle_status, status, deleted_at ON contacts
FOR EACH ROW EXECUTE FUNCTION public.cancel_commercial_on_contact_block();

CREATE TRIGGER permissions_cancel_commercial_on_revoke
AFTER INSERT OR UPDATE ON contact_channel_permissions
FOR EACH ROW EXECUTE FUNCTION public.cancel_commercial_on_consent_revoke();

GRANT SELECT, INSERT, UPDATE ON outbound_deliveries, outbox_events TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON outbound_deliveries, outbox_events FROM orchestrator_role;

GRANT EXECUTE ON FUNCTION public.enqueue_outbound_delivery(
  uuid, text, text, text, text, text, text, jsonb, integer
) TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.claim_outbox_events(text, integer, integer) TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.cancel_queued_commercial_deliveries(uuid, text) TO orchestrator_role;

REVOKE EXECUTE ON FUNCTION public.enqueue_outbound_delivery(
  uuid, text, text, text, text, text, text, jsonb, integer
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_outbox_events(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_queued_commercial_deliveries(uuid, text) FROM PUBLIC;

COMMENT ON TABLE outbound_deliveries IS
  'Canonical provider delivery state; an outbound is not sent merely because its message row exists.';

COMMENT ON TABLE outbox_events IS
  'Jobs committed atomically with business state and claimed with SKIP LOCKED after commit.';

COMMENT ON COLUMN outbound_deliveries.idempotency_key IS
  'Stable key reused for every retry and reconciliation request to the provider.';
