-- Temporary Stripe verification action. It is deliberately separate from
-- the three commercial payment plans and carries only a canonical offering.

BEGIN;

ALTER TABLE agent_decisions
  DROP CONSTRAINT agent_decisions_business_action_check;

ALTER TABLE agent_decisions
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
            'mark_hot_lead', 'log_objection', 'request_call_now',
            'send_payment_link', 'send_test_payment_link'
          )
        )
      )
    )
  );

COMMIT;
