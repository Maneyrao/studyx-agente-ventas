-- Authorized related-course bonuses for StudyX.
--
-- Agent A may propose a configured promotion, but PostgreSQL remains the
-- authority for eligibility, delayed review state and the immutable benefit
-- attached to a payment. New promotions are disabled by default.

CREATE TABLE public.promotions (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                uuid        NOT NULL REFERENCES public.workspaces(id),
  promotion_code              text        NOT NULL CHECK (promotion_code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  paid_offering_id            uuid        NOT NULL REFERENCES public.offerings(id),
  channels                    text[]      NOT NULL DEFAULT ARRAY['text']::text[],
  active                      boolean     NOT NULL DEFAULT false,
  valid_from                  timestamptz,
  valid_until                 timestamptz,
  max_redemptions_per_contact integer     NOT NULL DEFAULT 1
                                          CHECK (max_redemptions_per_contact BETWEEN 1 AND 3),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, promotion_code),
  CHECK (cardinality(channels) BETWEEN 1 AND 2),
  CHECK (channels <@ ARRAY['text','voice']::text[]),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
);

CREATE TRIGGER promotions_set_updated_at
BEFORE UPDATE ON public.promotions
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_promotion_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_offering_workspace uuid;
  v_unique_channel_count integer;
BEGIN
  SELECT workspace_id INTO v_offering_workspace
  FROM public.offerings WHERE id = NEW.paid_offering_id;

  IF v_offering_workspace IS NULL OR v_offering_workspace IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Promotion paid offering must belong to the same workspace';
  END IF;

  SELECT count(DISTINCT channel) INTO v_unique_channel_count
  FROM unnest(NEW.channels) AS channel;
  IF v_unique_channel_count IS DISTINCT FROM cardinality(NEW.channels) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Promotion channels must be unique';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER promotions_enforce_identity
BEFORE INSERT OR UPDATE ON public.promotions
FOR EACH ROW EXECUTE FUNCTION public.enforce_promotion_identity();

CREATE TABLE public.promotion_bonus_offerings (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id  uuid        NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  workspace_id  uuid        NOT NULL REFERENCES public.workspaces(id),
  offering_id   uuid        NOT NULL REFERENCES public.offerings(id),
  position      integer     NOT NULL CHECK (position BETWEEN 1 AND 3),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promotion_id, offering_id),
  UNIQUE (promotion_id, position)
);

CREATE OR REPLACE FUNCTION public.enforce_promotion_bonus_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_promotion_workspace uuid;
  v_paid_offering_id uuid;
  v_bonus_workspace uuid;
BEGIN
  SELECT workspace_id, paid_offering_id
  INTO v_promotion_workspace, v_paid_offering_id
  FROM public.promotions WHERE id = NEW.promotion_id;

  SELECT workspace_id INTO v_bonus_workspace
  FROM public.offerings WHERE id = NEW.offering_id;

  IF NEW.offering_id = v_paid_offering_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Bonus offering must be different from the paid offering';
  END IF;
  IF v_promotion_workspace IS NULL
     OR v_bonus_workspace IS NULL
     OR NEW.workspace_id IS DISTINCT FROM v_promotion_workspace
     OR v_bonus_workspace IS DISTINCT FROM v_promotion_workspace THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Promotion and bonus offering must belong to the same workspace';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER promotion_bonus_offerings_enforce_identity
BEFORE INSERT OR UPDATE ON public.promotion_bonus_offerings
FOR EACH ROW EXECUTE FUNCTION public.enforce_promotion_bonus_identity();

CREATE TABLE public.promotion_offers (
  id                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                 uuid        NOT NULL REFERENCES public.workspaces(id),
  contact_id                   uuid        NOT NULL REFERENCES public.contacts(id),
  conversation_id              uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  promotion_id                 uuid        NOT NULL REFERENCES public.promotions(id),
  paid_offering_id             uuid        NOT NULL REFERENCES public.offerings(id),
  status                       text        NOT NULL DEFAULT 'pending_review'
                                           CHECK (status IN (
                                             'pending_review','offered','accepted','cancelled','expired','attached'
                                           )),
  source_turn_id               uuid,
  source_conversation_version  bigint,
  source_state_version         integer,
  offered_outbound_message_id  uuid        UNIQUE REFERENCES public.messages(id),
  payment_id                   uuid        UNIQUE REFERENCES public.payments(id),
  offered_at                   timestamptz,
  accepted_at                  timestamptz,
  expires_at                   timestamptz,
  cancel_reason                text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (status <> 'offered' OR (offered_at IS NOT NULL AND offered_outbound_message_id IS NOT NULL)),
  CHECK (status NOT IN ('accepted','attached') OR accepted_at IS NOT NULL),
  CHECK (status <> 'attached' OR payment_id IS NOT NULL)
);

CREATE INDEX promotion_offers_conversation_idx
  ON public.promotion_offers (workspace_id, conversation_id, created_at DESC);
CREATE UNIQUE INDEX promotion_offers_one_live_rule_uq
  ON public.promotion_offers (conversation_id, promotion_id)
  WHERE status IN ('pending_review','offered','accepted');

CREATE TRIGGER promotion_offers_set_updated_at
BEFORE UPDATE ON public.promotion_offers
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_promotion_offer_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_promotion_workspace uuid;
  v_promotion_paid_offering uuid;
  v_conversation_contact uuid;
  v_conversation_workspace uuid;
  v_payment_workspace uuid;
  v_payment_contact uuid;
  v_payment_offering uuid;
BEGIN
  SELECT workspace_id, paid_offering_id
  INTO v_promotion_workspace, v_promotion_paid_offering
  FROM public.promotions WHERE id = NEW.promotion_id;

  SELECT conversation.contact_id,
         NULLIF(to_jsonb(conversation)->>'workspace_id', '')::uuid
  INTO v_conversation_contact, v_conversation_workspace
  FROM public.conversations AS conversation
  WHERE conversation.id = NEW.conversation_id;

  IF v_promotion_workspace IS NULL
     OR v_promotion_workspace IS DISTINCT FROM NEW.workspace_id
     OR v_promotion_paid_offering IS DISTINCT FROM NEW.paid_offering_id
     OR v_conversation_contact IS DISTINCT FROM NEW.contact_id
     OR v_conversation_workspace IS DISTINCT FROM NEW.workspace_id
     OR NOT EXISTS (
       SELECT 1 FROM public.workspace_contacts wc
       WHERE wc.workspace_id = NEW.workspace_id AND wc.contact_id = NEW.contact_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Promotion offer identity mismatch';
  END IF;

  IF NEW.payment_id IS NOT NULL THEN
    SELECT workspace_id, contact_id, offering_id
    INTO v_payment_workspace, v_payment_contact, v_payment_offering
    FROM public.payments WHERE id = NEW.payment_id;
    IF v_payment_workspace IS DISTINCT FROM NEW.workspace_id
       OR v_payment_contact IS DISTINCT FROM NEW.contact_id
       OR v_payment_offering IS DISTINCT FROM NEW.paid_offering_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Promotion offer payment identity mismatch';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER promotion_offers_enforce_identity
BEFORE INSERT OR UPDATE ON public.promotion_offers
FOR EACH ROW EXECUTE FUNCTION public.enforce_promotion_offer_identity();

CREATE TABLE public.course_bonus_followups (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id                    uuid        NOT NULL REFERENCES public.promotion_offers(id) ON DELETE CASCADE,
  kind                        text        NOT NULL CHECK (kind IN ('price_objection_checkin','promotion_review')),
  due_at                      timestamptz NOT NULL,
  status                      text        NOT NULL DEFAULT 'pending'
                                          CHECK (status IN ('pending','processing','sent','cancelled','ambiguous','dead_letter')),
  idempotency_key             text        NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  expected_conversation_seq   bigint,
  source_outbound_message_id  uuid        REFERENCES public.messages(id),
  delivered_message_id        uuid        UNIQUE REFERENCES public.messages(id),
  claim_token                 uuid,
  claimed_by                  text,
  lease_until                 timestamptz,
  attempt_count               integer     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts                integer     NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  terminal_reason             text,
  provider_event_id           text UNIQUE,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  sent_at                     timestamptz,
  CHECK (
    (status = 'processing' AND claim_token IS NOT NULL AND claimed_by IS NOT NULL AND lease_until IS NOT NULL)
    OR status <> 'processing'
  ),
  CHECK (status <> 'sent' OR (sent_at IS NOT NULL AND delivered_message_id IS NOT NULL))
);

CREATE INDEX course_bonus_followups_due_idx
  ON public.course_bonus_followups (due_at, created_at)
  WHERE status IN ('pending','processing');

CREATE TRIGGER course_bonus_followups_set_updated_at
BEFORE UPDATE ON public.course_bonus_followups
FOR EACH ROW EXECUTE FUNCTION public.phase1_set_updated_at();

CREATE OR REPLACE FUNCTION public.claim_course_bonus_followups(
  p_worker_id text,
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF public.course_bonus_followups
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH candidates AS (
    SELECT f.id
    FROM public.course_bonus_followups f
    WHERE f.due_at <= now()
      AND f.attempt_count < f.max_attempts
      AND (
        f.status = 'pending'
        OR (f.status = 'processing' AND (f.lease_until IS NULL OR f.lease_until <= now()))
      )
    ORDER BY f.due_at, f.created_at, f.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 0), 100)
  )
  UPDATE public.course_bonus_followups f
  SET status = 'processing',
      claim_token = gen_random_uuid(),
      claimed_by = p_worker_id,
      lease_until = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 1), 3600)),
      attempt_count = f.attempt_count + 1,
      updated_at = now()
  FROM candidates c
  WHERE f.id = c.id
  RETURNING f.*
$$;

CREATE TABLE public.payment_bonus_offerings (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id                      uuid        NOT NULL REFERENCES public.payments(id),
  promotion_id                    uuid        NOT NULL REFERENCES public.promotions(id),
  offering_id                     uuid        NOT NULL REFERENCES public.offerings(id),
  promotion_code_snapshot         text        NOT NULL CHECK (btrim(promotion_code_snapshot) <> ''),
  offering_code_snapshot          text        NOT NULL CHECK (btrim(offering_code_snapshot) <> ''),
  offering_display_name_snapshot  text        NOT NULL CHECK (btrim(offering_display_name_snapshot) <> ''),
  position                        integer     NOT NULL CHECK (position BETWEEN 1 AND 3),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, offering_id),
  UNIQUE (payment_id, position)
);

CREATE OR REPLACE FUNCTION public.enforce_payment_bonus_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_payment_workspace uuid;
  v_payment_offering uuid;
  v_payment_status text;
  v_promotion_workspace uuid;
  v_promotion_paid uuid;
  v_promotion_code text;
  v_offering_code text;
  v_offering_name text;
BEGIN
  SELECT workspace_id, offering_id, status
  INTO v_payment_workspace, v_payment_offering, v_payment_status
  FROM public.payments WHERE id = NEW.payment_id;
  IF v_payment_status IS DISTINCT FROM 'reserved' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Bonus snapshot payment must be reserved';
  END IF;

  SELECT workspace_id, paid_offering_id, promotion_code
  INTO v_promotion_workspace, v_promotion_paid, v_promotion_code
  FROM public.promotions WHERE id = NEW.promotion_id;
  IF v_promotion_workspace IS DISTINCT FROM v_payment_workspace
     OR v_promotion_paid IS DISTINCT FROM v_payment_offering THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Bonus snapshot promotion does not match payment';
  END IF;

  SELECT code, display_name INTO v_offering_code, v_offering_name
  FROM public.offerings WHERE id = NEW.offering_id AND workspace_id = v_payment_workspace;
  IF v_offering_code IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.promotion_bonus_offerings pbo
    WHERE pbo.promotion_id = NEW.promotion_id AND pbo.offering_id = NEW.offering_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Bonus snapshot offering is not authorized';
  END IF;
  IF NEW.promotion_code_snapshot IS DISTINCT FROM v_promotion_code
     OR NEW.offering_code_snapshot IS DISTINCT FROM v_offering_code
     OR NEW.offering_display_name_snapshot IS DISTINCT FROM v_offering_name THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Bonus snapshot facts do not match canonical promotion';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER payment_bonus_offerings_enforce_insert
BEFORE INSERT ON public.payment_bonus_offerings
FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_bonus_snapshot();

CREATE OR REPLACE FUNCTION public.course_bonus_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = TG_TABLE_NAME || ' is append-only';
END
$$;

CREATE TRIGGER payment_bonus_offerings_block_mutation
BEFORE UPDATE OR DELETE ON public.payment_bonus_offerings
FOR EACH ROW EXECUTE FUNCTION public.course_bonus_append_only();

CREATE TABLE public.central_bonus_enrollment_items (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  central_enrollment_id uuid        NOT NULL REFERENCES public.central_enrollments(id) ON DELETE CASCADE,
  payment_id            uuid        NOT NULL REFERENCES public.payments(id),
  offering_code         text        NOT NULL CHECK (btrim(offering_code) <> ''),
  enrollment_id         text        NOT NULL CHECK (btrim(enrollment_id) <> ''),
  enrollment_status     text        NOT NULL CHECK (enrollment_status IN ('active','already_enrolled')),
  position              integer     NOT NULL CHECK (position BETWEEN 1 AND 3),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, offering_code),
  UNIQUE (payment_id, position)
);

CREATE OR REPLACE FUNCTION public.enforce_central_bonus_enrollment_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_enrollment_payment uuid;
BEGIN
  SELECT payment_id INTO v_enrollment_payment
  FROM public.central_enrollments WHERE id = NEW.central_enrollment_id;
  IF v_enrollment_payment IS DISTINCT FROM NEW.payment_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Central bonus enrollment payment mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_bonus_offerings pbo
    WHERE pbo.payment_id = NEW.payment_id
      AND pbo.offering_code_snapshot = NEW.offering_code
      AND pbo.position = NEW.position
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Central bonus enrollment is not in the payment snapshot';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER central_bonus_enrollment_items_enforce_insert
BEFORE INSERT ON public.central_bonus_enrollment_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_central_bonus_enrollment_item();

CREATE TRIGGER central_bonus_enrollment_items_block_mutation
BEFORE UPDATE OR DELETE ON public.central_bonus_enrollment_items
FOR EACH ROW EXECUTE FUNCTION public.course_bonus_append_only();

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_bonus_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_bonus_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_bonus_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.central_bonus_enrollment_items ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orchestrator_role') THEN
    FOREACH v_table IN ARRAY ARRAY[
      'promotions','promotion_bonus_offerings','promotion_offers','course_bonus_followups',
      'payment_bonus_offerings','central_bonus_enrollment_items'
    ] LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO orchestrator_role', v_table);
      EXECUTE format('REVOKE DELETE, TRUNCATE ON public.%I FROM orchestrator_role', v_table);
      EXECUTE format(
        'CREATE POLICY orchestrator_access ON public.%I FOR ALL TO orchestrator_role USING (true) WITH CHECK (true)',
        v_table
      );
    END LOOP;
    GRANT EXECUTE ON FUNCTION public.claim_course_bonus_followups(text,integer,integer) TO orchestrator_role;
  END IF;
END
$$;

DO $$
DECLARE
  v_role text;
  v_table text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      FOREACH v_table IN ARRAY ARRAY[
        'promotions','promotion_bonus_offerings','promotion_offers','course_bonus_followups',
        'payment_bonus_offerings','central_bonus_enrollment_items'
      ] LOOP
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', v_table, v_role);
      END LOOP;
    END IF;
  END LOOP;
END
$$;

-- Existing deployments already have the StudyX catalog when this migration
-- runs. Clean resets receive the same inactive rule from the dedicated seed.
DO $$
DECLARE
  v_workspace uuid;
  v_paid uuid;
  v_bonus uuid;
  v_promotion uuid;
BEGIN
  SELECT id INTO v_workspace FROM public.workspaces WHERE slug = 'studyx';
  IF v_workspace IS NULL THEN RETURN; END IF;
  SELECT id INTO v_paid FROM public.offerings WHERE workspace_id = v_workspace AND code = 'ingles_1';
  SELECT id INTO v_bonus FROM public.offerings WHERE workspace_id = v_workspace AND code = 'ingles_2';
  IF v_paid IS NULL OR v_bonus IS NULL THEN RETURN; END IF;

  INSERT INTO public.promotions (workspace_id, promotion_code, paid_offering_id, channels, active)
  VALUES (v_workspace, 'ingles_1_mas_ingles_2', v_paid, ARRAY['text','voice']::text[], false)
  ON CONFLICT (workspace_id, promotion_code) DO NOTHING
  RETURNING id INTO v_promotion;
  IF v_promotion IS NULL THEN
    SELECT id INTO v_promotion FROM public.promotions
    WHERE workspace_id = v_workspace AND promotion_code = 'ingles_1_mas_ingles_2';
  END IF;
  INSERT INTO public.promotion_bonus_offerings (promotion_id, workspace_id, offering_id, position)
  VALUES (v_promotion, v_workspace, v_bonus, 1)
  ON CONFLICT (promotion_id, offering_id) DO NOTHING;
END
$$;

COMMENT ON TABLE public.promotions IS 'Backend-authorized related-course promotion rules; inactive by default.';
COMMENT ON TABLE public.promotion_offers IS 'Auditable review, delivery and acceptance lifecycle for one authorized promotion.';
COMMENT ON TABLE public.course_bonus_followups IS 'Durable StudyX price-objection check-ins and one-minute promotion reviews.';
COMMENT ON TABLE public.payment_bonus_offerings IS 'Immutable promotion facts frozen before a payment URL can be delivered.';
COMMENT ON TABLE public.central_bonus_enrollment_items IS 'Verified Central v2 enrollment results for frozen bonus courses.';
