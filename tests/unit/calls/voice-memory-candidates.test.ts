import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseVoiceMemoryCandidates } from '@/features/calls/domain/voice-memory-candidates';

const contactId = randomUUID();

function payload(candidates: unknown[]): string {
  return JSON.stringify({ schema_version: 1, candidates });
}

describe('parseVoiceMemoryCandidates', () => {
  it('accepts grounded qualitative memory and derives canonical storage fields', () => {
    expect(parseVoiceMemoryCandidates({
      raw: payload([{
        type: 'study_goal',
        key: 'motivation',
        value: 'conseguir trabajo remoto',
        source_quote: 'Quiero conseguir trabajo remoto',
        confidence: 0.92,
      }]),
      transcript: 'Agente: ¿Qué buscás?\nCliente: Quiero conseguir trabajo remoto.',
      contactId,
    })).toEqual([expect.objectContaining({
      type: 'study_goal',
      key: 'motivation',
      value: 'conseguir trabajo remoto',
      source_quote: 'Quiero conseguir trabajo remoto',
      confidence: 0.92,
      ttl_days: 365,
      dedupe_hash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    })]);
  });

  it('drops only an invalid candidate while retaining a valid sibling', () => {
    const parsed = parseVoiceMemoryCandidates({
      raw: payload([
        {
          type: 'preference',
          key: 'horario',
          value: 'cursar de noche',
          source_quote: 'Prefiero cursar de noche',
          confidence: 0.9,
        },
        {
          type: 'preference',
          key: 'payment_plan',
          value: 'pagar en 12 cuotas',
          source_quote: 'Quiero pagar en 12 cuotas',
          confidence: 0.99,
        },
      ]),
      transcript: 'Cliente: Prefiero cursar de noche. Quiero pagar en 12 cuotas.',
      contactId,
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ key: 'horario', value: 'cursar de noche' });
  });

  it.each([
    ['invalid JSON', '{'],
    ['wrong envelope version', JSON.stringify({ schema_version: 2, candidates: [] })],
    ['missing transcript evidence', payload([{
      type: 'constraint', key: 'tiempo', value: 'solo fines de semana',
      source_quote: 'Solo puedo los fines de semana', confidence: 0.9,
    }])],
  ])('returns no memories for %s without throwing', (_label, raw) => {
    expect(() => parseVoiceMemoryCandidates({
      raw,
      transcript: 'La conversación no contiene esa frase.',
      contactId,
    })).not.toThrow();
    expect(parseVoiceMemoryCandidates({
      raw,
      transcript: 'La conversación no contiene esa frase.',
      contactId,
    })).toEqual([]);
  });
});
