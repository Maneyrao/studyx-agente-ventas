import { describe, expect, it, vi } from 'vitest';
import type { CanonicalFactRefV1, TurnPlanV1 } from '../../../botpress-agent/src/schemas/conversation-pipeline';
import {
  composeConversationNarrativeV1,
  composeConversationNarrativeWithFallbackV1,
  deterministicNarrativeFallbackV1,
  shouldComposeNarrativeV1,
} from '../../../botpress-agent/src/lib/conversation/conversation-composer';
import {
  CONVERSATION_COMPOSER_PROMPT_VERSION,
  buildConversationComposerInstructionsV2,
} from '../../../botpress-agent/src/prompts/conversation-composer-v2';
import { STUDYX_SALES_BEHAVIOR_VERSION } from '../../../botpress-agent/src/prompts/studyx-sales-behavior-v1';

const plan: TurnPlanV1 = {
  schema_version: 1,
  next_stage: 'course_selected',
  response_goal: 'explain_selected_course',
  canonical_fact_requests: [
    { kind: 'offering_name', offering_code: 'redes-informaticas' },
    { kind: 'offering_duration', offering_code: 'redes-informaticas' },
  ],
  allowed_business_action: { type: 'none' },
  missing_information: [],
  should_offer_call: true,
  next_call_preference: 'unknown',
  next_call_offer_status: 'offered',
  next_awaiting_reply: 'call_or_chat',
  selected_offering_code: 'redes-informaticas',
  selected_payment_plan: null,
};

const refs: CanonicalFactRefV1[] = [
  { id: 'offering:redes-informaticas:name:v1', kind: 'offering_name', offering_code: 'redes-informaticas' },
  { id: 'offering:redes-informaticas:duration:v1', kind: 'offering_duration', offering_code: 'redes-informaticas' },
];

describe('conversation composer V1', () => {
  it('receives the versioned sales behavior while keeping canonical values out', () => {
    const instructions = buildConversationComposerInstructionsV2({
      plan, fact_refs: refs, customer_goal: 'Aprender a administrar redes',
    });
    expect(CONVERSATION_COMPOSER_PROMPT_VERSION).toBe('studyx-conversation-composer-v2');
    expect(STUDYX_SALES_BEHAVIOR_VERSION).toBe('studyx-sales-behavior-v1');
    expect(instructions).toContain(`<studyx_sales_behavior version="${STUDYX_SALES_BEHAVIOR_VERSION}">`);
    expect(instructions).toContain('Respondé primero la consulta actual');
    expect(instructions).toContain('una sola pregunta o CTA');
    expect(instructions).toContain('monthly_12, monthly_6 y one_time');
    expect(instructions).toContain('offering:redes-informaticas:duration:v1');
    expect(instructions).not.toContain('24 clases');
    expect(instructions).not.toContain('USD 360');
    expect(instructions).not.toContain('stripe.com');
  });

  it('passes the commercial behavior contract to the model boundary', async () => {
    let capturedInstructions = '';
    await composeConversationNarrativeV1({ plan, fact_refs: refs, customer_goal: null }, {
      generate: async ({ instructions }) => {
        capturedInstructions = instructions;
        return {
          schema_version: 1,
          narrative: {
            opening: 'Buena elección.',
            explanation: 'Puede ayudarte a avanzar con ese objetivo.',
            next_question: '¿Qué aspecto querés conocer mejor?',
          },
          used_fact_ids: refs.map((fact) => fact.id),
        };
      },
    });
    expect(capturedInstructions).toContain(STUDYX_SALES_BEHAVIOR_VERSION);
    expect(capturedInstructions).toContain('No repitas saludos');
    expect(capturedInstructions).toContain('No inventes cursos');
  });

  it('accepts narrative only when every used fact is an authorized ref', async () => {
    const composition = await composeConversationNarrativeV1({ plan, fact_refs: refs, customer_goal: null }, {
      generate: async () => ({
        schema_version: 1,
        narrative: {
          opening: 'Buena elección.', explanation: 'Puede ayudarte a avanzar con ese objetivo.',
          next_question: '¿Querés profundizar en algún aspecto?',
        },
        used_fact_ids: refs.map((fact) => fact.id),
      }),
    });
    expect(composition.used_fact_ids).toEqual(refs.map((fact) => fact.id));

    await expect(composeConversationNarrativeV1({ plan, fact_refs: refs, customer_goal: null }, {
      generate: async () => ({
        schema_version: 1,
        narrative: { opening: 'Bien.', explanation: null, next_question: null },
        used_fact_ids: ['payment:inventado:one_time:link:v1'],
      }),
    })).rejects.toMatchObject({ code: 'COMPOSER_UNKNOWN_FACT_ID' });
  });

  it('uses a contextual deterministic fallback after one bounded timeout', async () => {
    vi.useFakeTimers();
    const pending = composeConversationNarrativeWithFallbackV1(
      { plan, fact_refs: refs, customer_goal: null },
      { generate: async () => new Promise(() => undefined), timeout_ms: 3_000 },
    );
    await vi.advanceTimersByTimeAsync(3_001);
    await expect(pending).resolves.toEqual(deterministicNarrativeFallbackV1(plan, refs));
    vi.useRealTimers();
  });

  it('composes every conversational goal but keeps business actions deterministic', () => {
    for (const response_goal of [
      'greet_and_discover',
      'guide_area_choice',
      'guide_course_choice',
      'explain_selected_course',
      'continue_course_advice',
      'offer_call_or_chat',
      'acknowledge_chat_preference',
      'acknowledge_call_decline',
      'present_payment_options',
      'confirm_selected_plan',
      'acknowledge_payment_deferral',
      'clarify_current_step',
      'catalog_temporarily_unavailable',
    ] as const) {
      expect(shouldComposeNarrativeV1({ ...plan, response_goal })).toBe(true);
    }
    expect(shouldComposeNarrativeV1({
      ...plan,
      response_goal: 'confirm_call_request',
      allowed_business_action: { type: 'request_call_now', reason: 'direct_request' },
    })).toBe(false);
    expect(shouldComposeNarrativeV1({
      ...plan,
      response_goal: 'confirm_payment_link',
      allowed_business_action: {
        type: 'send_payment_link',
        offering_code: 'redes-informaticas',
        payment_plan: 'monthly_12',
      },
    })).toBe(false);
    expect(shouldComposeNarrativeV1({ ...plan, response_goal: 'acknowledge_purchase_decline' })).toBe(false);
  });
});
