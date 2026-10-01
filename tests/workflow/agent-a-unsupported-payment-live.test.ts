import { expect, it } from 'vitest';

import { generateDeepSeekAgentATurnProposalV1 } from '../../botpress-agent/src/lib/conversation/agent-a-brain';
import type { AgentAContextV1 } from '../../botpress-agent/src/schemas/agent-a-brain';

function unsupportedPaymentContext(): AgentAContextV1 {
  const previousReply = [
    'Para Inglés 2 los planes son estos:',
    '12 pagos mensuales de USD 30',
    '6 pagos mensuales de USD 60',
    'Pago único de USD 360',
    'Cuál te acomoda más?',
  ].join('\n');

  return {
    schema_version: 1,
    turn: {
      batch_messages: [
        { id: 'message-1', text: 'quiero el pago de 0,6 usd' },
        { id: 'message-2', text: 'lo tienen?' },
      ],
      recent_turns: [
        { id: 'turn-in-1', direction: 'inbound', content: 'Qué planes tienen para Inglés 2?' },
        { id: 'turn-out-1', direction: 'outbound', content: previousReply },
      ],
    },
    continuity: {
      assistant_has_spoken: true,
      first_name_status: 'known',
      last_agent_reply: previousReply,
    },
    customer: {
      display_name: 'Thiago Maneyro',
      contact_intake: {
        nombre: 'Thiago',
        apellido: 'Maneyro',
        correo: 'thiago@example.test',
        telefono: '+5491155550101',
      },
      memories: [],
    },
    identity: {
      advisor_name: 'Emma',
      academy_name: 'StudyX',
      website: null,
      instagram: null,
    },
    commercial_state: {
      selected_offering_code: 'ingles_2',
      selected_payment_plan: null,
      stage: 'course_selected',
      call_preference: 'unknown',
      call_offer_status: 'offered',
      call_offer_count: 1,
      awaiting_reply: 'payment_plan',
      payment_reported: false,
    },
    obligations: {
      stage: 'course_selected',
      owes: ['option_close'],
      not_yet: [],
    },
    catalog: {
      selected_offering: {
        code: 'ingles_2',
        display_name: 'Inglés 2',
        area_code: 'idiomas',
        facts: [
          { id: 'offering:ingles_2:name:v1', kind: 'offering_name', value: 'Inglés 2' },
        ],
      },
      available_offerings: [],
      areas: [
        { code: 'idiomas', fact_id: 'area:idiomas:name:v1', display_name: 'Idiomas' },
      ],
      candidate_offerings: [],
      resolution: 'exact',
      payment_plans: [
        {
          code: 'monthly_12',
          fact_id: 'payment:ingles_2:monthly_12:label:v1',
          label: '12 pagos mensuales de USD 30',
        },
        {
          code: 'monthly_6',
          fact_id: 'payment:ingles_2:monthly_6:label:v1',
          label: '6 pagos mensuales de USD 60',
        },
        {
          code: 'one_time',
          fact_id: 'payment:ingles_2:one_time:label:v1',
          label: 'Pago único de USD 360',
        },
      ],
      test_payment_options: [
        {
          code: 'stripe_verification_050',
          fact_id: 'payment-test:stripe_verification_050:label:v1',
          label: 'Prueba temporal de pago de USD 0,50',
          action: 'send_test_payment_link',
        },
      ],
    },
    capabilities: {
      may_reply: true,
      may_offer_call: true,
      may_request_call_now: false,
      may_present_payment_options: true,
      may_send_payment_link: true,
      authorized_payment_plan: null,
      intake_status: 'known',
      intake_missing: [],
    },
  };
}

it('answers an unavailable payment amount directly without repeating the previous plan list', async () => {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  expect(apiKey, 'DEEPSEEK_API_KEY_MISSING').toBeTruthy();

  const generated = await generateDeepSeekAgentATurnProposalV1({
    context: unsupportedPaymentContext(),
    apiKey: apiKey!,
    signal: new AbortController().signal,
  });
  const answer = generated.proposal.response.messages.join('\n');

  expect(answer).toMatch(/0[,.]50/u);
  expect(answer).not.toMatch(/12 pagos|6 pagos|USD 360/iu);
  expect(generated.proposal.proposed_action).toEqual({ type: 'none' });
}, 30_000);
