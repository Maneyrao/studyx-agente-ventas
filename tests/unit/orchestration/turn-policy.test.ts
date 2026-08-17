import { describe, expect, it } from 'vitest';
import {
  evaluateTurnPolicy,
  isContactBlocked,
  type TurnPolicyFacts,
} from '@/features/orchestration/domain/turn-policy';

function facts(overrides: Partial<TurnPolicyFacts> = {}): TurnPolicyFacts {
  return {
    contact_status: 'prospecto',
    lifecycle_status: 'active',
    deleted_at: null,
    consent_status: 'unknown',
    explicit_opt_out: false,
    unsupported_message: false,
    ...overrides,
  };
}

describe('evaluateTurnPolicy', () => {
  it('permits the full conversational surface for an ordinary prospect', () => {
    const policy = evaluateTurnPolicy(facts());

    expect(policy.may_respond).toBe(true);
    expect(policy.reason).toBeNull();
    expect(policy.allowed_response_types).toContain('commercial_reply');
    expect(policy.allowed_response_types).toContain('automation_only');
  });

  it('never allows an opt-out acknowledgement without an actual opt-out', () => {
    expect(evaluateTurnPolicy(facts()).allowed_response_types).not.toContain('opt_out_ack');
  });

  it.each([
    ['inactive status', { contact_status: 'inactivo' as const }],
    ['blocked lifecycle', { lifecycle_status: 'blocked' as const }],
    ['deleted lifecycle', { lifecycle_status: 'deleted' as const }],
    ['soft deletion', { deleted_at: '2026-08-01T00:00:00.000Z' }],
  ])('refuses every response for a blocked contact (%s)', (_label, override) => {
    const policy = evaluateTurnPolicy(facts(override));

    expect(policy.may_respond).toBe(false);
    expect(policy.allowed_response_types).toEqual([]);
    expect(policy.reason).toBe('CONTACT_BLOCKED');
    expect(policy.blocked).toBe(true);
  });

  it('refuses every response once consent is revoked', () => {
    const policy = evaluateTurnPolicy(facts({ consent_status: 'revoked' }));

    expect(policy.may_respond).toBe(false);
    expect(policy.allowed_response_types).toEqual([]);
    expect(policy.reason).toBe('CONSENT_REVOKED');
  });

  it('allows only the acknowledgement on an explicit opt-out', () => {
    const policy = evaluateTurnPolicy(facts({ explicit_opt_out: true, consent_status: 'revoked' }));

    expect(policy.may_respond).toBe(true);
    expect(policy.allowed_response_types).toEqual(['opt_out_ack']);
    expect(policy.reason).toBe('EXPLICIT_OPT_OUT_ACK_ONLY');
  });

  it('acknowledges an opt-out even from a blocked contact, and nothing else', () => {
    const policy = evaluateTurnPolicy(
      facts({ explicit_opt_out: true, contact_status: 'inactivo' })
    );

    expect(policy.allowed_response_types).toEqual(['opt_out_ack']);
    expect(policy.blocked).toBe(true);
  });

  it('narrows an unreadable message to out-of-scope handling', () => {
    const policy = evaluateTurnPolicy(facts({ unsupported_message: true }));

    expect(policy.may_respond).toBe(true);
    expect(policy.reason).toBe('UNSUPPORTED_MESSAGE_TYPE');
    expect(policy.allowed_response_types).toEqual(['out_of_scope', 'technical_fallback']);
    expect(policy.allowed_response_types).not.toContain('commercial_reply');
  });

  it('lets blocking win over an unreadable message', () => {
    const policy = evaluateTurnPolicy(
      facts({ unsupported_message: true, lifecycle_status: 'blocked' })
    );

    expect(policy.may_respond).toBe(false);
    expect(policy.reason).toBe('CONTACT_BLOCKED');
  });

  it('hands back a fresh array so a caller cannot widen the policy in place', () => {
    const first = evaluateTurnPolicy(facts());
    first.allowed_response_types.push('opt_out_ack');

    expect(evaluateTurnPolicy(facts()).allowed_response_types).not.toContain('opt_out_ack');
  });
});

describe('isContactBlocked', () => {
  it('treats an active prospect as reachable', () => {
    expect(isContactBlocked(facts())).toBe(false);
  });

  it('treats a null lifecycle as reachable rather than guessing', () => {
    expect(isContactBlocked(facts({ lifecycle_status: null }))).toBe(false);
  });
});
