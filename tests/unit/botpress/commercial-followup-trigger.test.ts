import { describe, expect, it } from 'vitest';
import {
  buildCommercialFollowupInstructions,
  CommercialFollowupClaimSchema,
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
    expect(instructions).toContain('backend redactará todo el mensaje final');
    expect(instructions).toContain('value_angle');
    expect(instructions).toContain('No redactes texto libre');
    expect(instructions).toContain('objetivo');
    expect(instructions).not.toContain('Lucas');
  });

  it('has a deterministic safe fallback that never discounts', () => {
    const fallback = fallbackCommercialFollowupNarrative(claim);
    expect(fallback).toEqual({
      kind:'promotion_review',value_angle:'progression',cta:'advance',treatment:'tu',
    });
  });

  it('accepts a check-in without gift names but requires gifts for a promotion review', () => {
    const base = {
      claimed: true as const,
      claim_token: '6ef90556-91a8-4df0-8e18-72bb98643be1',
      academy_name: 'Studyx',
      customer_first_name: 'Ana',
      paid_offering_name: 'Inglés 1',
      customer_goal: null,
      history: [],
    };
    expect(CommercialFollowupClaimSchema.safeParse({
      ...base,
      kind: 'price_objection_checkin',
      bonus_offerings: [],
    }).success).toBe(true);
    expect(CommercialFollowupClaimSchema.safeParse({
      ...base,
      kind: 'promotion_review',
      bonus_offerings: [],
    }).success).toBe(false);
  });
});
