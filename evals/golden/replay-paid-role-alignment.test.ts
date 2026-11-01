import { describe, expect, it } from 'vitest';
import { replayPaidRoleAlignmentV1 } from './replay-paid-role-alignment';

describe('recorded paid-role alignment regression',()=>{
  it('replays every original attempt from the four affected turns without granting purchase or bonus effects',()=>{
    const replay=replayPaidRoleAlignmentV1();
    expect(replay.summary).toEqual({recorded_turns:4,recorded_attempts:12,baseline_paid_mismatch:12,
      replayed_paid_mismatch:0,controlled_negative_rejections:8});
    expect(replay.rows.filter(row=>row.turn==='budget')).toHaveLength(3);
    expect(replay.rows.filter(row=>row.turn==='duration_followup')).toHaveLength(3);
    expect(replay.originals_modified).toBe(false);
    expect(replay.model_calls).toBe(0);
  });
});
