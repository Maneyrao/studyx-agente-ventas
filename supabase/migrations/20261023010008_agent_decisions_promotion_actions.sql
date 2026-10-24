-- Keep PostgreSQL's immutable decision boundary aligned with the three
-- promotion actions already authorized by the v4 application contract.
-- Schema v3 remains observational only; unknown actions remain rejected.

BEGIN;

ALTER TABLE public.agent_decisions
  DROP CONSTRAINT agent_decisions_business_action_check;

ALTER TABLE public.agent_decisions
  ADD CONSTRAINT agent_decisions_business_action_check
  CHECK (
    business_action IS NULL
    OR (
      jsonb_typeof(business_action) = 'object'
      AND (
        (
          schema_version = 3
          AND business_action ->> 'type' IN ('mark_hot_lead', 'log_objection')
        )
        OR (
          schema_version = 4
          AND business_action ->> 'type' IN (
            'mark_hot_lead',
            'log_objection',
            'request_call_now',
            'send_payment_link',
            'send_test_payment_link',
            'schedule_price_objection_checkin',
            'request_promotion_review',
            'accept_promotion'
          )
        )
      )
    )
  );

COMMIT;
