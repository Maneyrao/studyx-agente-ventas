import { describe, expect, it } from 'vitest';
import type {
  CanonicalFactRefV1,
  CanonicalFactV1,
  ComposedNarrativeV1,
  TurnPlanV1,
} from '@/features/conversation/domain/conversation-pipeline';
import { assembleCanonicalConversationResponseV1 }
  from '@/features/conversation/domain/canonical-response-assembler';
import { materializeStateFactsV1 }
  from '@/features/conversation/domain/state-fact-registry';

/**
 * V5 aplicado de verdad, no sólo definido.
 *
 * `unsupportedOperationalAssertionsV1` existía desde 8e2fe6f, tenía su código
 * de rechazo declarado en los dos espejos del contrato y ningún llamador en
 * producción: el egress seguía recortando por cadena. La regla estaba escrita
 * y no corría.
 *
 * `state_facts: null` es la ruta de hoy —recorte léxico— y se conserva. El
 * flag `AGENT_A_STATE_ASSERTIONS` es lo único que la cambia, y viene apagado.
 */

const facts: CanonicalFactV1[] = [{
  id: 'offering:redes-informaticas:name:v1',
  kind: 'offering_name',
  source: 'business_snapshot',
  value: 'Redes Informáticas',
  offering_code: 'redes-informaticas',
}];
const refs: CanonicalFactRefV1[] = [{
  id: facts[0].id, kind: 'offering_name', offering_code: 'redes-informaticas',
}];

function plan(overrides: Partial<TurnPlanV1> = {}): TurnPlanV1 {
  return {
    schema_version: 1, next_stage: 'course_selected', response_goal: 'explain_selected_course',
    canonical_fact_requests: [], allowed_business_action: { type: 'none' }, missing_information: [],
    should_offer_call: false, next_call_preference: 'unknown', next_call_offer_status: 'not_offered',
    next_call_offer_count: 0, next_awaiting_reply: 'none', payment_reported: false,
    selected_offering_code: 'redes-informaticas', selected_payment_plan: null, ...overrides,
  };
}

function narrate(opening: string): ComposedNarrativeV1 {
  return {
    schema_version: 1,
    narrative: { opening, explanation: null, next_question: null },
    used_fact_ids: [],
  };
}

const INTAKE_COMPLETO = {
  nombre: 'Ana', apellido: 'Gómez',
  correo: 'ana@example.com', telefono: '+5491122334455',
} as const;

function assemble(opening: string, stateFacts: Parameters<
  typeof assembleCanonicalConversationResponseV1
>[0]['state_facts']) {
  return assembleCanonicalConversationResponseV1({
    plan: plan(), fact_refs: refs, facts, composition: narrate(opening), state_facts: stateFacts,
  }).content;
}

describe('V5 por estado en el egress', () => {
  const SIN_INTAKE = materializeStateFactsV1({
    intake: undefined, planned_payment_reported: false,
  });
  const CON_INTAKE = materializeStateFactsV1({
    intake: INTAKE_COMPLETO, planned_payment_reported: false,
  });

  it('borra la afirmación cuyo hecho no está materializado', () => {
    const content = assemble('Registré tus datos. Te cuento del curso.', SIN_INTAKE);
    expect(content).not.toContain('Registré tus datos');
    expect(content).toContain('Te cuento del curso');
  });

  it('deja pasar la misma oración cuando el hecho SÍ está materializado', () => {
    // La prueba de que esto autoriza por estado y no por lista blanca: misma
    // cadena, distinto veredicto.
    const content = assemble('Registré tus datos. Te cuento del curso.', CON_INTAKE);
    expect(content).toContain('Registré tus datos');
  });

  it('el aviso de pago sólo se puede afirmar si la transición lo va a escribir', () => {
    const planeado = materializeStateFactsV1({
      intake: INTAKE_COMPLETO, planned_payment_reported: true,
    });
    const frase = 'Tengo registrado tu aviso de pago.';
    expect(assemble(frase, planeado)).toContain('Tengo registrado');
    expect(assemble(frase, CON_INTAKE)).not.toContain('Tengo registrado');
  });

  it('con state_facts en null la conducta es exactamente la de hoy', () => {
    // El recorte léxico no reconoce esta oración; por eso hacía falta V5.
    // Si esto empezara a borrarla, el flag apagado habría cambiado algo.
    expect(assemble('Registré tus datos.', null)).toContain('Registré tus datos');
  });
});
