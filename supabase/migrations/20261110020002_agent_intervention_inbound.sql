-- Owner 2026-11-10: «dale, sí» + «cuáles me quedarían bonificados?» arrived as
-- two batches; the second superseded the first turn and the first message's
-- intent was lost. A bonus was also rejected because its motive was in the
-- message sent nine seconds earlier.
--
-- One definition of the customer's current intervention: every inbound
-- message of the conversation since the agent's last reply, up to and
-- including the turn's own batch. A reply counts unless its delivery was
-- cancelled or dead-lettered. Bounded by that reply (and 20 messages), so it
-- never reaches older history.
BEGIN;

CREATE OR REPLACE FUNCTION public.agent_intervention_inbound_v1(p_turn_id uuid)
RETURNS TABLE (id uuid, content text, conversation_seq bigint, batch_id uuid, metadata jsonb,
  created_at timestamptz, occurred_at timestamptz)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  WITH turn AS (
    SELECT m.conversation_id, m.contact_id, m.batch_id, m.id
    FROM public.messages m WHERE m.id = p_turn_id AND m.direction = 'inbound'
  ), own AS (
    SELECT m.* FROM public.messages m JOIN turn t ON t.conversation_id = m.conversation_id
      AND t.contact_id = m.contact_id AND m.direction = 'inbound'
      AND (m.id = t.id OR (t.batch_id IS NOT NULL AND m.batch_id = t.batch_id))
  ), upper_bound AS (
    SELECT public.message_occurrence_v1(o.metadata, o.created_at) AS at, o.conversation_seq AS seq FROM own o
    ORDER BY 1 DESC, 2 DESC LIMIT 1
  ), last_reply AS (
    SELECT public.message_occurrence_v1(r.metadata, r.created_at) AS at, r.conversation_seq AS seq
    FROM public.messages r JOIN turn t ON t.conversation_id = r.conversation_id AND t.contact_id = r.contact_id
    CROSS JOIN upper_bound u
    WHERE r.direction = 'outbound'
      AND (public.message_occurrence_v1(r.metadata, r.created_at), r.conversation_seq) < (u.at, u.seq)
      AND NOT EXISTS (SELECT 1 FROM public.outbound_deliveries d WHERE d.message_id = r.id
        AND d.state IN ('cancelled', 'dead_letter'))
    ORDER BY 1 DESC, 2 DESC LIMIT 1
  ), picked AS (
    SELECT m.* FROM public.messages m JOIN turn t ON t.conversation_id = m.conversation_id
      AND t.contact_id = m.contact_id
    CROSS JOIN upper_bound u LEFT JOIN last_reply l ON true
    WHERE m.direction = 'inbound'
      AND (public.message_occurrence_v1(m.metadata, m.created_at), m.conversation_seq) <= (u.at, u.seq)
      AND (l.at IS NULL OR (public.message_occurrence_v1(m.metadata, m.created_at), m.conversation_seq) > (l.at, l.seq))
    ORDER BY public.message_occurrence_v1(m.metadata, m.created_at) DESC, m.conversation_seq DESC
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
