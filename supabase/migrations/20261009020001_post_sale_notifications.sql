-- Purchase identity and durable, event-driven Agent A follow-up.
ALTER TABLE payments ADD COLUMN registration_email text;
ALTER TABLE payments ADD COLUMN registration_name text;
ALTER TABLE payments ADD COLUMN source_conversation_id uuid REFERENCES conversations(id);
ALTER TABLE central_enrollments ADD COLUMN login_url text;

CREATE TABLE post_sale_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id),
  kind text NOT NULL CHECK (kind IN ('payment_received', 'access_ready', 'access_delayed')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'dispatched', 'processing', 'sent', 'ambiguous', 'dead_letter', 'cancelled')),
  dispatch_attempts integer NOT NULL DEFAULT 0 CHECK (dispatch_attempts BETWEEN 0 AND 3),
  claim_token uuid,
  lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  provider_event_id text,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (payment_id, kind)
);
CREATE INDEX post_sale_notifications_pending_idx ON post_sale_notifications(available_at)
  WHERE status IN ('pending', 'dispatched', 'processing');
ALTER TABLE post_sale_notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON post_sale_notifications TO orchestrator_role;
CREATE POLICY orchestrator_access ON post_sale_notifications FOR ALL TO orchestrator_role
  USING (true) WITH CHECK (true);

CREATE FUNCTION public.queue_post_sale_payment() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status = 'paid' AND OLD.status <> 'paid' AND NEW.provider = 'stripe'
     AND NEW.plan_code IS NOT NULL THEN
    INSERT INTO public.post_sale_notifications(payment_id, kind)
      VALUES (NEW.id, 'payment_received') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER queue_post_sale_payment AFTER UPDATE OF status ON payments
  FOR EACH ROW EXECUTE FUNCTION public.queue_post_sale_payment();

CREATE FUNCTION public.queue_post_sale_access() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.post_sale_notifications(payment_id, kind)
    SELECT NEW.payment_id, 'access_ready' FROM public.payments p
    WHERE p.id = NEW.payment_id AND p.status = 'paid' AND p.plan_code IS NOT NULL
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER queue_post_sale_access AFTER INSERT ON central_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.queue_post_sale_access();

CREATE FUNCTION public.queue_post_sale_delay() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status = 'dead_letter' AND OLD.status <> 'dead_letter' THEN
    INSERT INTO public.post_sale_notifications(payment_id, kind)
      SELECT NEW.payment_id, 'access_delayed' FROM public.payments p
      WHERE p.id = NEW.payment_id AND p.status = 'paid' AND p.plan_code IS NOT NULL
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER queue_post_sale_delay AFTER UPDATE OF status ON fulfillment_jobs
  FOR EACH ROW EXECUTE FUNCTION public.queue_post_sale_delay();

-- Scoped claim leaves jobs from other environments/cutoffs untouched.
CREATE FUNCTION public.claim_central_enrollment_jobs(
  p_worker text, p_environment text, p_paid_after timestamptz,
  p_payment_id uuid DEFAULT NULL, p_lease_seconds integer DEFAULT 120
) RETURNS SETOF public.fulfillment_jobs LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
  WITH exhausted AS (
    UPDATE public.fulfillment_jobs j SET status = 'dead_letter', lease_until = NULL, leased_by = NULL,
      last_error_code = 'max_attempts_exhausted'
    FROM public.payments p WHERE p.id = j.payment_id AND p.environment = p_environment AND p.provider = 'stripe' AND p.plan_code IS NOT NULL
      AND p.paid_at >= p_paid_after AND (p_payment_id IS NULL OR p.id = p_payment_id)
      AND j.status IN ('pending', 'failed_retryable', 'leased') AND j.attempt_count >= LEAST(j.max_attempts, 3)
      AND (j.status <> 'leased' OR j.lease_until IS NULL OR j.lease_until <= now())
  ), candidates AS (
    SELECT j.id FROM public.fulfillment_jobs j JOIN public.payments p ON p.id = j.payment_id
    WHERE p.environment = p_environment AND p.provider = 'stripe' AND p.plan_code IS NOT NULL AND p.paid_at >= p_paid_after
      AND (p_payment_id IS NULL OR p.id = p_payment_id)
      AND j.status IN ('pending', 'failed_retryable', 'leased') AND j.available_at <= now()
      AND (j.status <> 'leased' OR j.lease_until IS NULL OR j.lease_until <= now())
      AND j.attempt_count < LEAST(j.max_attempts, 3)
    ORDER BY j.available_at, j.created_at, j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1
  ) UPDATE public.fulfillment_jobs j SET status = 'leased', leased_by = p_worker,
      lease_until = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 60), 900)),
      attempt_count = j.attempt_count + 1
    FROM candidates c WHERE j.id = c.id RETURNING j.*;
$$;
GRANT EXECUTE ON FUNCTION public.claim_central_enrollment_jobs(text,text,timestamptz,uuid,integer)
  TO orchestrator_role;
