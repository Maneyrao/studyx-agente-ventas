import { describe, expect, it } from 'vitest';
import { decidePostCallFollowup } from '@/features/calls/domain/post-call-followup';

const base = { analysisStatus: 'completed' as const, paymentVerified: false };

describe('post-call followup verdicts (spec 007)', () => {
  it('never emits a message for a cancelled call', () => {
    expect(decidePostCallFollowup({ status: 'cancelled', result: null, ...base })).toEqual({
      action: 'skip',
      reason: 'CALL_CANCELLED',
    });
  });

  it('offers a retry, never an auto-redial, for no_answer/timed_out/failed', () => {
    for (const status of ['no_answer', 'timed_out', 'failed'] as const) {
      const verdict = decidePostCallFollowup({ status, result: null, ...base });
      expect(verdict.action).toBe('send');
    }
  });

  it('does not act on a call that has not reached a terminal state', () => {
    for (const status of ['requested', 'dispatching', 'provider_accepted', 'dispatch_ambiguous', 'in_progress'] as const) {
      expect(decidePostCallFollowup({ status, result: null, ...base })).toEqual({
        action: 'skip',
        reason: 'CALL_NOT_TERMINAL',
      });
    }
  });

  it('sends a neutral continuity message when analysis is unavailable, never claims a result', () => {
    const pending = decidePostCallFollowup({
      status: 'completed', result: null, analysisStatus: 'pending', paymentVerified: false,
    });
    const failed = decidePostCallFollowup({
      status: 'completed', result: null, analysisStatus: 'failed', paymentVerified: false,
    });
    expect(pending).toEqual({ action: 'send', content: expect.any(String), reason: 'ANALYSIS_UNAVAILABLE' });
    expect(failed).toEqual({ action: 'send', content: expect.any(String), reason: 'ANALYSIS_UNAVAILABLE' });
  });

  it('gates venta_confirmada on verified payment: no proof, no sale claim', () => {
    const unverified = decidePostCallFollowup({
      status: 'completed', result: 'venta_confirmada', analysisStatus: 'completed', paymentVerified: false,
    });
    const verified = decidePostCallFollowup({
      status: 'completed', result: 'venta_confirmada', analysisStatus: 'completed', paymentVerified: true,
    });
    expect(unverified.reason).toBe('SALE_CLAIMED_PAYMENT_UNVERIFIED');
    expect(verified.reason).toBe('SALE_CONFIRMED_PAYMENT_VERIFIED');
    expect(unverified.action).toBe('send');
    expect(verified.action).toBe('send');
  });

  it('routes no_contactar to revocation, not a message', () => {
    const verdict = decidePostCallFollowup({
      status: 'completed', result: 'no_contactar', ...base,
    });
    expect(verdict).toEqual({ action: 'revoke_contact', reason: 'DO_NOT_CONTACT' });
  });

  it('keeps human handoff disabled: derivado_humano gets a neutral close, no transfer promise', () => {
    const verdict = decidePostCallFollowup({
      status: 'completed', result: 'derivado_humano', ...base,
    });
    expect(verdict.action).toBe('send');
    expect(verdict.reason).toBe('HUMAN_HANDOFF_REQUESTED_DISABLED');
  });

  it('covers every neutral no-claim result without throwing', () => {
    for (const result of ['ya_es_alumno', 'no_calificado', 'no_es_buen_momento'] as const) {
      const verdict = decidePostCallFollowup({ status: 'completed', result, ...base });
      expect(verdict.action).toBe('send');
      expect(verdict.reason).toBe(`NEUTRAL_${result.toUpperCase()}`);
    }
  });

  it('offers a retry for voicemail without claiming a sale or payment', () => {
    expect(decidePostCallFollowup({ status: 'completed', result: 'buzon_de_voz', ...base })).toEqual({
      action: 'send',
      content: expect.any(String),
      reason: 'VOICEMAIL_OUTCOME',
    });
  });

  it('closes safely when the person ended the call without claiming a sale or payment', () => {
    expect(decidePostCallFollowup({ status: 'completed', result: 'corto_la_llamada', ...base })).toEqual({
      action: 'send',
      content: expect.any(String),
      reason: 'CALL_ENDED_BY_CONTACT',
    });
  });

  it('is a pure function of its inputs: same call, same verdict, every time', () => {
    const input = { status: 'completed' as const, result: 'seguimiento_agendado' as const, ...base };
    const first = decidePostCallFollowup(input);
    const second = decidePostCallFollowup(input);
    expect(first).toEqual(second);
  });
});
