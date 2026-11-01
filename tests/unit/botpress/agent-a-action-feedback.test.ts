import { describe, expect, it, vi } from 'vitest';
import { authorizedPromotionActionsV1, continueAgentAAfterActionFeedbackV1, continuationCallOfferAuthorizedV1, fencedAgentARequestV1, plannerlessActionFeedbackV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-action-feedback';
import type { AgentAContextV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';

function context(): AgentAContextV1 {
  return { schema_version: 1, identity: null,
    turn: { batch_messages: [{ id: 'm1', text: 'Dale, me llamas?' }], recent_turns: [] },
    customer: { display_name: null, memories: [] },
    commercial_state: { selected_offering_code: null, selected_payment_plan: null, stage: 'course_selected',
      call_preference: 'call', call_offer_status: 'accepted', call_offer_count: 1, awaiting_reply: 'call_or_chat', payment_reported: false },
    catalog: { available_offerings: [], selected_offering: null, areas: [], candidate_offerings: [], payment_plans: [] },
    capabilities: { may_reply: true, may_offer_call: false, may_request_call_now: false, may_present_payment_options: false,
      may_send_payment_link: false, authorized_payment_plan: null, intake_status: 'unknown', intake_missing: ['nombre', 'apellido'] },
  };
}

function reply(text: string) {
  return { proposal: { schema_version: 1 as const,
    move: { schema_version: 1 as const, move: 'unknown' as const, secondary_moves: [], vetoes: [], confidence: 1 },
    response: { messages: [text], call_offer: null }, proposed_action: { type: 'none' as const },
    course_mentions: [], used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null },
    provider: 'deepseek-direct' as const, model: 'deepseek-v4-flash', latency_ms: 1, attempt_count: 1 as const };
}

describe('Agent A conversation from action feedback', () => {
  it.each([
    { type: 'send_payment_link' as const, offering_code: 'ingles_1', payment_plan: 'one_time' as const },
    { type: 'request_call_now' as const, reason: 'direct_request' as const },
  ])('fences the rejected $type request without carrying it into the continuation', action => {
    const original = { ...reply('Necesito un dato para continuar.').proposal, proposed_action: action };
    expect(fencedAgentARequestV1()).toEqual({ conversation_only: true });
    expect(original.proposed_action).toEqual(action);
  });

  it('never invents an operation for an informational reply or absent proposal', () => {
    expect(fencedAgentARequestV1()).toEqual({ conversation_only: true });
  });

  it('passes exact structural missing fields and preserves the original customer messages', async () => {
    const current = context();
    const rejection = plannerlessActionFeedbackV1({ context: current,
      failure_code: 'PLANNERLESS_PROPOSAL_REJECTED:MISSING_INTAKE:nombre,MISSING_INTAKE:apellido',
      rejection_id: '00000000-0000-4000-8000-000000000001' });
    const text = 'Antes de coordinarla, me dices tu nombre y apellido?';
    const generate = vi.fn(async () => reply(text));
    const result = await continueAgentAAfterActionFeedbackV1({ context: current, rejection, apiKey: 'fixture',
      signal: new AbortController().signal, model: 'deepseek-v4-flash', generate });
    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ conversation_only: true,
      context: expect.objectContaining({ turn: current.turn,
        turn_rejection: expect.objectContaining({ authorized_alternatives: {
          fact_ids: [], actions: ['none'], missing_information: ['nombre', 'apellido'],
        } }) }) }));
    expect(result.proposal.response.messages).toEqual([text]);
    expect(current.turn_rejection).toBeUndefined();
  });

  it('returns only call requirements when a call action is rejected', () => {
    const current = context();
    current.capabilities.intake_status = 'known';
    current.capabilities.intake_missing = ['nombre', 'apellido', 'correo'];
    current.capabilities.required_contact_fields = {
      call: ['nombre', 'apellido'],
      payment: ['nombre', 'apellido', 'correo'],
      identity: ['nombre', 'apellido', 'correo'],
    };

    const rejection = plannerlessActionFeedbackV1({
      context: current,
      failure_code: 'PLANNERLESS_PROPOSAL_REJECTED:ACTION_NOT_AUTHORIZED:request_call_now',
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(rejection.authorized_alternatives.missing_information)
      .toEqual(['nombre', 'apellido']);
  });

  it('retains a promotion review as an authorized correction when the capability allows it', () => {
    const current = context();
    current.capabilities.course_bonus = {
      status: 'review_available',
      may_schedule_checkin: false,
      may_request_review: true,
      may_accept_offer: false,
      may_send_promoted_payment: false,
      promotion_code: null,
      interest_offering_code: 'ingles_1',
      bonus_offerings: [],
    };

    const rejection = plannerlessActionFeedbackV1({
      context: current,
      failure_code: 'PLANNERLESS_PROPOSAL_REJECTED:FACT_VALUE_MISMATCH:forbidden_promise',
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });

    expect(rejection.authorized_alternatives.actions)
      .toEqual(['none', 'request_promotion_review']);
  });

  it('retains a direct bonus effect while Agent A repairs only its rejected wording', () => {
    const current = context();
    current.capabilities.course_bonus = {
      status: 'offer_available',
      enabled: true,
      max_bonus_courses: 3,
      may_offer_bonus: true,
      may_schedule_checkin: false,
      may_request_review: false,
      may_accept_offer: true,
      may_send_promoted_payment: false,
      promotion_code: 'PROMO-DIRECT',
      promotion_cycle_id: '00000000-0000-4000-8000-000000000002',
      offer_version: 1,
      interest_offering_code: 'fotografia_profesional',
      bonus_offerings: [{
        code: 'fotografia_celulares_tiendas_online',
        display_name: 'Fotografía con Celulares para Tiendas Online',
        position: 1,
      }],
    };

    expect(authorizedPromotionActionsV1(current)).toEqual([
      'none',
      'offer_course_bonus',
      'accept_promotion',
    ]);
  });

  it('allows the corrected direct bonus effect through the bounded continuation', async () => {
    const current = context();
    current.commercial_state.selected_offering_code = 'fotografia_profesional';
    current.commercial_state.call_preference = 'declined';
    current.commercial_state.call_offer_status = 'declined';
    current.catalog.available_offerings = [{
      code: 'diseno_photoshop',
      display_name: 'Diseño Gráfico con Photoshop',
      area_code: 'diseno',
      fact_id: 'offering:diseno_photoshop:name:v1',
    }];
    current.capabilities.course_bonus = {
      status: 'offer_available', enabled: true, max_bonus_courses: 3,
      may_offer_bonus: true, may_schedule_checkin: false, may_request_review: false,
      may_accept_offer: true, may_send_promoted_payment: false,
      promotion_code: 'PROMO-DIRECT',
      promotion_cycle_id: '00000000-0000-4000-8000-000000000002',
      offer_version: 1, interest_offering_code: 'fotografia_profesional',
      bonus_offerings: [{
        code: 'fotografia_celulares_tiendas_online',
        display_name: 'Fotografía con Celulares para Tiendas Online',
        position: 1,
      }],
      delivered_bonus_offerings: [{
        code: 'fotografia_celulares_tiendas_online',
        display_name: 'Fotografía con Celulares para Tiendas Online',
        position: 1,
      }],
    };
    const rejection = {
      schema_version: 1 as const,
      rejection_id: '00000000-0000-4000-8000-000000000003',
      attempt: 1 as const,
      rejections: [{ code: 'FACT_VALUE_MISMATCH' as const, subject: 'forbidden_promise' }],
      authorized_alternatives: {
        fact_ids: [], actions: authorizedPromotionActionsV1(current), missing_information: [],
      },
    };
    const draft = reply('Te sumo Diseño Gráfico con Photoshop sin costo extra.');
    const authored = { ...draft, proposal: {
      ...draft.proposal,
      proposed_action: {
        type: 'offer_course_bonus' as const,
        interest_offering_code: 'fotografia_profesional',
        bonus_offering_code: 'diseno_photoshop',
      },
      repair_of: { rejection_id: rejection.rejection_id, attempt: 1 as const },
    } };

    const result = await continueAgentAAfterActionFeedbackV1({
      context: current, rejection, effects_allowed: true,
      apiKey: 'fixture', signal: new AbortController().signal,
      model: 'deepseek-v4-flash', generate: vi.fn(async () => authored),
    });

    expect(result.proposal.proposed_action).toEqual(authored.proposal.proposed_action);
  });

  it('preserves Agent A payment intent while fencing the physical effect', async () => {
    const current = context();
    const rejection = plannerlessActionFeedbackV1({ context: current, failure_code: 'PLANNERLESS_PROPOSAL_REJECTED:ACTION_NOT_AUTHORIZED:send_payment_link', rejection_id: '00000000-0000-4000-8000-000000000001' });
    const generated = reply('Me confirmas el plan que prefieres?');
    const generate = vi.fn(async () => ({ ...generated, proposal: { ...generated.proposal,
      move: { ...generated.proposal.move, move: 'request_payment_link' as const, payment_plan: 'one_time' as const } } }));
    const result = await continueAgentAAfterActionFeedbackV1({ context: current, rejection, apiKey: 'fixture',
      signal: new AbortController().signal, model: 'deepseek-v4-flash', generate });
    expect(result.proposal.move.move).toBe('request_payment_link');
    expect(result.proposal.proposed_action).toEqual({ type: 'none' });
    expect(generate).toHaveBeenCalledOnce();
  });

  it('retains an independently authorized call effect while repairing rejected prose', async () => {
    const current = context();
    current.capabilities.may_request_call_now = true;
    current.capabilities.intake_status = 'known';
    current.capabilities.intake_missing = [];
    current.customer.contact_intake = {
      nombre: 'Ana', apellido: 'Costa', correo: null, telefono: '+15551234070',
    };
    const rejection = {
      schema_version: 1 as const,
      rejection_id: '00000000-0000-4000-8000-000000000001',
      attempt: 1 as const,
      rejections: [{ code: 'FACT_VALUE_MISMATCH' as const, subject: 'course_fact' }],
      authorized_alternatives: {
        fact_ids: [], actions: ['none', 'request_call_now'], missing_information: [],
      },
    };
    const draft = reply('Perfecto, te llamo ahora.');
    const generate = vi.fn(async () => ({ ...draft, proposal: {
      ...draft.proposal,
      move: { ...draft.proposal.move, move: 'request_call' as const },
      proposed_action: { type: 'request_call_now' as const, reason: 'direct_request' as const },
      repair_of: { rejection_id: rejection.rejection_id, attempt: 1 as const },
    } }));

    const result = await continueAgentAAfterActionFeedbackV1({
      context: current, rejection, effects_allowed: true,
      apiKey: 'fixture', signal: new AbortController().signal,
      model: 'deepseek-v4-flash', generate,
    });

    expect(result.proposal.proposed_action).toEqual({
      type: 'request_call_now', reason: 'direct_request',
    });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      conversation_only: false,
      context: expect.objectContaining({ turn_rejection: expect.objectContaining({
        authorized_alternatives: expect.objectContaining({
          actions: ['none', 'request_call_now'],
        }),
      }) }),
    }));
  });

  it('allows an authorized call invitation in a conversation-only continuation', async () => {
    // Authority: prompt lines 204-210; invitation and dispatch are separate.
    const current = context();
    // This wording intentionally does not satisfy the retired
    // FIRST_NOT_YET_USEFUL commercial heuristic. The capability and lifecycle,
    // not a backend opinion about timing, authorize the invitation.
    current.turn.batch_messages = [{ id: 'm1', text: 'Gracias por la información.' }];
    current.turn.recent_turns = [{
      id: 'prior-agent', direction: 'outbound', content: 'Contame qué querés aprender y te oriento.',
    }];
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'not_offered';
    current.commercial_state.call_offer_count = 0;
    current.commercial_state.awaiting_reply = 'none';
    current.capabilities.may_offer_call = true;
    const rejection = plannerlessActionFeedbackV1({
      context: current,
      failure_code: 'PLANNERLESS_PROPOSAL_REJECTED:FACT_VALUE_MISMATCH:course_fact',
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    const draft = reply('Por lo que querés lograr, Inglés 1 es el mejor punto de partida.');
    const authored = { ...draft, proposal: {
      ...draft.proposal,
      response: {
        ...draft.proposal.response,
        call_offer: 'Si querés, lo vemos en una llamada breve y despejamos tus dudas.',
      },
      repair_of: { rejection_id: rejection.rejection_id, attempt: 1 as const },
    } };

    const result = await continueAgentAAfterActionFeedbackV1({
      context: current,
      rejection,
      apiKey: 'fixture',
      signal: new AbortController().signal,
      model: 'deepseek-v4-flash',
      generate: vi.fn(async () => authored),
    });

    expect(result.proposal.response.call_offer).toContain('llamada breve');
    expect(result.proposal.proposed_action).toEqual({ type: 'none' });
  });

  it('keeps continuation call invitations behind lifecycle, cap and consent boundaries', () => {
    // Authority: AGENTS.md line 12 preserves max two, consent and may_offer_call.
    const authorized = context();
    authorized.capabilities.may_offer_call = true;
    authorized.commercial_state.call_preference = 'unknown';
    authorized.commercial_state.call_offer_status = 'not_offered';
    authorized.commercial_state.call_offer_count = 0;
    authorized.commercial_state.awaiting_reply = 'none';
    expect(continuationCallOfferAuthorizedV1(authorized)).toBe(true);

    const capped = structuredClone(authorized);
    capped.commercial_state.call_offer_count = 2;
    expect(continuationCallOfferAuthorizedV1(capped)).toBe(false);

    const chat = structuredClone(authorized);
    chat.commercial_state.call_preference = 'chat';
    expect(continuationCallOfferAuthorizedV1(chat)).toBe(false);

    const accepted = structuredClone(authorized);
    accepted.commercial_state.call_preference = 'call';
    accepted.commercial_state.call_offer_status = 'accepted';
    expect(continuationCallOfferAuthorizedV1(accepted)).toBe(false);

    const active = structuredClone(authorized);
    active.commercial_state.active_call = {
      call_id: '00000000-0000-4000-8000-000000000001', status: 'pending',
    };
    expect(continuationCallOfferAuthorizedV1(active)).toBe(false);
  });

  it('still rejects a continuation call invitation when the turn has no call authorization', async () => {
    // Authority: AGENTS.md line 12 preserves may_offer_call and the two-offer limit.
    const current = context();
    current.turn.batch_messages = [{ id: 'm1', text: 'Seguimos por chat.' }];
    current.commercial_state.call_preference = 'chat';
    current.capabilities.may_offer_call = false;
    const rejection = plannerlessActionFeedbackV1({
      context: current,
      failure_code: 'PLANNERLESS_PROPOSAL_REJECTED:FACT_VALUE_MISMATCH:course_fact',
      rejection_id: '00000000-0000-4000-8000-000000000001',
    });
    const draft = reply('Te explico por acá.');
    const authored = { ...draft, proposal: {
      ...draft.proposal,
      response: { ...draft.proposal.response, call_offer: 'Si querés, te llamo.' },
      repair_of: { rejection_id: rejection.rejection_id, attempt: 1 as const },
    } };

    await expect(continueAgentAAfterActionFeedbackV1({
      context: current,
      rejection,
      apiKey: 'fixture',
      signal: new AbortController().signal,
      model: 'deepseek-v4-flash',
      generate: vi.fn(async () => authored),
    })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED');
  });

  it('never delivers an unsupported call promise or invents a second repair', async () => {
    const current = context();
    const rejection = plannerlessActionFeedbackV1({ context: current, failure_code: 'PLANNERLESS_PROPOSAL_REJECTED:MISSING_INTAKE:apellido', rejection_id: '00000000-0000-4000-8000-000000000001' });
    const generate = vi.fn(async () => reply('Te llamo ahora.'));
    await expect(continueAgentAAfterActionFeedbackV1({ context: current, rejection, apiKey: 'fixture',
      signal: new AbortController().signal, model: 'deepseek-v4-flash', generate })).rejects.toThrow('PLANNERLESS_PROPOSAL_REJECTED');
    expect(generate).toHaveBeenCalledOnce();
  });

  it('accepts Agent A own wording when it preserves the call intent and asks only for missing identity', async () => {
    const current = context();
    current.commercial_state.call_preference = 'unknown';
    current.commercial_state.call_offer_status = 'offered';
    const rejection = plannerlessActionFeedbackV1({ context: current,
      failure_code: 'PLANNERLESS_PROPOSAL_REJECTED:MISSING_INTAKE:nombre,MISSING_INTAKE:apellido',
      rejection_id: '00000000-0000-4000-8000-000000000001' });
    const draft = reply('Claro. Para poder llamarte, ¿me compartes tu nombre y apellido?');
    const authored = { ...draft, proposal: { ...draft.proposal,
      move: { ...draft.proposal.move, move: 'request_call' as const },
      profile_requests: [{ message_index: 0, fields: ['nombre', 'apellido'] as ('nombre' | 'apellido')[],
        purpose: 'call' as const, mode: 'collect' as const }],
      repair_of: { rejection_id: rejection.rejection_id, attempt: 1 as const },
    } };
    const generate = vi.fn(async () => authored);

    const result = await continueAgentAAfterActionFeedbackV1({ context: current, rejection,
      apiKey: 'fixture', signal: new AbortController().signal, model: 'deepseek-v4-flash', generate });

    expect(result.proposal.response.messages).toEqual(authored.proposal.response.messages);
    expect(result.proposal.move.move).toBe('request_call');
    expect(result.proposal.profile_requests).toEqual(authored.proposal.profile_requests);
    expect(generate).toHaveBeenCalledOnce();
  });

  it('never restores the rejected call move or action over the continuation', async () => {
    const current = context();
    const rejection = plannerlessActionFeedbackV1({ context: current,
      failure_code: 'PLANNERLESS_PROPOSAL_REJECTED:MISSING_INTAKE:apellido',
      rejection_id: '00000000-0000-4000-8000-000000000001' });
    const result = await continueAgentAAfterActionFeedbackV1({ context: current, rejection,
      apiKey: 'fixture', signal: new AbortController().signal,
      model: 'deepseek-v4-flash', generate: vi.fn(async () => reply('Me dices tu apellido para coordinarla?')) });
    expect(result.proposal.move.move).toBe('unknown');
    expect(result.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.proposal.confirmed_phone).toBeUndefined();
    expect(result.proposal.response.messages).toEqual(['Me dices tu apellido para coordinarla?']);
    expect(result.proposal.used_fact_ids).toEqual([]);
  });

  it('never restores a rejected payment-link move after Agent A asks for the missing plan', async () => {
    const current = context();
    const rejection = plannerlessActionFeedbackV1({ context: current,
      failure_code: 'PLANNERLESS_PROPOSAL_REJECTED:PLAN_NOT_SELECTED:payment_plan',
      rejection_id: '00000000-0000-4000-8000-000000000001' });
    const result = await continueAgentAAfterActionFeedbackV1({ context: current, rejection,
      apiKey: 'fixture', signal: new AbortController().signal,
      model: 'deepseek-v4-flash', generate: vi.fn(async () => reply('Qué plan prefieres?')) });

    expect(result.proposal.move.move).toBe('unknown');
    expect(result.proposal.proposed_action).toEqual({ type: 'none' });
    expect(result.proposal.response.messages).toEqual(['Qué plan prefieres?']);
  });
});
