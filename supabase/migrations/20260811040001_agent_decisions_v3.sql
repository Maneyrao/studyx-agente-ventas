-- Fase 6 — Decision v3 en persistencia.
--
-- v3 es un superconjunto estricto de v2: los campos de v2 conservan su
-- semántica exacta y se agregan dos capacidades ortogonales.
--
--   business_action : un efecto tipado que la decisión declara.
--   retrieval_used  : qué slots de contexto consultó realmente el modelo.
--
-- Dos decisiones deliberadas que esta migración vuelve estructurales:
--
-- 1. **No hay handoff humano.** `escalate_to_human` es un tipo válido del
--    esquema de dominio, pero la base lo rechaza. No existe humano al que
--    derivar; permitir la fila sería crear un estado que nadie atiende. El
--    intento se responde igual, con `response_type = 'automation_only'`.
--
-- 2. **Las acciones comerciales siguen deshabilitadas.** Sólo se aceptan las
--    dos acciones que no tienen ningún efecto hacia afuera —`mark_hot_lead` y
--    `log_objection`, ambas puramente observacionales. `send_pricing_info` y
--    `schedule_followup` prometen algo al cliente, así que quedan fuera hasta
--    que exista el caso de uso que las ejecute de verdad.
--
-- v2 sigue siendo válido en el alambre: ningún productor v2 necesita cambiar.
--
-- Migración aditiva (archivo nuevo; no reescribe ninguna migración aplicada).

ALTER TABLE agent_decisions
  DROP CONSTRAINT agent_decisions_schema_version_check,
  DROP CONSTRAINT agent_decisions_business_action_check;

ALTER TABLE agent_decisions
  ADD CONSTRAINT agent_decisions_schema_version_check
    CHECK (schema_version IN (2, 3));

ALTER TABLE agent_decisions
  ADD CONSTRAINT agent_decisions_business_action_check
    CHECK (
      business_action IS NULL
      OR (
        schema_version = 3
        AND jsonb_typeof(business_action) = 'object'
        AND business_action ->> 'type' IN ('mark_hot_lead', 'log_objection')
      )
    );

-- Una acción no puede acompañar a un turno que no responde.
ALTER TABLE agent_decisions
  ADD CONSTRAINT agent_decisions_business_action_scope_check
    CHECK (business_action IS NULL OR decision_kind <> 'suppress');

ALTER TABLE agent_decisions
  ADD COLUMN retrieval_used jsonb;

ALTER TABLE agent_decisions
  ADD CONSTRAINT agent_decisions_retrieval_used_shape_check
    CHECK (
      retrieval_used IS NULL
      OR (
        jsonb_typeof(retrieval_used) = 'object'
        AND jsonb_typeof(retrieval_used -> 'kb') = 'boolean'
        AND jsonb_typeof(retrieval_used -> 'long_term_memory') = 'boolean'
        AND jsonb_typeof(retrieval_used -> 'summary_version') IN ('number', 'null')
      )
    );

COMMENT ON COLUMN agent_decisions.retrieval_used IS
  'Qué slots de contexto declaró haber usado el modelo. Auditoría, no autoridad.';

-- El disparador de inmutabilidad tiene que cubrir la columna nueva, o
-- `retrieval_used` sería el único campo de la decisión reescribible después
-- del commit.
CREATE OR REPLACE FUNCTION public.enforce_agent_decision_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.turn_id IS DISTINCT FROM NEW.turn_id
     OR OLD.trace_id IS DISTINCT FROM NEW.trace_id
     OR OLD.schema_version IS DISTINCT FROM NEW.schema_version
     OR OLD.intent IS DISTINCT FROM NEW.intent
     OR OLD.decision_kind IS DISTINCT FROM NEW.decision_kind
     OR OLD.response IS DISTINCT FROM NEW.response
     OR OLD.response_type IS DISTINCT FROM NEW.response_type
     OR OLD.business_action IS DISTINCT FROM NEW.business_action
     OR OLD.retrieval_used IS DISTINCT FROM NEW.retrieval_used
     OR OLD.memory_candidates IS DISTINCT FROM NEW.memory_candidates
     OR OLD.missing_information IS DISTINCT FROM NEW.missing_information
     OR OLD.next_state IS DISTINCT FROM NEW.next_state
     OR OLD.reason_code IS DISTINCT FROM NEW.reason_code
     OR OLD.confidence IS DISTINCT FROM NEW.confidence
     OR OLD.model_provider IS DISTINCT FROM NEW.model_provider
     OR OLD.model_name IS DISTINCT FROM NEW.model_name
     OR OLD.prompt_version IS DISTINCT FROM NEW.prompt_version
     OR OLD.payload_hash IS DISTINCT FROM NEW.payload_hash
     OR (
       OLD.outbound_message_id IS DISTINCT FROM NEW.outbound_message_id
       AND NOT (
         OLD.outbound_message_id IS NULL
         AND NEW.outbound_message_id IS NOT NULL
         AND OLD.decision_kind IN ('reply', 'clarify')
         AND OLD.response IS NOT NULL
         AND btrim(OLD.response) <> ''
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Agent decision is immutable after commit';
  END IF;
  RETURN NEW;
END
$$;
