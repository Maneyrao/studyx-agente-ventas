-- Phase 6: Knowledge Base for canonical product/policy content.
-- Additive only. Independent from message_embeddings (contact-scoped memory).

CREATE TABLE knowledge_documents (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  uri          text         NOT NULL,
  title        text         NOT NULL,
  source_type  text         NOT NULL DEFAULT 'markdown'
                            CHECK (source_type IN ('markdown', 'text', 'pdf', 'html', 'manual')),
  version      int          NOT NULL DEFAULT 1 CHECK (version >= 1),
  ingested_at  timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (uri, version)
);

CREATE TABLE knowledge_chunks (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid         NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index   int          NOT NULL CHECK (chunk_index >= 0),
  content       text         NOT NULL,
  token_count   int          NOT NULL CHECK (token_count > 0),
  embedding     extensions.vector(1536) NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

-- HNSW index for cosine similarity search over the KB (same operator class
-- used for message_embeddings — see 20260623000007_hnsw_index.sql).
CREATE INDEX knowledge_chunks_embedding_hnsw_idx
  ON knowledge_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);

-- STABLE function: top-K nearest chunks whose cosine similarity meets or
-- exceeds p_min_similarity. Returns source_uri so callers can attribute the
-- match. NULL for p_min_similarity means "no floor".
CREATE OR REPLACE FUNCTION search_knowledge_base(
  p_query_embedding extensions.vector(1536),
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
