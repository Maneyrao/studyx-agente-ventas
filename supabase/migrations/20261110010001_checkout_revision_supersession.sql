-- Checkout revision (incident B, owner 2026-11-10): an unpaid, untouched
-- checkout of the SAME course and package may be replaced when the customer
-- changes the payment plan or corrects the registration e-mail. The old row,
-- its events and its bonus snapshot stay intact as evidence; the old reference
-- becomes superseded, so a late payment on it goes to the existing manual
-- reconciliation case and never enqueues a second enrollment.
--
-- Not strictly additive on purpose: the single-value CHECK on `reason`
-- (`payment_intent_supersessions_reason_check`) is replaced by a wider one.
-- Every existing row keeps satisfying it (they are all COURSE_CHANGED).

ALTER TABLE public.payment_intent_supersessions
  ADD COLUMN replacement_payment_id uuid UNIQUE
    REFERENCES public.payments(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.payment_intent_supersessions
  DROP CONSTRAINT payment_intent_supersessions_reason_check;
ALTER TABLE public.payment_intent_supersessions
  ADD CONSTRAINT payment_intent_supersessions_reason_check
    CHECK (reason IN ('COURSE_CHANGED','PLAN_CHANGED','CONTACT_DATA_CHANGED')),
  ADD CONSTRAINT payment_supersession_revision_shape CHECK (
    (reason='COURSE_CHANGED' AND replacement_payment_id IS NULL)
    OR (reason IN ('PLAN_CHANGED','CONTACT_DATA_CHANGED') AND replacement_payment_id IS NOT NULL
      AND replacement_payment_id<>payment_id AND source_turn_id IS NOT NULL
      AND replacement_offering_id IS NOT DISTINCT FROM original_offering_id));

CREATE OR REPLACE FUNCTION public.validate_payment_intent_supersession() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.reason IN ('PLAN_CHANGED','CONTACT_DATA_CHANGED') THEN
    -- Only a reservation nobody has opened in Stripe yet can be revised.
    IF NOT EXISTS (
      SELECT 1 FROM public.payments p
      JOIN public.messages m ON m.id=NEW.source_turn_id
      WHERE p.id=NEW.payment_id AND p.workspace_id=NEW.workspace_id AND p.contact_id=NEW.contact_id
        AND p.source_conversation_id=NEW.conversation_id AND p.offering_id=NEW.original_offering_id
        AND p.status='reserved' AND p.provider_session_id IS NULL AND p.paid_at IS NULL
        AND m.conversation_id=NEW.conversation_id AND m.contact_id=NEW.contact_id AND m.direction='inbound'
        AND NOT EXISTS (SELECT 1 FROM public.payment_reconciliation_cases c WHERE c.payment_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM public.payment_events e WHERE e.payment_id=p.id
          AND e.event_type IN ('checkout_completed_paid','async_payment_succeeded','checkout_completed_unpaid'))
        AND NOT EXISTS (SELECT 1 FROM public.payments paid WHERE paid.workspace_id=p.workspace_id
          AND paid.contact_id=p.contact_id AND paid.offering_id=p.offering_id AND paid.status='paid')
    ) THEN RAISE EXCEPTION 'Payment checkout revision identity mismatch'; END IF;
    RETURN NEW;
  END IF;
  -- COURSE_CHANGED: unchanged from 20261028010009.
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

-- At commit, the pair must be the same obligation with only the plan or the
-- registration e-mail changed, the exact same sealed gifts, and the package
-- (if any) pointing at the replacement.
CREATE FUNCTION public.validate_payment_checkout_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.payments p JOIN public.payments r ON r.id=NEW.replacement_payment_id
    WHERE p.id=NEW.payment_id AND r.id<>p.id
      AND r.workspace_id=p.workspace_id AND r.contact_id=p.contact_id
      AND r.source_conversation_id IS NOT DISTINCT FROM p.source_conversation_id AND r.offering_id=p.offering_id
      AND r.environment=p.environment AND r.provider=p.provider
      AND ROW(r.promotion_offer_id,r.promotion_cycle_id,r.accepted_offer_version)
        IS NOT DISTINCT FROM ROW(p.promotion_offer_id,p.promotion_cycle_id,p.accepted_offer_version)
      AND r.created_at>=p.created_at AND r.bonus_snapshot_sealed_at IS NOT NULL
      AND r.status='reserved' AND r.provider_session_id IS NULL
      AND ((NEW.reason='PLAN_CHANGED' AND r.plan_code IS DISTINCT FROM p.plan_code)
        OR (NEW.reason='CONTACT_DATA_CHANGED' AND r.plan_code IS NOT DISTINCT FROM p.plan_code
          AND r.registration_email IS DISTINCT FROM p.registration_email))
      AND NOT EXISTS (
        (SELECT offering_id,promotion_id,position FROM public.payment_bonus_offerings WHERE payment_id=p.id
         EXCEPT SELECT offering_id,promotion_id,position FROM public.payment_bonus_offerings WHERE payment_id=r.id)
        UNION ALL
        (SELECT offering_id,promotion_id,position FROM public.payment_bonus_offerings WHERE payment_id=r.id
         EXCEPT SELECT offering_id,promotion_id,position FROM public.payment_bonus_offerings WHERE payment_id=p.id))
      AND (p.promotion_offer_id IS NULL OR EXISTS (SELECT 1 FROM public.promotion_offers o
        WHERE o.id=p.promotion_offer_id AND o.status='attached' AND o.payment_id=r.id))
  ) THEN RAISE EXCEPTION 'Payment checkout revision pair mismatch'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER payment_checkout_revision_pair
  AFTER INSERT ON public.payment_intent_supersessions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.reason IN ('PLAN_CHANGED','CONTACT_DATA_CHANGED'))
  EXECUTE FUNCTION public.validate_payment_checkout_revision();
REVOKE ALL ON FUNCTION public.validate_payment_checkout_revision() FROM PUBLIC;

-- A replacement payment may carry an ATTACHED package only when a revision of
-- that package's current payment names this exact new row.
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
      AND o.package_mode='direct' AND o.bonus_snapshot_sealed_at IS NOT NULL
      AND (o.status='accepted' OR (o.status='attached' AND EXISTS (
        SELECT 1 FROM public.payment_intent_supersessions s WHERE s.payment_id=o.payment_id
          AND s.replacement_payment_id=NEW.id AND s.reason IN ('PLAN_CHANGED','CONTACT_DATA_CHANGED'))))
      AND (o.accepted_source_turn_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM public.promotion_voice_acceptances e WHERE e.offer_id=o.id
          AND e.promotion_cycle_id=o.promotion_cycle_id AND e.offer_version=o.offer_version))
  ) THEN RAISE EXCEPTION 'Payment accepted package identity mismatch'; END IF;
  RETURN NEW;
END $$;

-- Identical to 20261028010001 except one clause: an attached package may move
-- its payment_id only to the replacement named by a revision of its current one.
CREATE OR REPLACE FUNCTION public.guard_direct_bonus_offer()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE b public.promotion_offer_bonus_offerings;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.package_mode='direct' AND (NEW.offer_version<>0 OR NEW.status<>'pending_review' OR NEW.bonus_snapshot_sealed_at IS NOT NULL
      OR NEW.accepted_at IS NOT NULL OR NEW.payment_id IS NOT NULL) THEN RAISE EXCEPTION 'Direct cycle must start empty'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.package_mode IS DISTINCT FROM OLD.package_mode OR NEW.promotion_cycle_id IS DISTINCT FROM OLD.promotion_cycle_id THEN RAISE EXCEPTION 'Promotion cycle identity is immutable'; END IF;
  IF OLD.package_mode<>'direct' THEN RETURN NEW; END IF;
  IF NEW.workspace_id<>OLD.workspace_id OR NEW.contact_id<>OLD.contact_id OR NEW.conversation_id<>OLD.conversation_id
    OR NEW.promotion_id<>OLD.promotion_id OR NEW.paid_offering_id<>OLD.paid_offering_id THEN RAISE EXCEPTION 'Direct cycle identity is immutable'; END IF;
  IF OLD.status IN ('accepted','attached') AND (NEW.status NOT IN ('accepted','attached') OR NEW.offer_version<>OLD.offer_version
    OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at OR NEW.accepted_source_turn_id IS DISTINCT FROM OLD.accepted_source_turn_id
    OR NEW.bonus_snapshot_sealed_at IS DISTINCT FROM OLD.bonus_snapshot_sealed_at
    OR (OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id AND NOT (
      OLD.status='attached' AND NEW.status='attached' AND EXISTS (
        SELECT 1 FROM public.payment_intent_supersessions s WHERE s.payment_id=OLD.payment_id
          AND s.replacement_payment_id=NEW.payment_id AND s.reason IN ('PLAN_CHANGED','CONTACT_DATA_CHANGED'))))) THEN RAISE EXCEPTION 'Accepted direct obligations are immutable'; END IF;
  IF OLD.status IN ('cancelled','expired') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Closed direct cycle is immutable'; END IF;
  SELECT * INTO b FROM public.promotion_offer_bonus_offerings WHERE offer_id=OLD.id ORDER BY offer_version DESC LIMIT 1;
  IF NEW.offer_version IS DISTINCT FROM COALESCE(b.offer_version,0)
    OR (b.id IS NOT NULL AND (NEW.offered_outbound_message_id IS DISTINCT FROM b.offered_outbound_message_id OR NEW.offered_at IS DISTINCT FROM b.offered_at)) THEN
    RAISE EXCEPTION 'Direct bonus version metadata mismatch';
  END IF;
  IF NEW.status='accepted' AND OLD.status<>'accepted' THEN
    IF OLD.status<>'offered' OR b.id IS NULL OR NEW.accepted_at IS NULL OR NEW.bonus_snapshot_sealed_at IS NULL
      OR (OLD.expires_at IS NOT NULL AND OLD.expires_at<=now()) THEN RAISE EXCEPTION 'Direct acceptance requires an open delivered package'; END IF;
    PERFORM public.assert_direct_bonus_later_turn(OLD.id,NEW.accepted_source_turn_id);
  ELSIF OLD.status NOT IN ('accepted','attached') AND (NEW.bonus_snapshot_sealed_at IS NOT NULL OR NEW.accepted_at IS NOT NULL
    OR NEW.accepted_source_turn_id IS NOT NULL OR NEW.status='attached' OR NEW.payment_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Direct package seals only on acceptance';
  END IF;
  RETURN NEW;
END $$;
