-- Evidence remains append-only. The application role must never read audit_log.
CREATE SCHEMA IF NOT EXISTS studyx_private;
REVOKE ALL ON SCHEMA studyx_private FROM PUBLIC;
GRANT USAGE ON SCHEMA studyx_private TO orchestrator_role;

CREATE FUNCTION studyx_private.append_turn_evidence_atomic(
  p_workspace_slug text,
  p_observation jsonb,
  p_backend_sha text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_subject_type text := p_observation->>'subject_type';
  v_subject_id uuid;
  v_trace_id uuid;
  v_event_id uuid;
  v_key text;
  v_existing public.audit_log%ROWTYPE;
  v_backend_sha text := p_backend_sha;
BEGIN
  IF p_workspace_slug IS NULL OR p_workspace_slug !~ '^[a-z0-9][a-z0-9_-]*$'
     OR p_observation IS NULL OR jsonb_typeof(p_observation) <> 'object'
     OR coalesce(v_subject_type NOT IN ('turn', 'post_sale'), true)
     OR jsonb_typeof(p_observation->'data') IS DISTINCT FROM 'object'
     OR coalesce(p_observation->>'kind', '') !~ '^[a-z_]{1,80}$'
     OR octet_length(p_observation::text) > 524288
     OR (p_backend_sha IS NOT NULL AND p_backend_sha !~ '^[a-f0-9]{40}$') THEN
    RAISE EXCEPTION 'INVALID_TURN_EVIDENCE' USING ERRCODE = '23514';
  END IF;
  v_subject_id := (p_observation->>'subject_id')::uuid;
  v_trace_id := (p_observation->>'trace_id')::uuid;
  v_event_id := (p_observation->>'event_id')::uuid;
  IF v_subject_id IS NULL OR v_trace_id IS NULL OR v_event_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_TURN_EVIDENCE' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (v_subject_type = 'turn' AND EXISTS (
      SELECT 1 FROM public.messages m
      JOIN public.workspace_contacts wc ON wc.contact_id=m.contact_id
      JOIN public.workspaces w ON w.id=wc.workspace_id
      WHERE m.id=v_subject_id AND m.direction='inbound' AND w.slug=p_workspace_slug
    )) OR (v_subject_type = 'post_sale' AND EXISTS (
      SELECT 1 FROM public.post_sale_notifications n
      JOIN public.payments p ON p.id=n.payment_id
      JOIN public.workspaces w ON w.id=p.workspace_id
      WHERE n.id=v_subject_id AND w.slug=p_workspace_slug
    ))
  ) THEN
    RAISE EXCEPTION 'EVIDENCE_SUBJECT_NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  v_key := 'turn-evidence:' || v_subject_type || ':' || v_subject_id || ':' || v_event_id;
  SELECT al.* INTO v_existing FROM public.audit_log al WHERE al.event_key=v_key;
  IF FOUND THEN
    v_backend_sha := v_existing.payload->>'backend_sha';
  END IF;
  RETURN public.append_audit_event_atomic(
    'orchestrator', 'agent.turn.evidence',
    CASE WHEN v_subject_type='turn' THEN 'message' ELSE 'post_sale_notification' END,
    v_subject_id, jsonb_build_object('observation', p_observation, 'backend_sha', v_backend_sha),
    v_key, v_trace_id, NULL, NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION studyx_private.append_turn_evidence_atomic(text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studyx_private.append_turn_evidence_atomic(text,jsonb,text) TO orchestrator_role;
COMMENT ON FUNCTION studyx_private.append_turn_evidence_atomic(text,jsonb,text) IS
  'Authorized subject-scoped diagnostic append; exact retries preserve the first backend SHA. No audit data is returned.';
