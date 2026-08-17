-- Tenant isolation for the derived knowledge search index.
--
-- P1: knowledge_documents/knowledge_chunks are shared across every workspace
-- and search_knowledge_base ranks globally, so one client's chunks can be
-- served to another client whenever they are semantically closer. This
-- migration makes the tenant a first-class column and replaces the search
-- entry point with a workspace-scoped one.
--
-- Additive only:
--   - knowledge_documents gains workspace_id (nullable: legacy documents keep
--     NULL and are excluded from every workspace-scoped search — a legacy
--     document must never leak into a tenant it was not written for).
--   - knowledge_documents gains archived_at so an archived knowledge_source
--     can stop serving without DELETE (orchestrator_role has no DELETE).
--   - search_knowledge_base(workspace, embedding, limit, min_similarity)
--     replaces the tenant-blind 3-argument version, which is dropped so no
--     code path can keep using it.

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id),
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Backfill documents already projected from knowledge_sources. The URI is
-- reconstructed exactly from canonical rows (never parsed out of the URI), so
-- only documents that provably belong to a source get a workspace.
UPDATE knowledge_documents AS kd
SET workspace_id = ks.workspace_id
FROM knowledge_sources AS ks
WHERE kd.workspace_id IS NULL
  AND kd.uri = 'workspace/' || ks.workspace_id::text || '/knowledge-source/' || ks.id::text;

CREATE INDEX IF NOT EXISTS knowledge_documents_workspace_idx
  ON knowledge_documents (workspace_id)
  WHERE workspace_id IS NOT NULL;

-- The tenant-blind entry point must not survive: any caller that still used
-- it would keep serving cross-workspace content.
DROP FUNCTION IF EXISTS public.search_knowledge_base(extensions.vector, integer, double precision);

-- Workspace-scoped search. The workspace filter is part of the WHERE clause
-- of the single query, so PostgreSQL restricts candidates BEFORE ORDER BY /
-- LIMIT — this is never "global top-K, filter later". A NULL workspace
-- matches nothing (fail closed), and legacy rows with workspace_id IS NULL
-- are never returned because NULL = NULL is not true.
CREATE OR REPLACE FUNCTION public.search_knowledge_base(
  p_workspace_id    uuid,
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
  WHERE kd.workspace_id = p_workspace_id
    AND kd.archived_at IS NULL
    AND (p_min_similarity IS NULL OR 1 - (kc.embedding <=> p_query_embedding) >= p_min_similarity)
  ORDER BY kc.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.search_knowledge_base(uuid, extensions.vector, int, float) IS
  'Workspace-scoped KB search. The workspace id must be resolved in the backend from BUSINESS_WORKSPACE_SLUG; it never comes from model output or request bodies.';

COMMENT ON COLUMN knowledge_documents.workspace_id IS
  'Tenant owner. NULL marks a legacy/global document that is excluded from every workspace-scoped search.';
COMMENT ON COLUMN knowledge_documents.archived_at IS
  'Set when the backing knowledge_source is archived (or superseded by a newer version); archived documents never appear in search results.';
