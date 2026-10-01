-- A lead can consider or buy several courses while checkout remains focused
-- on exactly one canonical course at a time.
BEGIN;

CREATE TABLE lead_course_interests (
  workspace_id   uuid        NOT NULL REFERENCES workspaces(id),
  contact_id     uuid        NOT NULL REFERENCES contacts(id),
  offering_code  text        NOT NULL,
  status         text        NOT NULL DEFAULT 'selected' CHECK (status IN ('selected', 'paid')),
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  selected_at    timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz,
  PRIMARY KEY (workspace_id, contact_id, offering_code),
  FOREIGN KEY (workspace_id, contact_id)
    REFERENCES workspace_contacts(workspace_id, contact_id),
  FOREIGN KEY (workspace_id, offering_code)
    REFERENCES offerings(workspace_id, code)
);

CREATE INDEX lead_course_interests_contact_idx
  ON lead_course_interests(workspace_id, contact_id, first_seen_at);

CREATE OR REPLACE FUNCTION public.capture_selected_course_interest()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.selected_offering_code IS NOT NULL THEN
    INSERT INTO lead_course_interests (
      workspace_id, contact_id, offering_code, status, first_seen_at, last_seen_at, selected_at
    )
    SELECT NEW.workspace_id, NEW.contact_id, NEW.selected_offering_code, 'selected', now(), now(), now()
    WHERE EXISTS (
      SELECT 1 FROM workspace_contacts
      WHERE workspace_id = NEW.workspace_id AND contact_id = NEW.contact_id
    )
    ON CONFLICT (workspace_id, contact_id, offering_code) DO UPDATE
    SET last_seen_at = now(),
        selected_at = now(),
        status = CASE WHEN lead_course_interests.status = 'paid' THEN 'paid' ELSE 'selected' END;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER conversation_state_capture_course_interest
AFTER INSERT OR UPDATE OF selected_offering_code ON conversation_sales_context_states_v1
FOR EACH ROW EXECUTE FUNCTION public.capture_selected_course_interest();

CREATE TRIGGER contact_state_capture_course_interest
AFTER INSERT OR UPDATE OF selected_offering_code ON sales_context_states
FOR EACH ROW EXECUTE FUNCTION public.capture_selected_course_interest();

CREATE OR REPLACE FUNCTION public.capture_paid_course_interest()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE canonical_code text;
BEGIN
  IF NEW.status IN ('paid', 'refunded') AND NEW.paid_at IS NOT NULL THEN
    SELECT code INTO canonical_code FROM offerings WHERE id = NEW.offering_id;
    INSERT INTO lead_course_interests (
      workspace_id, contact_id, offering_code, status, first_seen_at,
      last_seen_at, selected_at, paid_at
    )
    SELECT NEW.workspace_id, NEW.contact_id, canonical_code, 'paid',
           COALESCE(NEW.paid_at, now()), now(), COALESCE(NEW.paid_at, now()), NEW.paid_at
    WHERE EXISTS (
      SELECT 1 FROM workspace_contacts
      WHERE workspace_id = NEW.workspace_id AND contact_id = NEW.contact_id
    )
    ON CONFLICT (workspace_id, contact_id, offering_code) DO UPDATE
    SET status = 'paid', last_seen_at = now(), paid_at = COALESCE(lead_course_interests.paid_at, NEW.paid_at);
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER payments_capture_course_interest
AFTER INSERT OR UPDATE OF status, paid_at ON payments
FOR EACH ROW EXECUTE FUNCTION public.capture_paid_course_interest();

INSERT INTO lead_course_interests (workspace_id, contact_id, offering_code, status, first_seen_at, last_seen_at, selected_at)
SELECT workspace_id, contact_id, selected_offering_code, 'selected', created_at, updated_at, updated_at
FROM conversation_sales_context_states_v1
WHERE selected_offering_code IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM workspace_contacts
    WHERE workspace_contacts.workspace_id = conversation_sales_context_states_v1.workspace_id
      AND workspace_contacts.contact_id = conversation_sales_context_states_v1.contact_id
  )
ON CONFLICT (workspace_id, contact_id, offering_code) DO NOTHING;

INSERT INTO lead_course_interests (
  workspace_id, contact_id, offering_code, status, first_seen_at, last_seen_at, selected_at, paid_at
)
SELECT payment.workspace_id, payment.contact_id, offering.code, 'paid', payment.paid_at,
       payment.updated_at, payment.paid_at, payment.paid_at
FROM payments AS payment
JOIN offerings AS offering ON offering.id = payment.offering_id
JOIN workspace_contacts AS membership
  ON membership.workspace_id = payment.workspace_id AND membership.contact_id = payment.contact_id
WHERE payment.status IN ('paid', 'refunded') AND payment.paid_at IS NOT NULL
ON CONFLICT (workspace_id, contact_id, offering_code) DO UPDATE
SET status = 'paid', paid_at = COALESCE(lead_course_interests.paid_at, EXCLUDED.paid_at);

ALTER TABLE lead_course_interests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON lead_course_interests TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON lead_course_interests FROM orchestrator_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON lead_course_interests FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON lead_course_interests FROM authenticated;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'lead_course_interests' AND policyname = 'orchestrator_access'
  ) THEN
    CREATE POLICY orchestrator_access ON lead_course_interests
      FOR ALL TO orchestrator_role USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
