-- Owner 2026-11-11: an unpaid link does not close negotiation. A valid
-- new gift retires the old reference and creates a successor package without
-- rewriting any old accepted promise or payment snapshot. Shared Stripe URLs
-- remain externally payable; late paid evidence follows reconciliation.
BEGIN;
ALTER TABLE public.payment_intent_supersessions
  DROP CONSTRAINT payment_intent_supersessions_reason_check,
  DROP CONSTRAINT payment_supersession_revision_shape;
ALTER TABLE public.payment_intent_supersessions
  ADD CONSTRAINT payment_intent_supersessions_reason_check
    CHECK (reason IN ('COURSE_CHANGED','PLAN_CHANGED','CONTACT_DATA_CHANGED','NEGOTIATION_REOPENED')),
  ADD CONSTRAINT payment_supersession_revision_shape CHECK (
    (reason='COURSE_CHANGED' AND replacement_payment_id IS NULL)
    OR (reason='NEGOTIATION_REOPENED' AND replacement_payment_id IS NULL AND source_turn_id IS NOT NULL
      AND replacement_offering_id IS NOT DISTINCT FROM original_offering_id)
    OR (reason IN ('PLAN_CHANGED','CONTACT_DATA_CHANGED') AND replacement_payment_id IS NOT NULL
      AND replacement_payment_id<>payment_id AND source_turn_id IS NOT NULL
      AND replacement_offering_id IS NOT DISTINCT FROM original_offering_id));
-- Inherited receipts may be the successor's latest receipt only inside the
-- transaction; its newly authored gift replaces that pointer before commit.
ALTER TABLE public.promotion_offers
  DROP CONSTRAINT promotion_offers_offered_outbound_message_id_key;
ALTER TABLE public.promotion_offers
  ADD CONSTRAINT promotion_offers_offered_outbound_message_id_key
    UNIQUE(offered_outbound_message_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.promotion_offers
  ADD COLUMN predecessor_offer_id uuid UNIQUE REFERENCES public.promotion_offers(id);
ALTER TABLE public.promotion_offer_bonus_offerings
  ADD COLUMN inherited_from_bonus_id uuid REFERENCES public.promotion_offer_bonus_offerings(id);

CREATE OR REPLACE FUNCTION public.validate_payment_intent_supersession() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN

  IF NEW.reason='NEGOTIATION_REOPENED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.payments p JOIN public.messages m ON m.id=NEW.source_turn_id
      WHERE p.id=NEW.payment_id AND p.workspace_id=NEW.workspace_id AND p.contact_id=NEW.contact_id
        AND p.source_conversation_id=NEW.conversation_id AND p.offering_id=NEW.original_offering_id
        AND p.status='reserved' AND p.provider_session_id IS NULL AND p.paid_at IS NULL
        AND NEW.replacement_offering_id=p.offering_id AND NEW.replacement_payment_id IS NULL
        AND m.conversation_id=NEW.conversation_id AND m.contact_id=NEW.contact_id AND m.direction='inbound'
        AND NOT EXISTS (SELECT 1 FROM public.payment_events e WHERE e.payment_id=p.id
          AND e.event_type IN ('checkout_completed_paid','async_payment_succeeded','checkout_completed_unpaid'))
        AND NOT EXISTS (SELECT 1 FROM public.payments other
          WHERE other.workspace_id=p.workspace_id AND other.contact_id=p.contact_id
            AND other.source_conversation_id=p.source_conversation_id AND other.offering_id=p.offering_id
            AND (other.status='paid' OR EXISTS (
              SELECT 1 FROM public.payment_reconciliation_cases c WHERE c.payment_id=other.id AND c.status='open')))
    ) THEN RAISE EXCEPTION 'Payment negotiation reopening identity mismatch'; END IF;
    RETURN NEW;
  END IF;
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

CREATE OR REPLACE FUNCTION public.guard_direct_bonus_offer()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE b public.promotion_offer_bonus_offerings;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.package_mode='direct' AND (NEW.offer_version<>0 OR NEW.status<>'pending_review' OR NEW.bonus_snapshot_sealed_at IS NOT NULL
      OR NEW.accepted_at IS NOT NULL OR NEW.payment_id IS NOT NULL) THEN RAISE EXCEPTION 'Direct cycle must start empty'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.predecessor_offer_id IS DISTINCT FROM OLD.predecessor_offer_id THEN RAISE EXCEPTION 'Promotion predecessor is immutable'; END IF;
  IF NEW.package_mode IS DISTINCT FROM OLD.package_mode OR NEW.promotion_cycle_id IS DISTINCT FROM OLD.promotion_cycle_id THEN RAISE EXCEPTION 'Promotion cycle identity is immutable'; END IF;
  IF OLD.package_mode<>'direct' THEN RETURN NEW; END IF;
  IF NEW.workspace_id<>OLD.workspace_id OR NEW.contact_id<>OLD.contact_id OR NEW.conversation_id<>OLD.conversation_id
    OR NEW.promotion_id<>OLD.promotion_id OR NEW.paid_offering_id<>OLD.paid_offering_id THEN RAISE EXCEPTION 'Direct cycle identity is immutable'; END IF;
  IF OLD.status IN ('accepted','attached') AND NEW.status='cancelled' THEN
    IF NEW.cancel_reason NOT IN ('CUSTOMER_CHANGED_COURSE','NEGOTIATION_REOPENED')
      OR NEW.offer_version<>OLD.offer_version
      OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
      OR NEW.accepted_source_turn_id IS DISTINCT FROM OLD.accepted_source_turn_id
      OR NEW.bonus_snapshot_sealed_at IS DISTINCT FROM OLD.bonus_snapshot_sealed_at
      OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
      OR NEW.offered_at IS DISTINCT FROM OLD.offered_at
      OR NEW.offered_outbound_message_id IS DISTINCT FROM OLD.offered_outbound_message_id
      OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
      OR OLD.payment_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.payment_intent_supersessions s JOIN public.payments p ON p.id=s.payment_id
        WHERE s.payment_id=OLD.payment_id AND s.reason=CASE NEW.cancel_reason WHEN 'NEGOTIATION_REOPENED' THEN 'NEGOTIATION_REOPENED' ELSE 'COURSE_CHANGED' END AND p.status NOT IN ('paid','refunded'))
    THEN RAISE EXCEPTION 'Accepted direct obligations are immutable'; END IF;
    RETURN NEW;
  END IF;
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

CREATE OR REPLACE FUNCTION public.enforce_promotion_offer_bonus_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE o public.promotion_offers; p public.promotions; c public.offerings; m public.messages; t public.messages; inherited public.promotion_offer_bonus_offerings; ancestor public.promotion_offers;
BEGIN

  -- A successor inherits exact, already delivered promises. These are not new
  -- customer turns or deliveries; every original row remains immutable.
  IF NEW.inherited_from_bonus_id IS NOT NULL THEN
    SELECT * INTO o FROM public.promotion_offers WHERE id=NEW.offer_id FOR UPDATE;
    SELECT * INTO inherited FROM public.promotion_offer_bonus_offerings WHERE id=NEW.inherited_from_bonus_id;
    SELECT * INTO ancestor FROM public.promotion_offers WHERE id=o.predecessor_offer_id;
    IF o.package_mode<>'direct' OR o.status NOT IN ('pending_review','offered') OR o.bonus_snapshot_sealed_at IS NOT NULL
      OR o.payment_id IS NOT NULL OR ancestor.id IS NULL OR ancestor.status<>'cancelled'
      OR ancestor.cancel_reason<>'NEGOTIATION_REOPENED' OR inherited.offer_id<>ancestor.id
      OR ROW(o.workspace_id,o.contact_id,o.conversation_id,o.paid_offering_id,o.promotion_id)
        IS DISTINCT FROM ROW(ancestor.workspace_id,ancestor.contact_id,ancestor.conversation_id,ancestor.paid_offering_id,ancestor.promotion_id)
      OR NOT EXISTS (SELECT 1 FROM public.payment_intent_supersessions s
        WHERE s.payment_id=ancestor.payment_id AND s.reason='NEGOTIATION_REOPENED')
      OR NEW.offer_version<>o.offer_version+1 OR NEW.position<>NEW.offer_version OR NEW.position>3
      OR ROW(NEW.promotion_id,NEW.offering_id,NEW.promotion_code_snapshot,NEW.offering_code_snapshot,
          NEW.offering_display_name_snapshot,NEW.position,NEW.source_turn_id,NEW.offered_at,
          NEW.offered_outbound_message_id,NEW.delivered_at,NEW.offer_version)
        IS DISTINCT FROM ROW(inherited.promotion_id,inherited.offering_id,inherited.promotion_code_snapshot,
          inherited.offering_code_snapshot,inherited.offering_display_name_snapshot,inherited.position,
          inherited.source_turn_id,inherited.offered_at,inherited.offered_outbound_message_id,inherited.delivered_at,inherited.offer_version)
      OR inherited.delivered_at IS NULL OR NOT EXISTS (SELECT 1 FROM public.outbound_deliveries d
        WHERE d.message_id=inherited.offered_outbound_message_id AND d.state='delivered' AND d.delivered_at=inherited.delivered_at)
    THEN RAISE EXCEPTION 'Inherited direct bonus identity mismatch'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO o FROM public.promotion_offers WHERE id=NEW.offer_id FOR UPDATE;
  SELECT * INTO p FROM public.promotions WHERE id=NEW.promotion_id;
  SELECT * INTO c FROM public.offerings WHERE id=NEW.offering_id;
  IF o.bonus_snapshot_sealed_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Promotion offer bonus snapshot is sealed'; END IF;
  IF o.id IS NULL OR o.promotion_id IS DISTINCT FROM NEW.promotion_id OR o.workspace_id IS DISTINCT FROM p.workspace_id
    OR c.workspace_id IS DISTINCT FROM o.workspace_id OR NEW.promotion_code_snapshot IS DISTINCT FROM p.promotion_code
    OR NEW.offering_code_snapshot IS DISTINCT FROM c.code OR NEW.offering_display_name_snapshot IS DISTINCT FROM c.display_name THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Promotion offer bonus snapshot identity mismatch';
  END IF;
  IF o.package_mode='review' THEN
    IF NOT EXISTS (SELECT 1 FROM public.promotion_bonus_offerings configured WHERE configured.promotion_id=NEW.promotion_id
      AND configured.offering_id=NEW.offering_id AND configured.position=NEW.position) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Promotion offer bonus snapshot identity mismatch';
    END IF;
    RETURN NEW;
  END IF;
  IF o.status NOT IN ('pending_review','offered') OR o.payment_id IS NOT NULL OR (o.expires_at IS NOT NULL AND o.expires_at<=now()) THEN
    RAISE EXCEPTION 'Direct bonus cycle is closed';
  END IF;
  IF NEW.offer_version<>o.offer_version+1 THEN RAISE EXCEPTION 'Direct bonus version mismatch'; END IF;
  IF o.offer_version>=3 THEN RAISE EXCEPTION 'Direct bonus course limit reached'; END IF;
  IF NEW.position<>NEW.offer_version THEN RAISE EXCEPTION 'Direct bonus position must match version'; END IF;
  IF c.id=o.paid_offering_id OR c.offering_type<>'course' OR c.status<>'active' THEN RAISE EXCEPTION 'Invalid direct bonus course'; END IF;
  IF EXISTS (SELECT 1 FROM public.promotion_offer_bonus_offerings WHERE offer_id=o.id AND offering_id=c.id) THEN RAISE EXCEPTION 'Duplicate direct bonus course'; END IF;
  IF o.offer_version>0 THEN PERFORM public.assert_direct_bonus_later_turn(o.id,NEW.source_turn_id); END IF;
  -- Require and serialize with the durable channel transaction; otherwise the
  -- receipt trigger and append can each miss the other's uncommitted row.
  PERFORM 1 FROM public.outbound_deliveries WHERE message_id=NEW.offered_outbound_message_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Durable channel delivery row required'; END IF;
  SELECT * INTO t FROM public.messages WHERE id=NEW.source_turn_id FOR NO KEY UPDATE;
  IF EXISTS (SELECT 1 FROM public.promotion_offer_bonus_offerings prior
    JOIN public.promotion_offers cycle ON cycle.id=prior.offer_id
    WHERE prior.source_turn_id=NEW.source_turn_id AND cycle.package_mode='direct') THEN
    RAISE EXCEPTION 'Customer turn already used for a direct bonus';
  END IF;
  SELECT * INTO m FROM public.messages WHERE id=NEW.offered_outbound_message_id;
  IF t.id IS NULL OR t.direction<>'inbound' OR t.conversation_id<>o.conversation_id OR t.contact_id<>o.contact_id
    OR m.id IS NULL OR m.direction<>'outbound' OR m.conversation_id<>o.conversation_id OR m.contact_id<>o.contact_id
    OR m.in_reply_to IS DISTINCT FROM t.id OR m.created_at<t.created_at OR NEW.offered_at IS DISTINCT FROM m.created_at
    OR NEW.delivered_at IS NOT NULL THEN RAISE EXCEPTION 'Direct bonus turn/outbound identity mismatch'; END IF;
  RETURN NEW;
END $$;

-- A transaction cannot commit a partial inheritance or silently reset the cap.
CREATE FUNCTION public.validate_negotiation_successor() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE child public.promotion_offers; parent public.promotion_offers;
BEGIN
  SELECT * INTO child FROM public.promotion_offers WHERE id=NEW.id;
  IF child.predecessor_offer_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO parent FROM public.promotion_offers WHERE id=child.predecessor_offer_id;
  IF parent.status<>'cancelled' OR parent.cancel_reason<>'NEGOTIATION_REOPENED'
    OR ROW(child.workspace_id,child.contact_id,child.conversation_id,child.paid_offering_id,child.promotion_id)
      IS DISTINCT FROM ROW(parent.workspace_id,parent.contact_id,parent.conversation_id,parent.paid_offering_id,parent.promotion_id)
    OR child.offer_version<>parent.offer_version+1
    OR (SELECT count(*) FROM public.promotion_offer_bonus_offerings b
      WHERE b.offer_id=child.id AND b.inherited_from_bonus_id IS NOT NULL)<>parent.offer_version
    OR (SELECT count(*) FROM public.promotion_offer_bonus_offerings b
      WHERE b.offer_id=child.id AND b.inherited_from_bonus_id IS NULL)<>1
    OR EXISTS(SELECT 1 FROM public.promotion_offer_bonus_offerings original WHERE original.offer_id=parent.id
      AND NOT EXISTS(SELECT 1 FROM public.promotion_offer_bonus_offerings copy
        WHERE copy.offer_id=child.id AND copy.inherited_from_bonus_id=original.id))
  THEN RAISE EXCEPTION 'Negotiation successor package is incomplete'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER negotiation_successor_complete
  AFTER INSERT ON public.promotion_offers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.predecessor_offer_id IS NOT NULL) EXECUTE FUNCTION public.validate_negotiation_successor();
REVOKE ALL ON FUNCTION public.validate_negotiation_successor() FROM PUBLIC;
COMMIT;
