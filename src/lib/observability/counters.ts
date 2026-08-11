import { logger } from './structured-log';

type CounterName =
  | 'contacts_created'
  | 'messages_registered'
  | 'semantic_searches_executed'
  | 'pending_embeddings'
  | 'ingest_processed'
  | 'ingest_long_term_memory_errors'
  | 'ingest_summary_regeneration_errors'
  | 'ingest_knowledge_base_errors'
  | 'knowledge_base_searches_executed'
  | 'knowledge_base_documents_ingested'
  | 'replies_registered'
  | 'summaries_regenerated'
  // Batching. `absorbed` is the load-shedding signal: a high ratio against
  // `claimed` means bursts are collapsing as intended, while a high
  // `waiting` ratio means workflows are waking before their window is due.
  | 'batch_claim_claimed'
  | 'batch_claim_waiting'
  | 'batch_claim_absorbed'
  | 'batch_claim_completed'
  | 'batch_claim_abandoned'
  | 'batch_claim_not_found'
  | 'batch_claim_stolen'
  | 'batch_context_memory_unavailable'
  | 'batch_context_knowledge_unavailable';

// Serverless-safe counter: no in-memory state between Vercel invocations.
// Each increment emits a structured log line — verifiable in log drains / Vercel dashboard.
export const counter = {
  increment(name: CounterName, value = 1): void {
    logger.info({ event: 'counter.increment', counter: name, value });
  },
};
