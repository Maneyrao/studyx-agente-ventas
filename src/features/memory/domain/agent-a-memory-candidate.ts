import {
  evaluateMemoryCandidate,
  type MemoryCandidateInput,
  type MemoryEvaluation,
  type MemorySelectionContext,
} from '@/features/orchestration/domain/memory-selection';

export type AgentAMemoryCandidateV1 = MemoryCandidateInput;
export type AgentAMemoryCandidateEvaluationV1 = MemoryEvaluation;

const URL_PATTERN = /https?:\/\//iu;
const PAYMENT_PATTERN =
  /[$€£]\s*\d|\d+(?:[.,]\d{2,3})?\s*\b(?:usd|u\$s|ars|d[oó]lares?|pesos)\b|\b(?:usd|u\$s|ars)\b\s*\d+/iu;

export function isAgentAMemoryCandidateProhibited(candidate: AgentAMemoryCandidateV1): boolean {
  const evidence = `${candidate.value} ${candidate.source_quote}`;
  return URL_PATTERN.test(evidence) || PAYMENT_PATTERN.test(evidence);
}

/**
 * Agent A may suggest memories, but the existing backend admission policy is
 * the only authority that can make one durable. Keeping this adapter tiny
 * prevents the conversational brain from gaining a second, weaker rule set.
 */
export function validateAgentAMemoryCandidate(
  candidate: AgentAMemoryCandidateV1,
  context: MemorySelectionContext,
): AgentAMemoryCandidateEvaluationV1 {
  if (isAgentAMemoryCandidateProhibited(candidate)) {
    return { status: 'rejected', reason: 'SENSITIVE_DATA' };
  }
  return evaluateMemoryCandidate(candidate, context);
}
