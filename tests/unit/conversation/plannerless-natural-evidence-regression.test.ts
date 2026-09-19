import { describe, expect, it } from 'vitest';
import { authorizeAgentTurnV2 } from '@/features/conversation/domain/agent-turn-policy-v2';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import { hasTemporalPaymentDeferral as backendDeferral } from '@/features/payments/domain/payment-choice-policy';
import { extractContactIdentity } from '@/lib/heuristics/contact-identity';
import { supportsChatPreferenceV1 } from '@/features/conversation/domain/channel-preference-evidence';
import { solicitsACallV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import { evaluateCallOfferTurnPolicyV1 } from '../../../botpress-agent/src/lib/conversation/call-offer-turn-policy';
import { supportsChatPreferenceV1 as workflowChatPreference } from '../../../botpress-agent/src/lib/conversation/channel-preference-evidence';
import { resolveAgentAPlannerlessProposalV2 } from '../../../botpress-agent/src/lib/conversation/resolve-agent-a-plannerless';
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
    messages: ['Comparación principal.', 'Diferencia práctica.', 'Pregunta de cierre.'],
    call_offer: 'Si te sirve, lo vemos en una llamada breve.',
  },
  proposed_action: { type: 'none' },
  used_fact_ids: ['offering:marketing_digital:name:v1'],
  used_memory_ids: [],
  memory_candidates: [],
  repair_of: null,
};

describe('plannerless natural evidence regression', () => {
  it('treats a prior refusal as turn-local and requires the final reminder on a later detail request', () => {
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
      offer_required: true,
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
      messages: ['Comparación principal.', 'Diferencia práctica.', 'Pregunta de cierre.'],
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
      offer_required: true,
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
