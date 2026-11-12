-- Owner 2026-11-11: an unpaid sale may continue in a later WhatsApp
-- conversation only through an immutable continuity proof
-- (conversation_history_recovery_links: same workspace, same contact, closed
-- source, open canonical). The family root is the canonical conversation of
-- that proof, or the conversation itself. Never a phone or a "latest row".
-- Original payment/message ownership stays immutable; only the validation of
-- which customer turn may revise the sale is extended to the verified family.
BEGIN;
CREATE FUNCTION public.sale_family_root_v1(p_workspace uuid, p_contact uuid, p_conversation uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
  SELECT CASE WHEN p_conversation IS NULL THEN NULL ELSE COALESCE((
    SELECT link.canonical_conversation_id FROM public.conversation_history_recovery_links link
    WHERE link.workspace_id=p_workspace AND link.contact_id=p_contact
      AND link.source_conversation_id=p_conversation), p_conversation) END
$$;
GRANT EXECUTE ON FUNCTION public.sale_family_root_v1(uuid,uuid,uuid) TO orchestrator_role;

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
        AND public.sale_family_root_v1(NEW.workspace_id,NEW.contact_id,m.conversation_id)=public.sale_family_root_v1(NEW.workspace_id,NEW.contact_id,NEW.conversation_id)
        AND m.contact_id=NEW.contact_id AND m.direction='inbound'
        AND NOT EXISTS (SELECT 1 FROM public.payment_reconciliation_cases c WHERE c.payment_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM public.payment_events e WHERE e.payment_id=p.id
          AND e.event_type IN ('checkout_completed_paid','async_payment_succeeded','checkout_completed_unpaid'))
        AND NOT EXISTS (SELECT 1 FROM public.payments other
          WHERE other.workspace_id=p.workspace_id AND other.contact_id=p.contact_id
            AND public.sale_family_root_v1(other.workspace_id,other.contact_id,other.source_conversation_id)
              IS NOT DISTINCT FROM public.sale_family_root_v1(p.workspace_id,p.contact_id,p.source_conversation_id)
            AND other.offering_id=p.offering_id
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
        AND public.sale_family_root_v1(NEW.workspace_id,NEW.contact_id,m.conversation_id)=public.sale_family_root_v1(NEW.workspace_id,NEW.contact_id,NEW.conversation_id)
        AND m.contact_id=NEW.contact_id AND m.direction='inbound'
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
            AND public.sale_family_root_v1(NEW.workspace_id,NEW.contact_id,m.conversation_id)=public.sale_family_root_v1(NEW.workspace_id,NEW.contact_id,NEW.conversation_id)
            AND m.contact_id=NEW.contact_id))
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
      OR ROW(o.workspace_id,o.contact_id,o.paid_offering_id,o.promotion_id)
        IS DISTINCT FROM ROW(ancestor.workspace_id,ancestor.contact_id,ancestor.paid_offering_id,ancestor.promotion_id)
      OR public.sale_family_root_v1(o.workspace_id,o.contact_id,o.conversation_id)<>public.sale_family_root_v1(ancestor.workspace_id,ancestor.contact_id,ancestor.conversation_id)
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

CREATE OR REPLACE FUNCTION public.validate_negotiation_successor() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE child public.promotion_offers; parent public.promotion_offers;
BEGIN
  SELECT * INTO child FROM public.promotion_offers WHERE id=NEW.id;
  IF child.predecessor_offer_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO parent FROM public.promotion_offers WHERE id=child.predecessor_offer_id;
  IF parent.status<>'cancelled' OR parent.cancel_reason<>'NEGOTIATION_REOPENED'
    OR ROW(child.workspace_id,child.contact_id,child.paid_offering_id,child.promotion_id)
      IS DISTINCT FROM ROW(parent.workspace_id,parent.contact_id,parent.paid_offering_id,parent.promotion_id)
    OR public.sale_family_root_v1(child.workspace_id,child.contact_id,child.conversation_id)<>public.sale_family_root_v1(parent.workspace_id,parent.contact_id,parent.conversation_id)
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

-- A plan/e-mail revision made from the canonical conversation creates the
-- replacement payment there (source_conversation_id = current conversation)
-- while the attached package still belongs to the original conversation.
-- Same body as 20261110010001 except the conversation equality is a family one.
CREATE OR REPLACE FUNCTION public.enforce_payment_direct_package()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
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
      AND (o.conversation_id=NEW.source_conversation_id OR (o.status='attached' AND
        public.sale_family_root_v1(o.workspace_id,o.contact_id,o.conversation_id)
          =public.sale_family_root_v1(NEW.workspace_id,NEW.contact_id,NEW.source_conversation_id)))
      AND o.paid_offering_id=NEW.offering_id
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

-- The replacement of a checkout revised from the canonical conversation belongs to
-- the same sale family, not necessarily to the same conversation.
CREATE OR REPLACE FUNCTION public.validate_payment_checkout_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.payments p JOIN public.payments r ON r.id=NEW.replacement_payment_id
    WHERE p.id=NEW.payment_id AND r.id<>p.id
      AND r.workspace_id=p.workspace_id AND r.contact_id=p.contact_id
      AND public.sale_family_root_v1(r.workspace_id,r.contact_id,r.source_conversation_id)
        IS NOT DISTINCT FROM public.sale_family_root_v1(p.workspace_id,p.contact_id,p.source_conversation_id)
      AND r.offering_id=p.offering_id
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

-- Model-authored `proposal.turn_reasoning.already_said`, persisted per committed
-- Agent A turn so a linked conversation can read what was already said. Never customer-visible text.
ALTER TABLE public.agent_decisions ADD COLUMN IF NOT EXISTS already_said text;
ALTER TABLE public.agent_decisions DROP CONSTRAINT IF EXISTS agent_decisions_already_said_len;
ALTER TABLE public.agent_decisions ADD CONSTRAINT agent_decisions_already_said_len
  CHECK (already_said IS NULL OR length(already_said)<=400);
COMMIT;
