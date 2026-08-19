import { describe, expect, it } from 'vitest';
import { evaluateSendEligibility } from '@/features/messaging/domain/eligibility';
import type { ContactEligibilityFacts } from '@/features/messaging/ports/channel-identity-store';

const facts = (overrides: Partial<ContactEligibilityFacts> = {}): ContactEligibilityFacts => ({
  contactId: 'c1',
  contact_status: 'prospecto',
  lifecycle_status: 'active',
  deleted_at: null,
  consentByChannel: { whatsapp: 'granted' },
  replyWindowExpiresAt: {},
  sandboxLocked: false,
  ...overrides,
});

describe('evaluateSendEligibility', () => {
  it('allows a consenting, active contact', () => {
    expect(evaluateSendEligibility(facts())).toEqual({ allowed: true, reason: null });
  });

  // Migration 20260808010001 makes this a hard lock on real side effects. It is
  // checked before anything else so a lab contact cannot reach a provider even
  // if every other fact looks fine.
  it('refuses a sandbox contact before any other consideration', () => {
    const result = evaluateSendEligibility(facts({ sandboxLocked: true }));
    expect(result).toEqual({ allowed: false, reason: 'SANDBOX_LOCKED' });
  });

  it('refuses a sandbox contact even when consent is granted and status is active', () => {
    expect(evaluateSendEligibility(facts({
      sandboxLocked: true, consentByChannel: { whatsapp: 'granted' }, lifecycle_status: 'active',
    })).allowed).toBe(false);
  });

  it('refuses a blocked contact', () => {
    expect(evaluateSendEligibility(facts({ lifecycle_status: 'blocked' })))
      .toEqual({ allowed: false, reason: 'CONTACT_BLOCKED' });
  });

  it('refuses a soft-deleted contact', () => {
    expect(evaluateSendEligibility(facts({ deleted_at: '2026-01-01T00:00:00Z' })).allowed).toBe(false);
  });

  it('refuses an inactive contact', () => {
    expect(evaluateSendEligibility(facts({ contact_status: 'inactivo' })).allowed).toBe(false);
  });

  it('refuses when consent was revoked', () => {
    expect(evaluateSendEligibility(facts({ consentByChannel: { whatsapp: 'revoked' } })))
      .toEqual({ allowed: false, reason: 'CONSENT_REVOKED' });
  });

  // Revoking on one channel is a refusal to be contacted, not a routing hint.
  it('refuses when consent was revoked on any channel', () => {
    expect(evaluateSendEligibility(facts({
      consentByChannel: { whatsapp: 'granted', telegram: 'revoked' },
    })).allowed).toBe(false);
  });
});
