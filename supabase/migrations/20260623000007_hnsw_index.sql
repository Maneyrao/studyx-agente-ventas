CREATE INDEX message_embeddings_hnsw_idx
  ON message_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
