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
  DROP CONSTRAINT IF EXISTS selected_memories_embedding_scope_check,
  DROP CONSTRAINT IF EXISTS selected_memories_embedding_state_scope_check;

ALTER TABLE selected_memories
  ADD CONSTRAINT selected_memories_embedding_state_check
    CHECK (embedding_state IN (
      'skip', 'pending', 'leased', 'ready', 'failed', 'failed_retryable', 'dead_letter'
    )),
  ADD CONSTRAINT selected_memories_embedding_attempt_bounds_check
    CHECK (embedding_attempts <= embedding_max_attempts AND embedding_max_attempts BETWEEN 1 AND 20),
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
    ),
  ADD CONSTRAINT selected_memories_ready_epoch_check
    CHECK (embedding_state <> 'ready' OR embedding_epoch IS NOT NULL) NOT VALID;

ALTER TABLE message_embeddings
  ADD CONSTRAINT message_embeddings_indexed_epoch_check
    CHECK (status <> 'indexed' OR embedding_epoch IS NOT NULL) NOT VALID;

ALTER TABLE knowledge_chunks
  ADD CONSTRAINT knowledge_chunks_epoch_check
    CHECK (embedding_epoch IS NOT NULL) NOT VALID;

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
  RETURN NEW;
END
$$;

CREATE TRIGGER selected_memories_normalize_embedding_lease
BEFORE INSERT OR UPDATE OF embedding, embedding_state ON selected_memories
FOR EACH ROW EXECUTE FUNCTION public.normalize_selected_memory_embedding_lease();

DROP INDEX IF EXISTS selected_memories_embedding_pending_idx;
CREATE INDEX selected_memories_embedding_claim_idx
  ON selected_memories (embedding_available_at, lease_until, created_at, id)
  WHERE embedding_state IN ('pending', 'leased', 'failed_retryable');

DROP INDEX IF EXISTS knowledge_projection_jobs_claim_idx;
CREATE INDEX knowledge_projection_jobs_claim_idx
  ON knowledge_projection_jobs (available_at, lease_until, created_at, id)
  WHERE status IN ('pending', 'leased', 'failed_retryable');

CREATE INDEX message_embeddings_epoch_contact_idx
  ON message_embeddings (embedding_epoch, contact_id)
  WHERE status = 'indexed' AND embedding_epoch IS NOT NULL;

CREATE INDEX selected_memories_epoch_contact_idx
  ON selected_memories (embedding_epoch, contact_id)
  WHERE embedding_state = 'ready' AND embedding_epoch IS NOT NULL;

CREATE INDEX knowledge_chunks_epoch_idx
  ON knowledge_chunks (embedding_epoch)
  WHERE embedding_epoch IS NOT NULL;

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
  WITH exhausted AS (
    UPDATE public.selected_memories AS stale
    SET embedding_state = 'dead_letter',
        lease_until = NULL,
        leased_by = NULL,
        embedding_last_error = COALESCE(stale.embedding_last_error, 'MAX_ATTEMPTS_EXHAUSTED'),
        embedding_updated_at = now()
    WHERE stale.embedding_state = 'leased'
      AND stale.lease_until <= now()
      AND stale.embedding_attempts >= stale.embedding_max_attempts
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
    AND kc.embedding_epoch = p_embedding_epoch
    AND (p_min_similarity IS NULL OR 1 - (kc.embedding <=> p_query_embedding) >= p_min_similarity)
  ORDER BY kc.embedding <=> p_query_embedding
  LIMIT greatest(1, least(p_limit, 20));
$$;

GRANT EXECUTE ON FUNCTION public.claim_memory_embeddings(text, integer, integer) TO orchestrator_role;
REVOKE EXECUTE ON FUNCTION public.claim_memory_embeddings(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_contact_memory(uuid, extensions.vector, text, int) TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.search_selected_memories(uuid, extensions.vector, text, int, double precision) TO orchestrator_role;
GRANT EXECUTE ON FUNCTION public.search_knowledge_base(uuid, extensions.vector, text, int, float) TO orchestrator_role;
REVOKE EXECUTE ON FUNCTION public.search_contact_memory(uuid, extensions.vector, text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_selected_memories(uuid, extensions.vector, text, int, double precision) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_knowledge_base(uuid, extensions.vector, text, int, float) FROM PUBLIC;

COMMENT ON COLUMN message_embeddings.embedding_epoch IS 'Vector-space epoch; NULL is legacy and excluded from epoch-aware search.';
COMMENT ON COLUMN selected_memories.embedding_epoch IS 'Vector-space epoch; NULL is legacy and excluded from epoch-aware search.';
COMMENT ON COLUMN knowledge_chunks.embedding_epoch IS 'Vector-space epoch; NULL is legacy and excluded from epoch-aware search.';
