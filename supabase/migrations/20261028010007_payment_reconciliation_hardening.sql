-- Supabase default privileges also affect newly created tables. RLS does not
-- protect TRUNCATE, and service_role bypasses RLS: remove every inherited ACL.
REVOKE ALL ON public.payment_intent_supersessions, public.payment_reconciliation_cases FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','orchestrator_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON public.payment_intent_supersessions, public.payment_reconciliation_cases FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT,INSERT ON public.payment_intent_supersessions, public.payment_reconciliation_cases TO orchestrator_role;

-- A trusted paid event can arrive after failed/expired/refunded. Keep the
-- canonical reducer terminal, but retain that conflicting paid evidence for
-- an operator. The exact provider event, payment and supersession must agree.
CREATE OR REPLACE FUNCTION public.validate_payment_reconciliation_case() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='UPDATE' AND (OLD.status='resolved' OR ROW(NEW.id,NEW.payment_id,NEW.supersession_id,NEW.payment_event_id,NEW.case_type,NEW.opened_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.payment_id,OLD.supersession_id,OLD.payment_event_id,OLD.case_type,OLD.opened_at)) THEN
    RAISE EXCEPTION 'Payment reconciliation evidence is immutable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payments p
    JOIN public.payment_intent_supersessions s ON s.payment_id=p.id AND s.id=NEW.supersession_id
    JOIN public.payment_events e ON e.payment_id=p.id AND e.id=NEW.payment_event_id
    WHERE p.id=NEW.payment_id AND e.provider='stripe'
      AND e.event_type IN ('checkout_completed_paid','async_payment_succeeded')) THEN
    RAISE EXCEPTION 'Payment reconciliation evidence mismatch';
  END IF;
  RETURN NEW;
END $$;
