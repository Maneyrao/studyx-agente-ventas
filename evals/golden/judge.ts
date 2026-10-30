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
  readonly mayOfferCall?: boolean | null;
}

export interface GoldenFailureV1 {
  readonly code: string;
  readonly detail: string;
  readonly authorityReference?: string;
}

export interface HardJudgeResultV1 {
  readonly failures: readonly GoldenFailureV1[];
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

function add(failures: GoldenFailureV1[], code: string, detail: string): void {
  failures.push({ code, detail });
}

export function evaluateHardRules(
  turn: GoldenTurnV1,
  observation: GoldenTurnObservationV1,
): HardJudgeResultV1 {
  const failures: GoldenFailureV1[] = [];
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
  if (!turn.expected.state.stage.includes(observation.state.stage ?? '')) {
    add(failures, 'STATE_STAGE_MISMATCH', `Esperado ${turn.expected.state.stage.join('|')}; real ${observation.state.stage}.`);
  }
  if (!turn.expected.state.awaitingReply.includes(observation.state.awaitingReply ?? '')) {
    add(failures, 'STATE_AWAITING_REPLY_MISMATCH', `Esperado ${turn.expected.state.awaitingReply.join('|')}; real ${observation.state.awaitingReply}.`);
  }
  if (!turn.expected.state.plan.includes(observation.state.plan)) {
    add(failures, 'STATE_PLAN_MISMATCH', `Esperado ${turn.expected.state.plan.join('|')}; real ${observation.state.plan}.`);
  }
  const expectedPromotion = turn.expected.state.promotion;
  if (!expectedPromotion.status.includes(observation.state.promotion.status)) {
    add(failures, 'PROMOTION_STATUS_MISMATCH', `Esperado ${expectedPromotion.status.join('|')}; real ${observation.state.promotion.status}.`);
  }
  if (!expectedPromotion.bonusCount.includes(observation.state.promotion.bonusCount)) {
    add(failures, 'PROMOTION_BONUS_COUNT_MISMATCH', `Esperado ${expectedPromotion.bonusCount.join('|')}; real ${observation.state.promotion.bonusCount}.`);
  }
  if (expectedPromotion.paidCourse && !expectedPromotion.paidCourse.includes(observation.state.promotion.paidCourse)) {
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
      const missing = (observation.activeCourses ?? []).filter((code) => (
        !includesText(observation.response, offeringName(observation, code))
      ));
      if ((observation.activeCourses?.length ?? 0) === 0) {
        add(failures, 'ACTIVE_COURSES_EVIDENCE_MISSING', 'No hay evidencia local de cursos activados.');
      } else if (missing.length > 0) {
        add(failures, 'ACTIVE_COURSES_NOT_LISTED', `Faltan en el mensaje: ${missing.join(', ')}.`);
      }
    }
    if (rule.type === 'selected_course_equals'
      && observation.state.selectedCourse !== rule.value) {
      add(failures, 'SELECTED_COURSE_MISMATCH', `Esperado ${rule.value}; real ${observation.state.selectedCourse}.`);
    }
  }
  const defaultReference = turn.authority[0]
    ? `${turn.authority[0].file}:${turn.authority[0].start}-${turn.authority[0].end}` : undefined;
  return { failures: failures.map((failure) => ({
    ...failure,
    ...(failure.authorityReference || !defaultReference ? {} : { authorityReference: defaultReference }),
  })) };
}

export type FailureLayerV1 = 'prompt' | 'brain' | 'validador' | 'estado'
  | 'contexto (temarios)' | 'bonificación';

export function inferFailureLayer(
  turn: GoldenTurnV1,
  observation: GoldenTurnObservationV1,
  failureCodes: readonly string[],
): FailureLayerV1 {
  if (turn.hard?.some((rule) => rule.type === 'response_uses_authorized_syllabus')) {
    return observation.selectedOfferingFacts.length === 0 ? 'contexto (temarios)' : 'brain';
  }
  if (failureCodes.some((code) => code.startsWith('PROMOTION_') || code.startsWith('BONUS_'))
    || turn.expected.action.includes('offer_course_bonus') || turn.expected.action.includes('accept_promotion')) {
    return 'bonificación';
  }
  if (observation.backendRejections.length > 0) return 'validador';
  if (failureCodes.some((code) => code.startsWith('STATE_'))) return 'estado';
  if (failureCodes.some((code) => code === 'MOVE_MISMATCH' || code === 'ACTION_MISMATCH'
    || code === 'SILENT_TURN')) return 'brain';
  return 'prompt';
}

export interface SemanticTurnVerdictV1 {
  readonly turn_id: string;
  readonly approved: boolean;
  readonly failures: readonly {
    readonly code: 'SEMANTIC_MUST_FAILED' | 'SEMANTIC_MUST_NOT_FAILED';
    readonly requirement_index: number;
    readonly authority_reference: string;
    readonly explanation: string;
  }[];
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

async function authorityExcerpts(scenario: GoldenCaseV1): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  const cache = new Map<string, string[]>();
  for (const turn of scenario.turns) {
    for (const reference of turn.authority) {
      const key = `${reference.file}:${reference.start}-${reference.end}`;
      if (output[key]) continue;
      let lines = cache.get(reference.file);
      if (!lines) {
        lines = (await readFile(path.join(repoRoot, reference.file), 'utf8')).split(/\r?\n/u);
        cache.set(reference.file, lines);
      }
      output[key] = lines.slice(reference.start - 1, reference.end).join('\n');
    }
  }
  return output;
}

export async function judgeCaseSemantically(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly scenario: GoldenCaseV1;
  readonly observations: readonly GoldenTurnObservationV1[];
}): Promise<readonly SemanticTurnVerdictV1[]> {
  const excerpts = await authorityExcerpts(input.scenario);
  const payload = input.scenario.turns.map((turn, index) => ({
    turn_id: turn.id,
    customer: turn.customer,
    must: turn.must,
    must_not: turn.mustNot,
    authority: turn.authority.map((reference) => `${reference.file}:${reference.start}-${reference.end}`),
    actual: {
      response: input.observations[index]?.response ?? '',
      move: input.observations[index]?.move ?? null,
      proposed_action: input.observations[index]?.proposedAction ?? null,
      backend_rejections: input.observations[index]?.backendRejections ?? [],
      state: input.observations[index]?.state ?? null,
      authorized_facts: input.observations[index]?.authorizedFacts ?? [],
      used_fact_ids: input.observations[index]?.usedFactIds ?? [],
      capabilities: { may_offer_call: input.observations[index]?.mayOfferCall ?? null },
    },
  }));
  const response = await fetch('https://api.deepseek.com/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      instructions: 'Sos un juez estricto de comportamiento conversacional. Evalúa únicamente la respuesta real, la acción y el estado contra cada requisito y los extractos de autoridad suministrados. No premies intención ni inventes hechos. Un requisito must falla si no se observa; un must_not falla si ocurre. Devuelve todos los turnos. No juzgues reglas no incluidas.',
      input: JSON.stringify({ authority_excerpts: excerpts, turns: payload }),
      reasoning: { effort: 'none' }, temperature: 0, stream: false, max_output_tokens: 2400,
      text: { format: { type: 'json_schema', name: 'studyx_golden_semantic_judge_v1', schema: {
        type: 'object', additionalProperties: false, required: ['turns'], properties: {
          turns: { type: 'array', minItems: payload.length, maxItems: payload.length, items: {
            type: 'object', additionalProperties: false,
            required: ['turn_id', 'approved', 'failures'], properties: {
              turn_id: { type: 'string', enum: input.scenario.turns.map((turn) => turn.id) },
              approved: { type: 'boolean' },
              failures: { type: 'array', items: { type: 'object', additionalProperties: false,
                required: ['code', 'requirement_index', 'authority_reference', 'explanation'], properties: {
                  code: { type: 'string', enum: ['SEMANTIC_MUST_FAILED', 'SEMANTIC_MUST_NOT_FAILED'] },
                  requirement_index: { type: 'integer', minimum: 0 },
                  authority_reference: { type: 'string', enum: [...new Set(input.scenario.turns.flatMap((turn) => (
                    turn.authority.map((reference) => `${reference.file}:${reference.start}-${reference.end}`)
                  )))] },
                  explanation: { type: 'string', minLength: 1, maxLength: 800 },
                } },
              },
            },
          } },
        },
      } } },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GOLDEN_JUDGE_HTTP_${response.status}`);
  const content = extractOutputText(await response.json());
  if (!content) throw new Error('GOLDEN_JUDGE_EMPTY_RESPONSE');
  const decoded = JSON.parse(content) as { turns?: SemanticTurnVerdictV1[] };
  if (!Array.isArray(decoded.turns) || decoded.turns.length !== payload.length) {
    throw new Error('GOLDEN_JUDGE_INVALID_RESPONSE');
  }
  const expectedIds = input.scenario.turns.map((turn) => turn.id);
  const returnedIds = decoded.turns.map((turn) => turn.turn_id);
  if (new Set(returnedIds).size !== expectedIds.length
    || expectedIds.some((id) => returnedIds.filter((candidate) => candidate === id).length !== 1)) {
    throw new Error('GOLDEN_JUDGE_TURN_IDS_INVALID');
  }
  for (const verdict of decoded.turns) {
    const turn = input.scenario.turns.find((candidate) => candidate.id === verdict.turn_id);
    if (!turn || verdict.approved !== (verdict.failures.length === 0)) {
      throw new Error('GOLDEN_JUDGE_VERDICT_INCOHERENT');
    }
    const validReferences = new Set(turn.authority.map((reference) => (
      `${reference.file}:${reference.start}-${reference.end}`
    )));
    for (const failure of verdict.failures) {
      const requirements = failure.code === 'SEMANTIC_MUST_FAILED' ? turn.must : turn.mustNot;
      if (!Number.isInteger(failure.requirement_index)
        || failure.requirement_index < 0 || failure.requirement_index >= requirements.length
        || !validReferences.has(failure.authority_reference)) {
        throw new Error('GOLDEN_JUDGE_FAILURE_REFERENCE_INVALID');
      }
    }
  }
  return decoded.turns;
}
