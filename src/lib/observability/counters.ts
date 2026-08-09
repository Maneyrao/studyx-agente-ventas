import { logger } from './structured-log';

type CounterName =
  | 'contacts_created'
  | 'messages_registered'
  | 'semantic_searches_executed'
  | 'pending_embeddings'
  | 'ingest_processed'
  | 'ingest_long_term_memory_errors'
  | 'ingest_summary_regeneration_errors'
  | 'replies_registered'
  | 'summaries_regenerated';

// Serverless-safe counter: no in-memory state between Vercel invocations.
// Each increment emits a structured log line — verifiable in log drains / Vercel dashboard.
export const counter = {
  increment(name: CounterName, value = 1): void {
    logger.info({ event: 'counter.increment', counter: name, value });
  },
};
