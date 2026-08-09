import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  DECISION_INTENTS,
  DECISION_KINDS,
  DECISION_NEXT_STATES,
  DECISION_RESPONSE_TYPES,
  DecisionValidationError,
  parseDecisionV2,
} from '@/features/orchestration/domain/decision';
import {
  commitAgentDecision,
  DecisionConflictError,
  DecisionPolicyError,
  DecisionTurnNotFoundError,
} from '@/lib/services/decision.service';

const memoryCandidateSchema = z.object({
  type: z.string().trim().min(1).max(128),
  key: z.string().trim().min(1).max(128),
  value: z.string().trim().min(1).max(4096),
  source_quote: z.string().trim().min(1).max(4096),
  confidence: z.number().min(0).max(1),
}).strict();

const decisionSchema = z.object({
  schema_version: z.literal(2),
  intent: z.enum(DECISION_INTENTS),
  kind: z.enum(DECISION_KINDS),
  response: z.string().trim().min(1).max(4096).nullable(),
  response_type: z.enum(DECISION_RESPONSE_TYPES).nullable(),
  confidence: z.number().min(0).max(1),
  reason_code: z.string().trim().min(1).max(128),
  business_action: z.null(),
  memory_candidates: z.array(memoryCandidateSchema).max(20),
  missing_information: z.array(z.string().trim().min(1).max(128)).max(20),
  next_state: z.enum(DECISION_NEXT_STATES),
}).strict().superRefine((decision, context) => {
  try {
    parseDecisionV2(decision);
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
    return NextResponse.json(await commitAgentDecision(parsed.data), { status: 200 });
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
    console.error('POST /api/agent/turns/:turn_id/decision error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
