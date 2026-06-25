CREATE OR REPLACE FUNCTION search_contact_memory(
  p_contact_id      uuid,
  p_query_embedding extensions.vector(1536),
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