import { describe, expect, it } from 'vitest';
import {
  resolveAgentLoopModeV3,
  type RolloutRowV3,
} from '@/features/orchestration/domain/agent-loop-rollout';

const CONTACT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

describe('resolveAgentLoopModeV3', () => {
  it('defaults to off when no row matches', () => {
    expect(resolveAgentLoopModeV3([], CONTACT)).toBe('off');
  });

  it('uses the workspace default when there is no contact override', () => {
    expect(resolveAgentLoopModeV3([{ contact_id: null, mode: 'shadow' }], CONTACT))
      .toBe('shadow');
  });

  it('lets the matching contact override the workspace default regardless of row order', () => {
    const rows: RolloutRowV3[] = [
      { contact_id: CONTACT, mode: 'authoritative' },
      { contact_id: null, mode: 'off' },
    ];
    expect(resolveAgentLoopModeV3(rows, CONTACT)).toBe('authoritative');
    expect(resolveAgentLoopModeV3([...rows].reverse(), CONTACT)).toBe('authoritative');
  });

  it('ignores rows for another contact', () => {
    expect(resolveAgentLoopModeV3([{ contact_id: OTHER, mode: 'authoritative' }], CONTACT))
      .toBe('off');
  });

  it('fails closed when an unvalidated row carries an unknown mode', () => {
    expect(resolveAgentLoopModeV3([
      { contact_id: CONTACT, mode: 'invalid' },
    ] as unknown as RolloutRowV3[], CONTACT)).toBe('off');
  });
});
