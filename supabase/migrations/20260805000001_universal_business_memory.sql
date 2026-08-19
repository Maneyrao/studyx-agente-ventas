-- Universal business, sales, knowledge, and structured-memory foundation.
-- Business-specific concepts belong in rows scoped by workspace, never in table names.

BEGIN;

CREATE TABLE workspaces (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text        NOT NULL UNIQUE,
  display_name    text        NOT NULL,
  environment     text        NOT NULL DEFAULT 'sandbox'
                              CHECK (environment IN ('sandbox', 'staging', 'production')),
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'inactive', 'archived')),
  default_locale  text        NOT NULL DEFAULT 'es-AR',
  timezone        text        NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_contacts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL REFERENCES workspaces(id),
  contact_id        uuid        NOT NULL REFERENCES contacts(id),
  lifecycle_status  text        NOT NULL DEFAULT 'active'
                                CHECK (lifecycle_status IN ('active', 'inactive', 'archived')),
  source_channel    text,
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workspace_contacts_unique UNIQUE (workspace_id, contact_id)
);

CREATE TABLE offerings (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid          NOT NULL REFERENCES workspaces(id),
  code               text          NOT NULL,
  display_name       text          NOT NULL,
  offering_type      text          NOT NULL DEFAULT 'service'
                                   CHECK (offering_type IN ('service', 'course', 'product', 'subscription')),
  status             text          NOT NULL DEFAULT 'draft'
                                   CHECK (status IN ('draft', 'active', 'inactive', 'archived')),
  description        text          NOT NULL,
  value_proposition  text,
  price_type         text          NOT NULL DEFAULT 'fixed'
                                   CHECK (price_type IN ('fixed', 'quote', 'free')),
  price_amount       numeric(14,2) CHECK (price_amount IS NULL OR price_amount >= 0),
  currency           text          CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  billing_interval   text          CHECK (billing_interval IN ('one_time', 'weekly', 'monthly', 'quarterly', 'annual', 'custom')),
  audience           jsonb         NOT NULL DEFAULT '{}'::jsonb,
  delivery           jsonb         NOT NULL DEFAULT '{}'::jsonb,
  guardrails         jsonb         NOT NULL DEFAULT '{}'::jsonb,
  metadata           jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT offerings_workspace_code_unique UNIQUE (workspace_id, code),
  CONSTRAINT offerings_fixed_price_required CHECK (
    price_type <> 'fixed' OR (price_amount IS NOT NULL AND currency IS NOT NULL)
  )
);

CREATE TABLE sales_pipelines (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id),
  code          text        NOT NULL,
  display_name  text        NOT NULL,
  status        text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'inactive', 'archived')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sales_pipelines_workspace_code_unique UNIQUE (workspace_id, code)
);

CREATE TABLE pipeline_stages (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id   uuid        NOT NULL REFERENCES sales_pipelines(id),
  code          text        NOT NULL,
  display_name  text        NOT NULL,
  position      integer     NOT NULL CHECK (position >= 0),
  is_terminal   boolean     NOT NULL DEFAULT false,
  outcome       text        CHECK (outcome IN ('won', 'lost', 'disqualified')),
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pipeline_stages_pipeline_code_unique UNIQUE (pipeline_id, code),
  CONSTRAINT pipeline_stages_pipeline_position_unique UNIQUE (pipeline_id, position),
  CONSTRAINT pipeline_stages_terminal_outcome_check CHECK (
    (is_terminal AND outcome IS NOT NULL) OR (NOT is_terminal AND outcome IS NULL)
  )
);

CREATE TABLE opportunities (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_contact_id  uuid        NOT NULL REFERENCES workspace_contacts(id),
  offering_id           uuid        REFERENCES offerings(id),
  pipeline_id           uuid        NOT NULL REFERENCES sales_pipelines(id),
  stage_id              uuid        NOT NULL REFERENCES pipeline_stages(id),
  status                text        NOT NULL DEFAULT 'open'
                                    CHECK (status IN ('open', 'won', 'lost', 'disqualified', 'archived')),
  qualification_score   numeric(5,2) CHECK (
    qualification_score IS NULL OR qualification_score BETWEEN 0 AND 100
  ),
  next_action           text,
  next_action_at        timestamptz,
  closed_reason         text,
  metadata              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  opened_at             timestamptz NOT NULL DEFAULT now(),
  closed_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT opportunities_closed_state_check CHECK (
    (status = 'open' AND closed_at IS NULL)
    OR (status <> 'open')
  )
);

CREATE TABLE qualification_fields (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES workspaces(id),
  code           text        NOT NULL,
  prompt         text        NOT NULL,
  response_type  text        NOT NULL
                               CHECK (response_type IN ('boolean', 'single_select', 'multi_select', 'text', 'number')),
  options        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  is_required    boolean     NOT NULL DEFAULT true,
  position       integer     NOT NULL CHECK (position >= 0),
  rules          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status         text        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'inactive', 'archived')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT qualification_fields_workspace_code_unique UNIQUE (workspace_id, code),
  CONSTRAINT qualification_fields_workspace_position_unique UNIQUE (workspace_id, position)
);

CREATE TABLE qualification_answers (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_contact_id  uuid        NOT NULL REFERENCES workspace_contacts(id),
  field_id              uuid        NOT NULL REFERENCES qualification_fields(id),
  opportunity_id        uuid        REFERENCES opportunities(id),
  response              jsonb       NOT NULL,
  source_type           text        NOT NULL DEFAULT 'message'
                                    CHECK (source_type IN ('message', 'call', 'human', 'import', 'system')),
  source_id             uuid,
  answered_at           timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT qualification_answers_current_unique UNIQUE (workspace_contact_id, field_id)
);

CREATE TABLE contact_consents (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_contact_id  uuid        NOT NULL REFERENCES workspace_contacts(id),
  channel               text        NOT NULL,
  purpose               text        NOT NULL,
  status                text        NOT NULL DEFAULT 'unknown'
                                    CHECK (status IN ('unknown', 'granted', 'revoked', 'expired')),
  source                text,
  granted_at            timestamptz,
  revoked_at            timestamptz,
  expires_at            timestamptz,
  evidence              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contact_consents_scope_unique UNIQUE (workspace_contact_id, channel, purpose),
  CONSTRAINT contact_consents_grant_check CHECK (
    status <> 'granted' OR granted_at IS NOT NULL
  )
);

CREATE TABLE knowledge_sources (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id),
  source_type   text        NOT NULL
                              CHECK (source_type IN ('business_profile', 'offering', 'qualification', 'policy', 'faq', 'process', 'objection')),
  title         text        NOT NULL,
  content       text        NOT NULL CHECK (char_length(content) > 0),
  status        text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('draft', 'active', 'archived')),
  version       integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT knowledge_sources_workspace_title_unique UNIQUE (workspace_id, title, version)
);

CREATE TABLE knowledge_chunks (
  id                uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id         uuid                    NOT NULL REFERENCES knowledge_sources(id),
  chunk_index       integer                 NOT NULL CHECK (chunk_index >= 0),
  content           text                    NOT NULL CHECK (char_length(content) > 0),
  embedding         extensions.vector(1536),
  embedding_status  text                    NOT NULL DEFAULT 'pending'
                                            CHECK (embedding_status IN ('pending', 'processing', 'ready', 'failed', 'stale')),
  embedding_model   text,
  embedded_at       timestamptz,
  metadata          jsonb                   NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz             NOT NULL DEFAULT now(),
  updated_at        timestamptz             NOT NULL DEFAULT now(),

  CONSTRAINT knowledge_chunks_source_index_unique UNIQUE (source_id, chunk_index),
  CONSTRAINT knowledge_chunks_ready_check CHECK (
    embedding_status <> 'ready' OR (embedding IS NOT NULL AND embedding_model IS NOT NULL AND embedded_at IS NOT NULL)
  )
);

CREATE TABLE memory_items (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_contact_id  uuid        NOT NULL REFERENCES workspace_contacts(id),
  memory_type           text        NOT NULL
                                    CHECK (memory_type IN ('fact', 'goal', 'preference', 'objection', 'constraint', 'commitment', 'outcome')),
  memory_key            text,
  content               text        NOT NULL CHECK (char_length(content) > 0),
  structured_value      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source_type           text        NOT NULL
                                    CHECK (source_type IN ('message', 'conversation', 'call', 'human', 'import', 'system')),
  source_id             uuid,
  confidence            numeric(4,3) NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  sensitivity           text        NOT NULL DEFAULT 'standard'
                                    CHECK (sensitivity IN ('public', 'standard', 'restricted')),
  valid_from            timestamptz NOT NULL DEFAULT now(),
  valid_until           timestamptz,
  superseded_by         uuid        REFERENCES memory_items(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT memory_items_validity_check CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE memory_embeddings (
  id                uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_item_id    uuid                    NOT NULL UNIQUE REFERENCES memory_items(id),
  embedding         extensions.vector(1536),
  status            text                    NOT NULL DEFAULT 'pending'
                                            CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'stale')),
  embedding_model   text,
  embedded_at       timestamptz,
  retry_count       integer                 NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_error_code   text,
  created_at        timestamptz             NOT NULL DEFAULT now(),
  updated_at        timestamptz             NOT NULL DEFAULT now(),

  CONSTRAINT memory_embeddings_ready_check CHECK (
    status <> 'ready' OR (embedding IS NOT NULL AND embedding_model IS NOT NULL AND embedded_at IS NOT NULL)
  )
);

CREATE INDEX workspace_contacts_contact_idx
  ON workspace_contacts (contact_id, workspace_id);
CREATE INDEX offerings_workspace_status_idx
  ON offerings (workspace_id, status);
CREATE INDEX pipeline_stages_pipeline_position_idx
  ON pipeline_stages (pipeline_id, position);
CREATE INDEX opportunities_contact_status_idx
  ON opportunities (workspace_contact_id, status);
CREATE INDEX opportunities_next_action_idx
  ON opportunities (next_action_at) WHERE status = 'open' AND next_action_at IS NOT NULL;
CREATE INDEX contact_consents_scope_idx
  ON contact_consents (workspace_contact_id, channel, purpose, status);
CREATE INDEX qualification_answers_opportunity_idx
  ON qualification_answers (opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX knowledge_sources_workspace_status_idx
  ON knowledge_sources (workspace_id, status);
CREATE INDEX knowledge_chunks_pending_idx
  ON knowledge_chunks (created_at) WHERE embedding_status IN ('pending', 'failed');
CREATE INDEX knowledge_chunks_hnsw_idx
  ON knowledge_chunks
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL AND embedding_status = 'ready';
CREATE INDEX memory_items_contact_type_idx
  ON memory_items (workspace_contact_id, memory_type, created_at DESC)
  WHERE superseded_by IS NULL;
CREATE INDEX memory_embeddings_pending_idx
  ON memory_embeddings (created_at) WHERE status IN ('pending', 'failed');
CREATE INDEX memory_embeddings_hnsw_idx
  ON memory_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL AND status = 'ready';

CREATE OR REPLACE FUNCTION search_workspace_knowledge(
  p_workspace_id      uuid,
  p_query_embedding   extensions.vector(1536),
  p_limit             integer DEFAULT 5,
  p_min_similarity    double precision DEFAULT 0.55
)
RETURNS TABLE (
  chunk_id       uuid,
  source_id      uuid,
  source_type    text,
  title          text,
  content        text,
  similarity     double precision
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT
    kc.id,
    ks.id,
    ks.source_type,
    ks.title,
    kc.content,
    1 - (kc.embedding <=> p_query_embedding) AS similarity
  FROM knowledge_chunks kc
  JOIN knowledge_sources ks ON ks.id = kc.source_id
  WHERE ks.workspace_id = p_workspace_id
    AND ks.status = 'active'
    AND kc.embedding_status = 'ready'
    AND kc.embedding IS NOT NULL
    AND 1 - (kc.embedding <=> p_query_embedding) >= p_min_similarity
  ORDER BY kc.embedding <=> p_query_embedding
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

CREATE OR REPLACE FUNCTION search_memory_items(
  p_workspace_contact_id  uuid,
  p_query_embedding       extensions.vector(1536),
  p_limit                 integer DEFAULT 5,
  p_min_similarity        double precision DEFAULT 0.55
)
RETURNS TABLE (
  memory_item_id  uuid,
  memory_type     text,
  memory_key      text,
  content         text,
  similarity      double precision,
  created_at      timestamptz
)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT
    mi.id,
    mi.memory_type,
    mi.memory_key,
    mi.content,
    1 - (me.embedding <=> p_query_embedding) AS similarity,
    mi.created_at
  FROM memory_embeddings me
  JOIN memory_items mi ON mi.id = me.memory_item_id
  WHERE mi.workspace_contact_id = p_workspace_contact_id
    AND mi.superseded_by IS NULL
    AND (mi.valid_until IS NULL OR mi.valid_until > now())
    AND me.status = 'ready'
    AND me.embedding IS NOT NULL
    AND 1 - (me.embedding <=> p_query_embedding) >= p_min_similarity
  ORDER BY me.embedding <=> p_query_embedding
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualification_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualification_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_embeddings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON workspaces, workspace_contacts, offerings, sales_pipelines,
  pipeline_stages, opportunities, qualification_fields, qualification_answers, contact_consents,
  knowledge_sources, knowledge_chunks, memory_items, memory_embeddings
  FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON workspaces, workspace_contacts, offerings,
  sales_pipelines, pipeline_stages, opportunities, qualification_fields, qualification_answers,
  contact_consents, knowledge_sources, knowledge_chunks, memory_items,
  memory_embeddings TO orchestrator_role;

REVOKE DELETE, TRUNCATE ON workspaces, workspace_contacts, offerings,
  sales_pipelines, pipeline_stages, opportunities, qualification_fields, qualification_answers,
  contact_consents, knowledge_sources, knowledge_chunks, memory_items,
  memory_embeddings FROM orchestrator_role;

CREATE POLICY orchestrator_access ON workspaces
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_access ON workspace_contacts
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_access ON offerings
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_access ON sales_pipelines
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_access ON pipeline_stages
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_access ON opportunities
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_access ON qualification_fields
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_access ON qualification_answers
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_access ON contact_consents
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_access ON knowledge_sources
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_access ON knowledge_chunks
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_access ON memory_items
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_access ON memory_embeddings
  FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);

GRANT EXECUTE ON FUNCTION search_workspace_knowledge(uuid, extensions.vector, integer, double precision)
  TO orchestrator_role;
GRANT EXECUTE ON FUNCTION search_memory_items(uuid, extensions.vector, integer, double precision)
  TO orchestrator_role;
REVOKE EXECUTE ON FUNCTION search_workspace_knowledge(uuid, extensions.vector, integer, double precision)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION search_memory_items(uuid, extensions.vector, integer, double precision)
  FROM PUBLIC;

COMMENT ON TABLE workspace_contacts IS
  'Workspace-specific lifecycle for a global contact. Sales status and consent live elsewhere.';
COMMENT ON TABLE knowledge_chunks IS
  'Derived, rebuildable retrieval chunks. knowledge_sources remains canonical business knowledge.';
COMMENT ON TABLE memory_embeddings IS
  'Derived, rebuildable vectors for selected memories; never the source of truth.';

-- ---------------------------------------------------------------------------
-- Retire this migration's `knowledge_chunks`.
-- ---------------------------------------------------------------------------
-- This table and the one created by 20260809020001_phase6_knowledge_base.sql
-- collided on a name while modelling different things: this one chunks
-- `knowledge_sources` with an asynchronous embedding pipeline, that one chunks
-- `knowledge_documents` for retrieval. Because this file sorts earlier, it won
-- the name and Phase 6 then failed with "relation already exists", which is why
-- a clean `supabase db reset` was impossible.
--
-- The architecture had already settled the question elsewhere — see the header
-- of 20260817010001_universal_business_schema.sql: "NO knowledge_chunks
-- redefinition. knowledge_sources is the canonical knowledge store". The
-- retrieval index owned by Phase 6 keeps the name; `knowledge_sources` reaches
-- it through knowledge_projection_jobs.
--
-- Production was already repaired by hand exactly this way, and this rename is
-- what brings the migrations back in step with it. It is deliberately the same
-- one-line operation rather than a rewrite of the CREATE TABLE above: indexes,
-- policy and constraints keep their original names on the renamed table, which
-- is precisely the state production is in.
--
-- Nothing reads this table: its `search_workspace_knowledge` has no caller in
-- the codebase. It is kept rather than dropped because dropping is not this
-- migration's call to make (Constitution IV), and the row data — if any — is
-- still evidence.
ALTER TABLE knowledge_chunks RENAME TO legacy_knowledge_chunks_20260805;

COMMIT;
