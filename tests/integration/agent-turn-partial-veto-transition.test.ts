import { describe, expect, it } from 'vitest';
import { commitAgentDecision } from '@/lib/services/decision.service';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { seedConversationForAgentTurn } from '../helpers/agent-turn-fixtures';
import { sql } from '@/lib/db/orchestrator';

const databaseAvailable = process.env.TEST_DATABASE_URL;
const run = databaseAvailable ? describe : describe.skip;

run('partial commercial-truth veto', () => {
  it('does not persist a transition computed on text that was not delivered', async () => {
    // El turno ofrece una llamada Y afirma un precio inexistente. El guard veta
    // la oración del precio; la invitación sobrevive. La transición se había
    // calculado sobre AMBAS oraciones.
    const seeded = await seedConversationForAgentTurn({
      call_offer_count: 0,
      selected_offering_code: 'entrenamiento_funcional',
    });

    // `commitAgentDecision` (decision.service.ts) no acepta `batch_id` ni
    // `claim_token` en su `CommitDecisionInput` — el fencing por lote vive en
    // la capa de orquestación (`commit-claimed-decision.ts`), no acá. Ver la
    // nota de deviación en `tests/helpers/agent-turn-fixtures.ts`.
    await expect(commitAgentDecision({
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
    })).rejects.toThrow('PARTIAL_VETO_TRANSITION_REFUSED');

    const state = await new PostgresConversationStateStoreV1(sql).load(
      'studyx', seeded.conversation_id, seeded.contact_id,
    );
    expect(state?.call_offer_count).toBe(0);
  });
});
