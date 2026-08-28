-- Conversation-local budget for Agent A's proactive call suggestions.
-- The existing call ledger remains the sole authority for call execution.

BEGIN;

ALTER TABLE conversation_sales_context_states_v1
  ADD COLUMN IF NOT EXISTS call_offer_count smallint NOT NULL DEFAULT 0;

ALTER TABLE conversation_sales_context_states_v1
  DROP CONSTRAINT IF EXISTS conversation_sales_context_states_v1_call_offer_count_check;

ALTER TABLE conversation_sales_context_states_v1
  ADD CONSTRAINT conversation_sales_context_states_v1_call_offer_count_check
  CHECK (call_offer_count BETWEEN 0 AND 2);

ALTER TABLE conversation_sales_context_state_events_v1
  ADD COLUMN IF NOT EXISTS call_offer_count smallint NOT NULL DEFAULT 0;

ALTER TABLE conversation_sales_context_state_events_v1
  DROP CONSTRAINT IF EXISTS conversation_state_events_v1_call_offer_count_check;

ALTER TABLE conversation_sales_context_state_events_v1
  ADD CONSTRAINT conversation_state_events_v1_call_offer_count_check
  CHECK (call_offer_count BETWEEN 0 AND 2);

COMMIT;
