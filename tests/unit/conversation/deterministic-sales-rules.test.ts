import { describe, expect, it } from 'vitest';
import {
  BONUS_AFFINITY_TABLE_V1, agentResponseOrdinalV1, bonusFallbackMessagesV1, bonusSequenceForPaidCourseV1,
  decideBonusRuleV1, decideCallRuleV1, draftPresentsBonusV1, nextRuleBonusCodeV1, priceExpressionHintV1,
  type RuleContextV1, type RuleDraftV1,
} from '@/shared/conversation/deterministic-sales-rules';

const catalog = [
  { code: 'introduccion_ecommerce', display_name: 'Introducción al Ecommerce' },
  { code: 'fotografia_celulares_tiendas_online', display_name: 'Fotografía con Celulares para Tiendas Online' },
  { code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales' },
  { code: 'instagram_emprendedores', display_name: 'Instagram para Emprendedores' },
  { code: 'estrategias_emprender', display_name: 'Estrategias para Emprender' },
  { code: 'marketing_digital', display_name: 'Marketing Digital' },
  { code: 'ingles_3', display_name: 'Inglés 3' },
  { code: 'especialista_ventas', display_name: 'Especialista en Ventas' },
];

const ruleFor = (paid: string, delivered: readonly string[] = []) => {
  const code = nextRuleBonusCodeV1({ paid_code: paid, active_codes: catalog.map(c => c.code), delivered_codes: delivered, max_bonus_courses: 3 });
  return code ? { paid_offering_code: paid, paid_display_name: catalog.find(c => c.code === paid)!.display_name,
    bonus_offering_code: code, display_name: catalog.find(c => c.code === code)!.display_name, position: delivered.length + 1 } : null;
};

function ctx(overrides: Partial<RuleContextV1> = {}): RuleContextV1 {
  return {
    batch_texts: ['me sigue pareciendo caro'], recent_turns: [], recent_turns_complete: true, stage: 'course_selected',
    awaiting_reply: 'none', payment_paid: false, payment_link_request_pending: false, bonus_enabled: true,
    package_status: null, delivered_bonus: [], rule_bonus: ruleFor('introduccion_ecommerce'),
    prior_price_objection_count: 1, price_only_confirmed: false,
    may_offer_call: true, call_offer_status: 'not_offered', call_offer_count: 0, call_preference: 'unknown',
    customer_expressed_interest: true, ...overrides,
  };
}

function draft(overrides: Partial<RuleDraftV1> & { quote?: string; memory?: RuleDraftV1['memory_candidates'] } = {}): RuleDraftV1 {
  return {
    response: { messages: ['Te entiendo.'], call_offer: null },
    proposed_action: { type: 'none' },
    move: { move: 'ask_course_information', secondary_moves: [] },
    memory_candidates: overrides.memory ?? [{ type: 'objection', key: 'price_objection', value: 'caro',
      source_quote: overrides.quote ?? 'caro' }],
    ...overrides,
  };
}

describe('tabla fija de afinidades (Regla A)', () => {
  it('Ecommerce → Fotografía con Celulares, Publicidad, Instagram (mapa de Gabi :156)', () => {
    expect(bonusSequenceForPaidCourseV1('introduccion_ecommerce', catalog.map(c => c.code)))
      .toEqual(['fotografia_celulares_tiendas_online', 'publicidad_redes_sociales', 'instagram_emprendedores']);
  });
  it('salta cursos inactivos y completa con puentes universales', () => {
    expect(bonusSequenceForPaidCourseV1('ingles_3', catalog.map(c => c.code)))
      .toEqual(['estrategias_emprender', 'instagram_emprendedores', 'fotografia_celulares_tiendas_online']);
  });
  it('nunca bonifica el mismo curso pago ni repite', () => {
    for (const [paid, list] of Object.entries(BONUS_AFFINITY_TABLE_V1)) {
      expect(list).not.toContain(paid);
      expect(new Set(list).size).toBe(list.length);
    }
  });
  it('siguiente curso respeta lo entregado y el máximo', () => {
    const active = catalog.map(c => c.code);
    expect(nextRuleBonusCodeV1({ paid_code: 'introduccion_ecommerce', active_codes: active,
      delivered_codes: ['fotografia_celulares_tiendas_online'], max_bonus_courses: 3 })).toBe('publicidad_redes_sociales');
    expect(nextRuleBonusCodeV1({ paid_code: 'introduccion_ecommerce', active_codes: active,
      delivered_codes: ['a', 'b', 'c'], max_bonus_courses: 3 })).toBeNull();
  });
});

describe('pista léxica de precio (sólo registro)', () => {
  it.each(['es caro', 'me parece muy caro', 'no me alcanza', 'es un montón', 'no tengo presupuesto', 'mucha plata'])('"%s" es pista', t => {
    expect(priceExpressionHintV1(t)).toBe(true);
  });
  it.each(['es caro?', 'no es caro', 'nada caro', 'cuánto sale?', 'me gusta'])('"%s" no es pista', t => {
    expect(priceExpressionHintV1(t)).toBe(false);
  });
});

describe('Regla A — disparador', () => {
  it('2.ª objeción registrada (1 previa + la del turno) → ofrece el 1.º de la tabla', () => {
    expect(decideBonusRuleV1(ctx(), draft({ quote: 'caro' }))).toMatchObject({ kind: 'offer', trigger: 'second_price_objection',
      bonus_code: 'fotografia_celulares_tiendas_online', paid_code: 'introduccion_ecommerce', position: 1 });
  });
  it.each(['es caro?', '¿es caro?', 'no es caro', 'no me parece caro', 'para nada caro'])('no cuenta una memoria mal etiquetada con cita parcial dentro de «%s»', text => {
    expect(decideBonusRuleV1(ctx({ batch_texts: [text], prior_price_objection_count: 1 }),
      draft({ quote: 'caro' }))).toMatchObject({ kind: 'none', reason: 'trigger_not_met' });
  });
  it.each(['Me parece caro. No me alcanza.', 'Me parece caro\nNo me alcanza.'])(
    'counts a literal model quote spanning sentences or lines: %s', text => {
      expect(decideBonusRuleV1(ctx({ batch_texts: [text], prior_price_objection_count: 1 }),
        draft({ quote: text }))).toMatchObject({ kind: 'offer', trigger: 'second_price_objection' });
    });
  it('1.ª objeción sin precio único → no', () => {
    expect(decideBonusRuleV1(ctx({ prior_price_objection_count: 0 }), draft())).toMatchObject({ kind: 'none', reason: 'trigger_not_met' });
  });
  it('precio como único freno confirmado → ofrece aunque sea la 1.ª objeción', () => {
    expect(decideBonusRuleV1(ctx({ prior_price_objection_count: 0, batch_texts: ['si, solo el precio'] }),
      draft({ memory: [{ type: 'constraint', key: 'price_only_barrier', value: 'confirmed', source_quote: 'solo el precio' }] })))
      .toMatchObject({ kind: 'offer', trigger: 'price_only_barrier' });
  });
  it('"es caro?" y "no es caro" sin memoria del modelo nunca disparan', () => {
    for (const text of ['es caro?', 'no es caro']) {
      expect(decideBonusRuleV1(ctx({ batch_texts: [text], prior_price_objection_count: 1 }), draft({ memory: [] })).kind).toBe('none');
    }
  });
  it('una memoria con cita que no está en el mensaje del cliente no cuenta', () => {
    expect(decideBonusRuleV1(ctx({ batch_texts: ['ok'] }), draft({ quote: 'caro' })).kind).toBe('none');
  });
  it('nunca con bonificación deshabilitada, pagado, en checkout o con paquete aceptado', () => {
    expect(decideBonusRuleV1(ctx({ bonus_enabled: false }), draft())).toMatchObject({ reason: 'bonus_disabled' });
    expect(decideBonusRuleV1(ctx({ payment_paid: true }), draft())).toMatchObject({ reason: 'paid' });
    expect(decideBonusRuleV1(ctx({ stage: 'payment_link_sent' }), draft())).toMatchObject({ reason: 'checkout' });
    expect(decideBonusRuleV1(ctx({ awaiting_reply: 'contact_details' }), draft())).toMatchObject({ reason: 'checkout' });
    expect(decideBonusRuleV1(ctx(), draft({ proposed_action: { type: 'send_payment_link' } }))).toMatchObject({ reason: 'checkout' });
    expect(decideBonusRuleV1(ctx({ package_status: 'accepted' }), draft())).toMatchObject({ reason: 'package_accepted' });
  });
  it('sin curso de la tabla (sin curso pago o tabla agotada) no ofrece', () => {
    expect(decideBonusRuleV1(ctx({ rule_bonus: null }), draft())).toMatchObject({ reason: 'no_rule_course' });
  });
  it('el historial truncado deja la ventana de la llamada como desconocida', () => {
    expect(decideCallRuleV1(ctx({ recent_turns: [{ direction: 'outbound', content: 'x' }], recent_turns_complete: false }),
      draft({ memory: [] }), { kind: 'none', reason: 'x' })).toMatchObject({ reason: 'outside_window' });
  });
});

describe('Regla A — escalada', () => {
  const delivered = [{ code: 'fotografia_celulares_tiendas_online', display_name: 'Fotografía con Celulares para Tiendas Online' }];
  it('nueva objeción tras la oferta → 2.º de la tabla con recapitulación', () => {
    const decision = decideBonusRuleV1(ctx({ package_status: 'offered', delivered_bonus: delivered, prior_price_objection_count: 2,
      rule_bonus: ruleFor('introduccion_ecommerce', delivered.map(c => c.code)) }), draft());
    expect(decision).toMatchObject({ kind: 'offer', trigger: 'escalation', bonus_code: 'publicidad_redes_sociales', position: 2 });
    if (decision.kind !== 'offer') throw new Error();
    expect(bonusFallbackMessagesV1(decision)[1]).toBe('Te sumo también Publicidad en Redes Sociales. Te quedan Introducción al Ecommerce + '
      + 'Fotografía con Celulares para Tiendas Online y Publicidad en Redes Sociales sin costo extra, al mismo precio. Avanzamos?');
  });
  it('sin objeción nueva no escala', () => {
    expect(decideBonusRuleV1(ctx({ package_status: 'offered', delivered_bonus: delivered }), draft({ memory: [] })))
      .toMatchObject({ kind: 'none', reason: 'no_new_price_objection' });
  });
  it('máximo 3', () => {
    const three = ['fotografia_celulares_tiendas_online', 'publicidad_redes_sociales', 'instagram_emprendedores']
      .map(code => ({ code, display_name: catalog.find(c => c.code === code)!.display_name }));
    expect(decideBonusRuleV1(ctx({ package_status: 'offered', delivered_bonus: three, rule_bonus: null }), draft())).toMatchObject({ reason: 'limit_reached' });
  });
});

describe('Regla A — redacción y respaldo', () => {
  const decision = decideBonusRuleV1(ctx(), draft());
  if (decision.kind !== 'offer') throw new Error('expected offer');
  it('el borrador cumple sólo si propone ese efecto y nombra el curso exacto', () => {
    const presented = draft({ proposed_action: { type: 'offer_course_bonus', bonus_offering_code: decision.bonus_code,
      interest_offering_code: decision.paid_code }, response: { messages: ['Te sumo Fotografía con Celulares para Tiendas Online sin costo.'] } });
    expect(draftPresentsBonusV1(presented, decision)).toBe(true);
    expect(draftPresentsBonusV1({ ...presented, response: { messages: ['Te sumo un curso.'] } }, decision)).toBe(false);
    expect(draftPresentsBonusV1({ ...presented, proposed_action: { type: 'none' } }, decision)).toBe(false);
  });
  it.each([1, 2])('requires the complete paid + prior + new identities for escalation %s', count => {
    const prior = catalog.filter(course => ['fotografia_celulares_tiendas_online', 'publicidad_redes_sociales'].slice(0, count).includes(course.code));
    const rule = decideBonusRuleV1(ctx({ package_status: 'offered', delivered_bonus: prior,
      rule_bonus: ruleFor('introduccion_ecommerce', prior.map(course => course.code)) }), draft());
    if (rule.kind !== 'offer') throw new Error('expected escalation');
    const proposed_action = { type: 'offer_course_bonus', bonus_offering_code: rule.bonus_code, interest_offering_code: rule.paid_code };
    const all = [rule.paid_name, ...prior.map(course => course.display_name), rule.bonus_name];
    const presented = (names: string[]) => draft({ proposed_action, response: { messages: [`Te quedan ${names.join(' + ')} sin costo extra.`] } });
    expect(draftPresentsBonusV1(presented([rule.bonus_name]), rule)).toBe(false);
    expect(draftPresentsBonusV1(presented(all), rule)).toBe(true);
    expect(draftPresentsBonusV1(presented(all.slice(1)), rule)).toBe(false);
    for (const course of prior) expect(draftPresentsBonusV1(presented(all.filter(name => name !== course.display_name)), rule)).toBe(false);
    expect(draftPresentsBonusV1({ ...presented([rule.paid_name, rule.bonus_name]), response: { messages: [
      `Te quedan ${rule.paid_name} + ${rule.bonus_name}. No incluyo ${prior.map(course => course.display_name).join(' ni ')}.`,
    ] } }, rule)).toBe(false);
    expect(draftPresentsBonusV1({ ...presented([rule.paid_name, rule.bonus_name]), response: { messages: [
      `Te quedan ${rule.paid_name} + ${rule.bonus_name}. ${prior[0].display_name} no está incluido.`,
    ] } }, rule)).toBe(false);
  });
  it('does not confuse a different course name with the prior identity', () => {
    const rule = { ...decision, prior_bonus: [{ code: 'ingles_1', display_name: 'Inglés 1' }], trigger: 'escalation' as const };
    const presented = draft({ proposed_action: { type: 'offer_course_bonus', bonus_offering_code: rule.bonus_code,
      interest_offering_code: rule.paid_code }, response: { messages: [`Te quedan ${rule.paid_name} + Inglés 10 + ${rule.bonus_name}.`] } });
    expect(draftPresentsBonusV1(presented, rule)).toBe(false);
  });
  it('respaldo fijo: dos burbujas con el texto del dueño', () => {
    expect(bonusFallbackMessagesV1(decision)).toEqual([
      'Dejame revisar qué te puedo ofrecer, dame un segundo.',
      'Te puedo sumar Fotografía con Celulares para Tiendas Online sin costo; el precio de Introducción al Ecommerce sigue igual. Avanzamos?',
    ]);
  });
});

describe('Regla B — llamada', () => {
  const turns = (n: number) => Array.from({ length: n }, (_, i) => ({ direction: 'outbound' as const, content: `respuesta ${i}` }));
  const none = { kind: 'none' as const, reason: 'x' };
  it('2.ª y 3.ª respuesta con interés expresado → ofrece', () => {
    expect(decideCallRuleV1(ctx({ recent_turns: turns(1) }), draft({ memory: [] }), none)).toMatchObject({ kind: 'offer', response_ordinal: 2 });
    expect(decideCallRuleV1(ctx({ recent_turns: turns(2) }), draft({ memory: [] }), none)).toMatchObject({ kind: 'offer', response_ordinal: 3 });
  });
  it('1.ª o 4.ª respuesta → no', () => {
    expect(decideCallRuleV1(ctx({ recent_turns: [] }), draft({ memory: [] }), none)).toMatchObject({ reason: 'outside_window' });
    expect(decideCallRuleV1(ctx({ recent_turns: turns(3) }), draft({ memory: [] }), none)).toMatchObject({ reason: 'outside_window' });
  });
  it('un saludo reenviado idéntico cuenta una sola vez', () => {
    expect(agentResponseOrdinalV1([{ direction: 'outbound', content: 'Hola!' }, { direction: 'inbound', content: 'asd' },
      { direction: 'outbound', content: 'Hola!' }, { direction: 'outbound', content: 'Tenemos áreas...' }])).toBe(3);
  });
  it('sin interés expresado → no; con objetivo en la memoria del turno → sí', () => {
    expect(decideCallRuleV1(ctx({ recent_turns: turns(1), customer_expressed_interest: false }), draft({ memory: [] }), none))
      .toMatchObject({ reason: 'no_expressed_interest' });
    expect(decideCallRuleV1(ctx({ recent_turns: turns(1), customer_expressed_interest: false }),
      draft({ memory: [{ type: 'study_goal', key: 'goal', value: 'tienda', source_quote: 'tienda' }] }), none).kind).toBe('offer');
  });
  it('exclusiones: checkout, chat, rechazo, ya ofrecida, no autorizada', () => {
    const t = turns(1);
    expect(decideCallRuleV1(ctx({ recent_turns: t, awaiting_reply: 'payment_plan' }), draft(), none)).toMatchObject({ reason: 'checkout' });
    expect(decideCallRuleV1(ctx({ recent_turns: t, call_preference: 'chat' }), draft(), none)).toMatchObject({ reason: 'chat_preference' });
    expect(decideCallRuleV1(ctx({ recent_turns: t, call_offer_status: 'declined' }), draft(), none)).toMatchObject({ reason: 'already_offered' });
    expect(decideCallRuleV1(ctx({ recent_turns: t, call_offer_count: 1, call_offer_status: 'offered' }), draft(), none)).toMatchObject({ reason: 'already_offered' });
    expect(decideCallRuleV1(ctx({ recent_turns: t, may_offer_call: false }), draft(), none)).toMatchObject({ reason: 'not_authorized' });
    expect(decideCallRuleV1(ctx({ recent_turns: t }), draft({ move: { move: 'continue_by_chat', secondary_moves: [] } }), none))
      .toMatchObject({ reason: 'call_move' });
    expect(decideCallRuleV1(ctx({ recent_turns: t }), draft(), decideBonusRuleV1(ctx(), draft()))).toMatchObject({ kind: 'offer', response_ordinal: 2 });
  });
});
