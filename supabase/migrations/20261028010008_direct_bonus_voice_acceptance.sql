-- Authenticated voice tools persist acceptance separately from chat messages.
CREATE TABLE public.promotion_voice_acceptances (
  offer_id uuid PRIMARY KEY REFERENCES public.promotion_offers(id),
  call_id uuid NOT NULL REFERENCES public.call_sessions(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  contact_id uuid NOT NULL REFERENCES public.contacts(id),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id),
  promotion_cycle_id uuid NOT NULL,
  offer_version integer NOT NULL CHECK (offer_version BETWEEN 1 AND 3),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.promotion_voice_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promotion_voice_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.promotion_voice_acceptances TO service_role;
GRANT SELECT, INSERT ON public.promotion_voice_acceptances TO orchestrator_role;
CREATE POLICY orchestrator_access ON public.promotion_voice_acceptances FOR ALL
  TO orchestrator_role USING(true) WITH CHECK(true);

CREATE FUNCTION public.guard_direct_bonus_voice_acceptance()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE o public.promotion_offers; b public.promotion_offer_bonus_offerings;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Voice acceptance evidence is immutable'; END IF;
  SELECT * INTO o FROM public.promotion_offers WHERE id=NEW.offer_id FOR UPDATE;
  IF o.id IS NULL OR o.package_mode<>'direct' OR o.status<>'offered'
    OR o.workspace_id<>NEW.workspace_id OR o.contact_id<>NEW.contact_id
    OR o.conversation_id<>NEW.conversation_id OR o.promotion_cycle_id<>NEW.promotion_cycle_id
    OR o.offer_version<>NEW.offer_version THEN RAISE EXCEPTION 'Direct bonus version mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.call_sessions c WHERE c.id=NEW.call_id
    AND c.workspace_id=NEW.workspace_id AND c.contact_id=NEW.contact_id AND c.conversation_id=NEW.conversation_id
    AND c.provider='retell' AND c.provider_call_id IS NOT NULL AND c.status IN ('provider_accepted','in_progress')) THEN
    RAISE EXCEPTION 'Distinct correlated customer turn required';
  END IF;
  SELECT * INTO b FROM public.promotion_offer_bonus_offerings WHERE offer_id=o.id AND offer_version=o.offer_version;
  NEW.accepted_at=clock_timestamp();
  IF b.delivered_at IS NULL OR b.delivered_at>=NEW.accepted_at OR NOT EXISTS (
    SELECT 1 FROM public.outbound_deliveries d WHERE d.message_id=b.offered_outbound_message_id
      AND d.conversation_id=o.conversation_id AND d.contact_id=o.contact_id
      AND d.state='delivered' AND d.delivered_at=b.delivered_at) THEN RAISE EXCEPTION 'Confirmed prior delivery required'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER promotion_voice_acceptances_guard BEFORE INSERT OR UPDATE OR DELETE ON public.promotion_voice_acceptances
FOR EACH ROW EXECUTE FUNCTION public.guard_direct_bonus_voice_acceptance();

-- Preserve all chat evidence checks. A NULL chat source is valid only with
-- the exact immutable voice record created by the trusted service above.
ALTER FUNCTION public.assert_direct_bonus_later_turn(uuid,uuid) RENAME TO assert_direct_bonus_later_text_turn;
CREATE FUNCTION public.assert_direct_bonus_later_turn(p_offer_id uuid,p_turn_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_turn_id IS NOT NULL THEN
    PERFORM public.assert_direct_bonus_later_text_turn(p_offer_id,p_turn_id);
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.promotion_voice_acceptances e JOIN public.promotion_offers o ON o.id=e.offer_id
    JOIN public.promotion_offer_bonus_offerings b ON b.offer_id=o.id AND b.offer_version=o.offer_version
    JOIN public.outbound_deliveries d ON d.message_id=b.offered_outbound_message_id
    WHERE o.id=p_offer_id AND e.workspace_id=o.workspace_id AND e.contact_id=o.contact_id
      AND e.conversation_id=o.conversation_id AND e.promotion_cycle_id=o.promotion_cycle_id
      AND e.offer_version=o.offer_version AND e.accepted_at>b.delivered_at
      AND d.state='delivered' AND d.delivered_at=b.delivered_at
  ) THEN RAISE EXCEPTION 'Distinct correlated customer turn required';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.guard_direct_bonus_voice_acceptance(),public.assert_direct_bonus_later_turn(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assert_direct_bonus_later_turn(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_direct_bonus_later_turn(uuid,uuid) TO orchestrator_role;

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
      AND o.package_mode='direct' AND o.status='accepted' AND o.bonus_snapshot_sealed_at IS NOT NULL
      AND (o.accepted_source_turn_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM public.promotion_voice_acceptances e WHERE e.offer_id=o.id
          AND e.promotion_cycle_id=o.promotion_cycle_id AND e.offer_version=o.offer_version))
  ) THEN RAISE EXCEPTION 'Payment accepted package identity mismatch'; END IF;
  RETURN NEW;
END $$;
