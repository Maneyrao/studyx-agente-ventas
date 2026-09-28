-- Correlates owner-approved Stripe Payment Links with the canonical payment
-- ledger. The plan is immutable payment identity: it determines the first
-- amount charged and whether Checkout runs in payment or subscription mode.

ALTER TABLE payments
  ADD COLUMN plan_code text
  CHECK (plan_code IS NULL OR plan_code IN ('monthly_12', 'monthly_6', 'one_time'));

CREATE OR REPLACE FUNCTION public.enforce_payment_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.workspace_id  IS DISTINCT FROM NEW.workspace_id
     OR OLD.contact_id  IS DISTINCT FROM NEW.contact_id
     OR OLD.offering_id IS DISTINCT FROM NEW.offering_id
     OR OLD.quote_id    IS DISTINCT FROM NEW.quote_id
     OR OLD.amount      IS DISTINCT FROM NEW.amount
     OR OLD.currency    IS DISTINCT FROM NEW.currency
     OR OLD.provider    IS DISTINCT FROM NEW.provider
     OR OLD.environment IS DISTINCT FROM NEW.environment
     OR OLD.checkout_mode   IS DISTINCT FROM NEW.checkout_mode
     OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
     OR OLD.plan_code IS DISTINCT FROM NEW.plan_code THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Payment identity is immutable';
  END IF;

  IF OLD.provider_session_id IS NOT NULL
     AND OLD.provider_session_id IS DISTINCT FROM NEW.provider_session_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'A payment cannot change its provider session';
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status
     AND NOT (
       (OLD.status = 'reserved' AND NEW.status = 'creating_checkout')
       OR (OLD.status = 'creating_checkout' AND NEW.status IN ('pending', 'failed', 'creation_ambiguous'))
       OR (OLD.status = 'creation_ambiguous' AND NEW.status IN ('creating_checkout', 'pending', 'failed'))
       OR (OLD.status = 'pending' AND NEW.status IN ('paid', 'failed', 'expired'))
       OR (OLD.status = 'paid' AND NEW.status = 'refunded')
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format('Invalid payment transition: %s -> %s', OLD.status, NEW.status);
  END IF;

  RETURN NEW;
END
$$;
