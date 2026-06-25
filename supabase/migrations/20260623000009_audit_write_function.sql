-- The only authorized path to insert into audit_log.
-- Runs as audit_writer (SECURITY DEFINER) regardless of the caller's role.
-- orchestrator_role has EXECUTE but no direct INSERT on audit_log.

CREATE OR REPLACE FUNCTION write_audit_log(
  p_actor       text,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_payload     jsonb DEFAULT NULL
) RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE sql AS $$
  INSERT INTO audit_log (actor, action, entity_type, entity_id, payload)
  VALUES (p_actor, p_action, p_entity_type, p_entity_id, p_payload);
$$;

GRANT audit_writer TO postgres;
GRANT CREATE ON SCHEMA public TO audit_writer;

ALTER FUNCTION write_audit_log OWNER TO audit_writer;
GRANT EXECUTE ON FUNCTION write_audit_log TO orchestrator_role;
REVOKE EXECUTE ON FUNCTION write_audit_log FROM PUBLIC;

REVOKE audit_writer FROM postgres;
