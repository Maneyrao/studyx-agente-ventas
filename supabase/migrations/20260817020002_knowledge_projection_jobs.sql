-- Durable projection of knowledge_sources into the derived search index.
--
-- P1: projectKnowledgeSources existed but nothing in the runtime ever called
-- it, so knowledge_sources never reached knowledge_documents/knowledge_chunks.
-- This migration makes projection work durable: a trigger on
-- knowledge_sources enqueues a job row, and a lease-based worker (cron)
-- drains the queue. Modeled on embedding_jobs (status/lease/attempts/
-- backoff/dead-letter) — that queue could not be reused because it is bound
-- one-to-one to messages(id).
--
-- Idempotency key: (workspace_id, source_id, source_version). A repeated
-- trigger fire for the same content is a no-op; a real content change revives
-- the job to 'pending' so edits are re-projected even without a version bump.

CREATE TABLE knowledge_projection_jobs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid        NOT NULL REFERENCES workspaces(id),
  source_id          uuid        NOT NULL REFERENCES knowledge_sources(id),
  source_version     integer     NOT NULL CHECK (source_version > 0),
  status             text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN (
                                   'pending',
                                   'leased',
                                   'completed',
                                   'failed_retryable',
                                   'dead_letter',
                                   'skipped'
                                 )),
  attempt_count      integer     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts       integer     NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at       timestamptz NOT NULL DEFAULT now(),
  lease_until        timestamptz,
  leased_by          text,
  last_error_code    text,
  last_error_detail  text,
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT knowledge_projection_jobs_identity_unique
    UNIQUE (workspace_id, source_id, source_version),
  CONSTRAINT knowledge_projection_jobs_completed_timestamp_check
    CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX knowledge_projection_jobs_claim_idx
  ON knowledge_projection_jobs (available_at, created_at)
  WHERE status IN ('pending', 'leased', 'failed_retryable');

CREATE TRIGGER knowledge_projection_jobs_set_updated_at
BEFORE UPDATE ON knowledge_projection_jobs
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

-- Identity is immutable; state machine allows revival back to 'pending'
-- (a source edit re-opens even a completed or dead-lettered job — the write
-- path is idempotent, so re-projection is always safe).
CREATE OR REPLACE FUNCTION public.enforce_knowledge_projection_job_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR OLD.source_id IS DISTINCT FROM NEW.source_id
     OR OLD.source_version IS DISTINCT FROM NEW.source_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Knowledge projection job identity is immutable';
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status
     AND NOT (
       NEW.status = 'pending'
       OR (OLD.status = 'pending' AND NEW.status IN ('leased', 'skipped', 'dead_letter'))
       OR (OLD.status = 'leased' AND NEW.status IN ('completed', 'failed_retryable', 'dead_letter', 'skipped'))
       OR (OLD.status = 'failed_retryable' AND NEW.status IN ('leased', 'dead_letter', 'skipped'))
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('Invalid knowledge projection job transition: %s -> %s', OLD.status, NEW.status);
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER knowledge_projection_jobs_enforce_invariants
BEFORE UPDATE ON knowledge_projection_jobs
FOR EACH ROW EXECUTE FUNCTION public.enforce_knowledge_projection_job_invariants();

-- Enqueue on canonical writes. Archive/unarchive of the derived documents is
-- a pure database write, so it happens here atomically with the source change
-- instead of through the (embedding-bound) worker.
CREATE OR REPLACE FUNCTION public.sync_knowledge_source_projection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  source_uri text;
BEGIN
  source_uri := 'workspace/' || NEW.workspace_id::text || '/knowledge-source/' || NEW.id::text;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'active' THEN
      INSERT INTO public.knowledge_projection_jobs (workspace_id, source_id, source_version)
      VALUES (NEW.workspace_id, NEW.id, NEW.version)
      ON CONFLICT (workspace_id, source_id, source_version) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.status = 'active' THEN
    IF OLD.status IS DISTINCT FROM NEW.status
       OR OLD.version IS DISTINCT FROM NEW.version
       OR OLD.content IS DISTINCT FROM NEW.content
       OR OLD.title IS DISTINCT FROM NEW.title THEN
      INSERT INTO public.knowledge_projection_jobs (workspace_id, source_id, source_version)
      VALUES (NEW.workspace_id, NEW.id, NEW.version)
      ON CONFLICT (workspace_id, source_id, source_version) DO UPDATE
      SET
        status = 'pending',
        available_at = now(),
        attempt_count = 0,
        lease_until = NULL,
        leased_by = NULL,
        last_error_code = NULL,
        last_error_detail = NULL,
        completed_at = NULL;

      -- Reactivation: the documents for this source become visible again.
      UPDATE public.knowledge_documents
      SET archived_at = NULL
      WHERE uri = source_uri
        AND workspace_id = NEW.workspace_id
        AND version = NEW.version
        AND archived_at IS NOT NULL;
    END IF;
  ELSIF NEW.status = 'archived' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.knowledge_documents
    SET archived_at = now()
    WHERE uri = source_uri
      AND workspace_id = NEW.workspace_id
      AND archived_at IS NULL;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER knowledge_sources_sync_projection
AFTER INSERT OR UPDATE ON knowledge_sources
FOR EACH ROW EXECUTE FUNCTION public.sync_knowledge_source_projection();

-- Recover sources that were already active before this migration: they never
-- had a projection job, so enqueue them now.
INSERT INTO knowledge_projection_jobs (workspace_id, source_id, source_version)
SELECT ks.workspace_id, ks.id, ks.version
FROM knowledge_sources AS ks
WHERE ks.status = 'active'
ON CONFLICT (workspace_id, source_id, source_version) DO NOTHING;

-- Lease-based claim, same shape as claim_embedding_jobs: promote exhausted
-- stale leases to dead_letter, then lease the oldest available candidates
-- with SKIP LOCKED so two workers never claim the same job.
CREATE OR REPLACE FUNCTION public.claim_knowledge_projection_jobs(
  p_worker_id     text,
  p_limit         integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF public.knowledge_projection_jobs
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH exhausted AS (
    UPDATE public.knowledge_projection_jobs AS stale
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
    SELECT kpj.id
    FROM public.knowledge_projection_jobs AS kpj
    WHERE kpj.status IN ('pending', 'leased', 'failed_retryable')
      AND kpj.available_at <= now()
      AND (
        kpj.status <> 'leased'
        OR kpj.lease_until IS NULL
        OR kpj.lease_until <= now()
      )
      AND kpj.attempt_count < kpj.max_attempts
    ORDER BY kpj.available_at, kpj.created_at, kpj.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.knowledge_projection_jobs AS kpj
  SET
    status = 'leased',
    leased_by = p_worker_id,
    lease_until = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 5), 900)),
    attempt_count = kpj.attempt_count + 1
  FROM candidates AS c
  WHERE kpj.id = c.id
  RETURNING kpj.*;
$$;

GRANT SELECT, INSERT, UPDATE ON knowledge_projection_jobs TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON knowledge_projection_jobs FROM orchestrator_role;

GRANT EXECUTE ON FUNCTION public.claim_knowledge_projection_jobs(text, integer, integer)
  TO orchestrator_role;
REVOKE EXECUTE ON FUNCTION public.claim_knowledge_projection_jobs(text, integer, integer)
  FROM PUBLIC;

COMMENT ON TABLE knowledge_projection_jobs IS
  'Durable lease-based queue projecting knowledge_sources into knowledge_documents/knowledge_chunks. Idempotent per (workspace_id, source_id, source_version); revived to pending when the source changes.';
