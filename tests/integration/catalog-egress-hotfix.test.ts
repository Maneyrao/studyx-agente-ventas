import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClaimedTurn } from '../../botpress-agent/src/schemas/contracts';
import { routeCommercialTurn } from '../../botpress-agent/src/utils/commercial-router';
import { applyDecisionPolicy } from '../../botpress-agent/src/utils/decision-policy';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { orchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import {
  PostgresKnowledgeRetriever,
  PostgresMemoryRetriever,
} from '@/features/orchestration/adapters/postgres-retrievers';
import {
  claimBatch,
  DEFAULT_CONTEXT_LIMITS,
} from '@/features/orchestration/application/claim-batch';
import { commitClaimedDecision } from '@/features/orchestration/application/commit-claimed-decision';
import {
  buildBusinessContextView,
  buildCatalogIndexView,
} from '@/features/orchestration/domain/business-context';
import { verifyAuthorizedEgress } from '@/features/orchestration/domain/egress-guard';
import { PostgresSalesContextStore } from '@/features/sales/adapters/postgres-sales-context-store';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings/gemini';
import { sql } from '@/lib/db/orchestrator';
import type { CommitDecisionInput } from '@/lib/services/decision.service';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

function fakeEmbedding(): Promise<number[]> {
  return Promise.resolve(Array.from(
    { length: EMBEDDING_DIMENSIONS },
    (_, index) => (index === 0 ? 1 : 0),
  ));
}

run('catalog guidance survives canonical egress', () => {
  const workspaceSlug = `catalog-egress-${randomUUID().slice(0, 8)}`;
  const previousWorkspaceSlug = process.env.BUSINESS_WORKSPACE_SLUG;
  const businessStore = new PostgresBusinessContextStore(sql);
  const salesStore = new PostgresSalesContextStore(sql);

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
  };

  beforeAll(async () => {
    process.env.BUSINESS_WORKSPACE_SLUG = workspaceSlug;
    const workspace = await db!<Array<{ id: string }>>`
      INSERT INTO workspaces (slug, display_name)
      VALUES (${workspaceSlug}, 'Catalog egress hotfix')
      RETURNING id
    `;
    await db!`
      INSERT INTO offerings (
        workspace_id, code, display_name, offering_type, status, description,
        price_type, price_amount, currency, delivery, metadata
      ) VALUES
        (
          ${workspace[0].id}::uuid, 'redes_informaticas', 'Redes Informáticas',
          'course', 'active', 'Curso canónico de redes', 'fixed', 360, 'USD',
          ${db!.json({ classes: 16, modality: 'online', certification: true })},
          ${db!.json({ academy: 'Academia de Oficios' })}
        ),
        (
          ${workspace[0].id}::uuid, 'reparacion_celulares', 'Reparación de Celulares',
          'course', 'active', 'Curso canónico de reparación', 'fixed', 360, 'USD',
          ${db!.json({ classes: 18, modality: 'online', certification: true })},
          ${db!.json({ academy: 'Academia de Oficios' })}
        ),
        (
          ${workspace[0].id}::uuid, 'electricidad', 'Electricidad Domiciliaria',
          'course', 'active', 'Curso canónico de electricidad', 'fixed', 360, 'USD',
          ${db!.json({ classes: 20, modality: 'online', certification: true })},
          ${db!.json({ academy: 'Academia de Oficios' })}
        ),
        (
          ${workspace[0].id}::uuid, 'camaras_seguridad', 'Cámaras de Seguridad',
          'course', 'active', 'Curso canónico de cámaras', 'fixed', 360, 'USD',
          ${db!.json({ classes: 22, modality: 'online', certification: true })},
          ${db!.json({ academy: 'Academia de Oficios' })}
        ),
        (
          ${workspace[0].id}::uuid, 'marketing_digital', 'Marketing Digital',
          'course', 'active', 'Curso canónico de marketing', 'fixed', 360, 'USD',
          ${db!.json({ classes: 14, modality: 'online', certification: true })},
          ${db!.json({ academy: 'Academia de Marketing' })}
        ),
        (
          ${workspace[0].id}::uuid, 'ingles_1', 'Inglés 1',
          'course', 'active', 'Curso canónico de inglés', 'fixed', 360, 'USD',
          ${db!.json({ classes: 24, modality: 'online', certification: true })},
          ${db!.json({ academy: 'Academia Cultural' })}
        )
    `;
  });

  afterAll(async () => {
    if (previousWorkspaceSlug === undefined) delete process.env.BUSINESS_WORKSPACE_SLUG;
    else process.env.BUSINESS_WORKSPACE_SLUG = previousWorkspaceSlug;
    await db?.end();
    await sql.end();
  });

  function envelope(text: string, identity = randomUUID()): InboundEnvelope {
    return {
      schema_version: 1,
      source: 'botpress',
      channel: 'telegram',
      integration_id: 'telegram-catalog-hotfix',
      external_message_id: `message-${randomUUID()}`,
      external_conversation_id: `conversation-${identity}`,
      external_user_id: `user-${identity}`,
      phone_e164: `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      trace_id: randomUUID(),
      message: {
        type: 'text',
        text,
        occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null,
      },
    };
  }

  function followUp(first: InboundEnvelope, text: string): InboundEnvelope {
    return {
      ...first,
      external_message_id: `message-${randomUUID()}`,
      trace_id: randomUUID(),
      message: {
        ...first.message,
        text,
        occurred_at: new Date(Date.now() + 1_000).toISOString(),
        reply_to_external_message_id: first.external_message_id,
      },
    };
  }

  async function runCanonicalTurn(input: InboundEnvelope) {
    const ingested = await processInboundMessage(input);
    await db!`
      UPDATE inbound_batches
      SET due_at = now() - interval '1 second'
      WHERE id = ${ingested.batch.id}::uuid
    `;
    const claimed = await claimBatch(
      { batch_id: ingested.batch.id, claimed_by: 'catalog-hotfix', trace_id: input.trace_id },
      claimDeps,
    );
    if (claimed.outcome !== 'claimed') throw new Error(`expected claimed, got ${claimed.outcome}`);

    const owned = claimed as unknown as ClaimedTurn;
    const route = routeCommercialTurn({ automationEnabled: true, claimed: owned });
    if (route.kind !== 'deterministic') {
      throw new Error(`expected deterministic route, got ${route.kind}:${route.reason}`);
    }
    const decision = applyDecisionPolicy(route.decision, owned);
    const authorizedOfferingCode = route.authorizedOfferingCode
      ?? owned.sales_context.offering_code;
    const committed = await commitClaimedDecision({
      turn_id: owned.turn_id,
      trace_id: input.trace_id,
      authorized_offering_code: authorizedOfferingCode,
      authorized_payment_plan: route.authorizedPaymentPlan ?? null,
      decision: decision as CommitDecisionInput['decision'],
      model: {
        provider: 'botpress',
        model: route.model,
        prompt_version: 'studyx-agent-a-sales-v17',
      },
      batch_id: owned.batch.id,
      claim_token: owned.batch.claim_token,
    }, { store: orchestrationStore });

    expect(committed.status).toBe('committed');
    expect(committed.batch_completion).toBe('completed');
    expect(committed.outbound).not.toBeNull();
    expect(committed.outbound?.content).toBe(decision.response);
    expect(committed.outbound?.content).not.toMatch(/no tengo ese dato confirmado/iu);
    expect(verifyAuthorizedEgress({
      content: committed.outbound!.content,
      manifest: committed.outbound!.authorized_egress,
    })).toEqual({ ok: true });

    const persisted = await db!<Array<{ response: string; outbound: string }>>`
      SELECT decision.response, outbound.content AS outbound
      FROM agent_decisions AS decision
      JOIN messages AS outbound ON outbound.id = decision.outbound_message_id
      WHERE decision.turn_id = ${owned.turn_id}::uuid
    `;
    expect(persisted).toEqual([{
      response: decision.response,
      outbound: decision.response,
    }]);
    return { route, committed };
  }

  it('guides “Quiero saber el catálogo” by canonical snapshot areas without an egress fallback', async () => {
    const { route, committed } = await runCanonicalTurn(envelope('Quiero saber el catálogo'));

    expect(route.origin).toBe('catalog_navigation');
    expect(committed.outbound?.content).toMatch(/Oficios.*Cultural.*Marketing/iu);
    expect(committed.outbound?.content).not.toMatch(
      /Redes Informáticas|Reparación de Celulares|Marketing Digital|Inglés 1/iu,
    );
  });

  it('guides “¿Qué cursos ofrecés aparte de ese?” by areas after a canonical course selection', async () => {
    const identity = randomUUID();
    const selected = envelope('Quiero información sobre el curso de Redes Informáticas', identity);
    await runCanonicalTurn(selected);

    const { route, committed } = await runCanonicalTurn(followUp(
      selected,
      '¿Qué cursos ofrecés aparte de ese?',
    ));

    expect(route.origin).toBe('catalog_navigation');
    expect(committed.outbound?.content).toMatch(/Oficios.*Cultural.*Marketing/iu);
    expect(committed.outbound?.content).not.toMatch(
      /Redes Informáticas|Reparación de Celulares|Marketing Digital|Inglés 1/iu,
    );
  });

  it('keeps exact Redes Informáticas guidance canonical through claim, router, commit and outbound', async () => {
    const { route, committed } = await runCanonicalTurn(envelope(
      'Quiero información sobre el curso de Redes Informáticas',
    ));

    expect(route.origin).toBe('course_discovery');
    expect(committed.outbound?.content).toMatch(/Redes Informáticas/iu);
    expect(committed.outbound?.content).toMatch(/16 clases/iu);
  });

  it('keeps area navigation bounded to three canonical courses', async () => {
    const { route, committed } = await runCanonicalTurn(envelope(
      'Quiero ver cursos de Academia de Oficios',
    ));

    expect(route.origin).toBe('catalog_navigation');
    const content = committed.outbound?.content ?? '';
    const namedCourses = [
      'Redes Informáticas',
      'Reparación de Celulares',
      'Electricidad Domiciliaria',
      'Cámaras de Seguridad',
    ].filter((name) => content.includes(name));
    expect(namedCourses).toHaveLength(3);
  });
});
