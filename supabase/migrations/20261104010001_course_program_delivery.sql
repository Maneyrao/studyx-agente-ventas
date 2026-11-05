-- send_course_program (owner decision 2026-11-04): the official programme PDF is a
-- document part of the reply. Additive: one more physical part (the three text
-- bubbles keep indexes 0-2, the document takes 3), one more committed action,
-- and an idempotent delivery ledger per (conversation, offering, asset version).
BEGIN;

ALTER TABLE public.agent_decision_outbound_parts
  DROP CONSTRAINT IF EXISTS agent_decision_outbound_parts_part_index_check;
ALTER TABLE public.agent_decision_outbound_parts
  ADD CONSTRAINT agent_decision_outbound_parts_part_index_check CHECK (part_index >= 0 AND part_index <= 3);

ALTER TABLE public.agent_decisions DROP CONSTRAINT agent_decisions_business_action_check;
ALTER TABLE public.agent_decisions ADD CONSTRAINT agent_decisions_business_action_check CHECK (
  business_action IS NULL OR COALESCE(
    jsonb_typeof(business_action)='object' AND (
      (schema_version=3 AND business_action->>'type' IN ('mark_hot_lead','log_objection'))
      OR (schema_version=4 AND (
        business_action->>'type' IN ('mark_hot_lead','log_objection','request_call_now','send_payment_link',
          'send_test_payment_link','schedule_price_objection_checkin','request_promotion_review')
        OR (business_action->>'type'='offer_course_bonus'
          AND business_action - ARRAY['type','interest_offering_code','bonus_offering_code']::text[]='{}'::jsonb
          AND jsonb_typeof(business_action->'interest_offering_code')='string'
          AND business_action->>'interest_offering_code' ~ '^[a-z0-9][a-z0-9_-]*$'
          AND jsonb_typeof(business_action->'bonus_offering_code')='string'
          AND business_action->>'bonus_offering_code' ~ '^[a-z0-9][a-z0-9_-]*$')
        OR (business_action->>'type'='send_course_program'
          AND business_action - ARRAY['type','offering_code']::text[]='{}'::jsonb
          AND jsonb_typeof(business_action->'offering_code')='string'
          AND business_action->>'offering_code' ~ '^[a-z0-9][a-z0-9_-]*$')
        OR (business_action->>'type'='accept_promotion' AND (
          business_action='{"type":"accept_promotion"}'::jsonb
          OR (business_action - ARRAY['type','interest_offering_code','promotion_code','promotion_cycle_id','offer_version']::text[]='{}'::jsonb
            AND jsonb_typeof(business_action->'interest_offering_code')='string'
            AND business_action->>'interest_offering_code' ~ '^[a-z0-9][a-z0-9_-]*$'
            AND jsonb_typeof(business_action->'promotion_code')='string'
            AND length(business_action->>'promotion_code')>0
            AND jsonb_typeof(business_action->'promotion_cycle_id')='string'
            AND business_action->>'promotion_cycle_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND jsonb_typeof(business_action->'offer_version')='number'
            AND business_action->>'offer_version' ~ '^[1-9][0-9]*$')
        ))
      ))
    ),false)
);

CREATE TABLE public.course_program_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id),
  contact_id uuid NOT NULL REFERENCES public.contacts(id),
  offering_code text NOT NULL CHECK (offering_code ~ '^[a-z0-9][a-z0-9_-]*$'),
  asset_version text NOT NULL CHECK (asset_version ~ '^[0-9a-f]{12}$'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','failed')),
  decision_id uuid REFERENCES public.agent_decisions(id),
  outbound_message_id uuid REFERENCES public.messages(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_program_deliveries_once UNIQUE (conversation_id, offering_code, asset_version)
);
CREATE INDEX course_program_deliveries_outbound_idx ON public.course_program_deliveries (outbound_message_id);

ALTER TABLE public.course_program_deliveries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.course_program_deliveries TO orchestrator_role;
CREATE POLICY orchestrator_access ON public.course_program_deliveries FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);

COMMIT;
