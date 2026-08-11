-- Cambio de dimensión de embeddings: 1536 (OpenAI text-embedding-3-small) -> 768 (Gemini text-embedding-004).
-- Migración aditiva: no reescribe migraciones anteriores. Los embeddings son datos derivados
-- y reconstruibles por regla de arquitectura (CLAUDE.md "Fuente de verdad").
-- Preserva triggers, constraints e índices existentes (los recrea idénticos post-cambio de tipo).

TRUNCATE TABLE message_embeddings;

DROP TRIGGER IF EXISTS message_embeddings_normalize_pending ON message_embeddings;
DROP TRIGGER IF EXISTS message_embeddings_sync_job ON message_embeddings;

ALTER TABLE message_embeddings
  DROP CONSTRAINT IF EXISTS message_embeddings_status_vector_check;

DROP INDEX IF EXISTS message_embeddings_pending_idx;
DROP INDEX IF EXISTS message_embeddings_contact_idx;

ALTER TABLE message_embeddings
  DROP COLUMN embedding,
  ADD COLUMN embedding extensions.vector(768);

CREATE INDEX message_embeddings_contact_idx
  ON message_embeddings (contact_id)
  WHERE status = 'indexed';

CREATE INDEX message_embeddings_pending_idx
  ON message_embeddings (created_at)
  WHERE status = 'pending';

CREATE TRIGGER message_embeddings_normalize_pending
BEFORE INSERT OR UPDATE OF status, embedding ON message_embeddings
FOR EACH ROW EXECUTE FUNCTION public.normalize_pending_embedding();

CREATE TRIGGER message_embeddings_sync_job
AFTER INSERT OR UPDATE OF status ON message_embeddings
FOR EACH ROW EXECUTE FUNCTION public.sync_embedding_job_from_materialization();

ALTER TABLE message_embeddings
  ADD CONSTRAINT message_embeddings_status_vector_check
  CHECK (
    (status = 'pending' AND embedding IS NULL)
    OR (status = 'indexed' AND embedding IS NOT NULL)
  );

DROP FUNCTION IF EXISTS search_contact_memory(uuid, extensions.vector, int);

CREATE OR REPLACE FUNCTION search_contact_memory(
  p_contact_id      uuid,
  p_query_embedding extensions.vector(768),
  p_limit           int DEFAULT 10
)
RETURNS TABLE (
  message_id  uuid,
  contact_id  uuid,
  content     text,
  similarity  float,
  created_at  timestamptz
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT
    m.id         AS message_id,
    me.contact_id,
    m.content,
    1 - (me.embedding <=> p_query_embedding) AS similarity,
    m.created_at
  FROM message_embeddings me
  JOIN messages m ON m.id = me.message_id
  WHERE me.contact_id = p_contact_id
    AND me.status = 'indexed'
  ORDER BY me.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;
