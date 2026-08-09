-- Phase 2 — Sandbox identity table for canal-agnostic architecture.
--
-- Aditiva. No modifica `contacts` ni ninguna tabla previa. Se usa junto con:
--   - provider = 'telegram_sandbox' en channel_events / channel_threads
--     (aísla toda idempotencia frente a producción por su UNIQUE (provider, ...))
--   - teléfono sintético +999 + user id (E.164 estricto, no marcable)
--   - `contacts.phone` recibe el sintético; NOT NULL / UNIQUE se cumple.
--
-- Objetivo:
--   1. Auditar qué contactos son de sandbox y a qué usuario externo corresponden.
--   2. Habilitar el candado anti-efectos-reales: cualquier fila aquí bloquea
--      llamadas Retell, cobros, envíos WhatsApp de producción y filas en Sheets
--      de producción para ese `contact_id`.
--   3. Purga en un solo paso al migrar a producción real:
--        DELETE FROM contacts WHERE id IN (SELECT contact_id FROM sandbox_identities);
--        DROP TABLE sandbox_identities;

CREATE TABLE sandbox_identities (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text        NOT NULL,
  external_user_id  text        NOT NULL,
  contact_id        uuid        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  synthetic_phone   text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sandbox_identities_provider_check
    CHECK (provider IN ('telegram_sandbox')),
  CONSTRAINT sandbox_identities_synthetic_phone_prefix_check
    CHECK (synthetic_phone LIKE '+999%'),
  CONSTRAINT sandbox_identities_synthetic_phone_e164_check
    CHECK (synthetic_phone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT sandbox_identities_provider_user_uq
    UNIQUE (provider, external_user_id),
  CONSTRAINT sandbox_identities_synthetic_phone_uq
    UNIQUE (synthetic_phone),
  CONSTRAINT sandbox_identities_contact_uq
    UNIQUE (contact_id)
);

CREATE INDEX sandbox_identities_contact_idx ON sandbox_identities (contact_id);

COMMENT ON TABLE sandbox_identities IS
  'Rows here mark a contact as sandbox-only. Presence blocks all real side effects.';
COMMENT ON COLUMN sandbox_identities.provider IS
  'External sandbox origin (e.g. telegram_sandbox). Must be aligned with the provider used in channel_events / channel_threads for the same contact.';
COMMENT ON COLUMN sandbox_identities.external_user_id IS
  'Native id from the sandbox origin (Telegram user id). Not routable.';
COMMENT ON COLUMN sandbox_identities.synthetic_phone IS
  'The +999-prefixed phone injected into contacts.phone. E.164 valid, non-dialable.';
