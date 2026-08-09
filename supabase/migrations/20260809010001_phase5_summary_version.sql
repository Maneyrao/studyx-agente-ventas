-- Phase 5: versioned contact summary.
-- summary_version is a monotonically increasing counter; incremented every
-- time regenerateSummary() commits a new summary. Enables clients to detect
-- when the cached summary they hold has been superseded.

ALTER TABLE contacts
  ADD COLUMN summary_version int NOT NULL DEFAULT 0 CHECK (summary_version >= 0);
