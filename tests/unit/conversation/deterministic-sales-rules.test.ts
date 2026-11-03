import { describe, expect, it } from 'vitest';
import {
  decideRetentionRuleV1, draftFulfillsRetentionV1, retentionFallbackMessageV1,
  BONUS_AFFINITY_TABLE_V1, agentResponseOrdinalV1, bonusFallbackMessagesV1, bonusSequenceForPaidCourseV1,
  decideBonusRuleV1, decideCallRuleV1, draftFulfillsPromotionTaskV1, draftPresentsBonusV1, promotionTaskV1, nextRuleBonusCodeV1, priceExpressionHintV1,
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
    // Data collection stays checkout unless this message interrupts it with a price/promo (owner, 2026-11-02).
    expect(decideBonusRuleV1(ctx({ awaiting_reply: 'contact_details', batch_texts: ['Ana Pérez, ana@mail.com'] }), draft()))
      .toMatchObject({ reason: 'checkout' });
    expect(decideBonusRuleV1(ctx({ awaiting_reply: 'payment_plan' }), draft())).toMatchObject({ reason: 'checkout' });
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
    expect(bonusFallbackMessagesV1(decision)).toEqual(['Hagamos algo más! Además de Fotografía con Celulares para Tiendas Online, '
      + 'te sumo Publicidad en Redes Sociales: te llevas Introducción al Ecommerce + Fotografía con Celulares para Tiendas Online '
      + 'y Publicidad en Redes Sociales, tres cursos al precio de uno. Lo arrancamos en 12 cuotas de USD 30?!']);
    const data = { plan_codes: ['monthly_12', 'monthly_6', 'one_time'], customer_goal: null };
    const fixed = draft({ proposed_action: { type: 'offer_course_bonus', bonus_offering_code: decision.bonus_code,
      interest_offering_code: decision.paid_code }, response: { messages: bonusFallbackMessagesV1(decision, data) } });
    expect(draftFulfillsPromotionTaskV1(fixed, decision, data)).toBe(true);
  });
  it('sin objeción nueva no escala', () => {
    expect(decideBonusRuleV1(ctx({ package_status: 'offered', delivered_bonus: delivered, batch_texts: ['ok'] }), draft({ memory: [] })))
      .toMatchObject({ kind: 'none', reason: 'no_new_price_objection' });
  });
  it('una confirmación actual de que el precio es el único freno escala el paquete ya ofrecido', () => {
    const decision = decideBonusRuleV1(ctx({ package_status: 'offered', delivered_bonus: delivered,
      batch_texts: ['Sí, el precio es el único freno.'],
      rule_bonus: ruleFor('introduccion_ecommerce', delivered.map(course => course.code)) }), draft({
      memory: [{ type: 'constraint', key: 'price_only_barrier', value: 'confirmed',
        source_quote: 'el precio es el único freno' }],
    }));
    expect(decision).toMatchObject({ kind: 'offer', trigger: 'escalation',
      bonus_code: 'publicidad_redes_sociales', position: 2 });
  });
  it('una confirmación histórica de precio único no escala ante una respuesta neutral', () => {
    expect(decideBonusRuleV1(ctx({ package_status: 'offered', delivered_bonus: delivered,
      price_only_confirmed: true, batch_texts: ['ok'],
      rule_bonus: ruleFor('introduccion_ecommerce', delivered.map(course => course.code)) }), draft({ memory: [] })))
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
  it('respaldo fijo: un mensaje con el texto del dueño (modo promoción)', () => {
    expect(bonusFallbackMessagesV1(decision)).toEqual([
      'Te lo puedo resolver! Tengo una promoción exclusiva para ti: si avanzas con Introducción al Ecommerce, te bonifico '
      + 'Fotografía con Celulares para Tiendas Online, así te llevas dos cursos al precio de uno. '
      + 'Lo arrancamos en 12 cuotas de USD 30 o en 6 de USD 60?!',
    ]);
  });
  const data = { plan_codes: ['monthly_12', 'monthly_6', 'one_time'], customer_goal: 'vender en su tienda online' };
  const action = { type: 'offer_course_bonus', bonus_offering_code: decision.bonus_code, interest_offering_code: decision.paid_code };
  const said = (...messages: string[]) => draft({ proposed_action: action, response: { messages } });
  it('tarea del turno: primera oferta con datos reales y prohibiciones', () => {
    const task = promotionTaskV1(decision, data);
    expect(task).toContain('PROMOCIÓN EXCLUSIVA');
    expect(task).toContain('si avanza con Introducción al Ecommerce, le bonificas Fotografía con Celulares para Tiendas Online');
    expect(task).toContain('(vender en su tienda online)');
    expect(task).toContain('12 cuotas de USD 30 o 6 de USD 60');
    expect(task).toContain('Máximo 2 mensajes y una sola pregunta');
    expect(task).toContain('«te llevas dos cursos al precio de uno»');
    expect(task).toContain('«el precio sigue siendo»');
  });
  it('tarea del turno: escalada recapitula el paquete completo', () => {
    const prior = [{ code: 'fotografia_celulares_tiendas_online', display_name: 'Fotografía con Celulares para Tiendas Online' }];
    const up = decideBonusRuleV1(ctx({ package_status: 'offered', delivered_bonus: prior,
      rule_bonus: ruleFor('introduccion_ecommerce', prior.map(course => course.code)) }), draft());
    if (up.kind !== 'offer') throw new Error('expected escalation');
    const task = promotionTaskV1(up, data);
    expect(task).toContain('Ya le ofreciste Fotografía con Celulares para Tiendas Online con Introducción al Ecommerce');
    expect(task).toContain('le sumas Publicidad en Redes Sociales');
    expect(task).toContain('Introducción al Ecommerce + Fotografía con Celulares para Tiendas Online y Publicidad en Redes Sociales, tres cursos al precio de uno');
  });
  it('cumplimiento: acepta la redacción que sigue la tarea', () => {
    expect(draftFulfillsPromotionTaskV1(said('Es una inversión importante y está bien que lo mires así. Te lo puedo resolver.',
      'Tengo una promoción exclusiva para vos: si avanzás con Introducción al Ecommerce, te bonifico Fotografía con Celulares para Tiendas Online, '
      + 'así tus productos se ven mejor en tu tienda. Lo arrancamos en 12 cuotas de USD 30 o en 6 de USD 60?'), decision, data)).toBe(true);
  });
  it('cumplimiento: «salida laboral», «12 pagos de USD 30» y «no solo X» no son fallas', () => {
    expect(draftFulfillsPromotionTaskV1(said('Te lo puedo resolver: si avanzás con Introducción al Ecommerce te bonifico '
      + 'Fotografía con Celulares para Tiendas Online, que te abre otra salida laboral. Arrancamos en 12 pagos de USD 30?'), decision, data)).toBe(true);
  });
  it.each([
    ['inventa un descuento', ['Te hago un 20% de descuento y te sumo Fotografía con Celulares para Tiendas Online. Arrancamos en 12 cuotas?']],
    ['abre con el precio', ['El precio de Introducción al Ecommerce no cambia, pero te sumo Fotografía con Celulares para Tiendas Online. Arrancamos en 12 cuotas?']],
    ['abre con te entiendo', ['Te entiendo. Te sumo Fotografía con Celulares para Tiendas Online. Arrancamos en 12 cuotas?']],
    ['compara con gastos', ['Te sumo Fotografía con Celulares para Tiendas Online, son 12 cuotas de USD 30, menos que una salida a comer. Arrancamos?']],
    ['dos preguntas', ['Te sumo Fotografía con Celulares para Tiendas Online. Te suma? Arrancamos en 12 cuotas?']],
    ['tres mensajes', ['Te lo resuelvo.', 'Te sumo Fotografía con Celulares para Tiendas Online.', 'Arrancamos en 12 cuotas?']],
    ['sin alternativa de plan', ['Te lo resuelvo: te sumo Fotografía con Celulares para Tiendas Online. Avanzamos?']],
    ['frase defensiva', ['Es lo que hay, pero te sumo Fotografía con Celulares para Tiendas Online. Arrancamos en 12 cuotas?']],
    ['precio que sigue siendo (registro de valor)', ['Te sumo Fotografía con Celulares para Tiendas Online y el precio sigue siendo USD 360. Arrancamos en 12 cuotas?']],
    ['bonificación ya aplicada como apertura seca', ['La bonificación ya está aplicada: te sumo Fotografía con Celulares para Tiendas Online. Arrancamos en 12 cuotas?']],
    ['compra aparte', ['Te sumo Fotografía con Celulares para Tiendas Online; otro curso sería una compra aparte. Arrancamos en 12 cuotas?']],
    ['no es un cambio', ['No es un cambio, te sumo Fotografía con Celulares para Tiendas Online. Arrancamos en 12 cuotas?']],
  ])('cumplimiento: rechaza %s', (_label, messages) => {
    expect(draftFulfillsPromotionTaskV1(said(...messages), decision, data)).toBe(false);
  });
  it('cumplimiento: acepta el registro de valor del dueño («dos cursos al precio de uno», «de regalo»)', () => {
    expect(draftFulfillsPromotionTaskV1(said('Listo! Te sumo Fotografía con Celulares para Tiendas Online de regalo con Introducción al Ecommerce: '
      + 'te llevas dos cursos al precio de uno! Lo arrancamos en 12 cuotas de USD 30?!'), decision, data)).toBe(true);
  });
  it('el respaldo fijo cumple su propia tarea', () => {
    const [fixed] = bonusFallbackMessagesV1(decision, data);
    expect(draftFulfillsPromotionTaskV1(said(fixed), decision, data)).toBe(true);
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

// Segunda revisión del dueño (2026-11-02): promo/descuento instantáneo, pregunta
// fija ante precio y prohibición de cierres pasivos.
import { PRICE_PROBE_V1, confirmsPriceProbeV1, decidePriceProbeRuleV1, passiveClosingSentencesV1,
  priceConcernTextV1, promoRequestV1, withPriceProbeV1, withoutPassiveClosingV1 } from '@/shared/conversation/deterministic-sales-rules';

describe('dueño — promo o descuento habilita la oferta al instante', () => {
  it.each(['tenés alguna promo?', 'me hacés un descuento?', 'hay alguna promoción', 'algo más barato?',
    'me regalás un curso gratis?', 'hay beca?', 'precio especial?'])('"%s" es pedido de promo', t => {
    expect(promoRequestV1(t)).toBe(true);
  });
  it('"no me hacés un descuento?" es un pedido cortés, no una negación de la promo', () => {
    const text = 'No me hacés un descuento? USD 360 me parece caro.';
    expect(promoRequestV1(text)).toBe(true);
    expect(decideBonusRuleV1(ctx({ prior_price_objection_count: 0, batch_texts: [text] }), draft({ memory: [] })))
      .toMatchObject({ kind: 'offer', trigger: 'promo_request', bonus_code: 'fotografia_celulares_tiendas_online' });
  });
  it('sin objeción previa, el pedido de promo ofrece el 1.º de la tabla', () => {
    expect(decideBonusRuleV1(ctx({ prior_price_objection_count: 0, batch_texts: ['me hacés un descuento?'] }), draft({ memory: [] })))
      .toMatchObject({ kind: 'offer', trigger: 'promo_request', bonus_code: 'fotografia_celulares_tiendas_online' });
  });
  it('con oferta entregada, un nuevo pedido de promo escala al siguiente', () => {
    const delivered = [{ code: 'fotografia_celulares_tiendas_online', display_name: 'Fotografía con Celulares para Tiendas Online' }];
    expect(decideBonusRuleV1(ctx({ package_status: 'offered', delivered_bonus: delivered, batch_texts: ['y otra promo más?'],
      rule_bonus: ruleFor('introduccion_ecommerce', delivered.map(c => c.code)) }), draft({ memory: [] })))
      .toMatchObject({ kind: 'offer', trigger: 'escalation', bonus_code: 'publicidad_redes_sociales' });
  });
  it('nunca con la bonificación deshabilitada, pagado o en checkout', () => {
    for (const patch of [{ bonus_enabled: false }, { payment_paid: true }, { awaiting_reply: 'payment_plan' }])
      expect(decideBonusRuleV1(ctx({ ...patch, batch_texts: ['descuento?'] }), draft({ memory: [] })).kind).toBe('none');
  });
});

describe('dueño — precio → "El precio es el único inconveniente? Puedo revisar una promoción."', () => {
  it.each(['cuánto sale?', 'es caro', 'qué precio tiene', 'no me alcanza', 'cuánto es la cuota?'])('"%s" exige la pregunta', t => {
    expect(priceConcernTextV1(t)).toBe(true);
    expect(decidePriceProbeRuleV1(ctx({ prior_price_objection_count: 0, batch_texts: [t] }), draft({ memory: [] }),
      { kind: 'none', reason: 'x' })).toEqual({ kind: 'ask' });
  });
  it('sin mención de precio no la exige; en un turno de oferta tampoco', () => {
    expect(decidePriceProbeRuleV1(ctx({ batch_texts: ['me gusta ecommerce'] }), draft({ memory: [] }), { kind: 'none', reason: 'x' }).kind).toBe('none');
    const offer = decideBonusRuleV1(ctx(), draft());
    expect(decidePriceProbeRuleV1(ctx(), draft(), offer).kind).toBe('none');
  });
  it('"sí" o "sólo el precio" después de la pregunta dispara la oferta', () => {
    for (const reply of ['sí', 'si, solo el precio', 'obvio', 'el precio'])
      expect(decideBonusRuleV1(ctx({ prior_price_objection_count: 0, batch_texts: [reply], previous_agent_messages: ['Son USD 360.', PRICE_PROBE_V1] }),
        draft({ memory: [] }))).toMatchObject({ kind: 'offer', trigger: 'price_probe_confirmed' });
    expect(confirmsPriceProbeV1(['sí'], ['Son USD 360. Te sirve?'])).toBe(false);
  });
  it('respaldo: respuesta del modelo + burbuja fija', () => {
    expect(withPriceProbeV1(['Son USD 360 o 12 cuotas de USD 30.'])).toEqual(['Son USD 360 o 12 cuotas de USD 30.', PRICE_PROBE_V1]);
  });
});

describe('dueño — sin cierres pasivos', () => {
  it('detecta y quita sólo la oración pasiva', () => {
    const messages = ['Son 8 clases online. Lo ves tranquilo y me avisás.', 'Arrancamos con las 12 cuotas?'];
    expect(passiveClosingSentencesV1(messages)).toHaveLength(1);
    expect(withoutPassiveClosingV1(messages)).toEqual(['Son 8 clases online.', 'Arrancamos con las 12 cuotas?']);
    expect(passiveClosingSentencesV1(['Arrancamos hoy?'])).toEqual([]);
  });
});

// Límites del dueño (2026-11-02, mismo día): acotar las reglas para no romper la venta.
import { passiveRuleAppliesV1, planChoiceV1, purchaseIntentV1 } from '@/shared/conversation/deterministic-sales-rules';

describe('dueño — límites de las reglas C/D y de la promo instantánea', () => {
  const none = { kind: 'none' as const, reason: 'x' };
  it('"elijo 12 cuotas" no dispara la pregunta de precio (elección de plan)', () => {
    for (const t of ['elijo 12 cuotas', 'quiero el pago único', 'voy con las 12 cuotas de 30']) {
      expect(planChoiceV1(t)).toBe(true);
      expect(decidePriceProbeRuleV1(ctx({ batch_texts: [t] }), draft({ memory: [] }), none)).toMatchObject({ kind: 'none', reason: 'plan_choice' });
    }
  });
  it('"no quiero descuento" y "no necesito promo" no disparan la oferta', () => {
    for (const t of ['no quiero descuento', 'no necesito promo', 'ni promo ni nada, sólo info']) {
      expect(promoRequestV1(t)).toBe(false);
      expect(decideBonusRuleV1(ctx({ prior_price_objection_count: 0, batch_texts: [t] }), draft({ memory: [] })).kind).toBe('none');
    }
  });
  it('promo instantánea nunca en checkout ni después de pagar', () => {
    expect(decideBonusRuleV1(ctx({ stage: 'payment_link_sent', batch_texts: ['tenés descuento?'] }), draft({ memory: [] })))
      .toMatchObject({ kind: 'none', reason: 'checkout' });
    expect(decideBonusRuleV1(ctx({ payment_paid: true, batch_texts: ['tenés descuento?'] }), draft({ memory: [] })))
      .toMatchObject({ kind: 'none', reason: 'paid' });
  });
  it('"dale pasame el link" después de la pregunta va al checkout, no a una bonificación nueva', () => {
    const previous = ['Son USD 360.', PRICE_PROBE_V1];
    expect(purchaseIntentV1('dale pasame el link')).toBe(true);
    expect(confirmsPriceProbeV1(['dale pasame el link'], previous)).toBe(false);
    const checkout = draft({ memory: [], move: { move: 'request_payment_link', secondary_moves: [] },
      proposed_action: { type: 'send_payment_link' } });
    expect(decideBonusRuleV1(ctx({ prior_price_objection_count: 0, batch_texts: ['dale pasame el link'], previous_agent_messages: previous }), checkout))
      .toMatchObject({ kind: 'none', reason: 'checkout' });
    // Con una oferta vigente, el link adjunta el paquete: ver la integración
    // 'automatically seals a delivered offered package in the actual payment-link commit'.
  });
  it('una nueva objeción después de la pregunta sí la confirma; una pregunta no', () => {
    const previous = [PRICE_PROBE_V1];
    expect(confirmsPriceProbeV1(['sigue siendo caro'], previous)).toBe(true);
    expect(confirmsPriceProbeV1(['es caro?'], previous)).toBe(false);
  });
  it('la pregunta sale una sola vez por conversación', () => {
    const asked = ctx({ batch_texts: ['cuánto sale?'], recent_turns: [{ direction: 'outbound', content: `Son USD 360. ${PRICE_PROBE_V1}` }] });
    expect(decidePriceProbeRuleV1(asked, draft({ memory: [] }), none)).toMatchObject({ kind: 'none', reason: 'already_asked' });
  });
  it('"avisame cuando pagues" en checkout está permitido', () => {
    for (const patch of [{ stage: 'payment_link_sent' }, { awaiting_reply: 'payment_confirmation' }, { awaiting_reply: 'contact_details' }])
      expect(passiveRuleAppliesV1(ctx(patch), draft({ memory: [] }))).toBe(false);
    expect(passiveRuleAppliesV1(ctx(), draft({ memory: [], move: { move: 'request_payment_link', secondary_moves: [] } }))).toBe(false);
  });
  it('"no gracias, no me interesa" (no definitivo), opt-out, llamada y postventa permiten la despedida', () => {
    expect(passiveRuleAppliesV1(ctx(), draft({ memory: [], move: { move: 'decline_purchase', secondary_moves: [] } }))).toBe(false);
    expect(passiveRuleAppliesV1(ctx({ opted_out: true }), draft({ memory: [] }))).toBe(false);
    expect(passiveRuleAppliesV1(ctx(), draft({ memory: [], move: { move: 'request_call', secondary_moves: [] } }))).toBe(false);
    expect(passiveRuleAppliesV1(ctx({ payment_paid: true }), draft({ memory: [] }))).toBe(false);
    expect(passiveRuleAppliesV1(ctx(), draft({ memory: [] }))).toBe(true);
  });
});

describe('dueño — negación lejana de "caro" no es objeción (golden real 999fada/18)', () => {
  it('"no estoy diciendo que me parezca caro" no cuenta aunque el modelo la cite', () => {
    const batch = ['Es caro? Te pregunto, no estoy diciendo que me parezca caro.'];
    expect(decideBonusRuleV1(ctx({ prior_price_objection_count: 1, batch_texts: batch }),
      draft({ memory: [{ type: 'objection', key: 'price_objection', value: 'caro', source_quote: 'me parezca caro' }] })).kind).toBe('none');
  });
  it('una objeción afirmativa sigue contando', () => {
    expect(decideBonusRuleV1(ctx({ prior_price_objection_count: 1, batch_texts: ['me sigue pareciendo caro'] }), draft()).kind).toBe('offer');
  });
});

describe('dueño — objeción literal después de una oferta escala (golden real b1ac82d/18)', () => {
  const delivered = [{ code: 'fotografia_celulares_tiendas_online', display_name: 'Fotografía con Celulares para Tiendas Online' }];
  const offered = (text: string) => ctx({ package_status: 'offered', delivered_bonus: delivered, batch_texts: [text],
    rule_bonus: ruleFor('introduccion_ecommerce', delivered.map(c => c.code)) });
  it('"me sigue pareciendo caro y no me alcanza" escala aunque el modelo no registre la objeción', () => {
    expect(decideBonusRuleV1(offered('Ahora sí, el precio me sigue pareciendo caro y no me alcanza.'), draft({ memory: [] })))
      .toMatchObject({ kind: 'offer', trigger: 'escalation', bonus_code: 'publicidad_redes_sociales' });
  });
  it('una pregunta o una negación no escalan', () => {
    for (const t of ['es caro?', 'no es caro'])
      expect(decideBonusRuleV1(offered(t), draft({ memory: [] })).kind).toBe('none');
  });
});

describe('Modo promoción — toma de datos interrumpida (dueño 2026-11-02)', () => {
  const collecting = { stage: 'course_selected', awaiting_reply: 'contact_details', payment_link_request_pending: true };
  it('un pedido de promo por precio durante la toma de datos dispara la oferta', () => {
    const decision = decideBonusRuleV1(ctx({ ...collecting,
      batch_texts: ['hay bonificaciones?', 'o algun tipo de promocion', 'porque me parece caro'] }), draft({ memory: [] }));
    expect(decision).toMatchObject({ kind: 'offer', trigger: 'promo_request' });
  });
  it.each([
    ['dato de contacto', ['me llamo Ana Pérez, ana@mail.com']],
    ['intención de compra', ['es caro pero dale, pasame el link']],
    ['elección de plan', ['me parece caro, voy con 12 cuotas']],
  ])('%s mantiene el checkout', (_label, batch_texts) => {
    expect(decideBonusRuleV1(ctx({ ...collecting, batch_texts }), draft({ memory: [] })))
      .toMatchObject({ kind: 'none' });
  });
  it.each(['payment_plan', 'payment_confirmation'])('no interrumpe %s', awaiting_reply => {
    expect(decideBonusRuleV1(ctx({ ...collecting, awaiting_reply, batch_texts: ['tenés alguna promo? me parece caro'] }),
      draft({ memory: [] }))).toMatchObject({ kind: 'none', reason: 'checkout' });
  });
  it('no interrumpe con el link ya enviado', () => {
    expect(decideBonusRuleV1(ctx({ ...collecting, stage: 'payment_link_sent', batch_texts: ['hay promo? es caro'] }),
      draft({ memory: [] }))).toMatchObject({ kind: 'none', reason: 'checkout' });
  });
});

describe('pregunta de precio parafraseada por el modelo (en vivo 2026-11-02 18:45)', () => {
  it('«solo el precio» confirma también una pregunta propia del agente', async () => {
    const { confirmsPriceProbeV1, agentAskedPriceOnlyV1 } = await import('@/shared/conversation/deterministic-sales-rules');
    const asked = ['Contame, el precio es lo único que te frena o hay algo más que querés saber antes de decidir?'];
    expect(agentAskedPriceOnlyV1(asked)).toBe(true);
    expect(confirmsPriceProbeV1(['solo el precio'], asked)).toBe(true);
    expect(agentAskedPriceOnlyV1(['El precio son USD 360. Te sirve?'])).toBe(false);
    expect(confirmsPriceProbeV1(['solo el precio'], ['Qué curso te interesa?'])).toBe(false);
  });
});

describe('Regla A — curso elegido por el cliente (dueño 2026-11-03)', () => {
  const chosen = (replaces?: { code: string; name: string }) => ({ paid_offering_code: 'ingles_1', paid_display_name: 'Inglés 1',
    bonus_offering_code: 'armado_reparacion_pc', display_name: 'Armado y Reparación de PC', position: replaces ? 1 : 2,
    source: 'customer_request' as const,
    ...(replaces ? { replaces_offering_code: replaces.code, replaces_display_name: replaces.name } : {}) });
  const delivered = [{ code: 'ingles_2', display_name: 'Inglés 2' }];
  const data = { plan_codes: ['monthly_12', 'monthly_6', 'one_time'], customer_goal: null };
  it('suma el curso pedido sin objeción nueva y recapitula tres al precio de uno', () => {
    const decision = decideBonusRuleV1(ctx({ package_status: 'offered', delivered_bonus: delivered, rule_bonus: chosen() }), draft());
    expect(decision).toMatchObject({ kind: 'offer', trigger: 'customer_request', bonus_code: 'armado_reparacion_pc', prior_bonus: delivered });
    if (decision.kind !== 'offer') throw new Error();
    expect(bonusFallbackMessagesV1(decision, data)).toEqual(['Listo! Te sumo Armado y Reparación de PC de regalo: te llevas '
      + 'Inglés 1 + Inglés 2 y Armado y Reparación de PC, tres cursos al precio de uno! Lo arrancamos en 12 cuotas de USD 30 o en 6 de USD 60?!']);
  });
  it('cambia el único regalo: el paquete nuevo es de dos cursos y la tarea no habla de trámites', () => {
    const decision = decideBonusRuleV1(ctx({ package_status: 'offered', delivered_bonus: delivered,
      rule_bonus: chosen({ code: 'ingles_2', name: 'Inglés 2' }) }), draft());
    expect(decision).toMatchObject({ kind: 'offer', trigger: 'customer_request', prior_bonus: [], replaces: { code: 'ingles_2' } });
    if (decision.kind !== 'offer') throw new Error();
    const [fixed] = bonusFallbackMessagesV1(decision, data);
    expect(fixed).toBe('Listo! Cambiamos Inglés 2 por Armado y Reparación de PC: te queda Inglés 1 + Armado y Reparación de PC de regalo, '
      + 'dos cursos al precio de uno! Lo arrancamos en 12 cuotas de USD 30 o en 6 de USD 60?!');
    const task = promotionTaskV1(decision, data);
    expect(task).toContain('El cliente te pidió cambiar Inglés 2 por Armado y Reparación de PC');
    expect(task).toContain('«compra aparte»');
    const action = { type: 'offer_course_bonus', bonus_offering_code: 'armado_reparacion_pc', interest_offering_code: 'ingles_1' };
    expect(draftFulfillsPromotionTaskV1(draft({ proposed_action: action, response: { messages: [fixed] } }), decision, data)).toBe(true);
  });
  it('nunca en checkout ni con el paquete aceptado', () => {
    expect(decideBonusRuleV1(ctx({ package_status: 'accepted', rule_bonus: chosen() }), draft())).toMatchObject({ kind: 'none' });
  });
});

describe('Regla E — retención ante el primer «no» (dueño 2026-11-03)', () => {
  const declined = (text = 'no gracias, no lo voy a comprar') => draft({ move: { move: 'decline_purchase', secondary_moves: [] } });
  const base = { paid_display_name: 'Inglés 1', paid_offering_code: 'ingles_1', bonus_enabled: true };
  it('primer no con menos de 3 regalos: busca otra bonificación', () => {
    const decision = decideRetentionRuleV1(ctx({ ...base, batch_texts: ['no gracias'] }), declined());
    expect(decision).toEqual({ kind: 'retain', variant: 'more_bonus', paid_name: 'Inglés 1', paid_code: 'ingles_1' });
    if (decision.kind !== 'retain') throw new Error();
    expect(retentionFallbackMessageV1(decision)).toBe('Estás seguro? Te puedo buscar otra bonificación que seguro te interesa! '
      + 'Qué te gustaría aprender además de Inglés 1?');
    expect(draftFulfillsRetentionV1(draft({ response: { messages: [retentionFallbackMessageV1(decision)] } }))).toBe(true);
    expect(draftFulfillsRetentionV1(draft({ move: { move: 'decline_purchase', secondary_moves: [] },
      response: { messages: ['Estás seguro? Te busco otra.'] } }))).toBe(false);
  });
  it('con los 3 regalos ya ofrecidos: recuerda la promoción', () => {
    const gifts = ['a', 'b', 'c'].map(code => ({ code, display_name: code }));
    expect(decideRetentionRuleV1(ctx({ ...base, batch_texts: ['no'], package_status: 'offered', delivered_bonus: gifts }), declined()))
      .toMatchObject({ kind: 'retain', variant: 'limited_time' });
  });
  it('una sola vez por conversación', () => {
    expect(decideRetentionRuleV1(ctx({ ...base, batch_texts: ['no'], recent_turns: [{ direction: 'outbound',
      content: 'Estás seguro? Te puedo buscar otra bonificación' }] }), declined())).toMatchObject({ kind: 'none', reason: 'already_attempted' });
  });
  it('sin bonificación habilitada no promete otra: recuerda la promoción', () => {
    expect(decideRetentionRuleV1(ctx({ ...base, batch_texts: ['no'], bonus_enabled: false }), declined()))
      .toMatchObject({ kind: 'retain', variant: 'limited_time' });
  });
  it.each(['no me escribas más', 'dejame de mandar mensajes', 'quiero darme de baja', 'sos un chanta', 'basta',
    'no quiero recibir promociones', 'no me mandes más ofertas'])(
    'respeta de inmediato: %s', (text) => {
      expect(decideRetentionRuleV1(ctx({ ...base, batch_texts: [text] }), declined())).toMatchObject({ kind: 'none', reason: 'respect_end' });
    });
  it('nunca con opt-out, venta cerrada, sin curso o sin un no definitivo', () => {
    expect(decideRetentionRuleV1(ctx({ ...base, batch_texts: ['no'], opted_out: true }), declined())).toMatchObject({ kind: 'none' });
    expect(decideRetentionRuleV1(ctx({ ...base, batch_texts: ['no'], stage: 'closed' }), declined())).toMatchObject({ kind: 'none' });
    expect(decideRetentionRuleV1(ctx({ batch_texts: ['no'] }), declined())).toMatchObject({ kind: 'none', reason: 'no_paid_course' });
    expect(decideRetentionRuleV1(ctx({ ...base, batch_texts: ['lo voy a pensar'] }),
      draft({ move: { move: 'defer_payment', secondary_moves: [] } }))).toMatchObject({ kind: 'none', reason: 'no_decline' });
  });
});

