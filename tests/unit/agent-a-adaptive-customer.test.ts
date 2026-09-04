import { describe, expect, it } from 'vitest';
import {
  adaptivePaymentAuthorizationFailuresV2,
  nextAdaptiveCustomerTurnV1,
  nextAdaptiveCustomerTurnV2,
} from '../helpers/agent-a-adaptive-customer';

const input = {
  profile: { course: 'Excel Integral', fullName: 'Julia Duarte', email: 'julia.duarte@example.test',
    declaredPhone: '+1 305 555 0101', planPhrase: 'las seis cuotas', acceptsCall: false },
  turnIndex: 3, alreadyGaveDetails: false,
};

describe('cliente adaptativo responde al permiso que se le solicita', () => {
  it.each([
    'Quedó elegido el plan de seis cuotas. ¿Querés que avancemos con el link de pago?',
    '¿Te mando el enlace de pago para continuar?',
  ])('autoriza explícitamente el link ante %s', (lastAgentMessage) => {
    const next = nextAdaptiveCustomerTurnV1({ ...input, lastAgentMessage });
    expect(next.answering).toBe('autoriza_link');
    expect(next.text).toMatch(/mandame el link/iu);
  });

  it('dejarlo registrado sin campos no es pedir datos personales', () => {
    const next = nextAdaptiveCustomerTurnV1({ ...input, lastAgentMessage: 'Podemos dejarlo registrado. ¿Querés avanzar con el link de pago?' });
    expect(next.answering).toBe('autoriza_link');
    expect(next.text).not.toContain(input.profile.email);
  });

  it('dar datos responde al intake y por sí solo no agrega permiso de pago', () => {
    const next = nextAdaptiveCustomerTurnV1({ ...input, lastAgentMessage: '¿Me pasás nombre, apellido, correo y teléfono?' });
    expect(next.answering).toBe('datos_de_contacto');
    expect(next.text).toContain(input.profile.email);
    expect(next.text).not.toMatch(/mandame|enviame|link/iu);
  });
});

describe('cliente adaptativo v2 conserva intención y consentimiento explícito', () => {
  const menu = 'El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360.';

  it('elige plan al recibir un menú de precios aunque no termine en pregunta', () => {
    expect(nextAdaptiveCustomerTurnV2({ ...input, alreadySelectedPlan: false, lastAgentMessage: menu }))
      .toMatchObject({ answering: 'eleccion_de_plan', text: 'Me quedo con las seis cuotas' });
  });

  it.each([
    '¡Perfecto! La opción de 6 pagos mensuales de USD 60 queda registrada. ¿Querés avanzar con esa opción para dejarlo listo?',
    '¿Querés que avancemos con la inscripción?',
  ])('acepta avanzar después de elegir plan con un pedido explícito de link: %s', (lastAgentMessage) => {
    expect(nextAdaptiveCustomerTurnV2({ ...input, alreadySelectedPlan: true,
      lastAgentMessage }))
      .toMatchObject({ answering: 'autoriza_link', text: expect.stringMatching(/mandame el link/iu) });
  });

  it('no acepta una invitación genérica a avanzar si todavía no eligió plan', () => {
    expect(nextAdaptiveCustomerTurnV2({ ...input, alreadySelectedPlan: false,
      lastAgentMessage: '¿Querés que avancemos con la inscripción?' }).answering).toBe('pregunta_precio');
  });

  it('un menú de precios no se convierte en permiso aunque ya existan plan y datos', () => {
    expect(nextAdaptiveCustomerTurnV2({ ...input, alreadySelectedPlan: true,
      alreadyGaveDetails: true, lastAgentMessage: menu }).answering).toBe('eleccion_de_plan');
  });
});

describe('gate de permiso adaptativo v2', () => {
  // Replay reducido del reporte live V15 2026-09-04T14-36-15-201Z.
  // El answering original no contiene autoriza_link/pide_link en ningún turno.
  const answering = ['apertura', 'rechaza_llamada', 'pregunta_precio', 'pregunta_precio',
    'eleccion_de_plan', 'pregunta_precio', 'datos_de_contacto'];
  const link = 'https://example.invalid/eval/6m';
  const turns = answering.map((answering, index) => ({
    answering, evidence: { turnId: `live-t${index + 1}`, authorizedMessages: index === 6 ? [`Gracias. ${link}`] : ['Respuesta'] },
  }));
  const db = { outbound: [{ turnId: 'live-t7', content: `Gracias. ${link}` }],
    decisions: [{ turnId: 'live-t7', businessActionType: 'send_payment_link' }], recordedLinks: [link] };

  it('rechaza el falso verde live: precio y datos nunca autorizaron el link registrado y enviado', () => {
    expect(adaptivePaymentAuthorizationFailuresV2({ turns, db })).toEqual([
      { turnId: 'live-t7', reason: 'PAYMENT_WITHOUT_EXPLICIT_CUSTOMER_PERMISSION' },
    ]);
  });

  it.each(['autoriza_link', 'pide_link'])('acepta permiso %s anterior a los datos y al link', (permission) => {
    expect(adaptivePaymentAuthorizationFailuresV2({
      turns: turns.map((turn, index) => index === 5 ? { ...turn, answering: permission } : turn), db,
    })).toEqual([]);
  });

  it('permiso posterior no justifica una URL previa aunque la foto final tenga autorización', () => {
    expect(adaptivePaymentAuthorizationFailuresV2({ turns: [
      ...turns, { answering: 'autoriza_link', evidence: { turnId: 'live-t8', authorizedMessages: ['Listo'] } },
    ], db })).toEqual([{ turnId: 'live-t7', reason: 'PAYMENT_WITHOUT_EXPLICIT_CUSTOMER_PERMISSION' }]);
  });

  it('detecta la acción durable aunque su respuesta no contenga una URL', () => {
    expect(adaptivePaymentAuthorizationFailuresV2({
      turns: turns.map(turn => ({ ...turn, evidence: { ...turn.evidence, authorizedMessages: ['Listo'] } })),
      db: { outbound: [], decisions: db.decisions, recordedLinks: [] },
    })).toEqual([{ turnId: 'live-t7', reason: 'PAYMENT_WITHOUT_EXPLICIT_CUSTOMER_PERMISSION' }]);
  });

  it('un registro de URL sin turno correlacionable no se declara autorizado', () => {
    expect(adaptivePaymentAuthorizationFailuresV2({
      turns: [{ answering: 'autoriza_link', evidence: { turnId: 'live-t1', authorizedMessages: ['Listo'] } }],
      db: { outbound: [], decisions: [], recordedLinks: [link] },
    })).toEqual([{ turnId: null, reason: 'PAYMENT_RECORD_WITHOUT_CORRELATED_TURN' }]);
  });
});
