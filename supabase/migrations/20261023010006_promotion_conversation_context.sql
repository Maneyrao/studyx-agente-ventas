-- Keep an exact course being discussed separate from a purchase selection.
-- Price objections are recorded only from Agent A's structured output; the
-- backend never reclassifies customer prose.
BEGIN;

CREATE TABLE public.conversation_promotion_context_v1 (
  workspace_id            uuid        NOT NULL REFERENCES public.workspaces(id),
  conversation_id         uuid        NOT NULL REFERENCES public.conversations(id),
  contact_id              uuid        NOT NULL REFERENCES public.contacts(id),
  interest_offering_code  text,
  price_objection_count   smallint    NOT NULL DEFAULT 0
    CHECK (price_objection_count BETWEEN 0 AND 2),
  source_turn_id          uuid        REFERENCES public.messages(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, conversation_id),
  CONSTRAINT conversation_promotion_context_membership_fk
    FOREIGN KEY (workspace_id, contact_id)
    REFERENCES public.workspace_contacts(workspace_id, contact_id),
  CONSTRAINT conversation_promotion_context_offering_fk
    FOREIGN KEY (workspace_id, interest_offering_code)
    REFERENCES public.offerings(workspace_id, code)
);

CREATE INDEX conversation_promotion_context_contact_idx
  ON public.conversation_promotion_context_v1(workspace_id, contact_id, updated_at DESC);

ALTER TABLE public.conversation_promotion_context_v1 ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.conversation_promotion_context_v1 TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON public.conversation_promotion_context_v1 FROM orchestrator_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.conversation_promotion_context_v1 FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.conversation_promotion_context_v1 FROM authenticated;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'conversation_promotion_context_v1'
      AND policyname = 'orchestrator_access'
  ) THEN
    CREATE POLICY orchestrator_access ON public.conversation_promotion_context_v1
      FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
