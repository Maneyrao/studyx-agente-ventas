import { describe, expect, it } from 'vitest';
import {
  buildPersistedWhatsappSummary,
  deriveSharedLeadContext,
  resolveStoredVoiceProvider,
} from '@/features/calls/application/request-call';

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
