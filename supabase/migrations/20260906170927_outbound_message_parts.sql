-- One Agent A decision may intentionally produce up to three customer-visible
-- messages. Existing and single-part messages remain part zero, preserving the
-- historical one-reply-per-turn idempotency guarantee.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS part_index integer NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS public.messages_in_reply_to_unique;

CREATE UNIQUE INDEX messages_in_reply_to_part_unique
  ON public.messages (in_reply_to, part_index)
  WHERE in_reply_to IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agent_decision_outbound_parts (
  decision_id uuid NOT NULL REFERENCES public.agent_decisions(id) ON DELETE CASCADE,
  part_index integer NOT NULL CHECK (part_index >= 0 AND part_index <= 2),
  message_id uuid NOT NULL REFERENCES public.messages(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (decision_id, part_index)
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_decision_outbound_parts_message_uq
  ON public.agent_decision_outbound_parts (message_id);

COMMENT ON COLUMN public.messages.part_index IS
  'Zero-based physical outbound part index. Existing and single-part messages remain 0.';
