import { describe, expect, it } from 'vitest';
import { physicalOutboundTexts } from '../../../src/features/orchestration/domain/physical-outbound-texts';

describe('physicalOutboundTexts', () => {
  it('delivers every model-authored part in one physical message', () => {
    const authored = ['Uno.', 'Dos.', 'Tres.', 'Llamada aparte.'];

    const result = physicalOutboundTexts({
      final_response: authored.join('\n\n'),
      authored_messages: authored,
      enabled: true,
    });

    expect(result).toEqual([authored.join('\n\n')]);
  });

  it('keeps a canonical payment block in the same physical message without losing copy', () => {
    const authored = ['Uno.', 'Dos.', 'Tres.'];
    const payment = '12 pagos mensuales de USD 30: https://buy.stripe.com/test';

    const result = physicalOutboundTexts({
      final_response: `${authored.join('\n\n')}\n\n${payment}`,
      authored_messages: authored,
      enabled: true,
    });

    expect(result).toEqual([`${authored.join('\n\n')}\n\n${payment}`]);
  });
});
