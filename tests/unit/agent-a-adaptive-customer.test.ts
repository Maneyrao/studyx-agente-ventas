import { describe, expect, it } from 'vitest';
import { nextAdaptiveCustomerTurnV1 } from '../helpers/agent-a-adaptive-customer';

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
