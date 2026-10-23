-- Freeze the exact promised gift set before the offer is sent, then seal the
-- payment snapshot before its URL can leave the transaction.
CREATE TABLE public.promotion_offer_bonus_offerings (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id                        uuid        NOT NULL REFERENCES public.promotion_offers(id) ON DELETE CASCADE,
  promotion_id                    uuid        NOT NULL REFERENCES public.promotions(id),
  offering_id                     uuid        NOT NULL REFERENCES public.offerings(id),
  promotion_code_snapshot         text        NOT NULL CHECK (btrim(promotion_code_snapshot) <> ''),
  offering_code_snapshot          text        NOT NULL CHECK (btrim(offering_code_snapshot) <> ''),
  offering_display_name_snapshot  text        NOT NULL CHECK (btrim(offering_display_name_snapshot) <> ''),
  position                        integer     NOT NULL CHECK (position BETWEEN 1 AND 3),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, offering_id),
  UNIQUE (offer_id, position)
);

ALTER TABLE public.promotion_offers
  ADD COLUMN bonus_snapshot_sealed_at timestamptz,
  ADD COLUMN voice_exposed_at timestamptz;

-- Offers that predate this migration may already have been exposed externally.
-- Do not let a gift set be attached retroactively. Pending reviews are safe to
-- snapshot because they have not yet been presented to the lead.
UPDATE public.promotion_offers
SET bonus_snapshot_sealed_at = COALESCE(offered_at, accepted_at, updated_at, created_at, now())
WHERE status <> 'pending_review'
  AND bonus_snapshot_sealed_at IS NULL;

CREATE OR REPLACE FUNCTION public.enforce_promotion_offer_bonus_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_offer_promotion uuid;
  v_offer_workspace uuid;
  v_offer_sealed_at timestamptz;
  v_promotion_workspace uuid;
  v_promotion_code text;
  v_offering_workspace uuid;
  v_offering_code text;
  v_offering_name text;
BEGIN
  SELECT promotion_id, workspace_id, bonus_snapshot_sealed_at
  INTO v_offer_promotion, v_offer_workspace, v_offer_sealed_at
  FROM public.promotion_offers WHERE id = NEW.offer_id FOR UPDATE;
  SELECT workspace_id, promotion_code
  INTO v_promotion_workspace, v_promotion_code
  FROM public.promotions WHERE id = NEW.promotion_id;
  SELECT workspace_id, code, display_name
  INTO v_offering_workspace, v_offering_code, v_offering_name
  FROM public.offerings WHERE id = NEW.offering_id;
  IF v_offer_sealed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Promotion offer bonus snapshot is sealed';
  END IF;
  IF v_offer_promotion IS NULL
     OR v_offer_promotion IS DISTINCT FROM NEW.promotion_id
     OR v_offer_workspace IS DISTINCT FROM v_promotion_workspace
     OR v_offering_workspace IS DISTINCT FROM v_offer_workspace
     OR NEW.promotion_code_snapshot IS DISTINCT FROM v_promotion_code
     OR NEW.offering_code_snapshot IS DISTINCT FROM v_offering_code
     OR NEW.offering_display_name_snapshot IS DISTINCT FROM v_offering_name
     OR NOT EXISTS (
       SELECT 1 FROM public.promotion_bonus_offerings configured
       WHERE configured.promotion_id = NEW.promotion_id
         AND configured.offering_id = NEW.offering_id
         AND configured.position = NEW.position
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Promotion offer bonus snapshot identity mismatch';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER promotion_offer_bonus_offerings_enforce_identity
BEFORE INSERT ON public.promotion_offer_bonus_offerings
FOR EACH ROW EXECUTE FUNCTION public.enforce_promotion_offer_bonus_identity();

CREATE OR REPLACE FUNCTION public.course_bonus_offer_snapshot_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Promotion offer bonus snapshots are immutable';
END
$$;

CREATE TRIGGER promotion_offer_bonus_offerings_block_mutation
BEFORE UPDATE OR DELETE ON public.promotion_offer_bonus_offerings
FOR EACH ROW EXECUTE FUNCTION public.course_bonus_offer_snapshot_append_only();

ALTER TABLE public.payments
  ADD COLUMN bonus_snapshot_sealed_at timestamptz;

-- Every pre-existing link may already have left the system. Seal it rather
-- than allowing a promotion to be attached retroactively.
UPDATE public.payments
SET bonus_snapshot_sealed_at = COALESCE(created_at, now())
WHERE bonus_snapshot_sealed_at IS NULL;

CREATE OR REPLACE FUNCTION public.enforce_payment_bonus_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
  v_sealed_at timestamptz;
  v_payment_workspace uuid;
  v_promotion_workspace uuid;
  v_offering_workspace uuid;
  v_paid_offering uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Payment bonus snapshot is immutable';
  END IF;
  SELECT status, bonus_snapshot_sealed_at, workspace_id, offering_id
  INTO v_status, v_sealed_at, v_payment_workspace, v_paid_offering
  FROM public.payments WHERE id = NEW.payment_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'reserved' OR v_sealed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Payment bonus snapshot is sealed';
  END IF;
  SELECT workspace_id INTO v_promotion_workspace FROM public.promotions WHERE id = NEW.promotion_id;
  SELECT workspace_id INTO v_offering_workspace FROM public.offerings WHERE id = NEW.offering_id;
  IF v_payment_workspace IS NULL
     OR v_promotion_workspace IS DISTINCT FROM v_payment_workspace
     OR v_offering_workspace IS DISTINCT FROM v_payment_workspace
     OR NEW.offering_id = v_paid_offering THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Payment bonus snapshot identity mismatch';
  END IF;
  RETURN NEW;
END
$$;

ALTER TABLE public.promotion_offer_bonus_offerings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orchestrator_role') THEN
    GRANT SELECT, INSERT ON public.promotion_offer_bonus_offerings TO orchestrator_role;
    REVOKE UPDATE, DELETE, TRUNCATE ON public.promotion_offer_bonus_offerings FROM orchestrator_role;
    CREATE POLICY orchestrator_access ON public.promotion_offer_bonus_offerings
      FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.promotion_offer_bonus_offerings FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.promotion_offer_bonus_offerings FROM authenticated;
  END IF;
END
$$;

COMMENT ON TABLE public.promotion_offer_bonus_offerings IS
  'Immutable exact gift set authorized at follow-up claim and later copied into the correlated payment.';
COMMENT ON COLUMN public.promotion_offers.bonus_snapshot_sealed_at IS
  'Set in the same transaction that freezes the complete promised gift set; blocks later additions.';
COMMENT ON COLUMN public.promotion_offers.voice_exposed_at IS
  'Evidence that the sealed offer was returned to the voice agent before it could be accepted for payment.';
COMMENT ON COLUMN public.payments.bonus_snapshot_sealed_at IS
  'Set in the reservation transaction before the checkout URL is returned; blocks later gift insertion.';
