-- Equal source positions are normally stale replays. Retell needs one narrow
-- exception: a correction from the exact same correlated call may replace its
-- own payload while keeping its odd A/B order position.
ALTER TABLE sheet_projection_rows
  ADD COLUMN IF NOT EXISTS source_key text
  CHECK (
    source_key IS NULL
    OR (btrim(source_key) <> '' AND char_length(source_key) <= 256)
  );

COMMENT ON COLUMN sheet_projection_rows.source_key IS
  'Stable trusted producer identity for equal-order idempotency, such as an Agent A source turn or a correlated Retell call. Never projected to Sheets.';
