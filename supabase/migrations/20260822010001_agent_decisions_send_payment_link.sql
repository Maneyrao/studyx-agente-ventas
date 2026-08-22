-- Agent A Operational MVP: permite persistir `send_payment_link` en
-- agent_decisions (docs/contracts/agent-a-operational-mvp.md §4).
--
-- Aditiva sobre 20260816010003_agent_decisions_v4_call_actions.sql: ese
-- archivo fijó `agent_decisions_business_action_check` para schema_version 4
-- con `mark_hot_lead`, `log_objection` y `request_call_now` solamente. El
-- backend (src/features/orchestration/domain/decision-v4.ts) ya parsea y
-- revalida `send_payment_link` desde antes, pero cada intento de commit
-- fallaba en este constraint — la acción nunca podía persistirse. El link y
-- el precio nunca viajan en `business_action` (sólo `type`, `plan_code`,
-- `offering_sku`); ese contenido lo valida el parser y el materializador,
-- nunca este constraint.

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
            'mark_hot_lead', 'log_objection', 'request_call_now', 'send_payment_link'
          )
        )
      )
    )
  );

COMMIT;
