import { describe, expect, it } from 'vitest';
import {
  BONUS_AFFINITY_TABLE_V1, authorizedBonusCodesV1, courseCodesNamedInBatchV1, declineQuoteInBatchV1,
  draftConfirmsPriceOnlyBarrierV1, draftDeclinesPurchaseV1, draftRecordsPriceObjectionV1, isBonusCheckoutStateV1,
  isCheckoutV1, priceObservationQuoteInBatchV1, type RuleDraftV1,
} from '@/shared/conversation/deterministic-sales-rules';

const catalog = [
  { code: 'introduccion_ecommerce', display_name: 'Introducción al Ecommerce' },
  { code: 'fotografia_celulares_tiendas_online', display_name: 'Fotografía con Celulares para Tiendas Online' },
  { code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales' },
  { code: 'instagram_emprendedores', display_name: 'Instagram para Emprendedores' },
  { code: 'estrategias_emprender', display_name: 'Estrategias para Emprender' },
  { code: 'marketing_digital', display_name: 'Marketing Digital' },
  { code: 'ingles_3', display_name: 'Inglés 3' },
  { code: 'oratoria', display_name: 'Oratoria' },
];
const active = catalog.map(course => course.code);

const draft = (memory: RuleDraftV1['memory_candidates'], overrides: Partial<RuleDraftV1> = {}): RuleDraftV1 => ({
  response: { messages: ['Dale.'], call_offer: null }, proposed_action: { type: 'none' },
  move: { move: 'ask_course_information', secondary_moves: [] }, memory_candidates: memory, ...overrides,
});

describe('afinidad como pertenencia a un conjunto', () => {
  it('une «Combinalo con», rutas, la fila del curso pago, los puentes universales y los nombrados, sólo activos', () => {
    const set = authorizedBonusCodesV1({ paid_code: 'introduccion_ecommerce', active_codes: active });
    expect(new Set(set)).toEqual(new Set(['fotografia_celulares_tiendas_online', 'publicidad_redes_sociales', 'instagram_emprendedores', 'estrategias_emprender']));
    expect(authorizedBonusCodesV1({ paid_code: 'ingles_3', active_codes: active })).not.toContain('publicidad_redes_sociales');
    expect(authorizedBonusCodesV1({ paid_code: 'ingles_3', active_codes: active, named_codes: ['oratoria'] })).toContain('oratoria');
  });
  it('Marketing Digital admite Community Manager, Publicidad en Redes, Photoshop y E-commerce; rechaza lo ajeno salvo nombrado', () => {
    const all = [...active, 'community_manager', 'diseno_photoshop', 'sushi_principiantes', 'barista'];
    const set = authorizedBonusCodesV1({ paid_code: 'marketing_digital', active_codes: all });
    for (const code of ['community_manager', 'publicidad_redes_sociales', 'diseno_photoshop', 'introduccion_ecommerce']) expect(set).toContain(code);
    expect(set).not.toContain('sushi_principiantes');
    expect(authorizedBonusCodesV1({ paid_code: 'marketing_digital', active_codes: all, named_codes: ['sushi_principiantes'] })).toContain('sushi_principiantes');
  });
  it('un curso inactivo, p. ej. Barista, nunca se autoriza', () => {
    expect(authorizedBonusCodesV1({ paid_code: 'marketing_digital', active_codes: active, named_codes: ['barista'] })).not.toContain('barista');
    expect(authorizedBonusCodesV1({ paid_code: 'estrategias_emprender', active_codes: active })).not.toContain('barista');
  });
  it('nunca incluye el curso pago, uno inactivo ni repetidos', () => {
    const set = authorizedBonusCodesV1({ paid_code: 'introduccion_ecommerce', active_codes: active, named_codes: ['introduccion_ecommerce', 'curso_inexistente', 'oratoria', 'oratoria'] });
    expect(set).not.toContain('introduccion_ecommerce');
    expect(set).not.toContain('curso_inexistente');
    expect(set.filter(code => code === 'oratoria')).toHaveLength(1);
  });
  it('la tabla no contiene el curso pago ni repetidos en su fila', () => {
    for (const [paid, list] of Object.entries(BONUS_AFFINITY_TABLE_V1)) {
      expect(list).not.toContain(paid);
      expect(new Set(list).size).toBe(list.length);
    }
  });
  it('un curso nombrado se reconoce por su nombre exacto del catálogo en el lote', () => {
    expect(courseCodesNamedInBatchV1(['Y me bonificás Oratoria?'], catalog)).toEqual(['oratoria']);
    expect(courseCodesNamedInBatchV1(['quiero marketing'], catalog)).toEqual([]);
    expect(courseCodesNamedInBatchV1(['Marketing Digital no, mejor INGLÉS 3'], catalog)).toEqual(['marketing_digital', 'ingles_3']);
  });
});

describe('evidencia de precio citada', () => {
  const batch = ['me sigue pareciendo caro'];
  it('la memoria del modelo cuenta sólo con una cita literal del lote', () => {
    expect(draftRecordsPriceObjectionV1(draft([{ type: 'objection', key: 'price_objection', value: 'caro', source_quote: 'caro' }]), batch)).toBe(true);
    expect(draftRecordsPriceObjectionV1(draft([{ type: 'objection', key: 'price_objection', value: 'caro', source_quote: 'es carísimo' }]), batch)).toBe(false);
  });
  it('preguntas y negaciones nunca son una objeción aunque el modelo las cite', () => {
    expect(priceObservationQuoteInBatchV1('caro', ['es caro?'])).toBe(false);
    expect(priceObservationQuoteInBatchV1('me parezca caro', ['Es caro? Te pregunto, no estoy diciendo que me parezca caro.'])).toBe(false);
  });
  it('el precio como único freno confirmado también es evidencia', () => {
    expect(draftConfirmsPriceOnlyBarrierV1(draft([{ type: 'constraint', key: 'price_only_barrier', value: 'confirmed', source_quote: 'solo el precio' }]), ['es sólo el precio'])).toBe(false);
    expect(draftConfirmsPriceOnlyBarrierV1(draft([{ type: 'constraint', key: 'price_only_barrier', value: 'confirmed', source_quote: 'solo el precio' }]), ['es solo el precio'])).toBe(true);
    expect(draftConfirmsPriceOnlyBarrierV1(draft([{ type: 'constraint', key: 'price_only_barrier', value: 'other_barriers_reported', source_quote: 'solo el precio' }]), ['es solo el precio'])).toBe(false);
  });
  it('sin ninguna palabra clave del cliente no hay evidencia: sólo la memoria del modelo habilita', () => {
    expect(draftRecordsPriceObjectionV1(draft([]), ['no me alcanza, es muy caro'])).toBe(false);
  });
});

describe('rechazo de compra declarado por el modelo (retención)', () => {
  it('requiere la memoria objection/purchase_decline con una cita literal del lote', () => {
    const ok = draft([{ type: 'objection', key: 'purchase_decline', value: 'no', source_quote: 'no gracias, lo dejo' }]);
    expect(draftDeclinesPurchaseV1(ok, ['no gracias, lo dejo'])).toBe(true);
    expect(draftDeclinesPurchaseV1(ok, ['quizás más adelante'])).toBe(false);
    expect(draftDeclinesPurchaseV1(draft([]), ['no gracias, lo dejo'])).toBe(false);
  });
  it('la cita vacía o inventada no cuenta; un «no» sin declarar tampoco', () => {
    expect(declineQuoteInBatchV1('  ', ['no'])).toBe(false);
    expect(declineQuoteInBatchV1('no, paso', ['no'])).toBe(false);
  });
});

describe('checkout por estado', () => {
  const idle = { stage: 'course_selected', awaiting_reply: 'none', payment_link_request_pending: false };
  it('es checkout sólo por estado: link enviado, cerrado, traspaso, pedido de link o datos/plan/confirmación pendientes', () => {
    expect(isBonusCheckoutStateV1(idle)).toBe(false);
    for (const stage of ['payment_link_sent', 'closed', 'handoff']) expect(isBonusCheckoutStateV1({ ...idle, stage })).toBe(true);
    for (const awaiting_reply of ['payment_plan', 'payment_confirmation', 'contact_details']) expect(isBonusCheckoutStateV1({ ...idle, awaiting_reply })).toBe(true);
    expect(isBonusCheckoutStateV1({ ...idle, payment_link_request_pending: true })).toBe(true);
  });
  it('un efecto de link, plan o pago del borrador también cuenta (ofertas de llamada)', () => {
    expect(isCheckoutV1(idle, draft([], { proposed_action: { type: 'send_payment_link' } }))).toBe(true);
    expect(isCheckoutV1(idle, draft([], { move: { move: 'select_payment_plan', secondary_moves: [] } }))).toBe(true);
    expect(isCheckoutV1(idle, draft([]))).toBe(false);
  });
});
