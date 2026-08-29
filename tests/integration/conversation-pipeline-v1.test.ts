import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import type { ParsedConversationPipelineCommitV1 } from '@/features/conversation/adapters/conversation-pipeline-schema';
import { authoritativelyPlanConversationTurnV1 } from '@/features/conversation/application/plan-conversation-turn';
import type { ConversationMoveV1 } from '@/features/conversation/domain/conversation-pipeline';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { commitClaimedDecision } from '@/features/orchestration/application/commit-claimed-decision';
import { claimBatch, DEFAULT_CONTEXT_LIMITS } from '@/features/orchestration/application/claim-batch';
import { orchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import { PostgresKnowledgeRetriever, PostgresMemoryRetriever } from '@/features/orchestration/adapters/postgres-retrievers';
import { buildBusinessContextView, buildCatalogIndexView } from '@/features/orchestration/domain/business-context';
import { verifyAuthorizedEgress } from '@/features/orchestration/domain/egress-guard';
import { PostgresSalesContextStore } from '@/features/sales/adapters/postgres-sales-context-store';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings/gemini';
import { sql } from '@/lib/db/orchestrator';
import { recordDeliveryReport } from '@/lib/services/decision.service';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

const paymentLinks = {
  monthly_12: 'https://buy.stripe.com/test_pipeline_v1_12',
  monthly_6: 'https://buy.stripe.com/test_pipeline_v1_6',
  one_time: 'https://buy.stripe.com/test_pipeline_v1_once',
};

function move(
  kind: ConversationMoveV1['move'],
  overrides: Partial<ConversationMoveV1> = {},
): ConversationMoveV1 {
  return { schema_version: 1, move: kind, secondary_moves: [], vetoes: [], confidence: 0.96, ...overrides };
}

function placeholderDecision() {
  return {
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
  };
}

function valueFreeComposition(factIds: readonly string[]) {
  return {
    schema_version: 1 as const,
    narrative: {
      opening: 'Continuemos con el siguiente paso autorizado.',
      explanation: null,
      next_question: null,
    },
    used_fact_ids: [...factIds],
  };
}

run('conversation pipeline V1 vertical', () => {
  const workspaceSlug = `conversation-v1-${randomUUID().slice(0, 8)}`;
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
    ]) previousEnv[key] = process.env[key];
    process.env.BUSINESS_WORKSPACE_SLUG = workspaceSlug;
    process.env.PAYMENT_LINK_12M = paymentLinks.monthly_12;
    process.env.PAYMENT_LINK_6M = paymentLinks.monthly_6;
    process.env.PAYMENT_LINK_CONTADO = paymentLinks.one_time;
    process.env.VOICE_PROVIDER = 'telegram_sandbox';

    const workspaces = await db!<Array<{ id: string }>>`
      INSERT INTO workspaces (slug, display_name, metadata)
      VALUES (
        ${workspaceSlug},
        'Conversation Pipeline V1 Test',
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
    const externalMessageId = `pipeline-message-${identity}-${sequence}`;
    const result: InboundEnvelope = {
      schema_version: 1,
      source: 'botpress',
      channel: 'telegram',
      integration_id: 'telegram-conversation-pipeline-v1',
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

  async function prepareTurn(
    text: string,
    interpretedMove: ConversationMoveV1,
    composition?: ParsedConversationPipelineCommitV1['composition'],
  ) {
    const input = envelope(text);
    const ingested = await processInboundMessage(input);
    await db!`
      UPDATE inbound_batches SET due_at = now() - interval '1 second'
      WHERE id = ${ingested.batch.id}::uuid
    `;
    const claimed = await claimBatch({
      batch_id: ingested.batch.id,
      claimed_by: 'conversation-pipeline-v1-test',
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
    }, { state_store: stateStore });
    const commitInput = {
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
        composition: composition ?? valueFreeComposition(planned.fact_refs.map((fact) => fact.id)),
      },
      decision: placeholderDecision(),
      model: {
        provider: 'groq-direct' as const,
        model: 'conversation-pipeline-v1-test',
        prompt_version: 'conversation-pipeline-v1-test',
      },
      batch_id: claimed.batch.id,
      claim_token: claimed.batch.claim_token,
    };
    return { claimed, planned, commitInput };
  }

  async function commitTurn(
    text: string,
    interpretedMove: ConversationMoveV1,
    composition?: ParsedConversationPipelineCommitV1['composition'],
  ) {
    const prepared = await prepareTurn(text, interpretedMove, composition);
    const committed = await commitClaimedDecision(prepared.commitInput, { store: orchestrationStore });
    expect(committed.status).toBe('committed');
    expect(committed.batch_completion).toBe('completed');
    if (committed.outbound) {
      expect(verifyAuthorizedEgress({
        content: committed.outbound.content,
        manifest: committed.outbound.authorized_egress,
      })).toEqual({ ok: true });
    }
    return { ...prepared, committed };
  }

  it('completes the governed sales journey with one offer, link and projection under replay/concurrency', async () => {
    const informed = await commitTurn(
      'Quiero conocer la formación de redes',
      move('ask_course_information', { course_reference: 'Redes Informáticas' }),
      {
        schema_version: 1,
        narrative: {
          opening: 'Por lo que buscás, Redes Informáticas puede encajarte.',
          explanation: 'Te acompaño a evaluar si es la opción indicada para vos.',
          next_question: '¿Querés que te cuente cómo seguir?',
        },
        used_fact_ids: [
          'offering:redes-informaticas:name:v1',
          'offering:redes-informaticas:description:v1',
          'offering:redes-informaticas:duration:v1',
          'offering:redes-informaticas:modality:v1',
        ],
      },
    );
    expect(informed.committed.outbound?.content).toContain(
      'Por lo que buscás, Redes Informáticas puede encajarte.',
    );
    expect(informed.committed.outbound?.content).not.toContain(
      'No tengo ese dato confirmado en el catálogo',
    );
    expect(informed.committed.outbound?.content).toContain('Redes Informáticas');
    expect(informed.committed.outbound?.content).toContain('24 clases');
    expect(informed.committed.outbound?.content).toContain('llamada');

    const chat = await commitTurn(
      'Mantengamos este intercambio en formato escrito',
      move('continue_by_chat'),
    );
    expect(chat.committed.outbound?.content).toContain('siguiente paso autorizado');

    const call = await commitTurn(
      'Cambié de idea y deseo una comunicación por voz',
      move('request_call'),
    );
    expect(call.committed.call_request).not.toBeNull();

    const options = await commitTurn(
      'Mostrame las alternativas para abonar',
      move('ask_payment_options'),
    );
    expect(options.committed.outbound?.content).toContain('12 pagos mensuales de USD 30');

    const selected = await commitTurn(
      'Me quedo con la primera alternativa',
      move('select_payment_plan', { payment_plan: 'monthly_12' }),
    );
    expect(selected.committed.outbound?.content).not.toContain(paymentLinks.monthly_12);

    const deferred = await commitTurn(
      'Conservá la selección para otra ocasión',
      move('defer_payment', { vetoes: ['payment_link'] }),
    );
    expect(deferred.committed.outbound?.content).not.toContain(paymentLinks.monthly_12);

    const payment = await prepareTurn(
      'Retomemos el paso pendiente y compartime el acceso de cobro',
      move('request_payment_link'),
    );
    const concurrent = await Promise.all([
      commitClaimedDecision(payment.commitInput, { store: orchestrationStore }),
      commitClaimedDecision(payment.commitInput, { store: orchestrationStore }),
    ]);
    expect(concurrent.map((result) => result.status).sort()).toEqual(['committed', 'duplicate']);
    const committed = concurrent.find((result) => result.status === 'committed')!;
    expect(committed.outbound?.content.split(paymentLinks.monthly_12)).toHaveLength(2);

    await recordDeliveryReport({
      outbound_id: committed.outbound!.id,
      trace_id: randomUUID(),
      status: 'submitted_to_botpress',
      botpress_message_id: `bp-${randomUUID()}`,
      replayed: false,
      error_code: null,
      delivery_attempt: committed.outbound!.delivery_attempt,
    });

    const rows = await db!<Array<{
      call_offers: number;
      call_sessions: number;
      links: number;
      projection_jobs: number;
      payment_actions: number;
      state_events_for_payment: number;
    }>>`
      SELECT
        (SELECT count(*)::integer FROM agent_decisions ad
         JOIN messages m ON m.id = ad.turn_id
         WHERE m.conversation_id = ${payment.claimed.batch.conversation_id}::uuid
           AND ad.response_type = 'call_offer') AS call_offers,
        (SELECT count(*)::integer FROM call_sessions
         WHERE conversation_id = ${payment.claimed.batch.conversation_id}::uuid) AS call_sessions,
        (SELECT count(*)::integer FROM messages
         WHERE conversation_id = ${payment.claimed.batch.conversation_id}::uuid
           AND direction = 'outbound' AND content LIKE ${`%${paymentLinks.monthly_12}%`}) AS links,
        (SELECT count(*)::integer FROM payment_projection_jobs job
         JOIN agent_decisions ad ON ad.id = job.decision_id
         JOIN messages m ON m.id = ad.turn_id
         WHERE m.conversation_id = ${payment.claimed.batch.conversation_id}::uuid) AS projection_jobs,
        (SELECT count(*)::integer FROM agent_decisions ad
         JOIN messages m ON m.id = ad.turn_id
         WHERE m.conversation_id = ${payment.claimed.batch.conversation_id}::uuid
           AND ad.business_action ->> 'type' = 'send_payment_link') AS payment_actions,
        (SELECT count(*)::integer FROM conversation_sales_context_state_events_v1
         WHERE conversation_id = ${payment.claimed.batch.conversation_id}::uuid
           AND source_turn_id = ${payment.claimed.turn_id}::uuid) AS state_events_for_payment
    `;
    expect(rows[0]).toEqual({
      call_offers: 1,
      call_sessions: 1,
      links: 1,
      projection_jobs: 1,
      payment_actions: 1,
      state_events_for_payment: 1,
    });

    const finalState = await stateStore.load(
      workspaceSlug,
      payment.claimed.batch.conversation_id,
      payment.claimed.batch.contact_id,
    );
    expect(finalState).toMatchObject({
      selected_offering_code: 'redes-informaticas',
      selected_payment_plan: 'monthly_12',
      stage: 'payment_link_sent',
      call_preference: 'call',
      call_offer_status: 'accepted',
      call_offer_count: 1,
      awaiting_reply: 'none',
    });

    const memoryTurnText = 'Mi objetivo es conseguir trabajo en tecnología';
    const memoryTurn = await prepareTurn(memoryTurnText, move('continue_by_chat'));
    const memoryCommit = await commitClaimedDecision({
      ...memoryTurn.commitInput,
      decision: {
        ...memoryTurn.commitInput.decision,
        memory_candidates: [{
          type: 'study_goal' as const,
          key: 'career_goal',
          value: 'conseguir trabajo en tecnología',
          source_quote: memoryTurnText,
          confidence: 0.97,
        }],
      },
    }, { store: orchestrationStore });
    expect(memoryCommit.status).toBe('committed');
    await expect(db!<Array<{ candidate: { key: string }; status: string }>>`
      SELECT candidate, status
      FROM agent_a_memory_projection_jobs
      WHERE decision_id = ${memoryCommit.decision_id}::uuid
    `).resolves.toEqual([{
      candidate: expect.objectContaining({ key: 'career_goal' }),
      status: 'pending',
    }]);
  });
});
