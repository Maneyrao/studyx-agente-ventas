-- Phase 1 audit hardening.
-- Atomicity is achieved when application code invokes append_audit_event_atomic
-- through the SAME postgres.js transaction handle as the business mutation.
-- A separate AUDIT_DATABASE_URL connection cannot participate in that commit.

ALTER TABLE audit_log
  ADD COLUMN event_key text,
  ADD COLUMN correlation_id uuid,
  ADD COLUMN causation_id uuid,
  ADD COLUMN source_event_id uuid;

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_source_event_fk
  FOREIGN KEY (source_event_id)
  REFERENCES channel_events(id)
  NOT VALID;

ALTER TABLE audit_log
  VALIDATE CONSTRAINT audit_log_source_event_fk;

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_actor_nonempty_check
  CHECK (btrim(actor) <> '')
  NOT VALID,
  ADD CONSTRAINT audit_log_action_nonempty_check
  CHECK (btrim(action) <> '')
  NOT VALID,
  ADD CONSTRAINT audit_log_entity_type_nonempty_check
  CHECK (btrim(entity_type) <> '')
  NOT VALID,
  ADD CONSTRAINT audit_log_event_key_nonempty_check
  CHECK (event_key IS NULL OR btrim(event_key) <> '')
  NOT VALID;

CREATE UNIQUE INDEX audit_log_event_key_uq
  ON audit_log (event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX audit_log_correlation_idx
  ON audit_log (correlation_id, occurred_at, id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX audit_log_source_event_idx
  ON audit_log (source_event_id, occurred_at, id)
  WHERE source_event_id IS NOT NULL;

-- Idempotent append function for new transactional services. Reusing an
-- event_key with different semantic data is an explicit conflict, not success.
CREATE OR REPLACE FUNCTION public.append_audit_event_atomic(
  p_actor           text,
  p_action          text,
  p_entity_type     text,
  p_entity_id       uuid,
  p_payload         jsonb DEFAULT NULL,
  p_event_key       text DEFAULT NULL,
  p_correlation_id  uuid DEFAULT NULL,
  p_causation_id    uuid DEFAULT NULL,
  p_source_event_id uuid DEFAULT NULL
) RETURNS uuid
SECURITY DEFINER
SET search_path = pg_catalog, public
LANGUAGE plpgsql AS $$
DECLARE
  v_audit_id uuid;
  v_existing public.audit_log%ROWTYPE;
BEGIN
  IF btrim(p_actor) = '' OR btrim(p_action) = '' OR btrim(p_entity_type) = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Audit actor, action and entity_type must be non-empty';
  END IF;

  IF p_event_key IS NOT NULL AND btrim(p_event_key) = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Audit event_key must be NULL or non-empty';
  END IF;

  INSERT INTO public.audit_log (
    actor,
    action,
    entity_type,
    entity_id,
    payload,
    event_key,
    correlation_id,
    causation_id,
    source_event_id
  )
  VALUES (
    p_actor,
    p_action,
    p_entity_type,
    p_entity_id,
    p_payload,
    p_event_key,
    p_correlation_id,
    p_causation_id,
    p_source_event_id
  )
  ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_audit_id;

  IF v_audit_id IS NOT NULL THEN
    RETURN v_audit_id;
  END IF;

  SELECT al.*
    INTO v_existing
  FROM public.audit_log AS al
  WHERE al.event_key = p_event_key;

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Audit insertion conflicted but no event_key row could be recovered';
  END IF;

  IF v_existing.actor IS DISTINCT FROM p_actor
     OR v_existing.action IS DISTINCT FROM p_action
     OR v_existing.entity_type IS DISTINCT FROM p_entity_type
     OR v_existing.entity_id IS DISTINCT FROM p_entity_id
     OR v_existing.payload IS DISTINCT FROM p_payload
     OR v_existing.correlation_id IS DISTINCT FROM p_correlation_id
     OR v_existing.causation_id IS DISTINCT FROM p_causation_id
     OR v_existing.source_event_id IS DISTINCT FROM p_source_event_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Audit event_key is already bound to different audit data',
      CONSTRAINT = 'audit_log_event_key_uq';
  END IF;

  RETURN v_existing.id;
END
$$;

REVOKE EXECUTE ON FUNCTION public.append_audit_event_atomic(
  text, text, text, uuid, jsonb, text, uuid, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_audit_event_atomic(
  text, text, text, uuid, jsonb, text, uuid, uuid, uuid
) TO orchestrator_role;

COMMENT ON FUNCTION public.append_audit_event_atomic(
  text, text, text, uuid, jsonb, text, uuid, uuid, uuid
) IS
  'Call with the same SQL transaction handle as the business write; event_key makes logical retries idempotent.';

COMMENT ON COLUMN audit_log.event_key IS
  'Stable logical mutation key, for example message.registered:<message_uuid>.';

COMMENT ON COLUMN audit_log.correlation_id IS
  'End-to-end turn/request correlation identifier.';
