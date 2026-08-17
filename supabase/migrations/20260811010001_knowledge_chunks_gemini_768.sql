-- Completa la migración de embeddings a Gemini text-embedding-004 (768 dims).
--
-- `20260810010001_embeddings_gemini_768.sql` movió `message_embeddings` pero dejó
-- `knowledge_chunks` en las 1536 dimensiones de la era OpenAI, así que la ingesta y
-- la búsqueda de la base de conocimiento mueren con «expected 1536 dimensions».
-- El fallo estaba oculto porque `searchKnowledgeBase` degrada en silencio cuando
-- falta `GEMINI_API_KEY`.
--
-- Migración aditiva: no reescribe migraciones aplicadas. Los chunks son datos
-- derivados y reconstruibles con `scripts/ingest-kb.mjs`, igual que
-- `message_embeddings` (CLAUDE.md, «Fuente de verdad»).

TRUNCATE TABLE knowledge_chunks;

DROP INDEX IF EXISTS knowledge_chunks_embedding_hnsw_idx;

ALTER TABLE knowledge_chunks
  DROP COLUMN embedding,
  ADD COLUMN embedding extensions.vector(768) NOT NULL;

CREATE INDEX knowledge_chunks_embedding_hnsw_idx
  ON knowledge_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);

-- Se recrea con la dimensión nueva. PostgreSQL no aplica el typmod de un
-- parámetro de función, así que la firma es documentación ejecutable: lo que
-- realmente valida la dimensión es la columna.
CREATE OR REPLACE FUNCTION search_knowledge_base(
  p_query_embedding extensions.vector(768),
  p_limit           int DEFAULT 5,
  p_min_similarity  float DEFAULT 0.75
)
RETURNS TABLE (
  chunk_id     uuid,
  document_id  uuid,
  source_uri   text,
  title        text,
  content      text,
  similarity   float
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT
    kc.id         AS chunk_id,
    kc.document_id,
    kd.uri        AS source_uri,
    kd.title,
    kc.content,
    1 - (kc.embedding <=> p_query_embedding) AS similarity
  FROM knowledge_chunks kc
  JOIN knowledge_documents kd ON kd.id = kc.document_id
  WHERE (p_min_similarity IS NULL OR 1 - (kc.embedding <=> p_query_embedding) >= p_min_similarity)
  ORDER BY kc.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;
