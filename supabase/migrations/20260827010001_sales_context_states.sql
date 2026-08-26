-- Canonical per-contact sales state. This is deliberately separate from
-- selected_memories: vectors may recall preferences, never authorize a course
-- or payment plan.

BEGIN;

CREATE TABLE IF NOT EXISTS sales_context_states (
  workspace_id             uuid        NOT NULL REFERENCES workspaces(id),
  contact_id               uuid        NOT NULL REFERENCES contacts(id),
  conversation_id          uuid        NOT NULL REFERENCES conversations(id),
  selected_offering_code   text,
  selected_payment_plan    text,
  stage                    text        NOT NULL DEFAULT 'exploring',
  source_turn_id           uuid        REFERENCES messages(id),
  version                  integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, contact_id),
  CONSTRAINT sales_context_states_offering_fk
    FOREIGN KEY (workspace_id, selected_offering_code)
    REFERENCES offerings (workspace_id, code),
  CONSTRAINT sales_context_states_plan_check
    CHECK (selected_payment_plan IS NULL OR selected_payment_plan IN ('monthly_12', 'monthly_6', 'one_time')),
  CONSTRAINT sales_context_states_stage_check
    CHECK (stage IN ('exploring', 'qualified', 'course_selected', 'plan_selected', 'payment_link_sent', 'handoff', 'closed')),
  CONSTRAINT sales_context_states_payment_requires_offering
    CHECK (selected_payment_plan IS NULL OR selected_offering_code IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS sales_context_states_conversation_idx
  ON sales_context_states (conversation_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS sales_context_state_events (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid        NOT NULL,
  contact_id                uuid        NOT NULL,
  state_version             integer     NOT NULL,
  source_turn_id            uuid        REFERENCES messages(id),
  selected_offering_code    text,
  selected_payment_plan     text,
  stage                     text        NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_context_state_events_state_fk
    FOREIGN KEY (workspace_id, contact_id)
    REFERENCES sales_context_states (workspace_id, contact_id),
  CONSTRAINT sales_context_state_events_version_unique
    UNIQUE (workspace_id, contact_id, state_version)
);

ALTER TABLE sales_context_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_context_state_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON sales_context_states TO orchestrator_role;
GRANT SELECT, INSERT ON sales_context_state_events TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON sales_context_states, sales_context_state_events FROM orchestrator_role;

DO $$
DECLARE
  table_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON sales_context_states, sales_context_state_events FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON sales_context_states, sales_context_state_events FROM authenticated';
  END IF;
  FOREACH table_name IN ARRAY ARRAY['sales_context_states', 'sales_context_state_events'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_name AND policyname = 'orchestrator_access'
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
