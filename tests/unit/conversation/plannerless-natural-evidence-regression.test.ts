import { describe, expect, it } from 'vitest';
import { authorizeAgentTurnV2 } from '@/features/conversation/domain/agent-turn-policy-v2';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import { hasTemporalPaymentDeferral as backendDeferral } from '@/features/payments/domain/payment-choice-policy';
import { extractContactIdentity } from '@/lib/heuristics/contact-identity';
import {
  supportsCallRequestV1,
  supportsChatPreferenceV1,
} from '@/features/conversation/domain/channel-preference-evidence';
import { solicitsACallV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import { evaluateCallOfferTurnPolicyV1 } from '../../../botpress-agent/src/lib/conversation/call-offer-turn-policy';
import {
  supportsCallRequestV1 as workflowCallRequest,
  supportsChatPreferenceV1 as workflowChatPreference,
} from '../../../botpress-agent/src/lib/conversation/channel-preference-evidence';
import { resolveAgentAPlannerlessProposalV2 } from '../../../botpress-agent/src/lib/conversation/resolve-agent-a-plannerless';
import type { AgentAProposalEnvelopeV1 } from '../../../botpress-agent/src/lib/conversation/resolve-agent-a-proposal';
import type { AgentAContextV1, AgentATurnProposalV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import { hasTemporalPaymentDeferral as workflowDeferral } from '../../../botpress-agent/src/utils/payment-choice';

const identity = {
  workspace_id: '11111111-1111-4111-8111-111111111111',
  conversation_id: '22222222-2222-4222-8222-222222222222',
  contact_id: '33333333-3333-4333-8333-333333333333',
};

const proposal: AgentATurnProposalV1 = {
  schema_version: 1,
  move: {
    schema_version: 1,
    move: 'ask_course_information',
    secondary_moves: [],
    vetoes: [],
    confidence: 0.9,
  },
  response: {
    messages: ['Comparación principal.', 'Diferencia práctica. Pregunta de cierre.'],
    call_offer: 'Si te sirve, lo vemos en una llamada breve.',
  },
  proposed_action: { type: 'none' },
  course_mentions: [], used_fact_ids: ['offering:marketing_digital:name:v1'],
  used_memory_ids: [],
  memory_candidates: [],
  repair_of: null,
};

describe('plannerless natural evidence regression', () => {
  it('does not misclassify a negated enrollment deferral as direct purchase', () => {
    const context = {
      schema_version: 1,
      turn: {
        batch_messages: [{ id: 'deferral', text: 'No quiero inscribirme todavía, tengo que pensarlo.' }],
        recent_turns: [{ id: 'course', direction: 'outbound' as const, content: 'Fotografía Profesional puede ayudarte con tu tienda.' }],
      },
      continuity: { assistant_has_spoken: true, first_name_status: 'known' as const, last_agent_reply: 'Fotografía Profesional puede ayudarte con tu tienda.' },
      customer: { display_name: 'Ana', memories: [] },
      identity: null,
      commercial_state: {
        selected_offering_code: 'fotografia_profesional', selected_payment_plan: 'monthly_12' as const,
        stage: 'plan_selected' as const, call_preference: 'unknown' as const,
        call_offer_status: 'not_offered' as const, call_offer_count: 0 as const,
        awaiting_reply: 'none' as const, payment_reported: false,
      },
      catalog: {
        selected_offering: {
          code: 'fotografia_profesional', display_name: 'Fotografía Profesional', area_code: 'fotografia',
          facts: [{ id: 'offering:fotografia_profesional:name:v1', kind: 'offering_name' as const, value: 'Fotografía Profesional' }],
        },
        available_offerings: [], areas: [], candidate_offerings: [], payment_plans: [],
      },
      capabilities: {
        may_reply: true, may_offer_call: true, may_request_call_now: false,
        may_present_payment_options: true, may_send_payment_link: false,
        authorized_payment_plan: null, intake_status: 'known' as const, intake_missing: [],
      },
    } satisfies AgentAContextV1;

    expect(evaluateCallOfferTurnPolicyV1({ context })).toMatchObject({
      customer_signal: 'none',
      offer_allowed: true,
      reason: 'FIRST_OFFER_DUE',
    });
  });

  it('does not force a call after an ordinary greeting or first useful answer', () => {
    const context = {
      schema_version: 1,
      turn: {
        batch_messages: [{ id: 'ordinary-detail', text: 'Quiero aprender inglés desde cero.' }],
        recent_turns: [{
          id: 'ordinary-outbound', direction: 'outbound' as const,
          content: 'Hola, soy Emma. Qué te gustaría aprender?',
        }],
      },
      continuity: {
        assistant_has_spoken: true, first_name_status: 'known' as const,
        last_agent_reply: 'Hola, soy Emma. Qué te gustaría aprender?',
      },
      customer: { display_name: 'Carlos', memories: [] },
      identity: null,
      commercial_state: {
        selected_offering_code: null, selected_payment_plan: null,
        stage: 'exploring' as const, call_preference: 'unknown' as const,
        call_offer_status: 'not_offered' as const, call_offer_count: 0 as const,
        awaiting_reply: 'none' as const, payment_reported: false,
      },
      catalog: {
        selected_offering: null, available_offerings: [], areas: [],
        candidate_offerings: [], payment_plans: [],
      },
      capabilities: {
        may_reply: true, may_offer_call: true, may_request_call_now: false,
        may_present_payment_options: false, may_send_payment_link: false,
        authorized_payment_plan: null, intake_status: 'known' as const, intake_missing: [],
      },
    } satisfies AgentAContextV1;

    expect(evaluateCallOfferTurnPolicyV1({ context })).toMatchObject({
      offer_required: false,
      offer_allowed: false,
      reason: 'FIRST_NOT_YET_USEFUL',
    });
  });

  it('allows but does not require the first call invitation after useful English guidance', () => {
    const context = {
      schema_version: 1,
      turn: {
        batch_messages: [
          { id: 'english-purpose', text: 'Quizás es para estudiar.' },
          { id: 'english-uncertainty', text: 'No estoy muy seguro.' },
        ],
        recent_turns: [{
          id: 'english-guidance',
          direction: 'outbound' as const,
          content: 'Si arrancás desde cero, Inglés 1 es el punto de partida natural.',
        }],
      },
      continuity: {
        assistant_has_spoken: true,
        first_name_status: 'known' as const,
        last_agent_reply: 'Si arrancás desde cero, Inglés 1 es el punto de partida natural.',
      },
      customer: { display_name: 'Carlos', memories: [] },
      identity: null,
      commercial_state: {
        selected_offering_code: null,
        selected_payment_plan: null,
        stage: 'exploring' as const,
        call_preference: 'unknown' as const,
        call_offer_status: 'not_offered' as const,
        call_offer_count: 0 as const,
        awaiting_reply: 'none' as const,
        payment_reported: false,
      },
      catalog: {
        selected_offering: null,
        available_offerings: [],
        areas: [],
        candidate_offerings: [
          { code: 'ingles_1', fact_id: 'offering:ingles_1:name:v1', display_name: 'Inglés 1', area_code: 'idiomas' },
          { code: 'ingles_2', fact_id: 'offering:ingles_2:name:v1', display_name: 'Inglés 2', area_code: 'idiomas' },
          { code: 'ingles_3', fact_id: 'offering:ingles_3:name:v1', display_name: 'Inglés 3', area_code: 'idiomas' },
        ],
        payment_plans: [],
      },
      capabilities: {
        may_reply: true,
        may_offer_call: true,
        may_request_call_now: false,
        may_present_payment_options: false,
        may_send_payment_link: false,
        authorized_payment_plan: null,
        intake_status: 'known' as const,
        intake_missing: [],
      },
    } satisfies AgentAContextV1;

    expect(evaluateCallOfferTurnPolicyV1({ context })).toMatchObject({
      offer_required: false,
      offer_allowed: true,
      reason: 'FIRST_OFFER_DUE',
    });
  });

  it('allows but does not require a call when the customer names English and is uncertain', () => {
    const context = {
      schema_version: 1,
      turn: {
        batch_messages: [
          { id: 'english-need', text: 'Me gustaría algo de inglés.' },
          { id: 'english-uncertainty', text: 'No estoy muy seguro.' },
        ],
        recent_turns: [{
          id: 'english-opening',
          direction: 'outbound' as const,
          content: 'Hola, soy Emma. Qué te gustaría aprender?',
        }],
      },
      continuity: {
        assistant_has_spoken: true,
        first_name_status: 'known' as const,
        last_agent_reply: 'Hola, soy Emma. Qué te gustaría aprender?',
      },
      customer: { display_name: 'Carlos', memories: [] },
      identity: null,
      commercial_state: {
        selected_offering_code: null,
        selected_payment_plan: null,
        stage: 'exploring' as const,
        call_preference: 'unknown' as const,
        call_offer_status: 'not_offered' as const,
        call_offer_count: 0 as const,
        awaiting_reply: 'none' as const,
        payment_reported: false,
      },
      catalog: {
        selected_offering: null,
        available_offerings: [],
        areas: [{ code: 'idiomas', fact_id: 'area:idiomas:name:v1', display_name: 'Idiomas' }],
        candidate_offerings: [
          { code: 'ingles_1', fact_id: 'offering:ingles_1:name:v1', display_name: 'Inglés 1', area_code: 'idiomas' },
          { code: 'ingles_2', fact_id: 'offering:ingles_2:name:v1', display_name: 'Inglés 2', area_code: 'idiomas' },
          { code: 'ingles_3', fact_id: 'offering:ingles_3:name:v1', display_name: 'Inglés 3', area_code: 'idiomas' },
        ],
        payment_plans: [],
      },
      capabilities: {
        may_reply: true,
        may_offer_call: true,
        may_request_call_now: false,
        may_present_payment_options: false,
        may_send_payment_link: false,
        authorized_payment_plan: null,
        intake_status: 'known' as const,
        intake_missing: [],
      },
    } satisfies AgentAContextV1;

    expect(evaluateCallOfferTurnPolicyV1({ context })).toMatchObject({
      offer_required: false,
      offer_allowed: true,
      reason: 'FIRST_OFFER_DUE',
    });
  });

  it('keeps a simple detail question optional after a course list without treating the list as orientation', () => {
    const context = {
      schema_version: 1,
      turn: {
        batch_messages: [{ id: 'english-details', text: 'Qué incluye?' }],
        recent_turns: [{
          id: 'english-list',
          direction: 'outbound' as const,
          content: 'Tenemos Inglés 1, Inglés 2 e Inglés 3. Cuál viste?',
        }],
      },
      continuity: {
        assistant_has_spoken: true,
        first_name_status: 'missing' as const,
        last_agent_reply: 'Tenemos Inglés 1, Inglés 2 e Inglés 3. Cuál viste?',
      },
      customer: { display_name: null, memories: [] },
      identity: null,
      commercial_state: {
        selected_offering_code: null,
        selected_payment_plan: null,
        stage: 'exploring' as const,
        call_preference: 'unknown' as const,
        call_offer_status: 'not_offered' as const,
        call_offer_count: 0 as const,
        awaiting_reply: 'course_choice' as const,
        payment_reported: false,
      },
      catalog: {
        selected_offering: null,
        available_offerings: [],
        areas: [],
        candidate_offerings: [
          { code: 'ingles_1', fact_id: 'offering:ingles_1:name:v1', display_name: 'Inglés 1', area_code: 'idiomas' },
          { code: 'ingles_2', fact_id: 'offering:ingles_2:name:v1', display_name: 'Inglés 2', area_code: 'idiomas' },
          { code: 'ingles_3', fact_id: 'offering:ingles_3:name:v1', display_name: 'Inglés 3', area_code: 'idiomas' },
        ],
        payment_plans: [],
      },
      capabilities: {
        may_reply: true,
        may_offer_call: true,
        may_request_call_now: false,
        may_present_payment_options: false,
        may_send_payment_link: false,
        authorized_payment_plan: null,
        intake_status: 'known' as const,
        intake_missing: [],
      },
    } satisfies AgentAContextV1;

    expect(evaluateCallOfferTurnPolicyV1({ context })).toMatchObject({
      offer_required: false,
      offer_allowed: true,
      reason: 'FIRST_USEFUL_MOMENT',
    });
  });

  it.each([
    'Me parece caro.',
    'Estoy entre Inglés 1 e Inglés 2 y no sé cuál me conviene.',
    'Me pasas el temario y todos los detalles?',
    'Qué beneficios tiene el curso de marketing?',
  ])('leaves the first useful call invitation to Agent A once the course is known: %s', (text) => {
    const context = {
      schema_version: 1,
      turn: {
        batch_messages: [{ id: 'useful-first-offer', text }],
        recent_turns: [{
          id: 'useful-first-outbound', direction: 'outbound' as const,
          content: 'Contame qué necesitás y lo vemos.',
        }],
      },
      continuity: {
        assistant_has_spoken: true, first_name_status: 'known' as const,
        last_agent_reply: 'Contame qué necesitás y lo vemos.',
      },
      customer: { display_name: 'Carlos', memories: [] },
      identity: null,
      commercial_state: {
        selected_offering_code: 'ingles_1', selected_payment_plan: null,
        stage: 'course_selected' as const, call_preference: 'unknown' as const,
        call_offer_status: 'not_offered' as const, call_offer_count: 0 as const,
        awaiting_reply: 'none' as const, payment_reported: false,
      },
      catalog: {
        selected_offering: null, available_offerings: [], areas: [],
        candidate_offerings: [], payment_plans: [],
      },
      capabilities: {
        may_reply: true, may_offer_call: true, may_request_call_now: false,
        may_present_payment_options: true, may_send_payment_link: false,
        authorized_payment_plan: null, intake_status: 'known' as const, intake_missing: [],
      },
    } satisfies AgentAContextV1;

    expect(evaluateCallOfferTurnPolicyV1({ context })).toMatchObject({
      offer_required: false,
      offer_allowed: true,
      reason: 'FIRST_OFFER_DUE',
    });
  });

  it('does not let a completed historical call suppress a new qualified invitation', () => {
    const context = {
      schema_version: 1,
      turn: {
        batch_messages: [{ id: 'after-voicemail', text: 'Contame qué beneficios tiene Marketing.' }],
        recent_turns: [{
          id: 'after-voicemail-outbound', direction: 'outbound' as const,
          content: 'Marketing Digital te puede servir para ordenar una estrategia comercial.',
        }],
      },
      continuity: {
        assistant_has_spoken: true, first_name_status: 'known' as const,
        last_agent_reply: 'Marketing Digital te puede servir para ordenar una estrategia comercial.',
      },
      customer: { display_name: 'Carlos', memories: [] },
      identity: null,
      commercial_state: {
        selected_offering_code: 'marketing_digital', selected_payment_plan: null,
        stage: 'course_selected' as const, call_preference: 'call' as const,
        call_offer_status: 'accepted' as const, call_offer_count: 0 as const,
        active_call: null,
        last_call_result: {
          call_id: '44444444-4444-4444-8444-444444444444',
          result: 'buzon_de_voz',
          ended_at: '2026-10-21T10:30:30.117Z',
        },
        awaiting_reply: 'none' as const, payment_reported: false,
      },
      catalog: {
        selected_offering: null, available_offerings: [], areas: [],
        candidate_offerings: [], payment_plans: [],
      },
      capabilities: {
        may_reply: true, may_offer_call: true, may_request_call_now: false,
        may_present_payment_options: true, may_send_payment_link: false,
        authorized_payment_plan: null, intake_status: 'known' as const, intake_missing: [],
      },
    } satisfies AgentAContextV1;

    expect(evaluateCallOfferTurnPolicyV1({ context })).toMatchObject({
      offer_required: false,
      offer_allowed: true,
      reason: 'FIRST_OFFER_DUE',
    });
  });

  it.each([
    ['Me sigue pareciendo caro, no llego con 30 dólares por mes.', 'FIRST_REPEATED_PRICE_OBJECTION'],
    ['No pueden hacer una excepción para que pague 15?', 'FIRST_EXCEPTION_REQUEST'],
    ['No tienen alguna promo?', 'FIRST_EXCEPTION_REQUEST'],
    ['No vas a negociar?', 'FIRST_EXCEPTION_REQUEST'],
    ['Me puedes agregar Marketing por el mismo valor?', 'FIRST_EXCEPTION_REQUEST'],
  ] as const)('allows but never forces the first call invitation at a useful trigger: %s', (text, reason) => {
    const context = {
      schema_version: 1,
      turn: {
        batch_messages: [{ id: 'commercial-friction', text }],
        recent_turns: [
          { id: 'friction-outbound', direction: 'outbound' as const, content: 'La opción más baja es de 12 pagos de USD 30.' },
          { id: 'friction-inbound', direction: 'inbound' as const, content: 'Me parece muy caro.' },
        ],
      },
      continuity: {
        assistant_has_spoken: true, first_name_status: 'known' as const,
        last_agent_reply: 'La opción más baja es de 12 pagos de USD 30.',
      },
      customer: { display_name: 'Carlos', memories: [] },
      identity: null,
      commercial_state: {
        selected_offering_code: 'ingles_1', selected_payment_plan: null,
        stage: 'course_selected' as const, call_preference: 'unknown' as const,
        call_offer_status: 'not_offered' as const, call_offer_count: 0 as const,
        awaiting_reply: 'none' as const, payment_reported: false,
      },
      catalog: {
        selected_offering: null, available_offerings: [], areas: [],
        candidate_offerings: [], payment_plans: [],
      },
      capabilities: {
        may_reply: true, may_offer_call: true, may_request_call_now: false,
        may_present_payment_options: true, may_send_payment_link: false,
        authorized_payment_plan: null, intake_status: 'known' as const, intake_missing: [],
      },
    } satisfies AgentAContextV1;

    expect(evaluateCallOfferTurnPolicyV1({ context })).toMatchObject({
      offer_required: false,
      offer_allowed: true,
      reason,
    });
  });

  it('does not rewrite an authorized answer merely because Agent A did not offer a call', async () => {
    const context = {
      schema_version: 1,
      turn: {
        batch_messages: [{ id: 'exception', text: 'No pueden hacer una excepción para que pague 15?' }],
        recent_turns: [
          { id: 'repair-outbound', direction: 'outbound' as const, content: 'La cuota más baja es de USD 30.' },
          { id: 'repair-inbound', direction: 'inbound' as const, content: 'Es muy caro para mí.' },
        ],
      },
      continuity: {
        assistant_has_spoken: true, first_name_status: 'known' as const,
        last_agent_reply: 'La cuota más baja es de USD 30.',
      },
      customer: { display_name: 'Carlos', memories: [] },
      identity: null,
      commercial_state: {
        selected_offering_code: 'ingles_1', selected_payment_plan: null,
        stage: 'course_selected' as const, call_preference: 'unknown' as const,
        call_offer_status: 'not_offered' as const, call_offer_count: 0 as const,
        awaiting_reply: 'none' as const, payment_reported: false,
      },
      catalog: {
        selected_offering: null,
        available_offerings: [{
          code: 'ingles_1', fact_id: 'offering:ingles_1:name:v1',
          display_name: 'Inglés 1', area_code: null,
        }],
        areas: [], candidate_offerings: [], payment_plans: [],
      },
      capabilities: {
        may_reply: true, may_offer_call: true, may_request_call_now: false,
        may_present_payment_options: true, may_send_payment_link: false,
        authorized_payment_plan: null, intake_status: 'known' as const, intake_missing: [],
      },
    } satisfies AgentAContextV1;
    const initial: AgentAProposalEnvelopeV1 & {
      readonly provider: 'deepseek-direct'
      readonly model: string
      readonly latency_ms: number
      readonly attempt_count: 1 | 2
    } = {
      proposal: {
        ...proposal,
        move: { ...proposal.move, move: 'ask_course_information' as const, course_reference: 'ingles_1' },
        response: { messages: ['No tenemos una excepción disponible.'] },
        used_fact_ids: ['offering:ingles_1:name:v1'],
      },
      provider: 'deepseek-direct' as const,
      model: 'deepseek-v4-flash', latency_ms: 10, attempt_count: 1,
    };
    let repairCalls = 0;

    const resolved = await resolveAgentAPlannerlessProposalV2({
      initial, context, repair_enabled: true, semantic_rejections: 'advisory',
      rejection_id: '44444444-4444-4444-8444-444444444444',
      repair: async (rejection) => {
        repairCalls += 1;
        return {
          ...initial,
          proposal: {
            ...initial.proposal,
            response: {
              messages: ['No tenemos esa excepción disponible.'],
              call_offer: 'Si te sirve, podemos coordinar una llamada breve para revisar juntos qué opción encaja con lo que necesitás.',
            },
            repair_of: { rejection_id: rejection.rejection_id, attempt: 1 as const },
          },
          attempt_count: 2 as const,
        };
      },
    });

    // Authority: AGENTS.md “El backend no obliga a ofrecerla”.
    expect(repairCalls).toBe(0);
    expect(resolved.evidence).toMatchObject({ repair_attempted: false, repaired: false });
    expect(resolved.effective).toBe(initial);
  });

  it.each([
    '¿Pueden llamarme ahora?',
    'Me gustaría una llamada',
    'Quisiera que me contacten por teléfono',
    'Dale, ¿me llamas?\nEspero tu llamada',
  ])('keeps backend and workflow call evidence aligned for natural requests: %s', (text) => {
    expect(supportsCallRequestV1(text, false)).toBe(true);
    expect(workflowCallRequest(text, false)).toBe(true);
  });

  it('treats a prior refusal as turn-local and allows a later contextual reminder without forcing it', () => {
    const current = {
      schema_version: 1,
      turn: {
        batch_messages: [{ id: 'detail-after-refusal', text: 'Quiero ver el temario y todos los detalles.' }],
        recent_turns: [],
      },
      customer: {
        display_name: 'Ana', memories: [],
        contact_intake: { nombre: 'Ana', apellido: null, correo: null, telefono: '+5491112345678' },
      },
      identity: null,
      commercial_state: {
        selected_offering_code: 'redes_informaticas', selected_payment_plan: null,
        stage: 'course_selected' as const, call_preference: 'chat' as const,
        call_offer_status: 'declined' as const, call_offer_count: 1 as const,
        awaiting_reply: 'none' as const, payment_reported: false,
      },
      catalog: {
        selected_offering: null, available_offerings: [], areas: [],
        candidate_offerings: [], resolution: 'exact' as const, payment_plans: [],
      },
      capabilities: {
        may_reply: true, may_offer_call: true, may_request_call_now: false,
        may_present_payment_options: true, may_send_payment_link: false,
        authorized_payment_plan: null, intake_status: 'known' as const,
        intake_missing: ['apellido', 'correo'] as const,
      },
    } satisfies AgentAContextV1;

    expect(evaluateCallOfferTurnPolicyV1({ context: current })).toMatchObject({
      offer_required: false,
      offer_allowed: true,
      reason: 'SECOND_DETAILS_REQUEST',
    });

    const sameTurnRefusal: AgentAContextV1 = {
      ...current,
      turn: { ...current.turn, batch_messages: [{ id: 'refusal', text: 'No me llames, sigamos por chat.' }] },
    };
    expect(evaluateCallOfferTurnPolicyV1({ context: sameTurnRefusal })).toMatchObject({
      offer_required: false,
      offer_allowed: false,
      reason: 'CALL_REJECTED',
    });
  });

  it('does not offer calls after a payment link was sent or payment was reported', () => {
    const current = {
      schema_version: 1,
      turn: { batch_messages: [{ id: 'post-sale', text: 'Ya pagué' }], recent_turns: [] },
      customer: { display_name: 'Ana', memories: [] },
      identity: null,
      commercial_state: {
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_12' as const,
        stage: 'payment_link_sent' as const, call_preference: 'unknown' as const,
        call_offer_status: 'offered' as const, call_offer_count: 1 as const,
        awaiting_reply: 'none' as const, payment_reported: true,
      },
      catalog: { selected_offering: null, available_offerings: [], areas: [], candidate_offerings: [], payment_plans: [] },
      capabilities: {
        may_reply: true, may_offer_call: true, may_request_call_now: false,
        may_present_payment_options: true, may_send_payment_link: false,
        authorized_payment_plan: null, intake_status: 'known' as const, intake_missing: [],
      },
    } satisfies AgentAContextV1;

    expect(evaluateCallOfferTurnPolicyV1({ context: current })).toMatchObject({
      offer_required: false,
      offer_allowed: false,
      reason: 'HANDOFF_OR_CLOSED',
    });
  });

  it('keeps natural turn evidence, the second-offer ledger and its physical boundary aligned', async () => {
    expect.soft(extractContactIdentity(
      'Me llamo Camila y quiero estudiar Marketing Digital.',
    ).name).toBe('Camila');

    expect.soft(supportsChatPreferenceV1(
      'Me resulta más cómodo seguir por chat. Contame lo principal.',
      true,
    )).toBe(true);

    const deferral = [{ content: 'Las 12 cuotas pueden servirme, pero antes de pagar quiero pensarlo unos días.' }];
    expect.soft(workflowDeferral(deferral)).toBe(true);
    expect.soft(backendDeferral(deferral)).toBe(true);

    const state = {
      ...createDefaultConversationStateV1(identity),
      call_offer_count: 1 as const,
      call_offer_status: 'offered' as const,
      awaiting_reply: 'call_or_chat' as const,
    };
    const authority = authorizeAgentTurnV2({
      proposal,
      state,
      offerings: [
        { code: 'marketing_digital', display_name: 'Marketing Digital' },
        { code: 'community_manager', display_name: 'Community Manager' },
      ],
      facts: [{
        id: 'offering:marketing_digital:name:v1',
        kind: 'offering_name',
        value: 'Marketing Digital',
        offering_code: 'marketing_digital',
        source: 'business_snapshot',
      }],
      current_customer_messages: ['Sigo sin decidirme: cuál me conviene para conseguir clientes?'],
      call_policy: { may_offer_call: true, may_request_call_now: false },
    });
    expect.soft(authority).toMatchObject({
      ok: true,
      transition: { call_offer_count: 2, call_offer_status: 'offered' },
    });

    const context: AgentAContextV1 = {
      schema_version: 1,
      turn: {
        batch_messages: [{ id: 'm1', text: 'Tengo varias dudas sobre los cursos.' }],
        recent_turns: [],
      },
      customer: { display_name: 'Julia', memories: [] },
      identity: null,
      commercial_state: {
        selected_offering_code: null,
        selected_payment_plan: null,
        stage: 'exploring',
        call_preference: 'unknown',
        call_offer_status: 'offered',
        call_offer_count: 1,
        awaiting_reply: 'call_or_chat',
        payment_reported: false,
      },
      catalog: {
        selected_offering: null,
        available_offerings: [
          { code: 'marketing_digital', fact_id: 'offering:marketing_digital:name:v1', display_name: 'Marketing Digital', area_code: null },
        ],
        areas: [],
        candidate_offerings: [],
        resolution: 'ambiguous',
        payment_plans: [],
      },
      capabilities: {
        may_reply: true,
        may_offer_call: true,
        may_request_call_now: false,
        may_present_payment_options: false,
        may_send_payment_link: false,
        authorized_payment_plan: null,
        intake_status: 'known',
        intake_missing: [],
      },
    };
    const resolved = await resolveAgentAPlannerlessProposalV2({
      initial: {
        proposal,
        provider: 'deepseek-direct',
        model: 'deepseek-v4-flash',
        latency_ms: 10,
        attempt_count: 1,
      },
      context,
      repair_enabled: false,
      repair: async () => { throw new Error('repair must not be needed'); },
      rejection_id: '44444444-4444-4444-8444-444444444444',
    });
    expect.soft(resolved.effective.proposal.response).toEqual({
      messages: ['Comparación principal.', 'Diferencia práctica. Pregunta de cierre.'],
      call_offer: 'Si te sirve, lo vemos en una llamada breve.',
    });
  });

  it('keeps equivalent natural evidence semantic across ingestion, policy and physical-call boundaries', () => {
    expect.soft(extractContactIdentity(
      'Soy Nicolás y dudo entre Excel Integral y Armado y Reparación de PC.',
    ).name).toBe('Nicolás');

    const writtenPreference = 'Por ahora me resulta más cómodo escribir por acá; explicame lo básico.';
    expect.soft(supportsChatPreferenceV1(writtenPreference, true)).toBe(true);
    expect.soft(workflowChatPreference(writtenPreference, true)).toBe(true);

    const context: AgentAContextV1 = {
      schema_version: 1,
      turn: {
        batch_messages: [{
          id: 'm-price-objection',
          text: 'No llego con ese importe; mi presupuesto es bastante limitado.',
        }],
        recent_turns: [],
      },
      customer: { display_name: 'Elena', memories: [] },
      identity: null,
      commercial_state: {
        selected_offering_code: 'fotografia_profesional',
        selected_payment_plan: null,
        stage: 'course_selected',
        call_preference: 'unknown',
        call_offer_status: 'offered',
        call_offer_count: 1,
        awaiting_reply: 'call_or_chat',
        payment_reported: false,
      },
      catalog: {
        selected_offering: {
          code: 'fotografia_profesional',
          display_name: 'Fotografía Profesional',
          area_code: null,
          facts: [{
            id: 'offering:fotografia_profesional:name:v1',
            kind: 'offering_name',
            value: 'Fotografía Profesional',
          }],
        },
        available_offerings: [],
        areas: [],
        candidate_offerings: [],
        resolution: 'exact',
        payment_plans: [],
      },
      capabilities: {
        may_reply: true,
        may_offer_call: true,
        may_request_call_now: false,
        may_present_payment_options: true,
        may_send_payment_link: false,
        authorized_payment_plan: null,
        intake_status: 'known',
        intake_missing: ['apellido', 'correo', 'telefono'],
      },
    };
    expect.soft(evaluateCallOfferTurnPolicyV1({ context })).toMatchObject({
      offer_required: false,
      offer_allowed: true,
      reason: 'SECOND_PRICE_OBJECTION',
    });

    expect.soft(solicitsACallV1(
      'El curso recorre la evolución de la telefonía y la reparación de módulos.',
      true,
    )).toBe(false);
    expect.soft(solicitsACallV1(
      'Si te parece, te llamo y te explico el programa con más detalle.',
      true,
    )).toBe(true);
  });
});
