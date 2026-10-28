-- The decision and its direct promotion effect commit in one transaction.
BEGIN;
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
ALTER TABLE public.delivery_reports DROP CONSTRAINT delivery_reports_report_status_check;
ALTER TABLE public.delivery_reports ADD CONSTRAINT delivery_reports_report_status_check
  CHECK(report_status IN ('submitted_to_botpress','delivered','failed'));
ALTER TABLE public.delivery_reports DROP CONSTRAINT delivery_reports_status_shape_check;
ALTER TABLE public.delivery_reports ADD CONSTRAINT delivery_reports_status_shape_check CHECK(
  (report_status IN ('submitted_to_botpress','delivered') AND botpress_message_id IS NOT NULL
    AND btrim(botpress_message_id)<>'' AND error_code IS NULL)
  OR (report_status='failed' AND error_code IS NOT NULL AND btrim(error_code)<>'')
);
COMMIT;
