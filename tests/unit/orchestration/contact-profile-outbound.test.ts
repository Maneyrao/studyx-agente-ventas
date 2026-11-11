import { describe, expect, it } from 'vitest';
import { contactProfileRequestsForPartsV1 } from '@/features/orchestration/domain/physical-outbound-texts';

describe('durable profile questions follow physical messages', () => {
  const request = { message_index: 1, fields: ['nombre'] as const, purpose: 'identity' as const, mode: 'collect' as const };
  it('keeps a name question in a merged middle part despite a later call offer', () => {
    expect(contactProfileRequestsForPartsV1({ authored_messages: ['Curso', '¿Tu nombre?', 'Más información', '¿Te llamo?'],
      part_texts: ['Curso', '¿Tu nombre?\n\nMás información', '¿Te llamo?'], requests: [request] }))
      .toEqual([[], [{ fields: ['nombre'], purpose: 'identity', mode: 'collect' }], []]);
  });
  it('drops metadata when a guard removed or rewrote the question', () => {
    expect(contactProfileRequestsForPartsV1({ authored_messages: ['Curso', '¿Tu nombre?'],
      part_texts: ['Curso'], requests: [request] })).toEqual([[]]);
    expect(contactProfileRequestsForPartsV1({ authored_messages: ['Curso', '¿Tu nombre?'],
      part_texts: ['Necesito otros datos'], requests: [request] })).toEqual([[]]);
  });
  it('does not tag a mere substring or duplicate ambiguous physical copy', () => {
    expect(contactProfileRequestsForPartsV1({ authored_messages: ['Curso', '¿Tu nombre?'],
      part_texts: ['Dice: ¿Tu nombre?', '¿Tu nombre? repetido'], requests: [request] })).toEqual([[], []]);
  });
  it('tags the last paragraph of an authored message that was split into bubbles', () => {
    expect(contactProfileRequestsForPartsV1({ authored_messages: ['Curso', 'Te ayudo con eso.\n¿Tu nombre?'],
      part_texts: ['Curso', 'Te ayudo con eso.', '¿Tu nombre?'], requests: [request] }))
      .toEqual([[], [], [{ fields: ['nombre'], purpose: 'identity', mode: 'collect' }]]);
  });
});
