import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import {
  applyPromotionContextRepairPlanV1,
  derivePromotionContextRepairPlanV1,
} from '../src/features/promotions/application/read-course-bonus-capability';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface PromotionContextRepairArgsV1 {
  readonly conversation_id: string;
  readonly offering_code: string;
  readonly evidence_turn_ids: readonly string[];
  readonly apply: boolean;
}

export function parsePromotionContextRepairArgsV1(argv: readonly string[]): PromotionContextRepairArgsV1 {
  const values = new Map<string, string>();
  const evidenceTurnIds: string[] = [];
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === '--apply') {
      apply = true;
      continue;
    }
    if (!['--conversation-id', '--offering-code', '--evidence-turn-id'].includes(token)) {
      throw new Error(`REPAIR_UNKNOWN_ARGUMENT:${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`REPAIR_ARGUMENT_VALUE_REQUIRED:${token}`);
    if (token === '--evidence-turn-id') evidenceTurnIds.push(value);
    else values.set(token, value);
    index += 1;
  }
  const conversationId = values.get('--conversation-id');
  const offeringCode = values.get('--offering-code');
  if (!conversationId) throw new Error('REPAIR_CONVERSATION_ID_REQUIRED');
  if (!UUID.test(conversationId)) throw new Error('REPAIR_CONVERSATION_ID_INVALID');
  if (!offeringCode) throw new Error('REPAIR_OFFERING_CODE_REQUIRED');
  if (!/^[a-z0-9][a-z0-9_-]{1,127}$/u.test(offeringCode)) throw new Error('REPAIR_OFFERING_CODE_INVALID');
  if (evidenceTurnIds.length === 0) throw new Error('REPAIR_EVIDENCE_TURN_ID_REQUIRED');
  if (evidenceTurnIds.some((turnId) => !UUID.test(turnId))) {
    throw new Error('REPAIR_EVIDENCE_TURN_ID_INVALID');
  }
  return {
    conversation_id: conversationId,
    offering_code: offeringCode,
    evidence_turn_ids: [...new Set(evidenceTurnIds)],
    apply,
  };
}

interface AcceptedDecisionEvidenceRowV1 {
  readonly workspace_id: string;
  readonly conversation_id: string;
  readonly contact_id: string;
  readonly turn_id: string;
  readonly decision_kind: string;
  readonly outbound_message_id: string | null;
  readonly selected_offering_code: string | null;
  readonly memory_candidates: unknown;
}

export function collectAcceptedPriceObjectionTurnIdsV1(
  rows: readonly AcceptedDecisionEvidenceRowV1[],
  target: {
    readonly workspace_id: string;
    readonly conversation_id: string;
    readonly contact_id: string;
    readonly offering_code: string;
  },
): string[] {
  const result: string[] = [];
  for (const row of rows) {
    if (row.workspace_id !== target.workspace_id
      || row.conversation_id !== target.conversation_id
      || row.contact_id !== target.contact_id) {
      throw new Error('REPAIR_SCOPE_MISMATCH');
    }
    if (row.selected_offering_code !== null
      && row.selected_offering_code !== target.offering_code) {
      throw new Error('REPAIR_INTERVENING_COURSE_CHANGE');
    }
    if (!['reply', 'clarify'].includes(row.decision_kind) || row.outbound_message_id === null) continue;
    if (!Array.isArray(row.memory_candidates)) continue;
    const hasStructuredEvidence = row.memory_candidates.some((candidate) => {
      if (candidate === null || typeof candidate !== 'object') return false;
      const value = candidate as Record<string, unknown>;
      return value.type === 'objection'
        && value.key === 'price_objection'
        && typeof value.source_quote === 'string'
        && value.source_quote.trim().length > 0;
    });
    if (hasStructuredEvidence && !result.includes(row.turn_id)) result.push(row.turn_id);
  }
  return result;
}

async function main(): Promise<void> {
  const args = parsePromotionContextRepairArgsV1(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
  const db = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    connection: { application_name: 'studyx-promotion-context-repair' },
  });
  try {
    const targets = await db<Array<{
      workspace_id: string;
      conversation_id: string;
      contact_id: string;
      interest_offering_code: string | null;
      price_objection_count: number | null;
      source_turn_id: string | null;
      active_offer_status: 'pending_review' | 'offered' | 'accepted' | 'cancelled' | 'expired' | 'attached' | null;
    }>>`
      SELECT
        state.workspace_id,
        conversation.id AS conversation_id,
        conversation.contact_id,
        context.interest_offering_code,
        context.price_objection_count,
        context.source_turn_id,
        active_offer.status AS active_offer_status
      FROM conversations conversation
      JOIN conversation_sales_context_states_v1 state
        ON state.conversation_id = conversation.id
       AND state.contact_id = conversation.contact_id
      JOIN offerings offering
        ON offering.workspace_id = state.workspace_id
       AND offering.code = ${args.offering_code}
       AND offering.status = 'active'
      LEFT JOIN conversation_promotion_context_v1 context
        ON context.workspace_id = state.workspace_id
       AND context.conversation_id = conversation.id
       AND context.contact_id = conversation.contact_id
      LEFT JOIN LATERAL (
        SELECT offer.status
        FROM promotion_offers offer
        JOIN promotions promotion ON promotion.id = offer.promotion_id
        JOIN offerings paid ON paid.id = offer.paid_offering_id
        WHERE offer.workspace_id = state.workspace_id
          AND offer.conversation_id = conversation.id
          AND offer.contact_id = conversation.contact_id
          AND paid.code = ${args.offering_code}
          AND offer.status IN ('pending_review','offered','accepted','attached')
        ORDER BY offer.created_at DESC
        LIMIT 1
      ) active_offer ON true
      WHERE conversation.id = ${args.conversation_id}::uuid
    `;
    if (targets.length !== 1) throw new Error('REPAIR_TARGET_NOT_UNIQUE');
    const target = targets[0]!;
    const rows = await db<AcceptedDecisionEvidenceRowV1[]>`
      SELECT
        ${target.workspace_id}::uuid AS workspace_id,
        turn.conversation_id,
        turn.contact_id,
        decision.turn_id,
        decision.decision_kind,
        decision.outbound_message_id,
        transition.selected_offering_code,
        decision.memory_candidates
      FROM agent_decisions decision
      JOIN messages turn ON turn.id = decision.turn_id
      LEFT JOIN LATERAL (
        SELECT event.selected_offering_code
        FROM conversation_sales_context_state_events_v1 event
        WHERE event.workspace_id = ${target.workspace_id}::uuid
          AND event.conversation_id = turn.conversation_id
          AND event.contact_id = turn.contact_id
          AND event.source_turn_id = decision.turn_id
        ORDER BY event.state_version DESC
        LIMIT 1
      ) transition ON true
      WHERE turn.conversation_id = ${args.conversation_id}::uuid
        AND turn.contact_id = ${target.contact_id}::uuid
        AND turn.direction = 'inbound'
        AND decision.turn_id = ANY(${args.evidence_turn_ids}::uuid[])
      ORDER BY turn.conversation_seq, decision.created_at, decision.id
    `;
    const loadedTurnIds = new Set(rows.map((row) => row.turn_id));
    if (args.evidence_turn_ids.some((turnId) => !loadedTurnIds.has(turnId))) {
      throw new Error('REPAIR_EVIDENCE_TURN_OUT_OF_SCOPE');
    }
    const evidence = collectAcceptedPriceObjectionTurnIdsV1(rows, {
      ...target,
      offering_code: args.offering_code,
    });
    const plan = derivePromotionContextRepairPlanV1({
      workspace_id: target.workspace_id,
      conversation_id: target.conversation_id,
      contact_id: target.contact_id,
      interest_offering_code: args.offering_code,
      existing: target.price_objection_count === null ? null : {
        interest_offering_code: target.interest_offering_code,
        price_objection_count: target.price_objection_count,
        source_turn_id: target.source_turn_id,
      },
      accepted_price_objection_turn_ids: evidence,
      active_offer_status: target.active_offer_status,
    });
    const result = args.apply ? await applyPromotionContextRepairPlanV1(db, plan) : null;
    process.stdout.write(`${JSON.stringify({
      mode: args.apply ? 'apply' : 'dry-run',
      conversation_id: plan.conversation_id,
      interest_offering_code: plan.interest_offering_code,
      previous_price_objection_count: plan.previous_price_objection_count,
      proposed_price_objection_count: plan.proposed_price_objection_count,
      evidence_source_turn_ids: plan.evidence_source_turn_ids,
      protected_offer: plan.protected_offer,
      applied: result,
    }, null, 2)}\n`);
  } finally {
    await db.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'PROMOTION_CONTEXT_REPAIR_FAILED';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
