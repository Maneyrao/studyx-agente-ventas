import { describe, expect, it } from 'vitest';
import { physicalOutboundTexts } from '../../../src/features/orchestration/domain/physical-outbound-texts';

describe('physicalOutboundTexts', () => {
  it('preserves natural model-authored bubbles within the three-part transport cap', () => {
    const authored = ['Uno.', 'Dos.', 'Tres.', 'Llamada aparte.'];

    const result = physicalOutboundTexts({
      final_response: authored.join('\n\n'),
      authored_messages: authored,
      enabled: true,
    });

    expect(result).toHaveLength(3);
    expect(result.join('\n\n')).toBe(authored.join('\n\n'));
    expect(result.at(-1)).toBe('Llamada aparte.');
  });

  it('keeps a canonical payment block last without losing model-authored copy', () => {
    const authored = ['Uno.', 'Dos.', 'Tres.'];
    const payment = '12 pagos mensuales de USD 30: https://buy.stripe.com/test';

    const result = physicalOutboundTexts({
      final_response: `${authored.join('\n\n')}\n\n${payment}`,
      authored_messages: authored,
      enabled: true,
    });

    expect(result).toHaveLength(3);
    expect(result.join('\n\n')).toBe(`${authored.join('\n\n')}\n\n${payment}`);
    expect(result.at(-1)).toBe(payment);
  });
});
