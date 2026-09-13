-- A delivery report may arrive out of order. Keep the source ordering outside
-- the four visible Sheet cells so a late older outbound cannot restore stale
-- lead details over a newer accepted correction.
ALTER TABLE sheet_projection_rows
  ADD COLUMN IF NOT EXISTS source_order bigint NOT NULL DEFAULT 0
  CHECK (source_order >= 0);

COMMENT ON COLUMN sheet_projection_rows.source_order IS
  'Monotonic source message sequence for the lead payload. It fences stale accepted deliveries without widening the visible Google Sheets row.';
