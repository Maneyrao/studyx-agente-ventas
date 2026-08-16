import { describe, expect, it } from 'vitest';

/**
 * Deterministic voice-consent policy. The model's claimed reason is never
 * trusted: the backend re-derives consent from the turn text and the open
 * offer window (15 minutes). A negation always wins over any affirmative
 * word in the same message.
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
      evaluateVoiceConsent({ text: 'Llamame ahora', now: NOW, openOffer: null }),
    ).toEqual({ allowed: true, mode: 'direct_request', offeredByDecisionId: null });
  });

  it('allows a short acceptance while the offer is open', () => {
    expect(
      evaluateVoiceConsent({ text: 'sí', now: NOW, openOffer: offerAgedMinutes(14) }),
    ).toEqual({
      allowed: true,
      mode: 'accepted_offer',
      offeredByDecisionId: OFFER_DECISION_ID,
    });
    expect(
      evaluateVoiceConsent({ text: 'Dale!', now: NOW, openOffer: offerAgedMinutes(1) }),
    ).toMatchObject({ allowed: true, mode: 'accepted_offer' });
  });

  it('refuses a short acceptance without any offer', () => {
    expect(evaluateVoiceConsent({ text: 'sí', now: NOW, openOffer: null })).toEqual({
      allowed: false,
      code: 'CALL_OFFER_MISSING',
    });
  });

  it('refuses a short acceptance once the offer expired', () => {
    expect(
      evaluateVoiceConsent({ text: 'sí', now: NOW, openOffer: offerAgedMinutes(16) }),
    ).toEqual({ allowed: false, code: 'CALL_OFFER_EXPIRED' });
  });

  it('a negation wins over any affirmative word in the same message', () => {
    expect(
      evaluateVoiceConsent({
        text: 'Sí, pero no me llames',
        now: NOW,
        openOffer: offerAgedMinutes(1),
      }),
    ).toEqual({ allowed: false, code: 'CALL_EXPLICITLY_DECLINED' });
  });

  it('treats an opt-out as an explicit decline', () => {
    expect(
      evaluateVoiceConsent({ text: 'Quiero darme de baja', now: NOW, openOffer: offerAgedMinutes(1) }),
    ).toEqual({ allowed: false, code: 'CALL_EXPLICITLY_DECLINED' });
  });

  it('anything outside the bounded patterns requires explicit confirmation', () => {
    expect(
      evaluateVoiceConsent({
        text: 'Quiero información del curso',
        now: NOW,
        openOffer: offerAgedMinutes(1),
      }),
    ).toEqual({ allowed: false, code: 'CALL_CONFIRMATION_REQUIRED' });
  });
});
