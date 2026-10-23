-- Botpress-managed conversations predate workspace-scoped conversations and
-- deliberately remain workspace_id = NULL so their next inbound can reuse the
-- same channel thread. Bind promotion offers through the canonical commercial
-- state in that legacy case; a non-NULL conversation workspace must still
-- match exactly.
CREATE OR REPLACE FUNCTION public.enforce_promotion_offer_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_promotion_workspace uuid;
  v_promotion_paid_offering uuid;
  v_conversation_contact uuid;
  v_conversation_workspace uuid;
  v_payment_workspace uuid;
  v_payment_contact uuid;
  v_payment_offering uuid;
BEGIN
  SELECT workspace_id, paid_offering_id
  INTO v_promotion_workspace, v_promotion_paid_offering
  FROM public.promotions WHERE id = NEW.promotion_id;

  SELECT contact_id, workspace_id
  INTO v_conversation_contact, v_conversation_workspace
  FROM public.conversations WHERE id = NEW.conversation_id;

  IF v_promotion_workspace IS NULL
     OR v_promotion_workspace IS DISTINCT FROM NEW.workspace_id
     OR v_promotion_paid_offering IS DISTINCT FROM NEW.paid_offering_id
     OR v_conversation_contact IS DISTINCT FROM NEW.contact_id
     OR NOT (
       v_conversation_workspace IS NOT DISTINCT FROM NEW.workspace_id
       OR (
         v_conversation_workspace IS NULL
         AND EXISTS (
           SELECT 1
           FROM public.conversation_sales_context_states_v1 state
           WHERE state.workspace_id = NEW.workspace_id
             AND state.conversation_id = NEW.conversation_id
             AND state.contact_id = NEW.contact_id
         )
       )
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.workspace_contacts wc
       WHERE wc.workspace_id = NEW.workspace_id AND wc.contact_id = NEW.contact_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Promotion offer identity mismatch';
  END IF;

  IF NEW.payment_id IS NOT NULL THEN
    SELECT workspace_id, contact_id, offering_id
    INTO v_payment_workspace, v_payment_contact, v_payment_offering
    FROM public.payments WHERE id = NEW.payment_id;
    IF v_payment_workspace IS DISTINCT FROM NEW.workspace_id
       OR v_payment_contact IS DISTINCT FROM NEW.contact_id
       OR v_payment_offering IS DISTINCT FROM NEW.paid_offering_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Promotion offer payment identity mismatch';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.enforce_promotion_offer_identity() IS
  'Binds scoped conversations directly and legacy Botpress conversations through their canonical commercial state.';
