import { describe, expect, it } from 'vitest';
import {
  validateCommercialFollowupNarrativeV1,
} from '@/features/promotions/application/commercial-followup-service';

describe('commercial course-bonus follow-up content', () => {
  const review = {
    kind: 'promotion_review' as const,
    paid_offering_name: 'Inglés 1',
    bonus_offerings: [{ code: 'ingles_2', display_name: 'Inglés 2', position: 1 }],
    all_offering_names: ['Inglés 1', 'Inglés 2', 'Marketing Digital'],
  };

  it('requires the exact authorized gift and preserves the paid price', () => {
    expect(validateCommercialFollowupNarrativeV1(review,
      'Pude habilitarte Inglés 2 junto con Inglés 1, sin cambiar el precio de Inglés 1. Así puedes avanzar desde la base y seguir con el siguiente nivel.'))
      .toEqual({ ok: true });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Pude habilitarte Inglés 2 gratis junto con Inglés 1; el precio de Inglés 1 no cambia.'))
      .toEqual({ ok: true });

    expect(validateCommercialFollowupNarrativeV1(review,
      'Te conseguí una promoción especial para que avances con inglés.'))
      .toEqual({ ok: false, reason: 'PROMOTION_BONUS_NOT_NAMED' });
  });

  it('rejects discounts, invented courses, URLs and fake approvals', () => {
    expect(validateCommercialFollowupNarrativeV1(review,
      'Te bajo el precio y te regalo Marketing Digital.'))
      .toMatchObject({ ok: false });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Lucas me autorizó Inglés 2 para ti.'))
      .toEqual({ ok: false, reason: 'PROMOTION_FAKE_APPROVAL' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Mira https://example.com y te sumo Inglés 2.'))
      .toEqual({ ok: false, reason: 'PROMOTION_URL_NOT_ALLOWED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Te habilito Inglés 1 con Inglés 2 por USD 10 en total.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PRICE_CHANGED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Puedes llevar Inglés 1 e Inglés 2 pagando diez dólares al mes.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PRICE_CHANGED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Te incluyo Inglés 2 con Inglés 1 y pagás veinticinco al mes.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PRICE_CHANGED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Te incluyo Inglés 2 con Inglés 1 y pagás diecinueve al año.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PRICE_CHANGED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Te incluyo Inglés 2 con Inglés 1 a mitad de precio.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PRICE_CHANGED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Pude incluir Inglés 2 junto con Inglés 1 pagando un solo curso.'))
      .toEqual({ ok: true });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Pude incluir Inglés 2 junto con Inglés 1 por el precio de un solo curso.'))
      .toEqual({ ok: true });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Te dejo Inglés 1 e Inglés 2 por veinte en total.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PRICE_CHANGED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Te doy Inglés 1 e Inglés 2, ambos gratis.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PRICE_CHANGED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Te incluyo Inglés 2 con Inglés 1 y pagás 10 al año.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PRICE_CHANGED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Te habilito Inglés 1 junto con Inglés 2 y no hay descuento: el precio no cambia.'))
      .toEqual({ ok: true });
  });

  it('keeps the first-objection check-in free of gift disclosure', () => {
    const checkin = { ...review, kind: 'price_objection_checkin' as const };
    expect(validateCommercialFollowupNarrativeV1(checkin,
      'Pensándolo por lo que quieres lograr, Inglés 1 te da una base práctica para empezar. Si quieres, vemos juntos si te encaja.'))
      .toEqual({ ok: true });
    expect(validateCommercialFollowupNarrativeV1(checkin,
      'También puedo sumarte Inglés 2 gratis.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PREMATURE_DISCLOSURE' });
  });
});
