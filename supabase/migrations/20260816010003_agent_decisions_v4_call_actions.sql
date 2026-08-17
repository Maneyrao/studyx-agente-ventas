-- Decision v4: el protocolo de llamada del Agente A.
--
-- Aditiva sobre v3. Agrega los response types `call_offer` y
-- `call_confirmation` y la business action `request_call_now`, con las mismas
-- reglas que congela el parser de dominio:
--
--   * call_offer propone y espera: sin business_action, kind reply,
--     next_state waiting_user. Una oferta nunca dispara una llamada sola.
--   * request_call_now sólo viaja con call_confirmation en una decisión
--     reply, y es exclusivo de schema 4 — y viceversa: una call_confirmation
--     sin request_call_now prometería una llamada que nadie pidió.
--
-- El teléfono, contact_id, call_id y la evidencia de consentimiento nunca
-- entran por esta tabla: se derivan en el backend (call_sessions).

BEGIN;

ALTER TABLE agent_decisions
  DROP CONSTRAINT agent_decisions_schema_version_check;

ALTER TABLE agent_decisions
  ADD CONSTRAINT agent_decisions_schema_version_check
  CHECK (schema_version IN (2, 3, 4));

ALTER TABLE agent_decisions
  DROP CONSTRAINT agent_decisions_response_type_check;

ALTER TABLE agent_decisions
  ADD CONSTRAINT agent_decisions_response_type_check
  CHECK (
    response_type IN (
      'social_reply',
      'commercial_reply',
      'clarification',
      'complaint_ack',
      'automation_only',
      'opt_out_ack',
      'out_of_scope',
      'technical_fallback',
      'call_offer',
      'call_confirmation'
    )
  );

-- Los response types de llamada no existen por debajo de schema 4.
ALTER TABLE agent_decisions
  ADD CONSTRAINT agent_decisions_call_response_version_check
  CHECK (
    response_type NOT IN ('call_offer', 'call_confirmation')
    OR schema_version = 4
  );

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
          AND business_action ->> 'type' IN ('mark_hot_lead', 'log_objection', 'request_call_now')
        )
      )
    )
  );

-- call_confirmation <-> request_call_now, siempre en una reply no-suppress.
ALTER TABLE agent_decisions
  ADD CONSTRAINT agent_decisions_call_request_shape_check
  CHECK (
    (
      COALESCE(response_type, '') <> 'call_confirmation'
      AND COALESCE(business_action ->> 'type', '') <> 'request_call_now'
    )
    OR (
      response_type = 'call_confirmation'
      AND business_action ->> 'type' = 'request_call_now'
      AND decision_kind = 'reply'
    )
  );

ALTER TABLE agent_decisions
  ADD CONSTRAINT agent_decisions_call_offer_shape_check
  CHECK (
    response_type <> 'call_offer'
    OR (
      business_action IS NULL
      AND decision_kind = 'reply'
      AND next_state = 'waiting_user'
    )
  );

COMMIT;
