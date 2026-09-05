import type { DbClient } from '@/lib/db/types';
import { sql } from '@/lib/db/orchestrator';
import type {
  ConversationStateTransitionV1,
  ConversationStateV1,
  TechnicalFallbackRecordV1,
} from '../domain/conversation-pipeline';
import type { ConversationStateStoreV1 } from '../ports/conversation-state-store';

interface ConversationStateRowV1 extends Omit<
  ConversationStateV1,
  'created_at' | 'updated_at' | 'payment_reported_at' | 'human_review_requested_at' | 'version'
> {
  created_at: Date | string;
  updated_at: Date | string;
  payment_reported_at: Date | string | null;
  human_review_requested_at: Date | string | null;
  version: number | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

/**
 * `payment_reported_at` venía sin normalizar: el driver devuelve `Date` y el
 * contrato declara `string`. La mentira era invisible mientras nadie comparara
 * dos lecturas — dos `Date` con el mismo instante no son el mismo objeto, así
 * que `toBe` falla y `===` en producción también.
 */
function mapRow(row: ConversationStateRowV1): ConversationStateV1 {
  return {
    ...row,
    version: Number(row.version ?? 0),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    payment_reported_at: isoOrNull(row.payment_reported_at),
    human_review_requested_at: isoOrNull(row.human_review_requested_at),
  };
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
          call_preference, call_offer_status, call_offer_count, awaiting_reply,
          payment_reported_at, consecutive_technical_fallbacks, source_turn_id
        )
        SELECT
          eligible.workspace_id, ${input.conversation_id}::uuid, ${input.contact_id}::uuid,
          ${input.selected_offering_code}, ${input.selected_payment_plan}, ${input.stage},
          ${input.call_preference}, ${input.call_offer_status}, ${input.call_offer_count ?? 0}, ${input.awaiting_reply},
          CASE WHEN ${input.payment_reported} THEN now() END,
          ${input.consecutive_technical_fallbacks ?? 0},
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
            call_offer_count = CASE
              WHEN ${input.call_offer_count ?? null}::smallint IS NULL
                THEN conversation_sales_context_states_v1.call_offer_count
              ELSE EXCLUDED.call_offer_count
            END,
            awaiting_reply = EXCLUDED.awaiting_reply,
            -- Una afirmación de pago no se retracta ni se re-fecha: el primer
            -- momento en que el cliente lo dijo es el que un humano necesita.
            payment_reported_at = COALESCE(
              conversation_sales_context_states_v1.payment_reported_at,
              EXCLUDED.payment_reported_at
            ),
            -- Una transición normal es un turno que salió bien: reinicia el
            -- contador. La marca de revisión NO se toca: es histórica.
            consecutive_technical_fallbacks = EXCLUDED.consecutive_technical_fallbacks,
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
          call_preference, call_offer_status, call_offer_count, awaiting_reply,
          payment_reported_at
        )
        SELECT
          workspace_id, conversation_id, contact_id, version, source_turn_id,
          selected_offering_code, selected_payment_plan, stage,
          call_preference, call_offer_status, call_offer_count, awaiting_reply,
          payment_reported_at
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
  /**
   * Turno técnico: escribe SÓLO el contador y, en el segundo consecutivo, la
   * derivación. No toca curso, plan, etapa, preferencia de llamada ni
   * `awaiting_reply` — ese turno no cambió nada comercial y no debe simular
   * que sí.
   *
   * La idempotencia vive en el COALESCE y no en TypeScript a propósito: se
   * evalúa contra la fila bloqueada, así que dos turnos concurrentes de la
   * misma conversación no pueden producir dos derivaciones.
   */
  async recordTechnicalFallbackV1(input: TechnicalFallbackRecordV1): Promise<void> {
    await this.db`
      INSERT INTO conversation_sales_context_states_v1 (
        workspace_id, conversation_id, contact_id, stage,
        consecutive_technical_fallbacks, human_review_requested_at, source_turn_id
      )
      SELECT
        workspace.id, ${input.conversation_id}::uuid, ${input.contact_id}::uuid, 'exploring',
        ${input.consecutive_technical_fallbacks},
        CASE WHEN ${input.request_human_review} THEN now() END,
        ${input.source_turn_id}::uuid
      FROM workspaces AS workspace
      JOIN conversations AS conversation
        ON conversation.id = ${input.conversation_id}::uuid
       AND conversation.contact_id = ${input.contact_id}::uuid
      WHERE workspace.slug = ${input.workspace_slug}
        AND workspace.status = 'active'
      ON CONFLICT (workspace_id, conversation_id) DO UPDATE
      SET consecutive_technical_fallbacks = EXCLUDED.consecutive_technical_fallbacks,
          human_review_requested_at = COALESCE(
            conversation_sales_context_states_v1.human_review_requested_at,
            EXCLUDED.human_review_requested_at
          ),
          version = conversation_sales_context_states_v1.version + 1,
          updated_at = now()
    `;
  }

}
