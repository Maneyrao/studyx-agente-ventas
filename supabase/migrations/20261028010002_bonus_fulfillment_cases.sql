-- Partial enrollment is a fulfillment concern; payment confirmation is never reversed.
ALTER TABLE public.central_enrollments DROP CONSTRAINT central_enrollments_enrollment_status_check;
ALTER TABLE public.central_enrollments ADD CONSTRAINT central_enrollments_enrollment_status_check
  CHECK(enrollment_status IN ('active','already_enrolled','processing'));
ALTER TABLE public.central_enrollments ADD COLUMN offering_code_snapshot text;
ALTER TABLE public.central_enrollments ADD COLUMN offering_display_name_snapshot text;
UPDATE public.central_enrollments e SET offering_code_snapshot=o.code,offering_display_name_snapshot=o.display_name
  FROM public.payments p JOIN public.offerings o ON o.id=p.offering_id WHERE p.id=e.payment_id;
CREATE TABLE public.bonus_fulfillment_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z0-9_:]{1,80}$'),
  expected_codes text[] NOT NULL CHECK (cardinality(expected_codes) BETWEEN 2 AND 4),
  active_codes text[] NOT NULL,
  pending_codes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (active_codes <@ expected_codes AND pending_codes <@ expected_codes),
  CHECK (NOT active_codes && pending_codes)
);
ALTER TABLE public.bonus_fulfillment_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bonus_fulfillment_cases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.bonus_fulfillment_cases TO orchestrator_role;
CREATE POLICY orchestrator_access ON public.bonus_fulfillment_cases FOR ALL TO orchestrator_role
  USING (true) WITH CHECK (true);

CREATE FUNCTION public.open_bonus_fulfillment_case(p_payment_id uuid, p_reason text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  INSERT INTO public.bonus_fulfillment_cases(payment_id,workspace_id,reason_code,expected_codes,active_codes,pending_codes)
  SELECT p.id,p.workspace_id,p_reason,
    ARRAY[COALESCE(enrollment.offering_code_snapshot,o.code)] || ARRAY(SELECT offering_code_snapshot FROM public.payment_bonus_offerings
      WHERE payment_id=p.id ORDER BY position),
    (CASE WHEN enrollment.enrollment_status IN ('active','already_enrolled')
      THEN ARRAY[COALESCE(enrollment.offering_code_snapshot,o.code)] ELSE ARRAY[]::text[] END) || ARRAY(
      SELECT offering_code FROM public.central_bonus_enrollment_items WHERE payment_id=p.id ORDER BY position),
    (CASE WHEN enrollment.enrollment_status IN ('active','already_enrolled')
      THEN ARRAY[]::text[] ELSE ARRAY[COALESCE(enrollment.offering_code_snapshot,o.code)] END) || ARRAY(
      SELECT s.offering_code_snapshot FROM public.payment_bonus_offerings s WHERE s.payment_id=p.id
      AND NOT EXISTS(SELECT 1 FROM public.central_bonus_enrollment_items e
        WHERE e.payment_id=p.id AND e.offering_code=s.offering_code_snapshot) ORDER BY s.position)
  FROM public.payments p JOIN public.offerings o ON o.id=p.offering_id
  LEFT JOIN public.central_enrollments enrollment ON enrollment.payment_id=p.id
  WHERE p.id=p_payment_id AND p.status='paid'
    AND EXISTS(SELECT 1 FROM public.payment_bonus_offerings WHERE payment_id=p.id)
  ON CONFLICT(payment_id) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.open_bonus_fulfillment_case(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_bonus_fulfillment_case(uuid,text) TO orchestrator_role;

-- claim_* also exhausts crashed workers' final leases without returning a job.
CREATE FUNCTION public.queue_bonus_fulfillment_case() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status='dead_letter' AND OLD.status<>'dead_letter' THEN
    PERFORM public.open_bonus_fulfillment_case(NEW.payment_id,COALESCE(NEW.last_error_code,'max_attempts_exhausted'));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.queue_bonus_fulfillment_case() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_bonus_fulfillment_case() TO orchestrator_role;
CREATE TRIGGER queue_bonus_fulfillment_case AFTER UPDATE OF status ON public.fulfillment_jobs
  FOR EACH ROW EXECUTE FUNCTION public.queue_bonus_fulfillment_case();

-- Both the paid row and the final bonus row may be the last verified item.
CREATE OR REPLACE FUNCTION public.queue_post_sale_access() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.post_sale_notifications(payment_id, kind)
    SELECT p.id, 'access_ready' FROM public.payments p
    JOIN public.central_enrollments e ON e.payment_id=p.id
    WHERE p.id=NEW.payment_id AND p.status='paid' AND p.plan_code IS NOT NULL
      AND e.enrollment_status IN ('active','already_enrolled')
      AND NOT EXISTS (
        SELECT 1 FROM public.payment_bonus_offerings s WHERE s.payment_id=p.id
          AND NOT EXISTS (SELECT 1 FROM public.central_bonus_enrollment_items b
            WHERE b.payment_id=p.id AND b.offering_code=s.offering_code_snapshot
              AND b.position=s.position AND b.enrollment_status IN ('active','already_enrolled'))
      )
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER queue_post_sale_bonus_access AFTER INSERT ON public.central_bonus_enrollment_items
  FOR EACH ROW EXECUTE FUNCTION public.queue_post_sale_access();
CREATE TRIGGER queue_post_sale_updated_access AFTER UPDATE OF enrollment_status ON public.central_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.queue_post_sale_access();
REVOKE ALL ON FUNCTION public.queue_post_sale_access() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_post_sale_access() TO orchestrator_role;
