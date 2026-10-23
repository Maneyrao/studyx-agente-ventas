-- Central v2 returns each bonus offering code and status, but no independent
-- enrollment id for the bonus item. Keep the reserved column for forward
-- compatibility without fabricating an identifier the Central did not send.
ALTER TABLE public.central_bonus_enrollment_items
  ALTER COLUMN enrollment_id DROP NOT NULL;

COMMENT ON COLUMN public.central_bonus_enrollment_items.enrollment_id IS
  'Optional future Central identifier; current Central v2 returns only offering_code and enrollment_status.';
