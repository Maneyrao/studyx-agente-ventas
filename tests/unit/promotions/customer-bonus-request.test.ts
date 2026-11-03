import { describe, expect, it } from 'vitest';
import { customerBonusRequestV1 } from '@/features/promotions/domain/customer-bonus-request';

const offerings = [
  { code: 'ingles_1', display_name: 'Inglés 1' }, { code: 'ingles_2', display_name: 'Inglés 2' },
  { code: 'ingles_3', display_name: 'Inglés 3' },
  { code: 'armado_reparacion_pc', display_name: 'Armado y Reparación de PC' },
  { code: 'reparacion_celulares', display_name: 'Reparación de Celulares' },
];
const previous = ['Tenemos varias áreas: oficios como Armado y Reparación de PC, diseño y más.'];
const request = (text: string, offered = ['ingles_2'], max = 3) => customerBonusRequestV1({
  batch_texts: [text], offerings, paid_offering_code: 'ingles_1', offered_bonus_codes: offered, max_bonus_courses: max,
  previous_agent_messages: previous });

describe('customerBonusRequestV1 (owner 2026-11-03, live 07:38/07:41)', () => {
  it('reads the live "me bonificas uno de los dos" as adding the named course', () => {
    expect(request('y si yo tengo el curso de ingles 1 y armado y reparacion de pc, me bonificas uno de los dos?'))
      .toEqual({ kind: 'add', bonus_offering_code: 'armado_reparacion_pc' });
    expect(request('y si yo tengo el curso de ingles 1 y reparacion de pc, me bonificas uno de losd os?'))
      .toEqual({ kind: 'add', bonus_offering_code: 'armado_reparacion_pc' });
  });
  it('reads the live "cambiar ingles 2 por reparacion de pc" as a swap of the only bonus', () => {
    expect(request('osea no puedo cambiar ingles 2 por reparacion de pcs?'))
      .toEqual({ kind: 'swap', replaced_offering_code: 'ingles_2', bonus_offering_code: 'armado_reparacion_pc' });
  });
  it('a first choice with no package yet is an add', () => {
    expect(request('me regalas armado y reparacion de pc?', [])).toEqual({ kind: 'add', bonus_offering_code: 'armado_reparacion_pc' });
  });
  it.each([
    ['naming the paid course in a swap is a course change', 'en vez de ingles 1 quiero armado y reparacion de pc'],
    ['no gift or swap verb', 'que tal es armado y reparacion de pc?'],
    ['refusal', 'no quiero que me sumes armado y reparacion de pc'],
    ['two candidate courses', 'me bonificas armado y reparacion de pc o reparacion de celulares?'],
    ['only the paid or gifted course', 'me bonificas ingles 2?'],
  ])('null: %s', (_label, text) => expect(request(text)).toBeNull());
  it('no swap with two gifts; no add at the limit', () => {
    expect(request('cambiame ingles 2 por armado y reparacion de pc', ['ingles_2', 'ingles_3'])).toBeNull();
    expect(request('me sumas armado y reparacion de pc?', ['ingles_2', 'ingles_3', 'reparacion_celulares'], 3)).toBeNull();
  });
});
