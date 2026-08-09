-- Phase 1 durable embedding jobs.
-- Pending work is represented by a job plus a NULL vector, never by a fake
-- all-zero embedding. Triggers keep the existing runtime compatible while it
-- is migrated from the legacy retry scan to embedding_jobs.

CREATE TABLE embedding_jobs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id         uuid        NOT NULL UNIQUE,
  contact_id         uuid        NOT NULL REFERENCES contacts(id),
  status             text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN (
                                   'pending',
                                   'leased',
                                   'completed',
                                   'failed_retryable',
                                   'dead_letter',
                                   'skipped'
                                 )),
  reason             text        NOT NULL DEFAULT 'message_reusable'
                                 CHECK (btrim(reason) <> ''),
  attempt_count      integer     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts       integer     NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at       timestamptz NOT NULL DEFAULT now(),
  lease_until        timestamptz,
  leased_by          text,
  last_error_code    text,
  last_error_detail  text,
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT embedding_jobs_message_contact_fk
    FOREIGN KEY (message_id, contact_id)
    REFERENCES messages (id, contact_id),
  CONSTRAINT embedding_jobs_attempt_bounds_check
    CHECK (attempt_count <= max_attempts),
  CONSTRAINT embedding_jobs_completed_timestamp_check
    CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX embedding_jobs_claim_idx
  ON embedding_jobs (available_at, lease_until, created_at)
  WHERE status IN ('pending', 'leased', 'failed_retryable');

CREATE TRIGGER embedding_jobs_set_updated_at
BEFORE UPDATE ON embedding_jobs
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_embedding_job_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.message_id IS DISTINCT FROM NEW.message_id
     OR OLD.contact_id IS DISTINCT FROM NEW.contact_id
     OR OLD.reason IS DISTINCT FROM NEW.reason THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Embedding job identity is immutable';
  END IF;

  IF OLD.status IN ('completed', 'dead_letter', 'skipped')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('Embedding job status %s is terminal', OLD.status);
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status
     AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('leased', 'completed', 'dead_letter', 'skipped'))
       OR (OLD.status = 'leased' AND NEW.status IN ('completed', 'failed_retryable', 'dead_letter', 'skipped'))
       OR (OLD.status = 'failed_retryable' AND NEW.status IN ('leased', 'completed', 'dead_letter', 'skipped'))
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('Invalid embedding job transition: %s -> %s', OLD.status, NEW.status);
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER embedding_jobs_enforce_invariants
BEFORE UPDATE ON embedding_jobs
FOR EACH ROW EXECUTE FUNCTION public.enforce_embedding_job_invariants();

ALTER TABLE message_embeddings
  ALTER COLUMN embedding DROP NOT NULL;

-- Normalize both new and legacy fallback writes. Existing application code may
-- still submit a zero vector for pending status; the database discards it.
CREATE OR REPLACE FUNCTION public.normalize_pending_embedding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    NEW.embedding := NULL;
  ELSIF NEW.status = 'indexed' AND NEW.embedding IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'An indexed embedding must contain a vector';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER message_embeddings_normalize_pending
BEFORE INSERT OR UPDATE OF status, embedding ON message_embeddings
FOR EACH ROW EXECUTE FUNCTION public.normalize_pending_embedding();

UPDATE message_embeddings
SET embedding = NULL
WHERE status = 'pending';

ALTER TABLE message_embeddings
  ADD CONSTRAINT message_embeddings_status_vector_check
  CHECK (
    (status = 'pending' AND embedding IS NULL)
    OR (status = 'indexed' AND embedding IS NOT NULL)
  )
  NOT VALID;

ALTER TABLE message_embeddings
  VALIDATE CONSTRAINT message_embeddings_status_vector_check;

CREATE OR REPLACE FUNCTION public.sync_embedding_job_from_materialization()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    INSERT INTO public.embedding_jobs (message_id, contact_id)
    VALUES (NEW.message_id, NEW.contact_id)
    ON CONFLICT (message_id) DO NOTHING;
  ELSIF NEW.status = 'indexed' THEN
    UPDATE public.embedding_jobs
    SET
      status = 'completed',
      completed_at = COALESCE(completed_at, now()),
      lease_until = NULL,
      leased_by = NULL,
      last_error_code = NULL,
      last_error_detail = NULL
    WHERE message_id = NEW.message_id
      AND status NOT IN ('completed', 'dead_letter', 'skipped');
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER message_embeddings_sync_job
AFTER INSERT OR UPDATE OF status ON message_embeddings
FOR EACH ROW EXECUTE FUNCTION public.sync_embedding_job_from_materialization();

-- Recover every legacy pending materialization into the durable queue.
INSERT INTO embedding_jobs (message_id, contact_id, reason)
SELECT me.message_id, me.contact_id, 'legacy_pending_embedding'
FROM message_embeddings AS me
WHERE me.status = 'pending'
ON CONFLICT (message_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_embedding_jobs(
  p_worker_id     text,
  p_limit         integer DEFAULT 20,
  p_lease_seconds integer DEFAULT 60
)
RETURNS SETOF public.embedding_jobs
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH exhausted AS (
    UPDATE public.embedding_jobs AS stale
    SET
      status = 'dead_letter',
      lease_until = NULL,
      leased_by = NULL,
      last_error_code = COALESCE(stale.last_error_code, 'MAX_ATTEMPTS_EXHAUSTED')
    WHERE stale.status = 'leased'
      AND (stale.lease_until IS NULL OR stale.lease_until <= now())
      AND stale.attempt_count >= stale.max_attempts
    RETURNING stale.id
  ), candidates AS (
    SELECT ej.id
    FROM public.embedding_jobs AS ej
    WHERE ej.status IN ('pending', 'leased', 'failed_retryable')
      AND ej.available_at <= now()
      AND (
        ej.status <> 'leased'
        OR ej.lease_until IS NULL
        OR ej.lease_until <= now()
      )
      AND ej.attempt_count < ej.max_attempts
    ORDER BY ej.available_at, ej.created_at, ej.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.embedding_jobs AS ej
  SET
    status = 'leased',
    leased_by = p_worker_id,
    lease_until = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 5), 900)),
    attempt_count = ej.attempt_count + 1
  FROM candidates AS c
  WHERE ej.id = c.id
  RETURNING ej.*;
$$;

GRANT SELECT, INSERT, UPDATE ON embedding_jobs TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON embedding_jobs FROM orchestrator_role;

GRANT EXECUTE ON FUNCTION public.claim_embedding_jobs(text, integer, integer)
  TO orchestrator_role;
REVOKE EXECUTE ON FUNCTION public.claim_embedding_jobs(text, integer, integer)
  FROM PUBLIC;

COMMENT ON TABLE embedding_jobs IS
  'Durable, lease-based work queue; application policy decides which messages are reusable enough to enqueue.';

COMMENT ON COLUMN message_embeddings.embedding IS
  'NULL while pending; only indexed rows contain a real vector.';
