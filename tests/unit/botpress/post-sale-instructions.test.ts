import { describe, expect, it } from 'vitest';
import { buildPostSaleInstructions, fallbackPostSaleNarrative, PostSaleClaimSchema } from '../../../botpress-agent/src/utils/post-sale-instructions';

const canonicalPrompt = 'Personalidad canónica de la asesora.';
const claim = { claimed: true, claim_token: '15357952-de34-498c-a877-7e19a8c9d266', kind: 'access_ready',
  academy_name: 'Studyx', offering_name: 'Curso Prueba', customer_first_name: 'Ana',
  existing_user: false, new_user: true, history: [] };

describe('post-sale mode contract — owner exception 2026-11-01', () => {
  it('preserves an explicit deterministic mode for partial access claims', () => {
    expect(PostSaleClaimSchema.parse({ ...claim, kind: 'access_delayed', delivery_mode: 'access_template' }))
      .toMatchObject({ claimed: true, delivery_mode: 'access_template' });
    expect(() => PostSaleClaimSchema.parse({ ...claim, delivery_mode: 'arbitrary' })).toThrow();
  });
  it.each([
    { kind: 'access_ready' as const },
    { kind: 'access_delayed' as const, delivery_mode: 'access_template' as const },
  ])('never constructs model instructions or narrative fallbacks for $kind template', (input) => {
    expect(() => buildPostSaleInstructions(canonicalPrompt, input)).toThrow('POST_SALE_TEMPLATE_REQUIRED');
    expect(() => fallbackPostSaleNarrative(input)).toThrow('POST_SALE_TEMPLATE_REQUIRED');
  });
  it.each(['payment_received', 'access_delayed'] as const)('keeps Agent A prose for %s without verified access', kind => {
    const parsed = PostSaleClaimSchema.parse({ ...claim, kind, delivery_mode: 'agent_narrative' });
    if (!parsed.claimed) throw new Error('Expected a claimed notification');
    const instructions = buildPostSaleInstructions(canonicalPrompt, parsed);
    expect(instructions.startsWith(`${canonicalPrompt}\n\n`)).toBe(true);
    expect(instructions).toContain('Tú, Agente A, redactas');
    expect(instructions).toContain('el acceso todavía no está confirmado');
    expect(instructions).not.toContain('dale una bienvenida');
    expect(instructions).not.toContain('access_ready: confirma');
    expect(fallbackPostSaleNarrative(parsed).suggestion).toBe('');
  });
});
