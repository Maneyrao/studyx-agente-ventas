import type { openLocalTestDatabase } from '../../tests/helpers/db';

type Sql = ReturnType<typeof openLocalTestDatabase>;

const ACTIVE_CALL_STATUSES = new Set([
  'requested',
  'dispatching',
  'provider_accepted',
  'dispatch_ambiguous',
  'in_progress',
]);

export type GoldenCallSettlementDecisionV1 =
  | { readonly kind: 'transition'; readonly expectedStatus: string }
  | { readonly kind: 'already_settled' }
  | { readonly kind: 'incompatible_terminal'; readonly status: string; readonly result: string | null };

export function goldenCallSettlementDecisionV1(input: {
  readonly status: string;
  readonly result: string | null;
  readonly desiredResult: string;
}): GoldenCallSettlementDecisionV1 {
  if (ACTIVE_CALL_STATUSES.has(input.status)) {
    return { kind: 'transition', expectedStatus: input.status };
  }
  if (input.status === 'completed' && input.result === input.desiredResult) {
    return { kind: 'already_settled' };
  }
  return { kind: 'incompatible_terminal', status: input.status, result: input.result };
}

/**
 * Local golden-fixture transition. It never guesses the latest call and never
 * rewrites a terminal provider result. The production immutability trigger
 * remains the last line of defence.
 */
export async function settleGoldenCallOutcomeV1(input: {
  readonly db: Sql;
  readonly callId: string;
  readonly externalConversationId: string;
  readonly workspaceSlug: string;
  readonly result: string;
}): Promise<'transitioned' | 'already_settled'> {
  return input.db.begin(async (transaction) => {
    const rows = await transaction<Array<{ status: string; result: string | null }>>`
      SELECT session.status, session.result
      FROM call_sessions session
      JOIN conversations conversation ON conversation.id=session.conversation_id
      JOIN channel_threads thread ON thread.id=conversation.channel_thread_id
      JOIN workspace_contacts membership ON membership.contact_id=conversation.contact_id
      JOIN workspaces workspace ON workspace.id=membership.workspace_id
      WHERE session.id=${input.callId}::uuid
        AND thread.external_conversation_id=${input.externalConversationId}
        AND workspace.slug=${input.workspaceSlug}
      FOR UPDATE OF session
    `;
    const row = rows[0];
    if (!row) throw new Error(`GOLDEN_CALL_SETTLEMENT_NOT_FOUND:${input.callId}`);

    const decision = goldenCallSettlementDecisionV1({
      status: row.status,
      result: row.result,
      desiredResult: input.result,
    });
    if (decision.kind === 'already_settled') return 'already_settled';
    if (decision.kind === 'incompatible_terminal') {
      throw new Error(
        `GOLDEN_CALL_SETTLEMENT_INCOMPATIBLE_TERMINAL:${input.callId}:${decision.status}:${decision.result ?? 'null'}`,
      );
    }

    const updated = await transaction<Array<{ id: string }>>`
      UPDATE call_sessions
      SET status='completed', completed_at=COALESCE(completed_at, now()),
        result=${input.result}, analysis_status='completed'
      WHERE id=${input.callId}::uuid AND status=${decision.expectedStatus}
      RETURNING id
    `;
    if (updated.length !== 1) {
      throw new Error(`GOLDEN_CALL_SETTLEMENT_CONCURRENT_CHANGE:${input.callId}`);
    }
    return 'transitioned';
  });
}
