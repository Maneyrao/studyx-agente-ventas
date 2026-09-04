import { describe, expect, it } from 'vitest';
import { buildAgentAContextV1 } from '../../../botpress-agent/src/lib/conversation/agent-a-context';
import type { ClaimedTurn } from '../../../botpress-agent/src/schemas/contracts';

/**
 * Recorte de contexto por alcanzabilidad (§ 03).
 *
 * Casi todo el recorte ya existía: `catalog.payment_plans` y
 * `catalog.selected_offering` ya se recortaban, y `capabilities` ya declaraba
 * qué acciones estaban disponibles. Lo único que faltaba era `intake_missing`.
 *
 * `intake_missing` es una lista de NOMBRES de campo, nunca de valores. El
 * modelo necesita saber qué falta para poder pedirlo; no necesita —y no
 * recibe— el nombre, el correo ni el teléfono del cliente.
 */

function claim(overrides: Record<string, unknown> = {}): ClaimedTurn {
  return {
    schema_version: 1,
    turn_id: '00000000-0000-4000-8000-000000000001',
    batch: {
      id: '00000000-0000-4000-8000-000000000002',
      conversation_id: '00000000-0000-4000-8000-000000000003',
      contact_id: '00000000-0000-4000-8000-000000000004',
      claim_token: 'token',
      message_count: 1,
      stolen: false,
    },
    contact: {
      id: '00000000-0000-4000-8000-000000000004',
      status: 'prospecto',
      name: null,
      blocked: false,
      consent_status: 'allowed',
      opted_in_at: '2026-01-01T00:00:00.000Z',
    },
    contact_intake_missing: ['nombre', 'apellido', 'correo', 'telefono'],
    context: {
      batch_messages: [{
        id: '00000000-0000-4000-8000-000000000005',
        conversation_seq: 1,
        content: 'hola',
        created_at: '2026-01-01T00:00:00.000Z',
        message_type: 'text',
      }],
      recent_turns: [],
      summary: { text: null, version: 0, updated_at: null },
      selected_memories: [],
      knowledge_base_available: true,
      long_term_memory_available: true,
      injection_suspected_count: 0,
    },
    policy: { may_respond: true, allowed_response_types: ['commercial_reply'] },
    sales_context: { offering_code: null, allowed_actions: [] },
    catalog_resolution: { kind: 'none' },
    catalog_index: { offerings: [] },
    business_context: null,
    conversation_state_v1: {
      workspace_id: '00000000-0000-4000-8000-000000000006',
      conversation_id: '00000000-0000-4000-8000-000000000003',
      contact_id: '00000000-0000-4000-8000-000000000004',
      selected_offering_code: null,
      selected_payment_plan: null,
      stage: 'exploring',
      call_preference: 'unknown',
      call_offer_status: 'not_offered',
      call_offer_count: 0,
      awaiting_reply: 'none',
      payment_reported: false,
    },
    deterministic_route: null,
    features: { agent_a_context_scoping: true },
    ...overrides,
  } as unknown as ClaimedTurn;
}

describe('recorte de contexto por alcanzabilidad', () => {
  it('anuncia qué falta de los cuatro campos de contacto', () => {
    const context = buildAgentAContextV1(claim({
      contact_intake_missing: ['apellido', 'correo', 'telefono'],
    }), null);
    expect(context!.capabilities.intake_missing).toEqual(['apellido', 'correo', 'telefono']);
  });

  it('el flag de scoping no decide qué datos faltan: eso lo responde el claim', () => {
    // Corrección explícita de la conducta anterior, no una relajación.
    // El flag entró para recortar memorias por alcanzabilidad y de paso ocultó
    // la respuesta de la autoridad sobre el intake. Con el flag apagado —el
    // default— la lista quedaba vacía y el contexto declaraba intake completo
    // sobre un contacto del que no se había consultado nada: «nadie preguntó»
    // se leía como «no falta nada», y ese es justamente el gate del link.
    const context = buildAgentAContextV1(claim({
      features: {},
      contact_intake_missing: ['apellido', 'correo'],
    }), null);
    expect(context!.capabilities.intake_missing).toEqual(['apellido', 'correo']);
    expect(context!.capabilities.intake_status).toBe('known');
    expect(context!.capabilities.may_reply).toBe(true);
  });

  it('con el intake completo la lista queda vacía', () => {
    const context = buildAgentAContextV1(claim({ contact_intake_missing: [] }), null);
    expect(context!.capabilities.intake_missing).toEqual([]);
  });

  it('nunca incluye curso ni plan: no son datos de intake', () => {
    // Vienen del estado canónico (P2). Ponerlos acá reabriría el contrato.
    const context = buildAgentAContextV1(claim(), null);
    expect(context!.capabilities.intake_missing).not.toContain('curso');
    expect(context!.capabilities.intake_missing).not.toContain('plan');
  });

  it('nunca incluye campos fuera del contrato', () => {
    const context = buildAgentAContextV1(claim(), null);
    for (const field of context!.capabilities.intake_missing) {
      expect(['nombre', 'apellido', 'correo', 'telefono']).toContain(field);
    }
  });

  // Estos ya pasaban. Se fijan para que el recorte existente no se pierda.
  it('no expone planes de pago sin curso resuelto', () => {
    expect(buildAgentAContextV1(claim(), null)!.catalog.payment_plans).toEqual([]);
  });

  it('nunca recorta la conversación ni el estado comercial', () => {
    const context = buildAgentAContextV1(claim(), null)!;
    expect(context.turn.batch_messages.length).toBeGreaterThan(0);
    expect(context.commercial_state.payment_reported).toBe(false);
    expect(context.commercial_state.stage).toBe('exploring');
  });
});
