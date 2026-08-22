import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  DECISION_INTENTS,
  DECISION_KINDS,
  MEMORY_CANDIDATE_TYPES,
  DECISION_NEXT_STATES,
  DECISION_RESPONSE_TYPES,
  DecisionValidationError,
} from '@/features/orchestration/domain/decision';
import {
  DECISION_V4_RESPONSE_TYPES,
  REQUEST_CALL_NOW_REASONS,
  assertDecisionBusinessActionPermitted,
  parseDecisionAnyVersion,
} from '@/features/orchestration/domain/decision-v4';
import { timedStage } from '@/lib/observability/structured-log';
import { isRetryableTransactionError } from '@/lib/db/transaction';
import {
  DecisionConflictError,
  DecisionPolicyError,
  DecisionTurnNotFoundError,
} from '@/lib/services/decision.service';
import { commitClaimedDecision } from '@/features/orchestration/application/commit-claimed-decision';
import { orchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';

/**
 * POST /api/agent/turns/:turn_id/decision
 *
 * Accepts Decision v2 and v3. v3 is a strict superset, so both versions are
 * valid on the wire and no producer has to change on a single day.
 *
 * Zod checks the shape; the domain parser checks the rules. Both run, in that
 * order, because a malformed body should be a 400 with field details while a
 * well-formed but forbidden decision should be a 422 naming the rule it broke.
 */

const memoryCandidateSchema = z.object({
  type: z.enum(MEMORY_CANDIDATE_TYPES),
  key: z.string().trim().min(1).max(128),
  value: z.string().trim().min(1).max(4096),
  source_quote: z.string().trim().min(1).max(4096),
  confidence: z.number().min(0).max(1),
}).strict();

const businessActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('send_pricing_info'), sku: z.string().trim().min(1).max(64) }).strict(),
  z.object({ type: z.literal('schedule_followup'), when_iso: z.string().datetime({ offset: true }) }).strict(),
  z.object({ type: z.literal('escalate_to_human'), reason: z.string().trim().min(1).max(256) }).strict(),
  z.object({ type: z.literal('mark_hot_lead'), score: z.number().min(0).max(1) }).strict(),
  z.object({
    type: z.literal('log_objection'),
    objection_key: z.string().trim().min(1).max(128),
    quote: z.string().trim().min(1).max(1024),
  }).strict(),
]);

const retrievalUsedSchema = z.object({
  kb: z.boolean(),
  long_term_memory: z.boolean(),
  summary_version: z.number().int().nonnegative().nullable(),
}).strict();

const decisionCoreShape = {
  intent: z.enum(DECISION_INTENTS),
  kind: z.enum(DECISION_KINDS),
  response: z.string().trim().min(1).max(4096).nullable(),
  response_type: z.enum(DECISION_RESPONSE_TYPES).nullable(),
  confidence: z.number().min(0).max(1),
  reason_code: z.string().trim().min(1).max(128),
  memory_candidates: z.array(memoryCandidateSchema).max(20),
  missing_information: z.array(z.string().trim().min(1).max(128)).max(20),
  next_state: z.enum(DECISION_NEXT_STATES),
};

const decisionV2Schema = z.object({
  schema_version: z.literal(2),
  business_action: z.null(),
  ...decisionCoreShape,
}).strict();

const decisionV3Schema = z.object({
  schema_version: z.literal(3),
  business_action: businessActionSchema.nullable(),
  retrieval_used: retrievalUsedSchema.nullable(),
  ...decisionCoreShape,
}).strict();

// v4 narrows the action union to what the backend executes or records; the
// dormant v3 shapes are not part of the v4 wire contract at all.
const businessActionV4Schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mark_hot_lead'), score: z.number().min(0).max(1) }).strict(),
  z.object({
    type: z.literal('log_objection'),
    objection_key: z.string().trim().min(1).max(128),
    quote: z.string().trim().min(1).max(1024),
  }).strict(),
  z.object({
    type: z.literal('request_call_now'),
    reason: z.enum(REQUEST_CALL_NOW_REASONS),
    course_of_interest: z.string().trim().min(1).max(128).optional(),
  }).strict(),
  // Shape only: the deep rules (plan_code must equal the batch-derived
  // choice, offering_sku must be a canonical sku and never a URL/amount)
  // live in the domain parser (`decision-v4.ts`'s `parseSendPaymentLinkAction`),
  // invoked below via `assertDecisionBusinessActionPermitted`/`parseDecisionAnyVersion`
  // — the same split already used for request_call_now.
  z.object({
    type: z.literal('send_payment_link'),
    plan_code: z.enum(['monthly_12', 'monthly_6', 'one_time']),
    offering_sku: z.string().trim().min(1).max(128).nullable(),
  }).strict(),
]);

const decisionV4Schema = z.object({
  schema_version: z.literal(4),
  business_action: businessActionV4Schema.nullable(),
  retrieval_used: retrievalUsedSchema.nullable(),
  ...decisionCoreShape,
  response_type: z.enum([...DECISION_RESPONSE_TYPES, ...DECISION_V4_RESPONSE_TYPES]).nullable(),
}).strict();

const decisionSchema = z
  .discriminatedUnion('schema_version', [decisionV2Schema, decisionV3Schema, decisionV4Schema])
  .superRefine((decision, context) => {
    try {
      assertDecisionBusinessActionPermitted(parseDecisionAnyVersion(decision));
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof DecisionValidationError ? error.code : 'INVALID_DECISION',
      });
    }
  });

const schema = z.object({
  turn_id: z.string().uuid(),
  trace_id: z.string().uuid(),
  decision: decisionSchema,
  model: z.object({
    provider: z.literal('botpress'),
    model: z.string().trim().min(1).max(256),
    prompt_version: z.string().trim().min(1).max(128),
  }).strict(),
  // Both optional together: a caller with no claimed batch (predating
  // batching, or a direct test) simply skips the batch close — see
  // commit-claimed-decision.ts. Present on every real Botpress commit.
  batch_id: z.string().uuid().nullable().optional(),
  claim_token: z.string().uuid().nullable().optional(),
}).strict();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ turn_id: string }> }
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { turn_id } = await context.params;
  if (turn_id !== parsed.data.turn_id) {
    return NextResponse.json({ error: 'TURN_ID_MISMATCH' }, { status: 409 });
  }

  try {
    const committed = await timedStage(
      'orchestration.decision_commit',
      { trace_id: parsed.data.trace_id, turn_id: parsed.data.turn_id },
      () => commitClaimedDecision(
        {
          ...parsed.data,
          batch_id: parsed.data.batch_id ?? null,
          claim_token: parsed.data.claim_token ?? null,
        },
        { store: orchestrationStore }
      )
    );
    return NextResponse.json(committed, { status: 200 });
  } catch (error) {
    if (error instanceof DecisionTurnNotFoundError) {
      return NextResponse.json({ error: error.code }, { status: 404 });
    }
    if (error instanceof DecisionConflictError) {
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
    if (error instanceof DecisionPolicyError) {
      return NextResponse.json({ error: error.code, reason: error.reason }, { status: 422 });
    }
    // Serialization/deadlock exhaustion is transient and the commit is
    // idempotent per turn: let the client retry instead of reporting a
    // permanent fault.
    if (isRetryableTransactionError(error)) {
      console.error('POST /api/agent/turns/:turn_id/decision transient contention:', error);
      return NextResponse.json({ error: 'TRANSIENT_DB_CONTENTION' }, { status: 503 });
    }
    console.error('POST /api/agent/turns/:turn_id/decision error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
