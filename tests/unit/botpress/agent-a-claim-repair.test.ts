import { describe, expect, it } from 'vitest';
import { removeEffectClaimBubblesV1, removeOffendingSentencesV1, repairCourseMentionRolesV1, salvageFactClaimsV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-claim-repair';
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

describe('salvage and effect-claim removal keep the structured fields (acceptance 82054dd 10_requested_call/request)', () => {
  // Real DeepSeek draft (call-0028): bubble 0 claims the call, bubble 1 asks the data and carries the request.
  const real = {
    schema_version: 1,
    response: { messages: [
      'Claro, te llamo y vemos juntos cuál de los cursos de fotografía te conviene. Soy Emma, asesora de Studyx.',
      'Para coordinar la llamada, ¿me pasas tu nombre, apellido, correo y teléfono?',
    ], call_offer: null },
    proposed_action: { type: 'none' }, course_mentions: [],
    profile_requests: [{ message_index: 1, fields: ['nombre', 'apellido', 'correo', 'telefono'], purpose: 'call', mode: 'collect' }],
    memory_candidates: [{ type: 'contact_preference', key: 'call_preference', value: 'Prefiere llamada', source_quote: 'Quiero que me llames', confidence: 0.95 }],
    turn_reasoning: { phase: 'solicitud de llamada', next_step: 'call' },
    move: { move: 'request_call' },
  } as unknown as AgentATurnProposalV1;
  const cat = { commercial_state: {}, capabilities: { course_bonus: { delivered_bonus_offerings: [] } },
    catalog: { selected_offering: null, available_offerings: [], candidate_offerings: [], payment_plans: [] } } as unknown as AgentAContextV1;

  it('removing the claim bubble re-indexes the request onto the surviving ask', () => {
    const fixed = removeEffectClaimBubblesV1({ proposal: real, context: cat });
    expect(fixed?.response.messages).toEqual([real.response.messages[1]]);
    expect(fixed?.profile_requests).toEqual([{ ...real.profile_requests![0]!, message_index: 0 }]);
    expect(fixed?.memory_candidates).toEqual(real.memory_candidates);
    expect(fixed?.turn_reasoning).toEqual(real.turn_reasoning);
    expect(fixed?.move).toEqual(real.move);
  });
  it('a request whose bubble was removed goes with it', () => {
    const onClaim = { ...real, profile_requests: [{ ...real.profile_requests![0]!, message_index: 0 }] } as AgentATurnProposalV1;
    expect(removeEffectClaimBubblesV1({ proposal: onClaim, context: cat })?.profile_requests).toEqual([]);
  });
  it('sentence salvage re-indexes when a whole bubble is dropped', () => {
    const flagged = { ...real, response: { messages: ['Cuesta USD 999 hoy.', real.response.messages[1]!], call_offer: null } } as AgentATurnProposalV1;
    const fixed = salvageFactClaimsV1({ proposal: flagged, context: cat });
    expect(fixed?.response.messages[0]).toBe(real.response.messages[1]);
    expect(fixed?.profile_requests?.map(r => r.message_index)).toEqual([0]);
    expect(fixed?.memory_candidates).toEqual(real.memory_candidates);
  });
});

describe('programme-send claim removal (traces 36 and 38 of focused-29-41-r2)', () => {
  const catalog = { commercial_state: {}, capabilities: { course_bonus: { delivered_bonus_offerings: [] } },
    catalog: { selected_offering: null, available_offerings: [], candidate_offerings: [], payment_plans: [] } } as unknown as AgentAContextV1;
  const programProposal = (messages: string[], move = 'request_course_program') => ({
    schema_version: 1, move: { schema_version: 1, move, secondary_moves: [], vetoes: [], confidence: 1 },
    response: { messages, call_offer: null }, proposed_action: { type: 'none' }, course_mentions: [],
  }) as unknown as AgentATurnProposalV1;
  it('drops only the bubble that says the programme is being sent, keeps the rest, never silences', () => {
    const fixed = removeEffectClaimBubblesV1({
      proposal: programProposal(['Claro, te lo comparto de nuevo por acá.', 'Si querés lo repasamos juntos, qué parte te interesa?']),
      context: catalog,
    });
    expect(fixed?.response.messages).toEqual(['Si querés lo repasamos juntos, qué parte te interesa?']);
    expect(fixed?.proposed_action).toEqual({ type: 'none' });
  });
  it('removes "te comparto el programa de Excel Integral" when no PDF exists', () => {
    const fixed = removeEffectClaimBubblesV1({
      proposal: programProposal(['Claro, te comparto el programa de Excel Integral.', 'El curso es online y de 8 clases.']),
      context: catalog,
    });
    expect(fixed?.response.messages).toEqual(['El curso es online y de 8 clases.']);
  });
  it('keeps honest wording (past reference) untouched', () => {
    expect(removeEffectClaimBubblesV1({ proposal: programProposal(['Ya te lo compartí antes, está arriba en el chat.']), context: catalog })).toBeNull();
  });
  it('returns null when every bubble is a claim (the caller falls back to the repair, never to silence)', () => {
    expect(removeEffectClaimBubblesV1({ proposal: programProposal(['Te comparto el programa.']), context: catalog })).toBeNull();
  });
});
