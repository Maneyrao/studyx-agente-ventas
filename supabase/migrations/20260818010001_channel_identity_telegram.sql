-- Feature 007 — Direct outbound delivery: admit `telegram` as a channel and
-- allow a channel identity to be retired without deleting it.
--
-- Why this is additive despite touching CHECK constraints:
--   Widening a CHECK only admits one more value. Every existing row stays
--   valid, nothing is rewritten and nothing is destroyed. No applied migration
--   is edited; this file is a new, forward-only step.
--
-- Why no new identity table:
--   `channel_threads` already stores (contact_id, provider, integration_id,
--   channel, external_conversation_id) with the UNIQUE that guarantees one
--   identity belongs to exactly one contact. For Telegram the chat id *is* the
--   conversation id, so it fits without bending the semantics. Adding a second
--   identity table would guarantee divergence between the two over time.
--
-- Why `unusable_at` instead of DELETE:
--   Constitution IV. The orchestrator role has no DELETE on critical tables,
--   and a retired identity is evidence: it explains why a contact stopped
--   being reachable. It can also come back — a contact who blocked the bot may
--   write again — so the row must survive.

-- ---------------------------------------------------------------------------
-- 1. Admit 'telegram' wherever a channel is constrained.
-- ---------------------------------------------------------------------------
-- The original CHECKs were inline and unnamed, so PostgreSQL generated their
-- names. Rather than hardcode generated names, drop whatever CHECK currently
-- constrains the `channel` column and re-add it under an explicit, stable name
-- so every future migration can target it directly.

-- `contacts` is in this list on purpose: it constrains `channel_origin`, not
-- `channel`, and contact creation during ingestion writes it. Leaving it out
-- would let every other table accept 'telegram' while the very first insert of
-- a Telegram-originated contact still failed.

DO $$
DECLARE
  target    record;
  existing  text;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('conversations',               'channel'),
      ('channel_threads',             'channel'),
      ('channel_events',              'channel'),
      ('contact_channel_permissions', 'channel'),
      ('consent_events',              'channel'),
      ('outbound_deliveries',         'channel'),
      ('contacts',                    'channel_origin')
    ) AS t(table_name, column_name)
  LOOP
    FOR existing IN
      SELECT con.conname
      FROM pg_constraint AS con
      JOIN pg_class      AS cls ON cls.oid = con.conrelid
      JOIN pg_namespace  AS nsp ON nsp.oid = cls.relnamespace
      WHERE nsp.nspname = 'public'
        AND cls.relname = target.table_name
        AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) LIKE '%' || target.column_name || '%'
        AND pg_get_constraintdef(con.oid) LIKE '%whatsapp%'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', target.table_name, existing);
    END LOOP;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I IN (''whatsapp'', ''voice'', ''telegram'')) NOT VALID',
      target.table_name,
      target.table_name || '_' || target.column_name || '_check',
      target.column_name
    );
    EXECUTE format(
      'ALTER TABLE public.%I VALIDATE CONSTRAINT %I',
      target.table_name,
      target.table_name || '_' || target.column_name || '_check'
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Logical retirement of a channel identity.
-- ---------------------------------------------------------------------------
-- Set when the provider reports a permanent rejection: the user blocked the
-- bot, the account is gone, the chat does not exist. Retrying against such an
-- identity can only produce the same answer, so it stops being selectable.

ALTER TABLE channel_threads
  ADD COLUMN IF NOT EXISTS unusable_at     timestamptz,
  ADD COLUMN IF NOT EXISTS unusable_reason text;

ALTER TABLE channel_threads
  DROP CONSTRAINT IF EXISTS channel_threads_unusable_reason_check;

-- A reason without a timestamp is a half-recorded fact, and a retirement with
-- no reason is unauditable. They travel together or not at all.
ALTER TABLE channel_threads
  ADD CONSTRAINT channel_threads_unusable_reason_check
  CHECK (
    (unusable_at IS NULL AND unusable_reason IS NULL)
    OR (unusable_at IS NOT NULL AND btrim(coalesce(unusable_reason, '')) <> '')
  );

-- Channel selection reads only usable identities, most recently seen first.
CREATE INDEX IF NOT EXISTS channel_threads_usable_idx
  ON channel_threads (contact_id, channel, last_seen_at DESC)
  WHERE unusable_at IS NULL;

COMMENT ON COLUMN channel_threads.unusable_at IS
  'Set when the provider permanently rejected this identity. Excluded from channel selection. Never deleted: it explains why a contact became unreachable, and it can be cleared if they come back.';
COMMENT ON COLUMN channel_threads.unusable_reason IS
  'Stable provider-independent code for the retirement (e.g. TELEGRAM_BLOCKED, WHATSAPP_NOT_A_USER).';
