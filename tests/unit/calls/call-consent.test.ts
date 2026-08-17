import { describe, expect, it } from 'vitest';

/**
 * Deterministic voice-consent policy. The model's claimed reason is never
 * trusted: the backend re-derives consent from every inbound text of the
 * batch and the open offer window (15 minutes). The newest decisive message
 * wins, and a negation always beats any affirmative word.
 */
import { evaluateVoiceConsent } from '@/features/calls/domain/call-consent';

const NOW = '2026-08-16T12:00:00.000Z';
const OFFER_DECISION_ID = '9c858901-8a57-4791-81fe-4c483003b3c2';

function offerAgedMinutes(minutes: number) {
  return {
    decisionId: OFFER_DECISION_ID,
    offeredAt: new Date(Date.parse(NOW) - minutes * 60_000).toISOString(),
  };
}

describe('evaluateVoiceConsent', () => {
  it('allows a direct request on its own, without any offer', () => {
    expect(
      evaluateVoiceConsent({ texts: ['Llamame ahora'], now: NOW, openOffer: null }),
    ).toEqual({ allowed: true, mode: 'direct_request', offeredByDecisionId: null, sourceIndex: 0 });
  });

  it('allows a short acceptance while the offer is open', () => {
    expect(
      evaluateVoiceConsent({ texts: ['sí'], now: NOW, openOffer: offerAgedMinutes(14) }),
    ).toEqual({
      allowed: true,
      mode: 'accepted_offer',
      offeredByDecisionId: OFFER_DECISION_ID,
      sourceIndex: 0,
    });
    expect(
      evaluateVoiceConsent({ texts: ['Dale!'], now: NOW, openOffer: offerAgedMinutes(1) }),
    ).toMatchObject({ allowed: true, mode: 'accepted_offer' });
  });

  it('refuses a short acceptance without any offer', () => {
    expect(evaluateVoiceConsent({ texts: ['sí'], now: NOW, openOffer: null })).toEqual({
      allowed: false,
      code: 'CALL_OFFER_MISSING',
    });
  });

  it('refuses a short acceptance once the offer expired', () => {
    expect(
      evaluateVoiceConsent({ texts: ['sí'], now: NOW, openOffer: offerAgedMinutes(16) }),
    ).toEqual({ allowed: false, code: 'CALL_OFFER_EXPIRED' });
  });

  it('a negation wins over any affirmative word in the same message', () => {
    expect(
      evaluateVoiceConsent({
        texts: ['Sí, pero no me llames'],
        now: NOW,
        openOffer: offerAgedMinutes(1),
      }),
    ).toEqual({ allowed: false, code: 'CALL_EXPLICITLY_DECLINED' });
  });

  it('treats an opt-out as an explicit decline', () => {
    expect(
      evaluateVoiceConsent({ texts: ['Quiero darme de baja'], now: NOW, openOffer: offerAgedMinutes(1) }),
    ).toEqual({ allowed: false, code: 'CALL_EXPLICITLY_DECLINED' });
  });

  it('a direct request buried mid-batch authorizes, and points at its message', () => {
    expect(
      evaluateVoiceConsent({
        texts: ['¿Es en vivo?', 'llamame y lo vemos', 'gracias!'],
        now: NOW,
        openOffer: null,
      }),
    ).toEqual({ allowed: true, mode: 'direct_request', offeredByDecisionId: null, sourceIndex: 1 });
  });

  it('the newest decisive message wins: a request followed by a decline is refused', () => {
    expect(
      evaluateVoiceConsent({
        texts: ['llamame', 'no, mejor no me llames'],
        now: NOW,
        openOffer: null,
      }),
    ).toEqual({ allowed: false, code: 'CALL_EXPLICITLY_DECLINED' });
  });

  it('an empty batch requires explicit confirmation', () => {
    expect(
      evaluateVoiceConsent({ texts: [], now: NOW, openOffer: offerAgedMinutes(1) }),
    ).toEqual({ allowed: false, code: 'CALL_CONFIRMATION_REQUIRED' });
  });

  it('anything outside the bounded patterns requires explicit confirmation', () => {
    expect(
      evaluateVoiceConsent({
        texts: ['Quiero información del curso'],
        now: NOW,
        openOffer: offerAgedMinutes(1),
      }),
    ).toEqual({ allowed: false, code: 'CALL_CONFIRMATION_REQUIRED' });
  });
});
