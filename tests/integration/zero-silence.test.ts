import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Cero silencios accidentales (A7).
 *
 * El defecto medido: `EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED` en
 * `decision.service.ts` anulaba el turno entero — 4 de 88 turnos de la línea
 * base terminaban sin que el cliente recibiera nada.
 *
 * El rechazo del egress se INYECTA. Es la precondición del camino bajo prueba,
 * no la conducta bajo prueba: lo que se verifica es qué hace el servicio
 * cuando el egress rechaza y no queda nada podable. Reproducirlo orgánicamente
 * exigiría un desajuste entre el manifiesto del ensamblador y el del egress,
 * que es precisamente el bug que ya no se puede provocar a voluntad.
 *
 * El silencio deliberado por opt-out o bloqueo NO entra acá: se conserva, y
 * esos turnos ni siquiera llegan a componer una respuesta.
 */
let suppressNextEgress = false;

vi.mock('@/features/orchestration/domain/egress-guard', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/features/orchestration/domain/egress-guard')
  >();
  return {
    ...actual,
    verifyAuthorizedEgress: (input: Parameters<typeof actual.verifyAuthorizedEgress>[0]) => {
      // El rechazo tiene que estar bien formado: `unauthorized_facts` lo
      // consume `canonical-offering-egress` aguas arriba, y un rechazo sin ese
      // campo rompe el turno por una causa distinta de la que se prueba.
      if (suppressNextEgress) {
        return {
          ok: false as const,
          reason: 'UNAUTHORIZED_PROTECTED_FACT' as const,
          unauthorized_facts: [],
        };
      }
      return actual.verifyAuthorizedEgress(input);
    },
    // Nada podable: es el caso en que hoy el turno desaparecía entero.
    retainAuthorizedEgressParagraphs: (
      input: Parameters<typeof actual.retainAuthorizedEgressParagraphs>[0],
    ) => (suppressNextEgress ? null : actual.retainAuthorizedEgressParagraphs(input)),
  };
});

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

import {
  HUMAN_REVIEW_NOTICE_TEXT_V1,
  TECHNICAL_FALLBACK_TEXT_V1,
} from '@/features/conversation/domain/technical-fallback';

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

run('cero silencios accidentales', () => {
  const workspaceSlug = `zero-silence-${randomUUID().slice(0, 8)}`;
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
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = `zero-silence-sheet-${randomUUID()}`;
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
    const externalMessageId = `zero-silence-message-${identity}-${sequence}`;
    const result: InboundEnvelope = {
      schema_version: 1,
      source: 'botpress',
      channel: 'telegram',
      integration_id: 'telegram-zero-silence',
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
      claimed_by: 'zero-silence-test',
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

    lastConversationId = claimed.batch.conversation_id;
    lastContactId = claimed.batch.contact_id;
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
          model: 'zero-silence-test',
          prompt_version: 'zero-silence-test',
        },
        batch_id: claimed.batch.id,
        claim_token: claimed.batch.claim_token,
      },
    };
  }

  let lastConversationId = '';
  let lastContactId = '';

  async function lastOutbound(conversationId: string): Promise<string> {
    const rows = await db!<Array<{ content: string }>>`
      SELECT content FROM messages
      WHERE conversation_id = ${conversationId}::uuid AND direction = 'outbound'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `;
    return rows[0]?.content ?? '';
  }

  async function outboundCountFor(conversationId: string): Promise<number> {
    const rows = await db!<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM messages
      WHERE conversation_id = ${conversationId}::uuid AND direction = 'outbound'
    `;
    return Number(rows[0].count);
  }


  it('una supresión de egress entrega N3 en vez de nada', async () => {
    const prepared = await prepareTurn(
      'Contame de redes',
      move('ask_course_information', { course_reference: 'Redes Informáticas' }),
      'Te cuento cómo se cursa.',
    );
    const before = await outboundCountFor(prepared.claimed.batch.conversation_id);

    suppressNextEgress = true;
    const committed = await commitClaimedDecision(prepared.commitInput, { store: orchestrationStore });
    suppressNextEgress = false;

    expect(committed.status).toBe('committed');
    expect(committed.conversation_effects).toEqual({
      technical_fallback_reason: 'EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED',
      human_review_requested: false,
    });
    // Lo que cambia: había cero mensajes, ahora hay uno.
    expect(await outboundCountFor(prepared.claimed.batch.conversation_id)).toBe(before + 1);
    expect(await lastOutbound(prepared.claimed.batch.conversation_id)).toBe(TECHNICAL_FALLBACK_TEXT_V1);
  });

  it('el turno sigue siendo una supresión comercial: no compromete nada', async () => {
    const state = await new PostgresConversationStateStoreV1(db!).load(
      workspaceSlug, lastConversationId, lastContactId,
    );
    // Ningún curso, ningún plan, ninguna acción: sólo el contador.
    expect(state!.selected_offering_code).toBeNull();
    expect(state!.selected_payment_plan).toBeNull();
    expect(state!.consecutive_technical_fallbacks).toBe(1);
    expect(state!.human_review_requested_at).toBeNull();
  });

  it('el segundo fallo consecutivo deriva, y la marca se escribe antes de afirmarla', async () => {
    const prepared = await prepareTurn('Hola? seguís ahí', move('greeting'), 'Seguimos.');
    suppressNextEgress = true;
    const committed = await commitClaimedDecision(prepared.commitInput, { store: orchestrationStore });
    suppressNextEgress = false;

    expect(await lastOutbound(prepared.claimed.batch.conversation_id))
      .toBe(HUMAN_REVIEW_NOTICE_TEXT_V1);
    expect(committed.conversation_effects).toEqual({
      technical_fallback_reason: 'EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED',
      human_review_requested: true,
    });

    const state = await new PostgresConversationStateStoreV1(db!).load(
      workspaceSlug, prepared.claimed.batch.conversation_id, prepared.claimed.batch.contact_id,
    );
    expect(state!.human_review_requested_at).not.toBeNull();
    expect(state!.consecutive_technical_fallbacks).toBe(2);
  });

  it('no hay un tercer fallback distinto, y la derivación no se duplica', async () => {
    const before = await new PostgresConversationStateStoreV1(db!).load(
      workspaceSlug, lastConversationId, lastContactId,
    );
    const prepared = await prepareTurn('Hola', move('greeting'), 'Seguimos.');
    suppressNextEgress = true;
    await commitClaimedDecision(prepared.commitInput, { store: orchestrationStore });
    suppressNextEgress = false;

    expect(await lastOutbound(prepared.claimed.batch.conversation_id))
      .toBe(HUMAN_REVIEW_NOTICE_TEXT_V1);
    const after = await new PostgresConversationStateStoreV1(db!).load(
      workspaceSlug, lastConversationId, lastContactId,
    );
    expect(after!.human_review_requested_at).toBe(before!.human_review_requested_at);
  });

  it('un turno exitoso reinicia el contador y deja la marca en pie', async () => {
    const prepared = await prepareTurn(
      'Contame de redes de nuevo',
      move('ask_course_information', { course_reference: 'Redes Informáticas' }),
      'Te cuento cómo se cursa.',
    );
    await commitClaimedDecision(prepared.commitInput, { store: orchestrationStore });

    const state = await new PostgresConversationStateStoreV1(db!).load(
      workspaceSlug, prepared.claimed.batch.conversation_id, prepared.claimed.batch.contact_id,
    );
    expect(state!.consecutive_technical_fallbacks).toBe(0);
    // La marca es histórica: reiniciar el contador no la borra.
    expect(state!.human_review_requested_at).not.toBeNull();
  });
});
