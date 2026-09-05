export interface IntegrityViolationV3 {
  readonly code: string;
  readonly subject: string;
  readonly detail?: string;
}

/** Structured orchestrator feedback that can be persisted without a cast. */
export interface IntegrityRejectionV1 {
  readonly rejection_id: string;
  readonly attempt: 1;
  readonly violations: readonly IntegrityViolationV3[];
  readonly authorized_alternatives: {
    readonly fact_ids: readonly string[];
    readonly preparations: readonly string[];
    readonly missing_information: readonly string[];
  };
}
