import type { DbClient } from '../../src/lib/db/types';

export interface LocalEvalFailedClaim {
  readonly batchId: string;
  readonly claimToken: string;
  readonly errorCode: string;
}

export function createLocalEvalClaimCleanup(db: DbClient) {
  return async (failure: LocalEvalFailedClaim): Promise<void> => {
    const rows = await db<Array<{ outcome: string; state: string }>>`
      SELECT outcome, state
      FROM complete_inbound_batch(
        ${failure.batchId}::uuid,
        ${failure.claimToken}::uuid,
        ${failure.errorCode}
      )
    `;
    if (!rows[0] || !['completed', 'duplicate'].includes(rows[0].outcome)) {
      throw new Error('LOCAL_EVAL_CLAIM_CLEANUP_FAILED');
    }
  };
}
