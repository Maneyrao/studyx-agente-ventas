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
    case 'offering_description': return fact.value;
    case 'offering_duration': return displayName
      ? renderCourseDurationValue({ displayName, duration: fact.value })
      : `Duración: ${fact.value}`;
    case 'offering_modality': return displayName
      ? renderCourseModality({ displayName, modality: fact.value })
      : `Modalidad: ${fact.value}`;
    case 'payment_plan_label': return `• ${fact.value}`;
    case 'payment_plan_price': return `Total: ${fact.value}`;
    case 'payment_link': return fact.value;
  }
}

function normalizeMentionText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('es')
    .replace(/\b(\d+)[.,]00\b/gu, '$1');
}

function canonicalPrerequisiteStatement(value: string): string | null {
  if (/\bno requiere conocimientos previos\b/iu.test(value)) {
    return 'No requiere conocimientos previos.';
  }
  if (/\b(?:diseñad[oa]|disenad[oa]) para empezar desde cero\b/iu.test(value)) {
    return 'Está diseñado para empezar desde cero.';
  }
  return null;
}

function mentionedFactIds(narrative: readonly string[], facts: readonly CanonicalFactV1[]): Set<string> {
  const normalizedNarrative = normalizeMentionText(narrative.join('\n'));
  return new Set(facts.filter((fact) => {
    const value = normalizeMentionText(fact.value.trim());
    if (value.length > 0 && normalizedNarrative.includes(value)) return true;
    const prerequisite = fact.kind === 'offering_description'
      ? canonicalPrerequisiteStatement(fact.value)
      : null;
    return prerequisite !== null
      && normalizedNarrative.includes(normalizeMentionText(prerequisite));
  }).map((fact) => fact.id));
}

function requiredFactIds(
  plan: TurnPlanV1,
  refs: readonly CanonicalFactRefV1[],
): string[] {
  const requiredKinds = plan.response_goal === 'guide_area_choice'
    ? new Set<CanonicalFactRefV1['kind']>(['area_name'])
    : plan.response_goal === 'guide_course_choice'
      ? new Set<CanonicalFactRefV1['kind']>(['offering_name'])
      : plan.response_goal === 'present_payment_options'
        ? new Set<CanonicalFactRefV1['kind']>(['payment_plan_label'])
        : null;
  const required = requiredKinds
    ? refs.filter((ref) => requiredKinds.has(ref.kind)).map((ref) => ref.id)
    : [];
  if (plan.response_goal === 'confirm_selected_plan' && plan.selected_payment_plan) {
    required.push(...refs.filter((ref) => (
      ref.kind === 'payment_plan_label'
      && ref.payment_plan === plan.selected_payment_plan
    )).map((ref) => ref.id));
  }
  const action = plan.allowed_business_action;
  if (action.type === 'send_payment_link') {
    required.push(...refs.filter((ref) => (
      ref.kind === 'payment_link'
      && ref.offering_code === action.offering_code
      && ref.payment_plan === action.payment_plan
    )).map((ref) => ref.id));
  }
  return required;
}

function choiceQuestion(plan: TurnPlanV1, narrative: readonly string[]): string | null {
  if (narrative.some((part) => part.includes('?'))) return null;
  switch (plan.response_goal) {
    case 'guide_area_choice': return '¿Cuál de estas áreas te interesa más?';
    case 'guide_course_choice': return '¿Cuál de estas opciones querés conocer mejor?';
    case 'present_payment_options': return '¿Cuál de estas opciones te resulta más conveniente?';
    default: return null;
  }
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
  const selectedFactIds = [...new Set([
    ...input.composition.used_fact_ids,
    ...requiredFactIds(input.plan, input.fact_refs),
  ])];
  for (const id of selectedFactIds) {
    const ref = refsById.get(id);
    const fact = factsById.get(id);
    if (!ref || !fact || ref.kind !== fact.kind) {
      throw new CanonicalResponseAssemblyError('UNKNOWN_FACT_ID');
    }
    selectedFacts.push(fact);
  }
  const effectiveComposition: ComposedNarrativeV1 = input.plan.response_goal === 'present_payment_options'
    ? {
        schema_version: 1,
        narrative: {
          opening: 'Estas son las opciones de pago disponibles.',
          explanation: null,
          next_question: null,
        },
        used_fact_ids: input.composition.used_fact_ids,
      }
    : input.composition;
  const narrative = narrativeText(effectiveComposition);
  const mentionedIds = mentionedFactIds(narrative, input.facts);
  const selectedIds = new Set(selectedFactIds);
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
  const selectedPaymentLabels = new Set(selectedFacts
    .filter((fact) => fact.kind === 'payment_plan_label')
    .map((fact) => `${fact.offering_code ?? ''}\u0000${fact.payment_plan ?? ''}`));
  const redundantFactIds = new Set<string>();
  for (const description of selectedFacts.filter((fact) => fact.kind === 'offering_description')) {
    const sameOffering = selectedFacts.filter((fact) => (
      fact.offering_code === description.offering_code
    ));
    const nameAlreadyExplained = sameOffering.some((fact) => (
      fact.kind === 'offering_name' && mentionedIds.has(fact.id)
    ));
    const detailAlreadyExplained = sameOffering.some((fact) => (
      ['offering_duration', 'offering_modality'].includes(fact.kind)
      && mentionedIds.has(fact.id)
    ));
    if (nameAlreadyExplained && detailAlreadyExplained) redundantFactIds.add(description.id);
  }
  const renderedDescriptions = selectedFacts.filter((fact) => (
    fact.kind === 'offering_description'
    && !mentionedIds.has(fact.id)
    && !redundantFactIds.has(fact.id)
  ));
  for (const fact of selectedFacts.filter((candidate) => (
    candidate.kind === 'offering_duration' || candidate.kind === 'offering_modality'
  ))) {
    if (renderedDescriptions.some((description) => (
      description.offering_code === fact.offering_code
      && normalizeMentionText(description.value).includes(normalizeMentionText(fact.value))
    ))) redundantFactIds.add(fact.id);
  }
  const blocks = [...new Set(selectedFacts
    .filter((fact) => !mentionedIds.has(fact.id))
    .filter((fact) => !redundantFactIds.has(fact.id))
    .filter((fact) => fact.kind !== 'payment_plan_price' || !selectedPaymentLabels.has(
      `${fact.offering_code ?? ''}\u0000${fact.payment_plan ?? ''}`,
    ))
    .map((fact) => renderFact(fact, offeringNames)))];
  const defaultCallQuestion = '¿Preferís que sigamos por chat o querés solicitar una llamada?';
  const callStatement = 'Si querés, también podés solicitar una llamada o seguir por chat.';
  const proposedCallOffer = effectiveComposition.call_offer ?? defaultCallQuestion;
  const callOffer = input.plan.should_offer_call
    ? [input.plan.response_goal === 'present_payment_options'
      || (narrative.some((part) => part.includes('?')) && proposedCallOffer.includes('?'))
      ? callStatement
      : proposedCallOffer]
    : [];
  const content = [
    effectiveComposition.narrative.opening,
    ...blocks,
    effectiveComposition.narrative.explanation,
    ...callOffer,
    effectiveComposition.narrative.next_question ?? choiceQuestion(input.plan, narrative),
  ].filter((value): value is string => value !== null && value.trim().length > 0).join('\n\n');
  if (content.length === 0 || content.length > 4096) {
    throw new CanonicalResponseAssemblyError('ASSEMBLED_CONTENT_INVALID');
  }
  return { content, used_fact_ids: selectedFactIds };
}
