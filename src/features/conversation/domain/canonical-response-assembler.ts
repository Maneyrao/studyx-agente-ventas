import {
  stripModelAuthoredCallOffers,
  stripUnsupportedOperationalClaims,
} from './operational-promise-guard';
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
  citedFactIds: ReadonlySet<string>,
): string[] {
  // Presentar las opciones significa mostrarlas todas — salvo que el modelo ya
  // haya nombrado una en concreto. Preguntar "¿cuál es la cuota más baja?" y
  // recibir las tres otra vez no es presentar opciones, es no contestar.
  const citedPaymentLabel = refs.some((ref) => (
    ref.kind === 'payment_plan_label' && citedFactIds.has(ref.id)
  ));
  const requiredKinds = plan.response_goal === 'guide_area_choice'
    ? new Set<CanonicalFactRefV1['kind']>(['area_name'])
    : plan.response_goal === 'guide_course_choice'
      ? new Set<CanonicalFactRefV1['kind']>(['offering_name'])
      : plan.response_goal === 'present_payment_options' && !citedPaymentLabel
        ? new Set<CanonicalFactRefV1['kind']>(['payment_plan_label'])
        : null;
  const required = requiredKinds
    ? refs.filter((ref) => requiredKinds.has(ref.kind)).map((ref) => ref.id)
    : [];
  // Citar un plan cita sus hechos: la etiqueta y el importe describen lo mismo.
  // El modelo referencia el plan por su label; escribir el total en su propia
  // redacción no puede contar como un hecho sin citar.
  const citedPlans = new Set(refs
    .filter((ref) => ref.kind === 'payment_plan_label' && citedFactIds.has(ref.id))
    .map((ref) => `${ref.offering_code ?? ''}\u0000${ref.payment_plan ?? ''}`));
  required.push(...refs.filter((ref) => (
    ref.kind === 'payment_plan_price'
    && citedPlans.has(`${ref.offering_code ?? ''}\u0000${ref.payment_plan ?? ''}`)
  )).map((ref) => ref.id));
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

/**
 * Un plan de pago que el modelo citó Y cuyo importe pronunció ya está dicho:
 * re-adjuntarlo deja un bullet huérfano debajo de la frase que lo nombra.
 *
 * Hace falta la doble señal. Citar solo no alcanza —el modelo puede citar un
 * plan sin nombrarlo, y ahí el bloque canónico es lo único que lo muestra— y
 * el match literal tampoco, porque DeepSeek acorta "6 pagos mensuales de USD
 * 60" a "6 pagos de USD 60". El importe es lo que sobrevive a la paráfrasis.
 */
function alreadyNamedByComposition(
  fact: CanonicalFactV1,
  citedFactIds: ReadonlySet<string>,
  narrative: readonly string[],
): boolean {
  if (fact.kind !== 'payment_plan_label' || !citedFactIds.has(fact.id)) return false;
  const amounts = fact.value.match(/usd\s*\d+(?:[.,]\d+)?/giu) ?? [];
  if (amounts.length === 0) return false;
  const normalizedNarrative = normalizeMentionText(narrative.join('\n'));
  if (!amounts.every((amount) => normalizedNarrative.includes(normalizeMentionText(amount)))) {
    return false;
  }
  // El importe solo no distingue: "el total es USD 360" comparte cifra con el
  // pago único sin nombrarlo. Hace falta además una palabra propia del plan.
  const words = normalizeMentionText(fact.value)
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length >= 4 && word !== 'usd');
  return words.length > 0 && words.some((word) => normalizedNarrative.includes(word));
}

/**
 * Used only when the guards emptied the entire answer. Deliberately says
 * nothing about courses, prices, enrolment or payment: it exists so the
 * customer gets a turn, not so the backend gets to answer for the model.
 */
const LAST_RESORT_OPENING = 'Seguimos por acá. Contame cómo puedo ayudarte.';

function fallbackOpening(responseGoal: TurnPlanV1['response_goal']): string | null {
  switch (responseGoal) {
    case 'present_payment_options': return 'Estas son las opciones de pago disponibles.';
    case 'guide_course_choice': return 'Estas son algunas opciones disponibles.';
    case 'guide_area_choice': return 'Estas son algunas áreas disponibles.';
    // Goals whose whole answer can legitimately be a single sentence. If a
    // guard removes that sentence there is nothing left, and a turn that
    // assembles to nothing is silence — worse than the sentence it replaced.
    case 'acknowledge_payment_report':
      return 'Gracias por avisar. Queda registrado para que una persona lo revise.';
    case 'confirm_current_state': return 'Te confirmo en qué punto quedamos.';
    case 'request_contact_details': return 'Para dejarlo listo necesito unos datos tuyos.';
    default: return null;
  }
}

/**
 * Confirming one plan is not the moment to restate the catalog. The other
 * plans stay authorized — the customer may still name them — but they are
 * never appended as deterministic blocks to a confirmation.
 */
function suppressedByPlanConfirmation(plan: TurnPlanV1, fact: CanonicalFactV1): boolean {
  return plan.response_goal === 'confirm_selected_plan'
    && plan.selected_payment_plan !== null
    && (fact.kind === 'payment_plan_label' || fact.kind === 'payment_plan_price')
    && fact.payment_plan !== plan.selected_payment_plan;
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
  const citedByComposition = new Set(input.composition.used_fact_ids);
  const refsById = new Map(input.fact_refs.map((ref) => [ref.id, ref]));
  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const selectedFacts: CanonicalFactV1[] = [];
  const selectedFactIds = [...new Set([
    ...input.composition.used_fact_ids,
    ...requiredFactIds(input.plan, input.fact_refs, new Set(input.composition.used_fact_ids)),
  ])];
  for (const id of selectedFactIds) {
    const ref = refsById.get(id);
    const fact = factsById.get(id);
    if (!ref || !fact || ref.kind !== fact.kind) {
      throw new CanonicalResponseAssemblyError('UNKNOWN_FACT_ID');
    }
    selectedFacts.push(fact);
  }
  // The choice and payment lists are a backend-owned block rendered as its own
  // paragraph, so a model-authored opening can never suppress them: the egress
  // guard drops offending paragraphs individually and the bullets survive on
  // their own. The deterministic sentence is therefore only a fallback for a
  // composition that carries no opening at all — it must not overwrite one.
  // No turn can enrol, register or grant access to anybody, so a sentence
  // saying one of those already happened is removed before anything else runs.
  // Only the offending sentence goes; the rest of the model's answer stands.
  // The call ledger only means something if every visible offer spends one.
  // The assembler owns the single ledgered offer and appends it below, so an
  // offer inside the model's own narrative is always an unbudgeted extra.
  const clean = (value: string): string => stripModelAuthoredCallOffers(
    stripUnsupportedOperationalClaims(value),
  );
  const composed: ComposedNarrativeV1 = {
    ...input.composition,
    narrative: {
      opening: clean(input.composition.narrative.opening ?? ''),
      explanation: input.composition.narrative.explanation === null
        ? null
        : clean(input.composition.narrative.explanation) || null,
      next_question: input.composition.narrative.next_question === null
        ? null
        : clean(input.composition.narrative.next_question) || null,
    },
  };
  const fallback = fallbackOpening(input.plan.response_goal);
  const effectiveComposition: ComposedNarrativeV1 = fallback !== null
    && (composed.narrative.opening ?? '').trim().length === 0
    ? {
        ...composed,
        narrative: { ...composed.narrative, opening: fallback },
      }
    : composed;
  const narrative = narrativeText(effectiveComposition);
  const mentionedIds = mentionedFactIds(narrative, input.facts);
  const selectedIds = new Set(selectedFactIds);
  // La comparación es por VALOR, no por id. Los tres planes comparten el mismo
  // total canónico, así que escribir "USD 360" marca los tres hechos de precio
  // como mencionados aunque el modelo haya citado uno solo. Rechazarlo por id
  // castigaría un texto indistinguible de otro ya autorizado; lo que el guard
  // debe impedir es afirmar un valor que el turno no tenía, y eso lo sigue
  // haciendo: un valor sin ningún hecho seleccionado que lo respalde cae.
  const authorizedValues = new Set(selectedFacts.map(
    (fact) => `${fact.kind}\u0000${normalizeMentionText(fact.value)}`,
  ));
  const uncited = [...mentionedIds]
    .filter((id) => !selectedIds.has(id))
    .map((id) => factsById.get(id))
    .filter((fact): fact is CanonicalFactV1 => fact !== undefined)
    .filter((fact) => !authorizedValues.has(
      `${fact.kind}\u0000${normalizeMentionText(fact.value)}`,
    ));
  if (uncited.length > 0) {
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
    .filter((fact) => !suppressedByPlanConfirmation(input.plan, fact))
    .filter((fact) => !alreadyNamedByComposition(fact, citedByComposition, narrative))
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
  if (content.length > 4096) {
    throw new CanonicalResponseAssemblyError('ASSEMBLED_CONTENT_INVALID');
  }
  if (content.length === 0) {
    // Everything the model wrote was unsupported and every sentence was
    // removed. This is the only case where a fixed sentence is right: the
    // alternative is silence, and silence after "ya pagué" is worse than a
    // short honest answer. It asserts nothing, so it can never be false.
    return { content: LAST_RESORT_OPENING, used_fact_ids: [] };
  }
  return { content, used_fact_ids: selectedFactIds };
}
