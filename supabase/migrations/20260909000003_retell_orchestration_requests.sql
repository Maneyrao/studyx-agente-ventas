-- Durable, tenant-bound records for the Retell handoff and follow-up tools.
-- A call may replay either tool, so one request per workspace/contact/call is
-- the idempotency fence; the original user wording is retained verbatim.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'call_sessions'::regclass
      AND conname = 'call_sessions_id_contact_unique'
  ) THEN
    ALTER TABLE call_sessions
      ADD CONSTRAINT call_sessions_id_contact_unique UNIQUE (id, contact_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS retell_handoff_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  contact_id    uuid NOT NULL REFERENCES contacts(id),
  call_id       uuid NOT NULL REFERENCES call_sessions(id),
  reason        text NOT NULL CHECK (reason IN (
    'pedido_explicito', 'reclamo', 'alumno_existente',
    'caso_fuera_de_alcance', 'cierre_complejo'
  )),
  detail        text NOT NULL CHECK (btrim(detail) <> ''),
  urgency       text NOT NULL CHECK (urgency IN ('alta', 'normal')),
  available     boolean,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retell_handoff_requests_workspace_contact_fk
    FOREIGN KEY (workspace_id, contact_id)
    REFERENCES workspace_contacts (workspace_id, contact_id),
  CONSTRAINT retell_handoff_requests_call_contact_fk
    FOREIGN KEY (call_id, contact_id)
    REFERENCES call_sessions (id, contact_id),
  CONSTRAINT retell_handoff_requests_once UNIQUE (workspace_id, contact_id, call_id)
);

CREATE TABLE IF NOT EXISTS retell_followup_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id),
  contact_id       uuid NOT NULL REFERENCES contacts(id),
  call_id          uuid NOT NULL REFERENCES call_sessions(id),
  when_text        text NOT NULL CHECK (btrim(when_text) <> ''),
  channel          text NOT NULL CHECK (channel IN ('llamada', 'whatsapp')),
  reason           text NOT NULL CHECK (btrim(reason) <> ''),
  scheduled_at     timestamptz,
  needs_resolution boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retell_followup_requests_workspace_contact_fk
    FOREIGN KEY (workspace_id, contact_id)
    REFERENCES workspace_contacts (workspace_id, contact_id),
  CONSTRAINT retell_followup_requests_call_contact_fk
    FOREIGN KEY (call_id, contact_id)
    REFERENCES call_sessions (id, contact_id),
  CONSTRAINT retell_followup_requests_once UNIQUE (workspace_id, contact_id, call_id),
  CONSTRAINT retell_followup_resolution_check CHECK (
    (needs_resolution AND scheduled_at IS NULL)
    OR (NOT needs_resolution AND scheduled_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS retell_handoff_requests_pending_idx
  ON retell_handoff_requests (workspace_id, created_at)
  WHERE available IS DISTINCT FROM false;

CREATE INDEX IF NOT EXISTS retell_followup_requests_schedule_idx
  ON retell_followup_requests (workspace_id, scheduled_at)
  WHERE needs_resolution = false;

ALTER TABLE retell_handoff_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE retell_followup_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enforce_retell_request_workspace_call()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- The call's workspace binding is immutable and is the only tenant proof
  -- this request needs. Mutable sales-state membership must not authorize a
  -- cross-workspace request after the call was created.
  IF NOT EXISTS (
    SELECT 1
    FROM call_sessions AS cs
    WHERE cs.id = NEW.call_id
      AND cs.contact_id = NEW.contact_id
      AND cs.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Retell request workspace does not match call workspace';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS retell_handoff_workspace_call_guard ON retell_handoff_requests;
CREATE TRIGGER retell_handoff_workspace_call_guard
BEFORE INSERT OR UPDATE ON retell_handoff_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_retell_request_workspace_call();

DROP TRIGGER IF EXISTS retell_followup_workspace_call_guard ON retell_followup_requests;
CREATE TRIGGER retell_followup_workspace_call_guard
BEFORE INSERT OR UPDATE ON retell_followup_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_retell_request_workspace_call();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON retell_handoff_requests, retell_followup_requests FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON retell_handoff_requests, retell_followup_requests FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orchestrator_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON retell_handoff_requests, retell_followup_requests TO orchestrator_role';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'retell_handoff_requests' AND policyname = 'retell_orchestrator_access') THEN
      EXECUTE 'CREATE POLICY retell_orchestrator_access ON retell_handoff_requests FOR ALL TO orchestrator_role USING (true) WITH CHECK (true)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'retell_followup_requests' AND policyname = 'retell_orchestrator_access') THEN
      EXECUTE 'CREATE POLICY retell_orchestrator_access ON retell_followup_requests FOR ALL TO orchestrator_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END
$$;
