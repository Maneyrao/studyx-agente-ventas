import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '@/lib/db/types';

const { loadCallIntakeReadiness } = vi.hoisted(() => ({
  loadCallIntakeReadiness: vi.fn(),
}));

vi.mock('@/lib/repositories/call-intake-readiness.repository', () => ({
  loadCallIntakeReadinessV1: loadCallIntakeReadiness,
}));

import {
  buildLeadMemoryHandoff,
  buildPersistedWhatsappSummary,
  deriveSharedLeadContext,
  inferCallCountryFromPhoneE164,
  resolveStoredVoiceProvider,
  reserveCallForDecision,
} from '@/features/calls/application/request-call';

describe('buildLeadMemoryHandoff', () => {
  it('uses independent canonical compound names instead of re-splitting the display name', () => {
    expect(deriveSharedLeadContext({ contactName: 'Luz María del Sol van der Velde', contactEmail: 'luz@example.test',
      courseOfInterest: 'Fotografía', contactIntake: { nombre: 'Luz María del Sol', apellido: 'van der Velde', correo: 'luz@example.test', telefono: '+15551234567' } }))
      .toMatchObject({ nombreLead: 'Luz María del Sol van der Velde', apellidoLead: 'van der Velde', missingFields: [] });
  });

  it('renders qualitative facts once, without quotes or commercial state', () => {
    expect(buildLeadMemoryHandoff([
      { memory_type: 'study_goal', memory_key: 'motivation', value_normalized: 'conseguir trabajo remoto' },
      { memory_type: 'preference', memory_key: 'horario', value_normalized: 'cursar de noche' },
      { memory_type: 'preference', memory_key: 'horario', value_normalized: 'cursar de noche' },
    ])).toBe([
      '- Objetivo: conseguir trabajo remoto',
      '- Preferencia (horario): cursar de noche',
    ].join('\n'));
  });

  it('keeps the handoff within the 1,500-character transport limit', () => {
    const result = buildLeadMemoryHandoff(Array.from({ length: 10 }, (_, index) => ({
      memory_type: 'study_context',
      memory_key: `contexto_${index}`,
      value_normalized: `detalle ${index} ${'largo '.repeat(90)}`,
    })));
    expect(result.length).toBeLessThanOrEqual(1_500);
  });
});

describe('inferCallCountryFromPhoneE164', () => {
  it('materializes Argentina from the verified E.164 country calling code', () => {
    expect(inferCallCountryFromPhoneE164('+5491112345678')).toBe('Argentina');
  });

  it('leaves an unknown calling code unresolved instead of inventing a country', () => {
    expect(inferCallCountryFromPhoneE164('+12025550123')).toBe('');
  });
});

describe('deriveSharedLeadContext', () => {
  it('hands Agent B the same known lead values and only the four missing shared fields', () => {
    expect(deriveSharedLeadContext({
      contactName: 'Ana Pérez',
      contactEmail: null,
      courseOfInterest: 'reparacion_celulares',
    })).toEqual({
      nombreLead: 'Ana Pérez',
      apellidoLead: 'Pérez',
      emailLead: '',
      courseOfInterest: 'reparacion_celulares',
      missingFields: ['mail'],
    });
  });

  it('marks a one-word identity as missing only its surname', () => {
    expect(deriveSharedLeadContext({
      contactName: 'Ana',
      contactEmail: 'ana@example.test',
      courseOfInterest: 'python',
    }).missingFields).toEqual(['apellido']);
  });
});

describe('buildPersistedWhatsappSummary', () => {
  it('uses persisted conversational context plus the current lead words', () => {
    expect(buildPersistedWhatsappSummary({
      persistedSummary: 'Ana consultó por Python. Quiere cambiar de trabajo.',
      consentMessages: [
        { id: 'one', content: '¿Me pueden contar sobre las cuotas?' },
        { id: 'two', content: 'Sí, llamame ahora.' },
      ],
    })).toBe(
      'Ana consultó por Python. Quiere cambiar de trabajo. '
      + '¿Me pueden contar sobre las cuotas? Sí, llamame ahora.',
    );
  });

  it('deduplicates sentences and keeps at most six within the transport limit', () => {
    const summary = buildPersistedWhatsappSummary({
      persistedSummary: 'Uno. Dos. Tres. Cuatro. Cinco. Seis. Siete.',
      consentMessages: [
        { id: 'one', content: 'Siete.' },
        { id: 'two', content: `Ocho ${'largo '.repeat(300)}` },
      ],
    });
    expect(summary.match(/[.!?](?:\s|$)/gu)).toHaveLength(6);
    expect(summary.length).toBeLessThanOrEqual(1_200);
    expect(summary).not.toContain('Siete');
  });

  it('normalizes control characters without inventing context', () => {
    expect(buildPersistedWhatsappSummary({
      persistedSummary: null,
      consentMessages: [{ id: 'one', content: 'Llamame\n\u0000ahora' }],
    })).toBe('Llamame ahora');
  });
});

describe('resolveStoredVoiceProvider', () => {
  it('records Retell when Xendra is only the dispatch gateway', () => {
    expect(resolveStoredVoiceProvider('xendra')).toBe('retell');
  });

  it('preserves both existing provider identities', () => {
    expect(resolveStoredVoiceProvider('retell')).toBe('retell');
    expect(resolveStoredVoiceProvider('telegram_sandbox')).toBe('telegram_sandbox');
  });

  it('fails closed for unsupported configuration', () => {
    expect(() => resolveStoredVoiceProvider('unknown')).toThrow('VOICE_PROVIDER_INVALID');
  });
});

describe('reserveCallForDecision intake gate', () => {
  it('rejects a call before any ledger query when the email is not written in WhatsApp', async () => {
    loadCallIntakeReadiness.mockResolvedValueOnce({
      status: 'needs_input',
      intake: { nombre: 'Ana', apellido: 'Pérez', correo: 'ana@example.test', telefono: '+5491112345678' },
      requirements: [{ field: 'correo', reason: 'written_whatsapp_confirmation_required' }],
    });
    const unexpectedDb = (() => {
      throw new Error('ledger must not be queried before durable intake is ready');
    }) as unknown as DbClient;

    await expect(reserveCallForDecision(unexpectedDb, {
      turn_id: '10000000-0000-4000-8000-000000000001',
      trace_id: '10000000-0000-4000-8000-000000000002',
      decision_id: '10000000-0000-4000-8000-000000000003',
      contact_id: '10000000-0000-4000-8000-000000000004',
      conversation_id: '10000000-0000-4000-8000-000000000005',
      contact_name: 'Dato viejo',
      contact_email: 'viejo@example.test',
      phone: '+5491199999999',
      consent_messages: [{ id: '10000000-0000-4000-8000-000000000006', content: 'Llamame ahora' }],
      course_of_interest: 'marketing_digital',
      prompt_version: 'test-v1',
    })).rejects.toMatchObject({ reason: 'CALL_EMAIL_WHATSAPP_CONFIRMATION_REQUIRED' });
    expect(loadCallIntakeReadiness).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000005',
      unexpectedDb,
      { forUpdate: true },
    );
  });
});
