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
  | 'knowledge_sources_projected'
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
  | 'batch_context_knowledge_unavailable'
  // Memoria selectiva (fase 4). `memory_rejected` por motivo es la señal que
  // convierte "el agente inventó algo" en una métrica en vez de una anécdota.
  | 'memory_accepted'
  | 'memory_rejected'
  | 'memory_duplicate'
  | 'memory_superseded'
  | 'memory_expired'
  | 'memory_embedding_failures'
  // Catálogo y KB como herramientas de sólo lectura (fase 5).
  | 'catalog_lookups'
  | 'catalog_lookup_failures'
  | 'knowledge_injection_suspected'
  // Reconciliación (fase 7). `reconcile_deliveries_ambiguous` es la métrica que
  // hay que mirar todos los días: cada unidad es un cliente que puede haber
  // recibido o no una respuesta, y ninguna máquina va a decidirlo.
  | 'reconcile_claims_abandoned'
  | 'reconcile_claims_reclaimable'
  | 'reconcile_deliveries_ambiguous'
  | 'reconcile_resends_authorized'
  | 'reconcile_deliveries_confirmed'
  | 'reconcile_deliveries_abandoned'
  | 'reconcile_orphaned_decisions'
  | 'reconcile_failures'
  // Cierre post-llamada (spec 007). `post_call_followup_failed` es la que
  // hay que mirar: cada unidad es una llamada terminada cuyo cierre no se
  // pudo sintetizar (turno sin thread de WhatsApp resoluble), y queda
  // pendiente para la próxima corrida sin reintento inmediato.
  | 'post_call_followup_sent'
  | 'post_call_followup_revoked'
  | 'post_call_followup_skipped'
  | 'post_call_followup_failed';

// Serverless-safe counter: no in-memory state between Vercel invocations.
// Each increment emits a structured log line — verifiable in log drains / Vercel dashboard.
export const counter = {
  increment(name: CounterName, value = 1): void {
    logger.info({ event: 'counter.increment', counter: name, value });
  },
};
