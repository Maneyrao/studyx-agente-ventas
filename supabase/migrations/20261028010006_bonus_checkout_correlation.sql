-- Direct checkout stores the exact sealed obligation; course changes never
-- rewrite a signed payment reference or a previously accepted package.
ALTER TABLE public.payments
  ADD COLUMN promotion_offer_id uuid REFERENCES public.promotion_offers(id),
  ADD COLUMN promotion_cycle_id uuid REFERENCES public.promotion_offers(promotion_cycle_id),
  ADD COLUMN accepted_offer_version integer,
  ADD CONSTRAINT payments_direct_package_shape CHECK (
    (promotion_offer_id IS NULL AND promotion_cycle_id IS NULL AND accepted_offer_version IS NULL)
    OR (promotion_offer_id IS NOT NULL AND promotion_cycle_id IS NOT NULL AND accepted_offer_version IS NOT NULL AND accepted_offer_version > 0));

CREATE OR REPLACE FUNCTION public.enforce_payment_direct_package() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.promotion_offer_id,NEW.promotion_cycle_id,NEW.accepted_offer_version)
      IS DISTINCT FROM ROW(OLD.promotion_offer_id,OLD.promotion_cycle_id,OLD.accepted_offer_version)
      OR (OLD.promotion_offer_id IS NOT NULL AND NEW.source_conversation_id IS DISTINCT FROM OLD.source_conversation_id) THEN
      RAISE EXCEPTION 'Payment accepted package is immutable';
    END IF;
  ELSIF NEW.promotion_offer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.promotion_offers o WHERE o.id=NEW.promotion_offer_id
      AND o.promotion_cycle_id=NEW.promotion_cycle_id AND o.offer_version=NEW.accepted_offer_version
      AND o.workspace_id=NEW.workspace_id AND o.contact_id=NEW.contact_id
      AND o.conversation_id=NEW.source_conversation_id AND o.paid_offering_id=NEW.offering_id
      AND o.package_mode='direct' AND o.status='accepted'
      AND o.accepted_source_turn_id IS NOT NULL AND o.bonus_snapshot_sealed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Payment accepted package identity mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_direct_package_identity BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_direct_package();

CREATE TABLE public.payment_intent_supersessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  contact_id uuid NOT NULL REFERENCES public.contacts(id),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id),
  original_offering_id uuid NOT NULL REFERENCES public.offerings(id),
  replacement_offering_id uuid REFERENCES public.offerings(id),
  source_turn_id uuid NOT NULL REFERENCES public.messages(id),
  reason text NOT NULL DEFAULT 'COURSE_CHANGED' CHECK(reason='COURSE_CHANGED'),
  superseded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.payment_reconciliation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id),
  supersession_id uuid NOT NULL REFERENCES public.payment_intent_supersessions(id),
  payment_event_id uuid NOT NULL REFERENCES public.payment_events(id),
  case_type text NOT NULL DEFAULT 'SUPERSEDED_PAYMENT_PAID' CHECK(case_type='SUPERSEDED_PAYMENT_PAID'),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text,
  CHECK ((status='open' AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_note IS NULL)
    OR (status='resolved' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_note IS NOT NULL
      AND length(trim(resolved_by))>0 AND length(trim(resolution_note))>0))
);
CREATE FUNCTION public.validate_payment_intent_supersession() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.payments p JOIN public.messages m ON m.id=NEW.source_turn_id
    JOIN public.offerings original ON original.id=NEW.original_offering_id
    WHERE p.id=NEW.payment_id AND p.workspace_id=NEW.workspace_id AND p.contact_id=NEW.contact_id
      AND p.source_conversation_id=NEW.conversation_id AND p.offering_id=NEW.original_offering_id
      AND p.status NOT IN ('paid','refunded') AND original.workspace_id=NEW.workspace_id
      AND m.conversation_id=NEW.conversation_id AND m.contact_id=NEW.contact_id AND m.direction='inbound'
      AND (NEW.replacement_offering_id IS NULL OR EXISTS (SELECT 1 FROM public.offerings replacement
        WHERE replacement.id=NEW.replacement_offering_id AND replacement.workspace_id=NEW.workspace_id
          AND replacement.id<>NEW.original_offering_id))) THEN
    RAISE EXCEPTION 'Payment supersession identity mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_intent_supersession_identity BEFORE INSERT ON public.payment_intent_supersessions
FOR EACH ROW EXECUTE FUNCTION public.validate_payment_intent_supersession();
CREATE TRIGGER payment_intent_supersessions_append_only BEFORE UPDATE OR DELETE ON public.payment_intent_supersessions
FOR EACH ROW EXECUTE FUNCTION public.payment_events_append_only();
CREATE FUNCTION public.validate_payment_reconciliation_case() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='UPDATE' AND (OLD.status='resolved' OR ROW(NEW.id,NEW.payment_id,NEW.supersession_id,NEW.payment_event_id,NEW.case_type,NEW.opened_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.payment_id,OLD.supersession_id,OLD.payment_event_id,OLD.case_type,OLD.opened_at)) THEN
    RAISE EXCEPTION 'Payment reconciliation evidence is immutable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payments p
    JOIN public.payment_intent_supersessions s ON s.payment_id=p.id AND s.id=NEW.supersession_id
    JOIN public.payment_events e ON e.payment_id=p.id AND e.id=NEW.payment_event_id
    WHERE p.id=NEW.payment_id AND p.status IN ('paid','refunded')
      AND e.event_type IN ('checkout_completed_paid','async_payment_succeeded')) THEN
    RAISE EXCEPTION 'Payment reconciliation evidence mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_reconciliation_case_identity BEFORE INSERT OR UPDATE ON public.payment_reconciliation_cases
FOR EACH ROW EXECUTE FUNCTION public.validate_payment_reconciliation_case();
CREATE TRIGGER payment_reconciliation_cases_no_delete BEFORE DELETE ON public.payment_reconciliation_cases
FOR EACH ROW EXECUTE FUNCTION public.payment_events_append_only();
ALTER TABLE public.payment_intent_supersessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_reconciliation_cases ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.payment_intent_supersessions,public.payment_reconciliation_cases TO orchestrator_role;
CREATE POLICY orchestrator_access ON public.payment_intent_supersessions FOR ALL TO orchestrator_role USING(true) WITH CHECK(true);
CREATE POLICY orchestrator_access ON public.payment_reconciliation_cases FOR ALL TO orchestrator_role USING(true) WITH CHECK(true);
-- Resolution remains an operator action; the application has no UPDATE/DELETE grant.
