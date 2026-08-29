import { describe, expect, it } from 'vitest';
import type {
  CanonicalFactRefV1,
  CanonicalFactV1,
  ComposedNarrativeV1,
  TurnPlanV1,
} from '@/features/conversation/domain/conversation-pipeline';
import {
  assembleCanonicalConversationResponseV1,
  CanonicalResponseAssemblyError,
} from '@/features/conversation/domain/canonical-response-assembler';

function plan(overrides: Partial<TurnPlanV1> = {}): TurnPlanV1 {
  return {
    schema_version: 1, next_stage: 'course_selected', response_goal: 'explain_selected_course',
    canonical_fact_requests: [], allowed_business_action: { type: 'none' }, missing_information: [],
    should_offer_call: false, next_call_preference: 'unknown', next_call_offer_status: 'not_offered',
    next_call_offer_count: 0,
    next_awaiting_reply: 'none', selected_offering_code: 'redes-informaticas',
    selected_payment_plan: null, ...overrides,
  };
}

const facts: CanonicalFactV1[] = [
  { id: 'offering:redes-informaticas:name:v1', kind: 'offering_name', source: 'business_snapshot', value: 'Redes Informáticas', offering_code: 'redes-informaticas' },
  { id: 'offering:redes-informaticas:duration:v1', kind: 'offering_duration', source: 'business_snapshot', value: '24 clases', offering_code: 'redes-informaticas' },
  { id: 'offering:redes-informaticas:modality:v1', kind: 'offering_modality', source: 'business_snapshot', value: 'online', offering_code: 'redes-informaticas' },
];
const refs: CanonicalFactRefV1[] = facts.map(({ source: _source, value: _value, area_code: _area, ...ref }) => ref);
const composition: ComposedNarrativeV1 = {
  schema_version: 1,
  narrative: { opening: 'Te cuento lo principal.', explanation: null, next_question: '¿Qué querés profundizar?' },
  used_fact_ids: refs.map((fact) => fact.id),
};

describe('canonical response assembler V1', () => {
  it('renders names, duration and modality from backend facts exactly once', () => {
    const result = assembleCanonicalConversationResponseV1({ plan: plan(), fact_refs: refs, facts, composition });
    expect(result.content).toContain('Redes Informáticas');
    expect(result.content).toContain('24 clases');
    expect(result.content).toContain('online');
    expect(result.used_fact_ids).toEqual(composition.used_fact_ids);
  });

  it('keeps cited canonical facts inside natural prose without duplicating rigid blocks', () => {
    const naturalComposition: ComposedNarrativeV1 = {
      schema_version: 1,
      narrative: {
        opening: 'Redes Informáticas tiene 24 clases y se cursa online.',
        explanation: 'Podemos ir viendo juntos si coincide con lo que buscás.',
        next_question: '¿Querés que te cuente qué vas a aprender?',
      },
      used_fact_ids: refs.map((fact) => fact.id),
    };

    const result = assembleCanonicalConversationResponseV1({
      plan: plan(), fact_refs: refs, facts, composition: naturalComposition,
    });

    expect(result.content).toBe([
      naturalComposition.narrative.opening,
      naturalComposition.narrative.explanation,
      naturalComposition.narrative.next_question,
    ].join('\n\n'));
    expect(result.content.match(/Redes Informáticas/gu)).toHaveLength(1);
    expect(result.content.match(/24 clases/gu)).toHaveLength(1);
    expect(result.content.match(/online/gu)).toHaveLength(1);
  });

  it('rejects unknown IDs and commercial values that were not cited', () => {
    expect(() => assembleCanonicalConversationResponseV1({
      plan: plan(), fact_refs: refs, facts,
      composition: { ...composition, used_fact_ids: ['unknown'] },
    })).toThrowError(CanonicalResponseAssemblyError);
    expect(() => assembleCanonicalConversationResponseV1({
      plan: plan(), fact_refs: refs, facts,
      composition: {
        ...composition,
        used_fact_ids: [facts[0].id, facts[2].id],
        narrative: { ...composition.narrative, explanation: 'Dura 24 clases.' },
      },
    })).toThrow('COMPOSER_UNCITED_CANONICAL_FACT');
  });

  it('requires and renders one canonical link for an authorized transaction', () => {
    const linkFact: CanonicalFactV1 = {
      id: 'payment:redes-informaticas:monthly_12:link:v1', kind: 'payment_link',
      source: 'payment_config', value: 'https://buy.stripe.com/test_only',
      offering_code: 'redes-informaticas', payment_plan: 'monthly_12',
    };
    const linkRef: CanonicalFactRefV1 = {
      id: linkFact.id, kind: linkFact.kind,
      offering_code: linkFact.offering_code, payment_plan: linkFact.payment_plan,
    };
    const result = assembleCanonicalConversationResponseV1({
      plan: plan({
        next_stage: 'payment_link_sent', response_goal: 'confirm_payment_link',
        allowed_business_action: {
          type: 'send_payment_link', offering_code: 'redes-informaticas', payment_plan: 'monthly_12',
        },
        selected_payment_plan: 'monthly_12',
      }),
      fact_refs: [linkRef], facts: [linkFact],
      composition: {
        schema_version: 1,
        narrative: { opening: 'Perfecto, podés avanzar.', explanation: null, next_question: null },
        used_fact_ids: [linkFact.id],
      },
    });
    expect(result.content.split(linkFact.value)).toHaveLength(2);

    expect(() => assembleCanonicalConversationResponseV1({
      plan: plan({
        allowed_business_action: {
          type: 'send_payment_link', offering_code: 'redes-informaticas', payment_plan: 'monthly_12',
        },
      }),
      fact_refs: [linkRef], facts: [linkFact],
      composition: { ...composition, used_fact_ids: [] },
    })).toThrow('PAYMENT_LINK_FACT_REQUIRED');
  });

  it('keeps fallback copy contextual when facts are unavailable', () => {
    const result = assembleCanonicalConversationResponseV1({
      plan: plan({
        response_goal: 'catalog_temporarily_unavailable',
        selected_offering_code: null,
        missing_information: ['catalog_snapshot'],
      }),
      fact_refs: [], facts: [],
      composition: {
        schema_version: 1,
        narrative: {
          opening: 'No puedo consultar el catálogo en este momento.',
          explanation: 'Podemos retomar tu objetivo sin perder el hilo.',
          next_question: '¿Qué te gustaría aprender?',
        },
        used_fact_ids: [],
      },
    });
    expect(result.content).toContain('catálogo');
    expect(result.content).toContain('objetivo');
  });
});
