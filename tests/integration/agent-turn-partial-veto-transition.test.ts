import { describe, expect, it } from 'vitest';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { authoritativelyPlanConversationTurnV1 } from '@/features/conversation/application/plan-conversation-turn';
import type { ConversationMoveV1 } from '@/features/conversation/domain/conversation-pipeline';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { buildBusinessContextView, buildCatalogIndexView } from '@/features/orchestration/domain/business-context';
import { loadContactIntakeV1 } from '@/lib/repositories/contact-intake.repository';
import { readCourseBonusCapabilityV1 } from '@/features/promotions/application/read-course-bonus-capability';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { sql } from '@/lib/db/orchestrator';

const databaseAvailable = process.env.TEST_DATABASE_URL;
const run = databaseAvailable ? describe : describe.skip;

run('commercial-truth boundary', () => {
  it.each([
    {
      label: 'a fabricated price in the narrative',
      messages: ['El diplomado sale USD 47.'],
      call_offer: 'Si querés, puedo llamarte para asesorarte.',
      subjects: ['price_not_canonical'],
    },
    {
      label: 'a fabricated price in the call invitation',
      messages: ['Tenemos Entrenamiento Funcional.'],
      call_offer: 'Puedo llamarte por USD 47.',
      subjects: ['price_not_canonical'],
    },
    {
      label: 'the unsupported two-payment plan',
      messages: ['Podés hacerlo en 2 cuotas de USD 180.'],
      call_offer: 'Si querés, puedo llamarte para asesorarte.',
      subjects: ['price_not_canonical', 'payment_plan_not_canonical'],
    },
    {
      label: 'a fabricated installment count with a real amount',
      messages: ['Podés pagar en 2 cuotas de USD 60.'],
      call_offer: 'Si querés, puedo llamarte para asesorarte.',
      subjects: ['payment_plan_not_canonical'],
    },
    {
      label: 'a fabricated installment count without an amount',
      messages: ['Se puede en 2 pagos.'],
      call_offer: 'Si querés, puedo llamarte para asesorarte.',
      subjects: ['payment_plan_not_canonical'],
    },
    {
      label: 'an unsupported course duration',
      messages: ['El curso dura 3 meses.'],
      call_offer: 'Si querés, puedo llamarte para asesorarte.',
      subjects: ['duration_not_canonical'],
    },
    {
      label: 'an unavailable course presented as offered',
      messages: ['Tenemos Mecánica Automotriz.'],
      call_offer: 'Si querés, puedo llamarte para asesorarte.',
      subjects: ['offering_not_canonical'],
    },
    {
      label: 'an unsupported employment guarantee',
      messages: ['Te aseguramos empleo al terminar.'],
      call_offer: 'Si querés, puedo llamarte para asesorarte.',
      subjects: ['forbidden_promise'],
    },
  ])('rejects $label without persisting an answer or its transition', async ({ messages, call_offer, subjects }) => {
    const seeded = await seedConversationForAgentTurn({
      call_offer_count: 0, selected_offering_code: 'entrenamiento_funcional', intake_complete: true,
    });
    const store = new PostgresConversationStateStoreV1(sql);
    const before = await store.load('studyx', seeded.conversation_id, seeded.contact_id);
    const input = {
      turn_id: seeded.turn_id, trace_id: seeded.trace_id,
      supports_multi_outbound: true,
      authorized_offering_code: 'entrenamiento_funcional', authorized_payment_plan: null,
      conversation_pipeline_v1: null,
      agent_turn_v2: { schema_version: 2 as const, proposal: {
        ...seeded.proposalWithCallOfferAndFalsePrice,
        response: { messages, call_offer },
      } as never },
      decision: seeded.placeholderDecision as never, model: seeded.model as never,
    };

    await expect(commitAgentDecision(input)).rejects.toMatchObject({
      code: 'DECISION_REJECTED',
      reason: 'AGENT_TURN_V2_REJECTED:COMMERCIAL_TRUTH_VIOLATION',
      subjects,
    });

    const [counts] = await sql<Array<{ decisions: number; outbounds: number; state_events: number }>>`
      SELECT
        (SELECT COUNT(*)::int FROM agent_decisions WHERE turn_id = ${seeded.turn_id}::uuid) AS decisions,
        (SELECT COUNT(*)::int FROM messages
          WHERE conversation_id = ${seeded.conversation_id}::uuid AND direction = 'outbound') AS outbounds,
        (SELECT COUNT(*)::int FROM conversation_sales_context_state_events_v1
          WHERE conversation_id = ${seeded.conversation_id}::uuid) AS state_events
    `;
    expect(counts).toEqual({ decisions: 0, outbounds: 0, state_events: 0 });
    expect(await store.load('studyx', seeded.conversation_id, seeded.contact_id)).toEqual(before);

    // The rejected turn remains available for Agent A's own reformulation.
    const repaired = await commitAgentDecision({
      ...input,
      agent_turn_v2: { schema_version: 2, proposal: {
        ...seeded.proposalWithCallOfferAndFalsePrice,
        response: {
          messages: ['El total es USD 360; podés elegir 12 pagos de USD 30 o 6 pagos de USD 60.'],
          call_offer: 'Si querés, puedo llamarte para asesorarte.',
        },
      } as never },
    });
    expect(repaired.status).toBe('committed');
    expect(repaired.outbounds.map((outbound) => outbound.content)).toEqual([
      'El total es USD 360; podés elegir 12 pagos de USD 30 o 6 pagos de USD 60.',
      'Si querés, puedo llamarte para asesorarte.',
    ]);
    expect(await store.load('studyx', seeded.conversation_id, seeded.contact_id)).toMatchObject({
      call_offer_count: 1, call_offer_status: 'offered', awaiting_reply: 'call_or_chat',
    });
  });

  it('rejects the whole repaired reply instead of rewriting Agent A around an unknown offering', async () => {
    const seeded = await seedConversationForAgentTurn({
      call_offer_count: 0, selected_offering_code: null, intake_complete: true,
    });
    const safeQuestion = '¿Te interesaría más aprender un idioma o algo orientado a negocios?';

    await expect(commitAgentDecision({
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      supports_multi_outbound: true,
      authorized_offering_code: null,
      authorized_payment_plan: null,
      conversation_pipeline_v1: null,
      agent_turn_v2: { schema_version: 2, proposal: {
        ...seeded.proposalWithCallOfferAndFalsePrice,
        move: {
          schema_version: 1,
          move: 'unknown',
          secondary_moves: [],
          vetoes: [],
          confidence: 0.7,
        },
        response: {
          messages: [
            'Te recomiendo el curso de Negocios Internacionales para trabajar con empresas de otros países.',
            safeQuestion,
          ],
          call_offer: null,
        },
        repair_of: {
          rejection_id: '00000000-0000-4000-8000-000000000449',
          attempt: 1,
        },
      } as never },
      decision: seeded.placeholderDecision as never,
      model: seeded.model as never,
    })).rejects.toMatchObject({
      code: 'DECISION_REJECTED',
      reason: 'AGENT_TURN_V2_REJECTED:COMMERCIAL_TRUTH_VIOLATION',
      subjects: ['offering_not_canonical'],
    });

    const [counts] = await sql<Array<{ decisions: number; outbounds: number }>>`
      SELECT
        (SELECT COUNT(*)::int FROM agent_decisions WHERE turn_id = ${seeded.turn_id}::uuid) AS decisions,
        (SELECT COUNT(*)::int FROM messages
          WHERE conversation_id = ${seeded.conversation_id}::uuid AND direction = 'outbound') AS outbounds
    `;
    expect(counts).toEqual({ decisions: 0, outbounds: 0 });
    expect(await new PostgresConversationStateStoreV1(sql).load(
      'studyx', seeded.conversation_id, seeded.contact_id,
    )).toMatchObject({ selected_offering_code: null, stage: 'exploring' });
  });

  it('commits canonical commercial facts in Agent A’s own paragraphs', async () => {
    const seeded = await seedConversationForAgentTurn({
      call_offer_count: 0,
      selected_offering_code: 'entrenamiento_funcional',
      intake_complete: true,
    });

    // `commitAgentDecision` (decision.service.ts) no acepta `batch_id` ni
    // `claim_token` en su `CommitDecisionInput` — el fencing por lote vive en
    // la capa de orquestación (`commit-claimed-decision.ts`), no acá. Ver la
    // nota de deviación en `tests/helpers/agent-turn-fixtures.ts`.
    const committed = await commitAgentDecision({
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      supports_multi_outbound: true,
      authorized_offering_code: 'entrenamiento_funcional',
      authorized_payment_plan: null,
      conversation_pipeline_v1: null,
      agent_turn_v2: {
        schema_version: 2,
        proposal: {
          ...seeded.proposalWithCallOfferAndFalsePrice,
          response: {
            messages: ['Tenemos Entrenamiento Funcional. Podés elegir 12 pagos de USD 30, 6 de USD 60 o un pago de USD 360.'],
            call_offer: '¿Te gustaría que te llamemos para contarte más?',
          },
        } as never,
      },
      decision: seeded.placeholderDecision as never,
      model: seeded.model as never,
    });
    expect(committed.status).toBe('committed');
    expect(committed.outbounds.map((outbound) => outbound.content)).toEqual([
      'Tenemos Entrenamiento Funcional. Podés elegir 12 pagos de USD 30, 6 de USD 60 o un pago de USD 360.',
      '¿Te gustaría que te llamemos para contarte más?',
    ]);

    const [decision] = await sql<Array<{
      response: string | null;
      response_type: string | null;
      business_action: unknown;
      reason_code: string;
      next_state: string;
    }>>`
      SELECT response, response_type, business_action, reason_code, next_state
      FROM agent_decisions
      WHERE turn_id = ${seeded.turn_id}::uuid
    `;
    expect(decision).toMatchObject({
      response: 'Tenemos Entrenamiento Funcional. Podés elegir 12 pagos de USD 30, 6 de USD 60 o un pago de USD 360.\n\n¿Te gustaría que te llamemos para contarte más?',
      response_type: 'call_offer',
      business_action: null,
      reason_code: 'AGENT_A_PLANNERLESS_V2',
      next_state: 'waiting_user',
    });

    // Canonical commercial facts preserve the authored copy and advance
    // the eligible call invitation’s own durable ledger.
    const state = await new PostgresConversationStateStoreV1(sql).load(
      'studyx', seeded.conversation_id, seeded.contact_id,
    );
    expect(state?.call_offer_count).toBe(1);
    expect(state?.awaiting_reply).toBe('call_or_chat');
    expect(state?.selected_offering_code).toBe('entrenamiento_funcional');
    expect(state?.stage).toBe('course_selected');
  });

  it('reloads a cited active syllabus source through the decision boundary', async () => {
    const seeded = await seedConversationForAgentTurn({
      selected_offering_code: 'entrenamiento_funcional',
      intake_complete: true,
    });
    const syllabus = 'Clase 1: fundamentos del entrenamiento. Clase 2: planificación de rutinas.';
    const [source] = await sql<Array<{ id: string }>>`
      INSERT INTO knowledge_sources (
        workspace_id, source_type, title, content, status, metadata
      ) VALUES (
        ${seeded.workspace_id}::uuid,
        'offering',
        ${`Temario prueba — ${seeded.trace_id}`},
        ${syllabus},
        'active',
        ${sql.json({ course_code: 'entrenamiento_funcional' })}
      )
      RETURNING id
    `;

    const committed = await commitAgentDecision({
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      supports_multi_outbound: true,
      authorized_offering_code: 'entrenamiento_funcional',
      authorized_payment_plan: null,
      conversation_pipeline_v1: null,
      agent_turn_v2: {
        schema_version: 2,
        proposal: {
          ...seeded.proposalWithCallOfferAndFalsePrice,
          move: {
            schema_version: 1,
            move: 'ask_course_information',
            secondary_moves: [],
            vetoes: [],
            confidence: 1,
            course_reference: 'entrenamiento_funcional',
          },
          response: { messages: [syllabus], call_offer: null },
          used_fact_ids: [`knowledge-source:${source!.id}`],
          proposed_action: { type: 'none' },
        } as never,
      },
      decision: seeded.placeholderDecision as never,
      model: seeded.model as never,
    });

    expect(committed.status).toBe('committed');
    expect(committed.outbound?.content).toBe(syllabus);
  });

  it('persists one canonical course named by Agent A through prepare, commit and capability read', async () => {
    const previousBonusFlag = process.env.CENTRAL_CARGA_BONUS_ENABLED;
    process.env.CENTRAL_CARGA_BONUS_ENABLED = 'true';
    const seeded = await seedConversationForAgentTurn({
      selected_offering_code: null,
      intake_complete: true,
      first_message: 'Inglés 1 me interesa, pero el precio me sigue pareciendo caro.',
    });
    try {
      await sql`UPDATE promotions promotion SET active=true,updated_at=now()
        FROM workspaces workspace
        WHERE promotion.workspace_id=workspace.id AND workspace.slug='studyx'
          AND promotion.promotion_code='ingles_1_mas_ingles_2'`;
      const committed = await commitAgentDecision({
        turn_id: seeded.turn_id,
        trace_id: seeded.trace_id,
        authorized_offering_code: null,
        authorized_payment_plan: null,
        conversation_pipeline_v1: null,
        agent_turn_v2: {
          schema_version: 2,
          proposal: {
            ...seeded.proposalWithCallOfferAndFalsePrice,
            move: {
              schema_version: 1, move: 'ask_course_information', secondary_moves: [],
              vetoes: [], confidence: 1,
            },
            response: {
              messages: ['Inglés 1 te da una base concreta para empezar.'],
              call_offer: null,
            },
            memory_candidates: [{
              type: 'objection', key: 'price_objection',
              value: 'El precio sigue pareciéndole caro',
              source_quote: 'el precio me sigue pareciendo caro', confidence: 1,
            }],
            proposed_action: { type: 'none' },
          } as never,
        },
        decision: seeded.placeholderDecision as never,
        model: seeded.model as never,
      });
      expect(committed.status).toBe('committed');
      expect(await sql`SELECT interest_offering_code,price_objection_count
        FROM conversation_promotion_context_v1
        WHERE conversation_id=${seeded.conversation_id}::uuid`).toEqual([{
        interest_offering_code: 'ingles_1', price_objection_count: 1,
      }]);
      await expect(readCourseBonusCapabilityV1({
        workspace_slug:'studyx', contact_id:seeded.contact_id,
        conversation_id:seeded.conversation_id, channel:'text', selected_offering_code:null,
      }, {db:sql})).resolves.toMatchObject({
        status:'review_available', may_request_review:true, interest_offering_code:'ingles_1',
      });
    } finally {
      await sql`UPDATE promotions promotion SET active=false,updated_at=now()
        FROM workspaces workspace
        WHERE promotion.workspace_id=workspace.id AND workspace.slug='studyx'
          AND promotion.promotion_code='ingles_1_mas_ingles_2'`;
      if (previousBonusFlag === undefined) delete process.env.CENTRAL_CARGA_BONUS_ENABLED;
      else process.env.CENTRAL_CARGA_BONUS_ENABLED = previousBonusFlag;
    }
  });

  it('preserves an unavailable-course denial and the following question', async () => {
    const seeded = await seedConversationForAgentTurn({
      call_offer_count: 0, selected_offering_code: 'entrenamiento_funcional', intake_complete: true,
    });
    const content = 'No ofrecemos Mecánica Automotriz ni 2 cuotas de USD 180. ¿Buscabas 2 pagos? Podemos seguir con Entrenamiento Funcional.';
    const committed = await commitAgentDecision({
      turn_id: seeded.turn_id, trace_id: seeded.trace_id,
      authorized_offering_code: 'entrenamiento_funcional', authorized_payment_plan: null,
      conversation_pipeline_v1: null,
      agent_turn_v2: { schema_version: 2, proposal: {
        ...seeded.proposalWithCallOfferAndFalsePrice,
        response: { messages: [content], call_offer: null },
      } as never },
      decision: seeded.placeholderDecision as never, model: seeded.model as never,
    });
    expect(committed.outbound?.content).toBe(content);
  });

  it('ignores an unproven confirmed phone without rejecting Agent A copy', async () => {
    const seeded = await seedConversationForAgentTurn({
      call_offer_count: 0,
      selected_offering_code: 'entrenamiento_funcional',
      intake_complete: true,
    });
    const content = 'Seguimos con Entrenamiento Funcional. ¿Qué te gustaría saber?';

    const committed = await commitAgentDecision({
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      authorized_offering_code: 'entrenamiento_funcional',
      authorized_payment_plan: null,
      conversation_pipeline_v1: null,
      agent_turn_v2: {
        schema_version: 2,
        proposal: {
          ...seeded.proposalWithCallOfferAndFalsePrice,
          confirmed_phone: '+5491199999999',
          response: { messages: [content], call_offer: null },
        } as never,
      },
      decision: seeded.placeholderDecision as never,
      model: seeded.model as never,
    });

    expect(committed.status).toBe('committed');
    expect(committed.outbound?.content).toBe(content);
  });

  it('keeps a pipeline transition when only an unrelated false price is vetoed', async () => {
    // La misma propiedad debe valer para la autoridad pipeline: el precio
    // removido no transporta la llamada ni el curso que persistirá.
    const seeded = await seedConversationForAgentTurn({
      call_offer_count: 0,
      selected_offering_code: 'entrenamiento_funcional',
      intake_complete: true,
    });

    const move = seeded.moveSelectCourseWithCallOffer as unknown as ConversationMoveV1;
    const businessStore = new PostgresBusinessContextStore(sql);
    const [rawBusiness, rawCatalogIndex] = await Promise.all([
      businessStore.loadBusinessContext('studyx'),
      businessStore.loadCompleteIndex('studyx'),
    ]);
    const businessContext = rawBusiness ? buildBusinessContextView(rawBusiness) : null;
    const catalogIndex = rawCatalogIndex ? buildCatalogIndexView(rawCatalogIndex) : null;

    // `plan_hash` no se puede precalcular en el fixture: depende del estado
    // leído en el momento del commit. Se deriva acá con el mismo planificador
    // determinista que `prepareConversationPipelineCommitV1` vuelve a correr
    // adentro de `commitAgentDecision`, igual que hace
    // `tests/integration/conversation-pipeline-v1.test.ts`.
    const planned = await authoritativelyPlanConversationTurnV1({
      turn: {
        workspace_id: seeded.workspace_id,
        conversation_id: seeded.conversation_id,
        contact_id: seeded.contact_id,
      },
      workspace_slug: 'studyx',
      move,
      business_context: businessContext,
      catalog_index: catalogIndex,
    }, {
      state_store: new PostgresConversationStateStoreV1(sql),
      contact_intake: (contactId) => loadContactIntakeV1(contactId, sql),
    });
    // El escenario depende de que el planner determinista SÍ decida ofrecer
    // la llamada para este move sobre este estado — si esto no se cumple el
    // resto del test no ejercita nada parcial, así que se afirma primero.
    expect(planned.plan.should_offer_call).toBe(true);

    const committed = await commitAgentDecision({
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      authorized_offering_code: null,
      authorized_payment_plan: null,
      conversation_pipeline_v1: {
        // El schema de commit espera arrays mutables; el tipo de dominio los
        // declara readonly. Mismo patrón que
        // tests/integration/conversation-pipeline-v1.test.ts.
        move: { ...move, secondary_moves: [...move.secondary_moves], vetoes: [...move.vetoes] },
        plan_hash: planned.plan_hash,
        composition: seeded.compositionWithCallOfferAndFalsePrice as never,
      },
      agent_turn_v2: null,
      decision: seeded.placeholderDecision as never,
      model: seeded.model as never,
    });

    expect(committed.status).toBe('committed');
    expect(committed.outbound?.content).toBe('Genial, ese es un gran curso.\n\n¿Preferís que sigamos por chat o querés solicitar una llamada?');
    expect(committed.outbound?.content ?? '').not.toContain('USD 47');
    expect(committed.outbound?.content).toContain('llamada');
    expect(committed.conversation_effects).toBeUndefined();

    const [decision] = await sql<Array<{
      response: string | null;
      business_action: unknown;
      reason_code: string;
    }>>`
      SELECT response, business_action, reason_code
      FROM agent_decisions
      WHERE turn_id = ${seeded.turn_id}::uuid
    `;
    expect(decision).toMatchObject({
      response: 'Genial, ese es un gran curso.\n\n¿Preferís que sigamos por chat o querés solicitar una llamada?',
      business_action: null,
    });

    // La transición se escribe porque el texto que la respalda sí llegó al
    // cliente; sólo se removió el precio no canónico.
    const state = await new PostgresConversationStateStoreV1(sql).load(
      'studyx', seeded.conversation_id, seeded.contact_id,
    );
    expect(state?.call_offer_count).toBe(1);
    expect(state?.awaiting_reply).toBe('call_or_chat');
    expect(state?.selected_offering_code).toBe('entrenamiento_funcional');
    expect(state?.stage).toBe('course_selected');
  });
});
