import {
  CONTACT_INTAKE_FIELDS_V1,
  type ContactIntakeFieldV1,
  type ContactIntakeV1,
} from '@/features/conversation/domain/conversation-planner';
import { isCallablePhoneE164V1 } from '@/lib/heuristics/contact-identity';

export type CallIntakeRequirementReasonV1 =
  | 'missing'
  | 'written_whatsapp_confirmation_required';

export interface CallIntakeRequirementV1 {
  readonly field: ContactIntakeFieldV1;
  readonly reason: CallIntakeRequirementReasonV1;
}

export interface CallIntakeEvidenceV1 {
  readonly direction: 'inbound' | 'outbound';
  readonly message_type: string | null;
  readonly channel: string;
}

export interface CallIntakeReadinessV1 {
  readonly status: 'ready' | 'needs_input' | 'unknown';
  readonly intake: ContactIntakeV1;
  readonly requirements: readonly CallIntakeRequirementV1[];
}

export function callIntakeRejectionReasonV1(
  readiness: CallIntakeReadinessV1,
): 'CALL_INTAKE_UNKNOWN' | 'CALL_INTAKE_INCOMPLETE'
  | 'CALL_EMAIL_WHATSAPP_CONFIRMATION_REQUIRED' | null {
  if (readiness.status === 'unknown') return 'CALL_INTAKE_UNKNOWN';
  if (readiness.status === 'ready') return null;
  if (readiness.requirements.some(({ reason }) => (
    reason === 'written_whatsapp_confirmation_required'
  ))) return 'CALL_EMAIL_WHATSAPP_CONFIRMATION_REQUIRED';
  return 'CALL_INTAKE_INCOMPLETE';
}

export function unknownCallIntakeReadinessV1(intake: ContactIntakeV1): CallIntakeReadinessV1 {
  return { status: 'unknown', intake, requirements: [] };
}

export function evaluateCallIntakeReadinessV1(input: {
  readonly intake: ContactIntakeV1;
  readonly email_evidence: CallIntakeEvidenceV1 | null;
}): CallIntakeReadinessV1 {
  const requirements: CallIntakeRequirementV1[] = [];

  for (const field of CONTACT_INTAKE_FIELDS_V1) {
    const value = input.intake[field]?.trim() ?? '';
    const present = field === 'telefono' ? isCallablePhoneE164V1(value) : value.length > 0;
    if (!present) requirements.push({ field, reason: 'missing' });
  }

  if (input.intake.correo?.trim() && !requirements.some(({ field }) => field === 'correo')) {
    const evidence = input.email_evidence;
    const writtenOnWhatsapp = evidence?.direction === 'inbound'
      && evidence.message_type === 'text'
      && evidence.channel === 'whatsapp';
    if (!writtenOnWhatsapp) {
      requirements.push({ field: 'correo', reason: 'written_whatsapp_confirmation_required' });
    }
  }

  return {
    status: requirements.length === 0 ? 'ready' : 'needs_input',
    intake: input.intake,
    requirements,
  };
}
