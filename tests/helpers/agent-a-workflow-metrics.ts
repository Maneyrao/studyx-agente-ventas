import type { WorkflowEventV1 } from './agent-a-workflow-events';
import type { WorkflowHttpExchangeV1 } from './agent-a-workflow-http-evidence';
import { countWorkflowAvailabilityFailuresV1, type WorkflowAvailabilityTurnV1, type WorkflowBlockingEvidenceV1 } from './agent-a-workflow-measurement';

export interface WorkflowMetricsTurnV1 extends WorkflowAvailabilityTurnV1 {
  readonly traceId: string;
  readonly steps: readonly string[];
  readonly httpExchanges: readonly WorkflowHttpExchangeV1[];
  readonly workflowEvents?: readonly WorkflowEventV1[];
  readonly elapsedMs: number;
  readonly providerMode?: 'live' | 'fixture';
}

export interface WorkflowMetricsObservationV1 {
  readonly evidence: WorkflowMetricsTurnV1;
  readonly db?: WorkflowBlockingEvidenceV1;
}

export interface WorkflowMetricsV1 {
  readonly observed_turns: number;
  readonly duplicate_traces_ignored: number;
  readonly eligible_model_turns: number;
  readonly live_model_turns: number;
  readonly fixture_model_turns: number;
  readonly unknown_provider_model_turns: number;
  readonly http_attempts: number;
  readonly http_failed_attempts: number;
  readonly usage_missing_attempts: number;
  readonly cached_usage_missing_attempts: number;
  readonly known_input_tokens: number | null;
  readonly known_cached_input_tokens: number | null;
  readonly known_output_tokens: number | null;
  /** Observable provider usage priced with the pinned lab rates. */
  readonly known_cost_usd: number | null;
  readonly cost_missing_attempts: number;
  readonly cost_pricing: 'deepseek-v4-flash-2026-09-04';
  readonly repair_attempted_turns: number;
  readonly repair_successful_turns: number;
  readonly repair_outcome_unknown_turns: number;
  readonly repair_rate: number | null;
  readonly repair_success_rate: number | null;
  readonly technical_fallback_turns: number;
  readonly technical_fallback_rate: number | null;
  readonly availability_failed_turns: number;
  readonly availability_unknown_turns: number;
  readonly latency_sample_count: number;
  readonly latency_missing_turns: number;
  readonly p50_ms: number | null;
  readonly p95_ms: number | null;
  readonly gates: {
    readonly p95_below_6000ms: boolean | null;
    readonly repair_rate_at_most_5_percent: boolean | null;
    readonly repair_success_at_least_80_percent: boolean | null;
    readonly fallback_rate_at_most_2_percent: boolean | null;
    readonly availability_failures_zero: boolean | null;
  };
  readonly numeric_gates_passed: boolean | null;
  readonly quality_ready: false;
  readonly production_ready: false;
  readonly stability_certified: false;
  readonly limitations: readonly string[];
}

const INPUT_RATE_USD = 0.44 / 1_000_000;
const CACHED_INPUT_RATE_USD = 0.014 / 1_000_000;
const OUTPUT_RATE_USD = 1.32 / 1_000_000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numericToken(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sumKnown(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

function roundedUsd(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(12));
}

function percentile(values: readonly number[], fraction: number): number | null {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1]! : null;
}

function hasRepairContext(exchange: WorkflowHttpExchangeV1): boolean {
  const instructions = record(exchange.requestBody)?.instructions;
  if (typeof instructions !== 'string') return false;
  const context = instructions.split('<authorized_context>')[1]?.split('</authorized_context>')[0];
  if (!context) return false;
  try { return record(JSON.parse(context))?.turn_rejection != null; } catch { return false; }
}

function technicalFallback(observation: WorkflowMetricsObservationV1, events: readonly WorkflowEventV1[]): boolean {
  const decision = observation.db?.decisions.find((item) => item.turnId === observation.evidence.turnId);
  if (decision?.responseType === 'technical_fallback' || decision?.reasonCode?.startsWith('BRAIN_UNAVAILABLE')
      || decision?.reasonCode === 'EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED') return true;
  if (events.some((event) => event.event === 'studyx.turn.agent_a_brain_v1' && event.brain_source === 'fallback')) return true;
  return observation.evidence.httpExchanges.some((exchange) => {
    if (exchange.boundary !== 'backend' || !exchange.url.endsWith('/decision')) return false;
    const effects = record(record(exchange.responseBody)?.conversation_effects);
    const decisionRequest = record(record(exchange.requestBody)?.decision);
    return effects?.technical_fallback_reason === 'EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED'
      || String(decisionRequest?.reason_code ?? '').startsWith('BRAIN_UNAVAILABLE');
  });
}

export function summarizeWorkflowMetricsV1(observations: readonly WorkflowMetricsObservationV1[]): WorkflowMetricsV1 {
  const byTrace = new Map<string, WorkflowMetricsObservationV1>();
  for (const observation of observations) {
    const previous = byTrace.get(observation.evidence.traceId);
    // Checkpoints posteriores pueden aportar DB sin volver a cobrar la misma traza.
    if (!previous || (!previous.db && observation.db)) byTrace.set(observation.evidence.traceId, observation);
  }
  const turns = [...byTrace.values()].map((observation) => {
    const { evidence } = observation;
    const events = (evidence.workflowEvents ?? []).filter((event) => event.trace_id === evidence.traceId);
    const calls = evidence.httpExchanges.filter((exchange) => exchange.boundary === 'deepseek');
    const persistedModelFailure = observation.db?.decisions.some((decision) => decision.turnId === evidence.turnId
      && decision.reasonCode?.startsWith('BRAIN_UNAVAILABLE')) === true;
    const modelEligible = calls.length > 0
      || persistedModelFailure
      || evidence.steps.some((step) => /^(?:generate|repair)-agent-a-turn-proposal-/u.test(step))
      || events.some((event) => ['studyx.turn.agent_a_brain_v1', 'studyx.turn.agent_a_plannerless_v2', 'studyx.turn.agent_a_repair_failed'].includes(event.event));
    const repairEvent = events.findLast((event) => event.event === 'studyx.turn.agent_a_plannerless_v2');
    const attempted = evidence.steps.some((step) => /^repair-agent-a-turn-proposal-/u.test(step))
      || repairEvent?.repair_attempted === true || repairEvent?.repaired === true || calls.some(hasRepairContext);
    const fallback = technicalFallback(observation, events);
    const repairFailure = repairEvent?.repaired === false || persistedModelFailure
      || events.some((event) => event.event === 'studyx.turn.agent_a_brain_v1' && event.brain_source === 'fallback')
      || events.some((event) => event.event === 'studyx.turn.agent_a_repair_failed');
    const repaired = !attempted ? null : repairEvent?.repaired === true ? true : repairFailure ? false : null;
    const confirmedReplay = events.some((event) => event.event === 'studyx.turn.replayed')
      && evidence.errorCode === null ? evidence.httpExchanges.find((exchange) => {
        if (exchange.boundary !== 'backend' || !exchange.url.endsWith('/ingest') || exchange.status !== 200) return false;
        const response = record(exchange.responseBody);
        const existing = record(response?.existing_result);
        return response?.turn_id === evidence.turnId && typeof existing?.decision_id === 'string'
          && (existing.outbound_id === null || existing.delivery_status === 'submitted_to_botpress');
      }) : undefined;
    const replayOutboundId = record(record(confirmedReplay?.responseBody)?.existing_result)?.outbound_id;
    const priorDecision = observation.db?.decisions.find((decision) => decision.turnId === evidence.turnId);
    const replayFailed = !observation.db ? null : !priorDecision ? true
      : replayOutboundId === null
        ? countWorkflowAvailabilityFailuresV1({ turns: [{ evidence: { ...evidence, commitSucceeded: true } }], db: observation.db }) > 0
        : !priorDecision.hasResponse || priorDecision.outboundId !== replayOutboundId;
    const availabilityFailed = fallback || evidence.errorCode !== null ? true
      : confirmedReplay ? replayFailed : !evidence.commitSucceeded
      ? true : observation.db
        ? countWorkflowAvailabilityFailuresV1({ turns: [{ evidence }], db: observation.db }) > 0 : null;
    const provider = evidence.providerMode ?? (calls.some((call) => record(call.responseBody)?.fixture === true) ? 'fixture' : 'unknown');
    return { evidence, calls, modelEligible, attempted, repaired, fallback, availabilityFailed, provider };
  });
  const eligible = turns.filter((turn) => turn.modelEligible);
  const calls = eligible.flatMap((turn) => turn.calls);
  const usage = calls.map((call) => {
    const usage = record(record(call.responseBody)?.usage);
    const input = numericToken(usage?.input_tokens);
    const output = numericToken(usage?.output_tokens);
    const cached = numericToken(record(usage?.input_tokens_details)?.cached_tokens);
    const cost = input !== null && output !== null && cached !== null && cached <= input
      ? (input - cached) * INPUT_RATE_USD + cached * CACHED_INPUT_RATE_USD + output * OUTPUT_RATE_USD
      : null;
    return { input, output, cached, cost };
  });
  const attempted = eligible.filter((turn) => turn.attempted);
  const successes = attempted.filter((turn) => turn.repaired === true).length;
  const unknownRepair = attempted.filter((turn) => turn.repaired === null).length;
  const fallbackCount = eligible.filter((turn) => turn.fallback).length;
  const availabilityFailed = turns.filter((turn) => turn.availabilityFailed === true).length;
  const availabilityUnknown = turns.filter((turn) => turn.availabilityFailed === null).length;
  const elapsed = eligible.map((turn) => turn.evidence.elapsedMs).filter((value) => Number.isFinite(value) && value >= 0);
  const missingLatency = eligible.length - elapsed.length;
  const p95 = percentile(elapsed, 0.95);
  const repairRate = eligible.length ? attempted.length / eligible.length : null;
  const repairSuccessRate = attempted.length && unknownRepair === 0 ? successes / attempted.length : null;
  const fallbackRate = eligible.length ? fallbackCount / eligible.length : null;
  const gates: WorkflowMetricsV1['gates'] = {
    p95_below_6000ms: p95 !== null && missingLatency === 0 ? p95 < 6_000 : null,
    repair_rate_at_most_5_percent: repairRate === null ? null : repairRate <= 0.05,
    repair_success_at_least_80_percent: repairSuccessRate === null ? null : repairSuccessRate >= 0.8,
    fallback_rate_at_most_2_percent: fallbackRate === null ? null : fallbackRate <= 0.02,
    availability_failures_zero: availabilityFailed > 0 ? false : turns.length && availabilityUnknown === 0 ? true : null,
  };
  const gateValues = Object.values(gates);
  const missingUsage = usage.filter((item) => item.input === null || item.output === null).length;
  const live = eligible.filter((turn) => turn.provider === 'live').length;
  const fixture = eligible.filter((turn) => turn.provider === 'fixture').length;
  const limitations = ['STABILITY_NOT_CERTIFIED', 'NATURALNESS_AND_REMOTE_DELIVERY_NOT_EVALUATED'];
  if (!eligible.length) limitations.push('NO_MODEL_ELIGIBLE_SAMPLE');
  if (!live) limitations.push('NO_LIVE_MODEL_SAMPLE');
  if (fixture) limitations.push('FIXTURE_SAMPLE_NOT_VALID_FOR_QUALITY');
  if (eligible.length !== live + fixture) limitations.push('PROVIDER_MODE_UNKNOWN');
  if (!attempted.length) limitations.push('NO_REPAIR_SAMPLE');
  if (unknownRepair) limitations.push('REPAIR_OUTCOME_EVIDENCE_MISSING');
  if (missingUsage) limitations.push('USAGE_INCOMPLETE_NOT_ZERO_COST');
  if (availabilityUnknown) limitations.push('PERSISTED_AVAILABILITY_EVIDENCE_MISSING');
  if (missingLatency) limitations.push('LATENCY_EVIDENCE_MISSING');
  return {
    observed_turns: turns.length, duplicate_traces_ignored: observations.length - turns.length,
    eligible_model_turns: eligible.length, live_model_turns: live, fixture_model_turns: fixture,
    unknown_provider_model_turns: eligible.length - live - fixture,
    http_attempts: calls.length, http_failed_attempts: calls.filter((call) => call.error || call.status === null || call.status >= 400).length,
    usage_missing_attempts: missingUsage, cached_usage_missing_attempts: usage.filter((item) => item.cached === null).length,
    known_input_tokens: sumKnown(usage.map((item) => item.input)), known_cached_input_tokens: sumKnown(usage.map((item) => item.cached)),
    known_output_tokens: sumKnown(usage.map((item) => item.output)), known_cost_usd: roundedUsd(sumKnown(usage.map((item) => item.cost))),
    cost_missing_attempts: usage.filter((item) => item.cost === null).length,
    cost_pricing: 'deepseek-v4-flash-2026-09-04',
    repair_attempted_turns: attempted.length, repair_successful_turns: successes, repair_outcome_unknown_turns: unknownRepair,
    repair_rate: repairRate, repair_success_rate: repairSuccessRate, technical_fallback_turns: fallbackCount, technical_fallback_rate: fallbackRate,
    availability_failed_turns: availabilityFailed, availability_unknown_turns: availabilityUnknown,
    latency_sample_count: elapsed.length, latency_missing_turns: missingLatency, p50_ms: percentile(elapsed, 0.5), p95_ms: p95,
    gates, numeric_gates_passed: gateValues.includes(false) ? false : gateValues.every((gate) => gate === true) ? true : null,
    quality_ready: false, production_ready: false, stability_certified: false, limitations,
  };
}

/** Lee únicamente contenedores de evidencia, nunca vuelve a recorrer prompts. */
export function summarizeWorkflowReportV1(report: Record<string, unknown>): WorkflowMetricsV1 {
  const observations: WorkflowMetricsObservationV1[] = [];
  function visit(value: unknown, inheritedDb?: WorkflowBlockingEvidenceV1, inheritedProvider?: 'live' | 'fixture') {
    const item = record(value);
    if (!item) return;
    const db = record(item.db) as unknown as WorkflowBlockingEvidenceV1 | null ?? inheritedDb;
    const provider = item.provider === 'fixture' ? 'fixture' : inheritedProvider;
    if (typeof item.traceId === 'string' && Array.isArray(item.httpExchanges)
        && Array.isArray(item.steps) && Array.isArray(item.authorizedMessages)) {
      const evidence = item as unknown as WorkflowMetricsTurnV1;
      observations.push({ evidence: { ...evidence, providerMode: evidence.providerMode ?? provider }, ...(db ? { db } : {}) });
      return;
    }
    if (item.evidence) visit(item.evidence, db, provider);
    for (const key of ['turns', 'conversations']) {
      if (Array.isArray(item[key])) for (const child of item[key]) visit(child, db, provider);
    }
    if (Array.isArray(item.cases)) {
      for (const child of item.cases) visit(child, db, provider);
    } else {
      const cases = record(item.cases);
      if (cases) for (const child of Object.values(cases)) visit(child, db, provider);
    }
  }
  visit(report);
  return summarizeWorkflowMetricsV1(observations);
}
