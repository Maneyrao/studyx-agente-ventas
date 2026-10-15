-- A rejected proposal is unfinished work, never a completed silent decision.
-- The owner persists a bounded handoff before starting a fresh durable workflow.
CREATE TABLE inbound_batch_recoveries (
  batch_id uuid NOT NULL REFERENCES inbound_batches(id),
  claim_token uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z0-9_]{1,128}$'),
  outcome text NOT NULL CHECK (outcome IN ('scheduled', 'exhausted', 'superseded')),
  delay_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  PRIMARY KEY (batch_id, claim_token),
  UNIQUE (batch_id, attempt)
);
ALTER TABLE inbound_batch_recoveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inbound_batch_recoveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON inbound_batch_recoveries TO orchestrator_role;

CREATE FUNCTION schedule_inbound_batch_recovery(p_batch_id uuid, p_claim_token uuid, p_reason_code text, p_workspace_slug text)
RETURNS TABLE(outcome text, attempt integer, delay_ms integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  b inbound_batches%ROWTYPE;
  prior inbound_batch_recoveries%ROWTYPE;
  next_attempt integer;
  result text;
  delay integer;
  conversation uuid;
BEGIN
  IF p_reason_code !~ '^[A-Z0-9_]{1,128}$' THEN RAISE EXCEPTION 'INVALID_RECOVERY_REASON'; END IF;
  SELECT conversation_id INTO conversation FROM inbound_batches WHERE id = p_batch_id;
  -- Same order as inbound batching: conversation, then batch.
  PERFORM 1 FROM conversations WHERE id = conversation FOR UPDATE;
  SELECT * INTO b FROM inbound_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM workspace_contacts membership
    JOIN workspaces workspace ON workspace.id = membership.workspace_id
    WHERE membership.contact_id = b.contact_id AND workspace.slug = p_workspace_slug
      AND workspace.status = 'active'
  ) THEN
    RETURN QUERY SELECT 'not_owner'::text, 0, 0; RETURN;
  END IF;
  SELECT * INTO prior FROM inbound_batch_recoveries r
    WHERE r.batch_id = p_batch_id AND r.claim_token = p_claim_token;
  IF FOUND THEN
    RETURN QUERY SELECT prior.outcome, prior.attempt, prior.delay_ms;
    RETURN;
  END IF;
  IF b.id IS NULL OR b.state <> 'claimed' OR b.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN QUERY SELECT 'not_owner'::text, 0, 0; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM agent_decisions WHERE turn_id = b.representative_turn_id) THEN
    RETURN QUERY SELECT 'already_decided'::text, 0, 0; RETURN;
  END IF;
  SELECT COALESCE(MAX(r.attempt), 0) + 1 INTO next_attempt
    FROM inbound_batch_recoveries r WHERE r.batch_id = p_batch_id;
  result := CASE
    WHEN EXISTS (SELECT 1 FROM messages newer
      WHERE newer.conversation_id = conversation AND newer.direction = 'inbound'
      AND newer.batch_id IS DISTINCT FROM b.id
      AND (message_occurrence_v1(newer.metadata, newer.created_at), newer.conversation_seq) > (
        SELECT message_occurrence_v1(current.metadata, current.created_at), current.conversation_seq
        FROM messages current WHERE current.batch_id = b.id
        ORDER BY message_occurrence_v1(current.metadata, current.created_at) DESC, current.conversation_seq DESC LIMIT 1)) THEN 'superseded'
    WHEN next_attempt >= 3 OR EXISTS (SELECT 1 FROM inbound_batch_recoveries r
      WHERE r.batch_id = b.id AND r.created_at < now() - interval '2 minutes') THEN 'exhausted'
    ELSE 'scheduled' END;
  delay := CASE WHEN result <> 'scheduled' THEN 0 WHEN next_attempt = 1 THEN 2000 ELSE 10000 END;
  INSERT INTO inbound_batch_recoveries(batch_id, claim_token, attempt, reason_code, outcome, delay_ms)
    VALUES (b.id, p_claim_token, next_attempt, p_reason_code, result, delay);
  UPDATE inbound_batches SET
    state = CASE WHEN result = 'scheduled' THEN 'waiting' ELSE 'abandoned' END,
    due_at = now() + delay * interval '1 millisecond',
    hard_deadline_at = now() + (delay + 1000) * interval '1 millisecond',
    claim_token = NULL, claimed_by = NULL, claimed_at = NULL, lease_until = NULL,
    last_error_code = CASE WHEN result = 'exhausted' THEN 'AGENT_A_RECOVERY_EXHAUSTED'
      WHEN result = 'superseded' THEN 'SUPERSEDED_BY_NEWER_INBOUND' ELSE p_reason_code END,
    completed_at = CASE WHEN result = 'scheduled' THEN NULL ELSE now() END,
    version = version + 1, updated_at = now()
    WHERE id = b.id;
  IF result = 'exhausted' THEN
    INSERT INTO conversation_sales_context_states_v1
      (workspace_id, conversation_id, contact_id, stage, human_review_requested_at, source_turn_id)
    SELECT membership.workspace_id, b.conversation_id, b.contact_id, 'exploring', now(), b.representative_turn_id
      FROM workspace_contacts membership JOIN workspaces workspace ON workspace.id = membership.workspace_id
      WHERE membership.contact_id = b.contact_id AND workspace.status = 'active'
        AND workspace.slug = p_workspace_slug
    ON CONFLICT (workspace_id, conversation_id) DO UPDATE
      SET human_review_requested_at = COALESCE(conversation_sales_context_states_v1.human_review_requested_at, now()),
          version = conversation_sales_context_states_v1.version + 1, updated_at = now();
  END IF;
  RETURN QUERY SELECT result, next_attempt, delay;
END $$;
REVOKE ALL ON FUNCTION schedule_inbound_batch_recovery(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION schedule_inbound_batch_recovery(uuid, uuid, text, text) TO orchestrator_role;

CREATE FUNCTION resolve_inbound_batch_recoveries() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.state IN ('completed', 'abandoned') THEN
    UPDATE inbound_batch_recoveries SET resolved_at = now()
      WHERE batch_id = NEW.id AND resolved_at IS NULL AND outcome = 'scheduled';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION resolve_inbound_batch_recoveries() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER inbound_batch_recoveries_resolved AFTER UPDATE OF state ON inbound_batches
  FOR EACH ROW EXECUTE FUNCTION resolve_inbound_batch_recoveries();

-- A scheduler outage after the durable handoff must not leave an unanswered
-- batch waiting forever. The existing reconciler escalates it without sending.
CREATE FUNCTION expire_inbound_batch_recoveries(p_workspace_slug text, p_limit integer DEFAULT 100)
RETURNS TABLE(batch_id uuid, conversation_id uuid, claim_attempt_count integer, action text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  candidate record;
  b inbound_batches%ROWTYPE;
BEGIN
  FOR candidate IN
    SELECT DISTINCT batch.id, batch.conversation_id
    FROM inbound_batches batch JOIN inbound_batch_recoveries recovery ON recovery.batch_id = batch.id
    JOIN workspace_contacts membership ON membership.contact_id = batch.contact_id
    JOIN workspaces workspace ON workspace.id = membership.workspace_id
    WHERE batch.state = 'waiting' AND recovery.outcome = 'scheduled'
      AND recovery.resolved_at IS NULL AND recovery.created_at < now() - interval '2 minutes'
      AND workspace.slug = p_workspace_slug AND workspace.status = 'active'
    ORDER BY batch.conversation_id, batch.id LIMIT GREATEST(0, LEAST(p_limit, 1000))
  LOOP
    PERFORM 1 FROM conversations WHERE id = candidate.conversation_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT * INTO b FROM inbound_batches WHERE id = candidate.id AND state = 'waiting' FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE inbound_batches SET state = 'abandoned', completed_at = now(), updated_at = now(),
      version = version + 1, last_error_code = 'AGENT_A_RECOVERY_DISPATCH_EXPIRED' WHERE id = b.id;
    INSERT INTO conversation_sales_context_states_v1
      (workspace_id, conversation_id, contact_id, stage, human_review_requested_at, source_turn_id)
    SELECT membership.workspace_id, b.conversation_id, b.contact_id, 'exploring', now(), b.representative_turn_id
      FROM workspace_contacts membership JOIN workspaces workspace ON workspace.id = membership.workspace_id
      WHERE membership.contact_id = b.contact_id AND workspace.slug = p_workspace_slug AND workspace.status = 'active'
    ON CONFLICT (workspace_id, conversation_id) DO UPDATE
      SET human_review_requested_at = COALESCE(conversation_sales_context_states_v1.human_review_requested_at, now()),
          version = conversation_sales_context_states_v1.version + 1, updated_at = now();
    RETURN QUERY SELECT b.id, b.conversation_id, b.claim_attempt_count, 'abandoned'::text;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION expire_inbound_batch_recoveries(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_inbound_batch_recoveries(text, integer) TO orchestrator_role;
