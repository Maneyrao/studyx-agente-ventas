import { describe, expect, it } from 'vitest';
import { claimsImmediatePaymentLinkDeliveryV1 } from '@/shared/conversation/payment-link-claim';
import { claimsImmediatePaymentLinkDelivery } from '@/features/conversation/domain/operational-promise-guard';
import { prepareAgentTurnV2 } from '@/features/conversation/application/prepare-agent-turn-v2';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import type { BusinessContextView } from '@/features/orchestration/domain/business-context';
import type { AgentATurnProposalV1 } from '@/features/conversation/domain/agent-a-brain';

const cases: ReadonlyArray<readonly [string, boolean]> = [
  // Owner 2026-11-10: a historical reference is not a new send; a current send still is.
  ['El link que te mandé era de Fotografía.', false],
  ['El enlace que te pasé antes era de Fotografía, ese ya no corre.', false],
  ['Ojo, el link de pago que te envié era para Fotografía.', false],
  ['Te mando el link.', true],
  ['El link que te mando ahora es de Plomería.', true],
  ['El link que te mandé era de Fotografía, ahora te mando el link de Plomería.', true],
  ['Ya tengo tus datos completos, así que si quieres te paso el enlace de pago ahora mismo.', false],
  ['Te envío el enlace de pago para avanzar?', false],
  ['¿Te envío el enlace, para avanzar?', false],
  ['Te envío el enlace, para avanzar?', false],
  ['¿Ya te envié el link, para seguir?', false],
  ['Te paso el enlace, si quieres?', false],
  ['¿Te paso el link ahora?', false],
  ['Si quieres te envío el enlace.', false],
  ['Si quieres, te paso el enlace ahora.', false],
  ['Cuando me confirmes, te paso el link.', false],
  ['Te paso el enlace si quieres avanzar.', false],
  ['Te envío el link cuando lo necesites.', false],
  ['Te paso el enlace, si quieres.', false],
  ['Te paso el enlace ahora, cuando lo necesites.', false],
  ['Te paso el enlace ahora, si quieres avanzar.', false],
  ['Todavía no te envío el enlace.', false],
  ['Aún no te envié el link.', false],
  ['No te lo he enviado; me falta tu correo para el enlace.', false],
  ['¿Ya te envié el enlace?', false],
  ['Te paso el link ahora.', true],
  // Incident B (2026-11-10): a resend is the same effect claim.
  ['Dale, te reenvío el enlace en 12 cuotas.', true],
  ['Listo, ya te reenvié el link con el correo corregido.', true],
  ['Si me confirmas el correo, te reenvío el enlace.', false],
  ['Te dejo el enlace para que lo hagas.', true],
  ['Ahí va el link.', true],
  ['Ahí va, Matía. El enlace es de Stripe.', true],
  ['¿Ahí va el enlace, para avanzar?', false],
  ['Si quieres ahí va. El enlace es de Stripe.', false],
  ['Ya te envié el link, si quieres seguimos por aquí.', true],
  ['Ya te envié el enlace, si quieres seguimos por aquí?', true],
  ['Ya te envié el enlace, para seguir?', true],
  ['Te paso el enlace ahora, si quieres seguimos por aquí?', true],
  ['El enlace ya quedó disponible, si quieres seguimos por aquí?', true],
  ['Te paso el enlace ahora, si prefieres continuamos por chat.', true],
  ['Te paso el enlace ahora, si quieres te ayudo con el curso?', true],
  ['Te paso el enlace ahora, cuando lo necesites revisamos los detalles?', true],
  ['Te paso el enlace ahora, si quieres puedes revisar los detalles?', true],
  ['Te paso el enlace ahora, si quieres luego revisamos los detalles?', true],
  ['No te preocupes, te paso el enlace ahora.', true],
  ['Te envié el enlace. ¿Quieres continuar?', true],
  ['Ya te envié el enlace, quieres continuar?', true],
  ['No te preocupes, te paso el enlace ahora y si quieres seguimos por aquí.', true],
  ['Te paso el enlace ahora, ¿de acuerdo?', true],
  ['Si quieres te explico los planes. Te paso el enlace ahora.', true],
  ['Si quieres te explico los planes, pero te paso el enlace ahora.', true],
  ['No te envío el enlace todavía. Ahí va el link.', true],
  ['Te paso el enlace ahora. Si quieres seguimos por chat.', true],
  ['Sí, te envío el enlace ahora.', true],
  ['Sí te envío el enlace ahora.', true],
  ['El enlace ya quedó disponible. Si quieres seguimos por aquí.', true],
  ['El enlace de pago: ya te lo envié.', true],
  ['Podemos seguir por aquí con el curso.', false],
];

describe('payment link delivery claims', () => {
  it.each(cases)('classifies only the matched claim, keeping its question/condition/negation scope: %s', (text, expected) => {
    expect(claimsImmediatePaymentLinkDeliveryV1(text)).toBe(expected);
    expect(claimsImmediatePaymentLinkDelivery(text)).toBe(expected);
  });
});

const ids = {
  workspace: '10000000-0000-4000-8000-000000000001', conversation: '10000000-0000-4000-8000-000000000002',
  contact: '10000000-0000-4000-8000-000000000003', turn: '10000000-0000-4000-8000-000000000004',
};

const business: BusinessContextView = {
  as_of: '2026-10-14T12:00:00.000Z', prices_assertable: true,
  workspace: { slug: 'studyx', display_name: 'StudyX', environment: 'sandbox', default_locale: 'es-AR',
    timezone: 'America/Argentina/Buenos_Aires', payment_options: [{ code: 'one_time', label: '1 pago de USD 360',
      total: { amount: '360.00', currency: 'USD' }, installments: 1, installment_amount: '360.00',
      payment_link: 'https://buy.stripe.com/unit_test_one_time' }] },
  offerings: [{ code: 'python', display_name: 'Python', aliases: [], academy: 'Tecnología', offering_type: 'course',
    description: 'Programación práctica.', value_proposition: null, price_type: 'fixed',
    price: { amount: '360.00', currency: 'USD' }, price_assertable: true, billing_interval: null,
    modality: 'online', schedules: [], certification: true, hours_per_month: 8, classes: 16, modules: 4,
    includes: [], syllabus_published: true, language: 'Spanish', min_age: null,
    policies: { allowed_promise: null, forbidden_promises: [], price_message: null } }],
  qualification_fields: [], injection_suspected_count: 0, offerings_truncated: 0,
};

async function prepare(text: string) {
  const proposal: AgentATurnProposalV1 = {
    schema_version: 1,
    move: { schema_version: 1, move: 'select_payment_plan', payment_plan: 'one_time', secondary_moves: [], vetoes: [], confidence: 1 },
    response: { messages: [text] }, proposed_action: { type: 'none' },
    used_fact_ids: ['state:intake_recorded:v1'], used_memory_ids: [], memory_candidates: [], repair_of: null,
  };
  const state = {
    ...createDefaultConversationStateV1({ workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact }),
    selected_offering_code: 'python', stage: 'course_selected' as const,
    created_at: business.as_of, updated_at: business.as_of,
    call_preference: 'chat' as const, call_offer_status: 'declined' as const, call_offer_count: 2 as const,
  };
  return prepareAgentTurnV2({
    turn: { id: ids.turn, workspace_id: ids.workspace, conversation_id: ids.conversation, contact_id: ids.contact },
    workspace_slug: 'studyx', current_customer_messages: ['quiero 1 pago'], semantic_rejections: 'advisory',
    proposal, business_context: business,
    catalog_index: { as_of: '2026-10-14T12:00:00.000Z', offerings_total: 1, injection_suspected_count: 0,
      offerings: [{ code: 'python', display_name: 'Python', academy: 'Tecnología', aliases: [] }] },
  }, {
    state_store: { load: async () => state },
    contact_intake: async () => ({ nombre: 'Lucas', apellido: 'Pérez', correo: 'lucas@example.test', telefono: '+5491123456789' }),
    now: () => Date.parse('2026-10-14T12:00:00.000Z'),
  });
}

describe('backend payment claim authority', () => {
  it.each([
    'Ya tengo tus datos completos, así que si quieres te paso el enlace de pago ahora mismo.',
    'Te envío el enlace de pago para avanzar?',
    'Te paso el enlace, si quieres.',
    'Te paso el enlace ahora, cuando lo necesites.',
  ])('keeps the plan selection and model prose without requiring a delivery action for an offer: %s', async (text) => {
    const result = await prepare(text);
    expect(result.response_messages).toEqual([text]);
    expect(result.decision.business_action).toBeNull();
    expect(result.transition.selected_payment_plan).toBe('one_time');
  });

  it.each([
    'Te paso el link ahora.',
    'Ahí va el link.',
    'Ya te envié el link, si quieres seguimos por aquí.',
    'No te preocupes, te paso el enlace ahora.',
    'Ya te envié el enlace, si quieres seguimos por aquí?',
    'Ya te envié el enlace, para seguir?',
    'Te paso el enlace ahora, si quieres seguimos por aquí?',
    'El enlace ya quedó disponible, si quieres seguimos por aquí?',
    'Te paso el enlace ahora, si quieres puedes revisar los detalles?',
    'Te paso el enlace ahora, si quieres luego revisamos los detalles?',
  ])('rejects an actual delivery assertion without an authorized delivery action: %s', async (text) => {
    await expect(prepare(text)).rejects.toMatchObject({ code: 'AGENT_TURN_V2_REJECTED', reasons: ['ACTION_NOT_AUTHORIZED'] });
  });
});
