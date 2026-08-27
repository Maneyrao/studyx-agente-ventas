import type { DbClient } from '@/lib/db/types';
import { sql } from '@/lib/db/orchestrator';
import type {
  ConversationStateTransitionV1,
  ConversationStateV1,
} from '../domain/conversation-pipeline';
import type { ConversationStateStoreV1 } from '../ports/conversation-state-store';

interface ConversationStateRowV1 extends Omit<ConversationStateV1, 'created_at' | 'updated_at'> {
  created_at: Date | string;
  updated_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRow(row: ConversationStateRowV1): ConversationStateV1 {
  return { ...row, created_at: iso(row.created_at), updated_at: iso(row.updated_at) };
}

export class PostgresConversationStateStoreV1 implements ConversationStateStoreV1 {
  constructor(private readonly db: DbClient = sql) {}

  async load(
    workspaceSlug: string,
    conversationId: string,
    contactId: string,
  ): Promise<ConversationStateV1 | null> {
    const rows = await this.db<ConversationStateRowV1[]>`
      SELECT state.*
      FROM conversation_sales_context_states_v1 AS state
      JOIN workspaces AS workspace ON workspace.id = state.workspace_id
      JOIN conversations AS conversation
        ON conversation.id = state.conversation_id
       AND conversation.contact_id = state.contact_id
      WHERE workspace.slug = ${workspaceSlug}
        AND workspace.status = 'active'
        AND state.conversation_id = ${conversationId}::uuid
        AND state.contact_id = ${contactId}::uuid
      LIMIT 1
    `;
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async transition(input: ConversationStateTransitionV1): Promise<ConversationStateV1> {
    const rows = await this.db<ConversationStateRowV1[]>`
      WITH eligible AS (
        SELECT workspace.id AS workspace_id
        FROM workspaces AS workspace
        JOIN conversations AS conversation
          ON conversation.id = ${input.conversation_id}::uuid
         AND conversation.contact_id = ${input.contact_id}::uuid
        WHERE workspace.slug = ${input.workspace_slug}
          AND workspace.status = 'active'
          AND (
            ${input.selected_offering_code}::text IS NULL
            OR EXISTS (
              SELECT 1
              FROM offerings AS offering
              WHERE offering.workspace_id = workspace.id
                AND offering.status = 'active'
                AND offering.code = ${input.selected_offering_code}
            )
          )
        LIMIT 1
      ), prior_source AS (
        SELECT 1
        FROM conversation_sales_context_state_events_v1 AS event
        JOIN eligible ON eligible.workspace_id = event.workspace_id
        WHERE event.conversation_id = ${input.conversation_id}::uuid
          AND ${input.source_turn_id}::uuid IS NOT NULL
          AND event.source_turn_id = ${input.source_turn_id}::uuid
        LIMIT 1
      ), upserted AS (
        INSERT INTO conversation_sales_context_states_v1 (
          workspace_id, conversation_id, contact_id,
          selected_offering_code, selected_payment_plan, stage,
          call_preference, call_offer_status, awaiting_reply, source_turn_id
        )
        SELECT
          eligible.workspace_id, ${input.conversation_id}::uuid, ${input.contact_id}::uuid,
          ${input.selected_offering_code}, ${input.selected_payment_plan}, ${input.stage},
          ${input.call_preference}, ${input.call_offer_status}, ${input.awaiting_reply},
          ${input.source_turn_id}::uuid
        FROM eligible
        WHERE NOT EXISTS (SELECT 1 FROM prior_source)
        ON CONFLICT (workspace_id, conversation_id) DO UPDATE
        SET contact_id = EXCLUDED.contact_id,
            selected_offering_code = EXCLUDED.selected_offering_code,
            selected_payment_plan = EXCLUDED.selected_payment_plan,
            stage = EXCLUDED.stage,
            call_preference = EXCLUDED.call_preference,
            call_offer_status = EXCLUDED.call_offer_status,
            awaiting_reply = EXCLUDED.awaiting_reply,
            source_turn_id = EXCLUDED.source_turn_id,
            version = conversation_sales_context_states_v1.version + 1,
            updated_at = now()
        WHERE EXCLUDED.source_turn_id IS NULL
           OR conversation_sales_context_states_v1.source_turn_id IS DISTINCT FROM EXCLUDED.source_turn_id
        RETURNING *
      ), recorded AS (
        INSERT INTO conversation_sales_context_state_events_v1 (
          workspace_id, conversation_id, contact_id, state_version, source_turn_id,
          selected_offering_code, selected_payment_plan, stage,
          call_preference, call_offer_status, awaiting_reply
        )
        SELECT
          workspace_id, conversation_id, contact_id, version, source_turn_id,
          selected_offering_code, selected_payment_plan, stage,
          call_preference, call_offer_status, awaiting_reply
        FROM upserted
        ON CONFLICT DO NOTHING
      ), resolved AS (
        SELECT upserted.*
        FROM upserted
        UNION ALL
        SELECT state.*
        FROM conversation_sales_context_states_v1 AS state
        JOIN eligible ON eligible.workspace_id = state.workspace_id
        WHERE state.conversation_id = ${input.conversation_id}::uuid
          AND state.contact_id = ${input.contact_id}::uuid
          AND NOT EXISTS (SELECT 1 FROM upserted)
      )
      SELECT *
      FROM resolved
      LIMIT 1
    `;
    if (!rows[0]) throw new Error('CONVERSATION_STATE_V1_CONTEXT_NOT_FOUND');
    return mapRow(rows[0]);
  }
}
