-- Phase 1 commercial state, blocking and channel permission model.
-- Existing contacts remain NULL/unclassified until an operator-approved
-- backfill. Application code must dual-read legacy status='inactivo' as blocked
-- until that review is complete.

ALTER TABLE contacts
  ADD COLUMN lifecycle_status text,
  ADD COLUMN sales_stage text,
  ADD COLUMN blocked_at timestamptz,
  ADD COLUMN blocked_reason text;

ALTER TABLE contacts
  ALTER COLUMN lifecycle_status SET DEFAULT 'active',
  ALTER COLUMN sales_stage SET DEFAULT 'new';

ALTER TABLE contacts
  ADD CONSTRAINT contacts_lifecycle_status_check
  CHECK (lifecycle_status IS NULL OR lifecycle_status IN ('active', 'blocked', 'deleted'))
  NOT VALID,
  ADD CONSTRAINT contacts_sales_stage_check
  CHECK (sales_stage IS NULL OR sales_stage IN ('new', 'qualified', 'offered', 'won', 'lost'))
  NOT VALID,
  ADD CONSTRAINT contacts_block_details_check
  CHECK (
    lifecycle_status IS NULL
    OR (lifecycle_status = 'blocked' AND blocked_at IS NOT NULL)
    OR (lifecycle_status = 'active' AND blocked_at IS NULL)
    OR lifecycle_status = 'deleted'
  )
  NOT VALID;

CREATE TABLE contact_channel_permissions (
  contact_id               uuid        NOT NULL REFERENCES contacts(id),
  channel                  text        NOT NULL CHECK (channel IN ('whatsapp', 'voice')),
  consent_status           text        NOT NULL DEFAULT 'unknown'
                                     CHECK (consent_status IN ('unknown', 'granted', 'revoked')),
  consent_source           text,
  evidence_event_id        uuid,
  reply_window_expires_at  timestamptz,
  changed_at               timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (contact_id, channel)
);

CREATE TABLE consent_events (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key          text        NOT NULL UNIQUE CHECK (btrim(event_key) <> ''),
  contact_id         uuid        NOT NULL REFERENCES contacts(id),
  channel            text        NOT NULL CHECK (channel IN ('whatsapp', 'voice')),
  consent_status     text        NOT NULL CHECK (consent_status IN ('unknown', 'granted', 'revoked')),
  source             text        NOT NULL CHECK (btrim(source) <> ''),
  source_event_id    uuid        REFERENCES channel_events(id),
  evidence           jsonb,
  occurred_at        timestamptz NOT NULL,
  recorded_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX consent_events_source_event_uq
  ON consent_events (source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE UNIQUE INDEX consent_events_id_contact_channel_uq
  ON consent_events (id, contact_id, channel);

ALTER TABLE contact_channel_permissions
  ADD CONSTRAINT contact_permissions_evidence_same_contact_channel_fk
  FOREIGN KEY (evidence_event_id, contact_id, channel)
  REFERENCES consent_events (id, contact_id, channel)
  NOT VALID;

ALTER TABLE contact_channel_permissions
  VALIDATE CONSTRAINT contact_permissions_evidence_same_contact_channel_fk;

CREATE INDEX consent_events_contact_history_idx
  ON consent_events (contact_id, channel, occurred_at DESC, id DESC);

CREATE TRIGGER contact_channel_permissions_set_updated_at
BEFORE UPDATE ON contact_channel_permissions
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

-- Idempotently append permission evidence and update the current projection.
-- Older/out-of-order provider events are retained in consent_events but never
-- overwrite a newer current permission.
CREATE OR REPLACE FUNCTION public.record_contact_permission_event(
  p_event_key       text,
  p_contact_id      uuid,
  p_channel         text,
  p_consent_status  text,
  p_source          text,
  p_source_event_id uuid,
  p_evidence        jsonb,
  p_occurred_at     timestamptz
)
RETURNS TABLE (
  consent_event_id uuid,
  was_created      boolean,
  projection_applied boolean,
  current_status   text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event_id      uuid;
  v_created       boolean := false;
  v_applied       boolean := false;
  v_current       text;
  v_affected      bigint;
  v_existing      public.consent_events%ROWTYPE;
BEGIN
  INSERT INTO public.consent_events (
    event_key,
    contact_id,
    channel,
    consent_status,
    source,
    source_event_id,
    evidence,
    occurred_at
  )
  VALUES (
    p_event_key,
    p_contact_id,
    p_channel,
    p_consent_status,
    p_source,
    p_source_event_id,
    p_evidence,
    p_occurred_at
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_event_id;

  IF FOUND THEN
    v_created := true;

    INSERT INTO public.contact_channel_permissions (
      contact_id,
      channel,
      consent_status,
      consent_source,
      evidence_event_id,
      changed_at
    )
    VALUES (
      p_contact_id,
      p_channel,
      p_consent_status,
      p_source,
      v_event_id,
      p_occurred_at
    )
    ON CONFLICT (contact_id, channel) DO UPDATE
    SET
      consent_status = EXCLUDED.consent_status,
      consent_source = EXCLUDED.consent_source,
      evidence_event_id = EXCLUDED.evidence_event_id,
      changed_at = EXCLUDED.changed_at
    WHERE EXCLUDED.changed_at >= contact_channel_permissions.changed_at;

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    v_applied := v_affected > 0;
  ELSE
    SELECT ce.*
      INTO v_existing
    FROM public.consent_events AS ce
    WHERE ce.event_key = p_event_key
       OR (p_source_event_id IS NOT NULL AND ce.source_event_id = p_source_event_id)
    ORDER BY (ce.event_key = p_event_key) DESC
    LIMIT 1;

    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Consent event conflicted with an unknown unique constraint';
    END IF;

    IF v_existing.event_key IS DISTINCT FROM p_event_key
       OR v_existing.contact_id IS DISTINCT FROM p_contact_id
       OR v_existing.channel IS DISTINCT FROM p_channel
       OR v_existing.consent_status IS DISTINCT FROM p_consent_status
       OR v_existing.source IS DISTINCT FROM p_source
       OR v_existing.source_event_id IS DISTINCT FROM p_source_event_id
       OR v_existing.evidence IS DISTINCT FROM p_evidence
       OR v_existing.occurred_at IS DISTINCT FROM p_occurred_at THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Consent idempotency key is already bound to different data';
    END IF;

    v_event_id := v_existing.id;
  END IF;

  SELECT ccp.consent_status
    INTO v_current
  FROM public.contact_channel_permissions AS ccp
  WHERE ccp.contact_id = p_contact_id
    AND ccp.channel = p_channel;

  RETURN QUERY SELECT v_event_id, v_created, v_applied, v_current;
END
$$;

GRANT SELECT, INSERT, UPDATE ON contact_channel_permissions TO orchestrator_role;
GRANT SELECT, INSERT ON consent_events TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON contact_channel_permissions, consent_events FROM orchestrator_role;
REVOKE UPDATE ON consent_events FROM orchestrator_role;

GRANT EXECUTE ON FUNCTION public.record_contact_permission_event(
  text, uuid, text, text, text, uuid, jsonb, timestamptz
) TO orchestrator_role;
REVOKE EXECUTE ON FUNCTION public.record_contact_permission_event(
  text, uuid, text, text, text, uuid, jsonb, timestamptz
) FROM PUBLIC;

COMMENT ON COLUMN contacts.lifecycle_status IS
  'Operational blocking/lifecycle; intentionally independent from sales_stage and channel consent.';

COMMENT ON COLUMN contacts.sales_stage IS
  'Commercial funnel state; lost is not equivalent to blocked or revoked consent.';

COMMENT ON TABLE consent_events IS
  'Append-only evidence ledger; current permission is projected into contact_channel_permissions.';

COMMENT ON COLUMN contact_channel_permissions.reply_window_expires_at IS
  'Provider-policy reply window; it does not itself grant proactive commercial consent.';
