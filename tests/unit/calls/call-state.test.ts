import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CallEvent } from '@/lib/contracts/call-event';
import { projectCallState } from '@/features/calls/domain/call-state';

const callId = randomUUID();
const at = '2026-08-16T12:00:00.000Z';

function event(type: 'started' | 'ended' | 'analyzed'): CallEvent {
  const base = { schema_version: 1 as const, call_id: callId, provider: 'telegram_sandbox' as const, occurred_at: at };
  if (type === 'started') return { ...base, event_id: 'started:1', event_type: type, sequence: 1, payload: { event_type: type, started_at: at } };
  if (type === 'ended') return { ...base, event_id: 'ended:1', event_type: type, sequence: 2, payload: { event_type: type, ended_at: at, duration_seconds: 10, disconnection_reason: 'agent_hangup' } };
  return { ...base, event_id: 'analyzed:1', event_type: type, sequence: 3, payload: { event_type: type, analysis: { result: 'venta_confirmada', nivel_interes: 'alto', objecion: null, notas: null } } };
}

function permutations<T>(items: T[]): T[][] {
  if (items.length < 2) return [items];
  return items.flatMap((item, index) => permutations(items.filter((_, candidate) => candidate !== index)).map((rest) => [item, ...rest]));
}

describe('call state projection', () => {
  it('projects every started/ended/analyzed arrival order identically', () => {
    const results = permutations([event('started'), event('ended'), event('analyzed')])
      .map((events) => projectCallState({ providerAccepted: true, cancelledAt: null, events }));
    expect(new Set(results.map((result) => JSON.stringify(result)))).toEqual(new Set([JSON.stringify({
      status: 'completed', analysisStatus: 'completed', result: 'venta_confirmada',
    })]));
  });

  it('does not let a late started event overwrite a terminal no-answer result', () => {
    const ended = event('ended');
    ended.payload = { event_type: 'ended', ended_at: at, duration_seconds: 0, disconnection_reason: 'no_answer' };
    expect(projectCallState({ providerAccepted: true, cancelledAt: null, events: [ended, event('started')] }).status).toBe('no_answer');
  });

  it('keeps technical and analysis status orthogonal', () => {
    expect(projectCallState({ providerAccepted: true, cancelledAt: null, events: [event('analyzed')] })).toEqual({
      status: 'provider_accepted', analysisStatus: 'completed', result: 'venta_confirmada',
    });
  });
});
