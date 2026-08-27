-- Conversation-scoped state for the opt-in Conversation Pipeline V1.
-- Legacy sales_context_states tables remain unchanged and authoritative while
-- CONVERSATION_PIPELINE_V1_ENABLED is false.

BEGIN;

CREATE TABLE IF NOT EXISTS conversation_sales_context_states_v1 (
  workspace_id             uuid        NOT NULL REFERENCES workspaces(id),
  conversation_id          uuid        NOT NULL REFERENCES conversations(id),
  contact_id               uuid        NOT NULL REFERENCES contacts(id),
  selected_offering_code   text,
  selected_payment_plan    text,
  stage                    text        NOT NULL DEFAULT 'exploring',
  call_preference          text        NOT NULL DEFAULT 'unknown',
  call_offer_status        text        NOT NULL DEFAULT 'not_offered',
  awaiting_reply           text        NOT NULL DEFAULT 'none',
  source_turn_id           uuid        REFERENCES messages(id),
  version                  integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, conversation_id),
  CONSTRAINT conversation_sales_context_states_v1_offering_fk
    FOREIGN KEY (workspace_id, selected_offering_code)
    REFERENCES offerings (workspace_id, code),
  CONSTRAINT conversation_sales_context_states_v1_plan_check
    CHECK (selected_payment_plan IS NULL OR selected_payment_plan IN ('monthly_12', 'monthly_6', 'one_time')),
  CONSTRAINT conversation_sales_context_states_v1_stage_check
    CHECK (stage IN ('exploring', 'qualified', 'course_selected', 'plan_selected', 'payment_link_sent', 'handoff', 'closed')),
  CONSTRAINT conversation_sales_context_states_v1_preference_check
    CHECK (call_preference IN ('unknown', 'call', 'chat', 'declined')),
  CONSTRAINT conversation_sales_context_states_v1_offer_check
    CHECK (call_offer_status IN ('not_offered', 'offered', 'accepted', 'declined')),
  CONSTRAINT conversation_sales_context_states_v1_awaiting_check
    CHECK (awaiting_reply IN ('none', 'area_choice', 'course_choice', 'call_or_chat', 'payment_plan', 'payment_confirmation')),
  CONSTRAINT conversation_sales_context_states_v1_payment_requires_offering
    CHECK (selected_payment_plan IS NULL OR selected_offering_code IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS conversation_sales_context_states_v1_contact_idx
  ON conversation_sales_context_states_v1 (workspace_id, contact_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS conversation_sales_context_state_events_v1 (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid        NOT NULL,
  conversation_id           uuid        NOT NULL,
  contact_id                uuid        NOT NULL,
  state_version             integer     NOT NULL CHECK (state_version > 0),
  source_turn_id            uuid        REFERENCES messages(id),
  selected_offering_code    text,
  selected_payment_plan     text,
  stage                     text        NOT NULL,
  call_preference           text        NOT NULL,
  call_offer_status         text        NOT NULL,
  awaiting_reply            text        NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_sales_context_state_events_v1_state_fk
    FOREIGN KEY (workspace_id, conversation_id)
    REFERENCES conversation_sales_context_states_v1 (workspace_id, conversation_id),
  CONSTRAINT conversation_sales_context_state_events_v1_version_unique
    UNIQUE (workspace_id, conversation_id, state_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_sales_context_events_v1_source_unique
  ON conversation_sales_context_state_events_v1 (workspace_id, conversation_id, source_turn_id)
  WHERE source_turn_id IS NOT NULL;

ALTER TABLE conversation_sales_context_states_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_sales_context_state_events_v1 ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON conversation_sales_context_states_v1 TO orchestrator_role;
GRANT SELECT, INSERT ON conversation_sales_context_state_events_v1 TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON conversation_sales_context_states_v1,
  conversation_sales_context_state_events_v1 FROM orchestrator_role;

DO $$
DECLARE
  table_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON conversation_sales_context_states_v1, conversation_sales_context_state_events_v1 FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON conversation_sales_context_states_v1, conversation_sales_context_state_events_v1 FROM authenticated';
  END IF;
  FOREACH table_name IN ARRAY ARRAY[
    'conversation_sales_context_states_v1',
    'conversation_sales_context_state_events_v1'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
        AND policyname = 'orchestrator_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY orchestrator_access ON %I FOR ALL TO orchestrator_role USING (true) WITH CHECK (true)',
        table_name
      );
    END IF;
  END LOOP;
END
$$;

COMMIT;
