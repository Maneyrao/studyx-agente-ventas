CREATE TABLE audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor       text        NOT NULL DEFAULT 'orchestrator',
  action      text        NOT NULL,
  entity_type text        NOT NULL,
  entity_id   uuid,
  payload     jsonb
);

CREATE INDEX audit_log_entity_idx   ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_occurred_idx ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_action_idx   ON audit_log (action);
