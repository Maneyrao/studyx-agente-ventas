import { describe, expect, it } from 'vitest';
import {
  AGENT_A_BRAIN_PROMPT_VERSION,
  buildAgentABrainInstructionsV1,
} from '../../../botpress-agent/src/prompts/agent-a-brain-v1';
import type { AgentAContextV1 } from '../../../botpress-agent/src/schemas/agent-a-brain';

function context(): AgentAContextV1 {
  return {
    schema_version: 1,
    turn: {
      batch_messages: [{ id: 'message-1', text: 'Vi el anuncio y quiero info de fotografía' }],
      recent_turns: [],
    },
    continuity: {
      assistant_has_spoken: false,
      first_name_status: 'missing',
      last_agent_reply: null,
    },
    customer: { display_name: null, memories: [] },
    identity: {
      advisor_name: 'Asistente virtual',
      academy_name: 'StudyX',
      website: null,
      instagram: null,
    },
    commercial_state: {
      selected_offering_code: null,
      selected_payment_plan: null,
      stage: 'exploring',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
      awaiting_reply: 'none',
      payment_reported: false,
    },
    catalog: {
      selected_offering: null,
      available_offerings: [
        {
          code: 'fotografia-profesional',
          fact_id: 'offering:fotografia-profesional:name:v1',
          display_name: 'Fotografía Profesional',
          area_code: 'fotografia',
        },
        {
          code: 'ingles-1',
          fact_id: 'offering:ingles-1:name:v1',
          display_name: 'Inglés 1',
          area_code: 'idiomas',
        },
      ],
      areas: [],
      candidate_offerings: [],
      resolution: 'ambiguous',
      payment_plans: [
        {
          code: 'monthly_12',
          fact_id: 'payment:monthly_12:label:v1',
          label: '12 pagos mensuales de USD 30',
        },
        {
          code: 'monthly_6',
          fact_id: 'payment:monthly_6:label:v1',
          label: '6 pagos mensuales de USD 60',
        },
        {
          code: 'one_time',
          fact_id: 'payment:one_time:label:v1',
          label: '1 pago de USD 360',
        },
      ],
    },
    capabilities: {
      may_reply: true,
      may_offer_call: true,
      may_request_call_now: false,
      may_present_payment_options: true,
      may_send_payment_link: false,
      authorized_payment_plan: null,
      intake_status: 'known',
      intake_missing: ['nombre', 'apellido', 'correo', 'telefono'],
    },
  };
}

describe('Agent A Meta sales brain', () => {
  it('keeps the instruction surface compact and leaves the real catalog in context', () => {
    const current = context();
    const instructions = buildAgentABrainInstructionsV1(current);
    expect(AGENT_A_BRAIN_PROMPT_VERSION).toBe('studyx-agent-a-brain-v90');
    const staticInstructions = instructions.split('<authorized_context>')[0]!;
    expect(staticInstructions.trim().split(/\s+/u).length).toBeLessThan(1600);
    expect(JSON.parse(instructions.split('<authorized_context>')[1]!.split('</authorized_context>')[0]!)).toEqual(current);
  });
});
