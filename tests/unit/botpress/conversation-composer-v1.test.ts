import { describe, expect, it, vi } from 'vitest';
import type { CanonicalFactRefV1, TurnPlanV1 } from '../../../botpress-agent/src/schemas/conversation-pipeline';
import {
  buildConversationComposerInstructionsV1,
  composeConversationNarrativeV1,
  composeConversationNarrativeWithFallbackV1,
  deterministicNarrativeFallbackV1,
  shouldComposeNarrativeV1,
} from '../../../botpress-agent/src/lib/conversation/conversation-composer';

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
  it('receives only value-free fact refs', () => {
    const instructions = buildConversationComposerInstructionsV1({
      plan, fact_refs: refs, customer_goal: 'Aprender a administrar redes',
    });
    expect(instructions).toContain('offering:redes-informaticas:duration:v1');
    expect(instructions).not.toContain('24 clases');
    expect(instructions).not.toContain('USD 360');
    expect(instructions).not.toContain('stripe.com');
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

  it('skips the model for deterministic and transactional response goals', () => {
    expect(shouldComposeNarrativeV1({ ...plan, response_goal: 'greet_and_discover' })).toBe(false);
    expect(shouldComposeNarrativeV1({ ...plan, response_goal: 'confirm_payment_link' })).toBe(false);
    expect(shouldComposeNarrativeV1(plan)).toBe(true);
  });
});
