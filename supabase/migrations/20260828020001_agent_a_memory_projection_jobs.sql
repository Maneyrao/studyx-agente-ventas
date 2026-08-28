-- Durable, post-commit projection queue for Agent A memory candidates.
-- The decision transaction enqueues only; validation and vector preparation
-- happen later in the reconciler and can never delay the customer reply.

BEGIN;

CREATE TABLE agent_a_memory_projection_jobs (
  decision_id       uuid        NOT NULL REFERENCES agent_decisions(id),
  candidate_index   smallint    NOT NULL CHECK (candidate_index BETWEEN 0 AND 19),
  turn_id           uuid        NOT NULL REFERENCES messages(id),
  idempotency_key   text        NOT NULL UNIQUE
                               CHECK (idempotency_key ~ '^agent-a-memory:[0-9a-f-]{36}:[a-z_]+:[a-z0-9_]{1,64}$'),
  candidate         jsonb       NOT NULL CHECK (jsonb_typeof(candidate) = 'object'),
  status            text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  result            text        CHECK (result IN ('accepted', 'duplicate', 'rejected')),
  attempt_count     smallint    NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  available_at      timestamptz NOT NULL DEFAULT now(),
  lease_until       timestamptz,
  completed_at      timestamptz,
  last_error_code   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (decision_id, candidate_index),
  CONSTRAINT agent_a_memory_projection_jobs_completion_check
    CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CONSTRAINT agent_a_memory_projection_jobs_lease_check
    CHECK ((status = 'processing') = (lease_until IS NOT NULL))
);

CREATE INDEX agent_a_memory_projection_jobs_pending_idx
  ON agent_a_memory_projection_jobs (available_at, created_at)
  WHERE status IN ('pending', 'failed', 'processing');

CREATE TRIGGER agent_a_memory_projection_jobs_set_updated_at
BEFORE UPDATE ON agent_a_memory_projection_jobs
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

ALTER TABLE agent_a_memory_projection_jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON agent_a_memory_projection_jobs TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON agent_a_memory_projection_jobs FROM orchestrator_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON agent_a_memory_projection_jobs FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON agent_a_memory_projection_jobs FROM authenticated;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_a_memory_projection_jobs'
      AND policyname = 'orchestrator_access'
  ) THEN
    CREATE POLICY orchestrator_access ON agent_a_memory_projection_jobs
      FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
  END IF;
END
$$;

COMMIT;
