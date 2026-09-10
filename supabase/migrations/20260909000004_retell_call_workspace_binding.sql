-- Bind every call to the workspace that authorized it.  A call must never
-- rediscover a tenant from mutable memberships during a replay.

ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS workspace_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'call_sessions'::regclass
      AND conname = 'call_sessions_workspace_fk'
  ) THEN
    ALTER TABLE call_sessions
      ADD CONSTRAINT call_sessions_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
  END IF;
END
$$;

-- Only an unambiguous historical candidate is safe to backfill.  Ambiguous
-- and orphaned legacy sessions intentionally remain NULL and fail closed at
-- the Retell boundary.
WITH candidates AS (
  SELECT cs.id, state.workspace_id
  FROM call_sessions AS cs
  JOIN conversation_sales_context_states_v1 AS state
    ON state.conversation_id = cs.conversation_id AND state.contact_id = cs.contact_id
  JOIN workspaces AS w ON w.id = state.workspace_id AND w.status = 'active'
  JOIN workspace_contacts AS wc
    ON wc.workspace_id = state.workspace_id
   AND wc.contact_id = cs.contact_id
   AND wc.lifecycle_status = 'active'
  WHERE cs.workspace_id IS NULL
  UNION
  SELECT cs.id, state.workspace_id
  FROM call_sessions AS cs
  JOIN sales_context_states AS state
    ON state.conversation_id = cs.conversation_id AND state.contact_id = cs.contact_id
  JOIN workspaces AS w ON w.id = state.workspace_id AND w.status = 'active'
  JOIN workspace_contacts AS wc
    ON wc.workspace_id = state.workspace_id
   AND wc.contact_id = cs.contact_id
   AND wc.lifecycle_status = 'active'
  WHERE cs.workspace_id IS NULL
), unique_candidates AS (
  SELECT id, (array_agg(workspace_id ORDER BY workspace_id))[1] AS workspace_id
  FROM candidates
  GROUP BY id
  HAVING count(DISTINCT workspace_id) = 1
)
UPDATE call_sessions AS cs
SET workspace_id = unique_candidates.workspace_id
FROM unique_candidates
WHERE cs.id = unique_candidates.id AND cs.workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS call_sessions_workspace_idx
  ON call_sessions (workspace_id, status, updated_at);

CREATE OR REPLACE FUNCTION public.resolve_retell_call_workspace(
  p_conversation_id uuid,
  p_contact_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  candidate uuid;
  candidate_count integer;
BEGIN
  WITH candidates AS (
    SELECT state.workspace_id
    FROM conversation_sales_context_states_v1 AS state
    JOIN workspaces AS workspace
      ON workspace.id = state.workspace_id AND workspace.status = 'active'
    JOIN workspace_contacts AS membership
      ON membership.workspace_id = state.workspace_id
     AND membership.contact_id = p_contact_id
     AND membership.lifecycle_status = 'active'
    WHERE state.conversation_id = p_conversation_id
      AND state.contact_id = p_contact_id
    UNION
    SELECT state.workspace_id
    FROM sales_context_states AS state
    JOIN workspaces AS workspace
      ON workspace.id = state.workspace_id AND workspace.status = 'active'
    JOIN workspace_contacts AS membership
      ON membership.workspace_id = state.workspace_id
     AND membership.contact_id = p_contact_id
     AND membership.lifecycle_status = 'active'
    WHERE state.conversation_id = p_conversation_id
      AND state.contact_id = p_contact_id
  )
  SELECT (array_agg(workspace_id ORDER BY workspace_id))[1], count(DISTINCT workspace_id)::integer
    INTO candidate, candidate_count
  FROM candidates;

  IF candidate_count = 1 THEN
    RETURN candidate;
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.bind_call_session_workspace()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  candidate uuid;
BEGIN
  IF NEW.provider <> 'retell' THEN
    RETURN NEW;
  END IF;

  candidate := public.resolve_retell_call_workspace(NEW.conversation_id, NEW.contact_id);
  IF NEW.workspace_id IS NOT NULL THEN
    IF candidate IS NULL OR NEW.workspace_id IS DISTINCT FROM candidate THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Retell call workspace does not match the unique conversation/contact tenant';
    END IF;
  ELSE
    NEW.workspace_id := candidate;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS call_sessions_bind_workspace ON call_sessions;
CREATE TRIGGER call_sessions_bind_workspace
BEFORE INSERT ON call_sessions
FOR EACH ROW EXECUTE FUNCTION public.bind_call_session_workspace();

CREATE OR REPLACE FUNCTION public.enforce_call_session_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  candidate uuid;
BEGIN
  IF OLD.source_turn_id IS DISTINCT FROM NEW.source_turn_id
     OR OLD.decision_id IS DISTINCT FROM NEW.decision_id
     OR OLD.contact_id IS DISTINCT FROM NEW.contact_id
     OR OLD.conversation_id IS DISTINCT FROM NEW.conversation_id
     OR OLD.provider IS DISTINCT FROM NEW.provider
     OR (OLD.workspace_id IS NULL AND NEW.workspace_id IS NOT NULL AND NEW.workspace_id IS DISTINCT FROM
       public.resolve_retell_call_workspace(NEW.conversation_id, NEW.contact_id))
     OR (OLD.workspace_id IS NOT NULL AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id)
     OR OLD.request_idempotency_key IS DISTINCT FROM NEW.request_idempotency_key
     OR OLD.consent_source_message_id IS DISTINCT FROM NEW.consent_source_message_id
     OR OLD.offered_by_decision_id IS DISTINCT FROM NEW.offered_by_decision_id
     OR OLD.context_snapshot IS DISTINCT FROM NEW.context_snapshot
     OR OLD.context_hash IS DISTINCT FROM NEW.context_hash
     OR OLD.prompt_version IS DISTINCT FROM NEW.prompt_version THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Call session identity and context are immutable';
  END IF;

  IF OLD.workspace_id IS NULL AND NEW.workspace_id IS NOT NULL THEN
    candidate := public.resolve_retell_call_workspace(NEW.conversation_id, NEW.contact_id);
    IF candidate IS NULL OR NEW.workspace_id IS DISTINCT FROM candidate THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Retell legacy call workspace must match the unique conversation/contact tenant';
    END IF;
  END IF;

  IF OLD.status IN ('completed', 'failed', 'no_answer', 'timed_out', 'cancelled')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Terminal call status is immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

COMMENT ON COLUMN call_sessions.workspace_id IS
  'Immutable tenant binding. NULL is retained only for ambiguous legacy sessions and is fail-closed.';
