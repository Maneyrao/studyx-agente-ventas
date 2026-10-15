-- The ingress normalizer owns this trust flag. Payload metadata supplied by a
-- customer never sets it. Use the same order for history and stale actions.
CREATE FUNCTION message_occurrence_v1(metadata jsonb, received_at timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN metadata ->> 'occurred_at_trusted' = 'true'
    -- A provider clock ahead of ours must not move the question after its reply.
    THEN LEAST((metadata ->> 'occurred_at')::timestamptz, received_at) ELSE received_at END
$$;
REVOKE ALL ON FUNCTION message_occurrence_v1(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION message_occurrence_v1(jsonb, timestamptz) TO orchestrator_role;
