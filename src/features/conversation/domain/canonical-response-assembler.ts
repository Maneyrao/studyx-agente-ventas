import type {
  CanonicalFactRefV1,
  CanonicalFactV1,
  ComposedNarrativeV1,
  TurnPlanV1,
} from './conversation-pipeline';
import {
  renderCourseDurationValue,
  renderCourseModality,
} from '@/features/orchestration/domain/canonical-commercial-copy';

export class CanonicalResponseAssemblyError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'CanonicalResponseAssemblyError';
  }
}

function narrativeText(composition: ComposedNarrativeV1): string[] {
  return [
    composition.narrative.opening,
    composition.narrative.explanation,
    composition.narrative.next_question,
  ].filter((value): value is string => value !== null);
}

function renderFact(
  fact: CanonicalFactV1,
  offeringNames: ReadonlyMap<string, string>,
): string {
  const displayName = fact.offering_code
    ? offeringNames.get(fact.offering_code)
    : undefined;
  switch (fact.kind) {
    case 'area_name': return `• ${fact.value}`;
    case 'offering_name': return `• ${fact.value}`;
    case 'offering_description': return `Descripción: ${fact.value}`;
    case 'offering_duration': return displayName
      ? renderCourseDurationValue({ displayName, duration: fact.value })
      : `Duración: ${fact.value}`;
    case 'offering_modality': return displayName
      ? renderCourseModality({ displayName, modality: fact.value })
      : `Modalidad: ${fact.value}`;
    case 'payment_plan_label': return `• ${fact.value}`;
    case 'payment_plan_price': return `Importe: ${fact.value}`;
    case 'payment_link': return fact.value;
  }
}

function mentionedFactIds(narrative: readonly string[], facts: readonly CanonicalFactV1[]): Set<string> {
  const normalizedNarrative = narrative.join('\n').toLocaleLowerCase('es');
  return new Set(facts.filter((fact) => {
    const value = fact.value.trim().toLocaleLowerCase('es');
    return value.length > 0 && normalizedNarrative.includes(value);
  }).map((fact) => fact.id));
}

export function assembleCanonicalConversationResponseV1(input: {
  readonly plan: TurnPlanV1;
  readonly fact_refs: readonly CanonicalFactRefV1[];
  readonly facts: readonly CanonicalFactV1[];
  readonly composition: ComposedNarrativeV1;
}): { readonly content: string; readonly used_fact_ids: readonly string[] } {
  const refsById = new Map(input.fact_refs.map((ref) => [ref.id, ref]));
  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const selectedFacts: CanonicalFactV1[] = [];
  for (const id of input.composition.used_fact_ids) {
    const ref = refsById.get(id);
    const fact = factsById.get(id);
    if (!ref || !fact || ref.kind !== fact.kind) {
      throw new CanonicalResponseAssemblyError('UNKNOWN_FACT_ID');
    }
    selectedFacts.push(fact);
  }
  const narrative = narrativeText(input.composition);
  const mentionedIds = mentionedFactIds(narrative, input.facts);
  const selectedIds = new Set(input.composition.used_fact_ids);
  if ([...mentionedIds].some((id) => !selectedIds.has(id))) {
    throw new CanonicalResponseAssemblyError('COMPOSER_UNCITED_CANONICAL_FACT');
  }
  if (narrative.some((part) => part.includes('https://') || part.includes('http://'))) {
    throw new CanonicalResponseAssemblyError('COMPOSER_EMITTED_LINK');
  }
  const action = input.plan.allowed_business_action;
  if (action.type === 'send_payment_link') {
    const expected = selectedFacts.filter((fact) => (
      fact.kind === 'payment_link'
      && fact.offering_code === action.offering_code
      && fact.payment_plan === action.payment_plan
    ));
    if (expected.length !== 1) {
      throw new CanonicalResponseAssemblyError('PAYMENT_LINK_FACT_REQUIRED');
    }
  }

  const offeringNames = new Map(selectedFacts
    .filter((fact) => fact.kind === 'offering_name' && fact.offering_code)
    .map((fact) => [fact.offering_code!, fact.value]));
  const blocks = selectedFacts
    .filter((fact) => !mentionedIds.has(fact.id))
    .map((fact) => renderFact(fact, offeringNames));
  const callOffer = input.plan.should_offer_call
    ? ['¿Preferís que sigamos por chat o querés solicitar una llamada?']
    : [];
  const content = [
    input.composition.narrative.opening,
    ...blocks,
    input.composition.narrative.explanation,
    ...callOffer,
    input.composition.narrative.next_question,
  ].filter((value): value is string => value !== null && value.trim().length > 0).join('\n\n');
  if (content.length === 0 || content.length > 4096) {
    throw new CanonicalResponseAssemblyError('ASSEMBLED_CONTENT_INVALID');
  }
  return { content, used_fact_ids: [...input.composition.used_fact_ids] };
}
