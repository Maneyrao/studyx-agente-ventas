-- Durable, tenant-bound handoff from a delivered payment proposal to the
-- derived Google Sheets lead row.
--
-- The decision/outbound transaction creates one waiting job. Delivery moves
-- only the latest delivered proposal for each workspace/contact to `pending`;
-- older proposals become `superseded`. The reconciler therefore acquires a
-- bounded, indexable pending queue and never scans decision JSON history.

BEGIN;

CREATE TABLE payment_projection_jobs (
  decision_id          uuid        PRIMARY KEY REFERENCES agent_decisions(id),
  workspace_id         uuid        NOT NULL REFERENCES workspaces(id),
  contact_id           uuid        NOT NULL REFERENCES contacts(id),
  outbound_message_id  uuid        NOT NULL UNIQUE REFERENCES messages(id),
  trace_id             uuid        NOT NULL,
  offering_sku         text        NOT NULL CHECK (btrim(offering_sku) <> ''),
  plan_code            text        NOT NULL CHECK (plan_code IN ('monthly_12', 'monthly_6', 'one_time')),
  decision_created_at  timestamptz NOT NULL,
  delivered_at         timestamptz,
  state                text        NOT NULL DEFAULT 'waiting_delivery'
                                   CHECK (state IN (
                                     'waiting_delivery',
                                     'pending',
                                     'projected',
                                     'superseded'
                                   )),
  projected_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_projection_jobs_workspace_contact_fk
    FOREIGN KEY (workspace_id, contact_id)
    REFERENCES workspace_contacts(workspace_id, contact_id),
  CONSTRAINT payment_projection_jobs_delivery_state_check
    CHECK (
      (state = 'waiting_delivery' AND delivered_at IS NULL)
      OR (state IN ('pending', 'projected', 'superseded') AND delivered_at IS NOT NULL)
    ),
  CONSTRAINT payment_projection_jobs_projected_at_check
    CHECK (state <> 'projected' OR projected_at IS NOT NULL)
);

-- This is the entire acquisition path: equality on the deployment-owned
-- tenant followed by chronological keyset order, covering every value needed
-- before the later contact/offering joins. Projected/superseded history is not
-- present in the index.
CREATE INDEX payment_projection_jobs_pending_idx
  ON payment_projection_jobs (workspace_id, delivered_at, decision_id)
  INCLUDE (contact_id, outbound_message_id, offering_sku, plan_code, trace_id)
  WHERE state = 'pending';

CREATE INDEX payment_projection_jobs_contact_history_idx
  ON payment_projection_jobs (
    workspace_id,
    contact_id,
    decision_created_at DESC,
    decision_id DESC
  )
  WHERE delivered_at IS NOT NULL;

-- Conservative one-time recovery for decisions created before this durable
-- queue existed. A legacy decision is backfilled only when its contact has
-- exactly one active workspace membership whose active catalog owns the exact
-- SKU. Ambiguous/multi-tenant history is deliberately left untouched rather
-- than guessing where PII belongs.
WITH eligible AS (
  SELECT
    ad.id AS decision_id,
    tenant.workspace_id,
    turn.contact_id,
    ad.outbound_message_id,
    ad.trace_id,
    ad.business_action ->> 'offering_sku' AS offering_sku,
    ad.business_action ->> 'plan_code' AS plan_code,
    ad.created_at AS decision_created_at,
    od.state AS delivery_state,
    COALESCE(od.delivered_at, od.submitted_at, od.updated_at) AS physical_at
  FROM agent_decisions AS ad
  JOIN messages AS turn ON turn.id = ad.turn_id
  JOIN outbound_deliveries AS od ON od.message_id = ad.outbound_message_id
  JOIN LATERAL (
    SELECT min(wc.workspace_id::text)::uuid AS workspace_id
    FROM workspace_contacts AS wc
    JOIN offerings AS offering
      ON offering.workspace_id = wc.workspace_id
      AND offering.code = ad.business_action ->> 'offering_sku'
      AND offering.status = 'active'
    WHERE wc.contact_id = turn.contact_id
      AND wc.lifecycle_status = 'active'
    HAVING count(*) = 1
  ) AS tenant ON true
  WHERE ad.business_action ->> 'type' = 'send_payment_link'
    AND ad.outbound_message_id IS NOT NULL
), ranked AS (
  SELECT
    eligible.*,
    CASE
      WHEN delivery_state IN ('submitted', 'delivered') THEN
        row_number() OVER (
          PARTITION BY workspace_id, contact_id,
            (delivery_state IN ('submitted', 'delivered'))
          ORDER BY decision_created_at DESC, decision_id DESC
        )
      ELSE NULL
    END AS delivered_rank
  FROM eligible
)
INSERT INTO payment_projection_jobs (
  decision_id, workspace_id, contact_id, outbound_message_id, trace_id,
  offering_sku, plan_code, decision_created_at, delivered_at, state
)
SELECT
  decision_id,
  workspace_id,
  contact_id,
  outbound_message_id,
  trace_id,
  offering_sku,
  plan_code,
  decision_created_at,
  CASE WHEN delivery_state IN ('submitted', 'delivered') THEN physical_at END,
  CASE
    WHEN delivery_state NOT IN ('submitted', 'delivered') THEN 'waiting_delivery'
    WHEN delivered_rank = 1 THEN 'pending'
    ELSE 'superseded'
  END
FROM ranked
ON CONFLICT (decision_id) DO NOTHING;

CREATE TRIGGER payment_projection_jobs_set_updated_at
BEFORE UPDATE ON payment_projection_jobs
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

ALTER TABLE payment_projection_jobs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON payment_projection_jobs TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON payment_projection_jobs FROM orchestrator_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON payment_projection_jobs FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON payment_projection_jobs FROM authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_projection_jobs'
      AND policyname = 'orchestrator_access'
  ) THEN
    EXECUTE 'CREATE POLICY orchestrator_access ON payment_projection_jobs FOR ALL TO orchestrator_role USING (true) WITH CHECK (true)';
  END IF;
END
$$;

COMMENT ON TABLE payment_projection_jobs IS
  'Tenant-bound durable payment proposal jobs. The partial pending index is the only reconciliation acquisition path; latest delivered proposal wins per workspace/contact.';

COMMIT;
