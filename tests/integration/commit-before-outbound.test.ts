import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { authoritativelyPlanConversationTurnV1 } from '@/features/conversation/application/plan-conversation-turn';
import type { ConversationMoveV1 } from '@/features/conversation/domain/conversation-pipeline';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { commitClaimedDecision } from '@/features/orchestration/application/commit-claimed-decision';
import { claimBatch, DEFAULT_CONTEXT_LIMITS } from '@/features/orchestration/application/claim-batch';
import { orchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import { PostgresKnowledgeRetriever, PostgresMemoryRetriever } from '@/features/orchestration/adapters/postgres-retrievers';
import { buildBusinessContextView, buildCatalogIndexView } from '@/features/orchestration/domain/business-context';
import { PostgresSalesContextStore } from '@/features/sales/adapters/postgres-sales-context-store';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings/gemini';
import { sql } from '@/lib/db/orchestrator';
import { loadContactIntakeV1 } from '@/lib/repositories/contact-intake.repository';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { openLocalTestDatabase } from '../helpers/db';

/**
 * O1–O3 · § 05b — Orden entre el commit durable y la entrega.
 *
 * Un hecho de estado puede materializarse sobre la transición que el turno VA
 * a escribir (O1). Es lo que permite que el cliente entregue sus datos y reciba
 * "Registré tus datos" en ese mismo turno en vez de en el siguiente.
 *
 * La contrapartida es O2: si esa transacción revierte, el mensaje no sale. Sin
 * O2, la materialización anticipada convierte al agente en algo peor que hoy —
 * afirmaría un estado que no quedó escrito, y encima con una cita que lo
 * respalda. Una mentira trazable es peor que una mentira suelta.
 *
 * O3 dice que esto es un test con fallo inyectado y no una convención, porque
 * la única garantía real es la transacción: el INSERT del outbound ocurre ANTES
 * de la transición del estado en el orden textual del servicio, así que nada en
 * la lectura del código impide entregar primero y escribir después.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

const paymentLinks = {
  monthly_12: 'https://buy.stripe.com/test_o2_12',
  monthly_6: 'https://buy.stripe.com/test_o2_6',
  one_time: 'https://buy.stripe.com/test_o2_once',
};

function move(
  kind: ConversationMoveV1['move'],
  overrides: Partial<ConversationMoveV1> = {},
): ConversationMoveV1 {
  return { schema_version: 1, move: kind, secondary_moves: [], vetoes: [], confidence: 0.96, ...overrides };
}

run('el outbound nunca precede a su commit durable', () => {
  const workspaceSlug = `commit-order-${randomUUID().slice(0, 8)}`;
  const identity = randomUUID();
  const conversationExternalId = `conversation-${identity}`;
  const userExternalId = `user-${identity}`;
  const phone = `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const previousEnv: Record<string, string | undefined> = {};
  let workspaceId = '';
  let previousExternalMessageId: string | null = null;
  let sequence = 0;

  const businessStore = new PostgresBusinessContextStore(sql);
  const stateStore = new PostgresConversationStateStoreV1(sql);
  const salesStore = new PostgresSalesContextStore(sql);

  function fakeEmbedding(): Promise<number[]> {
    return Promise.resolve(Array.from(
      { length: EMBEDDING_DIMENSIONS },
      (_, index) => index === 0 ? 1 : 0,
    ));
  }

  const claimDeps = {
    store: orchestrationStore,
    embedding: { embed: fakeEmbedding },
    memory: new PostgresMemoryRetriever(sql),
    knowledge: new PostgresKnowledgeRetriever(sql),
    limits: DEFAULT_CONTEXT_LIMITS,
    business: {
      async load() {
        const raw = await businessStore.loadBusinessContext(workspaceSlug);
        return raw ? buildBusinessContextView(raw) : null;
      },
      async loadCompleteIndex() {
        const raw = await businessStore.loadCompleteIndex(workspaceSlug);
        return raw ? buildCatalogIndexView(raw) : null;
      },
      async loadByCode(code: string) {
        const raw = await businessStore.loadByCode(workspaceSlug, code);
        return raw ? buildBusinessContextView(raw) : null;
      },
    },
    sales: { load: (contactId: string) => salesStore.load(workspaceSlug, contactId) },
    conversationState: {
      load: (conversationId: string, contactId: string) => stateStore.load(
        workspaceSlug, conversationId, contactId,
      ),
    },
    conversationPipelineEnabled: true,
  };

  beforeAll(async () => {
    for (const key of [
      'BUSINESS_WORKSPACE_SLUG', 'PAYMENT_LINK_12M', 'PAYMENT_LINK_6M',
      'PAYMENT_LINK_CONTADO', 'VOICE_PROVIDER',
      'GOOGLE_SHEETS_SPREADSHEET_ID', 'GOOGLE_SHEETS_TAB_NAME',
    ]) previousEnv[key] = process.env[key];
    process.env.BUSINESS_WORKSPACE_SLUG = workspaceSlug;
    process.env.PAYMENT_LINK_12M = paymentLinks.monthly_12;
    process.env.PAYMENT_LINK_6M = paymentLinks.monthly_6;
    process.env.PAYMENT_LINK_CONTADO = paymentLinks.one_time;
    process.env.VOICE_PROVIDER = 'telegram_sandbox';
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = `commit-order-sheet-${randomUUID()}`;
    process.env.GOOGLE_SHEETS_TAB_NAME = 'Leads';

    const workspaces = await db!<Array<{ id: string }>>`
      INSERT INTO workspaces (slug, display_name, metadata)
      VALUES (
        ${workspaceSlug},
        'Commit Order Test',
        ${db!.json({
          payment_options: [
            {
              code: 'monthly_12', currency: 'USD', total_amount: '360.00',
              installments: 12, installment_amount: '30.00', payment_link: paymentLinks.monthly_12,
            },
            {
              code: 'monthly_6', currency: 'USD', total_amount: '360.00',
              installments: 6, installment_amount: '60.00', payment_link: paymentLinks.monthly_6,
            },
            {
              code: 'one_time', currency: 'USD', total_amount: '360.00',
              installments: 1, installment_amount: '360.00', payment_link: paymentLinks.one_time,
            },
          ],
        })}
      )
      RETURNING id
    `;
    workspaceId = workspaces[0].id;
    await db!`
      INSERT INTO offerings (
        workspace_id, code, display_name, offering_type, status, description,
        price_type, price_amount, currency, billing_interval, delivery, metadata
      ) VALUES (
        ${workspaceId}::uuid, 'redes-informaticas', 'Redes Informáticas',
        'course', 'active', 'Formación canónica en infraestructura y administración de redes.',
        'fixed', 360, 'USD', 'custom',
        ${db!.json({ classes: 24, modality: 'online', certification: true })},
        ${db!.json({ academy: 'Tecnología', aliases: ['Infraestructura de redes'] })}
      )
    `;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await db?.end();
    await sql.end();
  });

  function envelope(text: string): InboundEnvelope {
    sequence += 1;
    const externalMessageId = `commit-order-message-${identity}-${sequence}`;
    const result: InboundEnvelope = {
      schema_version: 1,
      source: 'botpress',
      channel: 'telegram',
      integration_id: 'telegram-commit-order',
      external_message_id: externalMessageId,
      external_conversation_id: conversationExternalId,
      external_user_id: userExternalId,
      phone_e164: phone,
      trace_id: randomUUID(),
      message: {
        type: 'text', text, occurred_at: new Date(Date.now() + sequence * 1_000).toISOString(),
        reply_to_external_message_id: previousExternalMessageId,
      },
    };
    previousExternalMessageId = externalMessageId;
    return result;
  }

  async function prepareTurn(text: string, interpretedMove: ConversationMoveV1, opening: string) {
    const input = envelope(text);
    const ingested = await processInboundMessage(input);
    await db!`
      UPDATE inbound_batches SET due_at = now() - interval '1 second'
      WHERE id = ${ingested.batch.id}::uuid
    `;
    const claimed = await claimBatch({
      batch_id: ingested.batch.id,
      claimed_by: 'commit-order-test',
      trace_id: input.trace_id,
    }, claimDeps);
    if (claimed.outcome !== 'claimed') throw new Error(`expected claimed, got ${claimed.outcome}`);

    const planned = await authoritativelyPlanConversationTurnV1({
      turn: {
        workspace_id: workspaceId,
        conversation_id: claimed.batch.conversation_id,
        contact_id: claimed.batch.contact_id,
      },
      workspace_slug: workspaceSlug,
      move: interpretedMove,
      business_context: claimed.business_context,
      catalog_index: claimed.catalog_index,
    }, { state_store: stateStore, contact_intake: loadContactIntakeV1 });

    return {
      claimed,
      commitInput: {
        turn_id: claimed.turn_id,
        trace_id: input.trace_id,
        authorized_offering_code: null,
        authorized_payment_plan: null,
        conversation_pipeline_v1: {
          move: {
            ...interpretedMove,
            secondary_moves: [...interpretedMove.secondary_moves],
            vetoes: [...interpretedMove.vetoes],
          },
          plan_hash: planned.plan_hash,
          composition: {
            schema_version: 1 as const,
            narrative: { opening, explanation: null, next_question: null },
            used_fact_ids: [] as string[],
          },
        },
        decision: {
          schema_version: 4 as const,
          intent: 'commercial' as const,
          kind: 'reply' as const,
          response: 'El backend preparará la respuesta autorizada.',
          response_type: 'commercial_reply' as const,
          confidence: 1,
          reason_code: 'CONVERSATION_PIPELINE_V1_PENDING_BACKEND',
          business_action: null,
          memory_candidates: [],
          missing_information: [],
          next_state: 'waiting_user' as const,
          retrieval_used: null,
        },
        model: {
          provider: 'groq-direct' as const,
          model: 'commit-order-test',
          prompt_version: 'commit-order-test',
        },
        batch_id: claimed.batch.id,
        claim_token: claimed.batch.claim_token,
      },
    };
  }

  async function outboundCountFor(conversationId: string): Promise<number> {
    const rows = await db!<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM messages
      WHERE conversation_id = ${conversationId}::uuid AND direction = 'outbound'
    `;
    return Number(rows[0].count);
  }

  async function decisionCountFor(turnId: string): Promise<number> {
    const rows = await db!<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM agent_decisions
      WHERE turn_id = ${turnId}::uuid
    `;
    return Number(rows[0].count);
  }

  it('entrega el outbound cuando el commit durable es exitoso', async () => {
    // Control. Sin este caso, un test que sólo verifica el fallo pasaría
    // igual con un sistema que no entrega nunca.
    const prepared = await prepareTurn(
      'Quiero conocer la formación de redes',
      move('ask_course_information', { course_reference: 'Redes Informáticas' }),
      'Te cuento de qué se trata la formación.',
    );
    const committed = await commitClaimedDecision(prepared.commitInput, { store: orchestrationStore });

    expect(committed.status).toBe('committed');
    expect(await outboundCountFor(prepared.claimed.batch.conversation_id)).toBe(1);
    expect(await decisionCountFor(prepared.claimed.turn_id)).toBe(1);
  });

  it('O2 · si el commit del estado falla, el outbound no se entrega', async () => {
    const prepared = await prepareTurn(
      'Contame más sobre redes',
      move('ask_course_information', { course_reference: 'Redes Informáticas' }),
      'Registré tus datos y seguimos.',
    );
    const before = await outboundCountFor(prepared.claimed.batch.conversation_id);

    // El fallo se inyecta en la escritura durable, no en la entrega. Es el
    // caso que importa: el INSERT del outbound ya ocurrió en esta misma
    // transacción, unas líneas antes.
    const spy = vi
      .spyOn(PostgresConversationStateStoreV1.prototype, 'transition')
      .mockRejectedValue(new Error('INJECTED_COMMIT_FAILURE'));

    await expect(
      commitClaimedDecision(prepared.commitInput, { store: orchestrationStore }),
    ).rejects.toThrow();

    // Sin esto el test pasaría vacíamente: cualquier fallo anterior a la
    // transición produciría el mismo rechazo y los mismos conteos en cero.
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();

    expect(await outboundCountFor(prepared.claimed.batch.conversation_id)).toBe(before);
    expect(await decisionCountFor(prepared.claimed.turn_id)).toBe(0);
  });

  it('O3 · un mensaje que afirma un estado y una transacción que no lo escribió no coexisten', async () => {
    const prepared = await prepareTurn(
      'Soy Ana Pérez, ana@example.com',
      move('provide_contact_details'),
      'Registré tus datos.',
    );

    const spy = vi
      .spyOn(PostgresConversationStateStoreV1.prototype, 'transition')
      .mockRejectedValue(new Error('INJECTED_COMMIT_FAILURE'));

    await expect(
      commitClaimedDecision(prepared.commitInput, { store: orchestrationStore }),
    ).rejects.toThrow();

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();

    const delivered = await db!<Array<{ content: string }>>`
      SELECT content FROM messages
      WHERE conversation_id = ${prepared.claimed.batch.conversation_id}::uuid
        AND direction = 'outbound'
    `;
    for (const message of delivered) {
      expect(message.content).not.toMatch(/registr[ée]\s+tus\s+datos/iu);
    }
  });

  it('O2 sigue valiendo con V5 por estado encendida', async () => {
    // El punto exacto del acoplamiento: V5 por estado permite afirmar lo que
    // la transición VA a escribir, no lo ya escrito. Esa capacidad es una
    // mentira si el outbound puede salir antes que el commit.
    //
    // Encender el flag no debilita O2: si la escritura durable falla, la
    // afirmación autorizada tampoco se entrega.
    const previo = process.env.AGENT_A_STATE_ASSERTIONS;
    process.env.AGENT_A_STATE_ASSERTIONS = 'true';
    try {
      const prepared = await prepareTurn(
        'Ya hice la transferencia',
        move('report_payment'),
        'Tengo registrado tu aviso de pago.',
      );
      const before = await outboundCountFor(prepared.claimed.batch.conversation_id);

      const spy = vi
        .spyOn(PostgresConversationStateStoreV1.prototype, 'transition')
        .mockRejectedValue(new Error('INJECTED_COMMIT_FAILURE'));

      await expect(
        commitClaimedDecision(prepared.commitInput, { store: orchestrationStore }),
      ).rejects.toThrow();

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();

      expect(await outboundCountFor(prepared.claimed.batch.conversation_id)).toBe(before);
      const delivered = await db!<Array<{ content: string }>>`
        SELECT content FROM messages
        WHERE conversation_id = ${prepared.claimed.batch.conversation_id}::uuid
          AND direction = 'outbound'
      `;
      for (const message of delivered) {
        expect(message.content).not.toMatch(/tengo\s+registrado/iu);
      }
    } finally {
      if (previo === undefined) delete process.env.AGENT_A_STATE_ASSERTIONS;
      else process.env.AGENT_A_STATE_ASSERTIONS = previo;
    }
  });

  it('O2 · el fallo tampoco deja la fila de estado a medias', async () => {
    const rows = await db!<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM conversation_sales_context_states_v1
      WHERE workspace_id = ${workspaceId}::uuid
        AND stage NOT IN ('exploring', 'qualified', 'course_selected')
    `;
    // Ninguna transición parcial sobrevivió a los dos fallos inyectados.
    expect(Number(rows[0].count)).toBe(0);
  });
});
