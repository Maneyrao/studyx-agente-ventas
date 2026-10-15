-- Stable account identity is distinct from the replaceable provider conversation.
-- Bindings are explicit tenant/account proofs, never a phone-only history lookup.
BEGIN;
CREATE TABLE channel_account_thread_bindings (
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider = 'botpress'),
  integration_id text NOT NULL CHECK (btrim(integration_id) <> ''),
  channel text NOT NULL CHECK (channel = 'whatsapp'),
  bot_phone_number_id text NOT NULL CHECK (btrim(bot_phone_number_id) <> ''),
  canonical_thread_id uuid NOT NULL UNIQUE,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, contact_id, provider, integration_id, channel, bot_phone_number_id),
  UNIQUE (workspace_id, contact_id, provider, integration_id, channel, bot_phone_number_id, canonical_thread_id),
  FOREIGN KEY (workspace_id, contact_id) REFERENCES workspace_contacts (workspace_id, contact_id),
  FOREIGN KEY (canonical_thread_id, contact_id, channel) REFERENCES channel_threads (id, contact_id, channel)
);
CREATE TABLE channel_thread_aliases (
  provider text NOT NULL,
  integration_id text NOT NULL,
  external_conversation_id text NOT NULL CHECK (btrim(external_conversation_id) <> ''),
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  channel text NOT NULL,
  bot_phone_number_id text NOT NULL,
  canonical_thread_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, integration_id, external_conversation_id),
  FOREIGN KEY (workspace_id, contact_id, provider, integration_id, channel, bot_phone_number_id, canonical_thread_id)
    REFERENCES channel_account_thread_bindings
      (workspace_id, contact_id, provider, integration_id, channel, bot_phone_number_id, canonical_thread_id)
);
CREATE TABLE conversation_history_recovery_links (
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel = 'whatsapp'),
  canonical_conversation_id uuid NOT NULL,
  source_conversation_id uuid NOT NULL UNIQUE,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, canonical_conversation_id, source_conversation_id),
  CHECK (canonical_conversation_id <> source_conversation_id),
  FOREIGN KEY (canonical_conversation_id, contact_id, channel) REFERENCES conversations (id, contact_id, channel),
  FOREIGN KEY (source_conversation_id, contact_id, channel) REFERENCES conversations (id, contact_id, channel),
  FOREIGN KEY (workspace_id, canonical_conversation_id) REFERENCES conversation_sales_context_states_v1 (workspace_id, conversation_id),
  FOREIGN KEY (workspace_id, source_conversation_id) REFERENCES conversation_sales_context_states_v1 (workspace_id, conversation_id)
);
CREATE FUNCTION enforce_channel_continuity_proof() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Channel continuity proofs are immutable';
  END IF;
  IF TG_TABLE_NAME = 'channel_account_thread_bindings' THEN
    IF NOT EXISTS (SELECT 1 FROM public.channel_threads thread
      JOIN public.workspace_contacts membership ON membership.contact_id = thread.contact_id
      JOIN public.workspaces workspace ON workspace.id = membership.workspace_id
      WHERE thread.id = NEW.canonical_thread_id AND thread.contact_id = NEW.contact_id
        AND thread.channel = NEW.channel AND thread.provider = NEW.provider
        AND thread.integration_id = NEW.integration_id AND workspace.id = NEW.workspace_id
        AND workspace.status = 'active'
        AND (thread.metadata->>'bot_phone_number_id' IS NULL
          OR thread.metadata->>'bot_phone_number_id' = NEW.bot_phone_number_id)
        AND NOT EXISTS (SELECT 1 FROM public.channel_events contrary WHERE contrary.channel_thread_id = thread.id
          AND contrary.payload #>> '{message,metadata,bot_phone_number_id}' IS NOT NULL
          AND contrary.payload #>> '{message,metadata,bot_phone_number_id}' <> NEW.bot_phone_number_id)
        AND (thread.metadata->>'bot_phone_number_id' = NEW.bot_phone_number_id
          OR EXISTS (SELECT 1 FROM public.channel_events event WHERE event.channel_thread_id = thread.id
            AND event.payload #>> '{message,metadata,bot_phone_number_id}' = NEW.bot_phone_number_id))) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Canonical thread identity scope mismatch';
    END IF;
  ELSIF TG_TABLE_NAME = 'channel_thread_aliases' THEN
    IF EXISTS (SELECT 1 FROM public.channel_threads thread
      WHERE thread.provider = NEW.provider AND thread.integration_id = NEW.integration_id
        AND thread.external_conversation_id = NEW.external_conversation_id
        AND (thread.contact_id <> NEW.contact_id OR thread.channel <> NEW.channel
          OR (thread.metadata->>'bot_phone_number_id' IS NOT NULL
            AND thread.metadata->>'bot_phone_number_id' <> NEW.bot_phone_number_id)
          OR EXISTS (SELECT 1 FROM public.channel_events event WHERE event.channel_thread_id = thread.id
            AND event.payload #>> '{message,metadata,bot_phone_number_id}' IS NOT NULL
            AND event.payload #>> '{message,metadata,bot_phone_number_id}' <> NEW.bot_phone_number_id))) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'External conversation alias identity mismatch';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.conversations canonical
      JOIN public.conversations source ON source.id = NEW.source_conversation_id
      JOIN public.channel_threads source_thread ON source_thread.id = source.channel_thread_id
      JOIN public.channel_account_thread_bindings binding ON binding.canonical_thread_id = canonical.channel_thread_id
        AND binding.workspace_id = NEW.workspace_id AND binding.contact_id = NEW.contact_id
      JOIN public.channel_thread_aliases source_alias ON source_alias.provider = source_thread.provider
        AND source_alias.integration_id = source_thread.integration_id
        AND source_alias.external_conversation_id = source_thread.external_conversation_id
        AND source_alias.canonical_thread_id = binding.canonical_thread_id
        AND source_alias.workspace_id = binding.workspace_id AND source_alias.contact_id = binding.contact_id
        AND source_alias.bot_phone_number_id = binding.bot_phone_number_id
      JOIN public.conversation_sales_context_states_v1 cs ON cs.conversation_id = canonical.id
        AND cs.workspace_id = NEW.workspace_id AND cs.contact_id = NEW.contact_id
      JOIN public.conversation_sales_context_states_v1 ss ON ss.conversation_id = source.id
        AND ss.workspace_id = NEW.workspace_id AND ss.contact_id = NEW.contact_id
      WHERE canonical.id = NEW.canonical_conversation_id AND canonical.status = 'open'
        AND source.status = 'closed' AND canonical.contact_id = NEW.contact_id
        AND source.contact_id = NEW.contact_id AND canonical.channel = NEW.channel
        AND source.channel = NEW.channel)
      OR EXISTS (SELECT 1 FROM public.conversation_history_recovery_links prior
        WHERE prior.source_conversation_id = NEW.canonical_conversation_id
          OR prior.canonical_conversation_id = NEW.source_conversation_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'History recovery requires scoped closed source and unlinked canonical';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE target text; BEGIN
  FOREACH target IN ARRAY ARRAY['channel_account_thread_bindings','channel_thread_aliases','conversation_history_recovery_links'] LOOP
    EXECUTE format('CREATE TRIGGER continuity_proof_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_channel_continuity_proof()', target);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO orchestrator_role', target);
    EXECUTE format('CREATE POLICY orchestrator_access ON public.%I FOR ALL TO orchestrator_role USING (true) WITH CHECK (true)', target);
  END LOOP;
END $$;
COMMIT;
