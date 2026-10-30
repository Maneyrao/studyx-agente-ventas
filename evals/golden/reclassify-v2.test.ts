import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  evaluateHardRules,
  inferFailureAttribution,
  primaryAuthorityCitation,
  type GoldenFailureV1,
  type GoldenTurnObservationV1,
  type ValidatorRejectionV1,
} from './judge';
import { GOLDEN_BASE_SHA, GOLDEN_CASES } from './scenarios';

interface V2TurnResult {
  readonly turn_id: string;
  readonly response_real: string;
  readonly failures: readonly GoldenFailureV1[];
}

interface V2CaseResult {
  readonly case_id: string;
  readonly turns: readonly V2TurnResult[];
}

interface V2Report {
  readonly environment_configuration: unknown;
  readonly deepseek_model: string;
  readonly prompt_version: string;
  readonly brain_version: string;
  readonly cases: readonly V2CaseResult[];
}

interface SavedCase {
  readonly scenario: { readonly id: string };
  readonly observations: readonly GoldenTurnObservationV1[];
  readonly setupEvidence?: unknown;
}

interface SavedObservations {
  readonly base_sha: string;
  readonly completed_cases: number;
  readonly cases: readonly SavedCase[];
}

interface V3TurnResult {
  readonly case_id: string;
  readonly turn_id: string;
  readonly customer: string;
  readonly approved: boolean;
  readonly execution_status: 'executed';
  readonly authority: readonly string[];
  readonly must: readonly string[];
  readonly must_not: readonly string[];
  readonly response_real: string;
  readonly move: string | null;
  readonly proposed_action: Record<string, unknown> | null;
  readonly backend_action: string | null;
  readonly backend_rejections: readonly unknown[];
  readonly state: GoldenTurnObservationV1['state'];
  readonly failures: readonly GoldenFailureV1[];
  readonly failure_layer: ReturnType<typeof inferFailureAttribution>['layer'] | null;
  readonly validator_rejections: readonly ValidatorRejectionV1[];
  readonly model_attempts: GoldenTurnObservationV1['modelAttempts'];
  readonly preconditions: {
    readonly course_bonus: GoldenTurnObservationV1['courseBonus'];
    readonly price_objection_memory: GoldenTurnObservationV1['priceObjectionMemory'];
    readonly may_offer_call: boolean | null;
    readonly workflow: GoldenTurnObservationV1['workflow'];
  };
}

interface V3CaseResult {
  readonly case_id: string;
  readonly title: string;
  readonly approved: boolean;
  readonly setup_evidence?: unknown;
  readonly turns: readonly V3TurnResult[];
}

const resultsDirectory = path.resolve(process.cwd(), 'evals/golden/results');
const reclassify = process.env.STUDYX_GOLDEN_RECLASSIFY_V2 === 'true'
  ? describe : describe.skip;

function escape(value: unknown): string {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function validatorLabel(rejections: readonly ValidatorRejectionV1[]): string {
  return rejections.map((item) => `${item.code}${item.subject ? ` / ${item.subject}` : ''}`).join('; ');
}

function markdown(report: Record<string, unknown> & { readonly cases: readonly V3CaseResult[] }): string {
  const cases = report.cases;
  const turns = cases.flatMap((item) => item.turns);
  const lines = [
    '# Agent A golden baseline v3 — reclasificación offline de baseline v2', '',
    `- Base del agente: \`${GOLDEN_BASE_SHA}\``,
    `- Brain: \`${String(report.brain_version)}\``,
    `- Prompt canónico: \`${String(report.prompt_version)}\``,
    `- Modelo original de las observaciones: \`${String(report.deepseek_model)}\``,
    '- Reclasificación: sin llamadas al modelo; reglas deterministas actuales + fallos `SEMANTIC_*` guardados en v2.',
    `- Casos: ${cases.filter((item) => item.approved).length} aprobados; ${cases.filter((item) => !item.approved).length} fallidos; 0 con error del evaluador`,
    `- Turnos: ${turns.filter((turn) => turn.approved).length} aprobados; ${turns.filter((turn) => !turn.approved).length} fallidos; 0 con error del evaluador`, '',
    '| Caso/turno | Resultado | Autoridad | Respuesta real | Move / acción | Rechazos backend | Capa |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const item of cases) for (const turn of item.turns) {
    const layer = turn.failure_layer
      ? `${turn.failure_layer}${turn.validator_rejections.length > 0 ? ` — ${validatorLabel(turn.validator_rejections)}` : ''}`
      : '—';
    lines.push(`| ${escape(`${item.case_id}/${turn.turn_id}`)} | ${turn.approved ? 'APROBADO' : 'FALLIDO'} | ${escape(turn.authority.join('; '))} | ${escape(turn.response_real)} | ${escape(`${turn.move ?? 'null'} / ${JSON.stringify(turn.proposed_action)}`)} | ${escape(JSON.stringify(turn.backend_rejections))} | ${escape(layer)} |`);
  }
  lines.push('', '## Fallos', '');
  for (const item of cases) for (const turn of item.turns.filter((candidate) => !candidate.approved)) {
    const validator = turn.validator_rejections.length > 0
      ? ` (${validatorLabel(turn.validator_rejections)})` : '';
    lines.push(`- **${item.case_id}/${turn.turn_id} — ${turn.failure_layer}${validator}:** ${turn.failures.map((failure) => `${failure.code} [${failure.authorityReference ?? turn.authority[0] ?? 'sin referencia'}]: ${failure.detail}`).join(' | ')}`);
  }
  return `${lines.join('\n')}\n`;
}

reclassify('offline v2 to v3 golden reclassification', () => {
  it('reclassifies all saved observations without calling DeepSeek', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('NETWORK_FORBIDDEN_DURING_OFFLINE_RECLASSIFICATION');
    });
    const observations = JSON.parse(await readFile(
      path.join(resultsDirectory, 'baseline-028f272-v2-observations.partial.json'), 'utf8',
    )) as SavedObservations;
    const v2 = JSON.parse(await readFile(
      path.join(resultsDirectory, 'baseline-028f272-v2.json'), 'utf8',
    )) as V2Report;

    expect(observations.base_sha).toBe(GOLDEN_BASE_SHA);
    expect(observations.completed_cases).toBe(GOLDEN_CASES.length);

    const cases: V3CaseResult[] = [];
    for (const scenario of GOLDEN_CASES) {
      const saved = observations.cases.find((item) => item.scenario.id === scenario.id);
      const previous = v2.cases.find((item) => item.case_id === scenario.id);
      expect(saved, `V3_OBSERVATIONS_MISSING:${scenario.id}`).toBeTruthy();
      expect(previous, `V3_V2_CASE_MISSING:${scenario.id}`).toBeTruthy();
      expect(saved?.observations).toHaveLength(scenario.turns.length);
      const turns: V3TurnResult[] = [];
      for (const [index, turn] of scenario.turns.entries()) {
        const observation = saved!.observations[index]!;
        const oldTurn = previous!.turns.find((item) => item.turn_id === turn.id);
        expect(oldTurn, `V3_V2_TURN_MISSING:${scenario.id}/${turn.id}`).toBeTruthy();
        expect(observation.response).toBe(oldTurn!.response_real);
        const primaryCitation = await primaryAuthorityCitation(turn);
        const hard = evaluateHardRules(turn, observation, saved!.observations[index - 1] ?? null);
        expect(hard.evaluatorErrors, `V3_HARD_EVALUATOR_ERROR:${scenario.id}/${turn.id}`).toEqual([]);
        const hardFailures = hard.failures.map((failure) => ({
          ...failure,
          ...(failure.authorityReference || !primaryCitation
            ? {} : { authorityReference: primaryCitation }),
        }));
        const semanticFailures = oldTurn!.failures.filter((failure) => failure.code.startsWith('SEMANTIC_'));
        const failures = [...hardFailures, ...semanticFailures];
        const attribution = failures.length > 0
          ? inferFailureAttribution(turn, observation, failures.map((failure) => failure.code))
          : null;
        turns.push({
          case_id: scenario.id,
          turn_id: turn.id,
          customer: turn.customer,
          approved: failures.length === 0,
          execution_status: 'executed',
          authority: primaryCitation ? [primaryCitation] : [],
          must: turn.must,
          must_not: turn.mustNot,
          response_real: observation.response,
          move: observation.move,
          proposed_action: observation.proposedAction,
          backend_action: observation.backendAction,
          backend_rejections: observation.backendRejections,
          state: observation.state,
          failures,
          failure_layer: attribution?.layer ?? null,
          validator_rejections: attribution?.validatorRejections ?? [],
          model_attempts: observation.modelAttempts,
          preconditions: {
            course_bonus: observation.courseBonus,
            price_objection_memory: observation.priceObjectionMemory,
            may_offer_call: observation.mayOfferCall ?? null,
            workflow: observation.workflow,
          },
        });
      }
      cases.push({
        case_id: scenario.id,
        title: scenario.title,
        approved: turns.every((turn) => turn.approved),
        ...(saved!.setupEvidence === undefined ? {} : { setup_evidence: saved!.setupEvidence }),
        turns,
      });
    }

    const turns = cases.flatMap((item) => item.turns);
    const report = {
      schema_version: 3,
      generated_at: new Date().toISOString(),
      base_sha: GOLDEN_BASE_SHA,
      source_baseline: 'baseline-028f272-v2.json',
      source_observations: 'baseline-028f272-v2-observations.partial.json',
      reclassified_without_model_call: true,
      semantic_failures_source: 'cached SEMANTIC_* failures from baseline v2',
      execution_harness: 'processInboundTurn',
      environment: 'isolated_local',
      environment_configuration: v2.environment_configuration,
      production_or_vertice_used: false,
      deepseek_model: v2.deepseek_model,
      prompt_version: v2.prompt_version,
      brain_version: v2.brain_version,
      case_summary: {
        approved: cases.filter((item) => item.approved).length,
        failed: cases.filter((item) => !item.approved).length,
        not_evaluated: 0,
        evaluator_errors: 0,
        completed: cases.length,
        total: GOLDEN_CASES.length,
      },
      turn_summary: {
        approved: turns.filter((turn) => turn.approved).length,
        failed: turns.filter((turn) => !turn.approved).length,
        evaluator_errors: 0,
        total: turns.length,
      },
      cases,
    };
    expect(cases).toHaveLength(16);
    expect(turns).toHaveLength(48);
    expect(fetchSpy).not.toHaveBeenCalled();
    await writeFile(path.join(resultsDirectory, 'baseline-028f272-v3.json'), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(path.join(resultsDirectory, 'baseline-028f272-v3.md'), markdown(report));
    fetchSpy.mockRestore();
  });
});
