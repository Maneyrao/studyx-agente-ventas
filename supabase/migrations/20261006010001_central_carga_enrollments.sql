-- Central de Carga enrollment worker (docs/contracts/central-de-carga-enrollment.md).
--
-- Additive only. The claim primitive already exists
-- (`claim_fulfillment_jobs`, 20260817030001: SKIP LOCKED, lease expiry,
-- attempt_count increment), so this migration only adds:
--   1. `central_enrollments`: the durable, queryable result of a successful
--      enrollment (one row per payment). The job row records process state;
--      this table records what the Central answered, so the agent can later
--      tell the student what access they really have.
--   2. A default of 3 attempts for new fulfillment jobs (CLAUDE.md: at most
--      three attempts with backoff, then escalate). The worker also caps at 3
--      for rows created earlier with the old default of 5.

ALTER TABLE fulfillment_jobs ALTER COLUMN max_attempts SET DEFAULT 3;

CREATE TABLE central_enrollments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id          uuid        NOT NULL UNIQUE REFERENCES payments(id),
  workspace_id        uuid        NOT NULL REFERENCES workspaces(id),
  enrollment_id       text        NOT NULL CHECK (length(enrollment_id) > 0),
  student_id          text        NOT NULL CHECK (length(student_id) > 0),
  enrollment_status   text        NOT NULL
                                  CHECK (enrollment_status IN ('active', 'already_enrolled')),
  student_was_created boolean     NOT NULL,
  welcome_sent        boolean     NOT NULL,
  login_email         text        NOT NULL CHECK (length(login_email) > 0),
  central_created_at  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER central_enrollments_set_updated_at
BEFORE UPDATE ON central_enrollments
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

ALTER TABLE central_enrollments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON central_enrollments TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON central_enrollments FROM orchestrator_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON central_enrollments FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON central_enrollments FROM authenticated';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'central_enrollments'
      AND policyname = 'orchestrator_access'
  ) THEN
    CREATE POLICY orchestrator_access ON central_enrollments
      FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
  END IF;
END
$$;

-- The worker must honor the sandbox lock (no real-effect action on a contact
-- with a sandbox_identities row) from the application role. Read-only grant.
GRANT SELECT ON sandbox_identities TO orchestrator_role;
