-- Idempotent Google Sheets projection outbox.
--
-- Supabase/PostgreSQL stays the source of truth; a spreadsheet is a derived,
-- operator-facing projection. Nothing writes to Sheets inline — canonical
-- events (structured call result, credited payment, fulfillment change)
-- enqueue a row here and a leased worker performs the external write.
--
-- Idempotency model:
--   - projection_key is unique: lead:{workspace_id}:{contact_id} /
--     payment:{workspace_id}:{payment_id}. A payload change re-opens the SAME
--     row with a new payload_hash — never a second spreadsheet row.
--   - row_number is reserved HERE, in PostgreSQL, unique per spreadsheet+tab.
--     The worker always writes with values.update over that fixed range;
--     append is never the primary operation, so replays and ambiguous
--     timeouts can only rewrite the same row.

CREATE TABLE sheet_projection_rows (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  projection_key     text        NOT NULL UNIQUE CHECK (btrim(projection_key) <> ''),
  workspace_id       uuid        NOT NULL REFERENCES workspaces(id),
  projection_type    text        NOT NULL CHECK (projection_type IN ('lead', 'payment')),
  spreadsheet_id     text        NOT NULL CHECK (btrim(spreadsheet_id) <> ''),
  tab_name           text        NOT NULL CHECK (btrim(tab_name) <> ''),
  row_number         integer     NOT NULL CHECK (row_number >= 2),
  payload            jsonb       NOT NULL,
  payload_hash       text        NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  state              text        NOT NULL DEFAULT 'pending'
                                 CHECK (state IN (
                                   'pending',
                                   'leased',
                                   'projected',
                                   'failed_retryable',
                                   'dead_letter'
                                 )),
  attempt_count      integer     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts       integer     NOT NULL DEFAULT 6 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at       timestamptz NOT NULL DEFAULT now(),
  lease_until        timestamptz,
  leased_by          text,
  error_code         text,
  projected_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sheet_projection_rows_row_unique
    UNIQUE (spreadsheet_id, tab_name, row_number),
  CONSTRAINT sheet_projection_rows_projected_timestamp_check
    CHECK (state <> 'projected' OR projected_at IS NOT NULL)
);

CREATE INDEX sheet_projection_rows_claim_idx
  ON sheet_projection_rows (available_at, created_at)
  WHERE state IN ('pending', 'leased', 'failed_retryable');

CREATE TRIGGER sheet_projection_rows_set_updated_at
BEFORE UPDATE ON sheet_projection_rows
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

-- Identity (key, tenant, target cell range) is immutable; the projection may
-- re-open (any state -> pending) because rewriting the same row with fresher
-- data is always safe.
CREATE OR REPLACE FUNCTION public.enforce_sheet_projection_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.projection_key IS DISTINCT FROM NEW.projection_key
     OR OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR OLD.projection_type IS DISTINCT FROM NEW.projection_type
     OR OLD.spreadsheet_id IS DISTINCT FROM NEW.spreadsheet_id
     OR OLD.tab_name IS DISTINCT FROM NEW.tab_name
     OR OLD.row_number IS DISTINCT FROM NEW.row_number THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Sheet projection identity is immutable';
  END IF;

  IF OLD.state IS DISTINCT FROM NEW.state
     AND NOT (
       NEW.state = 'pending'
       OR (OLD.state = 'pending' AND NEW.state IN ('leased', 'dead_letter'))
       OR (OLD.state = 'leased' AND NEW.state IN ('projected', 'failed_retryable', 'dead_letter'))
       OR (OLD.state = 'failed_retryable' AND NEW.state IN ('leased', 'dead_letter'))
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('Invalid sheet projection transition: %s -> %s', OLD.state, NEW.state);
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER sheet_projection_rows_enforce_invariants
BEFORE UPDATE ON sheet_projection_rows
FOR EACH ROW EXECUTE FUNCTION public.enforce_sheet_projection_invariants();

CREATE OR REPLACE FUNCTION public.claim_sheet_projection_rows(
  p_worker_id     text,
  p_limit         integer DEFAULT 20,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF public.sheet_projection_rows
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH exhausted AS (
    UPDATE public.sheet_projection_rows AS stale
    SET
      state = 'dead_letter',
      lease_until = NULL,
      leased_by = NULL,
      error_code = COALESCE(stale.error_code, 'MAX_ATTEMPTS_EXHAUSTED')
    WHERE stale.state = 'leased'
      AND (stale.lease_until IS NULL OR stale.lease_until <= now())
      AND stale.attempt_count >= stale.max_attempts
    RETURNING stale.id
  ), candidates AS (
    SELECT spr.id
    FROM public.sheet_projection_rows AS spr
    WHERE spr.state IN ('pending', 'leased', 'failed_retryable')
      AND spr.available_at <= now()
      AND (
        spr.state <> 'leased'
        OR spr.lease_until IS NULL
        OR spr.lease_until <= now()
      )
      AND spr.attempt_count < spr.max_attempts
    ORDER BY spr.available_at, spr.created_at, spr.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.sheet_projection_rows AS spr
  SET
    state = 'leased',
    leased_by = p_worker_id,
    lease_until = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 5), 900)),
    attempt_count = spr.attempt_count + 1
  FROM candidates AS c
  WHERE spr.id = c.id
  RETURNING spr.*;
$$;

ALTER TABLE sheet_projection_rows ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON sheet_projection_rows TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON sheet_projection_rows FROM orchestrator_role;

GRANT EXECUTE ON FUNCTION public.claim_sheet_projection_rows(text, integer, integer)
  TO orchestrator_role;
REVOKE EXECUTE ON FUNCTION public.claim_sheet_projection_rows(text, integer, integer)
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON sheet_projection_rows FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON sheet_projection_rows FROM authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sheet_projection_rows'
      AND policyname = 'orchestrator_access'
  ) THEN
    EXECUTE 'CREATE POLICY orchestrator_access ON sheet_projection_rows FOR ALL TO orchestrator_role USING (true) WITH CHECK (true)';
  END IF;
END
$$;

COMMENT ON TABLE sheet_projection_rows IS
  'Outbox for the derived Google Sheets projection. One stable spreadsheet row per projection_key; the worker only ever values.update the reserved range.';
