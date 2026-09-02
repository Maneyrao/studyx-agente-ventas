import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentATurnProposalV1 } from '@/features/conversation/domain/agent-a-brain';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { PostgresKnowledgeRetriever, PostgresMemoryRetriever } from '@/features/orchestration/adapters/postgres-retrievers';
import { orchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import { claimBatch, DEFAULT_CONTEXT_LIMITS } from '@/features/orchestration/application/claim-batch';
import { commitClaimedDecision } from '@/features/orchestration/application/commit-claimed-decision';
import { buildBusinessContextView, buildCatalogIndexView } from '@/features/orchestration/domain/business-context';
import { verifyAuthorizedEgress } from '@/features/orchestration/domain/egress-guard';
import { PostgresSalesContextStore } from '@/features/sales/adapters/postgres-sales-context-store';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings/gemini';
import { sql } from '@/lib/db/orchestrator';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

const link = 'https://buy.stripe.com/test_plannerless_v2_6';

function placeholderDecision() {
  return {
    schema_version: 4 as const,
    intent: 'commercial' as const,
    kind: 'reply' as const,
    response: 'El backend autorizará la propuesta completa.',
    response_type: 'commercial_reply' as const,
    confidence: 1,
    reason_code: 'AGENT_A_PLANNERLESS_V2_PENDING_BACKEND',
    business_action: null,
    memory_candidates: [], missing_information: [],
    next_state: 'waiting_user' as const, retrieval_used: null,
  };
}

run('plannerless Agent A vertical', () => {
  const workspaceSlug = `agent-turn-v2-${randomUUID().slice(0, 8)}`;
  const identity = randomUUID();
  const externalConversationId = `conversation-${identity}`;
  const externalUserId = `user-${identity}`;
  const phone = `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const previousEnv: Record<string, string | undefined> = {};
  let workspaceId = '';
  let sequence = 0;
  let previousExternalMessageId: string | null = null;
  const businessStore = new PostgresBusinessContextStore(sql);
  const stateStore = new PostgresConversationStateStoreV1(sql);
  const salesStore = new PostgresSalesContextStore(sql);

  const claimDeps = {
    store: orchestrationStore,
    embedding: {
      embed: async () => Array.from(
        { length: EMBEDDING_DIMENSIONS },
        (_, index) => index === 0 ? 1 : 0,
      ),
    },
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
    process.env.PAYMENT_LINK_12M = 'https://buy.stripe.com/test_plannerless_v2_12';
    process.env.PAYMENT_LINK_6M = link;
    process.env.PAYMENT_LINK_CONTADO = 'https://buy.stripe.com/test_plannerless_v2_once';
    process.env.VOICE_PROVIDER = 'telegram_sandbox';

    const workspaces = await db!<Array<{ id: string }>>`
      INSERT INTO workspaces (slug, display_name, metadata)
      VALUES (
        ${workspaceSlug}, 'Plannerless Agent A Test',
        ${db!.json({
          payment_options: [
            { code: 'monthly_12', currency: 'USD', total_amount: '360.00', installments: 12, installment_amount: '30.00', payment_link: process.env.PAYMENT_LINK_12M },
            { code: 'monthly_6', currency: 'USD', total_amount: '360.00', installments: 6, installment_amount: '60.00', payment_link: link },
            { code: 'one_time', currency: 'USD', total_amount: '360.00', installments: 1, installment_amount: '360.00', payment_link: process.env.PAYMENT_LINK_CONTADO },
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
        'course', 'active', 'Formación práctica en infraestructura y redes.',
        'fixed', 360, 'USD', 'custom',
        ${db!.json({ classes: 16, modality: 'online', certification: true })},
        ${db!.json({ academy: 'Tecnología', aliases: ['redes'] })}
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
    const externalMessageId = `plannerless-${identity}-${sequence}`;
    const result: InboundEnvelope = {
      schema_version: 1, source: 'botpress', channel: 'telegram',
      integration_id: 'telegram-plannerless-v2',
      external_message_id: externalMessageId,
      external_conversation_id: externalConversationId,
      external_user_id: externalUserId,
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

  async function commitTurn(text: string, proposal: AgentATurnProposalV1) {
    const input = envelope(text);
    const ingested = await processInboundMessage(input);
    await db!`
      UPDATE inbound_batches SET due_at = now() - interval '1 second'
      WHERE id = ${ingested.batch.id}::uuid
    `;
    const claimed = await claimBatch({
      batch_id: ingested.batch.id,
      claimed_by: 'agent-turn-v2-test',
      trace_id: input.trace_id,
    }, claimDeps);
    if (claimed.outcome !== 'claimed') throw new Error(`expected claimed, got ${claimed.outcome}`);
    const commitInput = {
      turn_id: claimed.turn_id,
      trace_id: input.trace_id,
      authorized_offering_code: null,
      authorized_payment_plan: null,
      conversation_pipeline_v1: null,
      agent_turn_v2: { schema_version: 2 as const, proposal },
      decision: placeholderDecision(),
      model: {
        provider: 'deepseek-direct' as const,
        model: 'deepseek-chat-test',
        prompt_version: 'studyx-agent-a-brain-plannerless-test',
      },
      batch_id: claimed.batch.id,
      claim_token: claimed.batch.claim_token,
    };
    const committed = await commitClaimedDecision(commitInput, { store: orchestrationStore });
    expect(committed.status).toBe('committed');
    expect(committed.batch_completion).toBe('completed');
    if (committed.outbound) {
      expect(verifyAuthorizedEgress({
        content: committed.outbound.content,
        manifest: committed.outbound.authorized_egress,
      })).toEqual({ ok: true });
    }
    return { claimed, commitInput, committed };
  }

  it('preserves natural model copy and commits course, plan and one canonical link without a planner', async () => {
    const selected = await commitTurn(
      'Soy Matía Damonte, matia@example.test. Quiero aprender sobre redes.',
      {
        schema_version: 1,
        move: {
          schema_version: 1, move: 'select_course', secondary_moves: [], vetoes: [],
          course_reference: 'redes', confidence: 0.98,
        },
        response: {
          messages: ['Buenísimo, veamos si Redes encaja con lo que querés lograr.'],
          call_offer: 'Si te resulta más cómodo, también podemos conversarlo en una llamada.',
        },
        proposed_action: { type: 'none' },
        used_fact_ids: ['offering:redes-informaticas:name:v1'],
        used_memory_ids: [], memory_candidates: [], repair_of: null,
      },
    );
    expect(selected.committed.outbound?.content).toContain('Buenísimo, veamos si Redes encaja');
    expect(selected.committed.outbound?.content).toContain('podemos conversarlo en una llamada');
    expect(selected.committed.outbound?.content).not.toContain('siguiente paso autorizado');

    await commitTurn('Me quedo con 6 cuotas', {
      schema_version: 1,
      move: {
        schema_version: 1, move: 'select_payment_plan', secondary_moves: [], vetoes: [],
        payment_plan: 'monthly_6', confidence: 0.99,
      },
      response: { messages: ['Perfecto, guardo esa opción. Cuando quieras avanzar, decime y seguimos.'] },
      proposed_action: { type: 'none' },
      used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
    });

    const payment = await commitTurn('Ahora sí, mandame el link', {
      schema_version: 1,
      move: {
        schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
        confidence: 0.99,
      },
      response: { messages: ['Dale, te lo comparto para que puedas avanzar.'] },
      proposed_action: {
        type: 'send_payment_link', offering_code: 'redes-informaticas', payment_plan: 'monthly_6',
      },
      used_fact_ids: [], used_memory_ids: [], memory_candidates: [], repair_of: null,
    });
    expect(payment.committed.outbound?.content).toContain('Dale, te lo comparto');
    expect(payment.committed.outbound?.content.split(link)).toHaveLength(2);

    const replay = await commitClaimedDecision(payment.commitInput, { store: orchestrationStore });
    expect(replay.status).toBe('duplicate');

    const rows = await db!<Array<{ links: number; actions: number; jobs: number }>>`
      SELECT
        (SELECT count(*)::integer FROM messages
         WHERE conversation_id = ${payment.claimed.batch.conversation_id}::uuid
           AND direction = 'outbound' AND content LIKE ${`%${link}%`}) AS links,
        (SELECT count(*)::integer FROM agent_decisions ad
         JOIN messages m ON m.id = ad.turn_id
         WHERE m.conversation_id = ${payment.claimed.batch.conversation_id}::uuid
           AND ad.business_action ->> 'type' = 'send_payment_link') AS actions,
        (SELECT count(*)::integer FROM payment_projection_jobs job
         JOIN agent_decisions ad ON ad.id = job.decision_id
         JOIN messages m ON m.id = ad.turn_id
         WHERE m.conversation_id = ${payment.claimed.batch.conversation_id}::uuid) AS jobs
    `;
    expect(rows[0]).toEqual({ links: 1, actions: 1, jobs: 1 });

    const state = await stateStore.load(
      workspaceSlug, payment.claimed.batch.conversation_id, payment.claimed.batch.contact_id,
    );
    expect(state).toMatchObject({
      selected_offering_code: 'redes-informaticas', selected_payment_plan: 'monthly_6',
      stage: 'payment_link_sent', call_offer_count: 1,
    });
  });
});
