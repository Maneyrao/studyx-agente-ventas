import { describe, expect, it } from 'vitest';
import { removeOffendingSentencesV1, repairCourseMentionRolesV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-claim-repair';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import marketingBudget from '../fixtures/marketing-budget-natural-59cab80.json';

const ctx = (over: { selected?: unknown; delivered?: unknown[] } = {}) => ({
  capabilities: { course_bonus: { delivered_bonus_offerings: over.delivered ?? [] } },
  catalog: {
    selected_offering: over.selected ?? null,
    available_offerings: [
      { code: 'marketing_digital', display_name: 'Marketing Digital' },
      { code: 'fotografia_celulares_tiendas_online', display_name: 'Fotografía con Celulares para Tiendas Online' },
    ],
  },
}) as unknown as AgentAContextV1;
const draft = marketingBudget.drafts[0]!;
const proposal = (mentions: unknown[], action: unknown = { type: 'none' }) => ({
  schema_version: 1, response: { messages: draft.messages, call_offer: null },
  proposed_action: action, course_mentions: mentions,
}) as unknown as AgentATurnProposalV1;

describe('COURSE_ROLE_UNDECLARED metadata repair (natural-59cab80 17/marketing_budget)', () => {
  it('downgrades the paid declaration and declares the named course, prose untouched', () => {
    const repaired = repairCourseMentionRolesV1({ proposal: proposal(draft.course_mentions), context: ctx() });
    expect(repaired?.course_mentions).toEqual([{ offering_code: 'marketing_digital', role: 'alternative' }]);
    expect(repaired?.response.messages).toEqual(draft.messages);
  });
  it('declares an undeclared named course as alternative', () => {
    expect(repairCourseMentionRolesV1({ proposal: proposal([]), context: ctx() })?.course_mentions)
      .toEqual([{ offering_code: 'marketing_digital', role: 'alternative' }]);
  });
  it('does nothing with a persisted selection, a delivered package or a bonus action', () => {
    expect(repairCourseMentionRolesV1({ proposal: proposal(draft.course_mentions), context: ctx({ selected: { code: 'x' } }) })).toBeNull();
    expect(repairCourseMentionRolesV1({ proposal: proposal(draft.course_mentions), context: ctx({ delivered: [{ code: 'x' }] }) })).toBeNull();
    expect(repairCourseMentionRolesV1({ proposal: proposal(draft.course_mentions, { type: 'offer_course_bonus' }), context: ctx() })).toBeNull();
  });
  it('is a no-op when the metadata is already right', () => {
    expect(repairCourseMentionRolesV1({ proposal: proposal([{ offering_code: 'marketing_digital', role: 'alternative' }]), context: ctx() })).toBeNull();
  });
});

describe('M4: backend-reported sentences match by bubble index plus containment', () => {
  const cat = { capabilities: { course_bonus: { delivered_bonus_offerings: [] } },
    catalog: { selected_offering: null, available_offerings: [], candidate_offerings: [], payment_plans: [] } } as unknown as AgentAContextV1;
  const withMessages = (messages: string[]) => ({ schema_version: 1, response: { messages, call_offer: null },
    proposed_action: { type: 'none' }, course_mentions: [] }) as unknown as AgentATurnProposalV1;
  it.each([
    ['Cuesta mucho más de lo que imaginas', 'Cuesta mucho más de lo que imaginas.'],
    ['Es un plan muy accesible 😀', 'Es un plan muy accesible!'],
    ['Línea uno\nEl curso sale muy barato hoy 🙌', 'El curso sale muy barato hoy.'],
  ])('removes the flagged sentence in bubble 1 (%s)', (flagged, reported) => {
    const result = removeOffendingSentencesV1({ proposal: withMessages(['Hola, mucho gusto.', flagged]), context: cat,
      backend_sentences: [{ sentence: reported, message_index: 1 }] });
    expect(result.removed.length).toBeGreaterThan(0);
    expect(result.messages[0]).toBe('Hola, mucho gusto.');
  });
  it('does not remove the same text in another bubble, nor a short unrelated sentence', () => {
    const result = removeOffendingSentencesV1({ proposal: withMessages(['Es un plan muy accesible 😀', 'Dale. Seguimos.']), context: cat,
      backend_sentences: [{ sentence: 'Es un plan muy accesible. Dale, seguimos con todo.', message_index: 1 }] });
    expect(result.messages[0]).toBe('Es un plan muy accesible 😀');
    expect(result.messages[1]).toContain('Dale.');
  });
});
