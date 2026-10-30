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

export interface GoldenTurnObservationV1 {
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
    };
  };
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

export function evaluateHardRules(
  turn: GoldenTurnV1,
  observation: GoldenTurnObservationV1,
  previousObservation: GoldenTurnObservationV1 | null = null,
): HardJudgeResultV1 {
  const failures: GoldenFailureV1[] = [];
  const evaluatorErrors: GoldenFailureV1[] = [];
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
    if (rule.type === 'response_uses_authorized_syllabus') {
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
        if (objection.priorSourceMessageIds.length === 0) {
          add(failures, 'BONUS_PRIOR_PRICE_OBJECTION_MISSING',
            'No existe price_objection registrada en un turno anterior.');
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
    readonly evidence_source: 'response' | 'move' | 'proposed_action' | 'backend_action'
      | 'state' | 'backend_rejections' | 'preconditions';
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

function semanticFailureContradictedByObjectiveEvidence(input: {
  readonly failure: RawSemanticTurnVerdictV1['failures'][number];
  readonly requirement: string;
  readonly turn: GoldenTurnV1;
  readonly observation: GoldenTurnObservationV1;
  readonly previousObservation: GoldenTurnObservationV1 | null;
}): boolean {
  if (input.failure.code === 'SEMANTIC_MUST_NOT_FAILED'
    && input.requirement === 'No abrir un menú de cursos ni ofrecer varias opciones.'
    && !courseMenuIsObserved(input.observation)) return true;
  if (input.failure.code === 'SEMANTIC_MUST_FAILED'
    && input.requirement === 'Mostrar un resumen que incluya el nombre y apellido recibidos, el correo y el teléfono.'
    && completeContactSummaryIsObserved(input.turn, input.observation)) return true;
  if (input.failure.code === 'SEMANTIC_MUST_FAILED'
    && input.requirement === 'Registrar la objeción de precio.'
    && currentPriceObjectionRecorded(input.observation) === true) return true;
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
    && input.requirement === 'No hacer varias preguntas juntas.'
    && (input.observation.response.match(/[?]/gu) ?? []).length <= 1) return true;
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

async function judgeTurnSemantically(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly turn: GoldenTurnV1;
  readonly observation: GoldenTurnObservationV1;
  readonly previousObservation: GoldenTurnObservationV1 | null;
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
    workflow: input.observation.workflow ?? null,
  };
  const payload = {
    turn_id: input.turn.id,
    customer: input.turn.customer,
    requirements: [
      ...input.turn.must.map((text, index) => ({ id: `must:${index}`, kind: 'must', text })),
      ...input.turn.mustNot.map((text, index) => ({ id: `must_not:${index}`, kind: 'must_not', text })),
    ],
    authority_lines: citations.map((text, index) => ({ index, text })),
    actual: {
      response: input.observation.response,
      move: input.observation.move,
      proposed_action: input.observation.proposedAction,
      backend_action: input.observation.backendAction,
      backend_rejections: input.observation.backendRejections,
      state: input.observation.state,
      preconditions,
      authorized_facts: input.observation.authorizedFacts,
      used_fact_ids: input.observation.usedFactIds,
      capabilities: { may_offer_call: input.observation.mayOfferCall ?? null },
    },
  };
  const requirementIds = [
    ...input.turn.must.map((_, index) => `must:${index}`),
    ...input.turn.mustNot.map((_, index) => `must_not:${index}`),
  ];
  const evidenceSources = {
    response: input.observation.response,
    move: JSON.stringify({ move: input.observation.move, secondary_moves: input.observation.secondaryMoves }),
    proposed_action: JSON.stringify(input.observation.proposedAction),
    backend_action: JSON.stringify(input.observation.backendAction),
    state: JSON.stringify(input.observation.state),
    backend_rejections: JSON.stringify(input.observation.backendRejections),
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
          instructions: 'Sos un juez estricto de comportamiento conversacional. Evalúa únicamente la respuesta real, la acción efectiva del backend, el estado y las precondiciones suministradas. No premies intención ni inventes hechos. Juzga cada requisito de forma independiente: nunca traslades el incumplimiento de un requisito a otro. Un requisito must falla si no se observa. Un must_not falla ÚNICAMENTE cuando la conducta prohibida sí ocurre; la ausencia de respuesta o de evidencia nunca viola un must_not. Después de recomendar exactamente un curso, preguntar por equipo o por una preferencia entre contenidos de ese mismo curso (por ejemplo, cámara o edición) no equivale a abrir un menú de cursos. Un nombre completo como "Ana Pérez" satisface nombre y apellido; no se exige mostrarlos en campos separados. En preconditions.price_objection_memory, present=true prueba que la objeción del turno actual o de la conversación quedó registrada; priorSourceMessageIds prueba exclusivamente que ya existía en un turno anterior. may_offer_call gobierna una oferta proactiva, no invalida una llamada que el cliente pidió y confirmó; backend_action=request_call_now con workflow.commitSucceeded=true prueba que el despacho fue autorizado. Para cada fallo elegí el requirement_id exacto, el authority_line_index y evidence_source. En observed_evidence copia literalmente el fragmento de esa fuente que prueba el fallo; para un must ausente puede quedar vacío, pero para un must_not debe ser un fragmento no vacío presente en la fuente. El runner expande la línea de autoridad; no redactes ni alteres citas. No juzgues reglas no incluidas.',
          input: JSON.stringify(payload),
          reasoning: { effort: 'none' }, temperature: 0, stream: false, max_output_tokens: 1200,
          text: { format: { type: 'json_schema', name: 'studyx_golden_semantic_turn_judge_v2', schema: {
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
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`GOLDEN_JUDGE_HTTP_${response.status}`);
      const content = extractOutputText(await response.json());
      if (!content) throw new Error('GOLDEN_JUDGE_EMPTY_RESPONSE');
      const decoded = JSON.parse(content) as { verdict?: RawSemanticTurnVerdictV1 };
      const verdict = decoded.verdict;
      if (!verdict || verdict.turn_id !== input.turn.id || !Array.isArray(verdict.failures)) {
        throw new Error('GOLDEN_JUDGE_INVALID_RESPONSE');
      }
      if (verdict.approved !== (verdict.failures.length === 0)) {
        throw new Error('GOLDEN_JUDGE_VERDICT_INCOHERENT');
      }
      const failures: SemanticTurnVerdictV1['failures'][number][] = [];
      for (const failure of verdict.failures as RawSemanticTurnVerdictV1['failures']) {
        const expectedPrefix = failure.code === 'SEMANTIC_MUST_FAILED' ? 'must:' : 'must_not:';
        const requirementIndex = Number(failure.requirement_id?.slice(expectedPrefix.length));
        const requirements = failure.code === 'SEMANTIC_MUST_FAILED' ? input.turn.must : input.turn.mustNot;
        if (typeof failure.requirement_id !== 'string'
          || !failure.requirement_id.startsWith(expectedPrefix)
          || !Number.isInteger(requirementIndex)
          || requirementIndex < 0 || requirementIndex >= requirements.length
          || !Number.isInteger(failure.authority_line_index)
          || failure.authority_line_index < 0 || failure.authority_line_index >= citations.length) {
          throw new Error('GOLDEN_JUDGE_FAILURE_REFERENCE_INVALID');
        }
        const evidence = evidenceSources[failure.evidence_source];
        if (typeof evidence !== 'string'
          || (failure.code === 'SEMANTIC_MUST_NOT_FAILED'
            && (!failure.observed_evidence || !evidence.includes(failure.observed_evidence)))) {
          throw new Error('GOLDEN_JUDGE_FAILURE_EVIDENCE_INVALID');
        }
        const requirement = requirements[requirementIndex]!;
        if (semanticFailureContradictedByObjectiveEvidence({
          failure, requirement, turn: input.turn, observation: input.observation,
          previousObservation: input.previousObservation,
        })) continue;
        failures.push({
          code: failure.code,
          requirement_index: requirementIndex,
          authority_reference: citations[failure.authority_line_index]!,
          explanation: failure.explanation,
        });
      }
      return { turn_id: verdict.turn_id, approved: failures.length === 0, failures, evaluation_error: null };
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
    if (!turnHasRequiredPriorPromotion(turn, input.observations[index - 1] ?? null)) {
      verdicts.push({ turn_id: turn.id, approved: true, failures: [], evaluation_error: null });
      continue;
    }
    verdicts.push(await judgeTurnSemantically({
      apiKey: input.apiKey, model: input.model, turn, observation,
      previousObservation: input.observations[index - 1] ?? null,
    }));
  }
  return verdicts;
}
