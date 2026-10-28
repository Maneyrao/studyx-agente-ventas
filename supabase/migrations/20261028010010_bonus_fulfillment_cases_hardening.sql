-- Remove Supabase default grants as well as PUBLIC access. RLS and row
-- triggers cannot protect TRUNCATE; only the worker's append/read API is needed.
REVOKE ALL ON public.bonus_fulfillment_cases
  FROM PUBLIC, anon, authenticated, service_role, orchestrator_role;
GRANT SELECT, INSERT ON public.bonus_fulfillment_cases TO orchestrator_role;

-- Preserve the first durable escalation evidence, even for privileged writers.
CREATE TRIGGER bonus_fulfillment_cases_append_only
  BEFORE UPDATE OR DELETE ON public.bonus_fulfillment_cases
  FOR EACH ROW EXECUTE FUNCTION public.payment_events_append_only();
