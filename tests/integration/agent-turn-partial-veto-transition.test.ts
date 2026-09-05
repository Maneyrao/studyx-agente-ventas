import { describe, expect, it } from 'vitest';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { TECHNICAL_FALLBACK_TEXT_V1 } from '@/features/conversation/domain/technical-fallback';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { sql } from '@/lib/db/orchestrator';

const databaseAvailable = process.env.TEST_DATABASE_URL;
const run = databaseAvailable ? describe : describe.skip;

run('partial commercial-truth veto', () => {
  it('does not persist a transition computed on text that was not delivered', async () => {
    // El turno ofrece una llamada Y afirma un precio inexistente. El guard veta
    // la oración del precio; la invitación sobrevive. La transición se había
    // calculado sobre AMBAS oraciones.
    //
    // Ruling (fix round 1): un veto parcial NO rechaza el commit — eso dejaba
    // el turno mudo, porque la ruta de reparación existente sólo atrapa
    // `AgentTurnV2RejectedError` desde `authorizeAgentTurnV2`, que corre
    // ANTES del guard de verdad comercial. En cambio, el veto parcial cae por
    // la MISMA puerta que ya usa una supresión total: silencio técnico, con
    // su propio `reason_code` (`EGRESS_PARTIAL_VETO_TRANSITION_REFUSED`) para
    // que la telemetría distinga un veto parcial de uno total. El commit
    // sigue siendo exitoso, pero ninguna transición se persiste y el cliente
    // recibe el piso técnico en vez de una fracción vetada del texto.
    const seeded = await seedConversationForAgentTurn({
      call_offer_count: 0,
      selected_offering_code: 'entrenamiento_funcional',
    });

    // `commitAgentDecision` (decision.service.ts) no acepta `batch_id` ni
    // `claim_token` en su `CommitDecisionInput` — el fencing por lote vive en
    // la capa de orquestación (`commit-claimed-decision.ts`), no acá. Ver la
    // nota de deviación en `tests/helpers/agent-turn-fixtures.ts`.
    const committed = await commitAgentDecision({
      turn_id: seeded.turn_id,
      trace_id: seeded.trace_id,
      authorized_offering_code: 'entrenamiento_funcional',
      authorized_payment_plan: null,
      conversation_pipeline_v1: null,
      agent_turn_v2: {
        schema_version: 2,
        proposal: seeded.proposalWithCallOfferAndFalsePrice as never,
      },
      decision: seeded.placeholderDecision as never,
      model: seeded.model as never,
    });

    expect(committed.status).toBe('committed');
    // El cliente recibe el piso técnico, nunca la fracción sobreviviente del
    // texto vetado: ni la oración con el precio falso ni la de la invitación
    // a llamar aparecen en la respuesta persistida.
    expect(committed.outbound?.content).toBe(TECHNICAL_FALLBACK_TEXT_V1);
    expect(committed.outbound?.content ?? '').not.toContain('USD 47');
    expect(committed.outbound?.content ?? '').not.toContain('llamemos');
    expect(committed.conversation_effects?.technical_fallback_reason)
      .toBe('EGRESS_PARTIAL_VETO_TRANSITION_REFUSED');

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
      response: TECHNICAL_FALLBACK_TEXT_V1,
      business_action: null,
      reason_code: 'EGRESS_PARTIAL_VETO_TRANSITION_REFUSED',
    });

    // La prueba real: ninguna transición calculada sobre el texto pre-veto
    // se escribió. El offer de llamada que el modelo autoredactó no cuenta,
    // y el estado de la conversación queda exactamente como estaba antes del
    // turno.
    const state = await new PostgresConversationStateStoreV1(sql).load(
      'studyx', seeded.conversation_id, seeded.contact_id,
    );
    expect(state?.call_offer_count).toBe(0);
    expect(state?.awaiting_reply).toBe('none');
    // El fixture ya sembró 'entrenamiento_funcional' como curso elegido
    // ANTES de este turno; el punto es que sigue siendo ese valor sembrado —
    // el `move: 'select_course'` del turno vetado nunca se persistió — no
    // que se haya vuelto null.
    expect(state?.selected_offering_code).toBe('entrenamiento_funcional');
    expect(state?.stage).toBe('exploring');
  });
});
