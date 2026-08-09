-- Durable Botpress decisions and provider delivery reports.
-- A model proposal is not a side effect: the backend validates and commits it
-- once, then binds any reply to one outbound message and delivery record.

CREATE UNIQUE INDEX messages_id_direction_uq
  ON messages (id, direction);

CREATE UNIQUE INDEX messages_id_reply_direction_uq
  ON messages (id, in_reply_to, direction);

CREATE UNIQUE INDEX outbound_deliveries_id_message_uq
  ON outbound_deliveries (id, message_id);

CREATE TABLE agent_decisions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id            uuid        NOT NULL,
  turn_direction     text        GENERATED ALWAYS AS ('inbound'::text) STORED,
  trace_id           uuid        NOT NULL,
  schema_version     smallint    NOT NULL CHECK (schema_version = 2),
  intent             text        NOT NULL CHECK (intent IN (
                                      'social',
                                      'commercial',
                                      'commercial_decline',
                                      'complaint',
                                      'human_request',
                                      'opt_out',
                                      'out_of_scope',
                                      'unknown'
                                    )),
  decision_kind      text        NOT NULL CHECK (decision_kind IN ('reply', 'clarify', 'suppress')),
  response           text,
  response_type      text        CHECK (response_type IN (
                                      'social_reply',
                                      'commercial_reply',
                                      'clarification',
                                      'complaint_ack',
                                      'automation_only',
                                      'opt_out_ack',
                                      'out_of_scope',
                                      'technical_fallback'
                                    )),
  business_action    jsonb       CHECK (business_action IS NULL),
  memory_candidates  jsonb       NOT NULL DEFAULT '[]'::jsonb
                                    CHECK (jsonb_typeof(memory_candidates) = 'array'),
  missing_information text[]     NOT NULL DEFAULT ARRAY[]::text[],
  next_state         text        NOT NULL CHECK (next_state IN ('completed', 'waiting_user')),
  reason_code        text        NOT NULL CHECK (btrim(reason_code) <> ''),
  confidence         double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  model_provider     text        NOT NULL CHECK (btrim(model_provider) <> ''),
  model_name         text        NOT NULL CHECK (btrim(model_name) <> ''),
  prompt_version     text        NOT NULL CHECK (btrim(prompt_version) <> ''),
  payload_hash       bytea       NOT NULL CHECK (octet_length(payload_hash) = 32),
  outbound_message_id uuid       UNIQUE REFERENCES messages(id),
  outbound_direction text        GENERATED ALWAYS AS ('outbound'::text) STORED,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_decisions_turn_id_uq
    UNIQUE (turn_id),
  CONSTRAINT agent_decisions_turn_inbound_fk
    FOREIGN KEY (turn_id, turn_direction)
    REFERENCES messages (id, direction),
  CONSTRAINT agent_decisions_outbound_same_turn_fk
    FOREIGN KEY (outbound_message_id, turn_id, outbound_direction)
    REFERENCES messages (id, in_reply_to, direction),
  CONSTRAINT agent_decisions_response_shape_check
    CHECK (
      (
        decision_kind = 'reply'
        AND response IS NOT NULL
        AND btrim(response) <> ''
        AND response_type IS NOT NULL
      )
      OR (
        decision_kind = 'clarify'
        AND response IS NOT NULL
        AND btrim(response) <> ''
        AND response_type IS NOT NULL
        AND cardinality(missing_information) > 0
        AND next_state = 'waiting_user'
      )
      OR (
        decision_kind = 'suppress'
        AND response IS NULL
        AND response_type IS NULL
        AND cardinality(missing_information) = 0
        AND memory_candidates = '[]'::jsonb
      )
    ),
  CONSTRAINT agent_decisions_opt_out_shape_check
    CHECK (
      intent <> 'opt_out'
      OR (
        response_type IS NOT NULL
        AND response_type = 'opt_out_ack'
        AND memory_candidates = '[]'::jsonb
        AND next_state = 'completed'
      )
    ),
  CONSTRAINT agent_decisions_human_request_shape_check
    CHECK (
      intent <> 'human_request'
      OR (
        response_type IS NOT NULL
        AND response_type = 'automation_only'
        AND next_state = 'waiting_user'
      )
    ),
  CONSTRAINT agent_decisions_suppress_outbound_check
    CHECK (
      decision_kind <> 'suppress'
      OR outbound_message_id IS NULL
    )
);

CREATE INDEX agent_decisions_trace_idx
  ON agent_decisions (trace_id, created_at, id);

CREATE OR REPLACE FUNCTION public.enforce_agent_decision_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.turn_id IS DISTINCT FROM NEW.turn_id
     OR OLD.trace_id IS DISTINCT FROM NEW.trace_id
     OR OLD.schema_version IS DISTINCT FROM NEW.schema_version
     OR OLD.intent IS DISTINCT FROM NEW.intent
     OR OLD.decision_kind IS DISTINCT FROM NEW.decision_kind
     OR OLD.response IS DISTINCT FROM NEW.response
     OR OLD.response_type IS DISTINCT FROM NEW.response_type
     OR OLD.business_action IS DISTINCT FROM NEW.business_action
     OR OLD.memory_candidates IS DISTINCT FROM NEW.memory_candidates
     OR OLD.missing_information IS DISTINCT FROM NEW.missing_information
     OR OLD.next_state IS DISTINCT FROM NEW.next_state
     OR OLD.reason_code IS DISTINCT FROM NEW.reason_code
     OR OLD.confidence IS DISTINCT FROM NEW.confidence
     OR OLD.model_provider IS DISTINCT FROM NEW.model_provider
     OR OLD.model_name IS DISTINCT FROM NEW.model_name
     OR OLD.prompt_version IS DISTINCT FROM NEW.prompt_version
     OR OLD.payload_hash IS DISTINCT FROM NEW.payload_hash
     OR (
       OLD.outbound_message_id IS DISTINCT FROM NEW.outbound_message_id
       AND NOT (
         OLD.outbound_message_id IS NULL
         AND NEW.outbound_message_id IS NOT NULL
         AND OLD.decision_kind IN ('reply', 'clarify')
         AND OLD.response IS NOT NULL
         AND btrim(OLD.response) <> ''
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Agent decision is immutable after commit';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER agent_decisions_enforce_immutability
BEFORE UPDATE ON agent_decisions
FOR EACH ROW EXECUTE FUNCTION public.enforce_agent_decision_immutability();

CREATE TABLE delivery_reports (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key              text        NOT NULL UNIQUE CHECK (btrim(event_key) <> ''),
  outbound_message_id    uuid        NOT NULL REFERENCES messages(id),
  delivery_id            uuid        NOT NULL REFERENCES outbound_deliveries(id),
  trace_id               uuid        NOT NULL,
  report_status          text        NOT NULL CHECK (report_status IN ('submitted_to_botpress', 'failed')),
  botpress_message_id    text,
  error_code             text,
  payload_hash           bytea       NOT NULL CHECK (octet_length(payload_hash) = 32),
  reported_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT delivery_reports_status_shape_check
    CHECK (
      (report_status = 'submitted_to_botpress' AND botpress_message_id IS NOT NULL AND btrim(botpress_message_id) <> '' AND error_code IS NULL)
      OR (report_status = 'failed' AND error_code IS NOT NULL AND btrim(error_code) <> '')
    ),
  CONSTRAINT delivery_reports_delivery_message_fk
    FOREIGN KEY (delivery_id, outbound_message_id)
    REFERENCES outbound_deliveries (id, message_id)
);

CREATE INDEX delivery_reports_delivery_history_idx
  ON delivery_reports (delivery_id, reported_at, id);

GRANT SELECT, INSERT, UPDATE ON agent_decisions TO orchestrator_role;
GRANT SELECT, INSERT ON delivery_reports TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON agent_decisions, delivery_reports FROM orchestrator_role;
REVOKE UPDATE ON delivery_reports FROM orchestrator_role;

COMMENT ON TABLE agent_decisions IS
  'One validated model decision per inbound turn; retries must match payload_hash.';

COMMENT ON TABLE delivery_reports IS
  'Append-only Botpress delivery evidence; canonical delivery state remains outbound_deliveries.';
