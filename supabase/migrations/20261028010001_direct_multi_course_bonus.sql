-- Review packages keep their existing service flow. Direct packages accumulate
-- one immutable promise per version and seal only on correlated acceptance.
ALTER TABLE public.promotion_offers
  ADD COLUMN package_mode text NOT NULL DEFAULT 'review' CHECK (package_mode IN ('review','direct')),
  ADD COLUMN promotion_cycle_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  ADD COLUMN offer_version integer NOT NULL DEFAULT 0 CHECK (offer_version >= 0),
  ADD COLUMN accepted_source_turn_id uuid REFERENCES public.messages(id),
  ADD COLUMN delivery_reconciliation_required boolean NOT NULL DEFAULT false;

ALTER TABLE public.promotion_offer_bonus_offerings
  ADD COLUMN source_turn_id uuid REFERENCES public.messages(id),
  ADD COLUMN offered_at timestamptz,
  ADD COLUMN offered_outbound_message_id uuid REFERENCES public.messages(id),
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN offer_version integer NOT NULL DEFAULT 1 CHECK (offer_version > 0);

-- Preserve every legacy promise and obligation. Only real delivery receipts
-- count; voice exposure and channel submission are ambiguous, so quarantine
-- those packages for reconciliation without changing their status or gifts.
ALTER TABLE public.promotion_offer_bonus_offerings DISABLE TRIGGER promotion_offer_bonus_offerings_block_mutation;
UPDATE public.promotion_offer_bonus_offerings b
SET source_turn_id = CASE WHEN EXISTS (SELECT 1 FROM public.messages m WHERE m.id=o.source_turn_id) THEN o.source_turn_id END,
    offered_at = o.offered_at,
    offered_outbound_message_id = o.offered_outbound_message_id,
    delivered_at = (SELECT d.delivered_at FROM public.outbound_deliveries d
      WHERE d.message_id=o.offered_outbound_message_id AND d.state='delivered'
        AND d.conversation_id=o.conversation_id AND d.contact_id=o.contact_id)
FROM public.promotion_offers o WHERE o.id=b.offer_id;
ALTER TABLE public.promotion_offer_bonus_offerings ENABLE TRIGGER promotion_offer_bonus_offerings_block_mutation;
UPDATE public.promotion_offers o SET
  offer_version = 1,
  bonus_snapshot_sealed_at = COALESCE(o.bonus_snapshot_sealed_at,o.accepted_at,o.offered_at,o.created_at),
  delivery_reconciliation_required = NOT EXISTS (SELECT 1 FROM public.promotion_offer_bonus_offerings b WHERE b.offer_id=o.id) OR NOT EXISTS (
    SELECT 1 FROM public.outbound_deliveries d WHERE d.message_id=o.offered_outbound_message_id
      AND d.state='delivered' AND d.delivered_at IS NOT NULL
      AND d.conversation_id=o.conversation_id AND d.contact_id=o.contact_id)
WHERE o.status IN ('offered','accepted','attached');

-- Legacy reviews may promise several gifts in the same turn/version. Direct
-- turn uniqueness is enforced under a source-message lock by the insert guard.
CREATE INDEX promotion_offer_bonus_source_turn_idx ON public.promotion_offer_bonus_offerings(source_turn_id)
  WHERE source_turn_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assert_direct_bonus_later_turn(p_offer_id uuid,p_turn_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE o public.promotion_offers; b public.promotion_offer_bonus_offerings; t public.messages;
BEGIN
  SELECT * INTO o FROM public.promotion_offers WHERE id=p_offer_id;
  SELECT * INTO b FROM public.promotion_offer_bonus_offerings WHERE offer_id=p_offer_id ORDER BY offer_version DESC,position DESC LIMIT 1;
  IF b.delivered_at IS NULL OR NOT EXISTS (SELECT 1 FROM public.outbound_deliveries d
    WHERE d.message_id=b.offered_outbound_message_id AND d.state='delivered' AND d.delivered_at=b.delivered_at) THEN
    RAISE EXCEPTION 'Confirmed prior delivery required';
  END IF;
  SELECT * INTO t FROM public.messages WHERE id=p_turn_id;
  IF t.id IS NULL OR t.direction<>'inbound' OR t.conversation_id<>o.conversation_id OR t.contact_id<>o.contact_id
    OR EXISTS (SELECT 1 FROM public.promotion_offer_bonus_offerings WHERE offer_id=p_offer_id AND source_turn_id=p_turn_id) THEN
    RAISE EXCEPTION 'Distinct correlated customer turn required';
  END IF;
  IF t.created_at <= b.delivered_at THEN RAISE EXCEPTION 'Customer turn must be later than confirmed delivery'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_promotion_offer_bonus_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE o public.promotion_offers; p public.promotions; c public.offerings; m public.messages; t public.messages;
BEGIN
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
    OR (OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id)) THEN RAISE EXCEPTION 'Accepted direct obligations are immutable'; END IF;
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
CREATE TRIGGER promotion_offers_direct_guard BEFORE INSERT OR UPDATE ON public.promotion_offers
FOR EACH ROW EXECUTE FUNCTION public.guard_direct_bonus_offer();

CREATE OR REPLACE FUNCTION public.advance_direct_bonus_version()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  UPDATE public.promotion_offers SET offer_version=NEW.offer_version,status='offered',offered_at=NEW.offered_at,
    offered_outbound_message_id=NEW.offered_outbound_message_id WHERE id=NEW.offer_id AND package_mode='direct';
  RETURN NEW;
END $$;
CREATE TRIGGER promotion_offer_bonus_advance_version AFTER INSERT ON public.promotion_offer_bonus_offerings
FOR EACH ROW EXECUTE FUNCTION public.advance_direct_bonus_version();

-- A receipt is a one-time enrichment of an immutable promise, never a rewrite.
CREATE OR REPLACE FUNCTION public.course_bonus_offer_snapshot_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.delivered_at IS NULL AND NEW.delivered_at IS NOT NULL
    AND (to_jsonb(OLD)-'delivered_at')=(to_jsonb(NEW)-'delivered_at') AND EXISTS (
      SELECT 1 FROM public.outbound_deliveries d WHERE d.message_id=OLD.offered_outbound_message_id
        AND d.state='delivered' AND d.delivered_at=NEW.delivered_at AND d.delivered_at>=OLD.offered_at) THEN RETURN NEW; END IF;
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Promotion offer bonus snapshots are immutable';
END $$;
CREATE OR REPLACE FUNCTION public.confirm_direct_bonus_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.state='delivered' AND NEW.delivered_at IS NOT NULL THEN
    UPDATE public.promotion_offer_bonus_offerings SET delivered_at=NEW.delivered_at
    WHERE offered_outbound_message_id=NEW.message_id AND delivered_at IS NULL AND offered_at<=NEW.delivered_at;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbound_delivery_confirm_bonus AFTER INSERT OR UPDATE ON public.outbound_deliveries
FOR EACH ROW EXECUTE FUNCTION public.confirm_direct_bonus_delivery();

CREATE OR REPLACE FUNCTION public.append_direct_course_bonus(p_offer_id uuid,p_offering_id uuid,p_source_turn_id uuid,p_outbound_id uuid,p_expected_offer_version integer)
RETURNS integer LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE o public.promotion_offers; p public.promotions; c public.offerings; m public.messages;
BEGIN
  SELECT * INTO o FROM public.promotion_offers WHERE id=p_offer_id FOR UPDATE;
  IF o.id IS NULL OR o.package_mode<>'direct' THEN RAISE EXCEPTION 'Direct bonus offer required'; END IF;
  IF p_expected_offer_version IS DISTINCT FROM o.offer_version THEN RAISE EXCEPTION 'Direct bonus version mismatch'; END IF;
  SELECT * INTO p FROM public.promotions WHERE id=o.promotion_id;
  SELECT * INTO c FROM public.offerings WHERE id=p_offering_id;
  SELECT * INTO m FROM public.messages WHERE id=p_outbound_id;
  INSERT INTO public.promotion_offer_bonus_offerings(offer_id,promotion_id,offering_id,promotion_code_snapshot,
    offering_code_snapshot,offering_display_name_snapshot,position,source_turn_id,offered_at,offered_outbound_message_id,offer_version)
  VALUES(o.id,p.id,c.id,p.promotion_code,c.code,c.display_name,o.offer_version+1,p_source_turn_id,m.created_at,p_outbound_id,o.offer_version+1);
  -- Also capture a receipt which preceded the append transaction.
  UPDATE public.promotion_offer_bonus_offerings b SET delivered_at=d.delivered_at FROM public.outbound_deliveries d
  WHERE b.offer_id=o.id AND b.offer_version=o.offer_version+1 AND d.message_id=p_outbound_id
    AND d.state='delivered' AND d.delivered_at>=b.offered_at AND b.delivered_at IS NULL;
  RETURN o.offer_version+1;
END $$;

CREATE OR REPLACE FUNCTION public.accept_direct_course_bonus(p_offer_id uuid,p_inbound_id uuid,p_expected_offer_version integer)
RETURNS integer LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE o public.promotion_offers;
BEGIN
  SELECT * INTO o FROM public.promotion_offers WHERE id=p_offer_id FOR UPDATE;
  IF o.id IS NULL OR o.package_mode<>'direct' THEN RAISE EXCEPTION 'Direct bonus offer required'; END IF;
  IF p_expected_offer_version IS DISTINCT FROM o.offer_version THEN RAISE EXCEPTION 'Direct bonus version mismatch'; END IF;
  IF o.status<>'offered' THEN RAISE EXCEPTION 'Direct bonus cycle is closed or sealed'; END IF;
  PERFORM public.assert_direct_bonus_later_turn(o.id,p_inbound_id);
  UPDATE public.promotion_offers SET status='accepted',accepted_at=now(),bonus_snapshot_sealed_at=now(),accepted_source_turn_id=p_inbound_id WHERE id=o.id;
  RETURN o.offer_version;
END $$;

REVOKE ALL ON FUNCTION public.append_direct_course_bonus(uuid,uuid,uuid,uuid,integer),public.accept_direct_course_bonus(uuid,uuid,integer),
  public.assert_direct_bonus_later_turn(uuid,uuid),public.confirm_direct_bonus_delivery() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='orchestrator_role') THEN
    GRANT EXECUTE ON FUNCTION public.append_direct_course_bonus(uuid,uuid,uuid,uuid,integer),public.accept_direct_course_bonus(uuid,uuid,integer),
      public.assert_direct_bonus_later_turn(uuid,uuid) TO orchestrator_role;
    -- Receipt capture is guarded by canonical channel evidence, just like the trigger.
    GRANT UPDATE(delivered_at) ON public.promotion_offer_bonus_offerings TO orchestrator_role;
  END IF;
END $$;
