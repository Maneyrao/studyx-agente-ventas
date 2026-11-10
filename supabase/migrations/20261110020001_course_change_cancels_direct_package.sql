-- Owner 2026-11-10 (Fotografía → Plomería): an explicit course change closes
-- the previous course's direct package too. Before this, an accepted or
-- attached package survived the switch, so the conversation kept an active
-- promotion for a course the customer no longer buys.
--
-- The only new transition is accepted|attached → cancelled with
-- cancel_reason='CUSTOMER_CHANGED_COURSE', and only when the package's
-- payment was superseded by a COURSE_CHANGED row (written in the same
-- transaction) and is not paid. An accepted package without a checkout keeps
-- surviving a course detour (earlier owner decision).
-- Every other column stays frozen, so the row remains as audit evidence.
-- Body = 20261110010001 (checkout revision move) + the cancel branch below.
BEGIN;

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
  IF OLD.status IN ('accepted','attached') AND NEW.status='cancelled' THEN
    IF NEW.cancel_reason IS DISTINCT FROM 'CUSTOMER_CHANGED_COURSE'
      OR NEW.offer_version<>OLD.offer_version
      OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
      OR NEW.accepted_source_turn_id IS DISTINCT FROM OLD.accepted_source_turn_id
      OR NEW.bonus_snapshot_sealed_at IS DISTINCT FROM OLD.bonus_snapshot_sealed_at
      OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
      OR OLD.payment_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.payment_intent_supersessions s JOIN public.payments p ON p.id=s.payment_id
        WHERE s.payment_id=OLD.payment_id AND s.reason='COURSE_CHANGED' AND p.status NOT IN ('paid','refunded'))
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

COMMIT;
