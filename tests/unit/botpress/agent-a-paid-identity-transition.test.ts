import { describe, expect, it } from 'vitest';
import type { AgentAContextV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';
import {
  assertsUnsupportedPrerequisitesV1,
  parseAgentATurnProposalV1,
  validateAgentATurnProposalV1,
} from '../../../botpress-agent/src/lib/conversation/agent-a-brain';

/**
 * Replay of the owner's live incident A (2026-11-10): Fotografía was the paid
 * course with Publicidad en Redes Sociales delivered as bonus; the customer then
 * explicitly chose Plomería («pero te estoy pidiendo plomería», «estábamos
 * hablando de plomería», «ese me convence más»). Customer text is verbatim; the
 * catalog fact is the official Plomería programme wording.
 */
const PLOMERIA_DESCRIPTION = 'Este curso de Plomería ha sido diseñado para proporcionar una formación completa, '
  + 'pensada tanto para principiantes como para personas con experiencia básica. A lo largo de diez módulos '
  + 'progresivos, el curso aborda desde los fundamentos de la plomería residencial hasta áreas más complejas.';

const offerings = [
  { code: 'fotografia', display_name: 'Fotografía', area_code: 'arte', fact_id: 'offering:fotografia:name:v1' },
  { code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales', area_code: 'marketing',
    fact_id: 'offering:publicidad_redes_sociales:name:v1' },
  { code: 'plomeria', display_name: 'Plomería', area_code: 'oficios', fact_id: 'offering:plomeria:name:v1' },
  { code: 'excel', display_name: 'Excel', area_code: 'tech', fact_id: 'offering:excel:name:v1' },
];

function context(input: { focus: 'fotografia' | 'plomeria'; customer: string;
  packageStatus?: 'attached' | 'accepted' | 'cancelled' }): AgentAContextV1 {
  const focus = offerings.find(offering => offering.code === input.focus)!;
  return {
    schema_version: 1,
    turn: { batch_messages: [{ id: 'current', text: input.customer }], recent_turns: [
      { id: 'a1', direction: 'outbound', content: 'Plomería también es una muy buena opción si buscas un oficio.' },
    ] },
    customer: { display_name: null, memories: [] },
    identity: null,
    commercial_state: {
      selected_offering_code: 'fotografia', selected_payment_plan: 'one_time',
      stage: 'payment_link_sent', call_preference: 'chat', call_offer_status: 'declined',
      call_offer_count: 1, awaiting_reply: 'none', payment_reported: false,
    },
    catalog: {
      selected_offering: { code: focus.code, display_name: focus.display_name, area_code: focus.area_code,
        facts: [{ id: focus.fact_id, kind: 'offering_name', value: focus.display_name },
          ...(focus.code === 'plomeria' ? [{ id: 'offering:plomeria:description:v1', kind: 'offering_description' as const,
            value: PLOMERIA_DESCRIPTION }] : [])] },
      available_offerings: offerings,
      areas: [],
      candidate_offerings: focus.code === 'plomeria' ? [] : [{
        code: 'plomeria', display_name: 'Plomería', area_code: 'oficios', fact_id: 'offering:plomeria:name:v1',
        facts: [{ id: 'offering:plomeria:name:v1', kind: 'offering_name', value: 'Plomería' },
          { id: 'offering:plomeria:description:v1', kind: 'offering_description', value: PLOMERIA_DESCRIPTION }],
      }] as AgentAContextV1['catalog']['candidate_offerings'],
      payment_plans: [],
    },
    capabilities: {
      may_reply: true, may_offer_call: false, may_request_call_now: false,
      may_present_payment_options: true, may_send_payment_link: false, authorized_payment_plan: null,
      intake_status: 'known', intake_missing: [],
      course_bonus: { enabled: true, max_bonus_courses: 3, may_offer_bonus: false, status: 'accepted',
        package_status: input.packageStatus ?? 'attached', may_schedule_checkin: false, may_request_review: false,
        may_accept_offer: false, may_send_promoted_payment: true, promotion_code: 'p',
        promotion_cycle_id: '11111111-1111-4111-8111-111111111111', offer_version: 1,
        interest_offering_code: 'fotografia',
        bonus_offerings: [{ code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales', position: 1 }],
        delivered_bonus_offerings: [{ code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales', position: 1 }] },
    },
  } as AgentAContextV1;
}

function validate(current: AgentAContextV1, input: { move: string; messages: string[]; facts?: string[] }) {
  const parsed = parseAgentATurnProposalV1({
    schema_version: 1,
    move: { schema_version: 1, move: input.move, secondary_moves: [], vetoes: [], course_reference: 'plomeria', confidence: 1 },
    response: { messages: input.messages, call_offer: null },
    proposed_action: { type: 'none' },
    used_fact_ids: input.facts ?? [],
    used_memory_ids: [],
    memory_candidates: [],
  }, current);
  const rejection = validateAgentATurnProposalV1({ proposal: parsed, context: current,
    planned_fact_ids: ['offering:plomeria:name:v1', 'offering:plomeria:description:v1', 'offering:fotografia:name:v1'],
    rejection_id: '00000000-0000-4000-8000-000000000001' });
  return rejection?.rejections.map(item => item.subject) ?? [];
}

describe('incident A — one authorized paid identity for brain validation', () => {
  it('«desde los fundamentos» is course content, not a «no experience needed» claim', () => {
    expect(assertsUnsupportedPrerequisitesV1('Plomería arranca desde los fundamentos de la plomería residencial.')).toBe(false);
    // Real prerequisite claims keep being detected.
    expect(assertsUnsupportedPrerequisitesV1('No necesitas experiencia previa para Plomería.')).toBe(true);
    expect(assertsUnsupportedPrerequisitesV1('Puedes empezar desde cero.')).toBe(true);
  });

  it('explicit select_course Plomería while the durable selection is Fotografía passes with the supported fact', () => {
    const subjects = validate(context({ focus: 'fotografia', customer: 'ese me convence más' }), {
      move: 'select_course', facts: ['offering:plomeria:description:v1'],
      messages: ['Buenísimo, vamos con Plomería. El curso arranca desde los fundamentos de la plomería residencial.'],
    });
    expect(subjects).not.toContain('prerequisites');
    expect(subjects).not.toContain('forbidden_promise');
  });

  it('a supported prerequisite about the course in focus passes even without course_reference', () => {
    const current = context({ focus: 'plomeria', customer: 'y plomería necesita experiencia?' });
    const parsed = parseAgentATurnProposalV1({ schema_version: 1,
      move: { schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Está pensado para aprender desde cero: es para principiantes.'], call_offer: null },
      proposed_action: { type: 'none' }, used_fact_ids: ['offering:plomeria:description:v1'], used_memory_ids: [], memory_candidates: [],
    }, current);
    const withFact = { ...current, catalog: { ...current.catalog, selected_offering: { ...current.catalog.selected_offering!,
      facts: [...current.catalog.selected_offering!.facts, { id: 'offering:plomeria:syllabus:v1', kind: 'offering_syllabus' as const,
        value: 'Está pensado para aprender desde cero la plomería residencial.' }] } } };
    const rejection = validateAgentATurnProposalV1({ proposal: parsed, context: withFact,
      planned_fact_ids: ['offering:plomeria:description:v1', 'offering:plomeria:syllabus:v1'],
      rejection_id: '00000000-0000-4000-8000-000000000001' });
    expect(rejection?.rejections.map(item => item.subject) ?? []).not.toContain('prerequisites');
  });

  it('an invented prerequisite for the newly selected course keeps being rejected', () => {
    const subjects = validate(context({ focus: 'fotografia', customer: 'ese me convence más' }), {
      move: 'select_course', messages: ['Vamos con Plomería. No necesitas conocimientos previos de nada.'],
    });
    expect(subjects).toContain('prerequisites');
  });

  it('the previous package does not travel to Plomería: Publicidad as a gift is rejected after the switch', () => {
    const subjects = validate(context({ focus: 'plomeria', customer: 'estábamos hablando de plomería' }), {
      move: 'select_course', messages: ['Listo, Plomería con Publicidad en Redes Sociales bonificado.'],
    });
    expect(subjects).toContain('forbidden_promise');
  });

  it('a query about Plomería keeps the durable Fotografía package valid for a recap (focus is not paid identity)', () => {
    const subjects = validate(context({ focus: 'plomeria', customer: 'pero te estoy pidiendo plomería' }), {
      move: 'ask_course_information',
      messages: ['Hoy tienes Fotografía con Publicidad en Redes Sociales incluido. Plomería es otro curso, te cuento.'],
    });
    expect(subjects).not.toContain('forbidden_promise');
  });

  it('keeps rejecting an invented gift and a delivered course from a cancelled cycle', () => {
    expect(validate(context({ focus: 'fotografia', customer: 'y qué más?' }), {
      move: 'ask_course_information', messages: ['Con Fotografía también te sumo Excel sin costo.'],
    })).toContain('forbidden_promise');
    expect(validate(context({ focus: 'fotografia', customer: 'y qué más?', packageStatus: 'cancelled' }), {
      move: 'ask_course_information', messages: ['Fotografía sigue con Publicidad en Redes Sociales incluido.'],
    })).toContain('forbidden_promise');
  });
});
