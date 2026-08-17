-- Agent B / voice call ledger.
-- Additive: PostgreSQL remains canonical; Telegram and Retell are projections.

CREATE TABLE call_sessions (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_turn_id             uuid        NOT NULL,
  source_turn_direction      text        GENERATED ALWAYS AS ('inbound'::text) STORED,
  decision_id                uuid        REFERENCES agent_decisions(id),
  contact_id                 uuid        NOT NULL REFERENCES contacts(id),
  conversation_id            uuid        NOT NULL,
  provider                   text        NOT NULL CHECK (provider IN ('telegram_sandbox', 'retell')),
  provider_call_id           text,
  request_idempotency_key    text        NOT NULL UNIQUE CHECK (btrim(request_idempotency_key) <> ''),
  status                     text        NOT NULL CHECK (status IN (
                                 'requested', 'dispatching', 'provider_accepted', 'dispatch_ambiguous',
                                 'in_progress', 'completed', 'failed', 'no_answer', 'timed_out', 'cancelled'
                               )),
  analysis_status            text        NOT NULL DEFAULT 'pending'
                                         CHECK (analysis_status IN ('pending', 'completed', 'failed')),
  consent_source_message_id  uuid        NOT NULL,
  offered_by_decision_id     uuid        REFERENCES agent_decisions(id),
  context_snapshot           jsonb       NOT NULL CHECK (jsonb_typeof(context_snapshot) = 'object'),
  context_hash               bytea       NOT NULL CHECK (octet_length(context_hash) = 32),
  prompt_version             text        NOT NULL CHECK (btrim(prompt_version) <> ''),
  result                     text,
  error_code                 text,
  dispatch_lease_owner       text,
  dispatch_lease_until       timestamptz,
  requested_at               timestamptz NOT NULL DEFAULT now(),
  provider_accepted_at       timestamptz,
  started_at                 timestamptz,
  completed_at               timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT call_sessions_source_turn_uq UNIQUE (source_turn_id),
  CONSTRAINT call_sessions_source_turn_fk
    FOREIGN KEY (source_turn_id, conversation_id, contact_id, source_turn_direction)
    REFERENCES messages (id, conversation_id, contact_id, direction),
  CONSTRAINT call_sessions_conversation_contact_fk
    FOREIGN KEY (conversation_id, contact_id)
    REFERENCES conversations (id, contact_id),
  CONSTRAINT call_sessions_consent_source_fk
    FOREIGN KEY (consent_source_message_id, conversation_id, contact_id, source_turn_direction)
    REFERENCES messages (id, conversation_id, contact_id, direction),
  CONSTRAINT call_sessions_provider_call_shape_check
    CHECK (provider_call_id IS NULL OR btrim(provider_call_id) <> ''),
  CONSTRAINT call_sessions_lease_shape_check
    CHECK ((dispatch_lease_owner IS NULL) = (dispatch_lease_until IS NULL))
);

CREATE UNIQUE INDEX call_sessions_one_active_per_contact_uq
  ON call_sessions (contact_id)
  WHERE status IN ('requested', 'dispatching', 'provider_accepted', 'dispatch_ambiguous', 'in_progress');

CREATE UNIQUE INDEX call_sessions_provider_call_uq
  ON call_sessions (provider, provider_call_id)
  WHERE provider_call_id IS NOT NULL;

CREATE INDEX call_sessions_status_idx ON call_sessions (status, updated_at, id);

CREATE TABLE call_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id       uuid        NOT NULL REFERENCES call_sessions(id),
  provider      text        NOT NULL CHECK (provider IN ('telegram_sandbox', 'retell')),
  event_id      text        NOT NULL CHECK (btrim(event_id) <> ''),
  event_type    text        NOT NULL CHECK (event_type IN ('requested', 'started', 'ended', 'analyzed')),
  sequence      integer     NOT NULL CHECK (sequence >= 0),
  occurred_at   timestamptz NOT NULL,
  payload       jsonb       NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_hash  bytea       NOT NULL CHECK (octet_length(payload_hash) = 32),
  recorded_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT call_events_provider_event_uq UNIQUE (provider, event_id),
  CONSTRAINT call_events_payload_type_check CHECK (payload ->> 'event_type' = event_type)
);

CREATE INDEX call_events_call_projection_idx
  ON call_events (call_id, occurred_at, sequence, id);

CREATE TABLE telegram_agent_b_bindings (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id      text        NOT NULL UNIQUE CHECK (btrim(telegram_chat_id) <> ''),
  telegram_user_id      text        NOT NULL UNIQUE CHECK (btrim(telegram_user_id) <> ''),
  status                text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  first_started_at      timestamptz NOT NULL DEFAULT now(),
  last_started_at       timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE call_context_receipts (
  id                                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id                           uuid        NOT NULL REFERENCES call_sessions(id),
  idempotency_key                   text        NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  context_hash                      bytea       NOT NULL CHECK (octet_length(context_hash) = 32),
  ack                               jsonb       NOT NULL CHECK (jsonb_typeof(ack) = 'object'),
  delivery_status                   text        NOT NULL CHECK (delivery_status IN ('pending', 'accepted', 'ambiguous', 'failed')),
  telegram_chat_id                  text        NOT NULL CHECK (btrim(telegram_chat_id) <> ''),
  telegram_user_id                  text        NOT NULL CHECK (btrim(telegram_user_id) <> ''),
  telegram_message_id               text,
  nonce_hash                        bytea       NOT NULL UNIQUE CHECK (octet_length(nonce_hash) = 32),
  expires_at                        timestamptz NOT NULL,
  verdict                           text        CHECK (verdict IN ('correct', 'incorrect')),
  callback_update_id                text        UNIQUE,
  callback_query_id_hash            bytea       CHECK (callback_query_id_hash IS NULL OR octet_length(callback_query_id_hash) = 32),
  verified_at                       timestamptz,
  telegram_accepted_at              timestamptz,
  request_to_telegram_accepted_ms   integer     CHECK (request_to_telegram_accepted_ms IS NULL OR request_to_telegram_accepted_ms >= 0),
  error_code                        text,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT call_context_receipts_call_uq UNIQUE (call_id),
  CONSTRAINT call_context_receipts_ack_shape_check CHECK (
    ack ->> 'schema_version' = '1'
    AND ack ->> 'event' = 'context_loaded'
    AND ack ->> 'call_id' = call_id::text
    AND ack ->> 'context_hash' = encode(context_hash, 'hex')
    AND ack ->> 'status' = 'accepted'
    AND jsonb_typeof(ack -> 'received_fields') = 'array'
    AND jsonb_array_length(ack -> 'received_fields') = 7
    AND ack -> 'missing_fields' = '[]'::jsonb
  ),
  CONSTRAINT call_context_receipts_delivery_shape_check CHECK (
    (delivery_status = 'accepted' AND telegram_message_id IS NOT NULL AND telegram_accepted_at IS NOT NULL)
    OR (delivery_status <> 'accepted' AND telegram_message_id IS NULL)
  ),
  CONSTRAINT call_context_receipts_verdict_shape_check CHECK (
    (verdict IS NULL AND callback_update_id IS NULL AND callback_query_id_hash IS NULL AND verified_at IS NULL)
    OR (verdict IS NOT NULL AND callback_update_id IS NOT NULL AND callback_query_id_hash IS NOT NULL AND verified_at IS NOT NULL)
  )
);

CREATE INDEX call_context_receipts_callback_lookup_idx
  ON call_context_receipts (telegram_chat_id, telegram_user_id, telegram_message_id, expires_at)
  WHERE delivery_status = 'accepted';

CREATE OR REPLACE FUNCTION public.enforce_call_session_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.source_turn_id IS DISTINCT FROM NEW.source_turn_id
     OR OLD.decision_id IS DISTINCT FROM NEW.decision_id
     OR OLD.contact_id IS DISTINCT FROM NEW.contact_id
     OR OLD.conversation_id IS DISTINCT FROM NEW.conversation_id
     OR OLD.provider IS DISTINCT FROM NEW.provider
     OR OLD.request_idempotency_key IS DISTINCT FROM NEW.request_idempotency_key
     OR OLD.consent_source_message_id IS DISTINCT FROM NEW.consent_source_message_id
     OR OLD.offered_by_decision_id IS DISTINCT FROM NEW.offered_by_decision_id
     OR OLD.context_snapshot IS DISTINCT FROM NEW.context_snapshot
     OR OLD.context_hash IS DISTINCT FROM NEW.context_hash
     OR OLD.prompt_version IS DISTINCT FROM NEW.prompt_version THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Call session identity and context are immutable';
  END IF;

  IF OLD.status IN ('completed', 'failed', 'no_answer', 'timed_out', 'cancelled')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Terminal call status is immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER call_sessions_enforce_transition
BEFORE UPDATE ON call_sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_call_session_transition();

CREATE OR REPLACE FUNCTION public.reject_call_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Call events are append-only';
END
$$;

CREATE TRIGGER call_events_append_only
BEFORE UPDATE OR DELETE ON call_events
FOR EACH ROW EXECUTE FUNCTION public.reject_call_event_mutation();

CREATE OR REPLACE FUNCTION public.enforce_context_receipt_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.call_id IS DISTINCT FROM NEW.call_id
     OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
     OR OLD.context_hash IS DISTINCT FROM NEW.context_hash
     OR OLD.ack IS DISTINCT FROM NEW.ack
     OR OLD.telegram_chat_id IS DISTINCT FROM NEW.telegram_chat_id
     OR OLD.telegram_user_id IS DISTINCT FROM NEW.telegram_user_id
     OR OLD.nonce_hash IS DISTINCT FROM NEW.nonce_hash
     OR OLD.expires_at IS DISTINCT FROM NEW.expires_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Context receipt identity and evidence are immutable';
  END IF;
  IF OLD.delivery_status <> 'pending' AND NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Context receipt delivery verdict is terminal';
  END IF;
  IF OLD.verdict IS NOT NULL AND NEW.verdict IS DISTINCT FROM OLD.verdict THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Human context verdict is immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER call_context_receipts_enforce_transition
BEFORE UPDATE ON call_context_receipts
FOR EACH ROW EXECUTE FUNCTION public.enforce_context_receipt_transition();

GRANT SELECT, INSERT, UPDATE ON call_sessions, call_context_receipts, telegram_agent_b_bindings TO orchestrator_role;
GRANT SELECT, INSERT ON call_events TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON call_sessions, call_events, call_context_receipts, telegram_agent_b_bindings FROM orchestrator_role;
REVOKE UPDATE ON call_events FROM orchestrator_role;
REVOKE ALL ON call_sessions, call_events, call_context_receipts, telegram_agent_b_bindings FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON call_sessions, call_events, call_context_receipts, telegram_agent_b_bindings FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON call_sessions, call_events, call_context_receipts, telegram_agent_b_bindings FROM authenticated';
  END IF;
END
$$;

COMMENT ON TABLE call_sessions IS 'Canonical preauthorized voice call sessions; provider adapters are projections.';
COMMENT ON TABLE call_events IS 'Append-only canonical provider lifecycle facts. Projection is recomputed from the full ledger.';
COMMENT ON TABLE call_context_receipts IS 'Separate technical and human evidence for Agent B context delivery; no transcript or token is stored.';
