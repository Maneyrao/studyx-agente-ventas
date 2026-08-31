import { describe, expect, it, vi } from 'vitest';

import type { DbClient } from '../../../src/lib/db/types';
import { createLocalEvalClaimCleanup } from '../../../scripts/lib/local-eval-claim-cleanup';

describe('local eval claim cleanup', () => {
  it('completes a claimed batch with the bounded failure code', async () => {
    const db = vi.fn().mockResolvedValue([{ outcome: 'completed', state: 'completed' }]);
    const cleanup = createLocalEvalClaimCleanup(db as unknown as DbClient);

    await cleanup({
      batchId: '18a823e8-27c2-4279-9956-058f45f33cd5',
      claimToken: '28a823e8-27c2-4279-9956-058f45f33cd5',
      errorCode: 'BRAIN_DEEPSEEK_HTTP_503',
    });

    expect(db).toHaveBeenCalledOnce();
  });

  it('fails closed when the batch was not completed by the expected claim', async () => {
    const db = vi.fn().mockResolvedValue([{ outcome: 'stale_claim', state: 'claimed' }]);
    const cleanup = createLocalEvalClaimCleanup(db as unknown as DbClient);

    await expect(cleanup({
      batchId: '18a823e8-27c2-4279-9956-058f45f33cd5',
      claimToken: '28a823e8-27c2-4279-9956-058f45f33cd5',
      errorCode: 'BRAIN_DEEPSEEK_HTTP_503',
    })).rejects.toThrow('LOCAL_EVAL_CLAIM_CLEANUP_FAILED');
  });
});
