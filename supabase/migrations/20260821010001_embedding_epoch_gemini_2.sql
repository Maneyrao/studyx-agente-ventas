-- Expand phase for Gemini Embedding 2.
--
-- Vectors are derived data, but the source rows are canonical and must not be
-- deleted during a provider-space change.  Existing materializations therefore
-- keep a NULL epoch (legacy / ineligible for epoch-aware search) while every new
-- ready materialization is required to name its vector space.

ALTER TABLE message_embeddings
  ADD COLUMN IF NOT EXISTS embedding_epoch text;

ALTER TABLE selected_memories
  ADD COLUMN IF NOT EXISTS embedding_epoch text,
  ADD COLUMN IF NOT EXISTS embedding_available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS leased_by text,
  ADD COLUMN IF NOT EXISTS embedding_max_attempts integer NOT NULL DEFAULT 5;

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding_epoch text;

ALTER TABLE selected_memories
  DROP CONSTRAINT IF EXISTS selected_memories_embedding_state_check,
  DROP CONSTRAINT IF EXISTS selected_memories_embedding_attempt_bounds_check,
  DROP CONSTRAINT IF EXISTS selected_memories_embedding_scope_check,
  DROP CONSTRAINT IF EXISTS selected_memories_embedding_state_scope_check,
  DROP CONSTRAINT IF EXISTS selected_memories_lease_shape_check;

ALTER TABLE selected_memories
  ADD CONSTRAINT selected_memories_embedding_state_check
    CHECK (embedding_state IN (
      'skip', 'pending', 'leased', 'ready', 'failed', 'failed_retryable', 'dead_letter'
    )),
  ADD CONSTRAINT selected_memories_embedding_scope_check
    CHECK (
      (embedding IS NULL AND embedding_state IN (
        'skip', 'pending', 'leased', 'failed', 'failed_retryable', 'dead_letter'
      ))
      OR (embedding IS NOT NULL AND embedding_state = 'ready'
          AND status IN ('accepted', 'active'))
    ),
  ADD CONSTRAINT selected_memories_embedding_state_scope_check
    CHECK (embedding_state = 'skip' OR status IN ('accepted', 'active')),
  ADD CONSTRAINT selected_memories_lease_shape_check
    CHECK (
      (embedding_state = 'leased' AND lease_until IS NOT NULL AND leased_by IS NOT NULL)
      OR (embedding_state <> 'leased' AND lease_until IS NULL AND leased_by IS NULL)
    );

-- Preserve the historical attempt counter. Rows which already exhausted the
-- new default are terminalized during expand instead of becoming permanently
-- unclaimable; max_attempts is raised for counters above five before the check
-- is installed.
UPDATE selected_memories
SET embedding_max_attempts = GREATEST(embedding_max_attempts, embedding_attempts);

UPDATE selected_memories
SET embedding_state = 'dead_letter',
    embedding_last_error = COALESCE(embedding_last_error, 'MAX_ATTEMPTS_EXHAUSTED'),
    embedding_updated_at = now(),
    lease_until = NULL,
    leased_by = NULL
WHERE embedding_state IN ('pending', 'failed_retryable')
  AND embedding_attempts >= embedding_max_attempts;

ALTER TABLE selected_memories
  ADD CONSTRAINT selected_memories_embedding_attempt_bounds_check
    CHECK (embedding_max_attempts >= 1 AND embedding_attempts <= embedding_max_attempts);

-- Epoch enforcement is transition-based, not a NOT VALID CHECK. PostgreSQL
-- re-evaluates NOT VALID checks on every UPDATE, which would make an unrelated
-- metadata update fail for a preserved legacy vector. These triggers require
-- the active epoch only when a vector is newly materialized or changed.
CREATE OR REPLACE FUNCTION public.enforce_message_embedding_epoch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'indexed'
     AND NEW.embedding_epoch IS DISTINCT FROM 'gemini-embedding-2:768:retrieval-v1' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Indexed embedding requires the active epoch';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS message_embeddings_enforce_epoch ON message_embeddings;
CREATE TRIGGER message_embeddings_enforce_epoch
BEFORE INSERT OR UPDATE OF status, embedding, embedding_epoch ON message_embeddings
FOR EACH ROW EXECUTE FUNCTION public.enforce_message_embedding_epoch();

CREATE OR REPLACE FUNCTION public.normalize_selected_memory_embedding_lease()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.embedding_state <> 'leased' THEN
    NEW.lease_until := NULL;
    NEW.leased_by := NULL;
  END IF;
  IF NEW.embedding IS NULL THEN
    NEW.embedding_epoch := NULL;
  END IF;
  IF NEW.embedding_state = 'ready'
     AND NEW.embedding_epoch IS DISTINCT FROM 'gemini-embedding-2:768:retrieval-v1' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Ready selected memory requires the active epoch';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS selected_memories_normalize_embedding_lease ON selected_memories;
CREATE TRIGGER selected_memories_normalize_embedding_lease
BEFORE INSERT OR UPDATE OF embedding, embedding_state, embedding_epoch ON selected_memories
FOR EACH ROW EXECUTE FUNCTION public.normalize_selected_memory_embedding_lease();

CREATE OR REPLACE FUNCTION public.enforce_knowledge_chunk_epoch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.embedding_epoch IS DISTINCT FROM 'gemini-embedding-2:768:retrieval-v1' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Knowledge chunk requires the active epoch';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS knowledge_chunks_enforce_epoch ON knowledge_chunks;
CREATE TRIGGER knowledge_chunks_enforce_epoch
BEFORE INSERT OR UPDATE OF embedding, embedding_epoch ON knowledge_chunks
FOR EACH ROW EXECUTE FUNCTION public.enforce_knowledge_chunk_epoch();

DROP INDEX IF EXISTS selected_memories_embedding_pending_idx;
CREATE INDEX selected_memories_embedding_claim_idx
  ON selected_memories (embedding_available_at, lease_until, created_at, id)
  WHERE embedding_state IN ('pending', 'leased', 'failed_retryable');

DROP INDEX IF EXISTS knowledge_projection_jobs_claim_idx;
CREATE INDEX knowledge_projection_jobs_claim_idx
  ON knowledge_projection_jobs (available_at, lease_until, created_at, id)
  WHERE status IN ('pending', 'leased', 'failed_retryable');

DROP INDEX IF EXISTS message_embeddings_hnsw_idx;
DROP INDEX IF EXISTS message_embeddings_current_epoch_hnsw_idx;
CREATE INDEX message_embeddings_current_epoch_hnsw_idx
  ON message_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops)
  WHERE status = 'indexed'
    AND embedding_epoch = 'gemini-embedding-2:768:retrieval-v1';

DROP INDEX IF EXISTS selected_memories_embedding_hnsw_idx;
DROP INDEX IF EXISTS selected_memories_current_epoch_hnsw_idx;
CREATE INDEX selected_memories_current_epoch_hnsw_idx
  ON selected_memories
  USING hnsw (embedding extensions.vector_cosine_ops)
  WHERE status = 'active'
    AND embedding_state = 'ready'
    AND embedding_epoch = 'gemini-embedding-2:768:retrieval-v1';

DROP INDEX IF EXISTS knowledge_chunks_embedding_hnsw_idx;
DROP INDEX IF EXISTS knowledge_chunks_current_epoch_hnsw_idx;
CREATE INDEX knowledge_chunks_current_epoch_hnsw_idx
  ON knowledge_chunks
  USING hnsw (embedding extensions.vector_cosine_ops)
  WHERE embedding_epoch = 'gemini-embedding-2:768:retrieval-v1';

-- A legacy direct indexed write may complete a pending job.  A leased job,
-- however, belongs exclusively to its worker and can only be completed by an
-- ownership-guarded worker update.
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
      AND status IN ('pending', 'failed_retryable');
  END IF;

  RETURN NEW;
END
$$;

DROP FUNCTION IF EXISTS public.claim_memory_embeddings(integer);

CREATE FUNCTION public.claim_memory_embeddings(
  p_worker_id     text,
  p_limit         integer DEFAULT 5,
  p_lease_seconds integer DEFAULT 45
)
RETURNS TABLE (
  memory_id   uuid,
  contact_id  uuid,
  value_text  text,
  attempts    integer,
  max_attempts integer,
  leased_by   text,
  lease_until timestamptz
)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH exhausted_candidates AS (
    SELECT sm.id
    FROM public.selected_memories AS sm
    WHERE sm.embedding_attempts >= sm.embedding_max_attempts
      AND (
        sm.embedding_state IN ('pending', 'failed_retryable')
        OR (sm.embedding_state = 'leased' AND sm.lease_until <= now())
      )
    ORDER BY sm.embedding_updated_at NULLS FIRST, sm.created_at, sm.id
    FOR UPDATE SKIP LOCKED
    LIMIT 100
  ), exhausted AS (
    UPDATE public.selected_memories AS stale
    SET embedding_state = 'dead_letter',
        lease_until = NULL,
        leased_by = NULL,
        embedding_last_error = COALESCE(stale.embedding_last_error, 'MAX_ATTEMPTS_EXHAUSTED'),
        embedding_updated_at = now()
    FROM exhausted_candidates AS ec
    WHERE stale.id = ec.id
    RETURNING stale.id
  ), candidates AS (
    SELECT sm.id
    FROM public.selected_memories AS sm
    WHERE sm.status IN ('accepted', 'active')
      AND sm.embedding_state IN ('pending', 'leased', 'failed_retryable')
      AND sm.embedding_available_at <= now()
      AND (
        sm.embedding_state <> 'leased'
        OR sm.lease_until <= now()
      )
      AND sm.embedding_attempts < sm.embedding_max_attempts
    ORDER BY sm.embedding_available_at, sm.created_at, sm.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 20)
  )
  UPDATE public.selected_memories AS sm
  SET embedding_state = 'leased',
      leased_by = p_worker_id,
      lease_until = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 5), 300)),
      embedding_attempts = sm.embedding_attempts + 1,
      embedding_updated_at = now()
  FROM candidates AS c
  WHERE sm.id = c.id
  RETURNING sm.id, sm.contact_id, sm.value_normalized, sm.embedding_attempts,
            sm.embedding_max_attempts, sm.leased_by, sm.lease_until;
$$;

-- Multi-table completions are exposed as one top-level statement so the
-- worker can cancel the complete PostgreSQL transaction boundary. No native
-- postgres.js begin() promise is allowed to outlive the worker deadline.
DROP FUNCTION IF EXISTS public.complete_message_embedding_job(
  uuid, uuid, uuid, text, extensions.vector, text
);

CREATE FUNCTION public.complete_message_embedding_job(
  p_job_id          uuid,
  p_message_id      uuid,
  p_contact_id      uuid,
  p_worker_id       text,
  p_embedding       extensions.vector(768),
  p_embedding_epoch text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  locked_job_id uuid;
  affected_rows bigint;
BEGIN
  SELECT ej.id INTO locked_job_id
  FROM public.embedding_jobs AS ej
  WHERE ej.id = p_job_id
    AND ej.message_id = p_message_id
    AND ej.contact_id = p_contact_id
    AND ej.status = 'leased'
    AND ej.leased_by = p_worker_id
    AND ej.lease_until > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.message_embeddings
  SET embedding = p_embedding,
      embedding_epoch = p_embedding_epoch,
      status = 'indexed'
  WHERE message_id = p_message_id
    AND contact_id = p_contact_id
    AND status = 'pending';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'MESSAGE_MATERIALIZATION_ROW_MISMATCH';
  END IF;

  UPDATE public.embedding_jobs
  SET status = 'completed',
      completed_at = now(),
      lease_until = NULL,
      leased_by = NULL,
      last_error_code = NULL,
      last_error_detail = NULL
  WHERE id = locked_job_id
    AND status = 'leased'
    AND leased_by = p_worker_id
    AND lease_until > now();
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'MESSAGE_JOB_COMPLETION_ROW_MISMATCH';
  END IF;

  RETURN true;
END
$$;

DROP FUNCTION IF EXISTS public.complete_knowledge_projection_job(
  uuid, uuid, uuid, integer, text, text, text, text, integer, extensions.vector, text
);

CREATE FUNCTION public.complete_knowledge_projection_job(
  p_job_id          uuid,
  p_workspace_id    uuid,
  p_source_id       uuid,
  p_source_version  integer,
  p_worker_id       text,
  p_uri             text,
  p_title           text,
  p_content         text,
  p_token_count     integer,
  p_embedding       extensions.vector(768),
  p_embedding_epoch text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  live_source public.knowledge_sources%ROWTYPE;
  locked_job_id uuid;
  projected_document_id uuid;
  affected_rows bigint;
BEGIN
  -- Match canonical writer ordering: source first, then projection job.
  SELECT ks.* INTO live_source
  FROM public.knowledge_sources AS ks
  WHERE ks.id = p_source_id AND ks.workspace_id = p_workspace_id
  FOR UPDATE;

  SELECT kpj.id INTO locked_job_id
  FROM public.knowledge_projection_jobs AS kpj
  WHERE kpj.id = p_job_id
    AND kpj.workspace_id = p_workspace_id
    AND kpj.source_id = p_source_id
    AND kpj.source_version = p_source_version
    AND kpj.status = 'leased'
    AND kpj.leased_by = p_worker_id
    AND kpj.lease_until > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'lease_lost';
  END IF;

  IF live_source.id IS NULL
     OR live_source.status <> 'active'
     OR live_source.version <> p_source_version
     OR live_source.title IS DISTINCT FROM p_title
     OR live_source.content IS DISTINCT FROM p_content THEN
    UPDATE public.knowledge_projection_jobs
    SET status = 'skipped',
        lease_until = NULL,
        leased_by = NULL,
        last_error_code = CASE
          WHEN live_source.id IS NULL THEN 'SOURCE_NOT_FOUND'
          ELSE 'SOURCE_CHANGED_DURING_EMBEDDING'
        END
    WHERE id = locked_job_id
      AND status = 'leased'
      AND leased_by = p_worker_id;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION 'KNOWLEDGE_JOB_SKIP_ROW_MISMATCH';
    END IF;
    RETURN 'skipped';
  END IF;

  INSERT INTO public.knowledge_documents (uri, title, source_type, version, workspace_id)
  VALUES (p_uri, p_title, 'manual', p_source_version, p_workspace_id)
  ON CONFLICT (uri, version) DO NOTHING
  RETURNING id INTO projected_document_id;

  IF projected_document_id IS NULL THEN
    SELECT kd.id INTO projected_document_id
    FROM public.knowledge_documents AS kd
    WHERE kd.uri = p_uri
      AND kd.version = p_source_version
      AND kd.workspace_id = p_workspace_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DOCUMENT_TENANT_MISMATCH';
    END IF;
  END IF;

  INSERT INTO public.knowledge_chunks (
    document_id, chunk_index, content, token_count, embedding, embedding_epoch
  )
  VALUES (
    projected_document_id, 0, p_content, p_token_count, p_embedding, p_embedding_epoch
  )
  ON CONFLICT (document_id, chunk_index) DO UPDATE
  SET content = EXCLUDED.content,
      token_count = EXCLUDED.token_count,
      embedding = EXCLUDED.embedding,
      embedding_epoch = EXCLUDED.embedding_epoch;

  UPDATE public.knowledge_documents
  SET archived_at = now()
  WHERE uri = p_uri
    AND workspace_id = p_workspace_id
    AND version < p_source_version
    AND archived_at IS NULL;

  UPDATE public.knowledge_projection_jobs
  SET status = 'completed',
      completed_at = now(),
      lease_until = NULL,
      leased_by = NULL,
      last_error_code = NULL,
      last_error_detail = NULL
  WHERE id = locked_job_id
    AND status = 'leased'
    AND leased_by = p_worker_id;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'KNOWLEDGE_JOB_COMPLETION_ROW_MISMATCH';
  END IF;

  RETURN 'completed';
END
$$;

-- Epoch-aware overloads.  Legacy signatures remain for the expand/backfill
-- window; all new application callers use these overloads.
CREATE FUNCTION public.search_contact_memory(
  p_contact_id      uuid,
  p_query_embedding extensions.vector(768),
  p_embedding_epoch text,
  p_limit           int DEFAULT 10
)
RETURNS TABLE (
  message_id uuid, contact_id uuid, content text, similarity float, created_at timestamptz
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT m.id, me.contact_id, m.content,
         1 - (me.embedding <=> p_query_embedding), m.created_at
  FROM message_embeddings me
  JOIN messages m ON m.id = me.message_id
  WHERE me.contact_id = p_contact_id
    AND me.status = 'indexed'
    AND me.embedding_epoch = 'gemini-embedding-2:768:retrieval-v1'
    AND me.embedding_epoch = p_embedding_epoch
  ORDER BY me.embedding <=> p_query_embedding
  LIMIT greatest(1, least(p_limit, 20));
$$;

CREATE FUNCTION public.search_selected_memories(
  p_contact_id      uuid,
  p_query_embedding extensions.vector(768),
  p_embedding_epoch text,
  p_limit           int DEFAULT 5,
  p_min_similarity  double precision DEFAULT 0.75
)
RETURNS TABLE (
  memory_id uuid, memory_type text, memory_key text, value_text text,
  source_quote text, similarity float, recorded_at timestamptz
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT sm.id, sm.memory_type, sm.memory_key, sm.value_normalized, sm.source_quote,
         1 - (sm.embedding <=> p_query_embedding), sm.created_at
  FROM selected_memories sm
  WHERE sm.contact_id = p_contact_id
    AND sm.status = 'active'
    AND sm.embedding_state = 'ready'
    AND sm.embedding_epoch = 'gemini-embedding-2:768:retrieval-v1'
    AND sm.embedding_epoch = p_embedding_epoch
    AND (sm.valid_until IS NULL OR sm.valid_until > now())
    AND 1 - (sm.embedding <=> p_query_embedding) >= p_min_similarity
  ORDER BY sm.embedding <=> p_query_embedding
  LIMIT greatest(1, least(p_limit, 20));
$$;

CREATE FUNCTION public.search_knowledge_base(
  p_workspace_id    uuid,
  p_query_embedding extensions.vector(768),
  p_embedding_epoch text,
  p_limit           int DEFAULT 5,
  p_min_similarity  float DEFAULT 0.75
)
RETURNS TABLE (
  chunk_id uuid, document_id uuid, source_uri text, title text, content text, similarity float
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT kc.id, kc.document_id, kd.uri, kd.title, kc.content,
         1 - (kc.embedding <=> p_query_embedding)
  FROM knowledge_chunks kc
  JOIN knowledge_documents kd ON kd.id = kc.document_id
  WHERE kd.workspace_id = p_workspace_id
    AND kd.archived_at IS NULL
    AND kc.embedding_epoch = 'gemini-embedding-2:768:retrieval-v1'
    AND kc.embedding_epoch = p_embedding_epoch
    AND (p_min_similarity IS NULL OR 1 - (kc.embedding <=> p_query_embedding) >= p_min_similarity)
  ORDER BY kc.embedding <=> p_query_embedding
  LIMIT greatest(1, least(p_limit, 20));
$$;

GRANT EXECUTE ON FUNCTION public.claim_memory_embeddings(text, integer, integer) TO orchestrator_role;
REVOKE EXECUTE ON FUNCTION public.claim_memory_embeddings(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_message_embedding_job(uuid, uuid, uuid, text, extensions.vector, text)
  TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.complete_knowledge_projection_job(uuid, uuid, uuid, integer, text, text, text, text, integer, extensions.vector, text)
  TO orchestrator_role;
REVOKE EXECUTE ON FUNCTION public.complete_message_embedding_job(uuid, uuid, uuid, text, extensions.vector, text)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_knowledge_projection_job(uuid, uuid, uuid, integer, text, text, text, text, integer, extensions.vector, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_contact_memory(uuid, extensions.vector, text, int) TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.search_selected_memories(uuid, extensions.vector, text, int, double precision) TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.search_knowledge_base(uuid, extensions.vector, text, int, float) TO orchestrator_role;
REVOKE EXECUTE ON FUNCTION public.search_contact_memory(uuid, extensions.vector, text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_selected_memories(uuid, extensions.vector, text, int, double precision) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_knowledge_base(uuid, extensions.vector, text, int, float) FROM PUBLIC;

-- The phase6 tables are created after the historical broad grants in a clean
-- migration replay, so grant their runtime owner explicitly and restore RLS.
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON knowledge_sources TO orchestrator_role;
GRANT SELECT, INSERT, UPDATE ON knowledge_documents, knowledge_chunks TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON knowledge_documents, knowledge_chunks FROM orchestrator_role;
REVOKE ALL ON knowledge_documents, knowledge_chunks FROM anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'knowledge_documents'
      AND policyname = 'orchestrator_access'
  ) THEN
    CREATE POLICY orchestrator_access ON knowledge_documents
      FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'knowledge_chunks'
      AND policyname = 'orchestrator_access'
  ) THEN
    CREATE POLICY orchestrator_access ON knowledge_chunks
      FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
  END IF;
END
$$;

COMMENT ON COLUMN message_embeddings.embedding_epoch IS 'Vector-space epoch; NULL is legacy and excluded from epoch-aware search.';
COMMENT ON COLUMN selected_memories.embedding_epoch IS 'Vector-space epoch; NULL is legacy and excluded from epoch-aware search.';
COMMENT ON COLUMN knowledge_chunks.embedding_epoch IS 'Vector-space epoch; NULL is legacy and excluded from epoch-aware search.';
