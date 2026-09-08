import { describe, expect, it } from 'vitest';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { authoritativelyPlanConversationTurnV1 } from '@/features/conversation/application/plan-conversation-turn';
import type { ConversationMoveV1 } from '@/features/conversation/domain/conversation-pipeline';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { buildBusinessContextView, buildCatalogIndexView } from '@/features/orchestration/domain/business-context';
import { loadContactIntakeV1 } from '@/lib/repositories/contact-intake.repository';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { sql } from '@/lib/db/orchestrator';

const databaseAvailable = process.env.TEST_DATABASE_URL;
const run = databaseAvailable ? describe : describe.skip;

run('partial commercial-truth veto', () => {
  it('does not persist an initial offer whose informational bubble was completely removed', async () => {
    const seeded = await seedConversationForAgentTurn({
      call_offer_count: 0, selected_offering_code: 'entrenamiento_funcional', intake_complete: true,
    });
    const committed = await commitAgentDecision({
      turn_id: seeded.turn_id, trace_id: seeded.trace_id,
      authorized_offering_code: 'entrenamiento_funcional', authorized_payment_plan: null,
      conversation_pipeline_v1: null,
      agent_turn_v2: { schema_version: 2, proposal: {
        ...seeded.proposalWithCallOfferAndFalsePrice,
        response: {
          messages: ['El diplomado sale USD 47.'],
          call_offer: 'Si querés, puedo llamarte para asesorarte.',
        },
      } as never },
      decision: seeded.placeholderDecision as never, model: seeded.model as never,
    });
    expect(committed.status).toBe('committed');
    const state = await new PostgresConversationStateStoreV1(sql).load('studyx', seeded.conversation_id, seeded.contact_id);
    expect(state).toMatchObject({ call_offer_count: 0, call_offer_status: 'not_offered', awaiting_reply: 'none' });
  });
  it('does not persist a call transition when its only declared invitation is vetoed', async () => {
    const seeded = await seedConversationForAgentTurn({
      call_offer_count: 0, selected_offering_code: 'entrenamiento_funcional', intake_complete: true,
    });
    const committed = await commitAgentDecision({
      turn_id: seeded.turn_id, trace_id: seeded.trace_id,
      authorized_offering_code: 'entrenamiento_funcional', authorized_payment_plan: null,
      conversation_pipeline_v1: null,
      agent_turn_v2: { schema_version: 2, proposal: {
        ...seeded.proposalWithCallOfferAndFalsePrice,
        response: {
          messages: ['Tenemos Entrenamiento Funcional.'],
          call_offer: 'Puedo llamarte por USD 47.',
        },
      } as never },
      decision: seeded.placeholderDecision as never, model: seeded.model as never,
    });
    expect(committed.status).toBe('committed');
    expect(committed.outbound?.content).not.toContain('USD 47');
    const state = await new PostgresConversationStateStoreV1(sql).load(
      'studyx', seeded.conversation_id, seeded.contact_id,
    );
    expect(state).toMatchObject({
      call_offer_count: 0, call_offer_status: 'not_offered', awaiting_reply: 'none',
    });
    const [eventCount] = await sql<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM conversation_sales_context_state_events_v1
      WHERE conversation_id = ${seeded.conversation_id}::uuid AND call_offer_count > 0
    `;
    expect(eventCount?.count).toBe(0);
  });
  it('keeps a safe transition when the vetoed sentence carries no stateful effect', async () => {
    // El turno ofrece una llamada Y afirma un precio inexistente. El guard veta
    // la oración del precio; la invitación sobrevive. La transición se había
    // calculado sobre AMBAS oraciones.
    //
    // El precio falso no cambia el efecto de la transición: el curso ya se
    // resolvió canónicamente y la invitación a llamada sobrevive intacta. Un
    // veto de esa oración no debe degradar una respuesta comercial sana a un
    // fallback técnico ni borrar la transición independiente.
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
            messages: ['Tenemos Entrenamiento Funcional. El diplomado sale USD 47.'],
            call_offer: '¿Te gustaría que te llamemos para contarte más?',
          },
        } as never,
      },
      decision: seeded.placeholderDecision as never,
      model: seeded.model as never,
    });

    expect(committed.status).toBe('committed');
    // Sólo cae el precio falso; la invitación segura sigue siendo la respuesta
    // entregada y su transición queda durable.
    expect(committed.outbounds?.map((message) => message.content)).toEqual([
      'Tenemos Entrenamiento Funcional.', '¿Te gustaría que te llamemos para contarte más?',
    ]);
    expect(committed.outbound?.content ?? '').not.toContain('USD 47');
    expect(committed.conversation_effects).toBeUndefined();

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
      response: 'Tenemos Entrenamiento Funcional.\n\n¿Te gustaría que te llamemos para contarte más?',
      business_action: null,
    });

    // La transición depende del curso canónico y de la invitación entregada,
    // no de la afirmación de precio que se vetó.
    const state = await new PostgresConversationStateStoreV1(sql).load(
      'studyx', seeded.conversation_id, seeded.contact_id,
    );
    expect(state?.call_offer_count).toBe(1);
    expect(state?.awaiting_reply).toBe('call_or_chat');
    // El fixture ya sembró 'entrenamiento_funcional' como curso elegido
    // ANTES de este turno; el punto es que sigue siendo ese valor sembrado —
    // el `move: 'select_course'` del turno vetado nunca se persistió — no
    // que se haya vuelto null.
    expect(state?.selected_offering_code).toBe('entrenamiento_funcional');
    expect(state?.stage).toBe('course_selected');
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
