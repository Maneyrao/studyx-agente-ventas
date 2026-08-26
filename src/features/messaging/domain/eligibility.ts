import { evaluateTurnPolicy, type TurnPolicyFacts } from '@/features/orchestration/domain/turn-policy';
import type { ContactEligibilityFacts } from '../ports/channel-identity-store';

/**
 * May we write to this contact at all?
 *
 * This *composes* `evaluateTurnPolicy` rather than restating it. That policy's
 * own header records that the blocking rule once lived in two places, and that
 * the duplication let a blocked contact be answered through one path while the
 * other suppressed them. A second copy here would rebuild the same defect: a
 * contact could be refused a reply and still receive an outbound message.
 *
 * What this adds is the dimension the turn policy has no reason to know about:
 * the synthetic-contact lock.
 */

export type SendRefusalReason =
  | 'SANDBOX_LOCKED'
  | 'CONTACT_BLOCKED'
  | 'CONSENT_REVOKED';

export interface SendEligibility {
  allowed: boolean;
  reason: SendRefusalReason | null;
}

export function evaluateSendEligibility(facts: ContactEligibilityFacts): SendEligibility {
  // Checked first, and before any provider is contacted. Migration
  // 20260808010001 makes a row in `sandbox_identities` a hard lock on real
  // calls, charges and production messages. A new delivery path that skipped it
  // would quietly re-enable the side effect that lock exists to prevent.
  if (facts.sandboxLocked) {
    return { allowed: false, reason: 'SANDBOX_LOCKED' };
  }

  // Consent is per channel, but refusal is not: a contact who revoked anywhere
  // is not someone to reach through a side door.
  const consentValues = Object.values(facts.consentByChannel);
  const revokedAnywhere = consentValues.includes('revoked');

  const policyFacts: TurnPolicyFacts = {
    contact_status: facts.contact_status,
    lifecycle_status: facts.lifecycle_status,
    deleted_at: facts.deleted_at,
    consent_status: revokedAnywhere ? 'revoked' : 'granted',
    // Neither applies to a system-initiated send: there is no inbound turn.
    explicit_opt_out: false,
    unsupported_message: false,
  };

  const policy = evaluateTurnPolicy(policyFacts);
  if (policy.blocked) return { allowed: false, reason: 'CONTACT_BLOCKED' };
  if (!policy.may_respond) {
    return {
      allowed: false,
      reason: policy.reason === 'CONSENT_REVOKED' ? 'CONSENT_REVOKED' : 'CONTACT_BLOCKED',
    };
  }
  return { allowed: true, reason: null };
}
