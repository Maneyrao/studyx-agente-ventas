-- Owner 2026-11-10: «dale, sí» + «cuáles me quedarían bonificados?» arrived as
-- two batches; the second superseded the first turn and the first message's
-- intent was lost. A bonus was also rejected because its motive was in the
-- message sent nine seconds earlier.
--
-- One definition of the customer's current intervention: the turn's own
-- batch plus the consecutive earlier inbound messages that the agent has not
-- answered. "Answered" is decided by the durable decision, never by clocks
-- (provider time and commit time are different clocks): a message is answered
-- when its batch has an agent decision other than the suppression written
-- because a newer inbound superseded it. The walk back stops at the first
-- answered message and never goes further than 30 minutes or 20 messages.
BEGIN;

CREATE OR REPLACE FUNCTION public.agent_intervention_inbound_v1(p_turn_id uuid)
RETURNS TABLE (id uuid, content text, conversation_seq bigint, batch_id uuid, metadata jsonb,
  created_at timestamptz, occurred_at timestamptz)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  WITH turn AS (
    SELECT m.conversation_id, m.contact_id, m.batch_id, m.id
    FROM public.messages m WHERE m.id = p_turn_id AND m.direction = 'inbound'
  ), own AS (
    SELECT m.id, public.message_occurrence_v1(m.metadata, m.created_at) AS at, m.conversation_seq AS seq
    FROM public.messages m JOIN turn t ON t.conversation_id = m.conversation_id
      AND t.contact_id = m.contact_id AND m.direction = 'inbound'
      AND (m.id = t.id OR (t.batch_id IS NOT NULL AND m.batch_id = t.batch_id))
  ), upper_bound AS (
    SELECT o.at, o.seq FROM own o ORDER BY o.at DESC, o.seq DESC LIMIT 1
  ), earlier AS (
    SELECT m.id, public.message_occurrence_v1(m.metadata, m.created_at) AS at, m.conversation_seq AS seq,
      EXISTS (
        SELECT 1 FROM public.agent_decisions d JOIN public.messages dm ON dm.id = d.turn_id
        WHERE (dm.id = m.id OR (m.batch_id IS NOT NULL AND dm.batch_id = m.batch_id))
          AND NOT (d.decision_kind = 'suppress' AND d.reason_code = 'SUPERSEDED_BY_NEWER_INBOUND')
      ) AS answered
    FROM public.messages m JOIN turn t ON t.conversation_id = m.conversation_id AND t.contact_id = m.contact_id
    CROSS JOIN upper_bound u
    WHERE m.direction = 'inbound'
      AND m.id NOT IN (SELECT own.id FROM own)
      AND (public.message_occurrence_v1(m.metadata, m.created_at), m.conversation_seq) < (u.at, u.seq)
      AND public.message_occurrence_v1(m.metadata, m.created_at) >= u.at - interval '30 minutes'
  ), last_answered AS (
    SELECT e.at, e.seq FROM earlier e WHERE e.answered ORDER BY e.at DESC, e.seq DESC LIMIT 1
  ), picked AS (
    SELECT e.id FROM earlier e LEFT JOIN last_answered l ON true
    WHERE NOT e.answered AND (l.at IS NULL OR (e.at, e.seq) > (l.at, l.seq))
    ORDER BY e.at DESC, e.seq DESC
    LIMIT 20
  )
  SELECT x.id, x.content, x.conversation_seq, x.batch_id, x.metadata, x.created_at,
    public.message_occurrence_v1(x.metadata, x.created_at)
  FROM public.messages x WHERE x.id IN (SELECT picked.id FROM picked UNION SELECT own.id FROM own)
  ORDER BY public.message_occurrence_v1(x.metadata, x.created_at), x.conversation_seq, x.id
$$;

REVOKE ALL ON FUNCTION public.agent_intervention_inbound_v1(uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orchestrator_role') THEN
    GRANT EXECUTE ON FUNCTION public.agent_intervention_inbound_v1(uuid) TO orchestrator_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.agent_intervention_inbound_v1(uuid) TO service_role;
  END IF;
END $$;

COMMIT;
