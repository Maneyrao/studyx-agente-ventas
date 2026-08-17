-- Canonical payment + fulfillment state.
--
-- Money facts live in PostgreSQL, never in the model or the provider alone:
--   - offering_payment_configs: explicit per-offering provider configuration
--     (provider, stripe_price_id, checkout_mode, environment, status). The
--     checkout mode is stored here on purpose — it is never inferred from
--     billing_interval.
--   - commercial_quotes: the only way a quote-priced offering gets an amount.
--   - payments: one row per reserved payment; identity (workspace, contact,
--     offering, quote, amount, currency) is immutable and the state machine
--     is enforced by trigger: reserved → creating_checkout → pending →
--     paid|failed|expired (+ creation_ambiguous for unknown outcomes), and
--     paid → refunded. Terminal states never regress.
--   - payment_events: append-only ledger; provider event ids are unique so a
--     replayed webhook can never double-apply.
--   - fulfillment_jobs: exactly one durable job per paid payment; the webhook
--     enqueues work and never performs it.

CREATE TABLE commercial_quotes (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid          NOT NULL REFERENCES workspaces(id),
  contact_id    uuid          NOT NULL REFERENCES contacts(id),
  offering_id   uuid          NOT NULL REFERENCES offerings(id),
  amount        numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency      text          NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status        text          NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'confirmed', 'expired', 'withdrawn')),
  valid_until   timestamptz,
  notes         text,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX commercial_quotes_contact_offering_idx
  ON commercial_quotes (contact_id, offering_id, status);

CREATE TRIGGER commercial_quotes_set_updated_at
BEFORE UPDATE ON commercial_quotes
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

CREATE TABLE offering_payment_configs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id       uuid        NOT NULL UNIQUE REFERENCES offerings(id),
  provider          text        NOT NULL CHECK (provider IN ('fake', 'stripe')),
  stripe_price_id   text,
  checkout_mode     text        NOT NULL CHECK (checkout_mode IN ('payment', 'subscription')),
  environment       text        NOT NULL CHECK (environment IN ('test', 'live')),
  status            text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'inactive')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT offering_payment_configs_stripe_price_check CHECK (
    provider <> 'stripe' OR stripe_price_id IS NOT NULL
  )
);

CREATE TRIGGER offering_payment_configs_set_updated_at
BEFORE UPDATE ON offering_payment_configs
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

CREATE TABLE payments (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid          NOT NULL REFERENCES workspaces(id),
  contact_id               uuid          NOT NULL REFERENCES contacts(id),
  offering_id              uuid          NOT NULL REFERENCES offerings(id),
  quote_id                 uuid          REFERENCES commercial_quotes(id),
  amount                   numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency                 text          NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status                   text          NOT NULL DEFAULT 'reserved'
                                         CHECK (status IN (
                                           'reserved',
                                           'creating_checkout',
                                           'creation_ambiguous',
                                           'pending',
                                           'paid',
                                           'failed',
                                           'expired',
                                           'refunded'
                                         )),
  provider                 text          NOT NULL CHECK (provider IN ('fake', 'stripe')),
  environment              text          NOT NULL CHECK (environment IN ('test', 'live')),
  checkout_mode            text          NOT NULL CHECK (checkout_mode IN ('payment', 'subscription')),
  idempotency_key          text          NOT NULL UNIQUE,
  provider_session_id      text          UNIQUE,
  provider_session_status  text,
  checkout_url             text,
  checkout_expires_at      timestamptz,
  paid_at                  timestamptz,
  error_code               text,
  created_at               timestamptz   NOT NULL DEFAULT now(),
  updated_at               timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT payments_paid_timestamp_check CHECK (
    status NOT IN ('paid', 'refunded') OR paid_at IS NOT NULL
  )
);

CREATE INDEX payments_contact_idx ON payments (contact_id, status);
CREATE INDEX payments_workspace_status_idx ON payments (workspace_id, status);

CREATE TRIGGER payments_set_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

-- Identity immutability + the exact state machine of
-- src/features/payments/domain/payment-state.ts, enforced at the database so
-- no code path (present or future) can bend it.
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
     OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key THEN
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

CREATE TRIGGER payments_enforce_invariants
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_invariants();

CREATE TABLE payment_events (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         uuid        NOT NULL REFERENCES payments(id),
  provider           text        NOT NULL,
  provider_event_id  text        NOT NULL,
  event_type         text        NOT NULL CHECK (btrim(event_type) <> ''),
  payload            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  recorded_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_events_provider_event_unique UNIQUE (provider, provider_event_id)
);

CREATE INDEX payment_events_payment_idx ON payment_events (payment_id, recorded_at);

CREATE OR REPLACE FUNCTION public.payment_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    MESSAGE = 'payment_events is append-only';
END
$$;

CREATE TRIGGER payment_events_block_update
BEFORE UPDATE OR DELETE ON payment_events
FOR EACH ROW EXECUTE FUNCTION public.payment_events_append_only();

CREATE TABLE fulfillment_jobs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         uuid        NOT NULL UNIQUE REFERENCES payments(id),
  workspace_id       uuid        NOT NULL REFERENCES workspaces(id),
  status             text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN (
                                   'pending',
                                   'leased',
                                   'completed',
                                   'failed_retryable',
                                   'dead_letter',
                                   'skipped'
                                 )),
  attempt_count      integer     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts       integer     NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at       timestamptz NOT NULL DEFAULT now(),
  lease_until        timestamptz,
  leased_by          text,
  last_error_code    text,
  last_error_detail  text,
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fulfillment_jobs_completed_timestamp_check
    CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX fulfillment_jobs_claim_idx
  ON fulfillment_jobs (available_at, created_at)
  WHERE status IN ('pending', 'leased', 'failed_retryable');

CREATE TRIGGER fulfillment_jobs_set_updated_at
BEFORE UPDATE ON fulfillment_jobs
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

CREATE OR REPLACE FUNCTION public.claim_fulfillment_jobs(
  p_worker_id     text,
  p_limit         integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF public.fulfillment_jobs
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH exhausted AS (
    UPDATE public.fulfillment_jobs AS stale
    SET
      status = 'dead_letter',
      lease_until = NULL,
      leased_by = NULL,
      last_error_code = COALESCE(stale.last_error_code, 'MAX_ATTEMPTS_EXHAUSTED')
    WHERE stale.status = 'leased'
      AND (stale.lease_until IS NULL OR stale.lease_until <= now())
      AND stale.attempt_count >= stale.max_attempts
    RETURNING stale.id
  ), candidates AS (
    SELECT fj.id
    FROM public.fulfillment_jobs AS fj
    WHERE fj.status IN ('pending', 'leased', 'failed_retryable')
      AND fj.available_at <= now()
      AND (
        fj.status <> 'leased'
        OR fj.lease_until IS NULL
        OR fj.lease_until <= now()
      )
      AND fj.attempt_count < fj.max_attempts
    ORDER BY fj.available_at, fj.created_at, fj.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.fulfillment_jobs AS fj
  SET
    status = 'leased',
    leased_by = p_worker_id,
    lease_until = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 5), 900)),
    attempt_count = fj.attempt_count + 1
  FROM candidates AS c
  WHERE fj.id = c.id
  RETURNING fj.*;
$$;

ALTER TABLE commercial_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE offering_payment_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_jobs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON commercial_quotes, offering_payment_configs,
  payments, fulfillment_jobs TO orchestrator_role;
GRANT SELECT, INSERT ON payment_events TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON commercial_quotes, offering_payment_configs,
  payments, payment_events, fulfillment_jobs FROM orchestrator_role;
REVOKE UPDATE ON payment_events FROM orchestrator_role;

GRANT EXECUTE ON FUNCTION public.claim_fulfillment_jobs(text, integer, integer)
  TO orchestrator_role;
REVOKE EXECUTE ON FUNCTION public.claim_fulfillment_jobs(text, integer, integer)
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON commercial_quotes, offering_payment_configs, payments, payment_events, fulfillment_jobs FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON commercial_quotes, offering_payment_configs, payments, payment_events, fulfillment_jobs FROM authenticated';
  END IF;
END
$$;

DO $$
DECLARE
  payment_table text;
BEGIN
  FOREACH payment_table IN ARRAY ARRAY[
    'commercial_quotes', 'offering_payment_configs', 'payments',
    'payment_events', 'fulfillment_jobs'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = payment_table
        AND policyname = 'orchestrator_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY orchestrator_access ON %I FOR ALL TO orchestrator_role USING (true) WITH CHECK (true)',
        payment_table
      );
    END IF;
  END LOOP;
END
$$;

COMMENT ON TABLE payments IS
  'Canonical payment ledger. Identity is immutable; the status trigger mirrors reducePaymentState() and terminal states never regress.';
COMMENT ON TABLE payment_events IS
  'Append-only payment event log; (provider, provider_event_id) unique so webhook replays never double-apply.';
COMMENT ON COLUMN offering_payment_configs.checkout_mode IS
  'payment | subscription — explicit configuration, never inferred from billing_interval.';
