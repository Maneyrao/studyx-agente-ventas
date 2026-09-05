import { describe, expect, it, vi } from 'vitest';
import { PostgresAgentLoopRolloutReaderV3 } from '@/features/orchestration/adapters/postgres-agent-loop-rollout';
import {
  resolveAgentLoopModeV3,
  type RolloutRowV3,
} from '@/features/orchestration/domain/agent-loop-rollout';
import type { DbClient } from '@/lib/db/types';

vi.mock('@/lib/db/orchestrator', () => ({ sql: vi.fn() }));

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

  it('fails closed when the matching override is invalid despite an authoritative default', () => {
    const rows = [
      { contact_id: null, mode: 'authoritative' },
      { contact_id: CONTACT, mode: 'invalid' },
    ] as unknown as RolloutRowV3[];

    expect(resolveAgentLoopModeV3(rows, CONTACT)).toBe('off');
    expect(resolveAgentLoopModeV3([...rows].reverse(), CONTACT)).toBe('off');
  });

  it('ignores an invalid row belonging to another contact', () => {
    expect(resolveAgentLoopModeV3([
      { contact_id: OTHER, mode: 'invalid' },
      { contact_id: null, mode: 'shadow' },
    ] as unknown as RolloutRowV3[], CONTACT)).toBe('shadow');
  });
});

describe('PostgresAgentLoopRolloutReaderV3', () => {
  it('preserves an invalid applicable row so the resolver can fail closed', async () => {
    const databaseRows = [
      { contact_id: null, mode: 'authoritative' },
      { contact_id: CONTACT, mode: 'invalid' },
    ];
    const db = vi.fn().mockResolvedValue(databaseRows) as unknown as DbClient;

    const rows = await new PostgresAgentLoopRolloutReaderV3('studyx', db).load(CONTACT);

    expect(rows).toEqual(databaseRows);
    expect(resolveAgentLoopModeV3(rows, CONTACT)).toBe('off');
  });
});
