import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ConversationMoveV1Schema } from '@/features/conversation/adapters/conversation-pipeline-schema';
import { PostgresConversationStateStoreV1 } from '@/features/conversation/adapters/postgres-conversation-state-store';
import { authoritativelyPlanConversationTurnV1 } from '@/features/conversation/application/plan-conversation-turn';
import { businessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { orchestrationStore } from '@/features/orchestration/adapters/postgres-orchestration-store';
import {
  buildBusinessContextView,
  buildCatalogIndexView,
} from '@/features/orchestration/domain/business-context';
import {
  loadAgentABrainConfig,
  loadBusinessWorkspaceConfig,
  loadConversationPipelineConfig,
} from '@/lib/config';
import { sql } from '@/lib/db/orchestrator';
import { timedStage } from '@/lib/observability/structured-log';

const bodySchema = z.object({
  trace_id: z.string().uuid(),
  move: ConversationMoveV1Schema,
}).strict();

interface TurnIdentityRow {
  workspace_id: string;
  conversation_id: string;
  contact_id: string;
}

async function loadTurnIdentity(turnId: string, workspaceSlug: string): Promise<TurnIdentityRow | null> {
  const rows = await sql<TurnIdentityRow[]>`
    SELECT workspace.id AS workspace_id,
           message.conversation_id,
           message.contact_id
    FROM messages AS message
    JOIN conversations AS conversation
      ON conversation.id = message.conversation_id
     AND conversation.contact_id = message.contact_id
    JOIN workspace_contacts AS workspace_contact
      ON workspace_contact.contact_id = message.contact_id
    JOIN workspaces AS workspace
      ON workspace.id = workspace_contact.workspace_id
     AND workspace.slug = ${workspaceSlug}
     AND workspace.status = 'active'
    WHERE message.id = ${turnId}::uuid
      AND message.direction = 'inbound'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Semantic input enters here, but no model-proposed commercial fact or action
 * leaves unchecked. The configured workspace, conversation state, course and
 * payment options are all reloaded server-side before planning.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ turn_id: string }> },
) {
  const brainConfig = loadAgentABrainConfig();
  if (!brainConfig.ready) {
    return NextResponse.json({ error: 'AGENT_A_BRAIN_CONFIGURATION_INVALID' }, { status: 503 });
  }
  if (!loadConversationPipelineConfig().enabled && !brainConfig.enabled) {
    return NextResponse.json({ error: 'CONVERSATION_PIPELINE_V1_DISABLED' }, { status: 409 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { turn_id: turnId } = await context.params;
  if (!z.string().uuid().safeParse(turnId).success) {
    return NextResponse.json({ error: 'INVALID_TURN_ID' }, { status: 400 });
  }

  try {
    const { workspaceSlug } = loadBusinessWorkspaceConfig();
    const [turn, rawBusiness, rawIndex] = await Promise.all([
      loadTurnIdentity(turnId, workspaceSlug),
      businessContextStore.loadBusinessContext(workspaceSlug),
      businessContextStore.loadCompleteIndex(workspaceSlug),
    ]);
    if (!turn) return NextResponse.json({ error: 'TURN_NOT_FOUND' }, { status: 404 });
    const result = await timedStage(
      'conversation.plan_v1',
      { trace_id: parsed.data.trace_id, turn_id: turnId },
      () => authoritativelyPlanConversationTurnV1({
        turn,
        workspace_slug: workspaceSlug,
        move: parsed.data.move,
        business_context: rawBusiness ? buildBusinessContextView(rawBusiness) : null,
        catalog_index: rawIndex ? buildCatalogIndexView(rawIndex) : null,
      }, {
        state_store: new PostgresConversationStateStoreV1(),
        call_facts: orchestrationStore,
      }),
    );
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('POST /api/agent/turns/:turn_id/plan error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
