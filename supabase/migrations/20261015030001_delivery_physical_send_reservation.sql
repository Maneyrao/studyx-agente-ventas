-- NULL preserves unknown history from older bundles. Only the new signed
-- capability reserves a part before any provider submission is possible.
ALTER TABLE public.outbound_deliveries
  ADD COLUMN physical_send_state text
  CHECK (physical_send_state IN ('reserved', 'started'));

COMMENT ON COLUMN public.outbound_deliveries.physical_send_state IS
  'Positive transport evidence: reserved = provider step has not started; started = submission may have happened; NULL = legacy unknown.';
