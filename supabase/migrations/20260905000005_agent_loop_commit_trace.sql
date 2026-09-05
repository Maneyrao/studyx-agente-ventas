BEGIN;

-- Agent Loop V3 declares which durable memories informed the answer. Keep the
-- identifiers on the immutable decision instead of losing them at render time.
ALTER TABLE agent_decisions
  ADD COLUMN IF NOT EXISTS used_memory_ids text[] NOT NULL DEFAULT ARRAY[]::text[];

-- One turn may produce two state versions: the immediate customer-declared
-- half and the visibility-gated half after channel acceptance. Version is the
-- event identity; source_turn_id remains causal provenance and is intentionally
-- allowed to repeat for those two phases.
DROP INDEX IF EXISTS conversation_sales_context_events_v1_source_unique;
CREATE INDEX IF NOT EXISTS conversation_sales_context_events_v1_source_idx
  ON conversation_sales_context_state_events_v1 (
    workspace_id,
    conversation_id,
    source_turn_id,
    state_version
  )
  WHERE source_turn_id IS NOT NULL;

COMMENT ON COLUMN agent_decisions.used_memory_ids IS
  'Immutable memory identifiers explicitly used by an Agent Loop V3 decision.';

COMMIT;
