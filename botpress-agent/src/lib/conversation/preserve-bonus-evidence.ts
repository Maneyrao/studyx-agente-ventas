import type { AgentATurnProposalV1 } from '../../schemas/agent-a-brain'
import { declineQuoteInBatchV1, priceObservationQuoteInBatchV1, PURCHASE_DECLINE_MEMORY_KEY } from '../../../../src/shared/conversation/deterministic-sales-rules'

/** Preserve only the literal model evidence the backend revalidates for the
 * bonus permission (price objection, price-only barrier, purchase decline)
 * across a bounded rewrite. The rewrite may change prose, never erase the
 * memory that backs an effect the model already proposed. */
export function preserveRuleTriggerEvidenceV1(original: AgentATurnProposalV1,
  rewritten: AgentATurnProposalV1, batch: readonly string[]): AgentATurnProposalV1 {
  const evidence = original.memory_candidates.filter(candidate => (
    candidate.type === 'objection' && candidate.key === 'price_objection'
      && priceObservationQuoteInBatchV1(candidate.source_quote, batch)
    || candidate.type === 'constraint' && candidate.key === 'price_only_barrier'
      && priceObservationQuoteInBatchV1(candidate.source_quote, batch)
    || candidate.type === 'objection' && candidate.key === PURCHASE_DECLINE_MEMORY_KEY
      && declineQuoteInBatchV1(candidate.source_quote, batch)
  ))
  const key = (candidate: AgentATurnProposalV1['memory_candidates'][number]) =>
    JSON.stringify([candidate.type, candidate.key, candidate.value, candidate.source_quote])
  const originalKeys = new Set(evidence.map(key))
  return { ...rewritten, memory_candidates: [...evidence,
    ...rewritten.memory_candidates.filter(candidate => !originalKeys.has(key(candidate)))].slice(0, 10) }
}
