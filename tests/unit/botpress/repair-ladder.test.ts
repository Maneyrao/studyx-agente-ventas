import { describe, expect, it } from 'vitest';
import {
  decideRepairLevelV1,
} from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import { buildTurnRejectionV1 } from '@/features/conversation/domain/turn-rejection';
import type { TurnRejectionV1 } from '../../../botpress-agent/src/schemas/turn-rejection';

const alternatives = { fact_ids: ['offering:x:name:v1'], actions: ['none'], missing_information: [] };
// El dominio declara `readonly`; el schema Zod produce mutable. La conversión
// es de varianza, no de contenido: `buildTurnRejectionV1` ya validó la forma.
const rejection = (
  code: TurnRejectionV1['rejections'][number]['code'],
): TurnRejectionV1 => buildTurnRejectionV1({
  rejection_id: '00000000-0000-4000-8000-000000000001',
  rejections: [{ code, subject: 'subject_id' }],
  authorized_alternatives: alternatives,
}) as TurnRejectionV1;

describe('escalera de reparación N1 → N2 → N3', () => {
  it('N1 cuando la poda deja un turno que todavía contesta', () => {
    expect(decideRepairLevelV1({
      rejection: rejection('FACT_NOT_AUTHORIZED'),
      pruned_messages: ['Te cuento cómo se cursa.'],
      repair_enabled: true,
    })).toEqual({ level: 'N1', messages: ['Te cuento cómo se cursa.'] });
  });

  it('N2 cuando podar deja la respuesta sin contenido', () => {
    // Si lo que queda no contesta, entregarlo es peor que reparar: el cliente
    // recibe una frase suelta que no responde lo que preguntó.
    expect(decideRepairLevelV1({
      rejection: rejection('FACT_NOT_AUTHORIZED'),
      pruned_messages: [],
      repair_enabled: true,
    }).level).toBe('N2');
  });

  it('un rechazo de acción nunca es podable: va directo a N2', () => {
    // No hay oración que quitar que vuelva válida una acción no autorizada.
    expect(decideRepairLevelV1({
      rejection: rejection('ACTION_NOT_AUTHORIZED'),
      pruned_messages: ['Perfecto, seguimos.'],
      repair_enabled: true,
    }).level).toBe('N2');
  });

  it('un valor comercial no autorizado usa N1 si la poda conserva una respuesta', () => {
    expect(decideRepairLevelV1({
      rejection: rejection('FACT_VALUE_MISMATCH'),
      pruned_messages: ['Una frase genérica sobrevivió.'],
      repair_enabled: true,
    }).level).toBe('N1');
  });

  it('con la reparación apagada, un rechazo no podable cae a N3, no a silencio', () => {
    // R2: apagar un flag nunca reintroduce silencio.
    expect(decideRepairLevelV1({
      rejection: rejection('ACTION_NOT_AUTHORIZED'),
      pruned_messages: ['Perfecto, seguimos.'],
      repair_enabled: false,
    }).level).toBe('N3');
  });

  it('con la reparación apagada, N1 sigue funcionando', () => {
    // El flag gobierna la reparación, no la poda: apagarlo no debe degradar
    // turnos que se salvaban solos.
    expect(decideRepairLevelV1({
      rejection: rejection('FACT_NOT_AUTHORIZED'),
      pruned_messages: ['Te cuento cómo se cursa.'],
      repair_enabled: false,
    }).level).toBe('N1');
  });

  it('una reparación ya intentada no abre otra: va a N3', () => {
    // A5: tope duro. Sin esto, un rechazo determinista produciría un lazo.
    expect(decideRepairLevelV1({
      rejection: rejection('FACT_NOT_AUTHORIZED'),
      pruned_messages: [],
      repair_enabled: true,
      already_repaired: true,
    }).level).toBe('N3');
  });

  it('N1 exige al menos un mensaje, no un texto vacío disfrazado', () => {
    expect(decideRepairLevelV1({
      rejection: rejection('FACT_NOT_AUTHORIZED'),
      pruned_messages: ['   '],
      repair_enabled: true,
    }).level).toBe('N2');
  });
});

/**
 * La repetición no se poda.
 *
 * `base_20_withholds_data` seguía repitiendo incluso con V8 puesto, y el
 * diagnóstico explica por qué: el turno se rechazaba por otros motivos, la
 * poda dejaba algo en pie, la escalera resolvía en N1 — y lo que sobrevivía a
 * la poda era, palabra por palabra, el mensaje anterior. Nunca se reparó.
 *
 * Quitar oraciones no puede arreglar que la respuesta ya se haya dicho: sólo
 * puede acercarla más al turno previo. Cuando lo podado coincide con lo último
 * que el agente mandó, la poda no es una resolución válida.
 */
describe('la poda no puede resolver una repetición', () => {
  it('escala a N2 cuando lo podado es el mensaje anterior', () => {
    expect(decideRepairLevelV1({
      rejection: rejection('FACT_VALUE_MISMATCH'),
      pruned_messages: ['Entendido. Si querés, podemos seguir revisando tus opciones.'],
      repair_enabled: true,
      previous_agent_reply: 'Entendido.   Si querés, podemos seguir revisando tus opciones.',
    }).level).toBe('N2');
  });

  it('sigue en N1 cuando lo podado dice algo distinto del turno anterior', () => {
    expect(decideRepairLevelV1({
      rejection: rejection('FACT_VALUE_MISMATCH'),
      pruned_messages: ['Sin tus datos no puedo dejarte anotado.'],
      repair_enabled: true,
      previous_agent_reply: 'Entendido. Si querés, podemos seguir revisando tus opciones.',
    }).level).toBe('N1');
  });

  it('un rechazo por repetición no es podable ni aunque sobreviva texto', () => {
    expect(decideRepairLevelV1({
      rejection: rejection('REPEATED_AGENT_REPLY'),
      pruned_messages: ['Entendido. Si querés, podemos seguir revisando tus opciones.'],
      repair_enabled: true,
    }).level).toBe('N2');
  });
});
