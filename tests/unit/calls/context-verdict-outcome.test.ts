import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildVerdictOutcomeEvents } from '@/features/calls/domain/context-verdict-outcome';
import { CallEventSchema } from '@/lib/contracts/call-event';
import { projectCallState } from '@/features/calls/domain/call-state';

/**
 * Spec: el sandbox de Telegram no tiene Retell detrás — el único hecho que
 * cierra la llamada es el veredicto humano sobre el contexto entregado
 * (correcto/incorrecto). Este mapeo determinista es lo que le permite al
 * ledger llegar a un estado terminal para que el cron post-llamada
 * (`runPostCallFollowup`) alguna vez encuentre algo que cerrar.
 */
describe('buildVerdictOutcomeEvents', () => {
  const callId = randomUUID();
  const occurredAt = '2026-08-16T12:05:00.000Z';

  it('un veredicto "correct" produce started + ended(user_hangup), que proyecta a completed', () => {
    const events = buildVerdictOutcomeEvents({ callId, provider: 'telegram_sandbox', verdict: 'correct', occurredAt });
    expect(events).toHaveLength(2);
    for (const event of events) expect(() => CallEventSchema.parse(event)).not.toThrow();
    expect(events.map((e) => e.event_type)).toEqual(['started', 'ended']);

    const projection = projectCallState({ providerAccepted: true, cancelledAt: null, events });
    expect(projection.status).toBe('completed');
    expect(projection.analysisStatus).toBe('pending');
    expect(projection.result).toBeNull();
  });

  it('un veredicto "incorrect" produce sólo ended(failed_to_connect), que proyecta a failed', () => {
    const events = buildVerdictOutcomeEvents({ callId, provider: 'telegram_sandbox', verdict: 'incorrect', occurredAt });
    expect(events).toHaveLength(1);
    expect(() => CallEventSchema.parse(events[0])).not.toThrow();
    expect(events[0].event_type).toBe('ended');

    const projection = projectCallState({ providerAccepted: true, cancelledAt: null, events });
    expect(projection.status).toBe('failed');
  });

  it('los event_id son deterministas por call_id (idempotentes bajo reintento de Telegram)', () => {
    const first = buildVerdictOutcomeEvents({ callId, provider: 'telegram_sandbox', verdict: 'correct', occurredAt });
    const second = buildVerdictOutcomeEvents({ callId, provider: 'telegram_sandbox', verdict: 'correct', occurredAt });
    expect(first).toEqual(second);
  });
});
