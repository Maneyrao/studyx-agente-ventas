import { describe, expect, it } from 'vitest';
import { validateAgentAMemoryCandidate } from '@/features/memory/domain/agent-a-memory-candidate';

const CONTACT = '11111111-1111-4111-8111-111111111111';
const MESSAGE = '22222222-2222-4222-8222-222222222222';

function validate(input: {
  type: string;
  key: string;
  value: string;
  source_quote: string;
  confidence?: number;
}, message = input.source_quote) {
  return validateAgentAMemoryCandidate({ ...input, confidence: input.confidence ?? 0.93 }, {
    contact_id: CONTACT,
    batch_messages: [{ id: MESSAGE, content: message }],
  });
}

describe('Agent A durable memory admission', () => {
  it.each([
    ['contact_preference', 'conversation_channel', 'prefiere seguir por chat', 'Prefiere seguir por chat'],
    ['study_goal', 'employment_goal', 'busca salida laboral', 'Busca salida laboral'],
    ['study_context', 'experience_level', 'parte desde cero', 'Parte desde cero'],
  ])('accepts grounded %s evidence', (type, key, value, sourceQuote) => {
    expect(validate({ type, key, value, source_quote: sourceQuote })).toMatchObject({
      status: 'accepted',
      memory: { type, key },
    });
  });

  it.each([
    ['email', 'study_context', 'preferred_contact', 'ana@example.com', 'Mi email es ana@example.com'],
    ['phone', 'study_context', 'preferred_contact', '+54 11 4444 5555', 'Mi teléfono es +54 11 4444 5555'],
    ['payment', 'constraint', 'payment_detail', 'pago con tarjeta', 'Pago con tarjeta'],
    ['payment link', 'preference', 'reference', 'https://pay.example/link', 'Usaría https://pay.example/link'],
    ['catalog fact', 'preference', 'course_of_interest', 'redes informaticas', 'Me interesa Redes Informáticas'],
  ])('rejects %s data', (_label, type, key, value, sourceQuote) => {
    expect(validate({ type, key, value, source_quote: sourceQuote })).toMatchObject({ status: 'rejected' });
  });

  it('rejects a model-inferred quote absent from the inbound batch', () => {
    expect(validate({
      type: 'constraint', key: 'schedule', value: 'solo puede estudiar de noche',
      source_quote: 'Solo puedo estudiar de noche',
    }, 'Quiero conocer los cursos')).toMatchObject({
      status: 'rejected', reason: 'QUOTE_NOT_FOUND',
    });
  });
});
