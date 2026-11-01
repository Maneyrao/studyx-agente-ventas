import { describe, expect, it } from 'vitest';
import { collectNegotiationObservationsV1 } from '@/features/conversation/application/read-negotiation-facts';

const identity = { workspace_id: 'workspace', conversation_id: 'conversation', contact_id: 'contact',
  source_turn_id: 'representative', offering_code: 'course' };
const observation = { type: 'constraint', key: 'price_only_barrier', value: 'confirmed', source_quote: 'Sólo el precio' };

describe('source-anchored negotiation observations', () => {
  it('anchors the agent interpretation only to literal current inbound evidence', () => {
    const [recorded] = collectNegotiationObservationsV1({ ...identity,
      candidates: [observation], messages: [{ id: 'source', content: 'Sí. Sólo el precio me frena.' }] });
    expect(recorded).toEqual({ ...identity, status: 'confirmed', source_message_id: 'source',
      source_quote: 'Sólo el precio', interpretation_source: 'committed_agent_observation' });
  });
  it('does not invent facts for missing quotes, unknown values or unrelated memory types', () => {
    for (const candidate of [{ ...observation, source_quote: 'no está' },
      { ...observation, value: 'unknown' }, { ...observation, type: 'objection' }]) {
      expect(collectNegotiationObservationsV1({ ...identity, candidates: [candidate],
        messages: [{ id: 'other', content: 'Sólo el precio' }] })).toEqual([]);
    }
  });
  it('keeps customer-message order and lets a final source correction replace the old interpretation', () => {
    const result = collectNegotiationObservationsV1({ ...identity,
      candidates: [{ ...observation, value: 'other_barriers_reported', source_quote: 'también el horario' }, observation],
      messages: [{ id: 'first', content: 'Sólo el precio' }, { id: 'last', content: 'Me corrijo, también el horario.' }] });
    expect(result.map(x => [x.source_message_id, x.status])).toEqual([
      ['first', 'confirmed'], ['last', 'other_barriers_reported'],
    ]);
  });
});
