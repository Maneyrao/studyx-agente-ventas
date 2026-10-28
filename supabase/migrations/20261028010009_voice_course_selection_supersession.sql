-- Current authenticated voice selections are evidence in their own channel;
-- they never impersonate the chat message which originally requested the call.
CREATE TABLE public.voice_course_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.call_sessions(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  contact_id uuid NOT NULL REFERENCES public.contacts(id),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id),
  previous_offering_code text,
  selected_offering_code text NOT NULL CHECK (length(btrim(selected_offering_code))>0),
  expected_state_version bigint NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.voice_course_selections ENABLE ROW LEVEL SECURITY;
-- Remove Supabase default grants as well: RLS/append-only triggers do not guard TRUNCATE.
REVOKE ALL ON public.voice_course_selections,public.promotion_voice_acceptances
  FROM PUBLIC,anon,authenticated,service_role,orchestrator_role;
GRANT SELECT,INSERT ON public.voice_course_selections,public.promotion_voice_acceptances TO orchestrator_role,service_role;
CREATE POLICY orchestrator_access ON public.voice_course_selections FOR ALL TO orchestrator_role USING(true) WITH CHECK(true);

CREATE FUNCTION public.guard_voice_course_selection() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Voice selection evidence is immutable'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.call_sessions c
    JOIN public.conversation_sales_context_states_v1 s ON s.workspace_id=c.workspace_id
      AND s.contact_id=c.contact_id AND s.conversation_id=c.conversation_id
    JOIN public.offerings selected ON selected.workspace_id=c.workspace_id AND selected.code=NEW.selected_offering_code
    WHERE c.id=NEW.call_id AND c.workspace_id=NEW.workspace_id AND c.contact_id=NEW.contact_id
      AND c.conversation_id=NEW.conversation_id AND c.provider='retell' AND c.provider_call_id IS NOT NULL
      AND c.status IN ('provider_accepted','in_progress','completed')
      AND NOT EXISTS (SELECT 1 FROM public.call_sessions later WHERE later.workspace_id=c.workspace_id
        AND later.contact_id=c.contact_id AND later.conversation_id=c.conversation_id AND later.requested_at>c.requested_at)
      AND s.version=NEW.expected_state_version AND s.selected_offering_code IS NOT DISTINCT FROM NEW.previous_offering_code
      AND s.selected_offering_code IS DISTINCT FROM NEW.selected_offering_code AND selected.status='active'
    FOR UPDATE OF s FOR SHARE OF c,selected
  ) THEN RAISE EXCEPTION 'Voice selection identity mismatch'; END IF;
  NEW.occurred_at=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER voice_course_selections_guard BEFORE INSERT OR UPDATE OR DELETE ON public.voice_course_selections
FOR EACH ROW EXECUTE FUNCTION public.guard_voice_course_selection();
REVOKE ALL ON FUNCTION public.guard_voice_course_selection() FROM PUBLIC,anon,authenticated;

ALTER TABLE public.payment_intent_supersessions
  ALTER COLUMN source_turn_id DROP NOT NULL,
  ADD COLUMN source_voice_selection_id uuid REFERENCES public.voice_course_selections(id),
  ADD CONSTRAINT payment_supersession_source_xor CHECK (
    (source_turn_id IS NOT NULL AND source_voice_selection_id IS NULL)
    OR (source_turn_id IS NULL AND source_voice_selection_id IS NOT NULL));

CREATE OR REPLACE FUNCTION public.validate_payment_intent_supersession() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.payments p JOIN public.offerings original ON original.id=NEW.original_offering_id
    WHERE p.id=NEW.payment_id AND p.workspace_id=NEW.workspace_id AND p.contact_id=NEW.contact_id
      AND p.source_conversation_id=NEW.conversation_id AND p.offering_id=NEW.original_offering_id
      AND p.status NOT IN ('paid','refunded') AND original.workspace_id=NEW.workspace_id
      AND (NEW.replacement_offering_id IS NULL OR EXISTS (SELECT 1 FROM public.offerings replacement
        WHERE replacement.id=NEW.replacement_offering_id AND replacement.workspace_id=NEW.workspace_id
          AND replacement.id<>NEW.original_offering_id))
      AND (
        (NEW.source_voice_selection_id IS NULL AND NEW.source_turn_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.messages m WHERE m.id=NEW.source_turn_id AND m.direction='inbound'
            AND m.conversation_id=NEW.conversation_id AND m.contact_id=NEW.contact_id))
        OR (NEW.source_turn_id IS NULL AND NEW.source_voice_selection_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.voice_course_selections e
          JOIN public.offerings replacement ON replacement.workspace_id=e.workspace_id AND replacement.code=e.selected_offering_code
          JOIN public.conversation_sales_context_states_v1 s ON s.workspace_id=e.workspace_id
            AND s.contact_id=e.contact_id AND s.conversation_id=e.conversation_id
          WHERE e.id=NEW.source_voice_selection_id AND e.workspace_id=NEW.workspace_id AND e.contact_id=NEW.contact_id
            AND e.conversation_id=NEW.conversation_id AND replacement.id=NEW.replacement_offering_id
            AND e.occurred_at>p.created_at AND s.version=e.expected_state_version
            AND s.selected_offering_code IS NOT DISTINCT FROM e.previous_offering_code))
      )
  ) THEN RAISE EXCEPTION 'Payment supersession identity mismatch'; END IF;
  RETURN NEW;
END $$;
