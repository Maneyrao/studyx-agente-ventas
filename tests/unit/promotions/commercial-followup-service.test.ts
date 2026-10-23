import { describe, expect, it } from 'vitest';
import {
  prepareCommercialFollowupMessageV1,
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
      'Te regalo Inglés 2 junto con Inglés 1, sin cambiar el precio de Inglés 1.'))
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
      'Inglés 1 será gratis y te incluyo Inglés 2.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PRICE_CHANGED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Te regalo Inglés 1 y también Inglés 2; no tienes que pagar nada.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PRICE_CHANGED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Inglés 1 te queda gratis y te incluyo Inglés 2.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PRICE_CHANGED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Inglés 1 te sale gratis y te incluyo Inglés 2.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PRICE_CHANGED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Te incluyo Inglés 2 e Inglés 1 lo tienes gratis.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PRICE_CHANGED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Inglés 1 te lo bonifico y además te incluyo Inglés 2.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PRICE_CHANGED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Inglés 1 no se cobra, y te incluyo Inglés 2 gratis.'))
      .toEqual({ ok: false, reason: 'PROMOTION_PRICE_CHANGED' });
    expect(validateCommercialFollowupNarrativeV1(review,
      'Inglés 1 está sin cargo y te incluyo Inglés 2 gratis.'))
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

  it('renders the promotion facts in the backend and accepts only personalized reasoning', () => {
    expect(prepareCommercialFollowupMessageV1(review,
      {kind:'promotion_review',value_angle:'progression',cta:'advance',treatment:'tu'}))
      .toEqual({
        ok:true,
        message:'Pude habilitarte Inglés 2 sin costo adicional junto con Inglés 1; el precio de Inglés 1 no cambia. Así puedes empezar por la base y seguir avanzando con una formación complementaria. Si te sirve, avanzamos.',
      });
    expect(prepareCommercialFollowupMessageV1(review,
      'Inglés 1 no se cobra, y te incluyo Inglés 2 gratis.'))
      .toEqual({ok:false,reason:'PROMOTION_NARRATIVE_SHAPE_INVALID'});
    expect(prepareCommercialFollowupMessageV1(review,
      'Está sin cargo y puedes aprovechar la oportunidad.'))
      .toEqual({ok:false,reason:'PROMOTION_NARRATIVE_SHAPE_INVALID'});
    expect(prepareCommercialFollowupMessageV1(review,
      'Marketing Digital también te vendría bien.'))
      .toEqual({ok:false,reason:'PROMOTION_NARRATIVE_SHAPE_INVALID'});
    for (const bypass of [
      'El curso principal corre por nuestra cuenta.',
      'El primero va de cortesía.',
      'También te incluyo programación y diseño web.',
      'Lo consulté con administración y me dieron el visto bueno.',
      'Entra en campus-falso.com para continuar.',
    ]) {
      expect(prepareCommercialFollowupMessageV1(review, bypass))
        .toEqual({ok:false,reason:'PROMOTION_NARRATIVE_SHAPE_INVALID'});
    }
    expect(prepareCommercialFollowupMessageV1(review,
      {kind:'promotion_review',value_angle:'confidence',cta:'resolve_doubt',treatment:'vos'}))
      .toEqual({
        ok:true,
        message:'Pude habilitarte Inglés 2 sin costo adicional junto con Inglés 1; el precio de Inglés 1 no cambia. Así construís una base más completa y podés avanzar con mayor seguridad. ¿Querés que resolvamos alguna duda antes de avanzar?',
      });
  });
});
