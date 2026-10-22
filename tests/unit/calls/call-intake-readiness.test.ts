import { describe, expect, it } from 'vitest';
import {
  evaluateCallIntakeReadinessV1,
  callIntakeRejectionReasonV1,
  type CallIntakeEvidenceV1,
} from '@/features/calls/domain/call-intake-readiness';

const completeIntake = {
  nombre: 'Gabriel',
  apellido: 'Vásquez',
  correo: 'gabriel@example.com',
  telefono: '+13473566170',
};

function writtenWhatsappEmail(): CallIntakeEvidenceV1 {
  return { direction: 'inbound', message_type: 'text', channel: 'whatsapp' };
}

describe('evaluateCallIntakeReadinessV1', () => {
  it('requires all four durable fields before a call', () => {
    const result = evaluateCallIntakeReadinessV1({
      intake: { ...completeIntake, apellido: null, correo: null },
      email_evidence: null,
    });

    expect(result).toEqual({
      status: 'needs_input',
      intake: { ...completeIntake, apellido: null, correo: null },
      requirements: [
        { field: 'apellido', reason: 'missing' },
        { field: 'correo', reason: 'missing' },
      ],
    });
  });

  it('distinguishes a known voice email from a missing email', () => {
    expect(evaluateCallIntakeReadinessV1({
      intake: completeIntake,
      email_evidence: null,
    })).toMatchObject({
      status: 'needs_input',
      requirements: [{ field: 'correo', reason: 'written_whatsapp_confirmation_required' }],
    });
  });

  it.each([
    { direction: 'inbound', message_type: null, channel: 'whatsapp' },
    { direction: 'inbound', message_type: 'audio', channel: 'whatsapp' },
    { direction: 'inbound', message_type: 'text', channel: 'telegram' },
    { direction: 'outbound', message_type: 'text', channel: 'whatsapp' },
  ] as const)('does not accept $message_type from $channel as written WhatsApp proof', (email_evidence) => {
    expect(evaluateCallIntakeReadinessV1({ intake: completeIntake, email_evidence })).toMatchObject({
      status: 'needs_input',
      requirements: [{ field: 'correo', reason: 'written_whatsapp_confirmation_required' }],
    });
  });

  it('is ready only with inbound WhatsApp text evidence for the persisted email', () => {
    expect(evaluateCallIntakeReadinessV1({
      intake: completeIntake,
      email_evidence: writtenWhatsappEmail(),
    })).toEqual({ status: 'ready', intake: completeIntake, requirements: [] });
  });

  it('maps durable readiness to explicit final-reservation rejection codes', () => {
    expect(callIntakeRejectionReasonV1({
      status: 'needs_input',
      intake: completeIntake,
      requirements: [{ field: 'correo', reason: 'written_whatsapp_confirmation_required' }],
    })).toBe('CALL_EMAIL_WHATSAPP_CONFIRMATION_REQUIRED');
    expect(callIntakeRejectionReasonV1({
      status: 'needs_input',
      intake: { ...completeIntake, apellido: null },
      requirements: [{ field: 'apellido', reason: 'missing' }],
    })).toBe('CALL_INTAKE_INCOMPLETE');
    expect(callIntakeRejectionReasonV1({
      status: 'unknown', intake: completeIntake, requirements: [],
    })).toBe('CALL_INTAKE_UNKNOWN');
    expect(callIntakeRejectionReasonV1({
      status: 'ready', intake: completeIntake, requirements: [],
    })).toBeNull();
  });
});
