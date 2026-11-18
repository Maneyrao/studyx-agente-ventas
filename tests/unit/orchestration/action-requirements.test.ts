import { describe, expect, it } from 'vitest';
import { computeActionRequirementsV1 } from '@/shared/conversation/action-requirements';
import { deriveCourseFamilyOfferingsV1, resolveCatalogFromSnapshot } from '@/features/orchestration/domain/course-focus';
import type { CatalogIndexView } from '@/features/orchestration/domain/business-context';

const course = (code: string, display_name: string, academy = 'Idiomas') => ({ code, display_name, academy, aliases: [] });
const INDEX: CatalogIndexView = {
  as_of: '2026-11-18', injection_suspected_count: 0, offerings_total: 6,
  offerings: [
    course('ingles_1', 'Inglés 1'), course('ingles_2', 'Inglés 2'), course('ingles_3', 'Inglés 3'), course('ingles_4', 'Inglés IV'),
    course('marketing_digital', 'Marketing Digital', 'Marketing'), course('excel_integral', 'Excel Integral', 'Informática'),
  ],
};
const ENGLISH = INDEX.offerings.slice(0, 4).map(({ code, display_name }) => ({ code, display_name }));
const PLANS = ['monthly_12', 'monthly_6', 'one_time'];
const familyOf = (current: string[], recent: Array<{ direction: 'inbound' | 'outbound'; content: string }> = []) =>
  deriveCourseFamilyOfferingsV1({
    current: resolveCatalogFromSnapshot(current, INDEX, []), currentMessageTexts: current, recentTurns: recent, catalogIndex: INDEX,
  });

describe('computeActionRequirementsV1', () => {
  it('family without level: asks the level first with the complete family, then the plan', () => {
    const [link, test] = computeActionRequirementsV1({ selected_offering_code: null, selected_payment_plan: null,
      family_kind: 'levels', family_offerings: ENGLISH, payment_plan_codes: PLANS });
    expect(link).toMatchObject({ action: 'send_payment_link', ready: false, missing: ['course_selection', 'payment_plan'] });
    expect(link!.options.course_selection).toHaveLength(4);
    expect(test!.action).toBe('send_test_payment_link');
  });
  it('plan said before the course stays missing until the durable plan exists', () => {
    const [link] = computeActionRequirementsV1({ selected_offering_code: null, selected_payment_plan: null,
      family_kind: 'levels', family_offerings: [], payment_plan_codes: PLANS });
    expect(link!.missing).toEqual(['course_selection', 'payment_plan']);
    expect(link!.options.course_selection).toEqual([]);
  });
  it('course chosen, plan missing: only the plan with its options', () => {
    const [link] = computeActionRequirementsV1({ selected_offering_code: 'ingles_2', selected_payment_plan: null,
      family_kind: 'levels', family_offerings: ENGLISH, payment_plan_codes: PLANS });
    expect(link).toMatchObject({ ready: false, missing: ['payment_plan'] });
    expect(link!.options).toMatchObject({ course_selection: [], payment_plan: PLANS });
  });
  it('is ready when level and plan are durable, and recomputes when the level or plan changes', () => {
    const ready = computeActionRequirementsV1({ selected_offering_code: 'ingles_2', selected_payment_plan: 'one_time',
      family_kind: 'levels', family_offerings: ENGLISH, payment_plan_codes: PLANS })[0]!;
    expect(ready).toMatchObject({ ready: true, missing: [] });
    const changed = computeActionRequirementsV1({ selected_offering_code: 'ingles_3', selected_payment_plan: null,
      family_kind: 'levels', family_offerings: ENGLISH, payment_plan_codes: PLANS })[0]!;
    expect(changed.missing).toEqual(['payment_plan']);
  });
});

const family = (current: string[], recent: Array<{ direction: 'inbound' | 'outbound'; content: string }> = []) =>
  familyOf(current, recent).offerings;

describe('deriveCourseFamilyOfferingsV1 (family when the message names no course)', () => {
  it('current ambiguous request: the whole family, not the resolver’s three candidates', () => {
    expect(family(['holaa, qiero info d ingles']).map((c) => c.code)).toEqual(['ingles_1', 'ingles_2', 'ingles_3', 'ingles_4']);
  });
  it('a neutral link request recovers the family from the newest earlier turn with catalog intent', () => {
    const recent = [
      { direction: 'inbound' as const, content: 'holaa, qiero info d ingles' },
      { direction: 'outbound' as const, content: 'Claro, desde qué nivel arrancas?' },
      { direction: 'inbound' as const, content: 'Me contas como se paga' },
    ];
    expect(family(['Pasame el link de pago', '1 solo pago quiero'], recent)).toHaveLength(4);
  });
  it('real conversations: «Ingles» then payment talk, then «Pero mandame el link»', () => {
    const recent = [
      { direction: 'inbound' as const, content: 'Ingles' },
      { direction: 'outbound' as const, content: 'Genial, el inglés tiene varios niveles.' },
      { direction: 'inbound' as const, content: 'Me contas como se paga' },
      { direction: 'outbound' as const, content: 'Puedes pagar en 12 cuotas, 6 cuotas o un solo pago.' },
      { direction: 'inbound' as const, content: 'Pasame el link de pago' },
      { direction: 'outbound' as const, content: 'Desde qué nivel arrancas?' },
    ];
    expect(family(['Pero mandame el link'], recent).map((c) => c.code)).toEqual(['ingles_1', 'ingles_2', 'ingles_3', 'ingles_4']);
    expect(family(['Pasame el link de pago', '1 solo pago quiero'], recent.slice(0, 2))).toHaveLength(4);
  });
  it('no family without catalog intent anywhere, or after a newer different request', () => {
    expect(family(['Pasame el link de pago'], [{ direction: 'inbound', content: 'hola' }])).toEqual([]);
    expect(family(['Pasame el link de pago'], [
      { direction: 'inbound', content: 'holaa, qiero info d ingles' },
      { direction: 'inbound', content: 'mejor Marketing Digital' },
    ])).toEqual([]);
  });
});

describe('levels versus unrelated alternatives (real catalog names)', () => {
  const real = (code: string, name: string) => ({ code, display_name: name, academy: 'Academia', aliases: [] });
  const REAL: CatalogIndexView = { as_of: 'x', injection_suspected_count: 0, offerings_total: 8, offerings: [
    real('ingles_1', 'Inglés 1'), real('ingles_2', 'Inglés 2'), real('ingles_3', 'Inglés 3'), real('ingles_4', 'Inglés IV'),
    real('intro_cripto', 'Introducción a las Criptomonedas'), real('intro_catering', 'Introducción al Catering'),
    real('intro_ecommerce', 'Introducción al Ecommerce'), real('intro_vino', 'Introducción al Vino, la Cata y el Maridaje'),
  ] };
  const of = (text: string) => deriveCourseFamilyOfferingsV1({
    current: resolveCatalogFromSnapshot([text], REAL, []), currentMessageTexts: [text], recentTurns: [], catalogIndex: REAL });
  it('Inglés 1..IV is one family of levels, complete', () => {
    const result = of('holaa, qiero info d ingles');
    expect(result.kind).toBe('levels');
    expect(result.offerings.map((o) => o.code)).toEqual(['ingles_1', 'ingles_2', 'ingles_3', 'ingles_4']);
  });
  it('the «Introducción a…» courses are never levels of each other', () => {
    const result = of('quiero info de introduccion');
    expect(result.kind).toBe('courses');
    expect(result.offerings.every((o) => o.code.startsWith('intro_'))).toBe(true);
  });
  it('candidates with different bases (Inglés 1 + Francés 1) are alternatives, never one levels family', () => {
    const mixed: CatalogIndexView = { as_of: 'x', injection_suspected_count: 0, offerings_total: 4, offerings: [
      real('ingles_1', 'Inglés 1'), real('ingles_2', 'Inglés 2'), real('frances_1', 'Francés 1'), real('frances_2', 'Francés 2')] };
    const result = deriveCourseFamilyOfferingsV1({
      current: { kind: 'ambiguous', requestedText: 'idiomas', candidateCodes: ['ingles_1', 'frances_1'], clarification: 'choose_offering' },
      currentMessageTexts: ['idiomas'], recentTurns: [], catalogIndex: mixed });
    expect(result.kind).toBe('courses');
    expect(result.offerings.map((o) => o.code)).toEqual(['ingles_1', 'frances_1']);
  });
});
