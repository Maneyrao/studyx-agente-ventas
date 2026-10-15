import { sql } from '@/lib/db/orchestrator';
import type { DbClient } from '@/lib/db/types';
interface RecoveryOutcome {
  outcome: 'scheduled' | 'exhausted' | 'superseded' | 'not_owner' | 'already_decided';
  attempt: number;
  delay_ms: number;
}
export async function scheduleRejectedTurnRecovery(input: {
  batchId: string; claimToken: string; reasonCode: string; workspaceSlug: string;
}, db: DbClient = sql): Promise<RecoveryOutcome> {
  const [result] = await db<RecoveryOutcome[]>`
    SELECT * FROM schedule_inbound_batch_recovery(${input.batchId}::uuid,
      ${input.claimToken}::uuid, ${input.reasonCode}, ${input.workspaceSlug})
  `;
  if (!result) throw new Error('RECOVERY_RESULT_MISSING');
  return result;
}
