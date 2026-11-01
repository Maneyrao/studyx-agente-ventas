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
  /** Present only when this document was resolved by a canonical offering code. */
  readonly offering_code?: string;
}

/**
 * The application owns query embedding because one customer query is one
 * retrieval operation, even when several derived indexes consume it. Keeping
 * this port inward prevents either PostgreSQL adapter from making a second
 * provider call behind the use case's back.
 */
export interface QueryEmbedder {
  embed(query: string): Promise<readonly number[]>;
}

export interface MemoryRetriever {
  /** Contact-scoped. An implementation must never widen the contact filter. */
  search(input: {
    contact_id: string;
    embedding: readonly number[];
    limit: number;
    min_similarity: number;
  }): Promise<RetrievedMemory[]>;
}

export interface KnowledgeRetriever {
  search(input: {
    embedding: readonly number[];
    limit: number;
    min_similarity: number;
  }): Promise<RetrievedKnowledge[]>;
  /**
   * Canonical course lookup for an explicit plan/temario request. Unlike the
   * semantic search, this cannot miss the source because of phrasing or an
   * embedding threshold; the backend-owned offering code is the filter.
   */
  searchByOfferingCode?(input: {
    offering_code: string;
    limit: number;
  }): Promise<RetrievedKnowledge[]>;
}
