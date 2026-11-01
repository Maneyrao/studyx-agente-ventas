import type { DbClient } from '@/lib/db/types';
import { PRICE_ONLY_BARRIER_MEMORY_KEY, PRICE_ONLY_BARRIER_STATUSES,
  type RecordedNegotiationFactsV1, type RecordedPriceOnlyBarrierV1 } from '@/shared/conversation/negotiation-facts';

type CommittedObservation = Omit<RecordedPriceOnlyBarrierV1, 'recorded_at'> & {
  workspace_id: string; conversation_id: string; contact_id: string;
};

/** Literal provenance is checked here; interpretation belongs to the agent. */
export function collectNegotiationObservationsV1(input: {
  workspace_id: string; conversation_id: string; contact_id: string; source_turn_id: string;
  offering_code: string | null;
  candidates: readonly { type: string; key: string; value: string; source_quote: string }[];
  messages: readonly { id: string; content: string }[];
}): CommittedObservation[] {
  const observations = new Map<string, CommittedObservation>();
  for (const candidate of input.candidates) {
    if (candidate.type !== 'constraint' || candidate.key !== PRICE_ONLY_BARRIER_MEMORY_KEY
      || !PRICE_ONLY_BARRIER_STATUSES.some(status => status === candidate.value)
      || !candidate.source_quote.trim()) continue;
    const source = input.messages.filter(message => message.content.includes(candidate.source_quote)).at(-1);
    if (!source) continue;
    observations.set(source.id, { workspace_id: input.workspace_id, conversation_id: input.conversation_id,
      contact_id: input.contact_id, status: candidate.value as RecordedPriceOnlyBarrierV1['status'],
      offering_code: input.offering_code, source_turn_id: input.source_turn_id,
      source_message_id: source.id, source_quote: candidate.source_quote,
      interpretation_source: 'committed_agent_observation' });
  }
  return input.messages.flatMap(message => observations.has(message.id) ? [observations.get(message.id)!] : []);
}

/** Read committed facts; never reads model drafts, vector ranking or sales eligibility. */
export async function readNegotiationFactsV1(input: {
  workspace_slug: string; conversation_id: string; contact_id: string; source_turn_id: string;
  selected_offering_code: string | null;
}, deps: { db: DbClient }): Promise<RecordedNegotiationFactsV1 | null> {
  const [row] = await deps.db<Array<RecordedNegotiationFactsV1>>`
    WITH scope AS (
      SELECT w.id workspace_id, current.id, current.conversation_id, current.contact_id, current.conversation_seq, current.metadata, current.created_at
      FROM workspaces w JOIN workspace_contacts membership ON membership.workspace_id=w.id
      JOIN messages current ON current.contact_id=membership.contact_id
      JOIN conversation_sales_context_states_v1 state ON state.workspace_id=w.id
        AND state.conversation_id=current.conversation_id AND state.contact_id=current.contact_id
      WHERE w.slug=${input.workspace_slug} AND w.status='active'
        AND current.id=${input.source_turn_id}::uuid AND current.direction='inbound'
        AND current.contact_id=${input.contact_id}::uuid AND current.conversation_id=${input.conversation_id}::uuid
        AND NOT EXISTS (SELECT 1 FROM conversation_sales_context_states_v1 other
          WHERE other.conversation_id=current.conversation_id AND other.workspace_id<>w.id)
    ), prior AS (
      SELECT source.*, decision.id decision_id, decision.memory_candidates, decision.business_action, decision.negotiation_observations
      FROM scope JOIN messages source ON source.conversation_id=scope.conversation_id
        AND source.contact_id=scope.contact_id AND source.direction='inbound'
        AND (message_occurrence_v1(source.metadata,source.created_at),coalesce(source.conversation_seq,0))
          < (message_occurrence_v1(scope.metadata,scope.created_at),coalesce(scope.conversation_seq,0))
          AND (source.conversation_seq IS NULL OR scope.conversation_seq IS NULL OR source.conversation_seq<scope.conversation_seq)
      LEFT JOIN agent_decisions decision ON decision.turn_id=source.id AND decision.decision_kind='reply'
    ), recorded_decisions AS (
      SELECT prior.id, prior.decision_id, prior.batch_id, prior.conversation_seq FROM prior
      WHERE prior.decision_id IS NOT NULL AND (
        EXISTS(SELECT 1 FROM jsonb_array_elements(prior.memory_candidates) candidate
          JOIN messages evidence ON evidence.contact_id=prior.contact_id AND evidence.conversation_id=prior.conversation_id
            AND evidence.direction='inbound' AND (evidence.id=prior.id OR
              (evidence.batch_id=prior.batch_id AND prior.batch_id IS NOT NULL))
          WHERE candidate->>'type'='objection' AND candidate->>'key'='price_objection'
            AND length(trim(candidate->>'source_quote'))>0
            AND position((candidate->>'source_quote') in evidence.content)>0)
      )
    ), recorded_memories AS (
      SELECT coalesce(linked.id, exact_source.id,
        (SELECT CASE WHEN count(*)=1 THEN min(recorded.id::text)::uuid END
          FROM recorded_decisions recorded WHERE recorded.batch_id=prior.batch_id AND prior.batch_id IS NOT NULL), prior.id) id
      FROM scope JOIN prior ON true
      JOIN selected_memories memory ON memory.source_message_id=prior.id
      LEFT JOIN recorded_decisions linked ON linked.decision_id=memory.decision_id
      LEFT JOIN recorded_decisions exact_source ON exact_source.id=prior.id
      WHERE memory.contact_id=scope.contact_id
          AND memory.conversation_id=scope.conversation_id AND memory.source_message_id=prior.id
          AND memory.memory_type='objection' AND memory.memory_key='price_objection'
          AND memory.status IN ('active','accepted','superseded')
    ), distinct_sources AS (
      SELECT DISTINCT id FROM recorded_decisions
    )
    SELECT (SELECT count(*)::int FROM distinct_sources) price_objection_count,
      ARRAY(SELECT distinct_sources.id::text FROM distinct_sources JOIN messages source ON source.id=distinct_sources.id
        ORDER BY source.conversation_seq DESC LIMIT 20) latest_price_objection_source_turn_ids,
      ARRAY(SELECT recorded_memories.id::text FROM recorded_memories JOIN messages source ON source.id=recorded_memories.id
        WHERE NOT EXISTS (SELECT 1 FROM recorded_decisions recorded WHERE recorded.id=recorded_memories.id)
        GROUP BY recorded_memories.id,source.conversation_seq ORDER BY source.conversation_seq DESC LIMIT 20) latest_legacy_price_objection_source_message_ids,
      coalesce((SELECT jsonb_build_object(
        'status', observation->>'status', 'offering_code', observation->'offering_code',
        'source_turn_id', prior.id, 'source_message_id', message.id,
        'source_quote', observation->>'source_quote', 'recorded_at', decision.created_at,
        'interpretation_source', 'committed_agent_observation')
        FROM prior JOIN agent_decisions decision ON decision.id=prior.decision_id
        CROSS JOIN LATERAL jsonb_array_elements(CASE
          WHEN jsonb_typeof(prior.negotiation_observations)='array'
          THEN prior.negotiation_observations ELSE '[]'::jsonb END) observation
        JOIN messages message ON message.id::text=observation->>'source_message_id'
        WHERE observation->>'workspace_id'=scope.workspace_id::text
          AND observation->>'conversation_id'=scope.conversation_id::text
          AND observation->>'contact_id'=scope.contact_id::text
          AND observation->>'source_turn_id'=prior.id::text
          AND (observation->>'offering_code') IS NOT DISTINCT FROM ${input.selected_offering_code}
          AND observation->>'status' IN ('confirmed','other_barriers_reported')
          AND message.direction='inbound' AND message.contact_id=scope.contact_id AND message.conversation_id=scope.conversation_id
          AND (message.id=prior.id OR (message.batch_id=prior.batch_id AND prior.batch_id IS NOT NULL))
          AND length(observation->>'source_quote')>0 AND position((observation->>'source_quote') in message.content)>0
        ORDER BY prior.conversation_seq DESC, message.conversation_seq DESC LIMIT 1),
        '{"status":"unknown"}'::jsonb) price_only_barrier
    FROM scope
  `;
  return row ?? null;
}
