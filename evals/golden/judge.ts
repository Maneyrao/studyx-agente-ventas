import { negotiationEvidenceV1, negotiationSemanticTurnV1, type GenerationNegotiationFactsV1 } from './negotiation-evidence';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GoldenCaseV1, GoldenTurnV1 } from './scenarios';

export interface GoldenModelAttemptV1 {
  readonly attempt: number;
  readonly response: string | null;
  readonly move: string | null;
  readonly proposedAction: unknown;
  readonly turnRejection: unknown;
  readonly providerStatus: number | null;
  readonly providerError: string | null;
}

export interface EarlyCallOfferEvidenceV1 {
  readonly conversationId: string;
  readonly turnId: string;
  readonly responseOrdinal: 2 | 3;
  readonly callOffer: string;
  readonly committed: boolean;
  readonly delivered: boolean;
  readonly persistedOfferCount: number;
}

export interface GoldenTurnObservationV1 {
  readonly conversationId?: string;
  readonly earlyCallOfferEvidence?: readonly EarlyCallOfferEvidenceV1[];
  readonly ruleBonusBeforeTurn?: { readonly paid_offering_code: string; readonly bonus_offering_code: string;
    readonly position: number } | null;
  readonly callOffer?: string | null;
  readonly recordedCallOfferCount?: number;
  readonly ruleOutcomes?: { readonly rule_a: unknown; readonly rule_b: unknown } | null;
  readonly negotiationFacts?: GenerationNegotiationFactsV1;
  readonly response: string;
  readonly move: string | null;
  readonly secondaryMoves: readonly string[];
  readonly proposedAction: Record<string, unknown> | null;
  readonly backendAction: string | null;
  readonly backendRejections: readonly unknown[];
  readonly state: {
    readonly selectedCourse: string | null;
    readonly stage: string | null;
    readonly awaitingReply: string | null;
    readonly plan: string | null;
    readonly promotion: {
      readonly status: string | null;
      readonly bonusCount: number;
      readonly paidCourse: string | null;
      readonly bonusCourses: readonly string[];
      readonly cycleId?: string | null;
      readonly offerVersion?: number | null;
    };
  };
  /** Offering codes whose official PDF was delivered as a document this turn. */
  readonly programDocuments?: readonly string[];
  /** Offering codes whose course image was delivered this turn. */
  readonly programImages?: readonly string[];
  /** Kind of each delivered PDF: the official programme or the manual ficha. */
  readonly programDocumentKinds?: readonly ('program' | 'ficha')[];
  readonly deliveredLinks: readonly string[];
  readonly authorizedFactIds: readonly string[];
  readonly authorizedFacts: readonly { readonly id: string; readonly kind: string; readonly value: string }[];
  readonly usedFactIds: readonly string[];
  readonly availableOfferings: readonly { readonly code: string; readonly displayName: string }[];
  readonly selectedOfferingFacts: readonly { readonly id: string; readonly kind: string; readonly value: string }[];
  readonly modelAttempts: readonly GoldenModelAttemptV1[];
  readonly callRequirements?: readonly string[];
  readonly profileRequestedFields?: readonly string[];
  readonly activeCourses?: readonly string[];
  readonly activeCourseNames?: readonly { readonly code: string; readonly displayName: string }[];
  readonly mayOfferCall?: boolean | null;
  readonly courseBonus?: {
    readonly enabled: boolean | null;
    readonly maxBonusCourses: number | null;
    readonly mayOfferBonus: boolean | null;
    readonly status: string | null;
  };
  readonly priceObjectionMemory?: {
    readonly present: boolean;
    readonly sourceMessageIds: readonly string[];
    readonly priorSourceMessageIds: readonly string[];
  };
  readonly workflow?: {
    readonly commitSucceeded: boolean;
    readonly status: string | null;
    readonly errorCode: string | null;
    readonly finalBackendDecisionError: string | null;
  };
}

export interface GoldenFailureV1 {
  readonly code: string;
  readonly detail: string;
  readonly authorityReference?: string;
}

export interface HardJudgeResultV1 {
  readonly failures: readonly GoldenFailureV1[];
  readonly evaluatorErrors: readonly GoldenFailureV1[];
}

function normalized(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es');
}

function includesText(haystack: string, needle: string): boolean {
  return normalized(haystack).includes(normalized(needle));
}

export function asksWorkVsInvestmentChoice(response: string): boolean {
  return (response.match(/[^.!?\n]*\?/gu) ?? []).some((question) => {
    const value = normalized(question);
    return /\btrabaj\w*\b/u.test(value)
      && /\b(?:inmobiliari\w*|propiedad\w*|inmueble\w*)\b/u.test(value)
      && /\binvert\w*\b|\binversion\w*\b/u.test(value);
  });
}

function actionType(observation: GoldenTurnObservationV1): string {
  const value = observation.proposedAction?.type;
  return typeof value === 'string' ? value : observation.backendAction ?? 'none';
}

function offeringName(observation: GoldenTurnObservationV1, code: string): string {
  return observation.availableOfferings.find((item) => item.code === code)?.displayName
    ?? code.replaceAll('_', ' ');
}

function activeCourseName(observation: GoldenTurnObservationV1, code: string): string | null {
  return observation.activeCourseNames?.find((item) => item.code === code)?.displayName ?? null;
}

function add(failures: GoldenFailureV1[], code: string, detail: string): void {
  failures.push({ code, detail });
}

function currentPriceObjectionRecorded(observation: GoldenTurnObservationV1): boolean | null {
  const objection = observation.priceObjectionMemory;
  if (!objection) return null;
  const prior = new Set(objection.priorSourceMessageIds);
  return objection.present && objection.sourceMessageIds.some((sourceMessageId) => !prior.has(sourceMessageId));
}

function priorPromotionPreconditionFailure(
  turn: GoldenTurnV1,
  previousObservation: GoldenTurnObservationV1 | null,
): GoldenFailureV1 | null {
  const expected = turn.priorPromotion;
  if (!expected) return null;
  const actual = previousObservation?.state.promotion;
  if (actual
    && expected.status.includes(actual.status)
    && expected.bonusCount.includes(actual.bonusCount)
    && (!expected.paidCourse || expected.paidCourse.includes(actual.paidCourse))) return null;
  return {
    code: 'TURN_PRECONDITION_NOT_REACHED',
    detail: `La regla de este turno no se puede atribuir de forma independiente: el turno anterior debía dejar promoción status=${expected.status.join('|')}, bonusCount=${expected.bonusCount.join('|')}${expected.paidCourse ? `, paidCourse=${expected.paidCourse.join('|')}` : ''}; real status=${actual?.status ?? 'null'}, bonusCount=${actual?.bonusCount ?? 0}, paidCourse=${actual?.paidCourse ?? 'null'}.`,
  };
}

export function turnHasRequiredPriorPromotion(
  turn: GoldenTurnV1,
  previousObservation: GoldenTurnObservationV1 | null,
): boolean {
  return priorPromotionPreconditionFailure(turn, previousObservation) === null;
}

/** Eval-only text heuristics (golden judge); the runtime never uses them. */
const CALL_OFFER_TEXT = /\b(?:llamada|llamarte|llamarnos|videollamada|agendar)\b/iu;
const ENROLLMENT_ASK = /(?:inscrib\w*|anotar\w*|reservar\w*|arrancamos|avanzamos|link de pago|plan de pago|qu[eé] plan|12 cuotas|6 cuotas)[^?.!\n]*\?/iu;
const visibleKey = (value: string): string => value.replace(/\s+/gu, ' ').trim().toLowerCase();

export function evaluateHardRules(
  turn: GoldenTurnV1,
  observation: GoldenTurnObservationV1,
  previousObservation: GoldenTurnObservationV1 | null = null,
  evaluationMode?: 'negotiation_invariants',
): HardJudgeResultV1 {
  const failures: GoldenFailureV1[] = [];
  const evaluatorErrors: GoldenFailureV1[] = [];
  if(evaluationMode==='negotiation_invariants') {
    // Keep objective facts; discard only positional labels/package milestones.
    const retained=new Set(['current_price_objection_recorded','offered_bonus_named','question_count_at_most','response_uses_authorized_syllabus','selected_course_equals','payment_link_delivered','requests_only_missing_call_fields','access_lists_all_activated_courses']);
    const hard=turn.hard?.filter(rule=>retained.has(rule.type))??[];
    // Configuration and prior-memory evidence are facts whenever an actual bonus is proposed/executed.
    if(observation.proposedAction?.type==='offer_course_bonus'||observation.backendAction==='offer_course_bonus')hard.push({type:'course_bonus_preconditions'});
    const result=evaluateHardRules({...turn,priorPromotion:undefined,expected:{move:[observation.move??'none'],action:[actionType(observation)],state:{}},hard},observation,previousObservation);
    if(!observation.workflow)return {...result,evaluatorErrors:[...result.evaluatorErrors,{code:'WORKFLOW_EVIDENCE_MISSING',detail:'No commit receipt evidence.'}]};
    if(!observation.workflow.commitSucceeded||observation.workflow.errorCode||observation.workflow.finalBackendDecisionError)return {...result,failures:[...result.failures,{code:'WORKFLOW_COMMIT_FAILED',detail:JSON.stringify(observation.workflow)}]};
    return result;
  }
  const preconditionFailure = priorPromotionPreconditionFailure(turn, previousObservation);
  if (preconditionFailure) return { failures: [preconditionFailure], evaluatorErrors };
  if (!observation.response.trim()) add(failures, 'SILENT_TURN', 'No hubo respuesta visible autorizada.');

  const observedMoves = [observation.move ?? 'none', ...observation.secondaryMoves].filter(
    (value): value is string => typeof value === 'string',
  );
  if (!turn.expected.move.some((expected) => observedMoves.includes(expected))) {
    add(failures, 'MOVE_MISMATCH', `Esperado ${turn.expected.move.join('|')}; real ${observedMoves.join('+') || 'null'}.`);
  }
  const actualAction = actionType(observation);
  if (!turn.expected.action.includes(actualAction)) {
    add(failures, 'ACTION_MISMATCH', `Esperada ${turn.expected.action.join('|')}; real ${actualAction}.`);
  }
  const expectedCheckout = turn.expected.state.checkout;
  if (expectedCheckout) {
    const actualCheckout = observation.state.stage === 'payment_link_sent'
      ? 'link' : observation.state.awaitingReply;
    if (!expectedCheckout.includes(actualCheckout as typeof expectedCheckout[number])) {
      add(failures, 'CHECKOUT_STATE_MISMATCH', `Esperado ${expectedCheckout.join('|')}; real ${actualCheckout}.`);
    }
  }
  if (turn.expected.state.closed !== undefined
    && (observation.state.stage === 'closed') !== turn.expected.state.closed) {
    add(failures, 'CLOSURE_STATE_MISMATCH', `Esperado closed=${String(turn.expected.state.closed)}; real stage=${observation.state.stage}.`);
  }
  if (turn.expected.state.plan && !turn.expected.state.plan.includes(observation.state.plan)) {
    add(failures, 'STATE_PLAN_MISMATCH', `Esperado ${turn.expected.state.plan.join('|')}; real ${observation.state.plan}.`);
  }
  const expectedPromotion = turn.expected.state.promotion;
  if (expectedPromotion && !expectedPromotion.status.includes(observation.state.promotion.status)) {
    add(failures, 'PROMOTION_STATUS_MISMATCH', `Esperado ${expectedPromotion.status.join('|')}; real ${observation.state.promotion.status}.`);
  }
  if (expectedPromotion && !expectedPromotion.bonusCount.includes(observation.state.promotion.bonusCount)) {
    add(failures, 'PROMOTION_BONUS_COUNT_MISMATCH', `Esperado ${expectedPromotion.bonusCount.join('|')}; real ${observation.state.promotion.bonusCount}.`);
  }
  if (expectedPromotion?.paidCourse && !expectedPromotion.paidCourse.includes(observation.state.promotion.paidCourse)) {
    add(failures, 'PROMOTION_PAID_COURSE_MISMATCH', `Esperado ${expectedPromotion.paidCourse.join('|')}; real ${observation.state.promotion.paidCourse}.`);
  }

  for (const rule of turn.hard ?? []) {
    if (rule.type === 'workflow_committed' && (!observation.workflow?.commitSucceeded
      || observation.workflow.errorCode || observation.workflow.finalBackendDecisionError)) {
      add(failures, 'WORKFLOW_COMMIT_FAILED', JSON.stringify(observation.workflow ?? null));
    }
    if (rule.type === 'call_offer_recorded' && (!observation.callOffer?.trim()
      || !observation.response.includes(observation.callOffer) || !(observation.recordedCallOfferCount! > 0))) {
      add(failures, 'EARLY_CALL_OFFER_NOT_RECORDED', 'Falta call_offer entregado con transición persistida de invitación.');
    }
    if (rule.type === 'early_call_previously_recorded' && (!(observation.recordedCallOfferCount! > 0)
      || !observation.conversationId || !observation.earlyCallOfferEvidence?.some(source => (
        source.conversationId === observation.conversationId && Boolean(source.turnId)
        && [2, 3].includes(source.responseOrdinal) && source.committed === true && source.delivered === true
        && source.persistedOfferCount > 0 && source.callOffer.trim().length > 0
      )))) {
      add(failures, 'EARLY_CALL_DELIVERY_EVIDENCE_MISSING', 'Falta recibo y entrega de una invitación de la segunda/tercera respuesta en este mismo diálogo.');
    }
    if (rule.type === 'rule_outcomes_recorded') {
      const outcomes = observation.ruleOutcomes;
      const allowed = ['model', 'rewrite', 'fixed', 'not_applicable'];
      if (!outcomes || !allowed.includes(String(outcomes.rule_a)) || !allowed.includes(String(outcomes.rule_b))) {
        add(failures, 'RULE_OUTCOMES_NOT_RECORDED', 'Falta registro por turno de ambas reglas A/B.');
      }
    }
    if (rule.type === 'current_course_facts_present') {
      const facts = observation.authorizedFacts.filter(fact => fact.id.includes(`offering:${rule.value}:`));
      if (!facts.some(fact => /duration/iu.test(`${fact.id} ${fact.kind}`))) {
        add(failures, 'CURRENT_COURSE_FACTS_MISSING', `Falta duración autorizada de ${rule.value} en el contexto de generación de este turno.`);
      }
    }
    if (rule.type === 'contains' && !includesText(observation.response, rule.value)) {
      add(failures, 'TEXT_REQUIRED_MISSING', `Falta ${JSON.stringify(rule.value)}.`);
    }
    if (rule.type === 'not_contains' && includesText(observation.response, rule.value)) {
      add(failures, 'TEXT_FORBIDDEN_PRESENT', `Aparece ${JSON.stringify(rule.value)}.`);
    }
    if (rule.type === 'question_count_at_most') {
      const count = (observation.response.match(/[?]/gu) ?? []).length;
      if (count > rule.value) add(failures, 'TOO_MANY_QUESTIONS', `Máximo ${rule.value}; real ${count}.`);
    }
    if (rule.type === 'promotion_bonus_count_at_most'
      && observation.state.promotion.bonusCount > rule.value) {
      add(failures, 'PROMOTION_LIMIT_EXCEEDED', `Máximo ${rule.value}; real ${observation.state.promotion.bonusCount}.`);
    }
    if (rule.type === 'bonus_in_when_offered' && actualAction === 'offer_course_bonus') {
      const bonus = observation.proposedAction?.bonus_offering_code;
      if (typeof bonus !== 'string' || !rule.values.includes(bonus)) {
        add(failures, 'BONUS_AFFINITY_MISMATCH', `Bonificación real ${String(bonus)}; opciones afines ${rule.values.join('|')}.`);
      }
    }
    if (rule.type === 'offered_bonus_named' && actualAction === 'offer_course_bonus') {
      const code = observation.proposedAction?.bonus_offering_code;
      if (typeof code !== 'string' || !includesText(observation.response, offeringName(observation, code))) {
        add(failures, 'BONUS_NOT_NAMED', `El curso bonificado ${String(code)} no se nombra en el texto entregado.`);
      }
    }
    if (rule.type === 'no_call_offer' && (Boolean(observation.callOffer?.trim()) || actualAction === 'request_call_now'
      || CALL_OFFER_TEXT.test(observation.response))) {
      add(failures, 'CALL_OFFERED_WITHOUT_REQUEST', 'El turno ofrece o menciona una llamada sin pedido ni duda compleja.');
    }
    if (rule.type === 'no_enrollment_ask' && ENROLLMENT_ASK.test(observation.response)) {
      add(failures, 'ENROLLMENT_ASKED_WITHOUT_SIGNAL', 'El turno pide inscripción o plan sin señal de compra.');
    }
    if (rule.type === 'no_consecutive_enrollment_ask' && previousObservation
      && ENROLLMENT_ASK.test(observation.response) && ENROLLMENT_ASK.test(previousObservation.response)) {
      add(failures, 'CONSECUTIVE_ENROLLMENT_ASK', 'Dos turnos seguidos piden inscripción o plan.');
    }
    if (rule.type === 'not_repeat_previous_reply' && previousObservation
      && visibleKey(observation.response) !== '' && visibleKey(observation.response) === visibleKey(previousObservation.response)) {
      add(failures, 'LITERAL_REPEAT_OF_PREVIOUS_REPLY', 'La respuesta repite literalmente la anterior.');
    }
    if (rule.type === 'action_bonus_in') {
      const bonus = observation.proposedAction?.bonus_offering_code;
      if (actualAction !== 'offer_course_bonus' || typeof bonus !== 'string' || !rule.values.includes(bonus)) {
        add(failures, 'BONUS_AFFINITY_MISMATCH', `Bonificación real ${String(bonus)}; opciones afines ${rule.values.join('|')}.`);
      }
    }
    if (rule.type === 'response_mentions_all_promotions') {
      const expectedCodes = [observation.state.promotion.paidCourse, ...observation.state.promotion.bonusCourses]
        .filter((value): value is string => Boolean(value));
      const missing = expectedCodes.filter((code) => !includesText(observation.response, offeringName(observation, code)));
      if (missing.length > 0) add(failures, 'PROMOTION_RECAP_MISSING', `No recapitula ${missing.join(', ')}.`);
    }
    // The official PDF itself is the answer when it was sent (owner 2026-11-04): the text need not restate the syllabus.
    if (rule.type === 'response_uses_authorized_syllabus' && !((observation.programDocuments ?? []).length > 0)) {
      const cited = observation.selectedOfferingFacts.filter((fact) => observation.usedFactIds.includes(fact.id));
      if (observation.selectedOfferingFacts.length === 0) {
        add(failures, 'SYLLABUS_CONTEXT_MISSING', 'El modelo no recibió hechos de temario del curso pedido.');
      } else if (cited.length === 0) {
        add(failures, 'SYLLABUS_FACT_NOT_CITED', 'Había temario autorizado, pero la propuesta no citó ninguno de sus fact_id.');
      } else {
        const responseTokens = new Set(normalized(observation.response).split(/[^a-z0-9]+/u)
          .filter((token) => token.length >= 5));
        const grounded = cited.some((fact) => {
          const tokens = [...new Set(normalized(fact.value).split(/[^a-z0-9]+/u)
            .filter((token) => token.length >= 5))];
          const overlap = tokens.filter((token) => responseTokens.has(token)).length;
          return overlap >= Math.min(2, Math.max(1, tokens.length));
        });
        if (!grounded) add(failures, 'SYLLABUS_RESPONSE_NOT_GROUNDED', 'Citó un fact_id de temario, pero la respuesta no refleja su contenido.');
      }
    }
    if (rule.type === 'requests_only_missing_call_fields') {
      const required = [...(observation.callRequirements ?? [])].sort();
      const requested = [...(observation.profileRequestedFields ?? [])].sort();
      if (required.join('|') !== requested.join('|')) {
        add(failures, 'CALL_FIELDS_MISMATCH', `Faltaban ${required.join(',')}; pidió ${requested.join(',')}.`);
      }
    }
    if (rule.type === 'payment_link_delivered' && observation.deliveredLinks.length === 0) {
      add(failures, 'PAYMENT_LINK_NOT_DELIVERED', 'No se materializó un enlace canónico en el outbound entregado.');
    }
    if (rule.type === 'access_lists_all_activated_courses') {
      const activeCourses = observation.activeCourses ?? [];
      const unmapped = activeCourses.filter((code) => !activeCourseName(observation, code));
      if (activeCourses.length === 0) {
        add(evaluatorErrors, 'ACTIVE_COURSES_EVIDENCE_MISSING', 'No hay evidencia local de cursos activados.');
      } else if (unmapped.length > 0) {
        add(evaluatorErrors, 'ACTIVE_COURSE_NAME_MAP_MISSING', `Faltan nombres canónicos para: ${unmapped.join(', ')}.`);
      } else {
        const missing = activeCourses.filter((code) => {
          const displayName = activeCourseName(observation, code);
          return displayName ? !includesText(observation.response, displayName) : false;
        });
        if (missing.length > 0) {
          add(failures, 'ACTIVE_COURSES_NOT_LISTED', `Faltan en el mensaje: ${missing.join(', ')}.`);
        }
      }
    }
    if (rule.type === 'course_bonus_preconditions') {
      const bonus = observation.courseBonus;
      const objection = observation.priceObjectionMemory;
      // AGENTS.md:154/164: price evidence (recorded objection, current or prior, or a confirmed price-only barrier)
      // or, once per conversation, a quoted purchase decline (retention, cited by the turn).
      const retentionAuthorized = turn.authority.some(reference => reference.file === 'AGENTS.md'
        && reference.contains === 'Retención');
      if (!bonus || bonus.enabled === null || bonus.maxBonusCourses === null || !objection) {
        add(evaluatorErrors, 'BONUS_PRECONDITION_EVIDENCE_MISSING',
          'Falta evidencia del capability course_bonus o de la objeción de precio previa.');
      } else {
        if (bonus.enabled !== true) {
          add(failures, 'BONUS_CONFIGURATION_DISABLED',
            `course_bonus.enabled esperado true; real ${String(bonus.enabled)}.`);
        }
        if (bonus.maxBonusCourses !== 3) {
          add(failures, 'BONUS_MAX_COURSES_CONFIG_MISMATCH',
            `max_bonus_courses esperado 3; real ${String(bonus.maxBonusCourses)}.`);
        }
        if (!retentionAuthorized && objection.sourceMessageIds.length === 0
          && observation.negotiationFacts?.priceOnlyBarrierConfirmed !== true) {
          add(failures, 'BONUS_PRIOR_PRICE_OBJECTION_MISSING',
            'No existe price_objection registrada (turno actual o previo) ni barrera de precio confirmada.');
        }
      }
    }
    if (rule.type === 'current_price_objection_recorded') {
      const recorded = currentPriceObjectionRecorded(observation);
      if (recorded === null) {
        add(evaluatorErrors, 'PRICE_OBJECTION_EVIDENCE_MISSING',
          'Falta evidencia de memoria para determinar si la objeción actual quedó registrada.');
      } else if (!recorded) {
        add(failures, 'CURRENT_PRICE_OBJECTION_NOT_RECORDED',
          'La objeción clara del turno actual no aparece entre los sourceMessageIds nuevos.');
      }
    }
    if (rule.type === 'bonus_motive_current_message' && actualAction === 'offer_course_bonus') {
      const motive = observation.proposedAction?.motive as { kind?: unknown; quote?: unknown } | undefined;
      const quote = typeof motive?.quote === 'string' ? motive.quote : '';
      if (!quote.trim() || !includesText(turn.customer, quote)) {
        add(failures, 'BONUS_MOTIVE_NOT_IN_CURRENT_MESSAGE', `motive.quote ${JSON.stringify(quote)} no está en el mensaje actual.`);
      }
      const KIND_MOVES: Record<string, readonly string[]> = { price_objection: ['price_objection'],
        better_promotion_request: ['explicit_promotion_request'], purchase_decline: ['decline_purchase'],
        promotion_rejection: ['price_objection', 'explicit_promotion_request', 'decline_purchase'] };
      const kindMoves = KIND_MOVES[String(motive?.kind)] ?? [];
      if (!kindMoves.some(move => observedMoves.includes(move))) {
        add(failures, 'BONUS_MOTIVE_MOVE_INCOHERENT', `motive.kind ${String(motive?.kind)} vs moves ${observedMoves.join('+')}.`);
      }
    }
    if (rule.type === 'package_unchanged' && previousObservation) {
      const before = previousObservation.state.promotion;
      const after = observation.state.promotion;
      const same = before.status === after.status && before.paidCourse === after.paidCourse
        && before.bonusCount === after.bonusCount && before.bonusCourses.join() === after.bonusCourses.join()
        && (before.cycleId ?? null) === (after.cycleId ?? null) && (before.offerVersion ?? null) === (after.offerVersion ?? null);
      if (!same) add(failures, 'PACKAGE_CHANGED', `Antes ${JSON.stringify(before)}; después ${JSON.stringify(after)}.`);
    }
    if (rule.type === 'no_new_bonus' && previousObservation
      && observation.state.promotion.bonusCount > previousObservation.state.promotion.bonusCount) {
      add(failures, 'NEW_BONUS_UNEXPECTED', `Antes ${previousObservation.state.promotion.bonusCount}; ahora ${observation.state.promotion.bonusCount}.`);
    }
    if (rule.type === 'program_document_sent' && !(observation.programDocuments ?? []).includes(rule.value)) {
      add(failures, 'PROGRAM_DOCUMENT_MISSING', `Falta el PDF de ${rule.value}; enviados ${(observation.programDocuments ?? []).join('|') || 'ninguno'}.`);
    }
    if (rule.type === 'program_document_exactly_once') {
      const now = (observation.programDocuments ?? []).includes(rule.value);
      const before = (previousObservation?.programDocuments ?? []).includes(rule.value);
      const imageNow = (observation.programImages ?? []).includes(rule.value);
      const imageBefore = (previousObservation?.programImages ?? []).includes(rule.value);
      if (now && before) add(failures, 'PROGRAM_DOCUMENT_DUPLICATED', `El PDF de ${rule.value} se envió dos veces.`);
      if (imageNow && imageBefore) add(failures, 'PROGRAM_IMAGE_DUPLICATED', `La imagen de ${rule.value} se envió dos veces.`);
      if (now !== imageNow) add(failures, 'PROGRAM_MATERIAL_INCOMPLETE', `PDF e imagen de ${rule.value} deben salir juntos (PDF ${now}, imagen ${imageNow}).`);
      if (!now && !before) add(failures, 'PROGRAM_DOCUMENT_MISSING', `El PDF de ${rule.value} no se envió en este turno ni en el anterior.`);
    }
    if (rule.type === 'program_image_sent' && !(observation.programImages ?? []).includes(rule.value)) {
      add(failures, 'PROGRAM_IMAGE_MISSING', `Falta la imagen de ${rule.value}; enviadas ${(observation.programImages ?? []).join('|') || 'ninguna'}.`);
    }
    if (rule.type === 'program_document_kind' && !(observation.programDocumentKinds ?? []).includes(rule.value)) {
      add(failures, 'PROGRAM_DOCUMENT_KIND_MISMATCH', `Se esperaba un PDF ${rule.value}; enviados ${(observation.programDocumentKinds ?? []).join('|') || 'ninguno'}.`);
    }
    if (rule.type === 'no_program_document' && ((observation.programDocuments ?? []).length > 0 || (observation.programImages ?? []).length > 0)) {
      add(failures, 'PROGRAM_DOCUMENT_UNEXPECTED', `Se envió ${(observation.programDocuments ?? []).join('|')}.`);
    }
    if (rule.type === 'no_link_delivered' && observation.deliveredLinks.length > 0) {
      add(failures, 'LINK_UNEXPECTED', 'Se entregó un link de pago sin plan elegido.');
    }
    if (rule.type === 'link_plan_in' && observation.proposedAction?.type === 'send_payment_link'
      && !rule.values.includes(String(observation.proposedAction.payment_plan))) {
      add(failures, 'LINK_PLAN_MISMATCH', `Plan ${String(observation.proposedAction.payment_plan)}; esperado ${rule.values.join('|')}.`);
    }
    if (rule.type === 'no_prefab_cta' && /Con cuál plan te gustaría avanzar\?|Así te cuento todo sobre ese|Hubo un problema|Con cuál quieres avanzar\?|Cuál prefieres\?/u.test(observation.response)) {
      add(failures, 'PREFAB_CTA_PRESENT', 'La respuesta contiene un CTA prefabricado retirado.');
    }
    if (rule.type === 'selected_course_equals'
      && observation.state.selectedCourse !== rule.value) {
      add(failures, 'SELECTED_COURSE_MISMATCH', `Esperado ${rule.value}; real ${observation.state.selectedCourse}.`);
    }
  }
  return { failures, evaluatorErrors };
}

export type FailureLayerV1 = 'prompt' | 'brain' | 'validador' | 'estado'
  | 'contexto' | 'bonificación' | 'entorno';

export interface ValidatorRejectionV1 {
  readonly code: string;
  readonly subject: string | null;
}

export interface FailureAttributionV1 {
  readonly layer: FailureLayerV1;
  readonly validatorRejections: readonly ValidatorRejectionV1[];
}

const TERMINAL_VALIDATOR_CODES = [
  'COMMERCIAL_TRUTH_VIOLATION',
  'ACTION_NOT_AUTHORIZED',
] as const;

function collectValidatorRejections(
  value: unknown,
  output: ValidatorRejectionV1[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectValidatorRejections(item, output);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record.code === 'string') {
    output.push({
      code: record.code,
      subject: typeof record.subject === 'string' ? record.subject : null,
    });
  }
  for (const child of Object.values(record)) collectValidatorRejections(child, output);
}

export function validatorRejectionsV1(
  observation: GoldenTurnObservationV1,
): readonly ValidatorRejectionV1[] {
  const collected: ValidatorRejectionV1[] = [];
  collectValidatorRejections(observation.backendRejections, collected);
  const terminal = [
    observation.workflow?.errorCode,
    observation.workflow?.finalBackendDecisionError,
  ].filter((value): value is string => typeof value === 'string');
  for (const text of terminal) {
    for (const code of TERMINAL_VALIDATOR_CODES) {
      if (text.includes(code)) collected.push({ code, subject: null });
    }
  }
  const seen = new Set<string>();
  return collected.filter((item) => {
    const key = `${item.code}\u0000${item.subject ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function inferFailureAttribution(
  turn: GoldenTurnV1,
  observation: GoldenTurnObservationV1,
  failureCodes: readonly string[],
): FailureAttributionV1 {
  const validatorRejections = validatorRejectionsV1(observation);
  if (observation.backendRejections.length > 0 || validatorRejections.length > 0) {
    return { layer: 'validador', validatorRejections };
  }
  const terminalError = `${observation.workflow?.errorCode ?? ''} ${observation.workflow?.finalBackendDecisionError ?? ''}`;
  if (/VOICE_PROVIDER_INVALID|CONFIGURATION_UNAVAILABLE|ECONNREFUSED|GOLDEN_/u.test(terminalError)) {
    return { layer: 'entorno', validatorRejections };
  }
  if (turn.hard?.some((rule) => rule.type === 'response_uses_authorized_syllabus')) {
    return { layer: observation.selectedOfferingFacts.length === 0 ? 'contexto' : 'brain', validatorRejections };
  }
  if (failureCodes.some((code) => code.startsWith('PROMOTION_') || code.startsWith('BONUS_'))
    || failureCodes.includes('TURN_PRECONDITION_NOT_REACHED')
    || turn.expected.action.includes('offer_course_bonus') || turn.expected.action.includes('accept_promotion')) {
    return { layer: 'bonificación', validatorRejections };
  }
  if (failureCodes.some((code) => code.startsWith('STATE_')
    || code === 'CHECKOUT_STATE_MISMATCH' || code === 'CLOSURE_STATE_MISMATCH')) {
    return { layer: 'estado', validatorRejections };
  }
  if (failureCodes.some((code) => code === 'MOVE_MISMATCH' || code === 'ACTION_MISMATCH'
    || code === 'SILENT_TURN')) return { layer: 'brain', validatorRejections };
  return { layer: 'prompt', validatorRejections };
}

export function inferFailureLayer(
  turn: GoldenTurnV1,
  observation: GoldenTurnObservationV1,
  failureCodes: readonly string[],
): FailureLayerV1 {
  return inferFailureAttribution(turn, observation, failureCodes).layer;
}

export interface SemanticTurnVerdictV1 {
  readonly turn_id: string;
  readonly approved: boolean | null;
  readonly failures: readonly {
    readonly code: 'SEMANTIC_MUST_FAILED' | 'SEMANTIC_MUST_NOT_FAILED';
    readonly requirement_index: number;
    readonly authority_reference: string;
    readonly explanation: string;
  }[];
  readonly evaluation_error: string | null;
  readonly format_recovery?: {
    readonly kind: 'trailing_closing_brace_removed';
    readonly raw_response: string;
  };
}

function parseJudgeEnvelope(content: string): {
  readonly decoded: { verdict?: RawSemanticTurnVerdictV1 };
  readonly formatRecovery?: SemanticTurnVerdictV1['format_recovery'];
} {
  try {
    return { decoded: JSON.parse(content) as { verdict?: RawSemanticTurnVerdictV1 } };
  } catch (originalError) {
    // Recorded 06/bonus_2 responses contain one complete object plus one final
    // redundant brace. Recover only that syntax defect; never repair a verdict.
    const trimmed = content.trimEnd();
    if (!trimmed.endsWith('}')) throw originalError;
    try {
      const decoded: unknown = JSON.parse(trimmed.slice(0, -1));
      if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) throw originalError;
      return {
        decoded: decoded as { verdict?: RawSemanticTurnVerdictV1 },
        formatRecovery: { kind: 'trailing_closing_brace_removed', raw_response: content },
      };
    } catch {
      throw originalError;
    }
  }
}

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === 'string') return record.output_text;
  if (!Array.isArray(record.output)) return null;
  const fragments: string[] = [];
  for (const output of record.output) {
    if (!output || typeof output !== 'object' || Array.isArray(output)) continue;
    const content = (output as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const candidate = item as Record<string, unknown>;
      if (candidate.type === 'output_text' && typeof candidate.text === 'string') fragments.push(candidate.text);
    }
  }
  return fragments.length > 0 ? fragments.join('') : null;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const authorityFileCache = new Map<string, string[]>();

async function authorityFileLines(file: string): Promise<string[]> {
  let lines = authorityFileCache.get(file);
  if (!lines) {
    lines = (await readFile(path.join(repoRoot, file), 'utf8')).split(/\r?\n/u);
    authorityFileCache.set(file, lines);
  }
  return lines;
}

export async function canonicalAuthorityCitations(
  turn: GoldenTurnV1,
): Promise<readonly string[]> {
  const citations: string[] = [];
  for (const reference of turn.authority) {
    const lines = await authorityFileLines(reference.file);
    for (let line = reference.start; line <= reference.end; line += 1) {
      const text = lines[line - 1];
      if (typeof text === 'string' && text.trim()) {
        citations.push(`${reference.file}:${line} | ${text}`);
      }
    }
  }
  return [...new Set(citations)];
}

export async function primaryAuthorityCitation(turn: GoldenTurnV1): Promise<string | null> {
  for (const reference of turn.authority) {
    const lines = await authorityFileLines(reference.file);
    for (let line = reference.start; line <= reference.end; line += 1) {
      const text = lines[line - 1];
      if (typeof text === 'string' && text.includes(reference.contains)) {
        return `${reference.file}:${line} | ${text}`;
      }
    }
  }
  return (await canonicalAuthorityCitations(turn))[0] ?? null;
}

interface RawSemanticTurnVerdictV1 {
  readonly turn_id: string;
  readonly approved: boolean;
  readonly failures: readonly {
    readonly code: 'SEMANTIC_MUST_FAILED' | 'SEMANTIC_MUST_NOT_FAILED';
    readonly requirement_id: string;
    readonly authority_line_index: number;
    readonly evidence_source: 'response' | 'backend_action' | 'delivery_result'
      | 'state' | 'preconditions' | 'delivered_history' | 'negotiation_ledger'
      | 'previous_delivery' | 'program_delivery_history' | 'promotion_delta'
      | 'early_call_offer_evidence';
    readonly observed_evidence: string;
    readonly explanation: string;
  }[];
}

function courseMenuIsObserved(observation: GoldenTurnObservationV1): boolean {
  const response = normalized(observation.response);
  const namedCourses = new Set(observation.availableOfferings
    .filter((offering) => includesText(response, offering.displayName))
    .map((offering) => offering.code));
  if (namedCourses.size >= 2) return true;
  return /\b(cursos?|programas?)\b.{0,120}\b(opciones?|elegir|entre|o)\b/u.test(response);
}

function completeContactSummaryIsObserved(
  turn: GoldenTurnV1,
  observation: GoldenTurnObservationV1,
): boolean {
  const pieces = turn.customer.split(',').map((piece) => piece.trim().replace(/[.]$/u, ''));
  return pieces.length >= 3 && pieces.every((piece) => piece.length > 0 && includesText(observation.response, piece));
}

function contactDataRequestIsObserved(observation: GoldenTurnObservationV1): boolean {
  return /\b(nombre|apellido|correo|email|e-mail|tel[eé]fono|celular|whatsapp)\b/iu
    .test(observation.response);
}

function requestedCallAvailabilityIsObserved(observation: GoldenTurnObservationV1): boolean {
  const text = normalized(observation.response);
  return observation.move === 'request_call'
    && actionType(observation) === 'none'
    && /\b(ahora|en este momento)\b/u.test(text)
    && /[?]/u.test(observation.response);
}

function onlyCanonicalBackendPaymentLinksAreObserved(
  observation: GoldenTurnObservationV1,
): boolean {
  if (actionType(observation) !== 'send_payment_link'
    && observation.backendAction !== 'send_payment_link') return false;
  const delivered = new Set(observation.deliveredLinks);
  const visibleUrls = observation.response.match(/https?:\/\/[^\s]+/gu)
    ?.map((url) => url.replace(/[),.;\]]+$/u, '')) ?? [];
  return visibleUrls.length > 0 && visibleUrls.every((url) => delivered.has(url));
}

function semanticFailureContradictedByObjectiveEvidence(input: {
  readonly failure: RawSemanticTurnVerdictV1['failures'][number];
  readonly requirement: string;
  readonly turn: GoldenTurnV1;
  readonly observation: GoldenTurnObservationV1;
  readonly previousObservation: GoldenTurnObservationV1 | null;
  readonly priorObservations: readonly GoldenTurnObservationV1[];
}): boolean {
  if (input.failure.code === 'SEMANTIC_MUST_NOT_FAILED'
    && input.requirement === 'No abrir un menú de cursos ni ofrecer varias opciones.'
    && !courseMenuIsObserved(input.observation)) return true;
  if (input.failure.code === 'SEMANTIC_MUST_FAILED'
    && input.requirement.includes('salvo que ya se haya enviado')) {
    const priorDocuments = new Set(input.priorObservations.flatMap(
      (observation) => observation.programDocuments ?? [],
    ));
    const priorImages = new Set(input.priorObservations.flatMap(
      (observation) => observation.programImages ?? [],
    ));
    if ([...priorDocuments].some((code) => priorImages.has(code))) return true;
  }
  if (input.failure.code === 'SEMANTIC_MUST_FAILED'
    && input.requirement === 'Responder con una de las historias reales autorizadas, sin convertirla en testimonio de Real Estate.'
    && /\bFelipe\s+Serrano\b/iu.test(input.observation.response)
    && /\b(?:paneles\s+solares|aires\s+acondicionados|equipo\s+trabajando)\b/iu.test(input.observation.response)) return true;
  if (input.failure.code === 'SEMANTIC_MUST_FAILED'
    && input.requirement.startsWith('Responder con la historia real autorizada de Felipe')
    && /\bFelipe\s+Serrano\b/iu.test(input.observation.response)
    && /\b(?:paneles\s+solares|aires\s+acondicionados|equipo\s+trabajando|cre[oó]\s+su\s+empresa)\b/iu.test(input.observation.response)) return true;
  if (input.failure.code === 'SEMANTIC_MUST_FAILED'
    && input.requirement === 'Mostrar un resumen que incluya el nombre y apellido recibidos, el correo y el teléfono.'
    && completeContactSummaryIsObserved(input.turn, input.observation)) return true;
  if (input.failure.code === 'SEMANTIC_MUST_FAILED'
    && normalized(input.requirement).includes('registrar la objecion')
    && currentPriceObjectionRecorded(input.observation) === true) return true;
  if (input.failure.code === 'SEMANTIC_MUST_FAILED'
    && input.requirement.startsWith('Si se añade un bonificado,')
    && input.observation.backendAction !== 'offer_course_bonus') return true;
  if (input.failure.code === 'SEMANTIC_MUST_FAILED'
    && input.requirement.startsWith('Aplicar la autoridad vigente')
    && input.observation.ruleOutcomes?.rule_a === 'not_applicable'
    && input.observation.courseBonus?.mayOfferBonus === false
    && input.observation.negotiationFacts?.ladder?.eligible === false
    && input.observation.negotiationFacts.ladder.instant_trigger !== true
    && input.observation.negotiationFacts.priceOnlyBarrierConfirmed !== true) return true;
  if (input.failure.code === 'SEMANTIC_MUST_FAILED'
    && input.requirement === 'Usar request_call_now después de la confirmación vigente.'
    && input.observation.backendAction === 'request_call_now'
    && input.observation.workflow?.commitSucceeded === true) return true;
  if (input.failure.code === 'SEMANTIC_MUST_NOT_FAILED'
    && input.requirement === 'No pedir nombre, apellido, correo o teléfono para inscripción o llamada todavía.'
    && !contactDataRequestIsObserved(input.observation)) return true;
  if (input.failure.code === 'SEMANTIC_MUST_NOT_FAILED'
    && input.requirement === 'No registrar la recomendación como elección del cliente.'
    && input.observation.state.selectedCourse === null) return true;
  if (input.failure.code === 'SEMANTIC_MUST_NOT_FAILED'
    && input.requirement === 'No elegir un curso por “Info”.'
    && input.observation.state.selectedCourse === null) return true;
  if (input.failure.code === 'SEMANTIC_MUST_NOT_FAILED'
    && input.requirement === 'No pedir nombre, apellido, correo o teléfono.'
    && !contactDataRequestIsObserved(input.observation)) return true;
  if (input.failure.code === 'SEMANTIC_MUST_NOT_FAILED'
    && input.requirement.startsWith('No volver a pedirle que elija entre trabajar con una inmobiliaria o invertir')
    && !asksWorkVsInvestmentChoice(input.observation.response)) return true;
  if (input.failure.code === 'SEMANTIC_MUST_NOT_FAILED'
    && normalized(input.requirement).includes('no volver a preguntar si quiere trabajar con una inmobiliaria o invertir')
    && !asksWorkVsInvestmentChoice(input.observation.response)) return true;
  if (input.failure.code === 'SEMANTIC_MUST_NOT_FAILED'
    && input.requirement === 'No hacer varias preguntas juntas.'
    && (input.observation.response.match(/[?]/gu) ?? []).length <= 1) return true;
  if (input.failure.code === 'SEMANTIC_MUST_NOT_FAILED'
    && input.requirement.includes('no escribir una URL inventada')
    && onlyCanonicalBackendPaymentLinksAreObserved(input.observation)) return true;
  if (input.failure.code === 'SEMANTIC_MUST_FAILED'
    && input.requirement === 'Conservar move=request_call, usar proposed_action=none y preguntar una sola vez si puede atender ahora; puede ofrecer seguir más tarde si ahora no puede.'
    && requestedCallAvailabilityIsObserved(input.observation)) return true;
  if (input.failure.code === 'SEMANTIC_MUST_FAILED'
    && input.requirement === 'Responder desde el vínculo y celebrar el próximo paso con el curso concreto.'
    && input.previousObservation?.workflow?.status === 'post_sale_notification_sent'
    && input.previousObservation.activeCourses?.length
    && input.observation.state.selectedCourse
    && includesText(input.observation.response,
      offeringName(input.previousObservation, input.observation.state.selectedCourse))) return true;
  return false;
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return `GOLDEN_JUDGE_ERROR:${String(error)}`;
  return error.message.startsWith('GOLDEN_JUDGE_')
    ? error.message : `GOLDEN_JUDGE_ERROR:${error.message}`;
}

/** Exact ledger comparison. It does not infer new offers from sales prose. */
export function goldenPromotionDeltaV1(current: GoldenTurnObservationV1, previous: GoldenTurnObservationV1 | null) {
  const prior = previous?.state.promotion;
  const now = current.state.promotion;
  const samePaidCourse = prior?.paidCourse === now.paidCourse;
  const priorCodes = samePaidCourse ? prior?.bonusCourses ?? [] : [];
  return {
    previous_snapshot_available: previous !== null,
    previous_paid_course: prior?.paidCourse ?? null,
    current_paid_course: now.paidCourse,
    same_paid_course: samePaidCourse,
    prior_bonus_codes: priorCodes,
    current_bonus_codes: now.bonusCourses,
    added_bonus_codes: previous ? now.bonusCourses.filter(code => !priorCodes.includes(code)) : null,
    removed_bonus_codes: previous ? priorCodes.filter(code => !now.bonusCourses.includes(code)) : null,
    backend_action: current.backendAction,
    new_bonus_effect_executed: current.backendAction === 'offer_course_bonus',
  };
}

async function judgeTurnSemantically(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly turn: GoldenTurnV1;
  readonly observation: GoldenTurnObservationV1;
  readonly previousObservation: GoldenTurnObservationV1 | null;
  readonly priorObservations: readonly GoldenTurnObservationV1[];
  readonly negotiationHistory?: readonly ReturnType<typeof negotiationEvidenceV1>[];
}): Promise<SemanticTurnVerdictV1> {
  if (!input.observation.response.trim()) {
    return { turn_id: input.turn.id, approved: true, failures: [], evaluation_error: null };
  }
  const citations = await canonicalAuthorityCitations(input.turn);
  if (citations.length === 0) {
    return { turn_id: input.turn.id, approved: null, failures: [],
      evaluation_error: 'GOLDEN_JUDGE_AUTHORITY_LINES_EMPTY' };
  }
  const preconditions = {
    may_offer_call: input.observation.mayOfferCall ?? null,
    course_bonus: input.observation.courseBonus ?? null,
    price_objection_memory: input.observation.priceObjectionMemory ?? null,
    negotiation_ladder_before_turn: input.observation.negotiationFacts?.ladder ?? null,
    rule_bonus_before_turn: input.observation.ruleBonusBeforeTurn ?? null,
    rule_outcomes: input.observation.ruleOutcomes ?? null,
  };
  // Only final receipt fields are normative. Attempt-wide rejections and the
  // last model proposal remain in the audit, including after a useful repair.
  const deliveryResult = input.observation.workflow ? {
    commitSucceeded: input.observation.workflow.commitSucceeded,
    status: input.observation.workflow.status,
    errorCode: input.observation.workflow.errorCode,
    finalBackendDecisionError: input.observation.workflow.finalBackendDecisionError,
  } : null;
  const deliveredHistory = input.negotiationHistory?.map(turn => ({
    turnId: turn.turnId, customer: turn.customer, response: turn.response,
    maxBonusChallenge: turn.maxBonusChallenge, currentTurnId: turn.currentTurnId,
    priorPriceSourceIds: turn.priorPriceSourceIds, ladder: turn.ladder,
    action: turn.action, selectedCourse: turn.selectedCourse, promotion: turn.promotion,
    offerings: turn.offerings, authorizedFacts: turn.authorizedFacts,
    usedFactIds: turn.usedFactIds, selectedOfferingFacts: turn.selectedOfferingFacts,
  }));
  const negotiationLedger = deliveredHistory?.map(t => ({
    turn_id: t.turnId, ladder: t.ladder, action: t.action, promotion: t.promotion,
  }));
  const previousDelivery = input.previousObservation ? {
    conversation_id: input.previousObservation.conversationId ?? null,
    response: input.previousObservation.response,
    call_offer: input.previousObservation.callOffer ?? null,
    recorded_call_offer_count: input.previousObservation.recordedCallOfferCount ?? null,
    backend_action: input.previousObservation.backendAction,
    state: input.previousObservation.state,
    delivery_result: input.previousObservation.workflow ?? null,
  } : null;
  const programDeliveryHistory = input.priorObservations.map((observation) => ({
    program_documents: observation.programDocuments ?? [],
    program_images: observation.programImages ?? [],
  }));
  const promotionDelta = goldenPromotionDeltaV1(input.observation, input.previousObservation);
  const earlyCallEvidence = input.observation.earlyCallOfferEvidence ?? [];
  const payload = {
    evaluator_version: 'studyx-golden-semantic-delivered-v5',
    turn_id: input.turn.id,
    authority_scope: { bonus_tone: {
      authority_line: 129, applies_to: 'bonus_or_personal_exception', ordinary_link_delivery_is_bonus: false,
      // AGENTS.md :120 (owner value register) lifts the «te regalo» ban of :129 for these wordings only.
      allowed_value_register: ['de regalo', 'te regalo', 'dos/tres cursos al precio de uno'],
      still_forbidden: ['te lo dejo', 'excepción personal', 'fórmulas defensivas', 'urgencia inventada'],
    } },
    ...(deliveredHistory ? { evaluation_mode:'negotiation_invariants', delivered_history:deliveredHistory,
      negotiation_ledger:negotiationLedger, semantic_scope:'Judge delivered history and the current reply; stage names and move labels do not impose a fixed turn. Earlier completed steps count. Explicit or implicit unauthorized bonus offers fail, including questions and hypotheses. In each ledger entry ladder is the evidence before that turn; promotion and action are its committed outcome. A call offered in that same turn never becomes prior authorization for its bonus.' } : {}),
    customer: input.turn.customer,
    previous_delivery: previousDelivery,
    program_delivery_history: programDeliveryHistory,
    promotion_delta: promotionDelta,
    early_call_offer_evidence: earlyCallEvidence,
    requirements: [
      ...input.turn.must.map((text, index) => ({ id: `must:${index}`, kind: 'must', text })),
      ...input.turn.mustNot.map((text, index) => ({ id: `must_not:${index}`, kind: 'must_not', text })),
    ],
    authority_lines: citations.map((text, index) => ({ index, text })),
    actual: {
      response: input.observation.response,
      backend_action: input.observation.backendAction,
      delivery_result: deliveryResult,
      state: input.observation.state,
      preconditions,
      authorized_facts: input.observation.authorizedFacts,
      used_fact_ids: input.observation.usedFactIds,
      delivered_links: input.observation.deliveredLinks,
      capabilities: { may_offer_call: input.observation.mayOfferCall ?? null },
    },
  };
  const requirementIds = [
    ...input.turn.must.map((_, index) => `must:${index}`),
    ...input.turn.mustNot.map((_, index) => `must_not:${index}`),
  ];
  const evidenceSources = {
    previous_delivery: JSON.stringify(previousDelivery),
    program_delivery_history: JSON.stringify(programDeliveryHistory),
    promotion_delta: JSON.stringify(promotionDelta),
    early_call_offer_evidence: JSON.stringify(earlyCallEvidence),
    ...(deliveredHistory ? { delivered_history:JSON.stringify(deliveredHistory),
      negotiation_ledger:JSON.stringify(negotiationLedger) } : {}),
    response: input.observation.response,
    backend_action: JSON.stringify(input.observation.backendAction),
    delivery_result: JSON.stringify(deliveryResult),
    state: JSON.stringify(input.observation.state),
    preconditions: JSON.stringify(preconditions),
  } as const;
  let lastError = 'GOLDEN_JUDGE_INVALID_RESPONSE';
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch('https://api.deepseek.com/responses', {
        method: 'POST',
        headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: input.model,
          instructions: 'Sos un juez estricto de comportamiento conversacional. Evalúa únicamente la respuesta entregada, la acción efectiva del backend, el estado y las precondiciones suministradas. actual.delivery_result es el resultado final: un intento rechazado que luego se reparó no invalida la entrega final. Los borradores, moves y acciones propuestas no son efectos ni evidencia de entrega. previous_delivery conserva el recibo, invitación y estado entregados en el turno anterior; program_delivery_history conserva todos los PDF e imágenes de programa entregados antes del turno actual, por lo que un material ya entregado no debe exigirse otra vez; early_call_offer_evidence conserva invitaciones autorizadas, persistidas y entregadas de la segunda/tercera respuesta en el mismo diálogo. Una invitación ya realizada no se exige de nuevo. promotion_delta compara identidades exactas del paquete anterior y actual: recordar un miembro ya vigente no añade un curso ni constituye por sí solo una nueva promesa. Una promesa nueva explícita o implícita sin efecto sigue siendo un fallo, incluso si el ledger no cambió; comparar lo prometido con los miembros ya vigentes. preconditions.rule_bonus_before_turn identifica únicamente cuál sería el próximo curso si una oferta resulta exigible; jamás demuestra por sí solo que la oferta sea exigible en este turno. Para exigirla deben acreditarse el disparador en negotiation_ladder_before_turn o rule_outcomes.rule_a=model|rewrite|fixed y el efecto final. rule_outcomes.rule_a=not_applicable, mayOfferBonus=false y ladder.eligible=false prueban que no correspondía bonificar, salvo evidencia estructural contradictoria como instant_trigger=true o priceOnlyBarrierConfirmed=true. No premies intención ni inventes hechos. Juzga cada requisito de forma independiente: nunca traslades el incumplimiento de un requisito a otro. Un requisito must falla si no se observa. Un must_not falla ÚNICAMENTE cuando la conducta prohibida sí ocurre; la ausencia de respuesta o de evidencia nunca viola un must_not. Una obligación condicional que comienza con “Si se añade un bonificado” no falla cuando no se añadió ninguno; la exigibilidad de añadirlo se juzga en el requisito de la Regla A. La prohibición de expresiones de la línea 129 está en la sección de bonificación y se interpreta por el objeto y el sentido: ofrecer un bonificado o una excepción personal. Compartir o dejar un enlace de inscripción no constituye por sí mismo regalar un curso. Esto no exime una bonificación explícita o implícita sin efecto, aunque la misma respuesta también comparta un enlace. Después de recomendar exactamente un curso, preguntar por equipo o por una preferencia entre contenidos de ese mismo curso (por ejemplo, cámara o edición) no equivale a abrir un menú de cursos. Un nombre completo como "Ana Pérez" satisface nombre y apellido; no se exige mostrarlos en campos separados. En preconditions.price_objection_memory, present=true prueba que la objeción del turno actual o de la conversación quedó registrada; priorSourceMessageIds prueba exclusivamente que ya existía en un turno anterior. preconditions.negotiation_ladder_before_turn y cada ladder del historial describen hechos previos a ese turno; action y promotion describen su resultado. Una llamada ofrecida en el turno actual no autoriza retroactivamente una bonificación del mismo turno; la Regla A del dueño tampoco exige una llamada previa, y puede coincidir con la Regla B cuando ambas tienen sus propios disparadores autorizados. may_offer_call gobierna una oferta proactiva, no invalida una llamada que el cliente pidió y confirmó; backend_action=request_call_now con actual.delivery_result.commitSucceeded=true prueba que el despacho fue autorizado. Si backend_action=send_payment_link y una URL visible coincide exactamente con actual.delivered_links, esa URL fue añadida por el backend y no fue escrita ni inventada por el agente. Para cada fallo elegí el requirement_id exacto, el authority_line_index y evidence_source. En observed_evidence copia literalmente el fragmento de esa fuente que prueba el fallo; para un must ausente puede quedar vacío, pero para un must_not debe ser un fragmento no vacío presente en la fuente. El runner expande la línea de autoridad; no redactes ni alteres citas. Autoridad vigente (AGENTS.md, «Venta interpretada por el modelo», 2026-11-03): el backend sólo valida PERMISOS; ninguna bonificación, llamada, pregunta de precio ni cierre es exigible por regla del backend, y las menciones de Reglas A/B/C/D/E o de «exigible» en los requisitos antiguos no obligan. Juzga lo que el requisito del turno pide expresamente y los hechos y efectos reales; no exijas una oferta o llamada que el requisito no pida. No juzgues reglas no incluidas.',
          input: JSON.stringify(payload),
          reasoning: { effort: 'none' }, temperature: 0, stream: false, max_output_tokens: 1200,
          text: { format: { type: 'json_schema', name: 'studyx_golden_semantic_turn_judge_v3', schema: {
            type: 'object', additionalProperties: false, required: ['verdict'], properties: {
              verdict: { type: 'object', additionalProperties: false,
                required: ['turn_id', 'approved', 'failures'], properties: {
                  turn_id: { type: 'string', enum: [input.turn.id] },
                  approved: { type: 'boolean' },
                  failures: { type: 'array', items: { type: 'object', additionalProperties: false,
                    required: ['code', 'requirement_id', 'authority_line_index', 'evidence_source', 'observed_evidence', 'explanation'], properties: {
                      code: { type: 'string', enum: ['SEMANTIC_MUST_FAILED', 'SEMANTIC_MUST_NOT_FAILED'] },
                      requirement_id: { type: 'string', enum: requirementIds },
                      authority_line_index: { type: 'integer', minimum: 0, maximum: citations.length - 1 },
                      evidence_source: { type: 'string', enum: Object.keys(evidenceSources) },
                      observed_evidence: { type: 'string', maxLength: 800 },
                      explanation: { type: 'string', minLength: 1, maxLength: 800 },
                    } },
                  },
                },
              },
            },
          } } },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`GOLDEN_JUDGE_HTTP_${response.status}`);
      const content = extractOutputText(await response.json());
      if (!content) throw new Error('GOLDEN_JUDGE_EMPTY_RESPONSE');
      const { decoded, formatRecovery } = parseJudgeEnvelope(content);
      const verdict = decoded.verdict;
      if (!verdict || verdict.turn_id !== input.turn.id || !Array.isArray(verdict.failures)) {
        throw new Error('GOLDEN_JUDGE_INVALID_RESPONSE');
      }
      if (verdict.approved !== (verdict.failures.length === 0)) {
        throw new Error('GOLDEN_JUDGE_VERDICT_INCOHERENT');
      }
      const failures: SemanticTurnVerdictV1['failures'][number][] = [];
      for (const failure of verdict.failures as RawSemanticTurnVerdictV1['failures']) {
        // The request owns a requirement's kind. A redundant model code cannot
        // turn a known must_not ID into must or invalidate a grounded verdict.
        const referencedRequirement = payload.requirements.find(item => item.id === failure.requirement_id);
        if (!referencedRequirement
          || !['SEMANTIC_MUST_FAILED', 'SEMANTIC_MUST_NOT_FAILED'].includes(failure.code)) {
          throw new Error('GOLDEN_JUDGE_FAILURE_REFERENCE_INVALID');
        }
        const normalizedFailure = { ...failure, code: referencedRequirement.kind === 'must'
          ? 'SEMANTIC_MUST_FAILED' as const : 'SEMANTIC_MUST_NOT_FAILED' as const };
        const requirementIndex = Number(referencedRequirement.id.slice(referencedRequirement.kind.length + 1));
        const requirements = referencedRequirement.kind === 'must' ? input.turn.must : input.turn.mustNot;
        if (!Number.isInteger(requirementIndex)
          || requirementIndex < 0 || requirementIndex >= requirements.length
          || !Number.isInteger(failure.authority_line_index)
          || failure.authority_line_index < 0 || failure.authority_line_index >= citations.length) {
          throw new Error('GOLDEN_JUDGE_FAILURE_REFERENCE_INVALID');
        }
        const evidence = evidenceSources[failure.evidence_source];
        if (typeof evidence !== 'string'
          || typeof failure.observed_evidence !== 'string'
          || (failure.observed_evidence.length > 0 && !evidence.includes(failure.observed_evidence))
          || (normalizedFailure.code === 'SEMANTIC_MUST_NOT_FAILED'
            && !failure.observed_evidence)) {
          throw new Error('GOLDEN_JUDGE_FAILURE_EVIDENCE_INVALID');
        }
        const requirement = requirements[requirementIndex]!;
        if (semanticFailureContradictedByObjectiveEvidence({
          failure: normalizedFailure, requirement, turn: input.turn, observation: input.observation,
          previousObservation: input.previousObservation, priorObservations: input.priorObservations,
        })) continue;
        failures.push({
          code: normalizedFailure.code,
          requirement_index: requirementIndex,
          authority_reference: citations[failure.authority_line_index]!,
          explanation: failure.explanation,
        });
      }
      return { turn_id: verdict.turn_id, approved: failures.length === 0, failures, evaluation_error: null,
        ...(formatRecovery ? { format_recovery: formatRecovery } : {}) };
    } catch (error) {
      lastError = errorCode(error);
    }
  }
  return { turn_id: input.turn.id, approved: null, failures: [], evaluation_error: lastError };
}

export async function judgeCaseSemantically(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly scenario: GoldenCaseV1;
  readonly observations: readonly GoldenTurnObservationV1[];
}): Promise<readonly SemanticTurnVerdictV1[]> {
  const verdicts: SemanticTurnVerdictV1[] = [];
  for (const [index, turn] of input.scenario.turns.entries()) {
    const observation = input.observations[index];
    if (!observation) {
      verdicts.push({ turn_id: turn.id, approved: null, failures: [],
        evaluation_error: 'GOLDEN_JUDGE_OBSERVATION_MISSING' });
      continue;
    }
    if (input.scenario.evaluationMode!=='negotiation_invariants' && !turnHasRequiredPriorPromotion(turn, input.observations[index - 1] ?? null)) {
      verdicts.push({ turn_id: turn.id, approved: true, failures: [], evaluation_error: null });
      continue;
    }
    verdicts.push(await judgeTurnSemantically({
      apiKey: input.apiKey, model: input.model, turn:input.scenario.evaluationMode==='negotiation_invariants'?negotiationSemanticTurnV1(turn,index===input.scenario.turns.length-1,observation.negotiationFacts?.ladder?.required_price_objection_count===2):turn, observation,
      ...(input.scenario.evaluationMode==='negotiation_invariants'?{negotiationHistory:input.scenario.turns.slice(0,index+1).map((t,i)=>negotiationEvidenceV1(t,input.observations[i]!))}:{}),
      previousObservation: input.observations[index - 1] ?? null,
      priorObservations: input.observations.slice(0, index),
    }));
  }
  return verdicts;
}
