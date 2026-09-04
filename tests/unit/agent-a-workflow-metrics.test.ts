import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { summarizeWorkflowMetricsV1, summarizeWorkflowReportV1,
  type WorkflowMetricsObservationV1, type WorkflowMetricsTurnV1 } from '../helpers/agent-a-workflow-metrics';
import type { WorkflowHttpExchangeV1 } from '../helpers/agent-a-workflow-http-evidence';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';

const successfulHttp: WorkflowHttpExchangeV1 = {
  boundary: 'deepseek', url: 'https://api.deepseek.com/responses', requestBody: {},
  responseBody: { usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 } } },
  status: 200, error: null, elapsedMs: 500,
};

function observed(traceId: string, overrides: Partial<WorkflowMetricsTurnV1> = {}): WorkflowMetricsObservationV1 {
  const evidence: WorkflowMetricsTurnV1 = {
    traceId, turnId: `turn-${traceId}`, steps: ['generate-agent-a-turn-proposal-v1-deepseek'],
    httpExchanges: [successfulHttp], elapsedMs: 1_000, providerMode: 'live',
    authorizedMessages: ['Respuesta útil.'], commitSucceeded: true, errorCode: null,
    workflowEvents: [{ event: 'studyx.turn.agent_a_plannerless_v2', trace_id: traceId, repair_attempted: false, repaired: false }],
    ...overrides,
  };
  return { evidence, db: {
    contact: { lifecycleStatus: 'active', blockedAt: null }, permission: null,
    decisions: [{ turnId: evidence.turnId!, outboundId: `outbound-${traceId}`, createdAt: '2026-09-04T13:00:00Z',
      reasonCode: 'AGENT_A_PLANNERLESS_V2', responseType: 'commercial_reply', hasResponse: true,
      businessActionType: null, promptVersion: 'brain-v14', modelName: 'deepseek-v4-flash' }],
  } };
}

describe('métricas del workflow con errores incluidos', () => {
  it('incluye retry fallido, su usage ausente y latencia del silencio en el denominador', () => {
    const failed = observed('failed', {
      elapsedMs: 9_000, authorizedMessages: [],
      steps: ['generate-agent-a-turn-proposal-v1-deepseek', 'repair-agent-a-turn-proposal-v2'],
      httpExchanges: [successfulHttp, { ...successfulHttp, status: 503, responseBody: { error: 'unavailable' }, elapsedMs: 8_000 }],
      workflowEvents: [{ event: 'studyx.turn.agent_a_brain_v1', trace_id: 'failed', brain_source: 'fallback', brain_failure_reason: 'provider_unavailable' }],
    });
    const metrics = summarizeWorkflowMetricsV1([observed('fast'), failed]);
    expect(metrics).toMatchObject({ eligible_model_turns: 2, http_attempts: 3, http_failed_attempts: 1,
      usage_missing_attempts: 1, known_input_tokens: 200, known_cached_input_tokens: 80, known_output_tokens: 40,
      repair_attempted_turns: 1, repair_successful_turns: 0, repair_success_rate: 0, repair_rate: 0.5,
      latency_sample_count: 2, p50_ms: 1_000, p95_ms: 9_000, availability_failed_turns: 1,
      technical_fallback_turns: 1, technical_fallback_rate: 0.5 });
    expect(Object.values(metrics.gates)).toEqual([false, false, false, false, false]);
  });

  it('sólo repaired=true confirma reparación; texto visible tras reparación fallida no cuenta éxito', () => {
    const failed = observed('pruned', { workflowEvents: [{ event: 'studyx.turn.agent_a_plannerless_v2', trace_id: 'pruned', repair_attempted: true, repaired: false }] });
    const passed = observed('repaired', { workflowEvents: [{ event: 'studyx.turn.agent_a_plannerless_v2', trace_id: 'repaired', repair_attempted: true, repaired: true }] });
    expect(summarizeWorkflowMetricsV1([failed, passed])).toMatchObject({ repair_attempted_turns: 2, repair_successful_turns: 1, repair_success_rate: 0.5 });
  });

  it('sin intentos repair su éxito es null; sin muestra live no certifica calidad ni estabilidad', () => {
    const metrics = summarizeWorkflowMetricsV1([observed('fixture', { providerMode: 'fixture' })]);
    expect(metrics).toMatchObject({ fixture_model_turns: 1, live_model_turns: 0, repair_rate: 0,
      repair_success_rate: null, numeric_gates_passed: null, quality_ready: false, production_ready: false, stability_certified: false });
    expect(metrics.gates.repair_success_at_least_80_percent).toBeNull();
    expect(metrics.limitations).toContain('NO_LIVE_MODEL_SAMPLE');
  });

  it('cuenta indisponibilidad antes del HTTP como turno elegible sin inventar usage cero', () => {
    const unavailable = observed('missing-key', { steps: [], httpExchanges: [], authorizedMessages: [],
      workflowEvents: [{ event: 'studyx.turn.agent_a_brain_v1', trace_id: 'missing-key', brain_source: 'fallback', brain_failure_reason: 'configuration' }] });
    expect(summarizeWorkflowMetricsV1([unavailable])).toMatchObject({ eligible_model_turns: 1, http_attempts: 0,
      known_input_tokens: null, availability_failed_turns: 1, technical_fallback_turns: 1 });
  });

  it('deduplica checkpoints por trace antes de sumar tokens o reparaciones', () => {
    const one = observed('repeated');
    expect(summarizeWorkflowMetricsV1([one, one, one])).toMatchObject({ observed_turns: 1, eligible_model_turns: 1,
      duplicate_traces_ignored: 2, http_attempts: 1, known_input_tokens: 100 });
  });

  it('una reparación sin evento de resultado queda desconocida aunque el commit responda', () => {
    const missing = observed('unknown', { workflowEvents: [], steps: ['generate-agent-a-turn-proposal-v1-deepseek', 'repair-agent-a-turn-proposal-v2'] });
    expect(summarizeWorkflowMetricsV1([missing])).toMatchObject({ repair_attempted_turns: 1, repair_successful_turns: 0,
      repair_outcome_unknown_turns: 1, repair_success_rate: null });
  });

  it('excluye del denominador de modelo el opt-out determinístico con revocación durable', () => {
    const optout = observed('optout', { httpExchanges: [], steps: [], workflowEvents: [], authorizedMessages: [] });
    const db = { ...optout.db!, permission: { consentStatus: 'revoked', evidenceEventId: 'consent-1', revokedAt: '2026-09-04T12:00:00Z', revokedTurnId: 'turn-optout' },
      decisions: [{ ...optout.db!.decisions[0]!, reasonCode: 'CONSENT_REVOKED', hasResponse: false, responseType: null }] };
    expect(summarizeWorkflowMetricsV1([{ ...optout, db }])).toMatchObject({ observed_turns: 1, eligible_model_turns: 0,
      p95_ms: null, repair_rate: null, technical_fallback_rate: null, availability_failed_turns: 0 });
  });

  it('integra reportes anidados sin recorrer prompts ni duplicar turnos repetidos', () => {
    const one = observed('one');
    const report = { conversations: [{ turns: [{ evidence: one.evidence }], db: one.db }], cases: { copy: { turns: [{ evidence: one.evidence }], db: one.db } } };
    expect(summarizeWorkflowReportV1(report)).toMatchObject({ observed_turns: 1, duplicate_traces_ignored: 1, eligible_model_turns: 1, availability_unknown_turns: 0 });
  });

  it('una muestra vacía tiene percentiles y gates desconocidos, nunca ceros favorables', () => {
    const empty = summarizeWorkflowMetricsV1([]);
    expect(empty.p95_ms).toBeNull();
    expect(empty.gates.availability_failures_zero).toBeNull();
    expect(empty.numeric_gates_passed).toBeNull();
    expect(empty.limitations).toContain('NO_MODEL_ELIGIBLE_SAMPLE');
  });

  it('guarda métricas derivadas en cada reporte único sin aceptar un ready suministrado', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'studyx-metrics-'));
    vi.stubEnv('STUDYX_WORKFLOW_REPORT_DIR', directory);
    try {
      const one = observed('persisted-report');
      const filename = writeWorkflowReportV1('workflow-unit', { turns: [{ evidence: one.evidence }], db: one.db, metrics: { quality_ready: true } });
      const report = JSON.parse(readFileSync(filename, 'utf8'));
      expect(report.metrics).toMatchObject({ observed_turns: 1, eligible_model_turns: 1, repair_success_rate: null, quality_ready: false });
      const second = writeWorkflowReportV1('workflow-unit', { turns: [{ evidence: one.evidence }], db: one.db });
      expect(second).not.toBe(filename);
      expect(JSON.parse(readFileSync(filename, 'utf8')).run_id).toBe(report.run_id);
    } finally {
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('ni umbrales numéricos satisfechos en fixtures certifican calidad o producción', () => {
    const sample = Array.from({ length: 20 }, (_, index) => observed(`fixture-${index}`, {
      providerMode: 'fixture',
      workflowEvents: [{ event: 'studyx.turn.agent_a_plannerless_v2', trace_id: `fixture-${index}`, repair_attempted: index === 0, repaired: index === 0 }],
    }));
    expect(summarizeWorkflowMetricsV1(sample)).toMatchObject({ repair_rate: 0.05, repair_success_rate: 1,
      numeric_gates_passed: true, quality_ready: false, production_ready: false, stability_certified: false });
  });

  it('un replay con decisión y entrega previas confirmadas no es disponibilidad fallida por omitir commit nuevo', () => {
    const replay = observed('replay', { steps: ['ingest-canonical-turn'], commitSucceeded: false, authorizedMessages: [],
      workflowEvents: [{ event: 'studyx.turn.replayed', trace_id: 'replay' }],
      httpExchanges: [{ ...successfulHttp, boundary: 'backend', url: 'http://127.0.0.1:3217/api/agent/ingest',
        responseBody: { turn_id: 'turn-replay', existing_result: { decision_id: 'previous', outbound_id: 'outbound-replay', delivery_status: 'submitted_to_botpress' } } }],
    });
    expect(summarizeWorkflowMetricsV1([replay])).toMatchObject({ eligible_model_turns: 0, availability_failed_turns: 0, availability_unknown_turns: 0 });
    const unresolved = { ...replay, evidence: { ...replay.evidence, httpExchanges: [{ ...replay.evidence.httpExchanges[0]!,
      responseBody: { turn_id: 'turn-replay', existing_result: { decision_id: 'previous', outbound_id: 'sent', delivery_status: 'pending' } } }] } };
    expect(summarizeWorkflowMetricsV1([unresolved]).availability_failed_turns).toBe(1);
  });

  it('una caída de modelo persistida antes de HTTP se incluye aun si el reporte histórico no capturó logs', () => {
    const missing = observed('historical', { steps: [], httpExchanges: [], workflowEvents: undefined, authorizedMessages: [] });
    const db = { ...missing.db!, decisions: [{ ...missing.db!.decisions[0]!, hasResponse: false, reasonCode: 'BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK' }] };
    expect(summarizeWorkflowMetricsV1([{ ...missing, db }])).toMatchObject({ eligible_model_turns: 1, http_attempts: 0,
      technical_fallback_turns: 1, availability_failed_turns: 1 });
  });

  it('un error genérico de backend no inventa el resultado de una reparación sin evento', () => {
    const unknown = observed('commit-failed', { workflowEvents: [], errorCode: 'HTTP_409',
      steps: ['generate-agent-a-turn-proposal-v1-deepseek', 'repair-agent-a-turn-proposal-v2'] });
    expect(summarizeWorkflowMetricsV1([unknown])).toMatchObject({ repair_attempted_turns: 1,
      repair_successful_turns: 0, repair_success_rate: null, repair_outcome_unknown_turns: 1, availability_failed_turns: 1 });
  });

  it('replay mudo exige la decisión previa y opt-out causal; existencia de decision_id no excusa silencio', () => {
    const silent = observed('silent-replay', { steps: ['ingest-canonical-turn'], commitSucceeded: false, authorizedMessages: [],
      workflowEvents: [{ event: 'studyx.turn.replayed', trace_id: 'silent-replay' }],
      httpExchanges: [{ ...successfulHttp, boundary: 'backend', url: 'http://127.0.0.1:3217/api/agent/ingest',
        responseBody: { turn_id: 'turn-silent-replay', existing_result: { decision_id: 'previous', outbound_id: null, delivery_status: null } } }],
    });
    const db = { ...silent.db!, decisions: [{ ...silent.db!.decisions[0]!, outboundId: null, hasResponse: false }] };
    expect(summarizeWorkflowMetricsV1([{ ...silent, db }]).availability_failed_turns).toBe(1);
    const optedOut = { ...db, permission: { consentStatus: 'revoked', evidenceEventId: 'consent', revokedAt: '2026-09-04T12:00:00Z', revokedTurnId: 'turn-silent-replay' },
      decisions: [{ ...db.decisions[0]!, reasonCode: 'CONSENT_REVOKED' }] };
    expect(summarizeWorkflowMetricsV1([{ ...silent, db: optedOut }])).toMatchObject({ availability_failed_turns: 0, availability_unknown_turns: 0 });
    expect(summarizeWorkflowMetricsV1([{ evidence: silent.evidence }])).toMatchObject({ availability_unknown_turns: 1 });
  });

  it('replay submitted sin DB no demuestra que la respuesta previa no fuera fallback', () => {
    const replay = observed('submitted-replay', { steps: [], commitSucceeded: false, authorizedMessages: [],
      workflowEvents: [{ event: 'studyx.turn.replayed', trace_id: 'submitted-replay' }],
      httpExchanges: [{ ...successfulHttp, boundary: 'backend', url: 'http://127.0.0.1:3217/api/agent/ingest',
        responseBody: { turn_id: 'turn-submitted-replay', existing_result: { decision_id: 'previous', outbound_id: 'outbound-submitted-replay', delivery_status: 'submitted_to_botpress' } } }],
    });
    expect(summarizeWorkflowMetricsV1([{ evidence: replay.evidence }])).toMatchObject({ availability_unknown_turns: 1 });
    const technicalDb = { ...replay.db!, decisions: [{ ...replay.db!.decisions[0]!, reasonCode: 'EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED' }] };
    expect(summarizeWorkflowMetricsV1([{ ...replay, db: technicalDb }]).availability_failed_turns).toBe(1);
  });
});
