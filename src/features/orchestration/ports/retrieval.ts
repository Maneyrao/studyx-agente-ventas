/**
 * Ports for the two derived, degradable retrieval sources.
 *
 * Both are advisory. Invariant 10 says a Gemini or pgvector failure must not
 * lose or duplicate an inbound, and the priority order in the memory strategy
 * puts structured data and recent messages above anything retrieved here. The
 * use case therefore treats a rejected promise as "unavailable", never as a
 * turn failure — which is only safe because these interfaces promise nothing
 * about completeness.
 */

export interface RetrievedMemory {
  readonly memory_id: string;
  readonly type: string;
  readonly key: string;
  readonly value: string;
  readonly source_quote: string;
  readonly similarity: number;
  readonly recorded_at: string;
}

export interface RetrievedKnowledge {
  readonly source_uri: string;
  readonly title: string;
  readonly content: string;
  readonly similarity: number;
}

export interface MemoryRetriever {
  /** Contact-scoped. An implementation must never widen the contact filter. */
  search(input: {
    contact_id: string;
    query: string;
    limit: number;
    min_similarity: number;
  }): Promise<RetrievedMemory[]>;
}

export interface KnowledgeRetriever {
  search(input: {
    query: string;
    limit: number;
    min_similarity: number;
  }): Promise<RetrievedKnowledge[]>;
}
