-- Universal business schema: workspaces, offerings, commercial pipeline,
-- qualification and canonical knowledge sources.
--
-- The remote database already carries these tables (applied there as
-- 20260805000001_universal_business_memory before the Phase 1-8 chain). This
-- migration makes that state reproducible on a clean database while sorting
-- AFTER every committed migration, so it must be safe both ways:
--   - on a clean database it creates everything;
--   - on the remote it is a no-op (IF NOT EXISTS / guarded policies).
--
-- Deliberate differences from the historical remote migration:
--   - NO knowledge_chunks redefinition. `knowledge_sources` is the canonical
--     knowledge store; the existing `knowledge_documents`/`knowledge_chunks`
--     pair (document_id, vector(768)) remains the single derived search index.
--     Sources are projected into it with a stable URI per workspace/source:
--       workspace/{workspace_id}/knowledge-source/{source_id}
--     using the source's own `version` as the document version, so
--     re-ingestion is idempotent per (uri, version).
--   - NO memory_items/memory_embeddings: this branch's contact memory is
--     `selected_memories` + `message_embeddings`; recreating the legacy
--     1536-dim memory tables on clean databases would add drift, not remove it.
--   - NO 1536-dim search functions; retrieval stays on search_knowledge_base
--     (vector(768)).

CREATE TABLE IF NOT EXISTS workspaces (
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

CREATE TABLE IF NOT EXISTS workspace_contacts (
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

CREATE TABLE IF NOT EXISTS offerings (
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

CREATE TABLE IF NOT EXISTS sales_pipelines (
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

CREATE TABLE IF NOT EXISTS pipeline_stages (
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

CREATE TABLE IF NOT EXISTS opportunities (
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

CREATE TABLE IF NOT EXISTS qualification_fields (
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

CREATE TABLE IF NOT EXISTS qualification_answers (
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

CREATE TABLE IF NOT EXISTS contact_consents (
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

CREATE TABLE IF NOT EXISTS knowledge_sources (
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

CREATE INDEX IF NOT EXISTS workspace_contacts_contact_idx
  ON workspace_contacts (contact_id, workspace_id);
CREATE INDEX IF NOT EXISTS offerings_workspace_status_idx
  ON offerings (workspace_id, status);
CREATE INDEX IF NOT EXISTS pipeline_stages_pipeline_position_idx
  ON pipeline_stages (pipeline_id, position);
CREATE INDEX IF NOT EXISTS opportunities_contact_status_idx
  ON opportunities (workspace_contact_id, status);
CREATE INDEX IF NOT EXISTS opportunities_next_action_idx
  ON opportunities (next_action_at) WHERE status = 'open' AND next_action_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS contact_consents_scope_idx
  ON contact_consents (workspace_contact_id, channel, purpose, status);
CREATE INDEX IF NOT EXISTS qualification_answers_opportunity_idx
  ON qualification_answers (opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS knowledge_sources_workspace_status_idx
  ON knowledge_sources (workspace_id, status);

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

GRANT SELECT, INSERT, UPDATE ON workspaces, workspace_contacts, offerings,
  sales_pipelines, pipeline_stages, opportunities, qualification_fields,
  qualification_answers, contact_consents, knowledge_sources TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON workspaces, workspace_contacts, offerings,
  sales_pipelines, pipeline_stages, opportunities, qualification_fields,
  qualification_answers, contact_consents, knowledge_sources FROM orchestrator_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON workspaces, workspace_contacts, offerings, sales_pipelines, pipeline_stages, opportunities, qualification_fields, qualification_answers, contact_consents, knowledge_sources FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON workspaces, workspace_contacts, offerings, sales_pipelines, pipeline_stages, opportunities, qualification_fields, qualification_answers, contact_consents, knowledge_sources FROM authenticated';
  END IF;
END
$$;

-- The remote already has these policies from the historical migration, so each
-- one is guarded: create only when absent.
DO $$
DECLARE
  business_table text;
BEGIN
  FOREACH business_table IN ARRAY ARRAY[
    'workspaces', 'workspace_contacts', 'offerings', 'sales_pipelines',
    'pipeline_stages', 'opportunities', 'qualification_fields',
    'qualification_answers', 'contact_consents', 'knowledge_sources'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = business_table
        AND policyname = 'orchestrator_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY orchestrator_access ON %I FOR ALL TO orchestrator_role USING (true) WITH CHECK (true)',
        business_table
      );
    END IF;
  END LOOP;
END
$$;

COMMENT ON TABLE knowledge_sources IS
  'Canonical per-workspace business knowledge. Projected into knowledge_documents/knowledge_chunks (the derived vector(768) index) with uri workspace/{workspace_id}/knowledge-source/{source_id} and version = knowledge_sources.version.';
COMMENT ON TABLE workspaces IS
  'Tenant identity. The active workspace is derived in the backend from configuration, never from model output.';
