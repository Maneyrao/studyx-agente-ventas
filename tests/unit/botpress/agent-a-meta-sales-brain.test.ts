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
  it('treats every conversation as a warm Meta lead and resolves the course dynamically', () => {
    const instructions = buildAgentABrainInstructionsV1(context());
    const behavior = instructions.split('<authorized_context>')[0];

    expect(AGENT_A_BRAIN_PROMPT_VERSION).toBe('studyx-agent-a-brain-v44');
    expect(behavior).toMatch(/lead (?:tibio|c[áa]lido).{0,60}(?:Meta|Instagram|Facebook)/iu);
    expect(behavior).toMatch(/cualquier curso activo[\s\S]{0,120}catalog\.available_offerings/iu);
    expect(behavior).toMatch(/contexto (?:del )?anuncio[\s\S]{0,140}si est[áa] disponible/iu);
    expect(behavior).toMatch(/si (?:el contexto del anuncio|ese contexto) no[\s\S]{0,180}(?:mensaje actual|pregunta breve)/iu);
    expect(behavior).not.toMatch(/desde Telegram o desde un formulario/iu);
  });

  it('lets the model lead a flexible sale instead of obeying a blocking phase script', () => {
    const instructions = buildAgentABrainInstructionsV1(context());
    const behavior = instructions.split('<authorized_context>')[0];

    expect(behavior).toMatch(/respond[ée] primero[\s\S]{0,120}(?:pedido|intenci[óo]n|pregunta) actual/iu);
    expect(behavior).toMatch(/las fases[\s\S]{0,140}(?:mapa|gu[íi]a)[\s\S]{0,100}no[\s\S]{0,80}(?:bloqueo|guion)/iu);
    expect(behavior).toMatch(/conduc[íi][\s\S]{0,180}(?:pago|avanzar)/iu);
    expect(behavior).not.toContain('choose the earliest incomplete phase');
    expect(behavior).not.toContain('Follow the six canonical sales phases in order');
    expect(behavior).not.toMatch(/exactly (?:one|two) informational messages/iu);
  });

  it('keeps two natural call invitations and the three canonical payment plans', () => {
    const instructions = buildAgentABrainInstructionsV1(context());
    const behavior = instructions.split('<authorized_context>')[0];

    expect(behavior).toMatch(/m[áa]ximo (?:de )?dos[\s\S]{0,80}(?:llamada|invitaciones)/iu);
    expect(behavior).toMatch(/primera[\s\S]{0,180}(?:curso|inter[ée]s)[\s\S]{0,180}mensaje (?:aparte|separado)/iu);
    expect(behavior).toMatch(/segunda[\s\S]{0,180}(?:recordatorio|m[áa]s informaci[óo]n)/iu);
    expect(behavior).toMatch(/rechaz[\s\S]{0,120}no[\s\S]{0,100}(?:ofrezcas|insistas)/iu);
    expect(behavior).toContain('12 pagos mensuales de USD 30');
    expect(behavior).toContain('6 pagos mensuales de USD 60');
    expect(behavior).toContain('1 pago único de USD 360');
  });

  it('keeps the static instruction surface compact enough for natural generation', () => {
    const instructions = buildAgentABrainInstructionsV1(context());
    const staticInstructions = instructions.split('<authorized_context>')[0];
    const words = staticInstructions.trim().split(/\s+/u).length;

    expect(words).toBeLessThan(3_000);
  });
});
