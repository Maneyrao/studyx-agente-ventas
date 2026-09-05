export interface MemoryV1 {
  readonly id: string;
  readonly text: string;
  readonly type: string;
}

export interface MemoryCandidateV3 {
  readonly text: string;
  readonly type: string;
  readonly supersedes: readonly string[];
}

export interface MemoryStore {
  relevant(input: { readonly conversation_id: string }): Promise<readonly MemoryV1[]>;
}
