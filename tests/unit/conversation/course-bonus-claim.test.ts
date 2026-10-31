import { describe, expect, it } from 'vitest';
import { inspectCourseBonusClaimsV1 } from '@/shared/conversation/course-bonus-claim';

const CATALOG = [
  'Fotografía Profesional',
  'Fotografía con Celulares para Tiendas Online',
  'Marketing Digital',
  'Community Manager',
  'Inglés I',
  'Inglés II',
  'AutoCAD',
  'AutoCAD orientado al Diseño de Interiores',
] as const;

function inspect(content: string, input?: {
  readonly authorized?: readonly string[];
  readonly paid?: readonly string[];
}) {
  return inspectCourseBonusClaimsV1({
    content,
    authorized_bonus_names: input?.authorized ?? [],
    known_offering_names: CATALOG,
    paid_offering_names: input?.paid ?? [],
  });
}

describe('course bonus claim structural authorization', () => {
  it.each([
    'Marketing Digital sin costo.',
    'Marketing Digital incluido.',
    'Marketing Digital bonificado.',
  ])('accepts an exact catalog course already present in the capability: %s', (content) => {
    expect(inspect(content, { authorized: ['Marketing Digital'] })).toEqual({
      has_authorized_claim: true,
      has_unauthorized_claim: false,
    });
  });

  it('accepts the delivered package plus the one proposed course authorized for this turn', () => {
    expect(inspect(
      'Marketing Digital sigue incluido. Community Manager queda bonificado.',
      { authorized: ['Marketing Digital', 'Community Manager'] },
    )).toEqual({
      has_authorized_claim: true,
      has_unauthorized_claim: false,
    });
  });

  it('rejects a catalog course when no bonus effect authorizes it', () => {
    expect(inspect('Community Manager bonificado.')).toEqual({
      has_authorized_claim: false,
      has_unauthorized_claim: true,
    });
  });

  it.each([
    'Marketing Digital bonificado y Community Manager incluido.',
    'Marketing Digital sin costo junto con Community Manager.',
  ])('rejects every extra catalog course in the same marked segment: %s', (content) => {
    expect(inspect(content, { authorized: ['Marketing Digital'] })).toEqual({
      has_authorized_claim: true,
      has_unauthorized_claim: true,
    });
  });

  it('allows another catalog course to be discussed outside the marked segment', () => {
    expect(inspect(
      'Marketing Digital está incluido. Community Manager lo podés contratar más adelante.',
      { authorized: ['Marketing Digital'] },
    )).toEqual({
      has_authorized_claim: true,
      has_unauthorized_claim: false,
    });
  });

  it('keeps WhatsApp message boundaries separate before whitespace normalization', () => {
    expect(inspect(
      'Marketing Digital está incluido\nCommunity Manager lo podés contratar más adelante',
      { authorized: ['Marketing Digital'] },
    )).toEqual({
      has_authorized_claim: true,
      has_unauthorized_claim: false,
    });
  });

  it('does not let an authorized course on the next line legitimize a paid course marked as free', () => {
    expect(inspect(
      'Fotografía Profesional queda sin costo\nMarketing Digital está incluido',
      { authorized: ['Marketing Digital'], paid: ['Fotografía Profesional'] },
    )).toEqual({
      has_authorized_claim: true,
      has_unauthorized_claim: true,
    });
  });

  it('allows a package recap containing the paid course and an authorized bonus', () => {
    expect(inspect(
      'Fotografía Profesional y Marketing Digital están incluidos en tu paquete.',
      { authorized: ['Marketing Digital'], paid: ['Fotografía Profesional'] },
    )).toEqual({
      has_authorized_claim: true,
      has_unauthorized_claim: false,
    });
  });

  it('rejects the paid course when it is the only course described as free or included', () => {
    expect(inspect(
      'Fotografía Profesional queda incluida sin costo.',
      { authorized: ['Marketing Digital'], paid: ['Fotografía Profesional'] },
    )).toEqual({
      has_authorized_claim: false,
      has_unauthorized_claim: true,
    });
  });

  it('rejects a bonus delivered by an older cycle when it is absent from the current capability', () => {
    expect(inspect('Marketing Digital sigue bonificado.', { authorized: ['Community Manager'] })).toEqual({
      has_authorized_claim: false,
      has_unauthorized_claim: true,
    });
  });

  it('matches overlapping catalog names by their complete canonical identity', () => {
    expect(inspect('Inglés II queda incluido.', { authorized: ['Inglés II'] })).toEqual({
      has_authorized_claim: true,
      has_unauthorized_claim: false,
    });
  });

  it('prefers the longest exact canonical identity when one course name contains another', () => {
    expect(inspect(
      'AutoCAD orientado al Diseño de Interiores queda incluido.',
      { authorized: ['AutoCAD orientado al Diseño de Interiores'] },
    )).toEqual({
      has_authorized_claim: true,
      has_unauthorized_claim: false,
    });
  });

  it('does not convert an unaccented alias into a canonical catalog identity', () => {
    expect(inspect('Ingles II queda incluido.', { authorized: ['Inglés II'] })).toEqual({
      has_authorized_claim: false,
      has_unauthorized_claim: false,
    });
  });

  it('keeps a long canonical course name containing para intact', () => {
    expect(inspect(
      'Fotografía con Celulares para Tiendas Online queda bonificado; te ayuda con tu catálogo.',
      { authorized: ['Fotografía con Celulares para Tiendas Online'] },
    )).toEqual({
      has_authorized_claim: true,
      has_unauthorized_claim: false,
    });
  });

  it.each([
    'Te llevás también Marketing Digital.',
    'Marketing Digital complementa muy bien Fotografía Profesional.',
    'Marketing Digital gratis.',
  ])('does not infer a bonus effect outside the three structural markers: %s', (content) => {
    expect(inspect(content, { authorized: ['Marketing Digital'] })).toEqual({
      has_authorized_claim: false,
      has_unauthorized_claim: false,
    });
  });
});
