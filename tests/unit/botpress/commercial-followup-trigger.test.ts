import { describe, expect, it } from 'vitest';
import {
  buildCommercialFollowupInstructions,
  fallbackCommercialFollowupNarrative,
} from '../../../botpress-agent/src/utils/commercial-followup-instructions';

describe('commercial follow-up Agent A instructions', () => {
  const claim = {
    kind: 'promotion_review' as const,
    academy_name: 'Studyx',
    customer_first_name: 'Ana',
    paid_offering_name: 'Inglés 1',
    bonus_offerings: [{ code: 'ingles_2', display_name: 'Inglés 2', position: 1 }],
    customer_goal: 'poder estudiar y trabajar con más seguridad',
    history: [],
  };

  it('keeps Lisandro personality while making the authorized offer concrete', () => {
    const instructions = buildCommercialFollowupInstructions('PERSONALIDAD CANÓNICA', claim);
    expect(instructions).toContain('PERSONALIDAD CANÓNICA');
    expect(instructions).toContain('Inglés 1');
    expect(instructions).toContain('Inglés 2');
    expect(instructions).toContain('no cambia');
    expect(instructions).toContain('objetivo');
    expect(instructions).not.toContain('Lucas');
  });

  it('has a deterministic safe fallback that never discounts', () => {
    const fallback = fallbackCommercialFollowupNarrative(claim);
    expect(fallback.message).toContain('Inglés 2');
    expect(fallback.message).toContain('Inglés 1');
    expect(fallback.message).toContain('no cambia');
    expect(fallback.message).not.toMatch(/descuento|rebaja/iu);
  });
});
